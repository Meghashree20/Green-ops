"""Tests for ResourceRecordIn schema validation."""

import pytest
from datetime import datetime, timezone
from pydantic import ValidationError

from backend.schemas.resource import ResourceRecordIn

VALID = dict(
    workload_id="job-1",
    timestamp="2024-06-01T12:00:00Z",
    cpu_utilization=45.0,
    memory_utilization=60.0,
    duration_seconds=300.0,
)


def test_valid_record_passes():
    r = ResourceRecordIn(**VALID)
    assert r.workload_id == "job-1"
    assert r.cpu_utilization == 45.0


def test_timestamp_naive_gets_utc():
    data = {**VALID, "timestamp": "2024-06-01T12:00:00"}  # no tz
    r = ResourceRecordIn(**data)
    assert r.timestamp.tzinfo == timezone.utc


def test_cpu_below_zero_rejected():
    with pytest.raises(ValidationError):
        ResourceRecordIn(**{**VALID, "cpu_utilization": -1.0})


def test_cpu_above_100_rejected():
    with pytest.raises(ValidationError):
        ResourceRecordIn(**{**VALID, "cpu_utilization": 100.1})


def test_memory_above_100_rejected():
    with pytest.raises(ValidationError):
        ResourceRecordIn(**{**VALID, "memory_utilization": 101.0})


def test_duration_zero_rejected():
    with pytest.raises(ValidationError):
        ResourceRecordIn(**{**VALID, "duration_seconds": 0.0})


def test_duration_negative_rejected():
    with pytest.raises(ValidationError):
        ResourceRecordIn(**{**VALID, "duration_seconds": -5.0})


def test_empty_workload_id_rejected():
    with pytest.raises(ValidationError):
        ResourceRecordIn(**{**VALID, "workload_id": ""})


def test_whitespace_workload_id_rejected():
    with pytest.raises(ValidationError):
        ResourceRecordIn(**{**VALID, "workload_id": "   "})


def test_optional_latency_accepted():
    r = ResourceRecordIn(**{**VALID, "latency_p99_ms": 12.5})
    assert r.latency_p99_ms == 12.5


def test_latency_negative_rejected():
    with pytest.raises(ValidationError):
        ResourceRecordIn(**{**VALID, "latency_p99_ms": -1.0})


def test_missing_required_field_rejected():
    data = {k: v for k, v in VALID.items() if k != "cpu_utilization"}
    with pytest.raises(ValidationError):
        ResourceRecordIn(**data)
