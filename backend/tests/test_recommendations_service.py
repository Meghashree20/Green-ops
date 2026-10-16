"""Unit tests for the rule-based recommendation service."""

import pytest
from datetime import datetime, timezone

from pydantic import ValidationError

from backend.schemas.recommendation import (
    ConfidenceLevel,
    PerformanceConstraints,
    RecommendationCategory,
    RecommendationRequest,
    SufficiencyStatus,
    WorkloadAllocations,
)
from backend.schemas.resource import ResourceRecordIn
from backend.services.recommendations import evaluate_recommendations


def _make_record(
    workload_id="test-job",
    cpu=20.0,
    mem=25.0,
    duration=60.0,
    latency=None,
    minute=0,
) -> ResourceRecordIn:
    return ResourceRecordIn(
        workload_id=workload_id,
        timestamp=datetime(2024, 6, 1, 10, minute, 0, tzinfo=timezone.utc),
        cpu_utilization=cpu,
        memory_utilization=mem,
        duration_seconds=duration,
        latency_p99_ms=latency,
    )


# ── Empty Dataset ─────────────────────────────────────────────────────────────

def test_empty_dataset_insufficient_data():
    req = RecommendationRequest(records=[])
    res = evaluate_recommendations(req)
    assert res.recommendation.category == RecommendationCategory.INSUFFICIENT_DATA
    assert res.recommendation.sufficiency_status == SufficiencyStatus.INSUFFICIENT
    assert res.recommendation.confidence == ConfidenceLevel.NONE
    assert res.recommendation.evidence.sample_count == 0
    assert res.recommendation.evidence.mean_cpu_pct is None
    assert res.recommendation.evidence.peak_cpu_pct is None
    assert res.recommendation.evidence.p95_cpu_pct is None
    assert res.recommendation.evidence.mean_memory_pct is None
    assert res.recommendation.evidence.peak_memory_pct is None
    assert res.recommendation.potential_benefit is None
    assert "No resource usage records" in res.recommendation.reason


def test_same_workload_id_records_are_accepted_for_evaluation():
    records = [
        _make_record(workload_id="service-alpha", cpu=15.0, mem=20.0, minute=i)
        for i in range(6)
    ]

    req = RecommendationRequest(records=records)
    result = evaluate_recommendations(req)

    assert result.workload_id == "service-alpha"
    assert result.recommendation.category == RecommendationCategory.RIGHTSIZE_DOWN


def test_mixed_workload_ids_are_rejected_before_service_evaluation():
    records = [
        _make_record(workload_id="service-alpha", minute=0),
        _make_record(workload_id="service-beta", minute=1),
    ]

    with pytest.raises(
        ValidationError,
        match="All records in a recommendation request must have the same workload_id",
    ):
        RecommendationRequest(records=records)


# ── Single Sample Guard ───────────────────────────────────────────────────────

def test_single_sample_never_downsizes():
    # Even if utilization is 1%, single sample should trigger INSUFFICIENT_DATA, not RIGHTSIZE_DOWN
    record = _make_record(cpu=1.0, mem=2.0)
    req = RecommendationRequest(records=[record], min_samples_threshold=5)
    res = evaluate_recommendations(req)
    assert res.recommendation.category == RecommendationCategory.INSUFFICIENT_DATA
    assert res.recommendation.sufficiency_status == SufficiencyStatus.INSUFFICIENT
    assert "below minimum threshold" in res.recommendation.reason


def test_single_sample_never_downsizes_when_configured_threshold_is_one():
    record = _make_record(cpu=1.0, mem=2.0)
    req = RecommendationRequest(records=[record], min_samples_threshold=1)
    res = evaluate_recommendations(req)
    assert res.recommendation.category == RecommendationCategory.INSUFFICIENT_DATA
    assert "minimum threshold (2)" in res.recommendation.reason


# ── Rightsize Up: Peak CPU / Memory / Latency SLA violations ──────────────────

def test_rightsize_up_on_high_peak_cpu():
    records = [_make_record(cpu=30.0, minute=i) for i in range(5)]
    records.append(_make_record(cpu=92.0, minute=5))  # Peak > 85%
    req = RecommendationRequest(records=records, min_samples_threshold=5)
    res = evaluate_recommendations(req)
    assert res.recommendation.category == RecommendationCategory.RIGHTSIZE_UP
    assert res.recommendation.confidence == ConfidenceLevel.HIGH
    assert "Peak CPU utilization reached 92.0%" in res.recommendation.reason


