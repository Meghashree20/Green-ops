"""Pydantic schemas for analytics request and response."""

from typing import Optional
from pydantic import BaseModel, Field

from backend.schemas.resource import ResourceRecordIn


# ── Request ───────────────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    records: list[ResourceRecordIn] = Field(
        min_length=1,
        max_length=10_000,
        description="1 to 10,000 validated resource usage records to analyse.",
    )


# ── CPU / memory stat blocks ──────────────────────────────────────────────────

class CpuStats(BaseModel):
    mean: float
    min: float
    max: float
    p50: float = Field(description="50th-percentile (median) CPU utilisation (%).")
    p90: float = Field(description="90th-percentile CPU utilisation (%).")
    p95: float = Field(description="95th-percentile CPU utilisation (%).")


class MemoryStats(BaseModel):
    mean: float
    peak: float = Field(description="Maximum memory utilisation observed (%).")


# ── Trend point ───────────────────────────────────────────────────────────────

class TrendPoint(BaseModel):
    timestamp: str = Field(description="ISO-8601 timestamp of the observation.")
    cpu_utilization: float
    memory_utilization: float


# ── Underutilisation ─────────────────────────────────────────────────────────

class UnderutilizationSummary(BaseModel):
    flagged_count: int = Field(
        description=(
            "Number of records where BOTH cpu_utilization and memory_utilization "
            "are below the configured thresholds. This is an estimate based on "
            "configurable rules, not a direct measurement."
        )
    )
    total_count: int
    cpu_threshold_pct: float = Field(
        description="CPU threshold used for this analysis (configurable estimate)."
    )
    mem_threshold_pct: float = Field(
        description="Memory threshold used for this analysis (configurable estimate)."
    )
    flagged_workload_ids: list[str] = Field(
        description="Distinct workload IDs that appear in flagged records."
    )


# ── Data-quality summary ──────────────────────────────────────────────────────

class DataQuality(BaseModel):
    total_records: int
    records_with_latency: int = Field(
        description="Records that include an optional latency_p99_ms value."
    )
    missing_latency_count: int = Field(
        description="Records where latency_p99_ms is absent (not treated as zero)."
    )


# ── Top-level response ────────────────────────────────────────────────────────

class AnalyticsResult(BaseModel):
    record_count: int
    cpu: CpuStats
    memory: MemoryStats
    trend: list[TrendPoint] = Field(
        description="Records sorted by timestamp ascending, for time-series display."
    )
    underutilization: UnderutilizationSummary
    data_quality: DataQuality
