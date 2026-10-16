"""Pydantic schemas for resource usage records."""

from datetime import datetime, timezone
from typing import Annotated, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


# ── Shared field constraints ──────────────────────────────────────────────────

CpuField = Annotated[float, Field(ge=0.0, le=100.0, description="CPU utilisation (%)")]
MemField = Annotated[float, Field(ge=0.0, le=100.0, description="Memory utilisation (%)")]
DurationField = Annotated[float, Field(gt=0.0, description="Workload duration (seconds)")]
LatencyField = Annotated[Optional[float], Field(default=None, ge=0.0, description="P99 latency (ms)")]


# ── Request ───────────────────────────────────────────────────────────────────

class ResourceRecordIn(BaseModel):
    workload_id: str = Field(
        min_length=1,
        max_length=128,
        description="Unique workload or job identifier.",
        examples=["batch-job-42"],
    )
    timestamp: datetime = Field(
        description="ISO-8601 timestamp of the observation. UTC assumed if no timezone is supplied.",
        examples=["2024-06-01T12:00:00Z"],
    )
    cpu_utilization: CpuField
    memory_utilization: MemField
    duration_seconds: DurationField
    latency_p99_ms: LatencyField = None

    @field_validator("workload_id")
    @classmethod
    def strip_workload_id(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("workload_id must not be blank.")
        return v

    @field_validator("timestamp")
    @classmethod
    def normalise_timestamp(cls, v: datetime) -> datetime:
        """Attach UTC if the timestamp is naive."""
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v

    @model_validator(mode="after")
    def latency_requires_duration(self) -> "ResourceRecordIn":
        """Latency is only meaningful alongside a positive duration."""
        if self.latency_p99_ms is not None and self.duration_seconds <= 0:
            raise ValueError("latency_p99_ms requires a positive duration_seconds.")
        return self


# ── Response ──────────────────────────────────────────────────────────────────

class ResourceRecordOut(BaseModel):
    id: str = Field(description="MongoDB document _id as a string.")
    workload_id: str
    timestamp: datetime
    cpu_utilization: float
    memory_utilization: float
    duration_seconds: float
    latency_p99_ms: Optional[float] = None
    created_at: datetime


# ── Paginated list response ───────────────────────────────────────────────────

class ResourceRecordPage(BaseModel):
    total: int = Field(description="Total matching records (unpaginated).")
    page: int
    page_size: int
    records: list[ResourceRecordOut]


# ── CSV Upload Response ───────────────────────────────────────────────────────

class CsvUploadSummary(BaseModel):
    inserted_count: int = Field(description="Number of records successfully parsed and inserted.")
    rejected_count: int = Field(description="Number of rows rejected due to schema or parsing errors.")
    errors: list[str] = Field(default_factory=list, description="Descriptive errors for rejected rows (1-indexed).")
