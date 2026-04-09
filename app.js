const DEFAULT_CENTER = { lat: 28.4595, lng: 77.0266 };
const PINCODE_GEOJSON_PATH = "./data/pincodes.geojson";
const SAMPLE_GEOJSON_PATH = "./data/pincodes.sample.geojson";
const PINCODE_COLORS = ["#59c3c3", "#f4a261", "#90be6d", "#f8961e", "#43aa8b", "#577590"];
const CUSTOM_COLORS = ["#ef476f", "#9b5de5", "#f15bb5", "#fee440", "#00bbf9", "#00f5d4"];
const SERVICE_BORDER_COLOR = "#0f766e";
const GUIDE_BORDER_COLOR = "#64748b";
const CONSTRAINT_BORDER_COLOR = "#f59e0b";
const CONSTRAINT_FILL_COLOR = "#f97316";
const SELECTION_COLOR = "#0ea5e9";
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
  mapView: document.getElementById("map-view"),
  resolution: document.getElementById("resolution"),
  pincodeCount: document.getElementById("pincode-count"),
  serviceRadius: document.getElementById("service-radius"),
  latInput: document.getElementById("lat-input"),
  lngInput: document.getElementById("lng-input"),
  zoneCount: document.getElementById("zone-count"),
  buildZonesButton: document.getElementById("build-zones-btn"),
  generateZonesButton: document.getElementById("generate-zones-btn"),
  exportZonesButton: document.getElementById("export-zones-btn"),
  resetButton: document.getElementById("reset-btn"),
  datasetName: document.getElementById("dataset-name"),
  mapViewLabel: document.getElementById("map-view-label"),
  radiusLabel: document.getElementById("radius-label"),
  selectedPins: document.getElementById("selected-pins"),
  parentCellCount: document.getElementById("parent-cell-count"),
  customZoneCount: document.getElementById("custom-zone-count"),
  constraintCellCount: document.getElementById("constraint-cell-count"),
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
  selectedCell: null,
  constraintCells: [],
  serviceAreaFeature: null,
  hiddenZoneIds: new Set(),
  datasetName: "Loading...",
  radiusKm: 5,
  isDrawing: false,
  customZoneSequence: 0,
};

const baseZoneLayer = L.layerGroup().addTo(map);
const customZoneLayer = L.layerGroup().addTo(map);
const boundaryZoneLayer = L.layerGroup().addTo(map);
const guideZoneLayer = L.layerGroup().addTo(map);
const serviceAreaLayer = L.layerGroup().addTo(map);
const selectionLayer = L.layerGroup().addTo(map);
const constraintLayer = L.layerGroup().addTo(map);
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
  controls.mapView.addEventListener("change", () => renderAllZones(true));
  controls.generateZonesButton.addEventListener("click", generateRandomZones);
  controls.exportZonesButton.addEventListener("click", exportZoneJson);

  controls.resetButton.addEventListener("click", async () => {
    state.center = { ...DEFAULT_CENTER };
    state.customZoneSequence = 0;
    state.selectedCell = null;
    state.hiddenZoneIds = new Set();
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
    state.serviceAreaFeature = buildServiceAreaFeature(selectedFeatures.map((item) => item.feature));
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
    state.constraintCells = buildConstraintCells(Array.from(state.parentCells));

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
  state.selectedCell = null;
  state.constraintCells = [];
  state.serviceAreaFeature = null;
  state.hiddenZoneIds = new Set();
  state.customZoneSequence = 0;
  drawLayer.clearLayers();
  baseZoneLayer.clearLayers();
  customZoneLayer.clearLayers();
  boundaryZoneLayer.clearLayers();
  guideZoneLayer.clearLayers();
  serviceAreaLayer.clearLayers();
  selectionLayer.clearLayers();
  constraintLayer.clearLayers();
  updateStats();
}

function generateRandomZones() {
  if (!state.parentCells.size) {
    showStatus("Build the serviceability area before generating random zones.");
    return;
  }

  const requestedZoneCount = getZoneCount();
  const allCells = Array.from(state.parentCells);
  const serviceComponents = getConnectedCellComponents(allCells);
  const minimumZoneCount = serviceComponents.length;
  const effectiveZoneCount = Math.max(
    minimumZoneCount,
    Math.min(requestedZoneCount, allCells.length)
  );
  const zoneAllocations = allocateZonesAcrossComponents(serviceComponents, effectiveZoneCount);
  const nextZones = [];

  zoneAllocations.forEach((zoneCount, componentIndex) => {
    const componentCells = serviceComponents[componentIndex];
    const partitions = partitionComponentIntoZones(componentCells, zoneCount);

    partitions.forEach((cells, partitionIndex) => {
      nextZones.push({
        id: `custom-auto-${componentIndex + 1}-${partitionIndex + 1}-${Date.now()}`,
        label: `Zone ${nextZones.length + 1}`,
        color: CUSTOM_COLORS[nextZones.length % CUSTOM_COLORS.length],
        source: "custom",
        parentPincodes: state.selectedPinCodes,
        cells,
      });
    });
  });

  state.workingZones = nextZones;
  state.customZones = [...nextZones];
  state.hiddenZoneIds = new Set();
  state.selectedCell = null;
  renderAllZones();

  if (effectiveZoneCount !== requestedZoneCount) {
    showStatus(
      `Generated ${effectiveZoneCount} zones. The serviceability area has ${minimumZoneCount} disconnected section(s), so the requested count was adjusted.`,
      "success"
    );
    return;
  }

  showStatus(`Generated ${effectiveZoneCount} random zones across the full serviceability area.`, "success");
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
      boundaryFeature: feature,
      cells: parentSelectedCells,
    });

    state.workingZones = nextZones;
    state.customZones = state.workingZones.filter((zone) => zone.source === "custom");
    state.hiddenZoneIds = new Set(
      [...state.hiddenZoneIds].filter((zoneId) => state.workingZones.some((zone) => zone.id === zoneId))
    );
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
  boundaryZoneLayer.clearLayers();
  guideZoneLayer.clearLayers();
  serviceAreaLayer.clearLayers();
  selectionLayer.clearLayers();
  constraintLayer.clearLayers();

  const bounds = [];

  if (getMapView() === "boundary") {
    renderServiceArea(bounds, "boundary");
    renderBoundaryModeZones(bounds);
    renderPincodeGuides(bounds, "boundary");
    renderConstraintCells(bounds, "boundary");
    renderSelectedCell();
    updateStats();

    if (shouldFitBounds && bounds.length) {
      map.fitBounds(bounds, { padding: [28, 28] });
    }

    return;
  }

  renderServiceArea(bounds, "hex");
  renderPincodeGuides(bounds, "hex");
  renderHexZones(bounds);
  renderConstraintCells(bounds, "hex");
  renderSelectedCell();

  updateStats();

  if (shouldFitBounds && bounds.length) {
    map.fitBounds(bounds, { padding: [28, 28] });
  }
}

function renderServiceArea(bounds, mode) {
  if (!state.serviceAreaFeature) {
    return;
  }

  const layer = L.geoJSON(state.serviceAreaFeature, {
    interactive: false,
    style: {
      color: SERVICE_BORDER_COLOR,
      weight: mode === "boundary" ? 4.5 : 4,
      fillColor: SERVICE_BORDER_COLOR,
      fillOpacity: mode === "boundary" ? 0.035 : 0.05,
    },
  });

  layer.eachLayer((featureLayer) => {
    const layerBounds = featureLayer.getBounds?.();
    if (layerBounds) {
      bounds.push(layerBounds.getNorthWest());
      bounds.push(layerBounds.getSouthEast());
    }
  });
  layer.addTo(serviceAreaLayer);
}

function renderPincodeGuides(bounds, mode) {
  state.selectedZones.forEach((zone) => {
    const layer = L.geoJSON(zone.sourceFeature, {
      bubblingMouseEvents: false,
      style: {
        color: GUIDE_BORDER_COLOR,
        weight: mode === "boundary" ? 2.4 : 1.4,
        opacity: mode === "boundary" ? 0.92 : 0.95,
        fillOpacity: 0,
        dashArray: mode === "boundary" ? "10 6" : "8 8",
        lineCap: "square",
      },
      onEachFeature: (_feature, featureLayer) => {
        featureLayer.bindPopup(buildPincodePopupMarkup(zone));
        featureLayer.on("click", () => {
          state.selectedCell = null;
          renderSelectedCell();
          controls.selectedCell.textContent = `PIN ${zone.label}`;
        });
      },
    });

    layer.eachLayer((featureLayer) => {
      const layerBounds = featureLayer.getBounds?.();
      if (layerBounds) {
        bounds.push(layerBounds.getNorthWest());
        bounds.push(layerBounds.getSouthEast());
      }
    });
    layer.addTo(guideZoneLayer);
    if (mode === "boundary") {
      layer.bringToFront();
    }
  });
}

