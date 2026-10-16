import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { jsonResponse } from './test/setup'

function installApiMock(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const fetchMock = vi.fn<typeof fetch>((input, init) =>
    Promise.resolve(handler(String(input), init)),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderApp(path = '/overview') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

const emptyResources = { total: 0, page: 1, page_size: 20, records: [] }

function resourceRecord(workloadId = 'job-a', timestamp = '2026-10-15T12:00:00Z') {
  return {
    id: `id-${workloadId}`,
    created_at: timestamp,
    workload_id: workloadId,
    timestamp,
    cpu_utilization: 31,
    memory_utilization: 42,
    duration_seconds: 60,
    latency_p99_ms: null,
  }
}

function analyticsResponse(recordCount = 1) {
  return {
    record_count: recordCount,
    cpu: { mean: 31, min: 31, max: 31, p50: 31, p90: 31, p95: 31 },
    memory: { mean: 42, peak: 42 },
    trend: [{
      timestamp: '2026-10-15T12:00:00+00:00',
      cpu_utilization: 31,
      memory_utilization: 42,
    }],
    underutilization: {
      flagged_count: 0,
      total_count: recordCount,
      cpu_threshold_pct: 20,
      mem_threshold_pct: 20,
      flagged_workload_ids: [],
    },
    data_quality: {
      total_records: recordCount,
      records_with_latency: 0,
      missing_latency_count: recordCount,
    },
  }
}

describe('GreenOps routes and page behavior', () => {
  beforeEach(() => {
    installApiMock((url) => {
      if (url.endsWith('/api/v1/health')) {
        return jsonResponse({ status: 'ok', service: 'greenops-backend' })
      }
      if (url.includes('/api/v1/resources')) return jsonResponse(emptyResources)
      return jsonResponse({ detail: 'Unexpected request' }, 404)
    })
  })

  it.each([
    ['/overview', 'Overview'],
    ['/resources', 'Resource Explorer'],
    ['/analytics', 'Analytics'],
    ['/cost-carbon', 'Cost & Carbon'],
    ['/recommendations', 'Recommendations'],
  ])('loads %s route', async (path, heading) => {
    renderApp(path)
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeVisible()
    expect(await screen.findByText('API connected')).toBeVisible()
  })

  it('opens mobile navigation and closes it after selecting a page', async () => {
    const user = userEvent.setup()
    renderApp('/overview')
    const menuButton = screen.getByRole('button', { name: 'Open navigation menu' })

    await user.click(menuButton)
    expect(menuButton).toHaveAttribute('aria-expanded', 'true')

    await user.click(screen.getByRole('link', { name: 'Analytics' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible()
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows API health failure rather than reporting a connected state', async () => {
    installApiMock((url) => {
      if (url.endsWith('/api/v1/health')) throw new Error('Network unavailable')
      return jsonResponse(emptyResources)
    })
    renderApp('/analytics')

    expect(await screen.findByText('API unavailable')).toBeVisible()
  })

  it('loads stored records for the selected period and displays backend analytics', async () => {
    const record = resourceRecord()
    installApiMock((url, init) => {
      if (url.endsWith('/api/v1/health')) {
        return jsonResponse({ status: 'ok', service: 'greenops-backend' })
      }
      if (url.includes('/api/v1/resources?')) {
        return jsonResponse({ total: 1, page: 1, page_size: 100, records: [record] })
      }
      if (url.endsWith('/api/v1/analytics/analyze') && init?.method === 'POST') {
        return jsonResponse(analyticsResponse())
      }
      return jsonResponse({ detail: 'Unexpected request' }, 404)
    })
    const fetchMock = vi.mocked(fetch)
    renderApp('/analytics')
    const user = userEvent.setup()
    await screen.findByText('API connected')
    fireEvent.change(screen.getByLabelText('From date and time'), {
      target: { value: '2026-10-10T08:30' },
    })
    fireEvent.change(screen.getByLabelText('To date and time'), {
      target: { value: '2026-10-15T18:45' },
    })
    await user.click(screen.getByRole('button', { name: 'Analyze stored records' }))

    expect(await screen.findByRole('heading', { name: 'Utilization and workload findings' })).toBeVisible()
    expect(await screen.findByText('Backend analysis of 1 stored record.')).toBeVisible()

    const resourceRequest = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/v1/resources?'),
    )
    expect(resourceRequest).toBeDefined()
    const query = new URL(String(resourceRequest?.[0])).searchParams
    expect(query.get('page')).toBe('1')
    expect(query.get('page_size')).toBe('100')
    expect(query.get('from_dt')).toBe(new Date('2026-10-10T08:30').toISOString())
    expect(query.get('to_dt')).toBe(new Date('2026-10-15T18:45').toISOString())

    const analysisRequest = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/api/v1/analytics/analyze'),
    )
    expect(JSON.parse(String(analysisRequest?.[1]?.body))).toEqual({
      records: [{
        workload_id: record.workload_id,
        timestamp: record.timestamp,
        cpu_utilization: record.cpu_utilization,
        memory_utilization: record.memory_utilization,
        duration_seconds: record.duration_seconds,
        latency_p99_ms: record.latency_p99_ms,
      }],
    })
  })

  it('shows an empty period without sending an empty analytics request', async () => {
    const fetchMock = vi.mocked(fetch)
    renderApp('/analytics')
    await userEvent.setup().click(
      await screen.findByRole('button', { name: 'Analyze stored records' }),
    )

    expect(await screen.findByText('No stored records in this period')).toBeVisible()
    expect(fetchMock.mock.calls.some(([url]) =>
      String(url).endsWith('/api/v1/analytics/analyze'),
    )).toBe(false)
  })

  it('rejects a reversed reporting period before fetching records', async () => {
    const fetchMock = vi.mocked(fetch)
    renderApp('/analytics')
    await screen.findByText('API connected')
    fireEvent.change(screen.getByLabelText('From date and time'), {
      target: { value: '2026-10-15T18:45' },
    })
    fireEvent.change(screen.getByLabelText('To date and time'), {
      target: { value: '2026-10-10T08:30' },
    })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Analyze stored records' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The start date and time must not be later than the end date and time.',
    )
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/v1/resources?'))).toBe(false)
  })

  it('offers retry after a stored-record fetch failure and retries the full workflow', async () => {
    let resourceRequests = 0
    const record = resourceRecord()
    installApiMock((url, init) => {
      if (url.endsWith('/api/v1/health')) {
        return jsonResponse({ status: 'ok', service: 'greenops-backend' })
      }
      if (url.includes('/api/v1/resources?')) {
        resourceRequests += 1
        if (resourceRequests === 1) throw new Error('Network unavailable')
        return jsonResponse({ total: 1, page: 1, page_size: 100, records: [record] })
      }
      if (url.endsWith('/api/v1/analytics/analyze') && init?.method === 'POST') {
        return jsonResponse(analyticsResponse())
      }
      return jsonResponse({ detail: 'Unexpected request' }, 404)
    })
    const user = userEvent.setup()
    renderApp('/analytics')
    await screen.findByText('API connected')
    await user.click(screen.getByRole('button', { name: 'Analyze stored records' }))
    await screen.findByText('Network unavailable')

    await user.click(screen.getByRole('button', { name: 'Retry loading and analysis' }))
    expect(await screen.findByRole('heading', { name: 'Utilization and workload findings' })).toBeVisible()
    expect(resourceRequests).toBe(2)
  })

  it('offers retry when analytics fails and clears the error on success', async () => {
    let analysisRequests = 0
    const record = resourceRecord()
    installApiMock((url, init) => {
      if (url.endsWith('/api/v1/health')) {
        return jsonResponse({ status: 'ok', service: 'greenops-backend' })
      }
      if (url.includes('/api/v1/resources?')) {
        return jsonResponse({ total: 1, page: 1, page_size: 100, records: [record] })
      }
      if (url.endsWith('/api/v1/analytics/analyze') && init?.method === 'POST') {
        analysisRequests += 1
        return analysisRequests === 1
          ? jsonResponse({ detail: 'Analysis unavailable.' }, 503)
          : jsonResponse(analyticsResponse())
      }
      return jsonResponse({ detail: 'Unexpected request' }, 404)
    })
    const user = userEvent.setup()
    renderApp('/analytics')
    await screen.findByText('API connected')
    await user.click(screen.getByRole('button', { name: 'Analyze stored records' }))
    await screen.findByText('Analysis unavailable.')

    await user.click(screen.getByRole('button', { name: 'Retry loading and analysis' }))
    expect(await screen.findByRole('heading', { name: 'Utilization and workload findings' })).toBeVisible()
    expect(analysisRequests).toBe(2)
  })

  it('does not analyze partial data when a later resource page fails', async () => {
    installApiMock((url) => {
      if (url.endsWith('/api/v1/health')) {
        return jsonResponse({ status: 'ok', service: 'greenops-backend' })
      }
      if (url.includes('/api/v1/resources?')) {
        const page = Number(new URL(url).searchParams.get('page'))
        return page === 1
          ? jsonResponse({
            total: 101,
            page: 1,
            page_size: 100,
            records: Array.from({ length: 100 }, (_, index) => resourceRecord(`job-${index}`)),
          })
          : jsonResponse({ detail: 'Second page unavailable.' }, 503)
      }
      return jsonResponse({ detail: 'Unexpected request' }, 404)
    })
    const fetchMock = vi.mocked(fetch)
    const user = userEvent.setup()
    renderApp('/analytics')
    await screen.findByText('API connected')
    await user.click(screen.getByRole('button', { name: 'Analyze stored records' }))

    expect(await screen.findByText('Second page unavailable.')).toBeVisible()
    expect(fetchMock.mock.calls.some(([url]) =>
      String(url).endsWith('/api/v1/analytics/analyze'),
    )).toBe(false)
  })

  it('rejects zero-duration resource records before posting', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.mocked(fetch)
    renderApp('/resources')
    await user.type(screen.getByLabelText('Workload ID'), 'job')
    await user.type(screen.getByLabelText(/Observation timestamp/), '2026-10-15T12:00')
    await user.type(screen.getByLabelText('Duration (seconds)'), '0')
    await user.type(screen.getByLabelText('CPU utilization (%)'), '10')
    await user.type(screen.getByLabelText('Memory utilization (%)'), '20')
    await user.click(screen.getByRole('button', { name: 'Add record' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Duration must be greater than 0 seconds.')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('shows a server error on CSV upload', async () => {
    installApiMock((url, init) => {
      if (url.endsWith('/api/v1/health')) {
        return jsonResponse({ status: 'ok', service: 'greenops-backend' })
      }
      if (url.endsWith('/api/v1/resources/upload-csv') && init?.method === 'POST') {
        return jsonResponse({ detail: 'CSV rejected by validation.' }, 422)
      }
      return jsonResponse(emptyResources)
    })
    const user = userEvent.setup()
    renderApp('/resources')
    const input = await screen.findByLabelText('CSV file')
    await user.upload(input, new File(['bad'], 'bad.csv', { type: 'text/csv' }))
    await user.click(screen.getByRole('button', { name: 'Upload CSV' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('CSV rejected by validation.')
  })

  it('shows cost validation errors without posting invalid rates', async () => {
    const fetchMock = vi.mocked(fetch)
    renderApp('/cost-carbon')
    await screen.findByText('API connected')
    fireEvent.change(screen.getByLabelText(/Workload ID/), { target: { value: 'job' } })
    fireEvent.change(screen.getByLabelText(/Workload duration/), { target: { value: '60' } })
    fireEvent.change(screen.getByLabelText(/Instance rate/), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Estimate impact' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Hourly instance rate must be a number greater than 0 USD/hour.')
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/v1/estimation/estimate'))).toBe(false)
  })

  it('loads all stored-record pages and prefills only observed fields for estimation', async () => {
    const allRecords = Array.from({ length: 101 }, (_, index) =>
      resourceRecord(`stored-job-${index}`, '2026-10-15T12:00:00Z'),
    )
    const fetchMock = installApiMock((url, init) => {
      if (url.endsWith('/api/v1/health')) {
        return jsonResponse({ status: 'ok', service: 'greenops-backend' })
      }
      if (url.includes('/api/v1/resources?')) {
        const query = new URL(url).searchParams
        const page = Number(query.get('page'))
        return jsonResponse({
          total: allRecords.length,
          page,
          page_size: 100,
          records: page === 1 ? allRecords.slice(0, 100) : allRecords.slice(100),
        })
      }
      if (url.endsWith('/api/v1/estimation/estimate') && init?.method === 'POST') {
        return jsonResponse({
          workload_id: 'stored-job-100',
          estimated_compute_cost_usd: 0.001667,
          estimated_workload_cost_usd: 0.000517,
          estimated_energy_kwh: null,
          estimated_carbon_kg_co2e: null,
          assumptions: {
            hourly_instance_rate_usd: 0.1,
            duration_seconds: 60,
            duration_hours: 0.016667,
            cpu_utilization_pct: 31,
            server_tdp_watts: null,
            emissions_factor_kg_co2_per_kwh: null,
          },
          warnings: ['Energy and carbon estimates skipped: server_tdp_watts not supplied.'],
        })
      }
      return jsonResponse({ detail: 'Unexpected request' }, 404)
    })
    const user = userEvent.setup()
    renderApp('/cost-carbon')
    await screen.findByText('API connected')

    fireEvent.change(screen.getByLabelText('From date and time'), {
      target: { value: '2026-10-10T08:30' },
    })
    fireEvent.change(screen.getByLabelText('To date and time'), {
      target: { value: '2026-10-15T18:45' },
    })
    await user.click(screen.getByRole('button', { name: 'Load stored records' }))

    const selector = await screen.findByLabelText('Stored resource record')
    expect(fetchMock.mock.calls.some(([url]) =>
      new URL(String(url)).searchParams.get('page') === '2',
    )).toBe(true)
    const storedRequests = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/api/v1/resources?'),
    )
    expect(storedRequests).toHaveLength(2)
    for (const [url] of storedRequests) {
      const query = new URL(String(url)).searchParams
      expect(query.get('from_dt')).toBe(new Date('2026-10-10T08:30').toISOString())
      expect(query.get('to_dt')).toBe(new Date('2026-10-15T18:45').toISOString())
    }

    await user.selectOptions(selector, 'id-stored-job-100')
    expect(screen.getByLabelText(/Workload ID/)).toHaveValue('stored-job-100')
    expect(screen.getByLabelText(/Workload duration/)).toHaveValue(60)
    expect(screen.getByLabelText(/Observed CPU utilization/)).toHaveValue(31)
    expect(screen.getByLabelText(/Instance rate/)).toHaveValue(null)
    expect(screen.getByLabelText(/Server TDP/)).toHaveValue(null)
    expect(screen.getByLabelText(/^Emissions factor \(/)).toHaveValue(null)

    fireEvent.change(screen.getByLabelText(/Instance rate/), { target: { value: '0.1' } })
    await user.click(screen.getByRole('button', { name: 'Estimate impact' }))
    expect(await screen.findByRole('heading', { name: 'Impact estimate for stored-job-100' })).toBeVisible()
    expect(screen.getByText('Factor source or reference')).toBeVisible()
    expect(screen.getAllByText('Unspecified')).toHaveLength(3)
    expect(screen.getByText(/user-supplied metadata and is not independently verified/)).toBeVisible()

    const estimateCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/api/v1/estimation/estimate'),
    )
    expect(JSON.parse(String(estimateCall?.[1]?.body))).toEqual({
      workload_id: 'stored-job-100',
      duration_seconds: 60,
      hourly_instance_rate_usd: 0.1,
      cpu_utilization_pct: 31,
    })
  })

  it('sends and displays user-supplied emission-factor provenance without implying verification', async () => {
    const fetchMock = installApiMock((url, init) => {
      if (url.endsWith('/api/v1/health')) {
        return jsonResponse({ status: 'ok', service: 'greenops-backend' })
      }
      if (url.endsWith('/api/v1/estimation/estimate') && init?.method === 'POST') {
        return jsonResponse({
          workload_id: 'job-a',
          estimated_compute_cost_usd: 1,
          estimated_workload_cost_usd: 0.5,
          estimated_energy_kwh: 0.1,
          estimated_carbon_kg_co2e: 0.0233,
          assumptions: {
            hourly_instance_rate_usd: 1,
            duration_seconds: 3600,
            duration_hours: 1,
            cpu_utilization_pct: 50,
            server_tdp_watts: 200,
            emissions_factor_kg_co2_per_kwh: 0.233,
            emissions_factor_source: 'Grid data report',
            emissions_factor_region: 'Region X',
            emissions_factor_reference_period: '2025',
          },
          warnings: [],
        })
      }
      return jsonResponse(emptyResources)
    })
    const user = userEvent.setup()
    renderApp('/cost-carbon')
    await screen.findByText('API connected')
    fireEvent.change(screen.getByLabelText(/Workload ID/), { target: { value: 'job-a' } })
    fireEvent.change(screen.getByLabelText(/Workload duration/), { target: { value: '3600' } })
    fireEvent.change(screen.getByLabelText(/Instance rate/), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/Observed CPU utilization/), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText(/Server TDP/), { target: { value: '200' } })
    fireEvent.change(screen.getByLabelText(/^Emissions factor \(/), { target: { value: '0.233' } })
    fireEvent.change(screen.getByLabelText('Emissions factor source or reference'), {
      target: { value: 'Grid data report' },
    })
    fireEvent.change(screen.getByLabelText('Emissions factor geographic region'), {
      target: { value: 'Region X' },
    })
    fireEvent.change(screen.getByLabelText('Emissions factor reference year or period'), {
      target: { value: '2025' },
    })
    await user.click(screen.getByRole('button', { name: 'Estimate impact' }))

    expect(await screen.findByText('Grid data report')).toBeVisible()
    expect(screen.getByText('Region X')).toBeVisible()
    expect(screen.getByText('2025')).toBeVisible()
    expect(screen.getByText(/illustrative, uncalibrated CPU-scaled TDP proxy/)).toBeVisible()
    expect(screen.getByText(/assumes zero power at 0% CPU/)).toBeVisible()
    expect(screen.getByText(/PUE is not applied/)).toBeVisible()
    expect(screen.getByText(/Illustrative, uncalibrated TDP × CPU% proxy/)).toBeVisible()
    expect(screen.getByText(/user-supplied metadata and is not independently verified/)).toBeVisible()
    expect(screen.getByText('0.0233')).toBeVisible()
    const estimateCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/api/v1/estimation/estimate'),
    )
    expect(JSON.parse(String(estimateCall?.[1]?.body))).toEqual({
      workload_id: 'job-a',
      duration_seconds: 3600,
      hourly_instance_rate_usd: 1,
      cpu_utilization_pct: 50,
      server_tdp_watts: 200,
      emissions_factor_kg_co2_per_kwh: 0.233,
      emissions_factor_source: 'Grid data report',
      emissions_factor_region: 'Region X',
      emissions_factor_reference_period: '2025',
    })
  })

  it('shows an empty stored-record state when the selected period has no matches', async () => {
    const user = userEvent.setup()
    renderApp('/cost-carbon')
    await screen.findByText('API connected')
    await user.click(screen.getByRole('button', { name: 'Load stored records' }))

    expect(await screen.findByText(/No stored records match this period/)).toBeVisible()
    expect(screen.queryByLabelText('Stored resource record')).not.toBeInTheDocument()
  })

  it('shows a record-loading error and retries loading after API failure', async () => {
    let resourceRequests = 0
    const user = userEvent.setup()
    installApiMock((url) => {
      if (url.endsWith('/api/v1/health')) {
        return jsonResponse({ status: 'ok', service: 'greenops-backend' })
      }
      if (url.includes('/api/v1/resources?')) {
        resourceRequests += 1
        if (resourceRequests === 1) {
          return jsonResponse({ detail: 'Storage unavailable.' }, 503)
        }
        return jsonResponse({
          total: 1,
          page: 1,
          page_size: 100,
          records: [resourceRecord()],
        })
      }
      return jsonResponse({ detail: 'Unexpected request' }, 404)
    })
    renderApp('/cost-carbon')
    await screen.findByText('API connected')
    await user.click(screen.getByRole('button', { name: 'Load stored records' }))
    expect(await screen.findByText('Storage unavailable.')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Retry loading records' }))
    expect(await screen.findByLabelText('Stored resource record')).toBeVisible()
    expect(resourceRequests).toBe(2)
  })

  it('loads every history page and submits only the selected workload records', async () => {
    const allRecords = Array.from({ length: 101 }, (_, index) =>
      resourceRecord(index === 100 ? 'job-selected' : index % 2 ? 'job-other' : 'job-selected'),
    )
    const fetchMock = installApiMock((url, init) => {
      if (url.endsWith('/api/v1/health')) {
        return jsonResponse({ status: 'ok', service: 'greenops-backend' })
      }
      if (url.includes('/api/v1/resources?')) {
        const query = new URL(url).searchParams
        const page = Number(query.get('page'))
        return jsonResponse({
          total: allRecords.length,
          page,
          page_size: 100,
          records: page === 1 ? allRecords.slice(0, 100) : allRecords.slice(100),
        })
      }
      if (url.endsWith('/api/v1/recommendations/evaluate') && init?.method === 'POST') {
        return jsonResponse({
          workload_id: 'job-selected',
          recommendation: {
            category: 'INSUFFICIENT_DATA',
            sufficiency_status: 'INSUFFICIENT',
            confidence: 'NONE',
            reason: 'More observations are required.',
            evidence: {
              sample_count: 51,
              mean_cpu_pct: 31,
              peak_cpu_pct: 31,
              p95_cpu_pct: 31,
              mean_memory_pct: 42,
              peak_memory_pct: 42,
              observed_p99_latency_max_ms: null,
              latency_violations_count: 0,
            },
            potential_benefit: null,
            warnings: ['Insufficient sample history.'],
            verification_conditions: ['Collect more samples.'],
          },
        })
      }
      return jsonResponse(emptyResources)
    })
    const user = userEvent.setup()
    renderApp('/recommendations')
    await screen.findByText('API connected')
    fireEvent.change(screen.getByLabelText('From date and time'), {
      target: { value: '2026-10-10T08:30' },
    })
    fireEvent.change(screen.getByLabelText('To date and time'), {
      target: { value: '2026-10-15T18:45' },
    })
    await user.click(screen.getByRole('button', { name: 'Load workload history' }))
    const selector = await screen.findByLabelText(/Workload ID/)
    expect(await screen.findByText('Loaded 101 stored records.')).toBeVisible()
    const resourceCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/api/v1/resources?'),
    )
    expect(resourceCalls).toHaveLength(2)
    for (const [url] of resourceCalls) {
      const query = new URL(String(url)).searchParams
      expect(query.get('from_dt')).toBe(new Date('2026-10-10T08:30').toISOString())
      expect(query.get('to_dt')).toBe(new Date('2026-10-15T18:45').toISOString())
    }

    await user.selectOptions(selector, 'job-selected')
    await user.click(screen.getByRole('button', { name: 'Evaluate workload' }))

    expect(
      await screen.findByRole('heading', { level: 4, name: 'INSUFFICIENT DATA' }),
    ).toBeVisible()
    expect(screen.getAllByText('Not provided').length).toBeGreaterThan(0)
    const request = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/api/v1/recommendations/evaluate'),
    )
    const body = JSON.parse(String(request?.[1]?.body))
    expect(body.records).toHaveLength(51)
    expect(body.records.every((record: { workload_id: string }) =>
      record.workload_id === 'job-selected',
    )).toBe(true)
    expect(body.min_samples_threshold).toBe(5)
  })

  it('shows an empty stored-history state and does not evaluate', async () => {
    const fetchMock = vi.mocked(fetch)
    const user = userEvent.setup()
    renderApp('/recommendations')
    await screen.findByText('API connected')
    await user.click(screen.getByRole('button', { name: 'Load workload history' }))

    expect(await screen.findByText(/No stored records match this reporting period/)).toBeVisible()
    expect(screen.queryByLabelText('Workload ID')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Evaluate workload' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No stored records are available in this reporting period.')
    expect(fetchMock.mock.calls.some(([url]) =>
      String(url).endsWith('/api/v1/recommendations/evaluate'),
    )).toBe(false)
  })

  it('retries loading stored workload history after a resource API failure', async () => {
    let resourceRequests = 0
    installApiMock((url) => {
      if (url.endsWith('/api/v1/health')) {
        return jsonResponse({ status: 'ok', service: 'greenops-backend' })
      }
      if (url.includes('/api/v1/resources?')) {
        resourceRequests += 1
        if (resourceRequests === 1) {
          return jsonResponse({ detail: 'Storage unavailable.' }, 503)
        }
        return jsonResponse({
          total: 1,
          page: 1,
          page_size: 100,
          records: [resourceRecord('job-a')],
        })
      }
      return jsonResponse(emptyResources)
    })
    const user = userEvent.setup()
    renderApp('/recommendations')
    await screen.findByText('API connected')
    await user.click(screen.getByRole('button', { name: 'Load workload history' }))
    expect(await screen.findByText('Storage unavailable.')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Retry loading records' }))
    expect(await screen.findByLabelText(/Workload ID/)).toBeVisible()
    expect(resourceRequests).toBe(2)
  })

  it('preserves an insufficient-data response and retries a failed recommendation request', async () => {
    let evaluations = 0
    const fetchMock = installApiMock((url, init) => {
      if (url.endsWith('/api/v1/health')) {
        return jsonResponse({ status: 'ok', service: 'greenops-backend' })
      }
      if (url.includes('/api/v1/resources?')) {
        return jsonResponse({
          total: 1,
          page: 1,
          page_size: 100,
          records: [resourceRecord('job-a')],
        })
      }
      if (url.endsWith('/api/v1/recommendations/evaluate') && init?.method === 'POST') {
        evaluations += 1
        if (evaluations === 1) return jsonResponse({ detail: 'Recommendation service unavailable.' }, 503)
        return jsonResponse({
          workload_id: 'job-a',
          recommendation: {
            category: 'INSUFFICIENT_DATA',
            sufficiency_status: 'INSUFFICIENT',
            confidence: 'NONE',
            reason: 'More observations are required.',
            evidence: {
              sample_count: 1,
              mean_cpu_pct: 31,
              peak_cpu_pct: 31,
              p95_cpu_pct: 31,
              mean_memory_pct: 42,
              peak_memory_pct: 42,
              observed_p99_latency_max_ms: null,
              latency_violations_count: 0,
            },
            potential_benefit: null,
            warnings: ['Insufficient sample history.'],
            verification_conditions: ['Collect more samples.'],
          },
        })
      }
      return jsonResponse(emptyResources)
    })
    const user = userEvent.setup()
    renderApp('/recommendations')
    await screen.findByText('API connected')
    await user.click(screen.getByRole('button', { name: 'Load workload history' }))
    await user.selectOptions(await screen.findByLabelText(/Workload ID/), 'job-a')
    await user.click(screen.getByRole('button', { name: 'Evaluate workload' }))
    expect(await screen.findByText('Recommendation service unavailable.')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Retry evaluation' }))
    expect(await screen.findByRole('heading', { level: 4, name: 'INSUFFICIENT DATA' })).toBeVisible()
    expect(await screen.findByText('More observations are required.')).toBeVisible()
    expect(evaluations).toBe(2)
    const requests = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/api/v1/recommendations/evaluate'),
    )
    expect(requests).toHaveLength(2)
    expect(JSON.parse(String(requests[0][1]?.body)).records).toEqual(
      JSON.parse(String(requests[1][1]?.body)).records,
    )
  })

  it('does not submit partial workload history when a later page fails', async () => {
    const fetchMock = installApiMock((url) => {
      if (url.endsWith('/api/v1/health')) {
        return jsonResponse({ status: 'ok', service: 'greenops-backend' })
      }
      if (url.includes('/api/v1/resources?')) {
        const page = Number(new URL(url).searchParams.get('page'))
        return page === 1
          ? jsonResponse({
            total: 101,
            page: 1,
            page_size: 100,
            records: Array.from({ length: 100 }, (_, index) => resourceRecord(`job-${index}`)),
          })
          : jsonResponse({ detail: 'Second page unavailable.' }, 503)
      }
      return jsonResponse(emptyResources)
    })
    const user = userEvent.setup()
    renderApp('/recommendations')
    await screen.findByText('API connected')
    await user.click(screen.getByRole('button', { name: 'Load workload history' }))

    expect(await screen.findByText('Second page unavailable.')).toBeVisible()
    expect(screen.queryByLabelText('Workload ID')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) =>
      String(url).endsWith('/api/v1/recommendations/evaluate'),
    )).toBe(false)
  })

  it('rejects reversed recommendation reporting periods before fetching records', async () => {
    const fetchMock = vi.mocked(fetch)
    const user = userEvent.setup()
    renderApp('/recommendations')
    await screen.findByText('API connected')
    fireEvent.change(screen.getByLabelText('From date and time'), {
      target: { value: '2026-10-16T08:30' },
    })
    fireEvent.change(screen.getByLabelText('To date and time'), {
      target: { value: '2026-10-15T18:45' },
    })
    await user.click(screen.getByRole('button', { name: 'Load workload history' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a valid reporting period')
    expect(fetchMock.mock.calls.some(([url]) =>
      String(url).includes('/api/v1/resources?'),
    )).toBe(false)
  })

  it('shows CSV import counts and row-level validation errors', async () => {
    installApiMock((url, init) => {
      if (url.endsWith('/api/v1/health')) {
        return jsonResponse({ status: 'ok', service: 'greenops-backend' })
      }
      if (url.endsWith('/api/v1/resources/upload-csv') && init?.method === 'POST') {
        return jsonResponse({
          inserted_count: 2,
          rejected_count: 1,
          errors: ['Row 3: cpu_utilization must be between 0 and 100.'],
        })
      }
      return jsonResponse(emptyResources)
    })
    const user = userEvent.setup()
    renderApp('/resources')
    await user.upload(
      await screen.findByLabelText('CSV file'),
      new File(['workload_id'], 'records.csv', { type: 'text/csv' }),
    )
    await user.click(screen.getByRole('button', { name: 'Upload CSV' }))

    expect(await screen.findByText('CSV processing complete')).toBeVisible()
    expect(screen.getByText(/Inserted:/)).toHaveTextContent('Inserted: 2')
    expect(screen.getByText(/Rejected:/)).toHaveTextContent('Rejected: 1')
    expect(screen.getByText('Row 3: cpu_utilization must be between 0 and 100.')).toBeVisible()
  })

  it('shows resource creation server errors', async () => {
    installApiMock((url, init) => {
      if (url.endsWith('/api/v1/health')) {
        return jsonResponse({ status: 'ok', service: 'greenops-backend' })
      }
      if (url.endsWith('/api/v1/resources') && init?.method === 'POST') {
        return jsonResponse({ detail: 'Storage unavailable. Please try again later.' }, 503)
      }
      return jsonResponse(emptyResources)
    })
    const user = userEvent.setup()
    renderApp('/resources')
    await user.type(screen.getByLabelText('Workload ID'), 'job')
    await user.type(screen.getByLabelText(/Observation timestamp/), '2026-10-15T12:00')
    await user.type(screen.getByLabelText('Duration (seconds)'), '30')
    await user.type(screen.getByLabelText('CPU utilization (%)'), '10')
    await user.type(screen.getByLabelText('Memory utilization (%)'), '20')
    await user.click(screen.getByRole('button', { name: 'Add record' }))

    expect(
      await screen.findByText('Storage unavailable. Please try again later.'),
    ).toBeVisible()
  })
})
