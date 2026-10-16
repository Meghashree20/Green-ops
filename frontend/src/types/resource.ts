export interface ResourceRecordInput {
  workload_id: string
  timestamp: string
  cpu_utilization: number
  memory_utilization: number
  duration_seconds: number
  latency_p99_ms?: number | null
}

export interface ResourceRecord extends Omit<ResourceRecordInput, 'latency_p99_ms'> {
  id: string
  created_at: string
  latency_p99_ms: number | null
}

export interface ResourceRecordPage {
  total: number
  page: number
  page_size: number
  records: ResourceRecord[]
}

export interface CsvUploadSummary {
  inserted_count: number
  rejected_count: number
  errors: string[]
}
