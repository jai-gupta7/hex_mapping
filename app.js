const DEFAULT_CENTER = { lat: 28.4595, lng: 77.0266 };
const PINCODE_GEOJSON_PATH = "./data/pincodes.geojson";
const SAMPLE_GEOJSON_PATH = "./data/pincodes.sample.geojson";
const PINCODE_COLORS = ["#59c3c3", "#f4a261", "#90be6d", "#f8961e", "#43aa8b", "#577590"];
const CUSTOM_COLORS = ["#ef476f", "#9b5de5", "#f15bb5", "#fee440", "#00bbf9", "#00f5d4"];
const PINCODE_PROPERTY_KEYS = [
  "pincode",
  "PINCODE",
  "pin_code",
  "PIN_CODE",
  "pin",
  "PIN",
  "postal_code",
  "POSTAL_CODE",
  "postcode",
  "POSTCODE",
];

const map = L.map("map", {
  zoomControl: true,
  preferCanvas: true,
}).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 11);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const drawLayer = new L.FeatureGroup().addTo(map);
map.addControl(
  new L.Control.Draw({
    edit: false,
    draw: {
      circle: false,
      circlemarker: false,
      marker: false,
      polyline: false,
      rectangle: false,
      polygon: {
        allowIntersection: false,
        showArea: true,
        shapeOptions: {
          color: "#ef476f",
          fillColor: "#ef476f",
          fillOpacity: 0.12,
        },
      },
    },
  })
);

const controls = {
  resolution: document.getElementById("resolution"),
  pincodeCount: document.getElementById("pincode-count"),
  serviceRadius: document.getElementById("service-radius"),
  latInput: document.getElementById("lat-input"),
  lngInput: document.getElementById("lng-input"),
  buildZonesButton: document.getElementById("build-zones-btn"),
  exportZonesButton: document.getElementById("export-zones-btn"),
  resetButton: document.getElementById("reset-btn"),
  datasetName: document.getElementById("dataset-name"),
  radiusLabel: document.getElementById("radius-label"),
  selectedPins: document.getElementById("selected-pins"),
  parentCellCount: document.getElementById("parent-cell-count"),
  customZoneCount: document.getElementById("custom-zone-count"),
  selectedCell: document.getElementById("selected-cell"),
  zoneList: document.getElementById("zone-list"),
  statusMessage: document.getElementById("status-message"),
};

const state = {
  center: { ...DEFAULT_CENTER },
  pincodeFeatures: [],
  selectedZones: [],
  customZones: [],
  workingZones: [],
  parentCells: new Set(),
  selectedPinCodes: [],
  datasetName: "Loading...",
  radiusKm: 5,
  isDrawing: false,
  customZoneSequence: 0,
};

const baseZoneLayer = L.layerGroup().addTo(map);
const customZoneLayer = L.layerGroup().addTo(map);
const centerLayer = L.layerGroup().addTo(map);
const radiusLayer = L.layerGroup().addTo(map);

bootstrap();

async function bootstrap() {
  syncCenterInputs();
  wireEvents();
  drawCenterMarker();

  if (!window.h3 || !window.turf || !L.Control.Draw) {
    showStatus("Required map libraries failed to load. Refresh the page and check your network access.");
    controls.buildZonesButton.disabled = true;
    return;
  }

  await loadPincodeData();
  await rebuildZones();
}

function wireEvents() {
  controls.buildZonesButton.addEventListener("click", rebuildZones);
  controls.resolution.addEventListener("change", rebuildZones);
  controls.pincodeCount.addEventListener("change", rebuildZones);
  controls.serviceRadius.addEventListener("change", rebuildZones);
  controls.latInput.addEventListener("change", rebuildZones);
  controls.lngInput.addEventListener("change", rebuildZones);
  controls.exportZonesButton.addEventListener("click", exportZoneJson);

  controls.resetButton.addEventListener("click", async () => {
    state.center = { ...DEFAULT_CENTER };
    state.customZoneSequence = 0;
    drawLayer.clearLayers();
    syncCenterInputs();
    await rebuildZones();
  });

  map.on("click", async (event) => {
    if (state.isDrawing) {
      return;
    }

    await updateBranchPoint(event.latlng);
  });

  map.on(L.Draw.Event.DRAWSTART, () => {
    state.isDrawing = true;
  });

  map.on(L.Draw.Event.DRAWSTOP, () => {
    state.isDrawing = false;
  });

  map.on(L.Draw.Event.CREATED, (event) => {
    handleDrawnPolygon(event.layer);
  });

  map.on(L.Draw.Event.DELETED, async (event) => {
    const deletedIds = new Set();
    event.layers.eachLayer((layer) => {
      if (layer.zoneId) {
        deletedIds.add(layer.zoneId);
      }
    });
    state.workingZones = state.workingZones.filter((zone) => !deletedIds.has(zone.id));
    state.customZones = state.workingZones.filter((zone) => zone.source === "custom");
    renderAllZones();
  });
}

