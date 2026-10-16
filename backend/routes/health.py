"""Health-check route."""

from fastapi import APIRouter
from backend.schemas.health import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse, tags=["Health"])
def health_check() -> HealthResponse:
    """Returns service liveness status."""
    return HealthResponse(status="ok", service="greenops-backend")