function renderBoundaryModeZones(bounds) {
  state.workingZones
    .filter((zone) => !state.hiddenZoneIds.has(zone.id))
    .forEach((zone) => {
      const feature = zone.boundaryFeature || zoneCellsToFeature(zone.cells);
      if (!feature) {
        return;
      }

      const layer = L.geoJSON(feature, {
        bubblingMouseEvents: false,
        style: {
          color: zone.color,
          weight: 3,
          fillColor: zone.color,
          fillOpacity: 0.18,
        },
        onEachFeature: (_feature, featureLayer) => {
          featureLayer.bindPopup(buildZonePopupMarkup(zone));
          featureLayer.on("click", () => {
            state.selectedCell = null;
            renderSelectedCell();
            controls.selectedCell.textContent = zone.label;
          });
        },
      });

      layer.eachLayer((featureLayer) => {
        const layerBounds = featureLayer.getBounds?.();
        if (layerBounds) {
          bounds.push(layerBounds.getNorthWest());
          bounds.push(layerBounds.getSouthEast());
        }
      });
      layer.addTo(boundaryZoneLayer);
    });
}

function renderHexZones(bounds) {
  state.workingZones.forEach((zone) => {
    if (state.hiddenZoneIds.has(zone.id)) {
      return;
    }

    const isCustom = zone.source === "custom";
    const layer = isCustom ? customZoneLayer : baseZoneLayer;
    const fillOpacity = isCustom ? 0.5 : zone.source === "derived" ? 0.24 : 0.14;
    renderCells(zone.cells, zone.color, layer, zone.label, fillOpacity, bounds);
  });
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
    polygon.on("click", () => {
      state.selectedCell = cell;
      controls.selectedCell.textContent = cell;
      renderSelectedCell();
    });
    polygon.addTo(layerGroup);
  });
}

function renderConstraintCells(bounds, mode) {
  state.constraintCells.forEach((cell) => {
    if (mode === "boundary") {
      const [lat, lng] = h3.cellToLatLng(cell);
      const marker = L.circleMarker([lat, lng], {
        radius: 7,
        color: CONSTRAINT_BORDER_COLOR,
        weight: 2,
        fillColor: CONSTRAINT_FILL_COLOR,
        fillOpacity: 0.9,
        dashArray: "3 3",
        className: "constraint-cell",
        bubblingMouseEvents: false,
      });

      bounds?.push({ lat, lng });
      marker.bindPopup(buildConstraintPopupMarkup(cell));
      marker.on("click", () => {
        state.selectedCell = cell;
        controls.selectedCell.textContent = `${cell} (constraint)`;
        renderSelectedCell();
      });
      marker.addTo(constraintLayer);
      return;
    }

    const latLngs = h3.cellToBoundary(cell);
    latLngs.forEach((point) => bounds?.push(point));

    const polygon = L.polygon(latLngs, {
      color: CONSTRAINT_BORDER_COLOR,
      weight: mode === "hex" ? 1.4 : 1.8,
      fillColor: CONSTRAINT_FILL_COLOR,
      fillOpacity: mode === "hex" ? 0.22 : 0.12,
      dashArray: "4 6",
      className: "constraint-cell",
      bubblingMouseEvents: false,
    });

    polygon.bindPopup(buildConstraintPopupMarkup(cell));
    polygon.on("click", () => {
      state.selectedCell = cell;
      controls.selectedCell.textContent = `${cell} (constraint)`;
      renderSelectedCell();
    });
    polygon.addTo(constraintLayer);
  });
}

function renderSelectedCell() {
  selectionLayer.clearLayers();

  if (!state.selectedCell) {
    return;
  }

  if (getMapView() === "boundary") {
    const [lat, lng] = h3.cellToLatLng(state.selectedCell);
    const marker = L.circleMarker([lat, lng], {
      radius: 9,
      color: "#ffffff",
      weight: 3,
      fillColor: SELECTION_COLOR,
      fillOpacity: 0.95,
      className: "selected-cell",
      bubblingMouseEvents: false,
    });

    marker.bindTooltip("Selected cell", { direction: "top" });
    marker.addTo(selectionLayer);
    return;
  }

  const latLngs = h3.cellToBoundary(state.selectedCell);
  const polygon = L.polygon(latLngs, {
    color: "#ffffff",
    weight: 3,
    fillColor: SELECTION_COLOR,
    fillOpacity: 0.45,
    className: "selected-cell",
    bubblingMouseEvents: false,
  });

  polygon.bindTooltip("Selected cell", { direction: "top" });
  polygon.addTo(selectionLayer);
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

function zoneCellsToFeature(cells) {
  if (!cells.length) {
    return null;
  }

  const multiPolygon = h3.cellsToMultiPolygon(cells, true);
  if (!multiPolygon.length) {
    return null;
  }

  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: multiPolygon.length === 1 ? "Polygon" : "MultiPolygon",
      coordinates: multiPolygon.length === 1 ? multiPolygon[0] : multiPolygon,
    },
  };
}

