"""Integration tests for POST /api/v1/analytics/analyze."""

import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

VALID_RECORD = dict(
    workload_id="job-1",
    timestamp="2024-06-01T12:00:00Z",
    cpu_utilization=45.0,
    memory_utilization=60.0,
    duration_seconds=300.0,
)

LOW_RECORD = dict(
    workload_id="job-low",
    timestamp="2024-06-01T13:00:00Z",
    cpu_utilization=5.0,
    memory_utilization=8.0,
    duration_seconds=60.0,
)


def test_analyze_200():
    response = client.post("/api/v1/analytics/analyze", json={"records": [VALID_RECORD]})
    assert response.status_code == 200


def test_analyze_response_shape():
    response = client.post("/api/v1/analytics/analyze", json={"records": [VALID_RECORD]})
    body = response.json()
    assert "cpu" in body
    assert "memory" in body
    assert "trend" in body
    assert "underutilization" in body
    assert "data_quality" in body


def test_analyze_cpu_values_correct():
    response = client.post("/api/v1/analytics/analyze", json={"records": [VALID_RECORD]})
    cpu = response.json()["cpu"]
    assert cpu["mean"] == pytest.approx(45.0)
    assert cpu["min"] == pytest.approx(45.0)
    assert cpu["max"] == pytest.approx(45.0)


def test_analyze_percentile_matches_linear_interpolation():
    records = [
        {**VALID_RECORD, "cpu_utilization": value}
        for value in [10.0, 50.0, 80.0]
    ]
    response = client.post("/api/v1/analytics/analyze", json={"records": records})

    assert response.status_code == 200
    assert response.json()["cpu"]["p90"] == pytest.approx(74.0)


def test_analyze_zero_utilization_is_valid_and_flagged_by_rule():
    record = {
        **VALID_RECORD,
        "cpu_utilization": 0.0,
        "memory_utilization": 0.0,
    }
    response = client.post("/api/v1/analytics/analyze", json={"records": [record]})

    assert response.status_code == 200
    body = response.json()
    assert body["cpu"]["mean"] == 0.0
    assert body["memory"]["mean"] == 0.0
    assert body["underutilization"]["flagged_count"] == 1


def test_analyze_underutil_flagged():
    response = client.post(
        "/api/v1/analytics/analyze",
        json={"records": [VALID_RECORD, LOW_RECORD]},
    )
    body = response.json()
    assert body["underutilization"]["flagged_count"] == 1
    assert "job-low" in body["underutilization"]["flagged_workload_ids"]


def test_analyze_data_quality_missing_latency():
    response = client.post("/api/v1/analytics/analyze", json={"records": [VALID_RECORD]})
    dq = response.json()["data_quality"]
    assert dq["missing_latency_count"] == 1
    assert dq["records_with_latency"] == 0


def test_analyze_empty_records_rejected():
    response = client.post("/api/v1/analytics/analyze", json={"records": []})
    assert response.status_code == 422


def test_analyze_invalid_cpu_rejected():
    bad = {**VALID_RECORD, "cpu_utilization": 999.0}
    response = client.post("/api/v1/analytics/analyze", json={"records": [bad]})
    assert response.status_code == 422


def test_analyze_missing_required_field_rejected():
    bad = {k: v for k, v in VALID_RECORD.items() if k != "duration_seconds"}
    response = client.post("/api/v1/analytics/analyze", json={"records": [bad]})
    assert response.status_code == 422


def test_analyze_trend_ordered_ascending():
    response = client.post(
        "/api/v1/analytics/analyze",
        json={"records": [LOW_RECORD, VALID_RECORD]},  # LOW is later, send out of order
    )
    trend = response.json()["trend"]
    assert trend[0]["timestamp"] < trend[1]["timestamp"]
