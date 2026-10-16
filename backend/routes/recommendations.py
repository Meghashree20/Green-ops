"""Recommendation API routes."""

from fastapi import APIRouter
from backend.schemas.recommendation import RecommendationRequest, RecommendationResponse
from backend.services import recommendations as svc

router = APIRouter(tags=["Recommendations"])


@router.post(
    "/recommendations/evaluate",
    response_model=RecommendationResponse,
    summary="Evaluate workload history and generate sizing recommendations.",
    description=(
        "Analyzes resource history, allocations, and constraints to produce explainable, "
        "evidence-backed recommendations without automatic changes."
    ),
)
def evaluate_recommendations(request: RecommendationRequest) -> RecommendationResponse:
    return svc.evaluate_recommendations(request)
