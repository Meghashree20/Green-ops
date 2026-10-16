import type { AnalyticsResult, AnalyzeRequest } from '../types/analytics'
import type { EstimationRequest, EstimationResult } from '../types/estimation'
import type {
  RecommendationRequest,
  RecommendationResponse,
} from '../types/recommendation'
import type {
  CsvUploadSummary,
  ResourceRecord,
  ResourceRecordInput,
  ResourceRecordPage,
} from '../types/resource'

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
).replace(/\/+$/, '')

export interface HealthResponse {
  status: string
  service: string
}

export interface ResourceQuery {
  page?: number
  page_size?: number
  from_dt?: string
  to_dt?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly responseBody: unknown

  constructor(
    message: string,
    status: number,
    responseBody: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.responseBody = responseBody
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T | undefined> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_BASE_URL}${normalizedPath}`, {
    ...init,
    headers,
  })

  if (!response.ok) {
    const responseText = await response.text()
    let responseBody: unknown = responseText
    try {
      responseBody = JSON.parse(responseText) as unknown
    } catch {
      // Keep non-JSON error bodies available as text.
    }
    throw new ApiError(
      `API request failed with status ${response.status}`,
      response.status,
      responseBody,
    )
  }

  if (response.status === 204) {
    return undefined
  }
  return (await response.json()) as T
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const result = await apiFetch<HealthResponse>('/api/v1/health', { signal })
  if (!result) throw new Error('The health endpoint returned an empty response.')
  return result
}

export async function listResourceRecords(
  query: ResourceQuery = {},
  signal?: AbortSignal,
): Promise<ResourceRecordPage> {
  const params = new URLSearchParams()
  if (query.page !== undefined) params.set('page', String(query.page))
  if (query.page_size !== undefined) params.set('page_size', String(query.page_size))
  if (query.from_dt) params.set('from_dt', query.from_dt)
  if (query.to_dt) params.set('to_dt', query.to_dt)
  const queryString = params.size > 0 ? `?${params.toString()}` : ''
  const result = await apiFetch<ResourceRecordPage>(
    `/api/v1/resources${queryString}`,
    { signal },
  )
  if (!result) throw new Error('The resource list endpoint returned an empty response.')
  return result
}

export async function createResourceRecord(
  record: ResourceRecordInput,
): Promise<ResourceRecord> {
  const result = await apiFetch<ResourceRecord>('/api/v1/resources', {
    method: 'POST',
    body: JSON.stringify(record),
  })
  if (!result) throw new Error('The resource create endpoint returned an empty response.')
  return result
}

export async function uploadResourceCsv(file: File): Promise<CsvUploadSummary> {
  const body = new FormData()
  body.append('file', file)
  const result = await apiFetch<CsvUploadSummary>(
    '/api/v1/resources/upload-csv',
    { method: 'POST', body },
  )
  if (!result) throw new Error('The CSV upload endpoint returned an empty response.')
  return result
}

export async function analyzeResourceRecords(
  request: AnalyzeRequest,
): Promise<AnalyticsResult> {
  const result = await apiFetch<AnalyticsResult>('/api/v1/analytics/analyze', {
    method: 'POST',
    body: JSON.stringify(request),
  })
  if (!result) throw new Error('The analytics endpoint returned an empty response.')
  return result
}

export async function estimateWorkload(
  request: EstimationRequest,
): Promise<EstimationResult> {
  const result = await apiFetch<EstimationResult>('/api/v1/estimation/estimate', {
    method: 'POST',
    body: JSON.stringify(request),
  })
  if (!result) throw new Error('The estimation endpoint returned an empty response.')
  return result
}

export async function evaluateWorkload(
  request: RecommendationRequest,
): Promise<RecommendationResponse> {
  const result = await apiFetch<RecommendationResponse>(
    '/api/v1/recommendations/evaluate',
    {
      method: 'POST',
      body: JSON.stringify(request),
    },
  )
  if (!result) throw new Error('The recommendation endpoint returned an empty response.')
  return result
}
