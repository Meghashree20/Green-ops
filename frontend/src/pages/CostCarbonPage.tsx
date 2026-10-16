import {
  AlertCircle,
  BadgeDollarSign,
  CheckCircle2,
  Clock3,
  Factory,
  Leaf,
  LoaderCircle,
  MemoryStick,
  RefreshCw,
  Server,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { DashboardPanel } from '../components/dashboard/DashboardPanel'
import { ApiError, estimateWorkload } from '../services/api'
import type { EstimationRequest, EstimationResult } from '../types/estimation'

interface EstimationFormValues {
  workload_id: string
  duration_seconds: string
  hourly_instance_rate_usd: string
  cpu_utilization_pct: string
  server_tdp_watts: string
  emissions_factor_kg_co2_per_kwh: string
}

const emptyForm: EstimationFormValues = {
  workload_id: '',
  duration_seconds: '',
  hourly_instance_rate_usd: '',
  cpu_utilization_pct: '',
  server_tdp_watts: '',
  emissions_factor_kg_co2_per_kwh: '',
}

function getApiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.responseBody
    if (typeof body === 'object' && body !== null && 'detail' in body) {
      const detail = body.detail
      if (typeof detail === 'string') return detail
      if (Array.isArray(detail)) {
        return detail
          .map((item) => {
            if (typeof item === 'object' && item !== null && 'msg' in item) {
              const location =
                'loc' in item && Array.isArray(item.loc) ? item.loc.join(' → ') : ''
              return location ? `${location}: ${String(item.msg)}` : String(item.msg)
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

function formatNumber(value: number, maximumFractionDigits = 6): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value)
}

function EstimateCard({
  title,
  value,
  unit,
  icon: Icon,
  description,
}: {
  title: string
  value: number | null
  unit: string
  icon: LucideIcon
  description: string
}) {
  return (
    <article className="rounded-xl border border-[var(--color-border)] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-600">{title}</p>
          {value === null ? (
            <p className="mt-4 text-sm font-medium text-slate-500">Not estimated</p>
          ) : (
            <p className="mt-3 break-words text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
              {unit === 'USD' && <span className="mr-1 text-lg text-slate-500">US$</span>}
              {formatNumber(value)}
              {unit !== 'USD' && (
                <span className="ml-1.5 text-sm font-medium text-slate-500">{unit}</span>
              )}
            </p>
          )}
        </div>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800">
          <Icon size={19} aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">{description}</p>
      <span className="mt-3 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900">
        Estimated
      </span>
    </article>
  )
}

function AssumptionValue({ value, unit }: { value: number | null; unit: string }) {
  if (value === null) return <span className="text-slate-400">Not supplied</span>
  return <span className="font-medium text-slate-900">{formatNumber(value)} {unit}</span>
}

export function CostCarbonPage() {
  const [values, setValues] = useState(emptyForm)
  const [fieldErrors, setFieldErrors] = useState<string[]>([])
  const [result, setResult] = useState<EstimationResult | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [lastRequest, setLastRequest] = useState<EstimationRequest | null>(null)

  const updateValue = (field: keyof EstimationFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setFieldErrors([])
    setApiError(null)
  }

  const validateAndBuildRequest = (): EstimationRequest | null => {
    const errors: string[] = []
    const workloadId = values.workload_id.trim()
    const duration = Number(values.duration_seconds)
    const hourlyRate = Number(values.hourly_instance_rate_usd)
    const cpu = values.cpu_utilization_pct === '' ? null : Number(values.cpu_utilization_pct)
    const tdp = values.server_tdp_watts === '' ? null : Number(values.server_tdp_watts)
    const emissionsFactor =
      values.emissions_factor_kg_co2_per_kwh === ''
        ? null
        : Number(values.emissions_factor_kg_co2_per_kwh)

    if (!workloadId) {
      errors.push('Workload ID is required.')
    } else if (workloadId.length > 128) {
      errors.push('Workload ID must be 128 characters or fewer.')
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      errors.push('Duration must be a number greater than 0 seconds.')
    }
    if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
      errors.push('Hourly instance rate must be a number greater than 0 USD/hour.')
    }
    if (cpu !== null && (!Number.isFinite(cpu) || cpu < 0 || cpu > 100)) {
      errors.push('CPU utilization must be a number from 0 to 100%.')
    }
    if (tdp !== null && (!Number.isFinite(tdp) || tdp <= 0)) {
      errors.push('Server TDP must be a number greater than 0 watts.')
    }
    if (
      emissionsFactor !== null &&
      (!Number.isFinite(emissionsFactor) || emissionsFactor <= 0)
    ) {
      errors.push('Emissions factor must be a number greater than 0 kg CO₂e/kWh.')
    }
    if (cpu !== null && tdp !== null && emissionsFactor === null) {
      errors.push(
        'Emissions factor is required when both CPU utilization and server TDP are supplied.',
      )
    }

    setFieldErrors(errors)
    if (errors.length > 0) return null

    const request: EstimationRequest = {
      workload_id: workloadId,
      duration_seconds: duration,
      hourly_instance_rate_usd: hourlyRate,
    }
    if (cpu !== null) request.cpu_utilization_pct = cpu
    if (tdp !== null) request.server_tdp_watts = tdp
    if (emissionsFactor !== null) {
      request.emissions_factor_kg_co2_per_kwh = emissionsFactor
    }
    return request
  }

  const estimate = async (request: EstimationRequest) => {
    setSubmitting(true)
    setResult(null)
    setApiError(null)
    setLastRequest(request)
    try {
      const response = await estimateWorkload(request)
      setResult(response)
    } catch (error) {
      setApiError(getApiErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setResult(null)
    setApiError(null)
    const request = validateAndBuildRequest()
    if (request) await estimate(request)
  }

  const inputClass =
    'mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15 disabled:bg-slate-50'

  return (
    <div className="space-y-7">
      <section>
        <p className="text-sm font-semibold text-emerald-800">Impact</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-[2rem]">
          Cost &amp; Carbon Estimator
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Estimate workload cost and environmental impact from your own rate, hardware,
          and grid assumptions. No live prices or emissions factors are fetched.
        </p>
      </section>

      <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 sm:px-5">
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-800" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-semibold text-amber-950">Estimates, not measurements</h3>
            <p className="mt-1 text-xs leading-5 text-amber-900">
              CPU utilization is an optional measured input. It does not directly measure
              electricity use. When combined with server TDP, the backend uses CPU% as a
              power proxy; actual energy depends on hardware, memory, idle draw, and data
              centre PUE.
            </p>
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-[var(--color-border)] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-start gap-3 border-b border-[var(--color-border-soft)] px-5 py-4 sm:px-6">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800">
            <BadgeDollarSign size={18} aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Workload inputs</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Required values are marked. Optional assumptions determine which estimates can be returned.
            </p>
          </div>
        </div>

        <form className="space-y-6 p-5 sm:p-6" onSubmit={submit} noValidate>
          <fieldset disabled={submitting} className="space-y-5">
            <legend className="sr-only">Workload and estimate assumptions</legend>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <label className="text-sm font-medium text-slate-700">
                Workload ID <span className="text-rose-700" aria-label="required">*</span>
                <input
                  className={inputClass}
                  name="workload_id"
                  value={values.workload_id}
                  onChange={(event) => updateValue('workload_id', event.target.value)}
                  maxLength={128}
                  required
                  autoComplete="off"
                  placeholder="e.g. batch-job-42"
                  aria-describedby="workload-help"
                />
                <span id="workload-help" className="mt-1 block text-xs font-normal text-slate-500">
                  Identifier, up to 128 characters.
                </span>
              </label>

              <label className="text-sm font-medium text-slate-700">
                Workload duration (seconds) <span className="text-rose-700" aria-label="required">*</span>
                <input
                  className={inputClass}
                  name="duration_seconds"
                  type="number"
                  min="0"
                  step="any"
                  value={values.duration_seconds}
                  onChange={(event) => updateValue('duration_seconds', event.target.value)}
                  required
                  placeholder="Greater than 0"
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Observed duration for this workload.
                </span>
              </label>

              <label className="text-sm font-medium text-slate-700">
                Instance rate (USD/hour) <span className="text-rose-700" aria-label="required">*</span>
                <input
                  className={inputClass}
                  name="hourly_instance_rate_usd"
                  type="number"
                  min="0"
                  step="any"
                  value={values.hourly_instance_rate_usd}
                  onChange={(event) => updateValue('hourly_instance_rate_usd', event.target.value)}
                  required
                  placeholder="Your on-demand rate"
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Caller-supplied rate; no pricing lookup is performed.
                </span>
              </label>

              <label className="text-sm font-medium text-slate-700">
                Average CPU utilization (%)
                <input
                  className={inputClass}
                  name="cpu_utilization_pct"
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={values.cpu_utilization_pct}
                  onChange={(event) => updateValue('cpu_utilization_pct', event.target.value)}
                  placeholder="Optional, 0–100"
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Measured input for proportional cost and the TDP energy proxy.
                </span>
              </label>

              <label className="text-sm font-medium text-slate-700">
                Server TDP (watts)
                <input
                  className={inputClass}
                  name="server_tdp_watts"
                  type="number"
                  min="0"
                  step="any"
                  value={values.server_tdp_watts}
                  onChange={(event) => updateValue('server_tdp_watts', event.target.value)}
                  placeholder="Optional, greater than 0"
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Hardware TDP assumption; needed with CPU% to estimate energy.
                </span>
              </label>

              <label className="text-sm font-medium text-slate-700">
                Emissions factor (kg CO₂e/kWh)
                <input
                  className={inputClass}
                  name="emissions_factor_kg_co2_per_kwh"
                  type="number"
                  min="0"
                  step="any"
                  value={values.emissions_factor_kg_co2_per_kwh}
                  onChange={(event) => updateValue('emissions_factor_kg_co2_per_kwh', event.target.value)}
                  placeholder="Optional, greater than 0"
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Supply a documented factor for the data-centre region and reporting period.
                  GreenOps does not verify the source or retain factor provenance.
                </span>
              </label>
            </div>
          </fieldset>

          {fieldErrors.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="alert">
              <p className="font-semibold">Please review the inputs</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs leading-5">
                {fieldErrors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}
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
                  onClick={() => void estimate(lastRequest)}
                  className="inline-flex w-fit items-center gap-2 rounded-md border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-900 hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 disabled:opacity-60"
                >
                  <RefreshCw size={15} aria-hidden="true" />
                  Retry estimate
                </button>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              All prices, TDP, and grid factors are assumptions supplied by you.
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                <Zap size={16} aria-hidden="true" />
              )}
              {submitting ? 'Estimating…' : 'Estimate impact'}
            </button>
          </div>
        </form>
      </section>

      {submitting && (
        <div className="flex min-h-36 flex-col items-center justify-center gap-3 rounded-xl border border-[var(--color-border)] bg-white text-sm text-slate-600" role="status" aria-live="polite">
          <LoaderCircle size={22} className="animate-spin text-emerald-800" aria-hidden="true" />
          Calculating estimates from the supplied assumptions…
        </div>
      )}

      {result && !submitting && (
        <section className="space-y-5" aria-labelledby="estimate-results-heading">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-emerald-800">Estimate results</p>
              <h3 id="estimate-results-heading" className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                Impact estimate for {result.workload_id}
              </h3>
            </div>
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-900">
              <CheckCircle2 size={14} aria-hidden="true" />
              Estimate returned by API
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <EstimateCard
              title="Compute cost"
              value={result.estimated_compute_cost_usd}
              unit="USD"
              icon={BadgeDollarSign}
              description="Estimated full instance cost for the supplied duration."
            />
            <EstimateCard
              title="Workload-proportional cost"
              value={result.estimated_workload_cost_usd}
              unit="USD"
              icon={Server}
              description="CPU-proportional billing approximation, not measured energy."
            />
            <EstimateCard
              title="Energy"
              value={result.estimated_energy_kwh}
              unit="kWh"
              icon={Zap}
              description="TDP × CPU%-based proxy; not a direct power measurement."
            />
            <EstimateCard
              title="Carbon emissions"
              value={result.estimated_carbon_kg_co2e}
              unit="kg CO₂e"
              icon={Factory}
              description="Estimated from energy and the supplied grid-average factor."
            />
          </div>

          <DashboardPanel
            title="Assumptions used"
            description="Values echoed by the backend; duration in hours is derived server-side."
            icon={MemoryStick}
          >
            <dl className="grid gap-x-8 divide-y divide-slate-100 px-5 sm:grid-cols-2 sm:divide-y-0 sm:px-6">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-3.5 sm:border-t sm:border-b">
                <dt className="text-sm text-slate-600">Instance rate</dt>
                <dd><AssumptionValue value={result.assumptions.hourly_instance_rate_usd} unit="USD/hour" /></dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-3.5 sm:border-t">
                <dt className="text-sm text-slate-600">Duration</dt>
                <dd className="text-right text-sm font-medium text-slate-900">
                  {formatNumber(result.assumptions.duration_seconds)} s
                  <span className="block text-xs font-normal text-slate-500">
                    {formatNumber(result.assumptions.duration_hours)} hours
                  </span>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-3.5">
                <dt className="text-sm text-slate-600">CPU utilization</dt>
                <dd><AssumptionValue value={result.assumptions.cpu_utilization_pct} unit="%" /></dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-3.5">
                <dt className="text-sm text-slate-600">Server TDP</dt>
                <dd><AssumptionValue value={result.assumptions.server_tdp_watts} unit="W" /></dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-3.5 sm:col-span-2">
                <dt className="text-sm text-slate-600">Grid emissions factor</dt>
                <dd><AssumptionValue value={result.assumptions.emissions_factor_kg_co2_per_kwh} unit="kg CO₂e/kWh" /></dd>
              </div>
            </dl>
          </DashboardPanel>

          <section className="rounded-xl border border-slate-200 bg-slate-50 p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <Leaf size={19} className="mt-0.5 shrink-0 text-emerald-800" aria-hidden="true" />
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-slate-900">Limitations and advisory notes</h4>
                {result.warnings.length === 0 ? (
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    The API returned no advisory warnings for these inputs.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {result.warnings.map((warning, index) => (
                      <li key={`${index}-${warning}`} className="text-sm leading-6 text-slate-600">
                        {warning}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  These outputs are estimates based on assumptions, not measured infrastructure
                  cost, electricity use, or emissions.
                </p>
              </div>
            </div>
          </section>
        </section>
      )}

      {!result && !submitting && !apiError && (
        <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-8 text-center">
          <span className="flex size-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
            <Clock3 size={19} aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-medium text-slate-800">No estimate has been run</p>
          <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">
            Enter workload details and caller-supplied assumptions to request an estimate.
          </p>
        </div>
      )}
    </div>
  )
}
