"""Unit tests for the estimation service.

Tests verify formula correctness, units, None-propagation and invalid config.
No HTTP, no MongoDB.
"""

import pytest
from pydantic import ValidationError

from backend.schemas.estimation import EstimationRequest
from backend.services.estimation import estimate

# ── Helpers ───────────────────────────────────────────────────────────────────

def _req(**kwargs) -> EstimationRequest:
    defaults = dict(
        workload_id="job-1",
        duration_seconds=3600.0,       # 1 hour → easy arithmetic
        hourly_instance_rate_usd=1.0,
    )
    defaults.update(kwargs)
    return EstimationRequest(**defaults)


# ── Compute cost ──────────────────────────────────────────────────────────────

def test_compute_cost_one_hour():
    result = estimate(_req(hourly_instance_rate_usd=0.5, duration_seconds=3600.0))
    assert result.estimated_compute_cost_usd == pytest.approx(0.5, rel=1e-5)


def test_compute_cost_half_hour():
    result = estimate(_req(hourly_instance_rate_usd=1.0, duration_seconds=1800.0))
    assert result.estimated_compute_cost_usd == pytest.approx(0.5, rel=1e-5)


def test_compute_cost_fractional_rate():
    # 0.096 USD/h × 2 h = 0.192 USD
    result = estimate(_req(hourly_instance_rate_usd=0.096, duration_seconds=7200.0))
    assert result.estimated_compute_cost_usd == pytest.approx(0.192, rel=1e-4)


def test_compute_cost_always_present():
    result = estimate(_req())
    assert result.estimated_compute_cost_usd is not None


# ── Workload-proportional cost ────────────────────────────────────────────────

def test_workload_cost_50pct_cpu():
    # 1 USD/h × 1 h × 0.5 = 0.5 USD
    result = estimate(_req(cpu_utilization_pct=50.0))
    assert result.estimated_workload_cost_usd == pytest.approx(0.5, rel=1e-5)


def test_workload_cost_100pct_cpu_equals_compute_cost():
    result = estimate(_req(cpu_utilization_pct=100.0))
    assert result.estimated_workload_cost_usd == pytest.approx(
        result.estimated_compute_cost_usd, rel=1e-5
    )


def test_workload_cost_0pct_cpu_is_zero():
    result = estimate(_req(cpu_utilization_pct=0.0))
    assert result.estimated_workload_cost_usd == pytest.approx(0.0, abs=1e-9)


def test_zero_cpu_produces_zero_energy_and_carbon():
    result = estimate(_req(
        cpu_utilization_pct=0.0,
        server_tdp_watts=200.0,
        emissions_factor_kg_co2_per_kwh=0.5,
    ))

    assert result.estimated_compute_cost_usd == pytest.approx(1.0)
    assert result.estimated_workload_cost_usd == pytest.approx(0.0)
    assert result.estimated_energy_kwh == pytest.approx(0.0)
    assert result.estimated_carbon_kg_co2e == pytest.approx(0.0)
    assert any(
        "assumes zero power at 0% CPU" in warning
        and "no PUE adjustment is applied" in warning
        for warning in result.warnings
    )


def test_workload_cost_none_when_cpu_absent():
    result = estimate(_req())  # no cpu_utilization_pct
    assert result.estimated_workload_cost_usd is None


# ── Energy ────────────────────────────────────────────────────────────────────

def test_energy_formula_correct():
    # Existing proxy: TDP=200W, CPU=50%, duration=3600s → 100W proxy → 0.1 kWh.
    result = estimate(_req(
        server_tdp_watts=200.0,
        cpu_utilization_pct=50.0,
        emissions_factor_kg_co2_per_kwh=0.5,
        duration_seconds=3600.0,
    ))
    assert result.estimated_energy_kwh == pytest.approx(0.1, rel=1e-5)


def test_energy_formula_full_tdp():
    # TDP=300W, CPU=100%, 1h → 0.3 kWh
    result = estimate(_req(
        server_tdp_watts=300.0,
        cpu_utilization_pct=100.0,
        emissions_factor_kg_co2_per_kwh=0.3,
        duration_seconds=3600.0,
    ))
    assert result.estimated_energy_kwh == pytest.approx(0.3, rel=1e-5)


def test_energy_none_when_tdp_absent():
    result = estimate(_req(cpu_utilization_pct=50.0))
    # No TDP → no energy (schema requires emissions_factor only if tdp present)
    # But schema validator raises when tdp+cpu are present without factor.
    # Here tdp is absent, so energy must be None.
    assert result.estimated_energy_kwh is None


