"""Tests for backend environment configuration."""

import pytest
from pydantic import ValidationError

from backend.config import Settings


def test_database_configuration_defaults():
    config = Settings(_env_file=None)

    assert config.mongodb_uri == "mongodb://localhost:27017"
    assert config.mongodb_db_name == "greenops"


def test_database_configuration_reads_environment(monkeypatch):
    monkeypatch.setenv("MONGODB_URI", "mongodb://db.example:27017")
    monkeypatch.setenv("MONGODB_DB_NAME", "greenops_test")
    config = Settings(_env_file=None)

    assert config.mongodb_uri == "mongodb://db.example:27017"
    assert config.mongodb_db_name == "greenops_test"


def test_cors_defaults_are_local_frontend_origins():
    config = Settings(_env_file=None)

    assert config.cors_origins_list == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


def test_wildcard_cors_origin_is_rejected():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, cors_origins="*")


def test_invalid_numeric_environment_setting_is_rejected(monkeypatch):
    monkeypatch.setenv("UNDERUTIL_CPU_THRESHOLD_PCT", "not-a-number")

    with pytest.raises(ValidationError):
        Settings(_env_file=None)


@pytest.mark.parametrize(
    ("setting", "value"),
    [
        ("UNDERUTIL_CPU_THRESHOLD_PCT", "-0.1"),
        ("UNDERUTIL_CPU_THRESHOLD_PCT", "100.1"),
        ("UNDERUTIL_MEM_THRESHOLD_PCT", "-0.1"),
        ("UNDERUTIL_MEM_THRESHOLD_PCT", "100.1"),
    ],
)
def test_utilization_thresholds_must_be_percentages(monkeypatch, setting, value):
    monkeypatch.setenv(setting, value)

    with pytest.raises(ValidationError):
        Settings(_env_file=None)