async function loadPincodeData() {
  try {
    const response = await fetch(PINCODE_GEOJSON_PATH);
    if (!response.ok) {
      throw new Error("Real pincode file not found.");
    }
    const geojson = await response.json();
    setPincodeData(geojson, "data/pincodes.geojson");
  } catch (error) {
    const response = await fetch(SAMPLE_GEOJSON_PATH);
    const geojson = await response.json();
    setPincodeData(geojson, "sample data");
    showStatus(
      `Using sample PIN-code polygons. Replace data/pincodes.geojson with a real boundary dataset. Reason: ${error.message}`,
      "success"
    );
  }
}

function setPincodeData(geojson, datasetName) {
  state.pincodeFeatures = geojson.features
    .filter((feature) => ["Polygon", "MultiPolygon"].includes(feature.geometry?.type) && getPincodeValue(feature))
    .map((feature, index) => ({
      id: getPincodeLabel(feature, index),
      feature,
      centroid: turf.centroid(feature),
    }));

  if (!state.pincodeFeatures.length) {
    throw new Error(
      `${datasetName} does not look like PIN-code boundary data. Expected Polygon/MultiPolygon features with a six-digit PIN-code property.`
    );
  }

  state.datasetName = datasetName;
  controls.datasetName.textContent = datasetName;
}

async function rebuildZones() {
  const center = readCenterInputs();
  if (!center) {
    return;
  }

  state.center = center;
  drawCenterMarker();
  clearZoneState();

  try {
    hideStatus();

    const resolution = getResolution();
    state.radiusKm = getServiceRadius();
    const maxPincodeCount = getPincodeCount();
    const selectedFeatures = selectPincodesInRadius(state.center, state.radiusKm, maxPincodeCount);

    if (!selectedFeatures.length) {
      showStatus("No PIN-code boundaries intersect this branch radius. Increase the radius or move the branch point.");
      renderRadiusCircle();
      return;
    }

    state.selectedPinCodes = selectedFeatures.map((item) => item.id);
    const assignedCells = new Set();

    selectedFeatures.forEach((item, index) => {
      const cells = featureToIntersectingCells(item.feature, resolution);
      const ownedCells = cells.filter((cell) => !assignedCells.has(cell));
      cells.forEach((cell) => state.parentCells.add(cell));
      ownedCells.forEach((cell) => assignedCells.add(cell));

      const zone = {
        id: `pincode-${item.id}`,
        label: item.id,
        color: PINCODE_COLORS[index % PINCODE_COLORS.length],
        source: "pincode",
        parentPincodes: [item.id],
        sourceFeature: item.feature,
        cells: ownedCells,
      };

      if (zone.cells.length) {
        state.selectedZones.push(zone);
        state.workingZones.push(zone);
      }
    });

    renderRadiusCircle();
    renderAllZones(true);
    showStatus(
      `Mapped ${state.selectedZones.length} PIN-code zones inside a ${state.radiusKm} km branch radius to ${state.parentCells.size} H3 cells at resolution ${resolution}.`,
      "success"
    );
  } catch (error) {
    showStatus(`Unable to map PIN-code zones: ${error.message}`);
  }
}

function clearZoneState() {
  state.selectedZones = [];
  state.customZones = [];
  state.workingZones = [];
  state.parentCells = new Set();
  state.selectedPinCodes = [];
  state.customZoneSequence = 0;
  drawLayer.clearLayers();
  baseZoneLayer.clearLayers();
  customZoneLayer.clearLayers();
  updateStats();
}

