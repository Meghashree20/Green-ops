"""Request-size limits for analytics and recommendation batches."""

import pytest
from pydantic import ValidationError

from backend.schemas.analytics import AnalyzeRequest
from backend.schemas.recommendation import RecommendationRequest
from backend.schemas.resource import ResourceRecordIn


def test_analytics_batch_limit():
    record = ResourceRecordIn(
        workload_id="bounded-test",
        timestamp="2024-06-01T12:00:00Z",
        cpu_utilization=20,
        memory_utilization=30,
        duration_seconds=60,
    )

    with pytest.raises(ValidationError):
        AnalyzeRequest(records=[record] * 10_001)


def test_recommendation_batch_limit():
    record = ResourceRecordIn(
        workload_id="bounded-test",
        timestamp="2024-06-01T12:00:00Z",
        cpu_utilization=20,
        memory_utilization=30,
        duration_seconds=60,
    )

    with pytest.raises(ValidationError):
        RecommendationRequest(records=[record] * 10_001)
