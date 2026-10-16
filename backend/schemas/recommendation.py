"""Pydantic schemas for the recommendation engine."""

from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field

from backend.schemas.resource import ResourceRecordIn


class RecommendationCategory(str, Enum):
    RIGHTSIZE_DOWN = "RIGHTSIZE_DOWN"
    RIGHTSIZE_UP = "RIGHTSIZE_UP"
    MAINTAIN = "MAINTAIN"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"


class SufficiencyStatus(str, Enum):
    SUFFICIENT = "SUFFICIENT"
    INSUFFICIENT = "INSUFFICIENT"
    MARGINAL = "MARGINAL"


class ConfidenceLevel(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    NONE = "NONE"


class PerformanceConstraints(BaseModel):
    """Explicit performance SLAs/constraints for workload safety."""
    max_latency_p99_ms: Optional[float] = Field(
        default=None,
        gt=0.0,
        description="Target maximum acceptable P99 latency in ms.",
    )
    target_cpu_headroom_pct: float = Field(
        default=20.0,
        ge=0.0,
        le=50.0,
        description="Safety buffer headroom above observed peak CPU (%). Default is 20%.",
    )


class WorkloadAllocations(BaseModel):
    """Configured limits/allocations for the workload."""
    allocated_cpu_cores: Optional[float] = Field(
        default=None,
        gt=0.0,
        description="Allocated virtual CPU cores (e.g. 4.0 cores).",
    )
    allocated_memory_gb: Optional[float] = Field(
        default=None,
        gt=0.0,
        description="Allocated memory in GB (e.g. 16.0 GB).",
    )
    hourly_rate_usd: Optional[float] = Field(
        default=None,
        gt=0.0,
        description="Current hourly cost in USD for calculation of potential monetary savings.",
    )


class RecommendationEvidence(BaseModel):
    sample_count: int
    mean_cpu_pct: Optional[float] = None
    peak_cpu_pct: Optional[float] = None
    p95_cpu_pct: Optional[float] = None
    mean_memory_pct: Optional[float] = None
    peak_memory_pct: Optional[float] = None
    observed_p99_latency_max_ms: Optional[float] = None
    latency_violations_count: int = 0


class PotentialBenefit(BaseModel):
    description: str
    estimated_cpu_reduction_pct: Optional[float] = None
    estimated_memory_reduction_pct: Optional[float] = None
    estimated_hourly_cost_savings_usd: Optional[float] = None
    calculation_basis: Optional[str] = None


class RecommendationItem(BaseModel):
    category: RecommendationCategory
    sufficiency_status: SufficiencyStatus
    confidence: ConfidenceLevel
    reason: str
    evidence: RecommendationEvidence
    potential_benefit: Optional[PotentialBenefit] = None
    warnings: list[str] = Field(default_factory=list)
    verification_conditions: list[str] = Field(default_factory=list)


class RecommendationRequest(BaseModel):
    records: list[ResourceRecordIn] = Field(
        max_length=10_000,
        description="Up to 10,000 resource history records. Single sample will never trigger downsizing."
    )
    allocations: Optional[WorkloadAllocations] = None
    constraints: Optional[PerformanceConstraints] = None
    min_samples_threshold: int = Field(
        default=5,
        ge=1,
        description="Minimum observations required to consider data sufficient for downsizing.",
    )


class RecommendationResponse(BaseModel):
    workload_id: str
    recommendation: RecommendationItem
