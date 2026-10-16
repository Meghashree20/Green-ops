"""Tests for /api/v1/resources endpoints.

The repository is monkeypatched so no real MongoDB connection is required.
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import patch
from fastapi.testclient import TestClient
from pymongo.errors import ServerSelectionTimeoutError

from backend.main import app
from backend.schemas.resource import ResourceRecordOut, ResourceRecordPage

client = TestClient(app)

_STORED = ResourceRecordOut(
    id="507f1f77bcf86cd799439011",
    workload_id="job-1",
    timestamp=datetime(2024, 6, 1, 12, 0, 0, tzinfo=timezone.utc),
    cpu_utilization=45.0,
    memory_utilization=60.0,
    duration_seconds=300.0,
    latency_p99_ms=None,
    created_at=datetime(2024, 6, 1, 12, 0, 1, tzinfo=timezone.utc),
)

VALID_PAYLOAD = dict(
    workload_id="job-1",
    timestamp="2024-06-01T12:00:00Z",
    cpu_utilization=45.0,
    memory_utilization=60.0,
    duration_seconds=300.0,
)


# ── POST /resources ───────────────────────────────────────────────────────────

def test_create_record_201():
    with patch("backend.routes.resources.repo.insert_record", return_value=_STORED):
        response = client.post("/api/v1/resources", json=VALID_PAYLOAD)
    assert response.status_code == 201
    assert response.json()["workload_id"] == "job-1"
    assert response.json()["id"] == "507f1f77bcf86cd799439011"


def test_create_record_db_failure_returns_503():
    with patch("backend.routes.resources.repo.insert_record", side_effect=RuntimeError("db error")):
        response = client.post("/api/v1/resources", json=VALID_PAYLOAD)
    assert response.status_code == 503
    # Must not leak internal details
    assert "db error" not in response.text
    assert "traceback" not in response.text.lower()


def test_create_record_index_failure_returns_503():
    with patch(
        "backend.db.resource_repository._ensure_indexes",
        side_effect=ServerSelectionTimeoutError("database unavailable"),
    ):
        response = client.post("/api/v1/resources", json=VALID_PAYLOAD)
    assert response.status_code == 503
    assert "database unavailable" not in response.text


def test_create_record_invalid_cpu_returns_422():
    bad = {**VALID_PAYLOAD, "cpu_utilization": "sensitive-invalid-input"}
    response = client.post("/api/v1/resources", json=bad)
    assert response.status_code == 422
    assert "sensitive-invalid-input" not in response.text
    assert '"input"' not in response.text
    assert "cpu_utilization" in response.text


def test_create_record_missing_field_returns_422():
    bad = {k: v for k, v in VALID_PAYLOAD.items() if k != "memory_utilization"}
    response = client.post("/api/v1/resources", json=bad)
    assert response.status_code == 422


# ── GET /resources ────────────────────────────────────────────────────────────

def test_list_records_200():
    page = ResourceRecordPage(total=1, page=1, page_size=20, records=[_STORED])
    with patch("backend.routes.resources.repo.fetch_records", return_value=([_STORED], 1)):
        response = client.get("/api/v1/resources")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert len(body["records"]) == 1


def test_list_records_empty():
    with patch("backend.routes.resources.repo.fetch_records", return_value=([], 0)):
        response = client.get("/api/v1/resources")
    assert response.status_code == 200
    assert response.json()["total"] == 0


def test_list_records_db_failure_returns_503():
    with patch("backend.routes.resources.repo.fetch_records", side_effect=RuntimeError("db error")):
        response = client.get("/api/v1/resources")
    assert response.status_code == 503


def test_list_records_invalid_date_range_returns_422():
    with patch("backend.routes.resources.repo.fetch_records", return_value=([], 0)):
        response = client.get(
            "/api/v1/resources",
            params={"from_dt": "2024-12-01T00:00:00Z", "to_dt": "2024-01-01T00:00:00Z"},
        )
    assert response.status_code == 422


def test_list_records_normalizes_naive_date_filter_to_utc():
    with patch(
        "backend.routes.resources.repo.fetch_records",
        return_value=([], 0),
    ) as fetch_records:
        response = client.get(
            "/api/v1/resources",
            params={
                "from_dt": "2024-01-01T00:00:00",
                "to_dt": "2024-01-02T00:00:00Z",
            },
        )

    assert response.status_code == 200
    args = fetch_records.call_args.args
    assert args[2].tzinfo == timezone.utc
    assert args[3].tzinfo == timezone.utc


def test_list_records_page_size_capped():
    """page_size > 100 should be rejected by FastAPI query validation."""
    response = client.get("/api/v1/resources", params={"page_size": 200})
    assert response.status_code == 422


def test_list_records_page_number_is_capped():
    response = client.get("/api/v1/resources", params={"page": 10_001})
    assert response.status_code == 422