function selectPincodesInRadius(center, radiusKm, maxCount) {
  const centerPoint = turf.point([center.lng, center.lat]);
  const radiusCircle = turf.circle(centerPoint, radiusKm, {
    steps: 96,
    units: "kilometers",
  });

  return state.pincodeFeatures
    .map((item) => ({
      ...item,
      containsCenter: turf.booleanPointInPolygon(centerPoint, item.feature),
      intersectsRadius: turf.booleanIntersects(item.feature, radiusCircle),
      distanceKm: turf.distance(centerPoint, item.centroid, { units: "kilometers" }),
    }))
    .filter((item) => item.intersectsRadius || item.containsCenter)
    .sort((a, b) => {
      if (a.containsCenter !== b.containsCenter) {
        return a.containsCenter ? -1 : 1;
      }
      return a.distanceKm - b.distanceKm;
    })
    .slice(0, maxCount);
}

function handleDrawnPolygon(layer) {
  if (!state.parentCells.size) {
    showStatus("Build PIN-code zones before drawing a custom zone.");
    return;
  }

  try {
    const resolution = getResolution();
    const feature = layer.toGeoJSON();
    const selectedCells = featureToIntersectingCells(feature, resolution);
    const parentSelectedCells = selectedCells.filter((cell) => state.parentCells.has(cell));
    const outsideCells = selectedCells.filter((cell) => !state.parentCells.has(cell));
    const selectedCellSet = new Set(parentSelectedCells);
    const ownerByCell = getCellOwnerMap();

    if (!parentSelectedCells.length) {
      showStatus("The drawn polygon does not select any H3 cells inside the parent PIN-code coverage.");
      return;
    }

    if (outsideCells.length) {
      showStatus("Custom zone rejected. Draw only inside the selected PIN-code hex coverage.");
      return;
    }

    if (getConnectedCellComponents(parentSelectedCells).length > 1) {
      showStatus("Custom zone rejected. Draw one connected H3-cell area at a time.");
      return;
    }

    if (!sharesAllowedBoundary(parentSelectedCells, ownerByCell)) {
      showStatus(
        "Custom zone rejected. It creates an isolated island. Draw a polygon that touches the parent outer boundary or an existing zone boundary."
      );
      return;
    }

    const affectedZoneIds = new Set(parentSelectedCells.map((cell) => ownerByCell.get(cell)).filter(Boolean));
    const affectedParentPincodes = uniqueValues(
      state.workingZones
        .filter((zone) => affectedZoneIds.has(zone.id))
        .flatMap((zone) => zone.parentPincodes || [])
    );
    const nextZones = [];

    state.workingZones.forEach((zone) => {
      const isAffected = zone.cells.some((cell) => selectedCellSet.has(cell));

      if (!isAffected) {
        nextZones.push(zone);
        return;
      }

      const remainingCells = zone.cells.filter((cell) => !selectedCellSet.has(cell));
      const components = getConnectedCellComponents(remainingCells);

      components.forEach((component, componentIndex) => {
        nextZones.push({
          ...zone,
          id: `${zone.id}-derived-${Date.now()}-${componentIndex}`,
          label: buildDerivedZoneLabel(zone.label, components.length, componentIndex),
          source: "derived",
          cells: component,
        });
      });
    });

    const zoneId = `custom-${state.customZoneSequence + 1}`;
    state.customZoneSequence += 1;
    nextZones.push({
      id: zoneId,
      label: `Custom Zone ${state.customZoneSequence}`,
      color: CUSTOM_COLORS[(state.customZoneSequence - 1) % CUSTOM_COLORS.length],
      source: "custom",
      parentPincodes: affectedParentPincodes,
      cells: parentSelectedCells,
    });

    state.workingZones = nextZones;
    state.customZones = state.workingZones.filter((zone) => zone.source === "custom");
    renderAllZones();
    showStatus(
      `Created ${parentSelectedCells.length} H3-cell custom zone and rebuilt ${affectedZoneIds.size} affected zone(s).`,
      "success"
    );
  } catch (error) {
    showStatus(`Unable to create custom zone: ${error.message}`);
  }
}

