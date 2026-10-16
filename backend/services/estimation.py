"""Infrastructure cost and carbon estimation service.

All returned values are ESTIMATES derived from caller-supplied assumptions.
No live cloud pricing APIs are contacted.
No measurements are fabricated.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMULA REFERENCE  (see schemas/estimation.py for full narrative)

  duration_hours = duration_seconds / 3600

  estimated_compute_cost_usd   = hourly_rate  × duration_hours

  estimated_workload_cost_usd  = compute_cost × (cpu_pct / 100)
    (billing approximation, requires cpu_utilization_pct)

  estimated_energy_kwh         = (tdp_watts × cpu_pct/100 × duration_hours) / 1000
    (TDP-proxy, requires server_tdp_watts + cpu_utilization_pct)

  estimated_carbon_kg_co2e     = energy_kwh × emissions_factor
    (grid-average, requires energy + emissions_factor_kg_co2_per_kwh)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

from backend.schemas.estimation import (
    EstimationAssumptions,
    EstimationRequest,
    EstimationResult,
)

# Rounding precision for monetary, energy and carbon values
_USD_DP = 6
_KWH_DP = 6
_CO2_DP = 6


def estimate(req: EstimationRequest) -> EstimationResult:
    """
    Compute cost, energy and carbon estimates from caller-supplied assumptions.

    Returns an EstimationResult with:
      - All ESTIMATED fields clearly labelled.
      - None for any metric whose required inputs are absent.
      - A warnings list for advisory caveats.
    """
    warnings: list[str] = []
    duration_hours = req.duration_seconds / 3600.0

    # ── 1. Compute cost ───────────────────────────────────────────────────────
    estimated_compute_cost_usd = round(
        req.hourly_instance_rate_usd * duration_hours, _USD_DP
    )

    # ── 2. Workload-proportional cost ─────────────────────────────────────────
    estimated_workload_cost_usd: float | None = None
    if req.cpu_utilization_pct is not None:
        workload_fraction = req.cpu_utilization_pct / 100.0
        estimated_workload_cost_usd = round(
            estimated_compute_cost_usd * workload_fraction, _USD_DP
        )
        warnings.append(
            "estimated_workload_cost_usd is a billing-proportionality approximation "
            "based on CPU utilisation; it does not represent measured power or energy."
        )

    # ── 3. Energy ─────────────────────────────────────────────────────────────
    estimated_energy_kwh: float | None = None
    if req.server_tdp_watts is not None and req.cpu_utilization_pct is not None:
        cpu_fraction = req.cpu_utilization_pct / 100.0
        estimated_power_draw_watts = req.server_tdp_watts * cpu_fraction
        estimated_energy_kwh = round(
            estimated_power_draw_watts * duration_hours / 1000.0, _KWH_DP
        )
        warnings.append(
            "estimated_energy_kwh uses TDP × CPU% as a proxy for server power draw. "
            "Actual consumption depends on hardware model, memory load, idle baseline "
            "and data-centre PUE, none of which are captured here."
        )
    elif req.server_tdp_watts is None and req.cpu_utilization_pct is not None:
        warnings.append(
            "Energy and carbon estimates skipped: server_tdp_watts not supplied."
        )
    elif req.cpu_utilization_pct is None:
        warnings.append(
            "Energy, carbon and workload-cost estimates skipped: "
            "cpu_utilization_pct not supplied."
        )

    # ── 4. Carbon ─────────────────────────────────────────────────────────────
    estimated_carbon_kg_co2e: float | None = None
    if estimated_energy_kwh is not None:
        # Schema validator already enforces emissions_factor is present here.
        factor = req.emissions_factor_kg_co2_per_kwh  # guaranteed non-None by schema
        estimated_carbon_kg_co2e = round(
            estimated_energy_kwh * factor,  # type: ignore[operator]
            _CO2_DP,
        )
        warnings.append(
            "estimated_carbon_kg_co2e uses a grid-average emissions factor. "
            "Actual carbon intensity varies by region, time and energy mix."
        )

    assumptions = EstimationAssumptions(
        hourly_instance_rate_usd=req.hourly_instance_rate_usd,
        duration_seconds=req.duration_seconds,
        duration_hours=round(duration_hours, 6),
        cpu_utilization_pct=req.cpu_utilization_pct,
        server_tdp_watts=req.server_tdp_watts,
        emissions_factor_kg_co2_per_kwh=req.emissions_factor_kg_co2_per_kwh,
    )

    return EstimationResult(
        workload_id=req.workload_id,
        estimated_compute_cost_usd=estimated_compute_cost_usd,
        estimated_workload_cost_usd=estimated_workload_cost_usd,
        estimated_energy_kwh=estimated_energy_kwh,
        estimated_carbon_kg_co2e=estimated_carbon_kg_co2e,
        assumptions=assumptions,
        warnings=warnings,
    )
