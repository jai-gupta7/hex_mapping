const DEFAULT_CENTER = { lat: 28.4595, lng: 77.0266 };
const PINCODE_GEOJSON_PATH = "./data/pincodes.geojson";
const SAMPLE_GEOJSON_PATH = "./data/pincodes.sample.geojson";
const PINCODE_COLORS = ["#59c3c3", "#f4a261", "#90be6d", "#f8961e", "#43aa8b", "#577590"];
const CUSTOM_COLORS = ["#ef476f", "#9b5de5", "#f15bb5", "#fee440", "#00bbf9", "#00f5d4"];
const SERVICE_BORDER_COLOR = "#0f766e";
const GUIDE_BORDER_COLOR = "#64748b";
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
const pointClusterLayer = createPointClusterLayer().addTo(map);
map.addControl(
  new L.Control.Draw({
    edit: {
      featureGroup: drawLayer,
      edit: true,
      remove: false,
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
  mapView: document.getElementById("map-view"),
  resolution: document.getElementById("resolution"),
  pincodeCount: document.getElementById("pincode-count"),
  serviceRadius: document.getElementById("service-radius"),
  latInput: document.getElementById("lat-input"),
  lngInput: document.getElementById("lng-input"),
  zoneCount: document.getElementById("zone-count"),
  pointCount: document.getElementById("point-count"),
  showConstraints: document.getElementById("show-constraints"),
  buildZonesButton: document.getElementById("build-zones-btn"),
  generateZonesButton: document.getElementById("generate-zones-btn"),
  generatePointsButton: document.getElementById("generate-points-btn"),
  exportZonesButton: document.getElementById("export-zones-btn"),
  resetButton: document.getElementById("reset-btn"),
  datasetName: document.getElementById("dataset-name"),
  mapViewLabel: document.getElementById("map-view-label"),
  radiusLabel: document.getElementById("radius-label"),
  selectedPins: document.getElementById("selected-pins"),
  parentCellCount: document.getElementById("parent-cell-count"),
  customZoneCount: document.getElementById("custom-zone-count"),
  mappedPointCount: document.getElementById("mapped-point-count"),
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
  selectedLabel: null,
  activeZoneId: null,
  servicePoints: [],
  constraintCells: [],
  serviceAreaFeature: null,
  hiddenZoneIds: new Set(),
  constraintsVisible: true,
  datasetName: "Loading...",
  radiusKm: 5,
  isDrawing: false,
  isEditing: false,
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

function createPointClusterLayer() {
  if (typeof L.markerClusterGroup !== "function") {
    return L.layerGroup();
  }

  return L.markerClusterGroup({
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    removeOutsideVisibleBounds: true,
    maxClusterRadius: 42,
    iconCreateFunction(cluster) {
      const count = cluster.getChildCount();
      const sizeClass =
        count >= 100
          ? "service-point-cluster service-point-cluster--large"
          : count >= 30
            ? "service-point-cluster service-point-cluster--medium"
            : "service-point-cluster";
      const diameter = count >= 100 ? 74 : count >= 30 ? 62 : 50;

      return L.divIcon({
        html: `<div><span>${count}</span></div>`,
        className: `marker-cluster ${sizeClass}`,
        iconSize: L.point(diameter, diameter),
      });
    },
  });
}

async function bootstrap() {
  syncCenterInputs();
  wireEvents();
  drawCenterMarker();

  if (!window.h3 || !window.turf || !L.Control.Draw || !L.markerClusterGroup) {
    showStatus("Required map libraries failed to load. Refresh the page and check your network access.");
    controls.buildZonesButton.disabled = true;
    controls.generatePointsButton.disabled = true;
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
  controls.showConstraints.addEventListener("change", () => {
    state.constraintsVisible = controls.showConstraints.checked;
    renderAllZones();
  });
  controls.generateZonesButton.addEventListener("click", generateRandomZones);
  controls.generatePointsButton.addEventListener("click", generateServicePoints);
  controls.exportZonesButton.addEventListener("click", exportZoneJson);

  controls.resetButton.addEventListener("click", async () => {
    state.center = { ...DEFAULT_CENTER };
    state.customZoneSequence = 0;
    state.selectedCell = null;
    state.hiddenZoneIds = new Set();
    state.constraintsVisible = true;
    controls.showConstraints.checked = true;
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

  map.on(L.Draw.Event.EDITSTART, () => {
    state.isDrawing = true;
    state.isEditing = true;
    window.setTimeout(syncEditHandleVisibility, 0);
  });

  map.on(L.Draw.Event.EDITSTOP, () => {
    state.isDrawing = false;
    state.isEditing = false;
    showAllEditHandles();
  });

  map.on(L.Draw.Event.CREATED, (event) => {
    handleDrawnPolygon(event.layer);
  });

  map.on(L.Draw.Event.EDITED, (event) => {
    handleEditedZoneLayers(event.layers);
  });

  map.on("zoomend", () => {
    if (state.isEditing) {
      syncEditHandleVisibility();
    }
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
  state.selectedLabel = null;
  state.activeZoneId = null;
  state.servicePoints = [];
  state.constraintCells = [];
  state.serviceAreaFeature = null;
  state.hiddenZoneIds = new Set();
  state.customZoneSequence = 0;
  drawLayer.clearLayers();
  pointClusterLayer.clearLayers();
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
  state.selectedLabel = null;
  state.activeZoneId = null;
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

function generateServicePoints() {
  if (!state.parentCells.size) {
    showStatus("Build the serviceability area before mapping points.");
    return;
  }

  const pointCount = getPointCount();
  const parentCells = Array.from(state.parentCells);
  state.servicePoints = Array.from({ length: pointCount }, (_entry, index) => {
    const cell = parentCells[Math.floor(Math.random() * parentCells.length)];
    const point = randomPointInCell(cell);

    return {
      id: `service-point-${Date.now()}-${index + 1}`,
      lat: point.lat,
      lng: point.lng,
      cell,
    };
  });

  renderServicePoints();
  updateStats();
  showStatus(`Mapped ${pointCount} service points across the current serviceability area.`, "success");
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
    const selectedCells = featureToContainedCells(feature, resolution);
    const parentSelectedCells = selectedCells.filter((cell) => state.parentCells.has(cell));
    const outsideCells = featureToIntersectingCells(feature, resolution).filter((cell) => !state.parentCells.has(cell));
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
    state.activeZoneId = zoneId;
    state.selectedLabel = `Focused: Custom Zone ${state.customZoneSequence}`;
    renderAllZones();
    showStatus(
      `Created ${parentSelectedCells.length} H3-cell custom zone and rebuilt ${affectedZoneIds.size} affected zone(s).`,
      "success"
    );
  } catch (error) {
    showStatus(`Unable to create custom zone: ${error.message}`);
  }
}

function handleEditedZoneLayers(layers) {
  const snapshot = cloneZoneState();
  const editedLayersByZone = new Map();

  layers.eachLayer((layer) => {
    if (!layer.zoneId) {
      return;
    }

    if (!editedLayersByZone.has(layer.zoneId)) {
      editedLayersByZone.set(layer.zoneId, []);
    }

    editedLayersByZone.get(layer.zoneId).push(layer);
  });

  try {
    editedLayersByZone.forEach((zoneLayers, zoneId) => {
      const feature = buildEditedFeature(zoneLayers);
      applyEditedZoneBoundary(zoneId, feature);
    });

    renderAllZones();
    showStatus("Updated zone boundaries and reassigned covered cells.", "success");
  } catch (error) {
    restoreZoneState(snapshot);
    renderAllZones();
    showStatus(`Unable to update zone boundary: ${error.message}`);
  }
}

function applyEditedZoneBoundary(zoneId, feature) {
  const zone = state.workingZones.find((item) => item.id === zoneId);
  if (!zone) {
    throw new Error("The edited zone could not be found.");
  }

  const resolution = getResolution();
  const desiredCells = featureToContainedCells(feature, resolution).filter((cell) => state.parentCells.has(cell));
  const outsideCells = featureToIntersectingCells(feature, resolution).filter((cell) => !state.parentCells.has(cell));

  if (!desiredCells.length) {
    throw new Error(`Zone ${zone.label} must still cover at least one H3 cell.`);
  }

  if (outsideCells.length) {
    throw new Error(`Zone ${zone.label} extends outside the serviceability area.`);
  }

  if (getConnectedCellComponents(desiredCells).length > 1) {
    throw new Error(`Zone ${zone.label} must remain one connected area.`);
  }

  const ownerByCell = getCellOwnerMap();
  const affectedZoneIds = new Set(
    [...desiredCells, ...zone.cells].map((cell) => ownerByCell.get(cell)).filter(Boolean)
  );
  affectedZoneIds.add(zoneId);

  const affectedZones = state.workingZones.filter((item) => affectedZoneIds.has(item.id));
  const affectedScope = uniqueValues([
    ...desiredCells,
    ...affectedZones.flatMap((item) => item.cells),
  ]);
  const desiredCellSet = new Set(desiredCells);
  const reassignedZones = repartitionEditedZone(affectedZones, zoneId, desiredCellSet, affectedScope, feature);
  const reassignedIds = new Set(reassignedZones.map((item) => item.id));

  state.workingZones = [
    ...state.workingZones.filter((item) => !affectedZoneIds.has(item.id)),
    ...reassignedZones,
  ];
  state.customZones = state.workingZones.filter((item) => item.source === "custom");
  state.hiddenZoneIds = new Set([...state.hiddenZoneIds].filter((item) => reassignedIds.has(item) || state.workingZones.some((zoneItem) => zoneItem.id === item)));
}

function repartitionEditedZone(affectedZones, editedZoneId, desiredCellSet, scopeCells, boundaryFeature) {
  const initialAssignments = new Map();
  const editedZone = affectedZones.find((zone) => zone.id === editedZoneId);

  affectedZones.forEach((zone) => {
    if (zone.id === editedZoneId) {
      initialAssignments.set(zone.id, new Set(desiredCellSet));
      return;
    }

    initialAssignments.set(
      zone.id,
      new Set(zone.cells.filter((cell) => !desiredCellSet.has(cell)))
    );
  });

  const assignedCells = new Set(
    [...initialAssignments.values()].flatMap((cellSet) => [...cellSet])
  );
  const poolCells = scopeCells.filter((cell) => !assignedCells.has(cell));

  assignPoolCellsToNeighborZones(poolCells, initialAssignments, editedZoneId);

  const nextZones = [];

  affectedZones.forEach((zone) => {
    const assignedSet = initialAssignments.get(zone.id) || new Set();
    const assignedCellsForZone = [...assignedSet];

    if (!assignedCellsForZone.length) {
      return;
    }

    const components = getConnectedCellComponents(assignedCellsForZone);

    components.forEach((component, componentIndex) => {
      const isPrimaryComponent = componentIndex === 0;
      const isEditedZone = zone.id === editedZoneId;

      nextZones.push({
        ...zone,
        id: isPrimaryComponent ? zone.id : `${zone.id}-derived-${Date.now()}-${componentIndex}`,
        label:
          isPrimaryComponent || isEditedZone
            ? zone.label
            : buildDerivedZoneLabel(zone.label, components.length, componentIndex),
        source: isPrimaryComponent ? zone.source : "derived",
        boundaryFeature: isEditedZone && isPrimaryComponent ? boundaryFeature : undefined,
        cells: component,
      });
    });
  });

  if (!nextZones.some((zone) => zone.id === editedZoneId) && editedZone) {
    nextZones.push({
      ...editedZone,
      cells: [...desiredCellSet],
      boundaryFeature,
    });
  }

  return nextZones;
}

function assignPoolCellsToNeighborZones(poolCells, assignments, editedZoneId) {
  if (!poolCells.length) {
    return;
  }

  const poolSet = new Set(poolCells);
  const queue = [];
  const ownerByCell = new Map();

  assignments.forEach((cellSet, zoneId) => {
    if (zoneId === editedZoneId) {
      return;
    }

    cellSet.forEach((cell) => {
      ownerByCell.set(cell, zoneId);
      queue.push(cell);
    });
  });

  while (queue.length) {
    const cell = queue.shift();
    const zoneId = ownerByCell.get(cell);

    getAdjacentCells(cell, new Set([...poolSet, ...ownerByCell.keys()])).forEach((neighbor) => {
      if (!poolSet.has(neighbor) || ownerByCell.has(neighbor)) {
        return;
      }

      ownerByCell.set(neighbor, zoneId);
      assignments.get(zoneId)?.add(neighbor);
      queue.push(neighbor);
    });
  }

  poolCells.forEach((cell) => {
    if (!poolSet.has(cell)) {
      return;
    }

    if (ownerByCell.has(cell)) {
      poolSet.delete(cell);
      return;
    }

    const recipientId =
      [...assignments.entries()]
        .filter(([zoneId]) => zoneId !== editedZoneId)
        .sort((left, right) => right[1].size - left[1].size)[0]?.[0] || editedZoneId;

    assignments.get(recipientId)?.add(cell);
    ownerByCell.set(cell, recipientId);
    poolSet.delete(cell);
  });
}

function buildEditedFeature(zoneLayers) {
  const features = zoneLayers.map((layer) => layer.toGeoJSON());

  if (features.length === 1) {
    return features[0];
  }

  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "MultiPolygon",
      coordinates: features.map((feature) => {
        if (feature.geometry.type === "Polygon") {
          return feature.geometry.coordinates;
        }

        return feature.geometry.coordinates[0];
      }),
    },
  };
}

function cloneZoneState() {
  return {
    workingZones: state.workingZones.map((zone) => ({
      ...zone,
      cells: [...zone.cells],
      parentPincodes: [...(zone.parentPincodes || [])],
      boundaryFeature: zone.boundaryFeature ? structuredClone(zone.boundaryFeature) : undefined,
    })),
    customZones: state.customZones.map((zone) => ({
      ...zone,
      cells: [...zone.cells],
      parentPincodes: [...(zone.parentPincodes || [])],
      boundaryFeature: zone.boundaryFeature ? structuredClone(zone.boundaryFeature) : undefined,
    })),
    hiddenZoneIds: new Set(state.hiddenZoneIds),
    selectedCell: state.selectedCell,
  };
}

function restoreZoneState(snapshot) {
  state.workingZones = snapshot.workingZones;
  state.customZones = snapshot.customZones;
  state.hiddenZoneIds = snapshot.hiddenZoneIds;
  state.selectedCell = snapshot.selectedCell;
}

function renderAllZones(shouldFitBounds = false) {
  ensureActiveZoneIsValid();
  drawLayer.clearLayers();
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
    renderServicePoints();
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
  renderServicePoints();

  updateStats();

  if (shouldFitBounds && bounds.length) {
    map.fitBounds(bounds, { padding: [28, 28] });
  }
}

function ensureActiveZoneIsValid() {
  if (state.activeZoneId && !state.workingZones.some((zone) => zone.id === state.activeZoneId)) {
    state.activeZoneId = null;
  }
}

function focusZone(zoneId) {
  if (state.activeZoneId === zoneId) {
    return;
  }

  state.activeZoneId = zoneId;
  const zone = state.workingZones.find((item) => item.id === zoneId);
  state.selectedLabel = zone ? `Focused: ${zone.label}` : state.selectedLabel;
  renderAllZones();
}

function toggleZoneFocus(zoneId) {
  if (state.activeZoneId === zoneId) {
    state.activeZoneId = null;
    state.selectedLabel = null;
    renderAllZones();
    return;
  }

  focusZone(zoneId);
}

function getZoneVisualState(zoneId) {
  if (!state.activeZoneId) {
    return "default";
  }

  return state.activeZoneId === zoneId ? "active" : "muted";
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
          state.selectedLabel = `PIN ${zone.label}`;
          renderSelectedCell();
          updateStats();
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
      const visualState = getZoneVisualState(zone.id);
      const feature = zone.boundaryFeature || zoneCellsToFeature(zone.cells);
      if (!feature) {
        return;
      }

      const layer = L.geoJSON(feature, {
        bubblingMouseEvents: false,
        style: {
          color: zone.color,
          weight: visualState === "active" ? 4.4 : visualState === "muted" ? 2 : 3,
          opacity: visualState === "muted" ? 0.26 : 0.96,
          fillColor: zone.color,
          fillOpacity: visualState === "active" ? 0.3 : visualState === "muted" ? 0.05 : 0.18,
        },
        onEachFeature: (_feature, featureLayer) => {
          featureLayer.bindPopup(buildZonePopupMarkup(zone));
          featureLayer.on("click", () => {
            state.selectedCell = null;
            state.selectedLabel = zone.label;
            focusZone(zone.id);
          });
        },
      });

      layer.eachLayer((featureLayer) => {
        featureLayer.zoneId = zone.id;
        featureLayer.zoneLabel = zone.label;
        featureLayer.zoneColor = zone.color;
        const layerBounds = featureLayer.getBounds?.();
        if (layerBounds) {
          bounds.push(layerBounds.getNorthWest());
          bounds.push(layerBounds.getSouthEast());
        }
        drawLayer.addLayer(featureLayer);
        if (visualState === "active") {
          featureLayer.bringToFront();
        }
      });
    });

  if (state.isEditing) {
    window.setTimeout(syncEditHandleVisibility, 0);
  }
}

function renderHexZones(bounds) {
  state.workingZones.forEach((zone) => {
    if (state.hiddenZoneIds.has(zone.id)) {
      return;
    }

    const visualState = getZoneVisualState(zone.id);
    const isCustom = zone.source === "custom";
    const layer = isCustom ? customZoneLayer : baseZoneLayer;
    const baseFillOpacity = isCustom ? 0.5 : zone.source === "derived" ? 0.24 : 0.14;
    const fillOpacity =
      visualState === "active" ? Math.min(baseFillOpacity + 0.16, 0.72) : visualState === "muted" ? 0.035 : baseFillOpacity;
    const lineOpacity = visualState === "muted" ? 0.18 : 0.95;
    const lineWeight = visualState === "active" ? 1.8 : 1;
    renderCells(zone, layer, fillOpacity, lineOpacity, lineWeight, bounds);
  });
}

function renderCells(zone, layerGroup, fillOpacity, lineOpacity, lineWeight, bounds) {
  zone.cells.forEach((cell) => {
    const latLngs = h3.cellToBoundary(cell);
    latLngs.forEach((point) => bounds?.push(point));

    const polygon = L.polygon(latLngs, {
      color: zone.color,
      opacity: lineOpacity,
      weight: lineWeight,
      fillColor: zone.color,
      fillOpacity,
      bubblingMouseEvents: false,
    });

    polygon.bindPopup(buildPopupMarkup(zone.label, cell));
    polygon.on("click", () => {
      state.selectedCell = cell;
      state.selectedLabel = cell;
      focusZone(zone.id);
    });
    polygon.addTo(layerGroup);
  });
}

function renderConstraintCells(bounds, mode) {
  if (!state.constraintsVisible) {
    return;
  }

  state.constraintCells.forEach((cell) => {
    const ownerZone = getZoneForCell(cell);
    const zoneColor = ownerZone?.color || GUIDE_BORDER_COLOR;
    const isMuted = getZoneVisualState(ownerZone?.id) === "muted";

    if (mode === "boundary") {
      const [lat, lng] = h3.cellToLatLng(cell);
      const marker = L.marker([lat, lng], {
        opacity: isMuted ? 0.2 : 1,
        icon: L.divIcon({
          className: "constraint-point-icon",
          html: `<span class="constraint-point-icon__inner" style="--constraint-color: ${zoneColor};"></span>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
          popupAnchor: [0, -10],
        }),
        bubblingMouseEvents: false,
      });

      bounds?.push({ lat, lng });
      marker.bindPopup(buildConstraintPopupMarkup(cell));
      marker.on("click", () => {
        state.selectedCell = cell;
        state.selectedLabel = `${cell} (constraint)`;
        renderSelectedCell();
        updateStats();
      });
      marker.addTo(constraintLayer);
      return;
    }

    const latLngs = h3.cellToBoundary(cell);
    latLngs.forEach((point) => bounds?.push(point));

    const polygon = L.polygon(latLngs, {
      color: zoneColor,
      opacity: isMuted ? 0.18 : 0.95,
      weight: mode === "hex" ? 1.4 : 1.8,
      fillColor: zoneColor,
      fillOpacity: isMuted ? 0.03 : mode === "hex" ? 0.14 : 0.12,
      dashArray: "4 6",
      className: "constraint-cell",
      bubblingMouseEvents: false,
    });

    polygon.bindPopup(buildConstraintPopupMarkup(cell));
    polygon.on("click", () => {
      state.selectedCell = cell;
      state.selectedLabel = `${cell} (constraint)`;
      renderSelectedCell();
      updateStats();
    });
    polygon.addTo(constraintLayer);
    renderConstraintPattern(latLngs, zoneColor, isMuted ? 0.22 : 0.95);
  });
}

function renderServicePoints() {
  pointClusterLayer.clearLayers();

  state.servicePoints.forEach((point, index) => {
    const ownerZone = getZoneForCell(point.cell);
    const isMuted = getZoneVisualState(ownerZone?.id) === "muted";
    const marker = L.marker([point.lat, point.lng], {
      bubblingMouseEvents: false,
      opacity: isMuted ? 0.22 : 1,
      icon: L.divIcon({
        className: "service-point-icon",
        html: '<span class="service-point-icon__inner"></span>',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
        popupAnchor: [0, -8],
      }),
    });

    marker.bindPopup(buildServicePointPopupMarkup(point, index + 1));
    marker.on("click", () => {
      state.selectedCell = null;
      state.selectedLabel = `Service point ${index + 1}`;
      renderSelectedCell();
      updateStats();
    });
    pointClusterLayer.addLayer(marker);
  });
}

function renderConstraintPattern(latLngs, zoneColor, lineOpacity = 0.95) {
  if (latLngs.length < 4) {
    return;
  }

  const points = latLngs.map((point) => map.latLngToLayerPoint(point));
  const bbox = points.reduce(
    (acc, point) => ({
      minX: Math.min(acc.minX, point.x),
      maxX: Math.max(acc.maxX, point.x),
      minY: Math.min(acc.minY, point.y),
      maxY: Math.max(acc.maxY, point.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    }
  );

  const diagonalSpan = (bbox.maxX - bbox.minX) + (bbox.maxY - bbox.minY);
  const stripeCount = 10;
  const stripeSpacing = Math.max(3, diagonalSpan / stripeCount);
  const padding = stripeSpacing * 2;
  const cMin = bbox.minX + bbox.minY - padding;
  const cMax = bbox.maxX + bbox.maxY + padding;

  for (let c = cMin; c <= cMax; c += stripeSpacing) {
    const intersections = [];

    for (let index = 0; index < points.length; index += 1) {
      const start = points[index];
      const end = points[(index + 1) % points.length];
      const deltaX = end.x - start.x;
      const deltaY = end.y - start.y;
      const denominator = deltaX + deltaY;

      if (Math.abs(denominator) < 0.0001) {
        continue;
      }

      const t = (c - start.x - start.y) / denominator;
      if (t < 0 || t > 1) {
        continue;
      }

      intersections.push(L.point(start.x + t * deltaX, start.y + t * deltaY));
    }

    const uniqueIntersections = intersections.reduce((result, point) => {
      const exists = result.some(
        (entry) => Math.abs(entry.x - point.x) < 0.5 && Math.abs(entry.y - point.y) < 0.5
      );

      if (!exists) {
        result.push(point);
      }

      return result;
    }, []);

    if (uniqueIntersections.length < 2) {
      continue;
    }

    uniqueIntersections.sort((left, right) => left.x - right.x || left.y - right.y);

    const startLatLng = map.layerPointToLatLng(uniqueIntersections[0]);
    const endLatLng = map.layerPointToLatLng(uniqueIntersections[uniqueIntersections.length - 1]);

    L.polyline([startLatLng, endLatLng], {
      color: zoneColor,
      weight: 1.25,
      opacity: lineOpacity,
      interactive: false,
      bubblingMouseEvents: false,
    }).addTo(constraintLayer);
  }
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

function syncEditHandleVisibility() {
  const vertexStep = getEditVertexStep();
  const showMidpoints = map.getZoom() >= 15;

  drawLayer.eachLayer((layer) => {
    const handlers = layer.editing?._verticesHandlers || [];

    handlers.forEach((handler) => {
      const markers = handler._markers || [];
      markers.forEach((marker, index) => {
        const shouldShowVertex = vertexStep === 1 || index % vertexStep === 0;
        setEditMarkerVisibility(marker, shouldShowVertex);
        setEditMarkerVisibility(marker._middleLeft, showMidpoints && shouldShowVertex);
        setEditMarkerVisibility(marker._middleRight, showMidpoints && shouldShowVertex);
      });
    });
  });
}

function showAllEditHandles() {
  drawLayer.eachLayer((layer) => {
    const handlers = layer.editing?._verticesHandlers || [];

    handlers.forEach((handler) => {
      const markers = handler._markers || [];
      markers.forEach((marker) => {
        setEditMarkerVisibility(marker, true);
        setEditMarkerVisibility(marker._middleLeft, true);
        setEditMarkerVisibility(marker._middleRight, true);
      });
    });
  });
}

function setEditMarkerVisibility(marker, isVisible) {
  if (!marker) {
    return;
  }

  const element = marker.getElement?.() || marker._icon;
  marker.setOpacity?.(isVisible ? 1 : 0);

  if (element) {
    element.style.display = isVisible ? "" : "none";
    element.style.pointerEvents = isVisible ? "auto" : "none";
  }

  if (marker.dragging) {
    if (isVisible) {
      marker.dragging.enable();
    } else {
      marker.dragging.disable();
    }
  }
}

function getEditVertexStep() {
  const zoom = map.getZoom();

  if (zoom >= 16) {
    return 1;
  }

  if (zoom >= 15) {
    return 2;
  }

  if (zoom >= 14) {
    return 3;
  }

  if (zoom >= 13) {
    return 4;
  }

  return 6;
}

function featureToContainedCells(feature, resolution) {
  const candidates = candidateCellsFromBbox(feature, resolution);

  return candidates.filter((cell) => {
    const [lat, lng] = h3.cellToLatLng(cell);
    return turf.booleanPointInPolygon(turf.point([lng, lat]), feature);
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

function getZoneColorForCell(cell) {
  return getZoneForCell(cell)?.color || GUIDE_BORDER_COLOR;
}

function getZoneForCell(cell) {
  const ownerByCell = getCellOwnerMap();
  const ownerId = ownerByCell.get(cell);
  return state.workingZones.find((item) => item.id === ownerId) || null;
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
  ensureActiveZoneIsValid();
  controls.datasetName.textContent = state.datasetName;
  controls.mapViewLabel.textContent = getMapViewLabel();
  controls.radiusLabel.textContent = state.radiusKm ? `${state.radiusKm} km` : "-";
  controls.selectedPins.textContent = state.selectedPinCodes.length ? state.selectedPinCodes.join(", ") : "-";
  controls.parentCellCount.textContent = state.parentCells.size ? String(state.parentCells.size) : "-";
  controls.customZoneCount.textContent = String(state.customZones.length);
  controls.mappedPointCount.textContent = String(state.servicePoints.length);
  controls.constraintCellCount.textContent = String(state.constraintCells.length);
  controls.selectedCell.textContent = state.selectedLabel || state.selectedCell || "Click a zone or cell";
  controls.zoneList.innerHTML = "";

  state.workingZones.forEach((zone) => {
    appendZoneListItem(zone);
  });
}

function appendZoneListItem(zone) {
  const row = document.createElement("p");
  row.className = "zone-chip";
  const isHidden = state.hiddenZoneIds.has(zone.id);
  const isActive = state.activeZoneId === zone.id;
  row.style.setProperty("--zone-color", zone.color);
  row.classList.toggle("is-hidden", isHidden);
  row.classList.toggle("is-active", isActive);

  const label = document.createElement("span");
  label.textContent = `${zone.label} (${getZoneSourceLabel(zone.source)})`;
  label.className = "zone-chip-label";
  label.addEventListener("click", () => {
    state.selectedCell = null;
    state.selectedLabel = zone.label;
    toggleZoneFocus(zone.id);
  });

  const cells = document.createElement("span");
  cells.textContent = `${zone.cells.length} cells`;

  const actions = document.createElement("span");
  actions.className = "zone-chip-actions";

  const focusButton = document.createElement("button");
  focusButton.type = "button";
  focusButton.className = `zone-chip-button${isActive ? " is-active" : ""}`;
  focusButton.textContent = isActive ? "Focused" : "Focus";
  focusButton.addEventListener("click", () => {
    state.selectedCell = null;
    state.selectedLabel = zone.label;
    toggleZoneFocus(zone.id);
  });

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
  actions.append(focusButton, toggleWrap);
  row.append(label, cells, actions);
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
    servicePoints: state.servicePoints,
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

function buildServicePointPopupMarkup(point, index) {
  const zone = getZoneForCell(point.cell);
  return `
    <div class="hex-popup">
      <strong>Service Point ${index}</strong>
      <span>${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}</span>
      <span>Zone: ${zone?.label || "Unassigned"}</span>
      <span>Cell: ${point.cell}</span>
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

function getPointCount() {
  const pointCount = Number(controls.pointCount.value);
  if (!Number.isInteger(pointCount) || pointCount < 1) {
    return 1;
  }

  return Math.min(pointCount, 5000);
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

function randomPointInCell(cell) {
  const cellFeature = cellToGeoJsonFeature(cell);
  const [minLng, minLat, maxLng, maxLat] = turf.bbox(cellFeature);

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const lng = minLng + Math.random() * (maxLng - minLng);
    const lat = minLat + Math.random() * (maxLat - minLat);
    if (turf.booleanPointInPolygon(turf.point([lng, lat]), cellFeature)) {
      return { lat, lng };
    }
  }

  const [lat, lng] = h3.cellToLatLng(cell);
  return { lat, lng };
}

function setZoneVisibility(zoneId, isVisible) {
  if (isVisible) {
    state.hiddenZoneIds.delete(zoneId);
  } else {
    state.hiddenZoneIds.add(zoneId);
    if (state.activeZoneId === zoneId) {
      state.activeZoneId = null;
      state.selectedLabel = null;
    }
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
