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

  it('prevents invalid analytics data from being sent', async () => {
    const fetchMock = vi.mocked(fetch)
    renderApp('/analytics')
    await screen.findByText('API connected')
    fireEvent.change(screen.getByLabelText('Resource records (JSON)'), {
      target: {
        value: JSON.stringify([{
          workload_id: 'job',
          timestamp: '2026-10-01T00:00:00Z',
          cpu_utilization: -1,
          memory_utilization: 10,
          duration_seconds: 30,
        }]),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('cpu_utilization must be a number from 0 to 100')
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/v1/analytics/analyze'))).toBe(false)
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

  it('renders the backend insufficient-data recommendation', async () => {
    installApiMock((url, init) => {
      if (url.endsWith('/api/v1/health')) {
        return jsonResponse({ status: 'ok', service: 'greenops-backend' })
      }
      if (url.endsWith('/api/v1/recommendations/evaluate') && init?.method === 'POST') {
        return jsonResponse({
          workload_id: 'unknown',
          recommendation: {
            category: 'INSUFFICIENT_DATA',
            sufficiency_status: 'INSUFFICIENT',
            confidence: 'NONE',
            reason: 'No resource usage records provided for evaluation.',
            evidence: {
              sample_count: 0,
              mean_cpu_pct: null,
              peak_cpu_pct: null,
              p95_cpu_pct: null,
              mean_memory_pct: null,
              peak_memory_pct: null,
              observed_p99_latency_max_ms: null,
              latency_violations_count: 0,
            },
            potential_benefit: null,
            warnings: ['Cannot generate recommendations without observation history.'],
            verification_conditions: ['Collect samples.'],
          },
        })
      }
      return jsonResponse(emptyResources)
    })
    const user = userEvent.setup()
    renderApp('/recommendations')
    await screen.findByText('API connected')
    fireEvent.change(screen.getByLabelText(/Resource history records/), {
      target: { value: '[]' },
    })
    await user.click(screen.getByRole('button', { name: 'Evaluate workload' }))

    expect(
      await screen.findByRole('heading', { level: 4, name: 'INSUFFICIENT DATA' }),
    ).toBeVisible()
    expect(screen.getAllByText('Not provided').length).toBeGreaterThan(0)
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