def test_rightsize_up_cpu_rule_is_strictly_greater_than_85():
    records = [_make_record(cpu=85.0, mem=30.0, minute=i) for i in range(5)]
    res = evaluate_recommendations(
        RecommendationRequest(records=records, min_samples_threshold=5)
    )
    assert res.recommendation.category == RecommendationCategory.MAINTAIN


def test_rightsize_down_requires_p95_cpu_below_35_and_peak_memory_below_50():
    cpu_boundary = [_make_record(cpu=35.0, mem=20.0, minute=i) for i in range(6)]
    memory_boundary = [_make_record(cpu=20.0, mem=50.0, minute=i) for i in range(6)]

    cpu_result = evaluate_recommendations(
        RecommendationRequest(records=cpu_boundary, min_samples_threshold=5)
    )
    memory_result = evaluate_recommendations(
        RecommendationRequest(records=memory_boundary, min_samples_threshold=5)
    )

    assert cpu_result.recommendation.category == RecommendationCategory.MAINTAIN
    assert memory_result.recommendation.category == RecommendationCategory.MAINTAIN


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("cpu_utilization", -0.1),
        ("cpu_utilization", 100.1),
        ("memory_utilization", -0.1),
        ("memory_utilization", 100.1),
        ("duration_seconds", 0.0),
        ("duration_seconds", -1.0),
        ("latency_p99_ms", -0.1),
    ],
)
def test_invalid_recommendation_record_values_rejected(field, value):
    from pydantic import ValidationError

    record = {
        "workload_id": "test-job",
        "timestamp": datetime(2024, 6, 1, 10, 0, tzinfo=timezone.utc),
        "cpu_utilization": 20.0,
        "memory_utilization": 25.0,
        "duration_seconds": 60.0,
        "latency_p99_ms": None,
    }
    record[field] = value

    with pytest.raises(ValidationError):
        ResourceRecordIn(**record)


def test_rightsize_up_on_high_peak_memory():
    records = [_make_record(mem=30.0, minute=i) for i in range(5)]
    records.append(_make_record(mem=89.0, minute=5))  # Peak > 85%
    req = RecommendationRequest(records=records, min_samples_threshold=5)
    res = evaluate_recommendations(req)
    assert res.recommendation.category == RecommendationCategory.RIGHTSIZE_UP
    assert "Peak memory utilization reached 89.0%" in res.recommendation.reason


def test_rightsize_up_on_latency_violation():
    records = [_make_record(cpu=10.0, mem=15.0, latency=150.0, minute=i) for i in range(5)]
    constraints = PerformanceConstraints(max_latency_p99_ms=100.0)
    req = RecommendationRequest(records=records, constraints=constraints, min_samples_threshold=5)
    res = evaluate_recommendations(req)
    assert res.recommendation.category == RecommendationCategory.RIGHTSIZE_UP
    assert res.recommendation.evidence.latency_violations_count == 5
    assert "SLA latency violation" in res.recommendation.reason


def test_missing_latency_with_constraint_does_not_recommend_downsize():
    records = [_make_record(cpu=15.0, mem=20.0, minute=i) for i in range(6)]
    req = RecommendationRequest(
        records=records,
        constraints=PerformanceConstraints(max_latency_p99_ms=100.0),
    )

    recommendation = evaluate_recommendations(req).recommendation

    assert recommendation.category == RecommendationCategory.MAINTAIN
    assert recommendation.sufficiency_status == SufficiencyStatus.MARGINAL
    assert recommendation.confidence == ConfidenceLevel.LOW
    assert recommendation.potential_benefit is None
    assert "latency constraint cannot be evaluated" in recommendation.reason
    assert any(
        "Latency compliance cannot be determined" in warning
        and "6 of 6 observations" in warning
        for warning in recommendation.warnings
    )


