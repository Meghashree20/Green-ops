import type { ResourceRecordInput } from './resource'

export type RecommendationCategory =
  | 'RIGHTSIZE_DOWN'
  | 'RIGHTSIZE_UP'
  | 'MAINTAIN'
  | 'INSUFFICIENT_DATA'

export type SufficiencyStatus = 'SUFFICIENT' | 'INSUFFICIENT' | 'MARGINAL'
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'

export interface WorkloadAllocations {
  allocated_cpu_cores?: number | null
  allocated_memory_gb?: number | null
  hourly_rate_usd?: number | null
}

export interface PerformanceConstraints {
  max_latency_p99_ms?: number | null
  target_cpu_headroom_pct?: number
}

export interface RecommendationRequest {
  records: ResourceRecordInput[]
  allocations?: WorkloadAllocations | null
  constraints?: PerformanceConstraints | null
  min_samples_threshold?: number
}

export interface RecommendationEvidence {
  sample_count: number
  mean_cpu_pct: number | null
  peak_cpu_pct: number | null
  p95_cpu_pct: number | null
  mean_memory_pct: number | null
  peak_memory_pct: number | null
  observed_p99_latency_max_ms: number | null
  latency_violations_count: number
}

export interface PotentialBenefit {
  description: string
  estimated_cpu_reduction_pct: number | null
  estimated_memory_reduction_pct: number | null
  estimated_hourly_cost_savings_usd: number | null
  calculation_basis: string | null
}

export interface RecommendationItem {
  category: RecommendationCategory
  sufficiency_status: SufficiencyStatus
  confidence: ConfidenceLevel
  reason: string
  evidence: RecommendationEvidence
  potential_benefit: PotentialBenefit | null
  warnings: string[]
  verification_conditions: string[]
}

export interface RecommendationResponse {
  workload_id: string
  recommendation: RecommendationItem
}