function renderAllZones(shouldFitBounds = false) {
  baseZoneLayer.clearLayers();
  customZoneLayer.clearLayers();

  const bounds = [];

  state.workingZones.forEach((zone) => {
    const isCustom = zone.source === "custom";
    const layer = isCustom ? customZoneLayer : baseZoneLayer;
    const fillOpacity = isCustom ? 0.55 : zone.source === "derived" ? 0.28 : 0.18;
    renderCells(zone.cells, zone.color, layer, zone.label, fillOpacity, bounds);
  });

  updateStats();

  if (shouldFitBounds && bounds.length) {
    map.fitBounds(bounds, { padding: [28, 28] });
  }
}

function renderCells(cells, color, layerGroup, label, fillOpacity, bounds) {
  cells.forEach((cell) => {
    const latLngs = h3.cellToBoundary(cell);
    latLngs.forEach((point) => bounds?.push(point));

    const polygon = L.polygon(latLngs, {
      color,
      weight: 1,
      fillColor: color,
      fillOpacity,
      bubblingMouseEvents: false,
    });

    polygon.bindPopup(buildPopupMarkup(label, cell));
    polygon.on("click", async (event) => {
      controls.selectedCell.textContent = cell;
      if (!state.isDrawing) {
        await updateBranchPoint(event.latlng);
      }
    });
    polygon.addTo(layerGroup);
  });
}

function featureToIntersectingCells(feature, resolution) {
  const candidates = candidateCellsFromBbox(feature, resolution);

  return candidates.filter((cell) => {
    const hexFeature = cellToGeoJsonFeature(cell);
    return turf.booleanIntersects(hexFeature, feature);
  });
}

function candidateCellsFromBbox(feature, resolution) {
  const [minLng, minLat, maxLng, maxLat] = turf.bbox(feature);
  const bboxPolygon = [
    [
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat],
    ],
  ];

  return h3.polygonToCells(bboxPolygon, resolution, true);
}

function cellToGeoJsonFeature(cell) {
  const boundary = h3.cellToBoundary(cell, true);
  boundary.push(boundary[0]);
  return turf.polygon([boundary]);
}

function sharesAllowedBoundary(cells, ownerByCell) {
  return cells.some((cell) => {
    const owner = ownerByCell.get(cell);
    const neighbors = h3.gridDisk(cell, 1).filter((neighbor) => neighbor !== cell);

    return neighbors.some((neighbor) => {
      const touchesParentOuterEdge = !state.parentCells.has(neighbor);
      const neighborOwner = ownerByCell.get(neighbor);
      const touchesAnotherZone = Boolean(owner && neighborOwner && neighborOwner !== owner);
      return touchesParentOuterEdge || touchesAnotherZone;
    });
  });
}

function getCellOwnerMap() {
  const ownerByCell = new Map();

  state.workingZones.forEach((zone) => {
    zone.cells.forEach((cell) => {
      ownerByCell.set(cell, zone.id);
    });
  });

  return ownerByCell;
}

function getConnectedCellComponents(cells) {
  const unvisited = new Set(cells);
  const components = [];

  while (unvisited.size) {
    const start = unvisited.values().next().value;
    const component = [];
    const stack = [start];
    unvisited.delete(start);

    while (stack.length) {
      const cell = stack.pop();
      component.push(cell);

      h3.gridDisk(cell, 1)
        .filter((neighbor) => neighbor !== cell && unvisited.has(neighbor))
        .forEach((neighbor) => {
          unvisited.delete(neighbor);
          stack.push(neighbor);
        });
    }

    components.push(component);
  }

  return components;
}

