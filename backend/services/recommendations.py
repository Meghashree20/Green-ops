"""Rule-based recommendation service.

Advises on resource configuration based on historical resource utilization,
explicit allocations and stated performance constraints.

Key Guardrails:
- Never automatically mutates infrastructure or allocations.
- Never recommends downsizing based on a single sample.
- If data count is below threshold, returns INSUFFICIENT_DATA.
- Never recommends downsizing if latency violations or high peak usage are detected.
- Distinguishes measured evidence from estimated benefits.
"""

import numpy as np
import pandas as pd

from backend.schemas.recommendation import (
    ConfidenceLevel,
    PerformanceConstraints,
    PotentialBenefit,
    RecommendationCategory,
    RecommendationEvidence,
    RecommendationItem,
    RecommendationRequest,
    RecommendationResponse,
    SufficiencyStatus,
    WorkloadAllocations,
)


def evaluate_recommendations(request: RecommendationRequest) -> RecommendationResponse:
    records = request.records
    min_samples = request.min_samples_threshold
    constraints = request.constraints or PerformanceConstraints()
    allocations = request.allocations

    if not records:
        # Zero records
        evidence = RecommendationEvidence(
            sample_count=0,
        )
        return RecommendationResponse(
            workload_id="unknown",
            recommendation=RecommendationItem(
                category=RecommendationCategory.INSUFFICIENT_DATA,
                sufficiency_status=SufficiencyStatus.INSUFFICIENT,
                confidence=ConfidenceLevel.NONE,
                reason="No resource usage records provided for evaluation.",
                evidence=evidence,
                warnings=["Cannot generate recommendations without observation history."],
                verification_conditions=["Collect and submit at least 5 resource history samples."],
            ),
        )

    workload_id = records[0].workload_id
    sample_count = len(records)

    # Convert to pandas DataFrame for aggregations
    df = pd.DataFrame([r.model_dump() for r in records])

    cpu_mean = float(df["cpu_utilization"].mean())
    cpu_peak = float(df["cpu_utilization"].max())
    cpu_p95 = float(np.percentile(df["cpu_utilization"], 95))

    mem_mean = float(df["memory_utilization"].mean())
    mem_peak = float(df["memory_utilization"].max())

    # Latency inspection
    has_latency = df["latency_p99_ms"].notna().any()
    max_latency = float(df["latency_p99_ms"].dropna().max()) if has_latency else None

    latency_violations = 0
    if constraints.max_latency_p99_ms is not None and has_latency:
        latency_violations = int(
            (df["latency_p99_ms"].dropna() > constraints.max_latency_p99_ms).sum()
        )

    evidence = RecommendationEvidence(
        sample_count=sample_count,
        mean_cpu_pct=round(cpu_mean, 2),
        peak_cpu_pct=round(cpu_peak, 2),
        p95_cpu_pct=round(cpu_p95, 2),
        mean_memory_pct=round(mem_mean, 2),
        peak_memory_pct=round(mem_peak, 2),
        observed_p99_latency_max_ms=round(max_latency, 2) if max_latency is not None else None,
        latency_violations_count=latency_violations,
    )

    warnings: list[str] = [
        "Advisory only. Recommendations must be evaluated against business SLAs before applying.",
    ]
    verification_conditions: list[str] = [
        "Verify downstream batch schedules or impending cyclical traffic surges.",
        "Check that testing in a staging environment preserves target SLAs.",
    ]

    # Rule 1: Single sample or insufficient samples
    effective_min_samples = max(min_samples, 2)
    if sample_count < effective_min_samples:
        return RecommendationResponse(
            workload_id=workload_id,
            recommendation=RecommendationItem(
                category=RecommendationCategory.INSUFFICIENT_DATA,
                sufficiency_status=SufficiencyStatus.INSUFFICIENT,
                confidence=ConfidenceLevel.LOW,
                reason=(
                    f"Sample count ({sample_count}) is below minimum threshold "
                    f"({effective_min_samples}). "
                    "Downsizing is prohibited from a single sample or sparse history."
                ),
                evidence=evidence,
                warnings=warnings + ["Resource downscaling requires broader observation windows."],
                verification_conditions=[
                    f"Gather at least {effective_min_samples} representative workload observations.",
                ],
            ),
        )

    # Rule 2: Overutilization / Bottleneck -> RIGHTSIZE_UP
    # Peak CPU > 85% or Peak Memory > 85% or Latency SLA violations
    if cpu_peak > 85.0 or mem_peak > 85.0 or latency_violations > 0:
        reasons = []
        if cpu_peak > 85.0:
            reasons.append(f"Peak CPU utilization reached {cpu_peak:.1f}%")
        if mem_peak > 85.0:
            reasons.append(f"Peak memory utilization reached {mem_peak:.1f}%")
        if latency_violations > 0:
            reasons.append(f"Recorded {latency_violations} SLA latency violation(s)")

        return RecommendationResponse(
            workload_id=workload_id,
            recommendation=RecommendationItem(
                category=RecommendationCategory.RIGHTSIZE_UP,
                sufficiency_status=SufficiencyStatus.SUFFICIENT,
                confidence=ConfidenceLevel.HIGH,
                reason="Workload is under-provisioned or experiencing contention: " + "; ".join(reasons),
                evidence=evidence,
                warnings=warnings + ["Risk of throttling or out-of-memory errors under peak demand."],
                verification_conditions=verification_conditions + [
                    "Evaluate whether horizontal scaling or vertical sizing is preferred.",
                ],
            ),
        )

    # Rule 3: Downsizing candidate -> RIGHTSIZE_DOWN
    # Conditions: P95 CPU < 35%, Peak Memory < 50%, no latency violations
    if cpu_p95 < 35.0 and mem_peak < 50.0 and latency_violations == 0:
        # Calculate defensible benefits if allocations are provided
        potential_benefit = None
        if allocations and allocations.hourly_rate_usd:
            # Illustrative scenario only; target headroom is a verification condition.
            suggested_downsize_pct = 25.0
            savings_usd = round(allocations.hourly_rate_usd * (suggested_downsize_pct / 100.0), 4)
            potential_benefit = PotentialBenefit(
                description="Illustrative estimated cost savings from a 25% downscaling scenario.",
                estimated_cpu_reduction_pct=suggested_downsize_pct,
                estimated_memory_reduction_pct=suggested_downsize_pct,
                estimated_hourly_cost_savings_usd=savings_usd,
                calculation_basis=(
                    f"Scenario calculation: 25% of the supplied hourly rate "
                    f"(${allocations.hourly_rate_usd:.4f}). The requested "
                    f"{constraints.target_cpu_headroom_pct}% CPU headroom is a verification "
                    "condition; it is not calculated against the supplied allocation."
                ),
            )
        elif allocations:
            potential_benefit = PotentialBenefit(
                description="Estimated compute/memory reduction potential.",
                estimated_cpu_reduction_pct=25.0,
                estimated_memory_reduction_pct=25.0,
                calculation_basis="Based on P95 CPU and peak memory usage remaining well below capacity.",
            )

        return RecommendationResponse(
            workload_id=workload_id,
            recommendation=RecommendationItem(
                category=RecommendationCategory.RIGHTSIZE_DOWN,
                sufficiency_status=SufficiencyStatus.SUFFICIENT,
                confidence=ConfidenceLevel.HIGH if sample_count >= 10 else ConfidenceLevel.MEDIUM,
                reason=(
                    f"Sustained low utilization: P95 CPU is {cpu_p95:.1f}% and peak memory is {mem_peak:.1f}%, "
                    f"well within safety headroom."
                ),
                evidence=evidence,
                potential_benefit=potential_benefit,
                warnings=warnings + [
                    "Ensure downsizing does not impact unexpected periodic peak workloads.",
                ],
                verification_conditions=verification_conditions + [
                    f"Confirm that reduced instance preserves at least {constraints.target_cpu_headroom_pct}% CPU headroom.",
                ],
            ),
        )

    # Rule 4: MAINTAIN (Balanced or Moderate Utilization)
    return RecommendationResponse(
        workload_id=workload_id,
        recommendation=RecommendationItem(
            category=RecommendationCategory.MAINTAIN,
            sufficiency_status=SufficiencyStatus.SUFFICIENT,
            confidence=ConfidenceLevel.HIGH,
            reason="Workload resources are adequately sized for observed demand with healthy headroom.",
            evidence=evidence,
            warnings=warnings,
            verification_conditions=verification_conditions,
        ),
    )
