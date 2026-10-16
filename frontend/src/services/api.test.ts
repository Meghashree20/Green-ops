import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  analyzeResourceRecords,
  ApiError,
  createResourceRecord,
  evaluateWorkload,
  estimateWorkload,
  getHealth,
  listResourceRecords,
  listResourceRecordsForAnalysis,
  uploadResourceCsv,
} from './api'
import { jsonResponse } from '../test/setup'

describe('shared API client', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    fetchMock.mockReset()
  })

  it('requests health at the configured API base URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok', service: 'greenops-backend' }))

    await expect(getHealth()).resolves.toEqual({
      status: 'ok',
      service: 'greenops-backend',
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8000/api/v1/health',
    )
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined()
  })

  it('uses the backend pagination and date filter query names', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ total: 0, page: 2, page_size: 10, records: [] }),
    )

    await listResourceRecords({
      page: 2,
      page_size: 10,
      from_dt: '2026-10-01T00:00:00Z',
      to_dt: '2026-10-02T00:00:00Z',
    })

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8000/api/v1/resources?page=2&page_size=10&from_dt=2026-10-01T00%3A00%3A00Z&to_dt=2026-10-02T00%3A00%3A00Z',
    )
  })

  it('loads every resource page for analytics with the selected date filters', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input))
      const page = Number(url.searchParams.get('page'))
      const record = (index: number) => ({
        id: `id-${index}`,
        created_at: '2026-10-01T00:00:00Z',
        workload_id: `job-${index}`,
        timestamp: '2026-10-01T00:00:00Z',
        cpu_utilization: 20,
        memory_utilization: 25,
        duration_seconds: 10,
        latency_p99_ms: null,
      })
      return jsonResponse({
        total: 101,
        page,
        page_size: 100,
        records: page === 1
          ? Array.from({ length: 100 }, (_, index) => record(index))
          : [record(100)],
      })
    })

    const records = await listResourceRecordsForAnalysis({
      from_dt: '2026-10-01T00:00:00Z',
      to_dt: '2026-10-02T00:00:00Z',
    })

    expect(records).toHaveLength(101)
    expect(records[0]?.workload_id).toBe('job-0')
    expect(records[100]?.workload_id).toBe('job-100')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [input] of fetchMock.mock.calls) {
      const url = new URL(String(input))
      expect(url.searchParams.get('page_size')).toBe('100')
      expect(url.searchParams.get('from_dt')).toBe('2026-10-01T00:00:00Z')
      expect(url.searchParams.get('to_dt')).toBe('2026-10-02T00:00:00Z')
    }
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('page')).toBe('1')
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get('page')).toBe('2')
  })

  it('rejects analytics periods larger than the backend request limit', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({
      total: 10_001,
      page: 1,
      page_size: 100,
      records: Array.from({ length: 100 }, (_, index) => ({
        id: `id-${index}`,
        created_at: '2026-10-01T00:00:00Z',
        workload_id: `job-${index}`,
        timestamp: '2026-10-01T00:00:00Z',
        cpu_utilization: 20,
        memory_utilization: 25,
        duration_seconds: 10,
        latency_p99_ms: null,
      })),
    }))

    await expect(listResourceRecordsForAnalysis({})).rejects.toThrow(
      'The selected period contains 10,001 records. Narrow the period to 10,000 records or fewer',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects changed page totals instead of returning incomplete analytics data', async () => {
    fetchMock.mockImplementation(async (input) => {
      const page = Number(new URL(String(input)).searchParams.get('page'))
      return jsonResponse({
        total: page === 1 ? 101 : 102,
        page,
        page_size: 100,
        records: Array.from({ length: 100 }, (_, index) => ({
          id: `id-${index}`,
          created_at: '2026-10-01T00:00:00Z',
          workload_id: `job-${index}`,
          timestamp: '2026-10-01T00:00:00Z',
          cpu_utilization: 20,
          memory_utilization: 25,
          duration_seconds: 10,
          latency_p99_ms: null,
        })),
      })
    })

    await expect(listResourceRecordsForAnalysis({})).rejects.toThrow(
      'The resource list changed while pages were loading.',
    )
  })

  it('posts resource creation and JSON analytics, estimate, and recommendation payloads', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    const record = {
      workload_id: 'job-test',
      timestamp: '2026-10-01T00:00:00Z',
      cpu_utilization: 20,
      memory_utilization: 25,
      duration_seconds: 10,
    }
    const payloads = [
      {
        path: '/api/v1/resources',
        method: createResourceRecord(record),
        body: record,
      },
      {
        path: '/api/v1/analytics/analyze',
        method: analyzeResourceRecords({ records: [record] }),
        body: { records: [record] },
      },
      {
        path: '/api/v1/estimation/estimate',
        method: estimateWorkload({
          workload_id: 'job-test',
          duration_seconds: 3600,
          hourly_instance_rate_usd: 0.1,
        }),
        body: {
          workload_id: 'job-test',
          duration_seconds: 3600,
          hourly_instance_rate_usd: 0.1,
        },
      },
      {
        path: '/api/v1/recommendations/evaluate',
        method: evaluateWorkload({ records: [record] }),
        body: { records: [record] },
      },
    ]

    await Promise.all(payloads.map((payload) => payload.method))

    for (const { path, body } of payloads) {
      const request = fetchMock.mock.calls.find(([url]) =>
        String(url).endsWith(path),
      )?.[1]
      expect(request?.method).toBe('POST')
      expect(new Headers(request?.headers).get('Content-Type')).toBe(
        'application/json',
      )
      expect(JSON.parse(String(request?.body))).toEqual(body)
    }
  })

  it('uploads CSV as multipart form data with the file field', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ inserted_count: 1, rejected_count: 0, errors: [] }),
    )
    const file = new File(['workload_id'], 'records.csv', { type: 'text/csv' })

    await uploadResourceCsv(file)

    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8000/api/v1/resources/upload-csv')
    if (!request) throw new Error('Expected a CSV upload request.')
    expect(request?.method).toBe('POST')
    expect(request.body).toBeInstanceOf(FormData)
    if (!(request.body instanceof FormData)) throw new Error('Expected multipart form data.')
    expect(request.body.get('file')).toBe(file)
    expect(new Headers(request.headers).has('Content-Type')).toBe(false)
  })

  it('surfaces structured server errors rather than returning fallback data', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Storage unavailable.' }, 503))

    await expect(listResourceRecords()).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      responseBody: { detail: 'Storage unavailable.' },
    } satisfies Partial<ApiError>)
  })
})