def test_partially_missing_latency_with_constraint_does_not_recommend_downsize():
    records = [
        _make_record(cpu=15.0, mem=20.0, latency=80.0 if minute < 5 else None, minute=minute)
        for minute in range(6)
    ]
    req = RecommendationRequest(
        records=records,
        constraints=PerformanceConstraints(max_latency_p99_ms=100.0),
    )

    recommendation = evaluate_recommendations(req).recommendation

    assert recommendation.category == RecommendationCategory.MAINTAIN
    assert recommendation.sufficiency_status == SufficiencyStatus.MARGINAL
    assert recommendation.confidence == ConfidenceLevel.LOW
    assert recommendation.evidence.observed_p99_latency_max_ms == pytest.approx(80.0)
    assert recommendation.evidence.latency_violations_count == 0
    assert any(
        "Latency compliance cannot be determined" in warning
        and "1 of 6 observations" in warning
        for warning in recommendation.warnings
    )


def test_complete_compliant_latency_allows_existing_downsize_rule():
    records = [
        _make_record(cpu=15.0, mem=20.0, latency=80.0, minute=minute)
        for minute in range(6)
    ]
    req = RecommendationRequest(
        records=records,
        constraints=PerformanceConstraints(max_latency_p99_ms=100.0),
    )

    recommendation = evaluate_recommendations(req).recommendation

    assert recommendation.category == RecommendationCategory.RIGHTSIZE_DOWN
    assert recommendation.sufficiency_status == SufficiencyStatus.SUFFICIENT
    assert recommendation.confidence == ConfidenceLevel.MEDIUM
    assert recommendation.evidence.latency_violations_count == 0
    assert not any(
        "Latency compliance cannot be determined" in warning
        for warning in recommendation.warnings
    )


def test_missing_latency_without_constraint_preserves_existing_downsize_rule():
    records = [_make_record(cpu=15.0, mem=20.0, minute=i) for i in range(6)]
    req = RecommendationRequest(records=records)

    recommendation = evaluate_recommendations(req).recommendation

    assert recommendation.category == RecommendationCategory.RIGHTSIZE_DOWN
    assert recommendation.sufficiency_status == SufficiencyStatus.SUFFICIENT
    assert recommendation.confidence == ConfidenceLevel.MEDIUM
    assert recommendation.evidence.observed_p99_latency_max_ms is None
    assert recommendation.evidence.latency_violations_count == 0
    assert not any(
        "Latency compliance cannot be determined" in warning
        for warning in recommendation.warnings
    )


# ── Rightsize Down: Low Utilization with Sufficient Samples ───────────────────

def test_rightsize_down_with_calculated_benefit():
    # 6 samples of low utilization
    records = [_make_record(cpu=15.0, mem=20.0, minute=i) for i in range(6)]
    allocations = WorkloadAllocations(
        allocated_cpu_cores=4.0,
        allocated_memory_gb=16.0,
        hourly_rate_usd=0.80,
    )
    req = RecommendationRequest(records=records, allocations=allocations, min_samples_threshold=5)
    res = evaluate_recommendations(req)

    assert res.recommendation.category == RecommendationCategory.RIGHTSIZE_DOWN
    assert res.recommendation.sufficiency_status == SufficiencyStatus.SUFFICIENT
    assert res.recommendation.potential_benefit is not None
    # 25% of 0.80 = 0.20
    assert res.recommendation.potential_benefit.estimated_hourly_cost_savings_usd == pytest.approx(0.20)
    assert res.recommendation.potential_benefit.estimated_cpu_reduction_pct == 25.0
    basis = res.recommendation.potential_benefit.calculation_basis
    assert basis is not None
    assert "verification condition" in basis
    assert "not calculated against the supplied allocation" in basis


def test_rightsize_down_without_rate():
    records = [_make_record(cpu=12.0, mem=18.0, minute=i) for i in range(6)]
    req = RecommendationRequest(records=records, min_samples_threshold=5)
    res = evaluate_recommendations(req)

    assert res.recommendation.category == RecommendationCategory.RIGHTSIZE_DOWN
    assert res.recommendation.potential_benefit is None  # Cannot calculate defensible monetary benefit without rates


# ── Maintain: Balanced Workload ───────────────────────────────────────────────

def test_maintain_healthy_workload():
    # Moderate utilization (e.g. CPU 50%, Mem 60%)
    records = [_make_record(cpu=50.0, mem=60.0, minute=i) for i in range(6)]
    req = RecommendationRequest(records=records, min_samples_threshold=5)
    res = evaluate_recommendations(req)

    assert res.recommendation.category == RecommendationCategory.MAINTAIN
    assert res.recommendation.sufficiency_status == SufficiencyStatus.SUFFICIENT
    assert "adequately sized" in res.recommendation.reason
