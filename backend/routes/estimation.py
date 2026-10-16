"""Estimation endpoint — cost and carbon impact."""

from fastapi import APIRouter, HTTPException, status

from backend.schemas.estimation import EstimationRequest, EstimationResult
from backend.services import estimation as svc

router = APIRouter(tags=["Estimation"])


@router.post(
    "/estimation/estimate",
    response_model=EstimationResult,
    summary="Estimate infrastructure cost and carbon impact.",
    description=(
        "Returns ESTIMATED compute cost, workload-proportional cost, energy and "
        "carbon emissions from caller-supplied assumptions. No live cloud prices "
        "are fetched. All estimates are clearly labelled and include the assumptions "
        "used so results are fully reproducible."
    ),
)
def estimate(payload: EstimationRequest) -> EstimationResult:
    try:
        return svc.estimate(payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )
