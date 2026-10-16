"""Unit tests for the analytics service.

Tests exercise the service directly (no HTTP, no MongoDB).
"""

import pytest
from backend.schemas.analytics import AnalyzeRequest
from backend.services.analytics import analyze

# ── Fixtures ──────────────────────────────────────────────────────────────────

RECORD_A = dict(
    workload_id="job-high",
    timestamp="2024-06-01T08:00:00Z",
    cpu_utilization=80.0,
    memory_utilization=75.0,
    duration_seconds=300.0,
)

RECORD_B = dict(
    workload_id="job-low",
    timestamp="2024-06-01T09:00:00Z",
    cpu_utilization=10.0,
    memory_utilization=12.0,
    duration_seconds=120.0,
)

RECORD_C = dict(
    workload_id="job-mid",
    timestamp="2024-06-01T07:00:00Z",
    cpu_utilization=50.0,
    memory_utilization=50.0,
    duration_seconds=600.0,
    latency_p99_ms=25.5,
)


def _req(*records) -> AnalyzeRequest:
    return AnalyzeRequest(records=list(records))


# ── record_count ──────────────────────────────────────────────────────────────

def test_record_count():
    result = analyze(_req(RECORD_A, RECORD_B, RECORD_C))
    assert result.record_count == 3


# ── CPU stats ─────────────────────────────────────────────────────────────────

def test_cpu_mean():
    result = analyze(_req(RECORD_A, RECORD_B))
    assert result.cpu.mean == pytest.approx(45.0, abs=1e-3)


def test_cpu_min():
    result = analyze(_req(RECORD_A, RECORD_B))
    assert result.cpu.min == pytest.approx(10.0)


def test_cpu_max():
    result = analyze(_req(RECORD_A, RECORD_B))
    assert result.cpu.max == pytest.approx(80.0)


def test_cpu_p50_single_record():
    result = analyze(_req(RECORD_A))
    assert result.cpu.p50 == pytest.approx(80.0)


def test_cpu_p90_three_records():
    result = analyze(_req(RECORD_A, RECORD_B, RECORD_C))
    # NumPy's default linear percentile interpolation: 50 + 0.8 * (80 - 50).
    assert result.cpu.p90 == pytest.approx(74.0)


# ── Memory stats ──────────────────────────────────────────────────────────────

def test_memory_mean():
    result = analyze(_req(RECORD_A, RECORD_B))
    assert result.memory.mean == pytest.approx(43.5, abs=1e-3)


def test_memory_peak():
    result = analyze(_req(RECORD_A, RECORD_B, RECORD_C))
    assert result.memory.peak == pytest.approx(75.0)


# ── Trend ─────────────────────────────────────────────────────────────────────

def test_trend_sorted_ascending():
    result = analyze(_req(RECORD_A, RECORD_B, RECORD_C))
    timestamps = [p.timestamp for p in result.trend]
    # RECORD_C is earliest (07:00), RECORD_A next (08:00), RECORD_B last (09:00)
    assert timestamps[0] < timestamps[1] < timestamps[2]


def test_trend_length_matches_records():
    result = analyze(_req(RECORD_A, RECORD_B))
    assert len(result.trend) == 2


# ── Underutilisation ─────────────────────────────────────────────────────────

def test_underutilization_flagged_correctly():
    # RECORD_B: cpu=10, mem=12 → both below default 20 % threshold → flagged
    result = analyze(_req(RECORD_A, RECORD_B))
    assert result.underutilization.flagged_count == 1
    assert "job-low" in result.underutilization.flagged_workload_ids


def test_underutilization_not_flagged_when_above_threshold():
    result = analyze(_req(RECORD_A))
    assert result.underutilization.flagged_count == 0
    assert result.underutilization.flagged_workload_ids == []


def test_underutilization_total_count():
    result = analyze(_req(RECORD_A, RECORD_B, RECORD_C))
    assert result.underutilization.total_count == 3


