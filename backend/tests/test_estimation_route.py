"""HTTP-level tests for POST /api/v1/estimation/estimate."""

import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

MINIMAL = dict(
    workload_id="job-1",
    duration_seconds=3600.0,
    hourly_instance_rate_usd=1.0,
)

FULL = dict(
    workload_id="job-1",
    duration_seconds=3600.0,
    hourly_instance_rate_usd=0.096,
    cpu_utilization_pct=50.0,
    server_tdp_watts=200.0,
    emissions_factor_kg_co2_per_kwh=0.233,
)


def test_estimate_200_minimal():
    response = client.post("/api/v1/estimation/estimate", json=MINIMAL)
    assert response.status_code == 200


def test_estimate_200_full():
    response = client.post("/api/v1/estimation/estimate", json=FULL)
    assert response.status_code == 200


def test_estimate_response_shape():
    response = client.post("/api/v1/estimation/estimate", json=FULL)
    body = response.json()
    assert "estimated_compute_cost_usd" in body
    assert "estimated_workload_cost_usd" in body
    assert "estimated_energy_kwh" in body
    assert "estimated_carbon_kg_co2e" in body
    assert "assumptions" in body
    assert "warnings" in body


def test_compute_cost_correct_via_http():
    # 1 USD/h × 1 h = 1.0 USD
    response = client.post("/api/v1/estimation/estimate", json=MINIMAL)
    assert response.json()["estimated_compute_cost_usd"] == pytest.approx(1.0, rel=1e-5)


def test_optional_fields_none_when_cpu_absent():
    response = client.post("/api/v1/estimation/estimate", json=MINIMAL)
    body = response.json()
    assert body["estimated_workload_cost_usd"] is None
    assert body["estimated_energy_kwh"] is None
    assert body["estimated_carbon_kg_co2e"] is None


def test_all_estimates_present_with_full_payload():
    response = client.post("/api/v1/estimation/estimate", json=FULL)
    body = response.json()
    assert body["estimated_workload_cost_usd"] is not None
    assert body["estimated_energy_kwh"] is not None
    assert body["estimated_carbon_kg_co2e"] is not None


def test_estimation_outputs_match_independent_formula():
    payload = {
        **MINIMAL,
        "hourly_instance_rate_usd": 2.0,
        "duration_seconds": 1800.0,
        "cpu_utilization_pct": 25.0,
        "server_tdp_watts": 400.0,
        "emissions_factor_kg_co2_per_kwh": 0.5,
    }
    response = client.post("/api/v1/estimation/estimate", json=payload)

    assert response.status_code == 200
    body = response.json()
    # Independently: 0.5 h × $2/h; 25% CPU; 400 W × 25% × 0.5 h.
    assert body["estimated_compute_cost_usd"] == pytest.approx(1.0)
    assert body["estimated_workload_cost_usd"] == pytest.approx(0.25)
    assert body["estimated_energy_kwh"] == pytest.approx(0.05)
    assert body["estimated_carbon_kg_co2e"] == pytest.approx(0.025)


def test_assumptions_echoed_in_response():
    response = client.post("/api/v1/estimation/estimate", json=FULL)
    assumptions = response.json()["assumptions"]
    assert assumptions["hourly_instance_rate_usd"] == pytest.approx(0.096)
    assert assumptions["duration_hours"] == pytest.approx(1.0, rel=1e-5)
    assert assumptions["cpu_utilization_pct"] == pytest.approx(50.0)


def test_emissions_factor_provenance_echoed_by_http_without_changing_estimate():
    payload = {
        **FULL,
        "emissions_factor_source": "Grid data report",
        "emissions_factor_region": "Region X",
        "emissions_factor_reference_period": "2025",
    }

    response = client.post("/api/v1/estimation/estimate", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["estimated_energy_kwh"] == pytest.approx(0.1)
    assert body["estimated_carbon_kg_co2e"] == pytest.approx(0.0233)
    assert body["assumptions"]["emissions_factor_source"] == "Grid data report"
    assert body["assumptions"]["emissions_factor_region"] == "Region X"
    assert body["assumptions"]["emissions_factor_reference_period"] == "2025"


def test_legacy_request_without_provenance_remains_compatible():
    response = client.post("/api/v1/estimation/estimate", json=FULL)

    assert response.status_code == 200
    assumptions = response.json()["assumptions"]
    assert assumptions["emissions_factor_source"] is None
    assert assumptions["emissions_factor_region"] is None
    assert assumptions["emissions_factor_reference_period"] is None


def test_emissions_factor_provenance_over_length_limit_returns_422():
    payload = {
        **FULL,
        "emissions_factor_source": "s" * 201,
    }

    response = client.post("/api/v1/estimation/estimate", json=payload)

    assert response.status_code == 422


def test_warnings_non_empty_with_full_payload():
    response = client.post("/api/v1/estimation/estimate", json=FULL)
    assert len(response.json()["warnings"]) > 0


def test_missing_emissions_factor_returns_422():
    bad = {**FULL}
    del bad["emissions_factor_kg_co2_per_kwh"]
    response = client.post("/api/v1/estimation/estimate", json=bad)
    assert response.status_code == 422


def test_zero_duration_returns_422():
    bad = {**MINIMAL, "duration_seconds": 0.0}
    response = client.post("/api/v1/estimation/estimate", json=bad)
    assert response.status_code == 422


def test_negative_rate_returns_422():
    bad = {**MINIMAL, "hourly_instance_rate_usd": -0.5}
    response = client.post("/api/v1/estimation/estimate", json=bad)
    assert response.status_code == 422


def test_cpu_over_100_returns_422():
    bad = {**MINIMAL, "cpu_utilization_pct": 101.0}
    response = client.post("/api/v1/estimation/estimate", json=bad)
    assert response.status_code == 422


def test_workload_id_in_response():
    response = client.post("/api/v1/estimation/estimate", json=MINIMAL)
    assert response.json()["workload_id"] == "job-1"
