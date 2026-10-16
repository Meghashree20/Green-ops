"""Analytics service: statistics and underutilisation detection.

All calculations use only the data supplied by the caller.
Values labelled ESTIMATED are derived from configurable thresholds, not measurements.
Missing optional fields (latency_p99_ms) are counted but never substituted with zero.
"""

from typing import Optional

import numpy as np
import pandas as pd

from backend.config import settings
from backend.schemas.analytics import (
    AnalyticsResult,
    AnalyzeRequest,
    CpuStats,
    DataQuality,
    MemoryStats,
    TrendPoint,
    UnderutilizationSummary,
)


def _cpu_stats(cpu: pd.Series) -> CpuStats:
    return CpuStats(
        mean=round(float(cpu.mean()), 4),
        min=round(float(cpu.min()), 4),
        max=round(float(cpu.max()), 4),
        p50=round(float(np.percentile(cpu, 50)), 4),
        p90=round(float(np.percentile(cpu, 90)), 4),
        p95=round(float(np.percentile(cpu, 95)), 4),
    )


def _memory_stats(mem: pd.Series) -> MemoryStats:
    return MemoryStats(
        mean=round(float(mem.mean()), 4),
        peak=round(float(mem.max()), 4),
    )


def _trend(df: pd.DataFrame) -> list[TrendPoint]:
    """Return records sorted ascending by timestamp."""
    sorted_df = df.sort_values("timestamp")
    return [
        TrendPoint(
            timestamp=row["timestamp"].isoformat(),
            cpu_utilization=round(float(row["cpu_utilization"]), 4),
            memory_utilization=round(float(row["memory_utilization"]), 4),
        )
        for _, row in sorted_df.iterrows()
    ]


def _underutilization(df: pd.DataFrame) -> UnderutilizationSummary:
    """
    ESTIMATED: A record is flagged when BOTH cpu_utilization < cpu_threshold
    AND memory_utilization < mem_threshold.

    Thresholds are configurable via UNDERUTIL_CPU_THRESHOLD_PCT and
    UNDERUTIL_MEM_THRESHOLD_PCT environment variables (defaults: 20 % each).
    Do not reduce resources based solely on this flag without validating
    against actual performance constraints.
    """
    cpu_thresh = settings.underutil_cpu_threshold_pct
    mem_thresh = settings.underutil_mem_threshold_pct

    mask = (df["cpu_utilization"] < cpu_thresh) & (df["memory_utilization"] < mem_thresh)
    flagged_df = df[mask]

    return UnderutilizationSummary(
        flagged_count=int(mask.sum()),
        total_count=len(df),
        cpu_threshold_pct=cpu_thresh,
        mem_threshold_pct=mem_thresh,
        flagged_workload_ids=sorted(flagged_df["workload_id"].unique().tolist()),
    )


def _data_quality(df: pd.DataFrame) -> DataQuality:
    total = len(df)
    with_latency = int(df["latency_p99_ms"].notna().sum())
    return DataQuality(
        total_records=total,
        records_with_latency=with_latency,
        missing_latency_count=total - with_latency,
    )


def analyze(request: AnalyzeRequest) -> AnalyticsResult:
    """
    Run analytics over the supplied records and return structured results.

    Raises ValueError if the records list is empty (Pydantic min_length=1
    should prevent this at the API layer, but the service is defensive).
    """
    if not request.records:
        raise ValueError("At least one record is required for analysis.")

    rows = [
        {
            "workload_id": r.workload_id,
            "timestamp": pd.Timestamp(r.timestamp),
            "cpu_utilization": r.cpu_utilization,
            "memory_utilization": r.memory_utilization,
            "duration_seconds": r.duration_seconds,
            # NaN for absent latency — never substituted with 0
            "latency_p99_ms": r.latency_p99_ms if r.latency_p99_ms is not None else float("nan"),
        }
        for r in request.records
    ]

    df = pd.DataFrame(rows)

    return AnalyticsResult(
        record_count=len(df),
        cpu=_cpu_stats(df["cpu_utilization"]),
        memory=_memory_stats(df["memory_utilization"]),
        trend=_trend(df),
        underutilization=_underutilization(df),
        data_quality=_data_quality(df),
    )