def test_underutilization_threshold_values_in_response():
    result = analyze(_req(RECORD_A))
    assert result.underutilization.cpu_threshold_pct == 20.0
    assert result.underutilization.mem_threshold_pct == 20.0


def test_zero_and_full_utilization_are_valid():
    zero = {**RECORD_A, "cpu_utilization": 0.0, "memory_utilization": 0.0}
    full = {**RECORD_B, "cpu_utilization": 100.0, "memory_utilization": 100.0}

    result = analyze(_req(zero, full))

    assert result.cpu.mean == pytest.approx(50.0)
    assert result.cpu.min == pytest.approx(0.0)
    assert result.cpu.max == pytest.approx(100.0)
    assert result.memory.mean == pytest.approx(50.0)
    assert result.memory.peak == pytest.approx(100.0)


def test_threshold_comparison_is_strict_at_default_boundary():
    cpu_boundary = {**RECORD_A, "cpu_utilization": 20.0, "memory_utilization": 19.0}
    memory_boundary = {**RECORD_B, "cpu_utilization": 19.0, "memory_utilization": 20.0}

    result = analyze(_req(cpu_boundary, memory_boundary))

    assert result.underutilization.flagged_count == 0


# ── Data quality ──────────────────────────────────────────────────────────────

def test_data_quality_total():
    result = analyze(_req(RECORD_A, RECORD_B, RECORD_C))
    assert result.data_quality.total_records == 3


def test_data_quality_latency_present():
    # Only RECORD_C has latency
    result = analyze(_req(RECORD_A, RECORD_B, RECORD_C))
    assert result.data_quality.records_with_latency == 1
    assert result.data_quality.missing_latency_count == 2


def test_data_quality_no_latency_at_all():
    result = analyze(_req(RECORD_A, RECORD_B))
    assert result.data_quality.records_with_latency == 0
    assert result.data_quality.missing_latency_count == 2


def test_data_quality_all_latency_present():
    rec_with_lat = {**RECORD_B, "latency_p99_ms": 5.0}
    result = analyze(_req(RECORD_C, rec_with_lat))
    assert result.data_quality.records_with_latency == 2
    assert result.data_quality.missing_latency_count == 0


# ── Edge cases ────────────────────────────────────────────────────────────────

def test_single_record_all_stats_valid():
    result = analyze(_req(RECORD_A))
    assert result.cpu.mean == result.cpu.min == result.cpu.max == 80.0
    assert result.memory.mean == result.memory.peak == 75.0


def test_all_records_flagged():
    low_a = {**RECORD_A, "cpu_utilization": 5.0, "memory_utilization": 5.0, "workload_id": "low-a"}
    low_b = {**RECORD_B, "cpu_utilization": 8.0, "memory_utilization": 9.0, "workload_id": "low-b"}
    result = analyze(_req(low_a, low_b))
    assert result.underutilization.flagged_count == 2


def test_empty_records_raises():
    with pytest.raises(Exception):
        # Pydantic min_length=1 raises ValidationError before reaching service
        AnalyzeRequest(records=[])


@pytest.mark.parametrize(
    "invalid_timestamp",
    ["", "not-a-timestamp", None],
)
def test_invalid_or_missing_timestamp_rejected(invalid_timestamp):
    from pydantic import ValidationError

    record = {**RECORD_A, "timestamp": invalid_timestamp}
    with pytest.raises(ValidationError):
        AnalyzeRequest(records=[record])


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("cpu_utilization", -0.1),
        ("cpu_utilization", 100.1),
        ("memory_utilization", -0.1),
        ("memory_utilization", 100.1),
        ("duration_seconds", 0),
        ("duration_seconds", -1),
        ("latency_p99_ms", -0.1),
    ],
)
def test_invalid_record_numeric_boundaries_rejected(field, value):
    from pydantic import ValidationError

    record = {**RECORD_A, field: value}
    with pytest.raises(ValidationError):
        AnalyzeRequest(records=[record])