def test_energy_none_when_cpu_absent():
    # TDP present but no CPU — schema validator won't fire (requires both)
    # We test via direct service call after building a request manually
    req = EstimationRequest(
        workload_id="j",
        duration_seconds=3600,
        hourly_instance_rate_usd=1.0,
        server_tdp_watts=200.0,
        # cpu_utilization_pct intentionally absent
        # emissions_factor also absent — schema validator won't raise because tdp alone is OK
    )
    result = estimate(req)
    assert result.estimated_energy_kwh is None


# ── Carbon ────────────────────────────────────────────────────────────────────

def test_carbon_formula_correct():
    # energy=0.1 kWh, factor=0.5 kg/kWh → 0.05 kg CO₂e
    result = estimate(_req(
        server_tdp_watts=200.0,
        cpu_utilization_pct=50.0,
        emissions_factor_kg_co2_per_kwh=0.5,
        duration_seconds=3600.0,
    ))
    assert result.estimated_carbon_kg_co2e == pytest.approx(0.05, rel=1e-5)


def test_emissions_factor_provenance_is_echoed_without_changing_carbon_formula():
    result = estimate(_req(
        server_tdp_watts=200.0,
        cpu_utilization_pct=50.0,
        emissions_factor_kg_co2_per_kwh=0.5,
        emissions_factor_source="Grid data report",
        emissions_factor_region="Region X",
        emissions_factor_reference_period="2025",
        duration_seconds=3600.0,
    ))

    assert result.estimated_energy_kwh == pytest.approx(0.1)
    assert result.estimated_carbon_kg_co2e == pytest.approx(0.05)
    assert result.assumptions.emissions_factor_kg_co2_per_kwh == pytest.approx(0.5)
    assert result.assumptions.emissions_factor_source == "Grid data report"
    assert result.assumptions.emissions_factor_region == "Region X"
    assert result.assumptions.emissions_factor_reference_period == "2025"
    assert any(
        "user-supplied and has not been independently verified" in warning
        for warning in result.warnings
    )
    assert not any("provenance unspecified" in warning for warning in result.warnings)


def test_missing_emissions_factor_provenance_remains_unspecified():
    result = estimate(_req(
        server_tdp_watts=200.0,
        cpu_utilization_pct=50.0,
        emissions_factor_kg_co2_per_kwh=0.5,
    ))

    assert result.estimated_carbon_kg_co2e == pytest.approx(0.05)
    assert result.assumptions.emissions_factor_source is None
    assert result.assumptions.emissions_factor_region is None
    assert result.assumptions.emissions_factor_reference_period is None
    assert any(
        "provenance unspecified: source, geographic region, reference year or period"
        in warning
        for warning in result.warnings
    )


def test_blank_emissions_factor_provenance_is_normalized_to_unspecified():
    request = _req(
        emissions_factor_source="  ",
        emissions_factor_region=" \t",
        emissions_factor_reference_period="",
    )

    assert request.emissions_factor_source is None
    assert request.emissions_factor_region is None
    assert request.emissions_factor_reference_period is None


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("emissions_factor_source", "s" * 201),
        ("emissions_factor_region", "r" * 129),
        ("emissions_factor_reference_period", "p" * 101),
    ],
)
def test_emissions_factor_provenance_length_limits(field, value):
    with pytest.raises(ValidationError):
        _req(**{field: value})


def test_carbon_none_when_energy_none():
    result = estimate(_req(cpu_utilization_pct=50.0))
    assert result.estimated_carbon_kg_co2e is None


def test_carbon_scales_linearly_with_factor():
    base = estimate(_req(
        server_tdp_watts=100.0,
        cpu_utilization_pct=100.0,
        emissions_factor_kg_co2_per_kwh=0.2,
        duration_seconds=3600.0,
    ))
    double = estimate(_req(
        server_tdp_watts=100.0,
        cpu_utilization_pct=100.0,
        emissions_factor_kg_co2_per_kwh=0.4,
        duration_seconds=3600.0,
    ))
    assert double.estimated_carbon_kg_co2e == pytest.approx(
        base.estimated_carbon_kg_co2e * 2, rel=1e-5  # type: ignore[operator]
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("duration_seconds", -1.0),
        ("hourly_instance_rate_usd", 0.0),
        ("hourly_instance_rate_usd", -0.1),
        ("cpu_utilization_pct", -0.1),
        ("cpu_utilization_pct", 100.1),
        ("server_tdp_watts", 0.0),
        ("server_tdp_watts", -1.0),
        ("emissions_factor_kg_co2_per_kwh", 0.0),
        ("emissions_factor_kg_co2_per_kwh", -0.1),
    ],
)
def test_invalid_estimation_inputs_rejected(field, value):
    with pytest.raises(ValidationError):
        _req(**{field: value})


