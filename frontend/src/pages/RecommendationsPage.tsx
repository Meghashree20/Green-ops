import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  Database,
  Gauge,
  LoaderCircle,
  MemoryStick,
  RefreshCw,
  Server,
  Sparkles,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { DashboardPanel } from '../components/dashboard/DashboardPanel'
import { ApiError, evaluateWorkload } from '../services/api'
import type {
  RecommendationRequest,
  RecommendationResponse,
} from '../types/recommendation'
import type { ResourceRecordInput } from '../types/resource'

interface FormValues {
  records: string
  allocated_cpu_cores: string
  allocated_memory_gb: string
  hourly_rate_usd: string
  max_latency_p99_ms: string
  target_cpu_headroom_pct: string
  min_samples_threshold: string
}

const emptyValues: FormValues = {
  records: '',
  allocated_cpu_cores: '',
  allocated_memory_gb: '',
  hourly_rate_usd: '',
  max_latency_p99_ms: '',
  target_cpu_headroom_pct: '',
  min_samples_threshold: '5',
}

const categoryStyles: Record<string, string> = {
  RIGHTSIZE_DOWN: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  RIGHTSIZE_UP: 'border-amber-200 bg-amber-50 text-amber-950',
  MAINTAIN: 'border-sky-200 bg-sky-50 text-sky-950',
  INSUFFICIENT_DATA: 'border-slate-300 bg-slate-100 text-slate-800',
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateRecords(value: unknown): string[] {
  if (!Array.isArray(value)) return ['Records must be provided as a JSON array.']

  const errors: string[] = []
  value.forEach((record, index) => {
    const prefix = `Record ${index + 1}`
    if (!isObject(record)) {
      errors.push(`${prefix} must be a JSON object.`)
      return
    }

    if (
      typeof record.workload_id !== 'string' ||
      !record.workload_id.trim() ||
      record.workload_id.trim().length > 128
    ) {
      errors.push(`${prefix}: workload_id must be nonblank and no longer than 128 characters.`)
    }
    if (
      typeof record.timestamp !== 'string' ||
      !record.timestamp.trim() ||
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

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.responseBody
    if (isObject(body) && 'detail' in body) {
      if (typeof body.detail === 'string') return body.detail
      if (Array.isArray(body.detail)) {
        return body.detail
          .map((item) => {
            if (isObject(item) && typeof item.msg === 'string') {
              const location = Array.isArray(item.loc) ? item.loc.join(' → ') : ''
              return location ? `${location}: ${item.msg}` : item.msg
            }
            return String(item)
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

function formatNumber(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value)
}

function EvidenceMetric({
  label,
  value,
  unit = '%',
  icon: Icon,
}: {
  label: string
  value: number | null
  unit?: string
  icon: LucideIcon
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3.5">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <Icon size={14} aria-hidden="true" />
        {label}
      </div>
      <p className="mt-2 text-lg font-semibold text-slate-900">
        {value === null ? 'Not provided' : `${formatNumber(value)}${unit}`}
      </p>
    </div>
  )
}

function ResultView({ result }: { result: RecommendationResponse }) {
  const recommendation = result.recommendation
  const isInsufficient = recommendation.category === 'INSUFFICIENT_DATA'

  return (
    <section className="space-y-5" aria-labelledby="recommendation-result-heading">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-emerald-800">Evaluation result</p>
          <h3
            id="recommendation-result-heading"
            className="mt-1 text-xl font-semibold tracking-tight text-slate-950"
          >
            Workload: {result.workload_id}
          </h3>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-900">
          <CheckCircle2 size={14} aria-hidden="true" />
          Returned by GreenOps API
        </span>
      </div>

      <article
        className={`rounded-xl border p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6 ${
          isInsufficient
            ? 'border-slate-300 bg-white'
            : 'border-[var(--color-border)] bg-white'
        }`}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg ${
                isInsufficient
                  ? 'bg-slate-100 text-slate-600'
                  : 'bg-emerald-50 text-emerald-800'
              }`}
            >
              {isInsufficient ? (
                <Database size={19} aria-hidden="true" />
              ) : (
                <Sparkles size={19} aria-hidden="true" />
              )}
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Recommendation
              </p>
              <h4 className="mt-1 text-lg font-semibold text-slate-950">
                {recommendation.category.replaceAll('_', ' ')}
              </h4>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${categoryStyles[recommendation.category]}`}>
              {recommendation.sufficiency_status}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
              {recommendation.confidence} confidence
            </span>
          </div>
        </div>

        <div className="mt-5 rounded-lg bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Explanation from the API
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-800">{recommendation.reason}</p>
        </div>

        {isInsufficient && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>
              The backend reports insufficient data. Treat this response as a signal to
              collect more representative history, not as a sizing recommendation.
            </p>
          </div>
        )}
      </article>

      <DashboardPanel
        title="Supporting evidence"
        description="Values reported directly by the recommendation API."
        icon={Gauge}
      >
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 sm:p-5">
          <EvidenceMetric label="Sample count" value={recommendation.evidence.sample_count} unit="" icon={Database} />
          <EvidenceMetric label="Mean CPU" value={recommendation.evidence.mean_cpu_pct} icon={Cpu} />
          <EvidenceMetric label="Peak CPU" value={recommendation.evidence.peak_cpu_pct} icon={Cpu} />
          <EvidenceMetric label="P95 CPU" value={recommendation.evidence.p95_cpu_pct} icon={Cpu} />
          <EvidenceMetric label="Mean memory" value={recommendation.evidence.mean_memory_pct} icon={MemoryStick} />
          <EvidenceMetric label="Peak memory" value={recommendation.evidence.peak_memory_pct} icon={MemoryStick} />
          <EvidenceMetric
            label="Observed max P99 latency"
            value={recommendation.evidence.observed_p99_latency_max_ms}
            unit=" ms"
            icon={Gauge}
          />
          <EvidenceMetric
            label="Latency violations"
            value={recommendation.evidence.latency_violations_count}
            unit=""
            icon={AlertTriangle}
          />
        </div>
      </DashboardPanel>

      <div className="grid gap-5 xl:grid-cols-2">
        <DashboardPanel
          title="Potential benefit"
          description="Estimated values are returned by the backend and are not measured savings."
          icon={Wallet}
        >
          {recommendation.potential_benefit ? (
            <div className="space-y-4 p-5 sm:p-6">
              <p className="text-sm leading-6 text-slate-800">
                {recommendation.potential_benefit.description}
              </p>
              <dl className="space-y-3">
                {recommendation.potential_benefit.estimated_cpu_reduction_pct !== null && (
                  <div className="flex justify-between gap-4 text-sm">
                    <dt className="text-slate-600">Estimated CPU reduction</dt>
                    <dd className="font-semibold text-slate-900">
                      {formatNumber(recommendation.potential_benefit.estimated_cpu_reduction_pct)}%
                    </dd>
                  </div>
                )}
                {recommendation.potential_benefit.estimated_memory_reduction_pct !== null && (
                  <div className="flex justify-between gap-4 text-sm">
                    <dt className="text-slate-600">Estimated memory reduction</dt>
                    <dd className="font-semibold text-slate-900">
                      {formatNumber(recommendation.potential_benefit.estimated_memory_reduction_pct)}%
                    </dd>
                  </div>
                )}
                {recommendation.potential_benefit.estimated_hourly_cost_savings_usd !== null && (
                  <div className="flex justify-between gap-4 text-sm">
                    <dt className="text-slate-600">Estimated hourly cost savings</dt>
                    <dd className="font-semibold text-slate-900">
                      US${formatNumber(recommendation.potential_benefit.estimated_hourly_cost_savings_usd)}
                    </dd>
                  </div>
                )}
              </dl>
              {recommendation.potential_benefit.calculation_basis && (
                <p className="border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">
                  <strong className="font-semibold text-slate-700">Calculation basis:</strong>{' '}
                  {recommendation.potential_benefit.calculation_basis}
                </p>
              )}
            </div>
          ) : (
            <div className="px-5 py-8 text-sm text-slate-500 sm:px-6" role="status">
              No potential benefit was returned for this evaluation.
            </div>
          )}
        </DashboardPanel>

        <DashboardPanel
          title="Warnings"
          description="Advisory notes returned with this evaluation."
          icon={AlertTriangle}
        >
          {recommendation.warnings.length > 0 ? (
            <ul className="space-y-3 p-5 sm:p-6">
              {recommendation.warnings.map((warning, index) => (
                <li key={`${index}-${warning}`} className="flex gap-2.5 text-sm leading-6 text-slate-700">
                  <AlertCircle size={16} className="mt-1 shrink-0 text-amber-700" aria-hidden="true" />
                  {warning}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-sm text-slate-500 sm:px-6" role="status">
              No warnings were returned.
            </p>
          )}
        </DashboardPanel>

        <DashboardPanel
          title="Verification conditions"
          description="Checks returned by the API before acting on its advisory."
          icon={ClipboardCheck}
          className="xl:col-span-2"
        >
          {recommendation.verification_conditions.length > 0 ? (
            <ol className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
              {recommendation.verification_conditions.map((condition, index) => (
                <li key={`${index}-${condition}`} className="flex gap-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3.5 text-sm leading-6 text-slate-700">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-emerald-800 ring-1 ring-slate-200">
                    {index + 1}
                  </span>
                  {condition}
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-5 py-8 text-sm text-slate-500 sm:px-6" role="status">
              No verification conditions were returned.
            </p>
          )}
        </DashboardPanel>
      </div>
    </section>
  )
}

export function RecommendationsPage() {
  const [values, setValues] = useState(emptyValues)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [apiError, setApiError] = useState<string | null>(null)
  const [result, setResult] = useState<RecommendationResponse | null>(null)
  const [lastRequest, setLastRequest] = useState<RecommendationRequest | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const updateValue = (field: keyof FormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setValidationErrors([])
    setApiError(null)
  }

  const evaluate = async (request: RecommendationRequest) => {
    setSubmitting(true)
    setApiError(null)
    setResult(null)
    setLastRequest(request)
    try {
      const response = await evaluateWorkload(request)
      setResult(response)
    } catch (error) {
      setApiError(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setValidationErrors([])
    setApiError(null)
    setResult(null)

    let parsedRecords: unknown
    try {
      parsedRecords = JSON.parse(values.records)
    } catch {
      setValidationErrors(['Enter valid JSON for the records array.'])
      return
    }
    const errors = validateRecords(parsedRecords)

    const allocations: NonNullable<RecommendationRequest['allocations']> = {}
    const allocationFields = [
      ['allocated_cpu_cores', values.allocated_cpu_cores, 'Allocated CPU cores'],
      ['allocated_memory_gb', values.allocated_memory_gb, 'Allocated memory (GB)'],
      ['hourly_rate_usd', values.hourly_rate_usd, 'Hourly rate (USD)'],
    ] as const
    for (const [key, rawValue, label] of allocationFields) {
      if (!rawValue.trim()) continue
      const numberValue = Number(rawValue)
      if (!Number.isFinite(numberValue) || numberValue <= 0) {
        errors.push(`${label} must be a number greater than 0.`)
      } else {
        allocations[key] = numberValue
      }
    }

    const constraints: NonNullable<RecommendationRequest['constraints']> = {}
    if (values.max_latency_p99_ms.trim()) {
      const latency = Number(values.max_latency_p99_ms)
      if (!Number.isFinite(latency) || latency <= 0) {
        errors.push('Maximum acceptable P99 latency must be greater than 0 ms.')
      } else {
        constraints.max_latency_p99_ms = latency
      }
    }
    if (values.target_cpu_headroom_pct.trim()) {
      const headroom = Number(values.target_cpu_headroom_pct)
      if (!Number.isFinite(headroom) || headroom < 0 || headroom > 50) {
        errors.push('Target CPU headroom must be between 0 and 50%.')
      } else {
        constraints.target_cpu_headroom_pct = headroom
      }
    }

    const minSamples = Number(values.min_samples_threshold)
    if (!Number.isInteger(minSamples) || minSamples < 1) {
      errors.push('Minimum sample threshold must be a whole number of at least 1.')
    }
    setValidationErrors(errors)
    if (errors.length > 0 || !Array.isArray(parsedRecords)) return

    const request: RecommendationRequest = {
      records: parsedRecords as ResourceRecordInput[],
      min_samples_threshold: minSamples,
    }
    if (Object.keys(allocations).length > 0) request.allocations = allocations
    if (Object.keys(constraints).length > 0) request.constraints = constraints
    await evaluate(request)
  }

  const inputClass =
    'mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15 disabled:bg-slate-50'

  return (
    <div className="space-y-7">
      <section>
        <p className="text-sm font-semibold text-emerald-800">Action</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-[2rem]">
          Workload Recommendations
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Evaluate workload history with optional allocation details and performance
          constraints. GreenOps returns advisory guidance; it never changes resource
          configurations automatically.
        </p>
      </section>

      <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 sm:px-5">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-800" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-semibold text-amber-950">Advisory only</h3>
            <p className="mt-1 text-xs leading-5 text-amber-900">
              Recommendations and potential benefits are generated by backend rules
              from submitted observations. Review the returned evidence, warnings,
              verification conditions, and your own service-level requirements before
              making any change. Confidence labels are rule-based, not statistically
              calibrated; missing latency observations cannot demonstrate that an SLA
              was met.
            </p>
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-[var(--color-border)] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-start gap-3 border-b border-[var(--color-border-soft)] px-5 py-4 sm:px-6">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800">
            <Server size={18} aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Evaluation inputs</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Add resource history. Allocation and performance fields are optional.
            </p>
          </div>
        </div>

        <form className="space-y-6 p-5 sm:p-6" onSubmit={submit} noValidate>
          <div>
            <label htmlFor="recommendation-records" className="block text-sm font-medium text-slate-700">
              Resource history records (JSON array) <span className="text-rose-700" aria-label="required">*</span>
            </label>
            <textarea
              id="recommendation-records"
              name="records"
              value={values.records}
              onChange={(event) => updateValue('records', event.target.value)}
              disabled={submitting}
              required
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder={'[\n  {\n    "workload_id": "...",\n    "timestamp": "ISO-8601 date/time",\n    "cpu_utilization": 0,\n    "memory_utilization": 0,\n    "duration_seconds": 1,\n    "latency_p99_ms": null\n  }\n]'}
              className="mt-1.5 min-h-48 w-full resize-y rounded-lg border border-slate-300 bg-slate-50/60 px-4 py-3 font-mono text-xs leading-6 text-slate-800 outline-none placeholder:text-slate-400 focus:border-emerald-700 focus:bg-white focus:ring-2 focus:ring-emerald-700/15 disabled:opacity-60 sm:text-sm"
              aria-describedby="recommendation-record-help"
              aria-invalid={validationErrors.length > 0}
            />
            <p id="recommendation-record-help" className="mt-2 text-xs leading-5 text-slate-500">
              Each record uses <code>workload_id</code>, <code>timestamp</code>,
              {' '}<code>cpu_utilization</code> (0–100%), <code>memory_utilization</code> (0–100%),
              {' '}<code>duration_seconds</code> (&gt;0), and optional <code>latency_p99_ms</code> (≥0 or null).
              A single sample will not trigger downsizing.
            </p>
          </div>

          <fieldset disabled={submitting} className="space-y-4">
            <legend className="text-sm font-semibold text-slate-800">Optional workload allocations</legend>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <label className="text-sm font-medium text-slate-700">
                Allocated CPU (cores)
                <input
                  className={inputClass}
                  name="allocated_cpu_cores"
                  type="number"
                  min="0"
                  step="any"
                  value={values.allocated_cpu_cores}
                  onChange={(event) => updateValue('allocated_cpu_cores', event.target.value)}
                  placeholder="Optional, greater than 0"
                />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Allocated memory (GB)
                <input
                  className={inputClass}
                  name="allocated_memory_gb"
                  type="number"
                  min="0"
                  step="any"
                  value={values.allocated_memory_gb}
                  onChange={(event) => updateValue('allocated_memory_gb', event.target.value)}
                  placeholder="Optional, greater than 0"
                />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Current hourly rate (USD)
                <input
                  className={inputClass}
                  name="hourly_rate_usd"
                  type="number"
                  min="0"
                  step="any"
                  value={values.hourly_rate_usd}
                  onChange={(event) => updateValue('hourly_rate_usd', event.target.value)}
                  placeholder="Optional, greater than 0"
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Used by the backend if it returns estimated savings.
                </span>
              </label>
            </div>
          </fieldset>

          <fieldset disabled={submitting} className="space-y-4">
            <legend className="text-sm font-semibold text-slate-800">Optional performance constraints</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">
                Maximum acceptable P99 latency (ms)
                <input
                  className={inputClass}
                  name="max_latency_p99_ms"
                  type="number"
                  min="0"
                  step="any"
                  value={values.max_latency_p99_ms}
                  onChange={(event) => updateValue('max_latency_p99_ms', event.target.value)}
                  placeholder="Optional, greater than 0"
                />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Target CPU headroom (%)
                <input
                  className={inputClass}
                  name="target_cpu_headroom_pct"
                  type="number"
                  min="0"
                  max="50"
                  step="any"
                  value={values.target_cpu_headroom_pct}
                  onChange={(event) => updateValue('target_cpu_headroom_pct', event.target.value)}
                  placeholder="Optional; API default is 20%"
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  If omitted, the backend default is 20%.
                </span>
              </label>
            </div>
          </fieldset>

          <div className="max-w-sm">
            <label className="text-sm font-medium text-slate-700">
              Minimum sample threshold
              <input
                className={inputClass}
                name="min_samples_threshold"
                type="number"
                min="1"
                step="1"
                value={values.min_samples_threshold}
                onChange={(event) => updateValue('min_samples_threshold', event.target.value)}
                disabled={submitting}
                required
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                Minimum observations required to consider data sufficient for downsizing. Default: 5.
              </span>
            </label>
          </div>

          {validationErrors.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="alert">
              <p className="font-semibold">Please review the input</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs leading-5">
                {validationErrors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}
              </ul>
            </div>
          )}

          {apiError && (
            <div className="flex flex-col gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
              <div className="flex items-start gap-2.5 text-sm text-rose-900">
                <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                <p>{apiError}</p>
              </div>
              {lastRequest && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void evaluate(lastRequest)}
                  className="inline-flex w-fit items-center gap-2 rounded-md border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-900 hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 disabled:opacity-60"
                >
                  <RefreshCw size={15} aria-hidden="true" />
                  Retry evaluation
                </button>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              Evaluation is advisory and does not apply changes to infrastructure.
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles size={16} aria-hidden="true" />
              )}
              {submitting ? 'Evaluating history…' : 'Evaluate workload'}
            </button>
          </div>
        </form>
      </section>

      {submitting && (
        <div className="flex min-h-36 flex-col items-center justify-center gap-3 rounded-xl border border-[var(--color-border)] bg-white text-sm text-slate-600" role="status" aria-live="polite">
          <LoaderCircle size={22} className="animate-spin text-emerald-800" aria-hidden="true" />
          Evaluating the supplied workload history…
        </div>
      )}

      {apiError && !submitting && (
        <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-rose-200 bg-white px-5 text-center">
          <AlertCircle size={20} className="text-rose-700" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-800">Evaluation could not be completed</p>
          <p className="text-xs text-slate-500">Review the API error above and retry when ready.</p>
        </div>
      )}

      {result && !submitting && <ResultView result={result} />}

      {!result && !submitting && !apiError && (
        <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-8 text-center">
          <span className="flex size-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
            <Sparkles size={19} aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-medium text-slate-800">No evaluation yet</p>
          <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">
            Submit resource history to see the recommendation and evidence returned by the backend.
          </p>
        </div>
      )}
    </div>
  )
}
