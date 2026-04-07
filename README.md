# H3 PIN Code Hex Mapping Tester

A standalone browser app for testing PIN-code zone planning with Uber H3 hexagons.

## Features

- Select PIN-code boundaries that intersect a rough branch radius around the center point
- Cap the number of selected PIN codes for performance in dense areas
- Convert selected PIN-code polygons to H3 cells at resolution 8 or 9
- Draw temporary custom zones with Leaflet Draw
- Reject custom zones outside the parent PIN-code coverage
- Reject isolated/doughnut-like custom zones that do not share an allowed boundary
- Inspect cell ids and approximate cell area

## PIN Code Boundary Data

The app looks for real boundary data at:

```text
data/pincodes.geojson
```

If that file is missing, it falls back to:

```text
data/pincodes.sample.geojson
```

The sample file is only for testing the UI and geometry workflow. Replace it with a real GeoJSON `FeatureCollection` where each feature is a `Polygon` or `MultiPolygon` and has a property such as `pincode`, `PINCODE`, `postal_code`, or `name`.

Potential sources to review:

- data.gov.in `All India Pincode Boundary Geo JSON`, published by the Department of Posts.
- Datameet `PincodeBoundary`, which stores city PIN-code boundary data in GeoJSON format.
- `sanand0/pincode-shapes`, which documents an estimated PIN-code boundary workflow and downloadable GeoJSON files.
- OpenStreetMap postal-code boundaries where `boundary=postal_code` and `postal_code=*` are mapped, but OSM coverage can vary by region.

## Run Locally

Use:

```powershell
.\start-h3-tester.cmd
```

Then open:

`http://localhost:8090/`
