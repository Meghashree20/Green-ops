
"""FastAPI application entry point for GreenOps."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.config import settings
from backend.db.mongo import close_client
from backend.middleware import (
    CsvUploadSizeLimitMiddleware,
    MAX_CSV_REQUEST_BODY_BYTES,
)
from backend.routes.health import router as health_router
from backend.routes.resources import router as resources_router
from backend.routes.analytics import router as analytics_router
from backend.routes.estimation import router as estimation_router
from backend.routes.recommendations import router as recommendations_router


# Locate the built frontend directory.
BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
FRONTEND_INDEX = FRONTEND_DIST / "index.html"


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


# Handle request validation errors.
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


# Request size limit for CSV uploads.
app.add_middleware(
    CsvUploadSizeLimitMiddleware,
    max_bytes=MAX_CSV_REQUEST_BODY_BYTES,
)


# Configure CORS for the frontend origins in settings.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


# Register API routes before the frontend fallback.
app.include_router(health_router, prefix="/api/v1")
app.include_router(resources_router, prefix="/api/v1")
app.include_router(analytics_router, prefix="/api/v1")
app.include_router(estimation_router, prefix="/api/v1")
app.include_router(recommendations_router, prefix="/api/v1")


# Serve the built frontend if it exists.
if FRONTEND_INDEX.is_file():
    # Serve static assets such as JS, CSS, and images.
    assets_dir = FRONTEND_DIST / "assets"

    if assets_dir.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=str(assets_dir)),
            name="frontend-assets",
        )

    # Serve Vite's other public files, if present.
    # The root and fallback routes are registered below.


    @app.get("/", include_in_schema=False)
    async def frontend_root():
        from fastapi.responses import FileResponse

        return FileResponse(str(FRONTEND_INDEX))


    @app.get("/{full_path:path}", include_in_schema=False)
    async def frontend_fallback(full_path: str):
        from fastapi.responses import FileResponse

        # Never return index.html for unknown API endpoints.
        if full_path == "api" or full_path.startswith("api/"):
            return JSONResponse(
                status_code=404,
                content={"detail": "API endpoint not found"},
            )

        # Serve an existing frontend file, if present.
        requested_file = (FRONTEND_DIST / full_path).resolve()

        if (
            requested_file.is_relative_to(FRONTEND_DIST.resolve())
            and requested_file.is_file()
        ):
            return FileResponse(str(requested_file))

        # Support React Router routes such as /dashboard.
        return FileResponse(str(FRONTEND_INDEX))

else:
    # Allow the backend to start even when the frontend build is missing.
    @app.get("/", include_in_schema=False)
    async def backend_root():
        return {
            "message": "GreenOps Backend is running",
            "status": "success",
            "frontend": "Frontend build not found",
            "expected_path": str(FRONTEND_INDEX),
            "docs": "/docs",
            "api_prefix": "/api/v1",
        }