function buildServiceAreaFeature(features) {
  if (!features.length) {
    return null;
  }

  return features.reduce((merged, feature) => {
    if (!merged) {
      return turf.clone(feature);
    }

    try {
      return turf.union(merged, feature) || merged;
    } catch (_error) {
      return merged;
    }
  }, null);
}

function buildConstraintCells(parentCells) {
  if (!parentCells.length) {
    return [];
  }

  const sortedCells = [...parentCells].sort();
  const targetCount = Math.max(3, Math.min(14, Math.round(sortedCells.length * 0.04)));
  const flagged = sortedCells.filter((cell) => hashCell(cell) % 17 === 0).slice(0, targetCount);

  if (flagged.length >= targetCount) {
    return flagged;
  }

  const fallbackStep = Math.max(1, Math.floor(sortedCells.length / targetCount));
  for (let index = 0; index < sortedCells.length && flagged.length < targetCount; index += fallbackStep) {
    const cell = sortedCells[index];
    if (!flagged.includes(cell)) {
      flagged.push(cell);
    }
  }

  return flagged;
}

function hashCell(cell) {
  let hash = 0;

  for (let index = 0; index < cell.length; index += 1) {
    hash = (hash * 31 + cell.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function allocateZonesAcrossComponents(components, totalZoneCount) {
  const allocations = components.map(() => 1);
  let remaining = totalZoneCount - components.length;

  while (remaining > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;

    components.forEach((component, index) => {
      const score = component.length / allocations[index];
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    allocations[bestIndex] += 1;
    remaining -= 1;
  }

  return allocations;
}

function partitionComponentIntoZones(cells, zoneCount) {
  if (zoneCount <= 1 || cells.length <= 1) {
    return [cells];
  }

  const seeds = pickSpreadSeeds(cells, zoneCount);
  const cellSet = new Set(cells);
  const unassigned = new Set(cells);
  const zoneCells = seeds.map((seed) => [seed]);
  const frontiers = seeds.map((seed) => new Set([seed]));
  const ownerByCell = new Map();

  seeds.forEach((seed, zoneIndex) => {
    unassigned.delete(seed);
    ownerByCell.set(seed, zoneIndex);
  });

  while (unassigned.size) {
    let progressed = false;

    shuffledArray(zoneCells.map((_zone, index) => index)).forEach((zoneIndex) => {
      const candidates = [];

      frontiers[zoneIndex].forEach((frontierCell) => {
        getAdjacentCells(frontierCell, cellSet).forEach((neighbor) => {
          if (unassigned.has(neighbor)) {
            candidates.push(neighbor);
          }
        });
      });

      if (!candidates.length) {
        return;
      }

      const nextCell = candidates[Math.floor(Math.random() * candidates.length)];
      unassigned.delete(nextCell);
      ownerByCell.set(nextCell, zoneIndex);
      zoneCells[zoneIndex].push(nextCell);
      frontiers[zoneIndex].add(nextCell);
      progressed = true;
    });

    if (progressed) {
      continue;
    }

    const orphan = unassigned.values().next().value;
    const neighborOwners = getAdjacentCells(orphan, cellSet)
      .map((neighbor) => ownerByCell.get(neighbor))
      .filter((owner) => owner !== undefined);
    const fallbackZone = neighborOwners.length
      ? neighborOwners[Math.floor(Math.random() * neighborOwners.length)]
      : Math.floor(Math.random() * zoneCount);

    unassigned.delete(orphan);
    ownerByCell.set(orphan, fallbackZone);
    zoneCells[fallbackZone].push(orphan);
    frontiers[fallbackZone].add(orphan);
  }

  return zoneCells;
}

function pickSpreadSeeds(cells, zoneCount) {
  const pool = shuffledArray([...cells]);
  const seeds = [pool[0]];

  while (seeds.length < zoneCount && seeds.length < pool.length) {
    let bestCell = null;
    let bestScore = -Infinity;

    pool.forEach((cell) => {
      if (seeds.includes(cell)) {
        return;
      }

      const score = Math.min(...seeds.map((seed) => getCellDistanceKm(cell, seed)));
      if (score > bestScore) {
        bestScore = score;
        bestCell = cell;
      }
    });

    if (!bestCell) {
      break;
    }

    seeds.push(bestCell);
  }

  return seeds;
}

function getCellDistanceKm(cellA, cellB) {
  const [latA, lngA] = h3.cellToLatLng(cellA);
  const [latB, lngB] = h3.cellToLatLng(cellB);
  return turf.distance(turf.point([lngA, latA]), turf.point([lngB, latB]), { units: "kilometers" });
}

function getAdjacentCells(cell, cellSet) {
  return h3.gridDisk(cell, 1).filter((neighbor) => neighbor !== cell && cellSet.has(neighbor));
}

function shuffledArray(values) {
  const items = [...values];

  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }

  return items;
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
}

function updateStats() {
  controls.datasetName.textContent = state.datasetName;
  controls.mapViewLabel.textContent = getMapViewLabel();
  controls.radiusLabel.textContent = state.radiusKm ? `${state.radiusKm} km` : "-";
  controls.selectedPins.textContent = state.selectedPinCodes.length ? state.selectedPinCodes.join(", ") : "-";
  controls.parentCellCount.textContent = state.parentCells.size ? String(state.parentCells.size) : "-";
  controls.customZoneCount.textContent = String(state.customZones.length);
  controls.constraintCellCount.textContent = String(state.constraintCells.length);
  controls.selectedCell.textContent = state.selectedCell || "Click a zone or cell";
  controls.zoneList.innerHTML = "";

  state.workingZones.forEach((zone) => {
    appendZoneListItem(zone);
  });
}

function appendZoneListItem(zone) {
  const row = document.createElement("p");
  row.className = "zone-chip";
  const isHidden = state.hiddenZoneIds.has(zone.id);
  row.style.setProperty("--zone-color", zone.color);
  row.classList.toggle("is-hidden", isHidden);

  const label = document.createElement("span");
  label.textContent = `${zone.label} (${getZoneSourceLabel(zone.source)})`;

  const cells = document.createElement("span");
  cells.textContent = `${zone.cells.length} cells`;

  const toggleWrap = document.createElement("label");
  toggleWrap.className = "zone-chip-toggle";

  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = !isHidden;
  toggle.addEventListener("change", () => {
    setZoneVisibility(zone.id, toggle.checked);
  });

  const toggleText = document.createElement("span");
  toggleText.textContent = toggle.checked ? "Visible" : "Hidden";
  toggle.addEventListener("change", () => {
    toggleText.textContent = toggle.checked ? "Visible" : "Hidden";
  });

  toggleWrap.append(toggle, toggleText);
  row.append(label, cells, toggleWrap);
  controls.zoneList.appendChild(row);
}

function exportZoneJson() {
  if (!state.workingZones.length) {
    showStatus("Build zones before exporting.");
    return;
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    mapView: getMapView(),
    resolution: getResolution(),
    center: state.center,
    radiusKm: state.radiusKm,
    selectedPinCodes: state.selectedPinCodes,
    constraintCells: state.constraintCells,
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

function buildPincodePopupMarkup(zone) {
  return `
    <div class="hex-popup">
      <strong>PIN ${zone.label}</strong>
      <span>Guide boundary only</span>
      <span>Guide-backed cells: ${zone.cells.length}</span>
    </div>
  `;
}

function buildZonePopupMarkup(zone) {
  return `
    <div class="hex-popup">
      <strong>${zone.label}</strong>
      <span>${getZoneSourceLabel(zone.source)}</span>
      <span>Cells: ${zone.cells.length}</span>
    </div>
  `;
}

function buildConstraintPopupMarkup(cell) {
  return `
    <div class="hex-popup">
      <strong>Constraint Cell</strong>
      <span>${cell}</span>
      <span>Use with caution while carving zones.</span>
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

function getMapView() {
  return controls.mapView.value;
}

function getMapViewLabel() {
  return getMapView() === "boundary" ? "Boundary mode" : "Hex mode";
}

function getZoneCount() {
  const zoneCount = Number(controls.zoneCount.value);
  if (!Number.isInteger(zoneCount) || zoneCount < 1) {
    return 1;
  }

  return Math.min(zoneCount, Math.max(1, state.parentCells.size || zoneCount));
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

function setZoneVisibility(zoneId, isVisible) {
  if (isVisible) {
    state.hiddenZoneIds.delete(zoneId);
  } else {
    state.hiddenZoneIds.add(zoneId);
  }

  renderAllZones();
}

function getZoneSourceLabel(source) {
  if (source === "custom") {
    return "Custom zone";
  }

  if (source === "derived") {
    return "Derived remainder zone";
  }

  return "Seed service zone";
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
