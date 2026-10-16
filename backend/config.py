"""Application configuration loaded from environment variables."""

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # MongoDB
    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "greenops"

    # Application
    app_env: str = "development"
    log_level: str = "info"

    # CORS – comma-separated list of allowed origins
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @field_validator("cors_origins")
    @classmethod
    def validate_cors_origins(cls, value: str) -> str:
        origins = [origin.strip() for origin in value.split(",") if origin.strip()]
        if not origins:
            raise ValueError("CORS_ORIGINS must contain at least one origin.")
        if "*" in origins:
            raise ValueError("CORS_ORIGINS must not contain a wildcard origin.")
        return ",".join(origins)

    # ── Analytics thresholds ──────────────────────────────────────────────────
    # A record is flagged as potentially underutilised when BOTH conditions hold:
    #   cpu_utilization  < UNDERUTIL_CPU_THRESHOLD_PCT   (default 20 %)
    #   memory_utilization < UNDERUTIL_MEM_THRESHOLD_PCT (default 20 %)
    # These are documented estimates; lower both to tighten the rule.
    underutil_cpu_threshold_pct: float = Field(default=20.0, ge=0.0, le=100.0)
    underutil_mem_threshold_pct: float = Field(default=20.0, ge=0.0, le=100.0)

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
