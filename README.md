# Overhaul · Lunar Landing Site Navigator

Interface for querying and comparing Sun and Earth elevation at lunar coordinates and selected time periods. Data is provided by the configured Overhaul API; the frontend does not call external scientific data sources directly.

## Development

1. Install Python 3.10 or later.
2. Run the backend setup script in PowerShell:

   ```powershell
   .\backend\run.ps1
   ```

   On its first run, the script creates the Python environment, installs `spiceypy`, and downloads official NAIF/JPL kernels (approximately 44 MB). These files are stored in `backend/kernels/` and are not tracked by Git. The backend continues running in that terminal.

3. In another terminal, copy `.env.example` to `.env.local` and run `npm run dev`.

If you prefer manual setup, use the following commands:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
backend/.venv/Scripts/python.exe backend/download_kernels.py
backend/.venv/Scripts/python.exe backend/server.py
```

Without a configured backend, the interface displays the configuration state and does not present fabricated scientific results. The comparison module allows you to save up to three combinations of coordinates, local date/time, duration, and sampling interval. Each scenario is queried sequentially through the local SPICE API.

## Security

The backend is a local development service without authentication. It refuses to bind to addresses outside loopback, restricts allowed origins, requires an authorized origin for analysis requests, limits parameters and concurrent queries, adds security headers, and validates kernels using SHA-256.

Logs record the route and HTTP status without recording query coordinates or timestamps. Do not expose this service directly to a network or the internet. Remote deployment requires authentication, TLS, and a hardened production server.

In the frontend, remote data is rendered by React without `innerHTML`. External links use `rel="noreferrer"`, and WMTS templates must remain on HTTPS when hosted at `trek.nasa.gov`.

Naming conventions follow the conventions of each layer: React components use `PascalCase`, TypeScript variables and functions use `camelCase`, CSS classes use `kebab-case`, and scientific contract fields use `snake_case`. Generic states (`selected`, `loading`, `error`) are scoped under their corresponding component selectors.

When an analysis is loaded, the timeline synchronizes the chart, sky position, and indicators for the next sunset and loss of Earth visibility.

The horizontal solar incidence indicator is only `sin(solar elevation)` converted into a percentage. It does not estimate electrical power, panel orientation, terrain shadows, or equipment conditions.

If observations include a local horizon, availability calculations account for that obstruction. Without this field, the interface uses and identifies the geometric horizon at 0°. Horizon crossing times are interpolated between observations and therefore depend on the sampling interval returned by the backend.

The local backend uses `spiceypy` with the NAIF/JPL kernels `DE440s`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf`, and `naif0012.tls`. It makes no network requests during analysis and does not query Horizons.

The `MOON_ME` frame aligns input coordinates with the lunar mean-Earth reference frame used for selenographic coordinates, using high-precision DE440 orientation data.

The reference model is a spherical Moon with a radius of 1,737.4 km. For an elevated observer, the backend calculates the geometric horizon dip. The DE440s kernel covers approximately 1850–2149; periods outside this coverage are rejected.

## Frontend API Contract

### `GET /api/analysis`

Query parameters:

| Parameter | Type | Example |
| --- | --- | --- |
| `latitude` | degrees, number | `-89.5` |
| `longitude` | degrees, number | `0` |
| `altitude_m` | meters, number | `0` |
| `start` | ISO 8601 UTC date/time | `2026-12-01T00:00:00.000Z` |
| `end` | ISO 8601 UTC date/time | `2026-12-02T00:00:00.000Z` |
| `step` | SPICE sampling interval | `1h` |

The local endpoint transforms each SPICE position into topocentric azimuth and elevation as seen from a fixed point on the lunar surface. It uses a reference lunar sphere with a radius of 1,737.4 km, the specified altitude in meters, and the `CN+S` light-time and stellar aberration correction. Reported elevation is geometric and does not include atmospheric refraction.

Successful response (`application/json`):

```json
{
  "site": {
    "id": "custom",
    "name": "Custom location",
    "latitude": -89.5,
    "longitude": 0,
    "altitude_m": 0
  },
  "interval": {
    "start": "2026-12-01T00:00:00Z",
    "end": "2026-12-02T00:00:00Z",
    "step": "1h"
  },
  "observations": [
    {
      "time": "2026-12-01T00:00:00Z",
      "sun": { "azimuth_deg": 120, "elevation_deg": 8.5, "above_local_horizon": true },
      "earth": { "azimuth_deg": 45, "elevation_deg": 12, "above_local_horizon": true },
      "geometric_horizon_elevation_deg": 0
    }
  ],
  "summary": {
    "sunlight_hours": 8,
    "earth_visibility_hours": 12,
    "terrain_adjusted": false
  }
}
```

`summary` and `terrain` are optional.

This backend returns `terrain_adjusted: false` and does not include `terrain`. It calculates the geometric horizon of the sphere and the angular horizon dip for the specified altitude, but it does not derive local obstructions caused by craters.

Time windows, expressed in hours, interpolate horizon crossings between samples. The endpoint limits the analysis duration to 72 hours and supports sampling intervals of `30m`, `1h`, `2h`, or `4h`.

Errors are returned with the appropriate HTTP status code and the following structure:

```json
{ "error": "message" }
```

## Terrain Data Integrations

The `src/components/MoonTerrainExplorer.tsx` component queries the NASA Moon Trek WMTS catalog, reads the published template and tile matrices, and calculates the polar tile for the coordinates entered in the form, displaying a marker at the selected location.

Refer to the [Moon Trek WMTS documentation](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon) for available layers, projections, and tile matrices.

Celestial positions are provided by the local Overhaul endpoint `GET /api/analysis`.

The service listens only on `127.0.0.1:8000`, allows Vite local origins by default, and provides `GET /health` to verify dependencies and kernels.

Configure `OVERHAUL_API_PORT` and `OVERHAUL_CORS_ORIGINS` when necessary. Remote binding is blocked because this API does not have authentication.

The analysis route requires an authorized CORS origin, limits query size and fields, and restricts concurrent analyses. Kernels are verified using SHA-256 before being loaded.

QuickMap remains an independent cartographic source. The SPICE backend does not query LOLA products or apply topographic obstruction corrections.

Kernels are distributed by [NAIF/JPL](https://naif.jpl.nasa.gov/naif/data_generic.html). See also the [SPICE documentation for observers at surface points](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/spkcpo_c.html).

## Scripts

- `npm run dev` — Vite development server
- `npm run build` — TypeScript compilation and production build
- `npm run lint` — project linting
