"""Analytics endpoint."""

from fastapi import APIRouter, HTTPException, status

from backend.schemas.analytics import AnalyzeRequest, AnalyticsResult
from backend.services import analytics as svc

router = APIRouter(tags=["Analytics"])


@router.post(
    "/analytics/analyze",
    response_model=AnalyticsResult,
    summary="Analyse a set of resource usage records.",
    description=(
        "Accepts one or more validated resource records and returns utilisation "
        "statistics, time-series trends, underutilisation flags (ESTIMATED), "
        "and data-quality counts."
    ),
)
def analyze(payload: AnalyzeRequest) -> AnalyticsResult:
    try:
        return svc.analyze(payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
