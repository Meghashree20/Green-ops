"""Tests for CSV upload endpoint POST /api/v1/resources/upload-csv."""

import io
from unittest.mock import patch
from fastapi.testclient import TestClient
from pymongo.errors import ServerSelectionTimeoutError

from backend.main import app

client = TestClient(app)


def test_upload_csv_success():
    csv_data = (
        "workload_id,timestamp,cpu_utilization,memory_utilization,duration_seconds\n"
        "job-1,2024-06-01T12:00:00Z,25.0,30.0,120.0\n"
        "job-2,2024-06-01T12:05:00Z,40.0,50.0,60.0\n"
    )
    files = {"file": ("data.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")}

    with patch("backend.routes.resources.repo.insert_records", return_value=[]):
        response = client.post("/api/v1/resources/upload-csv", files=files)

    assert response.status_code == 200
    data = response.json()
    assert data["inserted_count"] == 2
    assert data["rejected_count"] == 0
    assert data["errors"] == []


def test_upload_csv_partial_validation_failure():
    csv_data = (
        "workload_id,timestamp,cpu_utilization,memory_utilization,duration_seconds\n"
        "job-valid,2024-06-01T12:00:00Z,25.0,30.0,120.0\n"
        "job-invalid,2024-06-01T12:05:00Z,150.0,50.0,60.0\n"  # cpu > 100
    )
    files = {"file": ("data.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")}

    with patch("backend.routes.resources.repo.insert_records", return_value=[]):
        response = client.post("/api/v1/resources/upload-csv", files=files)

    assert response.status_code == 200
    data = response.json()
    assert data["inserted_count"] == 1
    assert data["rejected_count"] == 1
    assert len(data["errors"]) == 1
    assert "Row 3:" in data["errors"][0]


def test_upload_csv_missing_required_column_rejects_row():
    csv_data = (
        "workload_id,timestamp,cpu_utilization,duration_seconds\n"
        "job-1,2024-06-01T12:00:00Z,25.0,120.0\n"
    )
    files = {"file": ("data.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")}

    with patch("backend.routes.resources.repo.insert_records") as insert_records:
        response = client.post("/api/v1/resources/upload-csv", files=files)

    assert response.status_code == 200
    data = response.json()
    assert data["inserted_count"] == 0
    assert data["rejected_count"] == 1
    assert "memory_utilization" in data["errors"][0]
    insert_records.assert_not_called()


def test_upload_csv_validation_errors_do_not_echo_uploaded_values():
    csv_data = (
        "workload_id,timestamp,cpu_utilization,memory_utilization,duration_seconds\n"
        "private-workload,2024-06-01T12:00:00Z,secret-value,30.0,120.0\n"
    )
    files = {"file": ("data.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")}

    response = client.post("/api/v1/resources/upload-csv", files=files)

    assert response.status_code == 200
    assert "cpu_utilization" in response.json()["errors"][0]
    assert "secret-value" not in response.text
    assert "private-workload" not in response.text


def test_upload_csv_file_size_is_limited(monkeypatch):
    monkeypatch.setattr("backend.routes.resources.MAX_CSV_UPLOAD_BYTES", 8)
    files = {"file": ("data.csv", io.BytesIO(b"a,b\n123,456\n"), "text/csv")}

    response = client.post("/api/v1/resources/upload-csv", files=files)

    assert response.status_code == 413


def test_upload_csv_row_count_is_limited(monkeypatch):
    monkeypatch.setattr("backend.routes.resources.MAX_CSV_ROWS", 1)
    csv_data = (
        "workload_id,timestamp,cpu_utilization,memory_utilization,duration_seconds\n"
        "job-1,2024-06-01T12:00:00Z,25.0,30.0,120.0\n"
        "job-2,2024-06-01T12:05:00Z,40.0,50.0,60.0\n"
    )
    files = {"file": ("data.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")}

    response = client.post("/api/v1/resources/upload-csv", files=files)

    assert response.status_code == 413


def test_upload_non_csv_rejected():
    files = {"file": ("data.txt", io.BytesIO(b"hello world"), "text/plain")}
    response = client.post("/api/v1/resources/upload-csv", files=files)
    assert response.status_code == 400
    assert "Uploaded file must be a .csv file" in response.json()["detail"]


def test_upload_csv_storage_failure():
    csv_data = (
        "workload_id,timestamp,cpu_utilization,memory_utilization,duration_seconds\n"
        "job-1,2024-06-01T12:00:00Z,25.0,30.0,120.0\n"
    )
    files = {"file": ("data.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")}

    with patch("backend.routes.resources.repo.insert_records", side_effect=RuntimeError("DB down")):
        response = client.post("/api/v1/resources/upload-csv", files=files)

    assert response.status_code == 503
    assert "Storage unavailable" in response.json()["detail"]


def test_upload_csv_index_failure_returns_503():
    csv_data = (
        "workload_id,timestamp,cpu_utilization,memory_utilization,duration_seconds\n"
        "job-1,2024-06-01T12:00:00Z,25.0,30.0,120.0\n"
    )
    files = {"file": ("data.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")}

    with patch(
        "backend.db.resource_repository._ensure_indexes",
        side_effect=ServerSelectionTimeoutError("database unavailable"),
    ):
        response = client.post("/api/v1/resources/upload-csv", files=files)

    assert response.status_code == 503
    assert "Storage unavailable" in response.json()["detail"]
