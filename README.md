# GreenOps

GreenOps is a local-development MVP for reviewing cloud workload utilization,
estimating cost and carbon from caller-supplied assumptions, and returning
rule-based recommendations. It contains a React/TypeScript/Vite frontend and a
Python FastAPI backend with MongoDB resource-record storage.

## Prerequisites

- Windows PowerShell
- Python 3.11 or later
- Node.js (Vite 8 requires Node.js 20.19+ or 22.12+)
- npm
- A MongoDB instance reachable at the configured URI for resource create/list
  and CSV persistence

The health endpoint does not verify MongoDB connectivity. Analytics,
estimation, and recommendation endpoints operate on request data and do not
require resource persistence.

## Configuration

The root `.env.example` documents backend settings. Copy it locally and edit
only values needed for your environment:

```powershell
Copy-Item .env.example .env
```

| Variable | Default | Meaning |
|---|---|---|
| `MONGODB_URI` | `mongodb://localhost:27017` | MongoDB connection URI. Keep credentials in local `.env`, never in source control. |
| `MONGODB_DB_NAME` | `greenops` | Database name. |
| `APP_ENV` | `development` | Application environment label; it does not enable authentication or production hardening. |
| `LOG_LEVEL` | `info` | Uvicorn log level. |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated allowed frontend origins. Wildcard origins are rejected. |
| `UNDERUTIL_CPU_THRESHOLD_PCT` | `20.0` | Configurable CPU percentage threshold for the analytics underutilization rule (0–100). |
| `UNDERUTIL_MEM_THRESHOLD_PCT` | `20.0` | Configurable memory percentage threshold (0–100). |

The frontend's `frontend/.env.example` sets
`VITE_API_BASE_URL=http://127.0.0.1:8000`. Optionally copy it to
`frontend/.env.local` and adjust the base URL:

```powershell
Copy-Item frontend\.env.example frontend\.env.local
```

No real credentials are included in the examples. Root `.gitignore` excludes
`.env` and `.env.*`, while retaining `.env.example`.

## Install and run

Run backend commands from the project root. In a fresh PowerShell window:

```powershell
Set-Location C:\path\to\GreenOps
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python -m uvicorn backend.main:app --reload
```

If MongoDB is installed as a Windows service, start it separately from an
appropriately privileged PowerShell window with `Start-Service MongoDB`.
Otherwise, start your MongoDB instance by its own installation-specific
method. Resource persistence returns HTTP 503 while MongoDB is unavailable.

In a second PowerShell window:

```powershell
Set-Location C:\path\to\GreenOps\frontend
npm ci
Copy-Item .env.example .env.local
npm run dev
```

The Vite dev server uses `http://127.0.0.1:3000` and fails rather than silently
choosing another port if that port is already occupied. The backend command
uses Uvicorn's default `127.0.0.1:8000` bind.

## API and routes

- Health: <http://127.0.0.1:8000/api/v1/health>
- Interactive API documentation: <http://127.0.0.1:8000/docs>
- OpenAPI JSON: <http://127.0.0.1:8000/openapi.json>
- Frontend: <http://127.0.0.1:3000>

| Method and path | Request | Response |
|---|---|---|
| `GET /api/v1/health` | None | `{status, service}`. Liveness only; does not ping MongoDB. |
| `POST /api/v1/resources` | Resource object: `workload_id`, ISO timestamp, CPU/memory percentages, positive `duration_seconds`, optional `latency_p99_ms` | Stored resource record (`201`). |
| `GET /api/v1/resources` | Optional `page` (1–10,000), `page_size` (1–100), `from_dt`, `to_dt` | `{total, page, page_size, records}`. |
| `POST /api/v1/resources/upload-csv` | Multipart field `file`; CSV uses resource record field names | `{inserted_count, rejected_count, errors}`. Max 5 MiB and 10,000 data rows; up to 100 detailed row errors. |
| `POST /api/v1/analytics/analyze` | `{records: ResourceRecord[]}`; 1–10,000 records | CPU/memory statistics, timestamp trend, underutilization summary, data quality. |
| `POST /api/v1/estimation/estimate` | `workload_id`, positive duration, positive USD/hour rate; optional CPU%, TDP watts, emissions factor | Estimated cost/energy/carbon fields, nullable when required inputs are absent; assumptions and warnings. |
| `POST /api/v1/recommendations/evaluate` | `{records, allocations?, constraints?, min_samples_threshold?}`; at most 10,000 records | Recommendation, evidence, potential benefit, warnings, and verification conditions. |

The frontend's client-side routes are:

| Page | Path |
|---|---|
| Overview | `/overview` |
| Resource Explorer | `/resources` |
| Analytics | `/analytics` |
| Cost & Carbon | `/cost-carbon` |
| Recommendations | `/recommendations` |

