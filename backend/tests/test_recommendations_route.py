"""HTTP integration tests for POST /api/v1/recommendations/evaluate."""

import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

SAMPLE_RECORDS = [
    {
        "workload_id": "service-alpha",
        "timestamp": f"2024-06-01T12:0{i}:00Z",
        "cpu_utilization": 15.0,
        "memory_utilization": 20.0,
        "duration_seconds": 60.0,
    }
    for i in range(6)
]


def test_recommendation_evaluate_endpoint_200():
    payload = {
        "records": SAMPLE_RECORDS,
        "allocations": {
            "allocated_cpu_cores": 2.0,
            "allocated_memory_gb": 8.0,
            "hourly_rate_usd": 0.50,
        },
        "min_samples_threshold": 5,
    }
    response = client.post("/api/v1/recommendations/evaluate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["workload_id"] == "service-alpha"
    rec = data["recommendation"]
    assert rec["category"] == "RIGHTSIZE_DOWN"
    assert rec["sufficiency_status"] == "SUFFICIENT"
    assert rec["potential_benefit"] is not None
    assert rec["potential_benefit"]["estimated_hourly_cost_savings_usd"] == pytest.approx(0.125)


def test_recommendation_empty_records_200():
    payload = {"records": []}
    response = client.post("/api/v1/recommendations/evaluate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["recommendation"]["category"] == "INSUFFICIENT_DATA"
    evidence = data["recommendation"]["evidence"]
    assert evidence["sample_count"] == 0
    assert evidence["mean_cpu_pct"] is None
    assert evidence["peak_cpu_pct"] is None
    assert evidence["p95_cpu_pct"] is None
    assert evidence["mean_memory_pct"] is None
    assert evidence["peak_memory_pct"] is None
    assert "No resource usage records" in data["recommendation"]["reason"]


def test_recommendation_mixed_workload_ids_return_422():
    payload = {
        "records": [
            {**SAMPLE_RECORDS[0], "workload_id": "service-alpha"},
            {**SAMPLE_RECORDS[1], "workload_id": "service-beta"},
        ]
    }

    response = client.post("/api/v1/recommendations/evaluate", json=payload)

    assert response.status_code == 422
    errors = response.json()["detail"]
    assert any(
        "All records in a recommendation request must have the same workload_id."
        in error["msg"]
        for error in errors
    )
