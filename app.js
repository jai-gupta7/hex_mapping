const DEFAULT_CENTER = { lat: 28.4595, lng: 77.0266 };
const PINCODE_GEOJSON_PATH = "./data/pincodes.geojson";
const SAMPLE_GEOJSON_PATH = "./data/pincodes.sample.geojson";
const PINCODE_COLORS = ["#59c3c3", "#f4a261", "#90be6d", "#f8961e", "#43aa8b", "#577590"];
const CUSTOM_COLORS = ["#ef476f", "#9b5de5", "#f15bb5", "#fee440", "#00bbf9", "#00f5d4"];

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
    edit: {
      featureGroup: drawLayer,
      edit: false,
      remove: true,
    },
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
  latInput: document.getElementById("lat-input"),
  lngInput: document.getElementById("lng-input"),
  buildZonesButton: document.getElementById("build-zones-btn"),
  resetButton: document.getElementById("reset-btn"),
  datasetName: document.getElementById("dataset-name"),
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
  parentCells: new Set(),
  selectedPinCodes: [],
  datasetName: "Loading...",
};

const baseZoneLayer = L.layerGroup().addTo(map);
const customZoneLayer = L.layerGroup().addTo(map);
const centerLayer = L.layerGroup().addTo(map);

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

  controls.resetButton.addEventListener("click", async () => {
    state.center = { ...DEFAULT_CENTER };
    state.customZones = [];
    drawLayer.clearLayers();
    syncCenterInputs();
    await rebuildZones();
  });

  map.on("click", async (event) => {
    state.center = {
      lat: roundCoordinate(event.latlng.lat),
      lng: roundCoordinate(event.latlng.lng),
    };
    syncCenterInputs();
    drawCenterMarker();
    await rebuildZones();
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
    state.customZones = state.customZones.filter((zone) => !deletedIds.has(zone.id));
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
  } catch {
    const response = await fetch(SAMPLE_GEOJSON_PATH);
    const geojson = await response.json();
    setPincodeData(geojson, "sample data");
    showStatus("Using sample PIN-code polygons. Replace data/pincodes.geojson with a real boundary dataset.", "success");
  }
}

function setPincodeData(geojson, datasetName) {
  state.pincodeFeatures = geojson.features
    .filter((feature) => ["Polygon", "MultiPolygon"].includes(feature.geometry?.type))
    .map((feature, index) => ({
      id: getPincodeLabel(feature, index),
      feature,
      centroid: turf.centroid(feature),
    }));
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
    const pincodeCount = getPincodeCount();
    const selectedFeatures = selectNearbyPincodes(state.center, pincodeCount);

    if (!selectedFeatures.length) {
      showStatus("No PIN-code boundary polygons are available to map.");
      return;
    }

    state.selectedPinCodes = selectedFeatures.map((item) => item.id);
    selectedFeatures.forEach((item, index) => {
      const cells = featureToIntersectingCells(item.feature, resolution);
      state.selectedZones.push({
        id: item.id,
        label: item.id,
        color: PINCODE_COLORS[index % PINCODE_COLORS.length],
        sourceFeature: item.feature,
        cells,
      });
      cells.forEach((cell) => state.parentCells.add(cell));
    });

    renderAllZones(true);
    showStatus(
      `Mapped ${state.selectedZones.length} PIN-code zones to ${state.parentCells.size} H3 cells at resolution ${resolution}.`,
      "success"
    );
  } catch (error) {
    showStatus(`Unable to map PIN-code zones: ${error.message}`);
  }
}

function clearZoneState() {
  state.selectedZones = [];
  state.customZones = [];
  state.parentCells = new Set();
  state.selectedPinCodes = [];
  drawLayer.clearLayers();
  baseZoneLayer.clearLayers();
  customZoneLayer.clearLayers();
  updateStats();
}

