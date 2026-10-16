"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.config import settings
from backend.db.mongo import close_client
from backend.middleware import CsvUploadSizeLimitMiddleware, MAX_CSV_REQUEST_BODY_BYTES
from backend.routes.health import router as health_router
from backend.routes.resources import router as resources_router
from backend.routes.analytics import router as analytics_router
from backend.routes.estimation import router as estimation_router
from backend.routes.recommendations import router as recommendations_router

@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        yield
    finally:
        close_client()


app = FastAPI(
    title="GreenOps Backend",
    description="Data-driven cloud resource efficiency and carbon impact advisor.",
    version="0.1.0",
    lifespan=lifespan,
)


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(
    _: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    details = [
        {
            "loc": list(error["loc"]),
            "msg": error["msg"],
            "type": error["type"],
        }
        for error in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": details})


app.add_middleware(
    CsvUploadSizeLimitMiddleware,
    max_bytes=MAX_CSV_REQUEST_BODY_BYTES,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

app.include_router(health_router, prefix="/api/v1")
app.include_router(resources_router, prefix="/api/v1")
app.include_router(analytics_router, prefix="/api/v1")
app.include_router(estimation_router, prefix="/api/v1")
app.include_router(recommendations_router, prefix="/api/v1")
