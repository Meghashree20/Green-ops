"""Pydantic schemas for the cost and carbon estimation endpoint.

UNITS — all fields are explicitly documented with their unit.
All output values labelled ESTIMATED are derived from caller assumptions or
illustrative proxies, not direct measurements.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMULAS (implemented in services/estimation.py)

 1. Compute-cost (USD):
      estimated_compute_cost_usd = hourly_instance_rate_usd * duration_hours

 2. Proportional workload cost (USD)   — only when cpu_utilization is supplied:
      workload_fraction   = cpu_utilization_pct / 100
      estimated_workload_cost_usd = estimated_compute_cost_usd * workload_fraction
      NOTE: this is a billing-proportionality approximation, NOT a power measurement.

 3. Energy (kWh)   — ESTIMATED, requires server_tdp_watts:
      duration_hours = duration_seconds / 3600
      server_power_fraction = cpu_utilization_pct / 100        ← proxy, not measured
      estimated_power_draw_watts = server_tdp_watts * server_power_fraction
      estimated_energy_kwh = estimated_power_draw_watts * duration_hours / 1000
      CAVEAT: illustrative, uncalibrated proxy, not a model or measurement of actual
      server power. It may under- or overestimate energy and returns zero power at
      zero CPU. Idle power, other hardware loads, and PUE are not included.

 4. Carbon (kg CO₂e)   — ESTIMATED, requires energy + emissions_factor_kg_co2_per_kwh:
      estimated_carbon_kg_co2e = estimated_energy_kwh * emissions_factor_kg_co2_per_kwh
      CAVEAT: the emissions factor is grid-average and varies by region and time.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

from typing import Optional
from pydantic import BaseModel, Field, field_validator, model_validator


# ── Request ───────────────────────────────────────────────────────────────────

class EstimationRequest(BaseModel):
    """All pricing and power values are caller-supplied assumptions, not live data."""

    workload_id: str = Field(
        min_length=1,
        max_length=128,
        description="Identifier for the workload being estimated.",
        examples=["batch-job-42"],
    )
    duration_seconds: float = Field(
        gt=0.0,
        description="Observed workload duration in seconds (measured).",
    )
    cpu_utilization_pct: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=100.0,
        description=(
            "Average CPU utilisation (%) during the workload (measured). "
            "Required for workload-proportional cost and energy estimates."
        ),
    )

    # ── Pricing assumption (caller-supplied) ──────────────────────────────────
    hourly_instance_rate_usd: float = Field(
        gt=0.0,
        description=(
            "ASSUMPTION — caller-supplied on-demand instance rate in USD/hour. "
            "Do not use published list prices without verifying your actual contract."
        ),
        examples=[0.096],
    )

    # ── Power assumption (optional, caller-supplied) ──────────────────────────
    server_tdp_watts: Optional[float] = Field(
        default=None,
        gt=0.0,
        description=(
            "ASSUMPTION — server Thermal Design Power (TDP) in Watts. "
            "Required for energy and carbon estimates. "
            "Obtain from hardware vendor spec sheets; cloud-provider TDP varies."
        ),
        examples=[250.0],
    )
    emissions_factor_kg_co2_per_kwh: Optional[float] = Field(
        default=None,
        gt=0.0,
        description=(
            "ASSUMPTION — grid-average carbon intensity in kg CO₂e per kWh. "
            "Required for carbon estimates. Source: e.g. IEA, electricitymaps.com. "
            "Varies by region and time; use a value appropriate for your data centre."
        ),
        examples=[0.233],
    )
    emissions_factor_source: Optional[str] = Field(
        default=None,
        max_length=200,
        description="User-supplied reference name for the emissions factor; not independently verified.",
    )
    emissions_factor_region: Optional[str] = Field(
        default=None,
        max_length=128,
        description="User-supplied geographic region for the emissions factor; not independently verified.",
    )
    emissions_factor_reference_period: Optional[str] = Field(
        default=None,
        max_length=100,
        description="User-supplied reference year or period for the emissions factor; not independently verified.",
    )

    @field_validator(
        "emissions_factor_source",
        "emissions_factor_region",
        "emissions_factor_reference_period",
        mode="before",
    )
    @classmethod
    def normalize_emissions_factor_provenance(cls, value: object) -> object:
        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None
        return value

    @model_validator(mode="after")
    def carbon_requires_emissions_factor(self) -> "EstimationRequest":
        # If both energy inputs are present the emissions factor must also be present.
        if (
            self.server_tdp_watts is not None
            and self.cpu_utilization_pct is not None
            and self.emissions_factor_kg_co2_per_kwh is None
        ):
            raise ValueError(
                "emissions_factor_kg_co2_per_kwh is required when server_tdp_watts "
                "and cpu_utilization_pct are both supplied."
            )
        return self


# ── Response ──────────────────────────────────────────────────────────────────

class EstimationAssumptions(BaseModel):
    """Echo of every assumption used so results are fully reproducible."""

    hourly_instance_rate_usd: float = Field(description="USD/hour — caller-supplied.")
    duration_seconds: float = Field(description="Seconds — measured input.")
    duration_hours: float = Field(description="Derived: duration_seconds / 3600.")
    cpu_utilization_pct: Optional[float] = Field(
        default=None,
        description="Measured CPU % supplied by caller; None if not provided.",
    )
    server_tdp_watts: Optional[float] = Field(
        default=None,
        description="Watts — caller-supplied TDP assumption; None if not provided.",
    )
    emissions_factor_kg_co2_per_kwh: Optional[float] = Field(
        default=None,
        description="kg CO₂e/kWh — caller-supplied grid factor; None if not provided.",
    )
    emissions_factor_source: Optional[str] = Field(
        default=None,
        description="User-supplied reference name; not independently verified.",
    )
    emissions_factor_region: Optional[str] = Field(
        default=None,
        description="User-supplied geographic region; not independently verified.",
    )
    emissions_factor_reference_period: Optional[str] = Field(
        default=None,
        description="User-supplied reference year or period; not independently verified.",
    )


class EstimationResult(BaseModel):
    workload_id: str

    # ── Cost ─────────────────────────────────────────────────────────────────
    estimated_compute_cost_usd: float = Field(
        description=(
            "ESTIMATED — full instance cost for the duration. "
            "Formula: hourly_instance_rate_usd × duration_hours."
        )
    )
    estimated_workload_cost_usd: Optional[float] = Field(
        default=None,
        description=(
            "ESTIMATED — CPU-proportional share of compute cost. "
            "Formula: estimated_compute_cost_usd × (cpu_utilization_pct / 100). "
            "Billing approximation only; not a power or energy measurement. "
            "None when cpu_utilization_pct is not supplied."
        ),
    )

    # ── Energy ───────────────────────────────────────────────────────────────
    estimated_energy_kwh: Optional[float] = Field(
        default=None,
        description=(
            "ESTIMATED — illustrative, uncalibrated proxy energy consumption in kWh; "
            "not measured server power or a calibrated model of actual power. "
            "Formula: (server_tdp_watts × cpu_utilization_pct/100 × duration_hours) / 1000. "
            "May underestimate or overestimate energy and assumes zero power at 0% CPU. "
            "Hardware-specific power behavior, idle power, other loads, and data-centre "
            "PUE are not captured; no PUE adjustment is applied. "
            "None when server_tdp_watts or cpu_utilization_pct is absent."
        ),
    )

    # ── Carbon ───────────────────────────────────────────────────────────────
    estimated_carbon_kg_co2e: Optional[float] = Field(
        default=None,
        description=(
            "ESTIMATED — carbon emissions in kg CO₂e. "
            "Formula: estimated_energy_kwh × emissions_factor_kg_co2_per_kwh. "
            "Uses grid-average factor; actual intensity varies by region and time. "
            "None when energy cannot be estimated."
        ),
    )

    # ── Reproducibility ───────────────────────────────────────────────────────
    assumptions: EstimationAssumptions = Field(
        description="All inputs and derived constants used for this estimate."
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="Non-fatal advisory messages about estimate limitations.",
    )