def test_missing_inputs_leave_dependent_estimates_absent():
    result = estimate(_req())

    assert result.estimated_compute_cost_usd == pytest.approx(1.0)
    assert result.estimated_workload_cost_usd is None
    assert result.estimated_energy_kwh is None
    assert result.estimated_carbon_kg_co2e is None


# ── Assumptions echo ──────────────────────────────────────────────────────────

def test_assumptions_echo_duration_hours():
    result = estimate(_req(duration_seconds=7200.0))
    assert result.assumptions.duration_hours == pytest.approx(2.0, rel=1e-5)


def test_assumptions_echo_rate():
    result = estimate(_req(hourly_instance_rate_usd=0.096))
    assert result.assumptions.hourly_instance_rate_usd == pytest.approx(0.096)


def test_assumptions_echo_cpu_none_when_absent():
    result = estimate(_req())
    assert result.assumptions.cpu_utilization_pct is None


# ── Warnings ─────────────────────────────────────────────────────────────────

def test_warnings_present_when_cpu_supplied():
    result = estimate(_req(cpu_utilization_pct=40.0))
    assert any("billing-proportionality" in w for w in result.warnings)


def test_warnings_present_when_energy_estimated():
    result = estimate(_req(
        server_tdp_watts=200.0,
        cpu_utilization_pct=50.0,
        emissions_factor_kg_co2_per_kwh=0.3,
    ))
    energy_warning = next(w for w in result.warnings if "estimated_energy_kwh" in w)
    assert "illustrative, uncalibrated" in energy_warning
    assert "not measured server power" in energy_warning
    assert "underestimate or overestimate" in energy_warning
    assert "assumes zero power at 0% CPU" in energy_warning
    assert "no PUE adjustment is applied" in energy_warning
    assert any("grid-average" in w for w in result.warnings)


def test_no_cost_warnings_when_only_compute_cost():
    """Only the compute cost is returned; the service emits one informational
    advisory explaining that optional estimates were skipped."""
    result = estimate(_req())
    # No proxy-caveat warnings — only the informational "skipped" message.
    assert not any("TDP" in w for w in result.warnings)
    assert not any("billing-proportionality" in w for w in result.warnings)
    assert not any("grid-average" in w for w in result.warnings)
    # One informational skip advisory is expected.
    assert len(result.warnings) == 1
    assert "cpu_utilization_pct not supplied" in result.warnings[0]


# ── Invalid configuration / schema validation ─────────────────────────────────

def test_missing_emissions_factor_raises_when_energy_possible():
    """Schema must reject: tdp + cpu present but no emissions factor."""
    with pytest.raises(ValidationError, match="emissions_factor_kg_co2_per_kwh"):
        EstimationRequest(
            workload_id="j",
            duration_seconds=3600,
            hourly_instance_rate_usd=1.0,
            server_tdp_watts=200.0,
            cpu_utilization_pct=50.0,
            # emissions_factor_kg_co2_per_kwh intentionally absent
        )


def test_zero_duration_rejected():
    with pytest.raises(ValidationError):
        EstimationRequest(
            workload_id="j",
            duration_seconds=0.0,
            hourly_instance_rate_usd=1.0,
        )


def test_negative_rate_rejected():
    with pytest.raises(ValidationError):
        EstimationRequest(
            workload_id="j",
            duration_seconds=3600,
            hourly_instance_rate_usd=-1.0,
        )


def test_cpu_above_100_rejected():
    with pytest.raises(ValidationError):
        EstimationRequest(
            workload_id="j",
            duration_seconds=3600,
            hourly_instance_rate_usd=1.0,
            cpu_utilization_pct=100.1,
        )


def test_negative_tdp_rejected():
    with pytest.raises(ValidationError):
        EstimationRequest(
            workload_id="j",
            duration_seconds=3600,
            hourly_instance_rate_usd=1.0,
            server_tdp_watts=-10.0,
            cpu_utilization_pct=50.0,
            emissions_factor_kg_co2_per_kwh=0.3,
        )


def test_zero_emissions_factor_rejected():
    with pytest.raises(ValidationError):
        EstimationRequest(
            workload_id="j",
            duration_seconds=3600,
            hourly_instance_rate_usd=1.0,
            server_tdp_watts=200.0,
            cpu_utilization_pct=50.0,
            emissions_factor_kg_co2_per_kwh=0.0,  # must be > 0
        )