function buildDerivedZoneLabel(label, componentCount, componentIndex) {
  const suffix = componentCount > 1 ? ` Part ${componentIndex + 1}` : "";
  return `${label} Remainder${suffix}`;
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function drawCenterMarker() {
  centerLayer.clearLayers();
  L.circleMarker([state.center.lat, state.center.lng], {
    radius: 7,
    color: "#ffffff",
    weight: 2,
    fillColor: "#ef476f",
    fillOpacity: 1,
  })
    .bindTooltip("Center point", { direction: "top", offset: [0, -8] })
    .addTo(centerLayer);
}

function renderRadiusCircle() {
  radiusLayer.clearLayers();
  L.circle([state.center.lat, state.center.lng], {
    radius: state.radiusKm * 1000,
    color: "#ef476f",
    weight: 2,
    opacity: 0.75,
    fillColor: "#ef476f",
    fillOpacity: 0.05,
    dashArray: "8 8",
  })
    .bindTooltip(`${state.radiusKm} km branch radius`, { direction: "top" })
    .addTo(radiusLayer);
}

function updateStats() {
  controls.datasetName.textContent = state.datasetName;
  controls.radiusLabel.textContent = state.radiusKm ? `${state.radiusKm} km` : "-";
  controls.selectedPins.textContent = state.selectedPinCodes.length ? state.selectedPinCodes.join(", ") : "-";
  controls.parentCellCount.textContent = state.parentCells.size ? String(state.parentCells.size) : "-";
  controls.customZoneCount.textContent = String(state.customZones.length);
  controls.zoneList.innerHTML = "";

  state.workingZones.forEach((zone) => {
    appendZoneListItem(`${zone.label} (${zone.source})`, zone.cells.length, zone.color);
  });
}

function appendZoneListItem(label, cellCount, color) {
  const row = document.createElement("p");
  row.className = "zone-chip";
  row.style.setProperty("--zone-color", color);
  row.innerHTML = `<span>${label}</span><span>${cellCount} cells</span>`;
  controls.zoneList.appendChild(row);
}

function exportZoneJson() {
  if (!state.workingZones.length) {
    showStatus("Build zones before exporting.");
    return;
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    resolution: getResolution(),
    center: state.center,
    radiusKm: state.radiusKm,
    selectedPinCodes: state.selectedPinCodes,
    zones: state.workingZones.map((zone) => ({
      id: zone.id,
      name: zone.label,
      source: zone.source,
      parentPincodes: zone.parentPincodes || [],
      color: zone.color,
      cellCount: zone.cells.length,
      cells: zone.cells,
    })),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `h3-zone-export-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showStatus("Exported current H3 zone arrangement as JSON.", "success");
}

function buildPopupMarkup(label, cell) {
  return `
    <div class="hex-popup">
      <strong>${label}</strong>
      <span>${cell}</span>
      <span>Resolution: ${getResolution()}</span>
      <span>Area: ${h3.cellArea(cell, "km2").toFixed(3)} km2</span>
    </div>
  `;
}

function readCenterInputs() {
  const lat = Number(controls.latInput.value);
  const lng = Number(controls.lngInput.value);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    showStatus("Enter valid latitude and longitude values.");
    return null;
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    showStatus("Latitude must be between -90 and 90, and longitude between -180 and 180.");
    return null;
  }

  return {
    lat: roundCoordinate(lat),
    lng: roundCoordinate(lng),
  };
}

function syncCenterInputs() {
  controls.latInput.value = String(state.center.lat);
  controls.lngInput.value = String(state.center.lng);
}

async function updateBranchPoint(latlng) {
  state.center = {
    lat: roundCoordinate(latlng.lat),
    lng: roundCoordinate(latlng.lng),
  };
  syncCenterInputs();
  drawCenterMarker();
  await rebuildZones();
}

function getResolution() {
  return Number(controls.resolution.value);
}

function getPincodeCount() {
  const count = Number(controls.pincodeCount.value);
  if (!Number.isInteger(count) || count < 1) {
    return 1;
  }
  return Math.min(count, state.pincodeFeatures.length || count);
}

function getServiceRadius() {
  const radiusKm = Number(controls.serviceRadius.value);
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
    return 1;
  }
  return Math.min(radiusKm, 100);
}

function getPincodeLabel(feature, index) {
  return getPincodeValue(feature) || `PIN-${index + 1}`;
}

function getPincodeValue(feature) {
  const props = feature.properties || {};
  const matchedValue = PINCODE_PROPERTY_KEYS.map((key) => props[key]).find((value) => value !== undefined && value !== null);

  if (matchedValue === undefined) {
    return null;
  }

  const textValue = String(matchedValue).trim();
  return /^\d{6}$/.test(textValue) ? textValue : null;
}

function roundCoordinate(value) {
  return Number(value.toFixed(4));
}

function showStatus(message, tone = "error") {
  controls.statusMessage.hidden = false;
  controls.statusMessage.classList.toggle("is-success", tone === "success");
  controls.statusMessage.textContent = message;
}

function hideStatus() {
  controls.statusMessage.hidden = true;
  controls.statusMessage.classList.remove("is-success");
  controls.statusMessage.textContent = "";
}