The Analytics page loads stored resource records for a selectable reporting
period (default: the previous seven days), retrieves every 100-record page,
and submits up to 10,000 matching records to the analytics API. Periods above
that limit must be narrowed. Analytics calculations remain backend-owned.

The Cost & Carbon page can load records for a selectable reporting period and
prefill workload ID, observed duration, and CPU utilization from a chosen
record. Hourly rate, server TDP, and emissions factor remain caller-supplied
assumptions; the existing backend estimator remains the calculation source.
The emission-factor source/reference, geographic region, and reference year or
period can also be supplied and are echoed with the estimate. Blank provenance is
shown as unspecified; entered metadata is not independently verified, and no
emission-factor value is selected or fetched automatically. The carbon formula
is unchanged.

The Recommendations page loads stored records for a selectable reporting
period, retrieves every 100-record page, and lets the user evaluate one
workload ID at a time. Only that workload's matching history is sent to the
existing recommendation API; periods above 10,000 records must be narrowed.
Backend insufficiency, confidence, evidence, warnings, and verification
conditions are displayed as returned.

Resource records use `workload_id` (1–128 characters), `timestamp`,
`cpu_utilization` and `memory_utilization` (0–100%), positive
`duration_seconds`, and optional non-negative `latency_p99_ms`. Mixed
timezone-naive and timezone-aware date filters are accepted; naive query dates
are interpreted as UTC. Exact schemas and examples are available in `/docs`.

The frontend API service and types currently cover all seven routes. Static
contract matching was checked against the registered FastAPI routes and
schemas during the final audit; frontend API-client tests cover methods,
paths, query encoding, and request bodies. This is not equivalent to a fresh
live integration test of every endpoint.

## Tests and quality checks

From the project root:

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests -q
```

From `frontend`:

```powershell
npm test
npm run lint
npm run build
```

Backend tests use deterministic inputs and mocked database operations; they do
not require or modify a live MongoDB database. Frontend tests use deterministic
mocks and are not live end-to-end tests.

## Browser acceptance handover

The following were exercised in the previous browser QA phase against the
running local frontend and backend. They are **prior-phase evidence**, not a
fresh rerun during this final audit:

- [x] Five page routes load directly and survive refresh.
- [x] Mobile navigation opens, navigates, and closes.
- [x] Resource creation/listing, pagination, date filtering, and form
  validation.
- [x] CSV success, missing-column, invalid-value, malformed, and empty-file
  cases.
- [x] Analytics, cost/carbon estimation, and recommendation workflows against
  live API responses.
- [x] Browser-simulated unavailable API, retry, and recovery states (simulated
  outage, not a real server outage).
- [x] No horizontal overflow reported on the five routes at 320, 390, 768, and
  1440 CSS-pixel viewport widths after the responsive fix.

The empty-state assertion and unavailable-backend recovery were simulated in
the browser. The earlier live test records and named CSV fixtures were cleaned
up at the end of that phase. See test results in the current handover report
before treating any item as freshly verified.

## Cost/carbon assumptions and limitations

All estimator outputs are estimates, not direct measurements. The hourly
instance rate, server TDP, and emissions factor are caller-supplied; no live
price or emissions-factor source is queried. Energy uses the implemented
illustrative, uncalibrated CPU-scaled TDP proxy:

`estimated_energy_kwh = (server_tdp_watts [W] × cpu_utilization_pct / 100 × duration_hours [h]) / 1000`

This proxy is not measured server power or a calibrated model of actual power;
it may under- or overestimate energy and assumes zero power at 0% CPU. It omits
idle power and other hardware loads. PUE is not applied. Carbon remains
`estimated_energy_kwh × emissions_factor_kg_co2_per_kwh [kg CO2e/kWh]`; this
phase does not change either formula or resulting values. Emission-factor source,
region, and reference period can be supplied as user metadata and are echoed
with estimates, but are not independently verified; unspecified metadata is
shown as unspecified. The example factor in the API schema is not a validated
default. Underutilization and recommendation thresholds are project heuristics,
not scientifically calibrated rules.

See [DOMAIN_ASSUMPTIONS.md](./DOMAIN_ASSUMPTIONS.md) for formulas, units,
sources reviewed, validation status, and omissions. Do not claim scientific
validation based on passing software tests.

## Known limitations

- The MVP has no authentication or authorization. Keep it on loopback; do not
  expose it to untrusted networks.
- MongoDB is required for resource persistence; health is only a service
  liveness response.
- Resource listing uses count and offset pagination. Page size and page number
  are capped, but broad queries can still grow costly as the database expands.
- Python dependency consistency is checked with `pip check`; a Python
  vulnerability advisory scan requires `pip-audit`, which was unavailable in
  the final audit environment.
- Browser automation and live API results can differ by run. The handover
  report distinguishes fresh checks from prior browser evidence.
