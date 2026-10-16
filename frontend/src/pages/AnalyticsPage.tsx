import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Cpu,
  Database,
  LoaderCircle,
  MemoryStick,
  Play,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { DashboardPanel } from '../components/dashboard/DashboardPanel'
import { analyzeResourceRecords, ApiError } from '../services/api'
import type { AnalyticsResult, AnalyzeRequest } from '../types/analytics'
import type { ResourceRecordInput } from '../types/resource'

const AnalyticsTrendChart = lazy(() =>
  import('../components/analytics/AnalyticsTrendChart').then((module) => ({
    default: module.AnalyticsTrendChart,
  })),
)

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateRecords(value: unknown): string[] {
  if (!Array.isArray(value)) return ['The JSON value must be an array of records.']
  if (value.length < 1) return ['Provide at least one resource record.']

  const errors: string[] = []
  value.forEach((record, index) => {
    const prefix = `Record ${index + 1}`
    if (!isObject(record)) {
      errors.push(`${prefix} must be a JSON object.`)
      return
    }

    if (
      typeof record.workload_id !== 'string' ||
      record.workload_id.trim().length < 1 ||
      record.workload_id.trim().length > 128
    ) {
      errors.push(`${prefix}: workload_id must be a nonblank string of at most 128 characters.`)
    }

    if (
      typeof record.timestamp !== 'string' ||
      record.timestamp.trim() === '' ||
      !Number.isFinite(Date.parse(record.timestamp))
    ) {
      errors.push(`${prefix}: timestamp must be a valid ISO-8601 date/time string.`)
    }

    for (const field of ['cpu_utilization', 'memory_utilization'] as const) {
      const fieldValue = record[field]
      if (
        typeof fieldValue !== 'number' ||
        !Number.isFinite(fieldValue) ||
        fieldValue < 0 ||
        fieldValue > 100
      ) {
        errors.push(`${prefix}: ${field} must be a number from 0 to 100.`)
      }
    }

    if (
      typeof record.duration_seconds !== 'number' ||
      !Number.isFinite(record.duration_seconds) ||
      record.duration_seconds <= 0
    ) {
      errors.push(`${prefix}: duration_seconds must be a number greater than 0.`)
    }

    if (
      'latency_p99_ms' in record &&
      record.latency_p99_ms !== null &&
      (typeof record.latency_p99_ms !== 'number' ||
        !Number.isFinite(record.latency_p99_ms) ||
        record.latency_p99_ms < 0)
    ) {
      errors.push(`${prefix}: latency_p99_ms must be null or a number greater than or equal to 0.`)
    }
  })

  return errors
}

function getApiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.responseBody
    if (isObject(body) && 'detail' in body) {
      if (typeof body.detail === 'string') return body.detail
      if (Array.isArray(body.detail)) {
        return body.detail
          .map((detail) => {
            if (isObject(detail) && typeof detail.msg === 'string') {
              const location = Array.isArray(detail.loc) ? detail.loc.join(' → ') : ''
              return location ? `${location}: ${detail.msg}` : detail.msg
            }
            return String(detail)
          })
          .join('; ')
      }
    }
    if (typeof body === 'string' && body.trim()) return body
    return `The server returned an error (HTTP ${error.status}).`
  }
  if (error instanceof Error) return error.message
  return 'An unexpected error occurred.'
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
}

function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
}: {
  label: string
  value: number
  unit: string
  icon: LucideIcon
}) {
  return (
    <article className="rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-slate-600">{label}</h4>
        <Icon size={16} className="text-emerald-800" aria-hidden="true" />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
        {formatNumber(value)}
        <span className="ml-1 text-sm font-medium text-slate-500">{unit}</span>
      </p>
    </article>
  )
}

