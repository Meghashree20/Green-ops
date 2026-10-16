"""Smoke tests for Phase 1 scaffold."""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch

from backend.main import app

client = TestClient(app)


def test_health_returns_200():
    response = client.get("/api/v1/health")
    assert response.status_code == 200


def test_health_response_body():
    response = client.get("/api/v1/health")
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "greenops-backend"


def test_api_routes_are_registered_under_v1():
    paths = app.openapi()["paths"]
    expected_methods = {
        "/api/v1/health": {"get"},
        "/api/v1/resources": {"get", "post"},
        "/api/v1/resources/upload-csv": {"post"},
        "/api/v1/analytics/analyze": {"post"},
        "/api/v1/estimation/estimate": {"post"},
        "/api/v1/recommendations/evaluate": {"post"},
    }

    assert {
        path: {method for method in operations if method in {"get", "post"}}
        for path, operations in paths.items()
        if path.startswith("/api/v1/")
    } == expected_methods


def test_health_content_type():
    response = client.get("/api/v1/health")
    assert "application/json" in response.headers["content-type"]


def test_cors_header_present():
    """React dev server (localhost:3000) must be allowed."""
    response = client.get(
        "/api/v1/health",
        headers={"Origin": "http://localhost:3000"},
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert response.headers.get("access-control-allow-credentials") is None


def test_cors_preflight_restricts_methods_and_headers():
    response = client.options(
        "/api/v1/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert "GET" in response.headers.get("access-control-allow-methods", "")
    assert "*" not in response.headers.get("access-control-allow-methods", "")
    assert response.headers.get("access-control-allow-credentials") is None


def test_cors_does_not_allow_unconfigured_origin():
    response = client.get(
        "/api/v1/health",
        headers={"Origin": "https://unconfigured.example"},
    )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") is None


def test_app_shutdown_closes_database_client():
    with patch("backend.main.close_client") as close_client:
        with TestClient(app):
            pass

    close_client.assert_called_once_with()


def test_unknown_route_returns_404():
    response = client.get("/api/v1/nonexistent")
    assert response.status_code == 404
