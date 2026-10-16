# GreenOps calculation assumptions and limitations

**Review date:** 2026-10-16  
**Scope:** Current backend formulas and rules, their inputs/outputs, and the
frontend disclosures. This is a review of the implemented model, not scientific
validation.

## Cost, energy, and carbon estimation

All results from `POST /api/v1/estimation/estimate` are estimates. The service
uses caller-provided assumptions; it does not retrieve cloud prices, hardware
power data, or grid factors. Its values are not measured infrastructure
consumption or emissions.

| Calculation | Implemented formula and units | Inputs and provenance | Geographic/time coverage and status |
|---|---|---|---|
| Duration conversion | `duration_hours = duration_seconds / 3600` | Required positive duration in seconds; described by the schema as observed/measured. 3600 seconds/hour is a unit conversion. | No location or reporting period is attached. The arithmetic conversion is deterministic. |
| Full-instance cost | `hourly_instance_rate_usd [USD/hour] × duration_hours [hours]` → `estimated_compute_cost_usd [USD]` | Required positive caller-supplied rate. No live price lookup; verify against the actual provider, region, instance, billing terms, and discounts. | USD only; no exchange-rate, tax, discount, or multi-instance normalization. Price validity depends on the caller's billing period and contract. |
| CPU-proportional workload cost | `estimated_compute_cost_usd × (cpu_utilization_pct / 100)` → `estimated_workload_cost_usd [USD]` | Optional measured average CPU utilization from the caller. | A billing-allocation heuristic, not measured cost or a claim that CPU-proportional spend is avoidable. Billing may be fixed or otherwise non-linear in CPU use. No region or period-specific pricing validation. |
| TDP energy proxy | `(server_tdp_watts [W] × cpu_utilization_pct / 100 × duration_hours [h]) / 1000` → `estimated_energy_kwh [kWh]` | Requires caller-supplied positive server TDP and measured CPU percentage. TDP is expected to come from a hardware vendor specification; it is not a measurement of workload power. | Illustrative and uncalibrated, not a model or measurement of actual server power. The linear CPU-to-power relationship is unverified and can under- or overestimate energy. At 0% CPU, the formula returns 0 kWh although a running server draws idle power. The model has no server count or workload-to-server normalization and omits idle power, memory/other hardware loads, hardware-specific power curves, and data-centre PUE/cooling overhead. **No PUE adjustment is applied.** |
| Grid-factor carbon estimate | `estimated_energy_kwh × emissions_factor_kg_co2_per_kwh [kg CO2e/kWh]` → `estimated_carbon_kg_co2e [kg CO2e]` | Factor must be supplied by the caller and must be greater than zero when both energy inputs are present. No factor default or lookup exists. The schema example `0.233` is an example value, not a configured default. Optional source/reference, geographic region, and reference year/period are accepted as user-supplied metadata and echoed. | **Unverified.** Provenance text is not independently verified and may be unspecified; metadata does not establish the factor's accuracy. No hourly/market-based matching is done. |

All estimation outputs are rounded to six decimal places. Carbon uses the
energy value after that six-decimal rounding. The API returns `null` for
dependent estimates if required optional inputs are absent; it does not fill
them with defaults. An emissions factor of zero is rejected by validation.

The schema's example values (`0.096 USD/hour`, `250 W`, and `0.233 kg
CO2e/kWh`) are not verified prices or factors. In particular, no retrieved
source in this review establishes that `0.233` is correct for any intended
GreenOps location and year.

## Analytics

`POST /api/v1/analytics/analyze` requires at least one validated resource
record. CPU and memory inputs are percentages in `[0, 100]`; duration is
positive seconds; timestamps are required and timezone-naive values are
treated as UTC. Optional latency is in milliseconds and must be non-negative.

| Output | Implemented rule | Units and interpretation |
|---|---|---|
| CPU mean/min/max | Arithmetic mean and extrema of the submitted CPU percentages. | Percent; every record has equal weight. `duration_seconds` is not used as a weight. |
| CPU p50/p90/p95 | `numpy.percentile` at 50/90/95 using its default interpolation method. | Percentile summaries of the submitted observations, not a continuous-time utilization distribution. |
| Memory mean/peak | Arithmetic mean and maximum of submitted memory percentages. | Percent; every record has equal weight. |
| Trend | Submitted observations sorted by timestamp ascending; no resampling or interpolation. | Timestamp and utilization percentages. Duplicate times and gaps are not corrected. |
| Underutilization | A record is flagged only when `cpu < cpu_threshold AND memory < memory_threshold`. | Estimated heuristic, not a measurement or recommendation. Defaults are 20% for each threshold; `UNDERUTIL_CPU_THRESHOLD_PCT` and `UNDERUTIL_MEM_THRESHOLD_PCT` configure them, each constrained to `[0, 100]`. Comparisons are strict. |
| Data quality | Counts submitted records with/without `latency_p99_ms`. | Missing latency remains missing; it is not changed to zero. |

Statistics and trend values are rounded to four decimal places. No emissions,
energy, or cost values are calculated by analytics. The result represents only
the records supplied in that request; it does not establish coverage,
representativeness, or workload duration weighting.

## Recommendation rules

`POST /api/v1/recommendations/evaluate` evaluates submitted records. Resource
utilization is percentage, latency is milliseconds, allocation inputs are
cores/GB, and optional current hourly rate is USD/hour. Allocations and rate,
when supplied, must be positive; maximum acceptable P99 latency must be
positive. Target CPU headroom defaults to 20% and is constrained to 0–50%.
Records and elapsed time are not duration-weighted; timestamps are not used
for coverage analysis.

The implemented decision order is:

1. Empty history → `INSUFFICIENT_DATA` with no confidence.
2. Fewer than `min_samples_threshold` samples → `INSUFFICIENT_DATA`. The
   request default is 5; the service enforces an effective floor of 2 even if
   the caller sets the configurable threshold to 1.
3. Otherwise, peak CPU **greater than** 85%, peak memory **greater than** 85%,
   or any observed P99 latency above a supplied maximum → `RIGHTSIZE_UP`.
4. Otherwise, CPU P95 **less than** 35%, peak memory **less than** 50%, and no
   counted latency violations → `RIGHTSIZE_DOWN`.
5. Otherwise → `MAINTAIN`.

The maximum P99 latency constraint is optional. Missing latency observations,
or an omitted latency constraint, cannot produce counted violations; absence
of violations is not evidence that an SLA was met. The UI now states this
limitation.

For downsize candidates, the API returns a **fixed 25% scenario**, not a
resource-sizing calculation. If an hourly rate is supplied, estimated hourly
savings are `hourly_rate_usd × 0.25`, rounded to four decimals. CPU and memory
reduction fields are also fixed at 25%. Supplied CPU-core and memory-GB
allocations do not affect the calculation. `target_cpu_headroom_pct` defaults
to 20% and is echoed as a verification condition; it is not calculated against
the supplied allocations or used to derive the fixed reduction. This review
updated the returned explanation to say so; formula, threshold, and API output
shape are unchanged.

Confidence values are heuristic: downsizing is `MEDIUM` below 10 samples and
`HIGH` at 10 or more; other branches also assign fixed labels. There is no
statistical calibration or uncertainty interval. Thresholds (85%, 35%, 50%),
the 25% scenario, and minimum sample count are project rules, not validated
industry standards. The recommendations page now labels confidence as
rule-based and not statistically calibrated.

This review also corrected a confirmed edge case: the schema and UI allow a
configured sample threshold of 1, which previously allowed one low-utilization
sample to reach `RIGHTSIZE_DOWN` despite the documented single-sample guard.
The service now requires at least 2 samples for any non-insufficient-data
branch. This does not change the default threshold or utilization/savings
formulas.

Other limitations include no explicit same-workload check across input
records, no seasonality or sampling-interval analysis, and no determination of
whether the submitted observation window covers representative peaks.
Recommendations are advisory and do not alter infrastructure.

## Source and validation review

The implementation is the source of the formulas and thresholds above:

- `backend/services/estimation.py`, `backend/schemas/estimation.py`
- `backend/services/analytics.py`, `backend/schemas/analytics.py`,
  `backend/config.py`
- `backend/services/recommendations.py`, `backend/schemas/recommendation.py`
- `frontend/src/pages/CostCarbonPage.tsx`,
  `frontend/src/pages/RecommendationsPage.tsx`

The schema mentions IEA and Electricity Maps as examples of possible factor
sources, but gives no publication, dataset edition, geography, time period, or
source record for the example `0.233`. Neither is evidence that this example
matches GreenOps's intended location and year. No emission factor was adopted
or independently validated during this review.

Potential authoritative references, checked 2026-10-16:

- [UK Government: Greenhouse gas reporting conversion factors](https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting)
  publishes annual factors for UK reporting and explains that organizations
  should report the method used. Its [2025 publication](https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2025)
  is explicitly for reporting 2025 emissions. These are not evidence for a
  non-UK data-centre factor or a factor for a different year.
- [US EPA eGRID](https://www.epa.gov/egrid) describes US electricity-generation
  data including emissions and emissions rates. It is a possible US-specific
  source; no particular eGRID release, subregion, or numeric factor was
  matched to the GreenOps example.
- [GHG Protocol Scope 2 Guidance](https://ghgprotocol.org/scope-2-guidance)
  is accounting guidance for emissions from purchased electricity and other
  energy. It is methodological guidance, not a source for the numeric factor
  currently accepted by the API.

The intended operating region is not specified in the application
configuration. Before claiming a traceable carbon estimate, choose and record
the applicable geographic boundary, reporting year/time period, emissions
accounting method, and a source dataset whose published unit and value match
the API input. The current API has no fields for factor source, region, year,
or method.

Existing deterministic unit tests cover the implemented arithmetic,
validation boundaries, analytics statistics, and recommendation branches.
Passing tests establish software behavior only; they do not validate the TDP
proxy, grid factor, financial assumptions, thresholds, or scientific validity.