export function AnalyticsPage() {
  const [recordsJson, setRecordsJson] = useState('')
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [result, setResult] = useState<AnalyticsResult | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [lastRequest, setLastRequest] = useState<AnalyzeRequest | null>(null)

  const analyze = async (request: AnalyzeRequest) => {
    setSubmitting(true)
    setApiError(null)
    setResult(null)
    setLastRequest(request)
    try {
      const response = await analyzeResourceRecords(request)
      setResult(response)
    } catch (error) {
      setApiError(getApiErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setApiError(null)
    setResult(null)

    let parsed: unknown
    try {
      parsed = JSON.parse(recordsJson)
    } catch {
      setValidationErrors(['Enter valid JSON before running the analysis.'])
      return
    }

    const errors = validateRecords(parsed)
    setValidationErrors(errors)
    if (errors.length > 0 || !Array.isArray(parsed)) return

    const request: AnalyzeRequest = {
      records: parsed as ResourceRecordInput[],
    }
    await analyze(request)
  }

  return (
    <div className="space-y-7">
      <section>
        <p className="text-sm font-semibold text-emerald-800">Insights</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-[2rem]">
          Resource analytics
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Analyze one or more resource observations. Statistics and trends below are shown
          only after they are returned by the GreenOps API.
        </p>
      </section>

      <section className="rounded-xl border border-[var(--color-border)] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-start gap-3 border-b border-[var(--color-border-soft)] px-5 py-4 sm:px-6">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800">
            <Database size={18} aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Analysis input</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Provide a JSON array using the same resource record fields as the API.
              At least one record is required.
            </p>
          </div>
        </div>

        <form className="space-y-4 p-5 sm:p-6" onSubmit={submit}>
          <label htmlFor="analytics-records" className="block text-sm font-medium text-slate-700">
            Resource records (JSON)
          </label>
          <textarea
            id="analytics-records"
            name="records"
            value={recordsJson}
            onChange={(event) => {
              setRecordsJson(event.target.value)
              setValidationErrors([])
              setApiError(null)
            }}
            disabled={submitting}
            required
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={'[\n  {\n    "workload_id": "...",\n    "timestamp": "ISO-8601 date/time",\n    "cpu_utilization": 0,\n    "memory_utilization": 0,\n    "duration_seconds": 1,\n    "latency_p99_ms": null\n  }\n]'}
            className="mt-1.5 min-h-56 w-full resize-y rounded-lg border border-slate-300 bg-slate-50/60 px-4 py-3 font-mono text-xs leading-6 text-slate-800 outline-none placeholder:text-slate-400 focus:border-emerald-700 focus:bg-white focus:ring-2 focus:ring-emerald-700/15 disabled:opacity-60 sm:text-sm"
            aria-describedby="analytics-input-help"
            aria-invalid={validationErrors.length > 0}
          />
          <div id="analytics-input-help" className="grid gap-2 text-xs leading-5 text-slate-500 sm:grid-cols-2">
            <p>
              Required per record: <code>workload_id</code> (nonblank, max 128 chars),
              {' '}<code>timestamp</code> (ISO-8601), <code>cpu_utilization</code> and
              {' '}<code>memory_utilization</code> (numbers 0–100), and
              {' '}<code>duration_seconds</code> (number greater than 0).
            </p>
            <p>
              Optional: <code>latency_p99_ms</code> (null or number ≥ 0). The API
              treats timestamps without a timezone as UTC.
            </p>
          </div>

          {validationErrors.length > 0 && (
            <div
              className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
              role="alert"
            >
              <p className="font-semibold">Check the input before analysis</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs leading-5">
                {validationErrors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}
              </ul>
            </div>
          )}

          {apiError && (
            <div
              className="flex flex-col gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 sm:flex-row sm:items-center sm:justify-between"
              role="alert"
            >
              <div className="flex items-start gap-2.5 text-sm text-rose-900">
                <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                <p>{apiError}</p>
              </div>
              {lastRequest && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void analyze(lastRequest)}
                  className="inline-flex w-fit items-center gap-2 rounded-md border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-900 hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 disabled:opacity-60"
                >
                  <RefreshCw size={15} aria-hidden="true" />
                  Retry analysis
                </button>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              Analysis is calculated by the backend from the records you provide.
            </p>
            <button
              type="submit"
              disabled={submitting || recordsJson.trim() === ''}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                <Play size={15} aria-hidden="true" />
              )}
              {submitting ? 'Analyzing records…' : 'Run analysis'}
            </button>
          </div>
        </form>
      </section>

      {submitting && (
        <div
          className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-[var(--color-border)] bg-white text-sm text-slate-600"
          role="status"
          aria-live="polite"
        >
          <LoaderCircle size={22} className="animate-spin text-emerald-800" aria-hidden="true" />
          Analyzing the supplied records…
        </div>
      )}

      {!submitting && !result && !apiError && (
        <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
            <BarChart3 size={21} aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-medium text-slate-800">Analysis results will appear here</p>
          <p className="mt-1 max-w-lg text-xs leading-5 text-slate-500">
            Submit valid resource records to view the backend’s utilization statistics,
            trends, and data-quality summary.
          </p>
        </div>
      )}

      {result && (
        <section className="space-y-7" aria-labelledby="results-heading">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-emerald-800">Analysis results</p>
              <h3 id="results-heading" className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                Utilization and workload findings
              </h3>
            </div>
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-900">
              <CheckCircle2 size={14} aria-hidden="true" />
              API analysis complete
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <DashboardPanel
              title="CPU utilization"
              description="Statistics returned by the analysis API · percent"
              icon={Cpu}
            >
              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 sm:p-5">
                <MetricCard label="Mean" value={result.cpu.mean} unit="%" icon={Cpu} />
                <MetricCard label="Minimum" value={result.cpu.min} unit="%" icon={Cpu} />
                <MetricCard label="Maximum" value={result.cpu.max} unit="%" icon={Cpu} />
                <MetricCard label="P50 (median)" value={result.cpu.p50} unit="%" icon={Cpu} />
                <MetricCard label="P90" value={result.cpu.p90} unit="%" icon={Cpu} />
                <MetricCard label="P95" value={result.cpu.p95} unit="%" icon={Cpu} />
              </div>
            </DashboardPanel>

            <DashboardPanel
              title="Memory utilization"
              description="Statistics returned by the analysis API · percent"
              icon={MemoryStick}
            >
              <div className="grid grid-cols-2 gap-3 p-4 sm:p-5">
                <MetricCard label="Mean" value={result.memory.mean} unit="%" icon={MemoryStick} />
                <MetricCard label="Peak" value={result.memory.peak} unit="%" icon={MemoryStick} />
              </div>
            </DashboardPanel>
          </div>

          <DashboardPanel
            title="Utilization trends"
            description="Timestamp-ordered CPU and memory observations returned by the API"
            icon={Activity}
          >
            <Suspense
              fallback={
                <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-600" role="status">
                  <LoaderCircle size={18} className="animate-spin text-emerald-800" aria-hidden="true" />
                  Loading trend chart…
                </div>
              }
            >
              <AnalyticsTrendChart trend={result.trend} />
            </Suspense>
          </DashboardPanel>

          <div className="grid gap-5 xl:grid-cols-2">
            <DashboardPanel
              title="Underutilization findings"
              description="Estimate uses the configured rule: both CPU and memory below their respective thresholds."
              icon={ShieldAlert}
            >
              <div className="grid gap-3 p-5 sm:grid-cols-3 sm:px-6">
                <div className="rounded-lg bg-slate-50 p-4">
                  <p className="text-xs font-medium text-slate-500">Flagged records</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">
                    {formatNumber(result.underutilization.flagged_count)}
                    <span className="ml-1 text-sm font-medium text-slate-500">
                      / {formatNumber(result.underutilization.total_count)}
                    </span>
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-4">
                  <p className="text-xs font-medium text-slate-500">CPU threshold</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">
                    {formatNumber(result.underutilization.cpu_threshold_pct)}
                    <span className="ml-1 text-sm font-medium text-slate-500">%</span>
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-4">
                  <p className="text-xs font-medium text-slate-500">Memory threshold</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">
                    {formatNumber(result.underutilization.mem_threshold_pct)}
                    <span className="ml-1 text-sm font-medium text-slate-500">%</span>
                  </p>
                </div>
              </div>
              <div className="border-t border-[var(--color-border-soft)] px-5 py-4 sm:px-6">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Flagged workload IDs
                </h4>
                {result.underutilization.flagged_workload_ids.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">
                    No workload IDs were flagged in this analysis.
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {result.underutilization.flagged_workload_ids.map((workloadId) => (
                      <li
                        key={workloadId}
                        className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-950"
                      >
                        {workloadId}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  This is an estimated rule-based flag, not a direct measurement or
                  automatic recommendation.
                </p>
              </div>
            </DashboardPanel>

            <DashboardPanel
              title="Data coverage"
              description="Record and optional-latency counts returned by the API"
              icon={Database}
            >
              <dl className="divide-y divide-slate-100 px-5 sm:px-6">
                <div className="flex items-center justify-between gap-4 py-4">
                  <dt className="text-sm text-slate-600">Records analyzed</dt>
                  <dd className="text-sm font-semibold text-slate-900">
                    {formatNumber(result.record_count)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-4">
                  <dt className="text-sm text-slate-600">Total records in quality summary</dt>
                  <dd className="text-sm font-semibold text-slate-900">
                    {formatNumber(result.data_quality.total_records)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-4">
                  <dt className="text-sm text-slate-600">Records with P99 latency</dt>
                  <dd className="text-sm font-semibold text-slate-900">
                    {formatNumber(result.data_quality.records_with_latency)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-4">
                  <dt className="text-sm text-slate-600">Missing P99 latency</dt>
                  <dd className="text-sm font-semibold text-slate-900">
                    {formatNumber(result.data_quality.missing_latency_count)}
                  </dd>
                </div>
              </dl>
              <p className="border-t border-[var(--color-border-soft)] px-5 py-3 text-xs leading-5 text-slate-500 sm:px-6">
                Missing latency is counted as absent, not interpreted as zero.
              </p>
            </DashboardPanel>
          </div>
        </section>
      )}
    </div>
  )
}