function selectNearbyPincodes(center, count) {
  const centerPoint = turf.point([center.lng, center.lat]);

  return state.pincodeFeatures
    .map((item) => ({
      ...item,
      containsCenter: turf.booleanPointInPolygon(centerPoint, item.feature),
      distanceKm: turf.distance(centerPoint, item.centroid, { units: "kilometers" }),
    }))
    .sort((a, b) => {
      if (a.containsCenter !== b.containsCenter) {
        return a.containsCenter ? -1 : 1;
      }
      return a.distanceKm - b.distanceKm;
    })
    .slice(0, count);
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

    if (!parentSelectedCells.length) {
      showStatus("The drawn polygon does not select any H3 cells inside the parent PIN-code coverage.");
      return;
    }

    if (outsideCells.length) {
      showStatus("Custom zone rejected. Draw only inside the selected PIN-code hex coverage.");
      return;
    }

    if (overlapsExistingCustomZone(parentSelectedCells)) {
      showStatus("Custom zone rejected. It overlaps an existing custom zone.");
      return;
    }

    if (!sharesAllowedBoundary(parentSelectedCells)) {
      showStatus(
        "Custom zone rejected. It creates an isolated island. Draw a polygon that shares a boundary with the parent outer edge or an existing custom zone."
      );
      return;
    }

    const zoneId = `custom-${Date.now()}`;
    layer.zoneId = zoneId;
    drawLayer.addLayer(layer);
    state.customZones.push({
      id: zoneId,
      label: `Custom Zone ${state.customZones.length + 1}`,
      color: CUSTOM_COLORS[state.customZones.length % CUSTOM_COLORS.length],
      cells: parentSelectedCells,
    });
    renderAllZones();
    showStatus(`Created ${parentSelectedCells.length} H3-cell custom zone.`, "success");
  } catch (error) {
    showStatus(`Unable to create custom zone: ${error.message}`);
  }
}

function renderAllZones(shouldFitBounds = false) {
  baseZoneLayer.clearLayers();
  customZoneLayer.clearLayers();

  const customCellSet = new Set(state.customZones.flatMap((zone) => zone.cells));
  const bounds = [];

  state.selectedZones.forEach((zone) => {
    const remainingCells = zone.cells.filter((cell) => !customCellSet.has(cell));
    renderCells(remainingCells, zone.color, baseZoneLayer, `${zone.label} remaining`, 0.18, bounds);
  });

  state.customZones.forEach((zone) => {
    renderCells(zone.cells, zone.color, customZoneLayer, zone.label, 0.55, bounds);
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
    });

    polygon.bindPopup(buildPopupMarkup(label, cell));
    polygon.on("click", () => {
      controls.selectedCell.textContent = cell;
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

function overlapsExistingCustomZone(cells) {
  const cellSet = new Set(cells);
  return state.customZones.some((zone) => zone.cells.some((cell) => cellSet.has(cell)));
}

function sharesAllowedBoundary(cells) {
  const cellSet = new Set(cells);
  const existingCustomCells = new Set(state.customZones.flatMap((zone) => zone.cells));

  return cells.some((cell) => {
    const neighbors = h3.gridDisk(cell, 1).filter((neighbor) => neighbor !== cell);
    return neighbors.some((neighbor) => {
      const touchesParentOuterEdge = !state.parentCells.has(neighbor);
      const touchesExistingCustomZone = existingCustomCells.has(neighbor);
      return touchesParentOuterEdge || touchesExistingCustomZone;
    });
  });
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

function updateStats() {
  controls.datasetName.textContent = state.datasetName;
  controls.selectedPins.textContent = state.selectedPinCodes.length ? state.selectedPinCodes.join(", ") : "-";
  controls.parentCellCount.textContent = state.parentCells.size ? String(state.parentCells.size) : "-";
  controls.customZoneCount.textContent = String(state.customZones.length);
  controls.zoneList.innerHTML = "";

  state.selectedZones.forEach((zone) => {
    appendZoneListItem(zone.label, zone.cells.length, zone.color);
  });

  state.customZones.forEach((zone) => {
    appendZoneListItem(zone.label, zone.cells.length, zone.color);
  });
}

function appendZoneListItem(label, cellCount, color) {
  const row = document.createElement("p");
  row.className = "zone-chip";
  row.style.setProperty("--zone-color", color);
  row.innerHTML = `<span>${label}</span><span>${cellCount} cells</span>`;
  controls.zoneList.appendChild(row);
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

function getPincodeLabel(feature, index) {
  const props = feature.properties || {};
  return (
    props.pincode ||
    props.PINCODE ||
    props.pin_code ||
    props.POSTAL_CODE ||
    props.postal_code ||
    props.name ||
    props.Name ||
    `PIN-${index + 1}`
  );
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
