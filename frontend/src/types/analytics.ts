import type { ResourceRecordInput } from './resource'

export interface AnalyzeRequest {
  records: ResourceRecordInput[]
}

export interface CpuStats {
  mean: number
  min: number
  max: number
  p50: number
  p90: number
  p95: number
}

export interface MemoryStats {
  mean: number
  peak: number
}

export interface TrendPoint {
  timestamp: string
  cpu_utilization: number
  memory_utilization: number
}

export interface UnderutilizationSummary {
  flagged_count: number
  total_count: number
  cpu_threshold_pct: number
  mem_threshold_pct: number
  flagged_workload_ids: string[]
}

export interface DataQuality {
  total_records: number
  records_with_latency: number
  missing_latency_count: number
}

export interface AnalyticsResult {
  record_count: number
  cpu: CpuStats
  memory: MemoryStats
  trend: TrendPoint[]
  underutilization: UnderutilizationSummary
  data_quality: DataQuality
}
