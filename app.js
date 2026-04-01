const DEFAULT_CENTER = { lat: 28.4595, lng: 77.0266 };
const DEFAULT_RESOLUTION = 8;
const DEFAULT_RING_SIZE = 3;

const map = L.map("map", {
  zoomControl: true,
  preferCanvas: true,
}).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 11);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const controls = {
  resolution: document.getElementById("resolution"),
  resolutionValue: document.getElementById("resolution-value"),
  ringSize: document.getElementById("ring-size"),
  ringSizeValue: document.getElementById("ring-size-value"),
  latInput: document.getElementById("lat-input"),
  lngInput: document.getElementById("lng-input"),
  recenterButton: document.getElementById("recenter-btn"),
  resetButton: document.getElementById("reset-btn"),
  centerCell: document.getElementById("center-cell"),
  hexCount: document.getElementById("hex-count"),
  selectedCell: document.getElementById("selected-cell"),
  statusMessage: document.getElementById("status-message"),
};

let currentCenter = { ...DEFAULT_CENTER };
let centerMarker = null;
let hexLayer = L.layerGroup().addTo(map);

bootstrap();

function bootstrap() {
  syncControls();
  wireEvents();

  if (!window.h3) {
    showStatus("H3 failed to load. Refresh the page once. If it still fails, the H3 CDN request is being blocked.");
    return;
  }

  drawHexagons();
}

function wireEvents() {
  controls.resolution.addEventListener("input", () => {
    controls.resolutionValue.textContent = controls.resolution.value;
    drawHexagons();
  });

  controls.ringSize.addEventListener("input", () => {
    controls.ringSizeValue.textContent = controls.ringSize.value;
    drawHexagons();
  });

  controls.recenterButton.addEventListener("click", () => {
    const nextCenter = readCenterInputs();
    if (!nextCenter) {
      return;
    }

    updateCenter(nextCenter, true);
  });

  controls.resetButton.addEventListener("click", () => {
    controls.resolution.value = String(DEFAULT_RESOLUTION);
    controls.ringSize.value = String(DEFAULT_RING_SIZE);
    controls.resolutionValue.textContent = String(DEFAULT_RESOLUTION);
    controls.ringSizeValue.textContent = String(DEFAULT_RING_SIZE);
    updateCenter(DEFAULT_CENTER, true);
  });

  map.on("click", (event) => {
    const nextCenter = {
      lat: roundCoordinate(event.latlng.lat),
      lng: roundCoordinate(event.latlng.lng),
    };

    updateCenter(nextCenter, false);
  });
}

function readCenterInputs() {
  const lat = Number(controls.latInput.value);
  const lng = Number(controls.lngInput.value);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    window.alert("Enter valid latitude and longitude values.");
    return null;
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    window.alert("Latitude must be between -90 and 90, and longitude between -180 and 180.");
    return null;
  }

  return {
    lat: roundCoordinate(lat),
    lng: roundCoordinate(lng),
  };
}

function updateCenter(nextCenter, shouldPanMap) {
  currentCenter = nextCenter;
  syncControls();

  if (shouldPanMap) {
    map.setView([currentCenter.lat, currentCenter.lng], map.getZoom(), { animate: true });
  }

  drawHexagons();
}

function syncControls() {
  controls.latInput.value = String(currentCenter.lat);
  controls.lngInput.value = String(currentCenter.lng);
  controls.resolutionValue.textContent = controls.resolution.value;
  controls.ringSizeValue.textContent = controls.ringSize.value;
}

function drawHexagons() {
  try {
    hideStatus();

    const resolution = Number(controls.resolution.value);
    const ringSize = Number(controls.ringSize.value);
    const centerCell = h3.latLngToCell(currentCenter.lat, currentCenter.lng, resolution);
    const hexagons = h3.gridDisk(centerCell, ringSize);

    hexLayer.clearLayers();

    if (centerMarker) {
      centerMarker.remove();
    }

    centerMarker = L.circleMarker([currentCenter.lat, currentCenter.lng], {
      radius: 7,
      color: "#ffffff",
      weight: 2,
      fillColor: "#ef476f",
      fillOpacity: 1,
    })
      .bindTooltip("Center point", { direction: "top", offset: [0, -8] })
      .addTo(map);

    const bounds = [];

    hexagons.forEach((cell) => {
      const boundary = h3.cellToBoundary(cell);
      const latLngs = boundary.map(([lat, lng]) => [lat, lng]);

      latLngs.forEach((point) => bounds.push(point));

      const isCenterCell = cell === centerCell;
      const polygon = L.polygon(latLngs, {
        color: isCenterCell ? "#0f172a" : "#227c9d",
        weight: isCenterCell ? 2.5 : 1.5,
        fillColor: isCenterCell ? "#59c3c3" : "#7bdff2",
        fillOpacity: isCenterCell ? 0.5 : 0.22,
      });

      polygon.bindPopup(buildPopupMarkup(cell, resolution));
      polygon.on("click", () => {
        controls.selectedCell.textContent = cell;
      });
      polygon.addTo(hexLayer);
    });

    controls.centerCell.textContent = centerCell;
    controls.hexCount.textContent = String(hexagons.length);

    if (bounds.length) {
      map.fitBounds(bounds, { padding: [24, 24] });
    }
  } catch (error) {
    showStatus(`Unable to render H3 grid: ${error.message}`);
  }
}

function buildPopupMarkup(cell, resolution) {
  return `
    <div class="hex-popup">
      <strong>${cell}</strong>
      <span>Resolution: ${resolution}</span>
      <span>Area: ${h3.cellArea(cell, h3.UNITS.km2).toFixed(3)} km²</span>
    </div>
  `;
}

function roundCoordinate(value) {
  return Number(value.toFixed(4));
}

function showStatus(message) {
  controls.statusMessage.hidden = false;
  controls.statusMessage.textContent = message;
}

function hideStatus() {
  controls.statusMessage.hidden = true;
  controls.statusMessage.textContent = "";
}
