import {
  AlertCircle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileSpreadsheet,
  FilterX,
  LoaderCircle,
  Plus,
  RefreshCw,
  Upload,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  ApiError,
  createResourceRecord,
  listResourceRecords,
  uploadResourceCsv,
} from '../services/api'
import type {
  CsvUploadSummary,
  ResourceRecord,
  ResourceRecordInput,
} from '../types/resource'

const PAGE_SIZE = 20

interface ResourceFilters {
  from_dt: string
  to_dt: string
}

interface RecordFormValues {
  workload_id: string
  timestamp: string
  cpu_utilization: string
  memory_utilization: string
  duration_seconds: string
  latency_p99_ms: string
}

const initialFormValues: RecordFormValues = {
  workload_id: '',
  timestamp: '',
  cpu_utilization: '',
  memory_utilization: '',
  duration_seconds: '',
  latency_p99_ms: '',
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.responseBody
    if (typeof body === 'object' && body !== null && 'detail' in body) {
      const detail = body.detail
      if (typeof detail === 'string') return detail
      if (Array.isArray(detail)) {
        return detail
          .map((item) => {
            if (typeof item === 'object' && item !== null && 'msg' in item) {
              return String(item.msg)
            }
            return JSON.stringify(item)
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

function toIsoTimestamp(value: string): string {
  return new Date(value).toISOString()
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatNumber(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value)
}

function ErrorNotice({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <div className="flex items-start gap-2.5 text-sm text-rose-900">
        <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>{message}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex w-fit items-center gap-2 rounded-md border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-900 hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700"
        >
          <RefreshCw size={15} aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  )
}

function ResourceRecordForm({
  onCreated,
}: {
  onCreated: () => void
}) {
  const [values, setValues] = useState(initialFormValues)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const updateValue = (field: keyof RecordFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setError(null)
    setSuccess(false)
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSuccess(false)
    if (Number(values.duration_seconds) <= 0) {
      setError('Duration must be greater than 0 seconds.')
      return
    }
    setSubmitting(true)

    try {
      const record: ResourceRecordInput = {
        workload_id: values.workload_id.trim(),
        timestamp: toIsoTimestamp(values.timestamp),
        cpu_utilization: Number(values.cpu_utilization),
        memory_utilization: Number(values.memory_utilization),
        duration_seconds: Number(values.duration_seconds),
      }
      if (values.latency_p99_ms !== '') {
        record.latency_p99_ms = Number(values.latency_p99_ms)
      }

      await createResourceRecord(record)
      setValues(initialFormValues)
      setSuccess(true)
      onCreated()
    } catch (submitError) {
      setError(getErrorMessage(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    'mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15 disabled:bg-slate-50'

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-start gap-3 border-b border-[var(--color-border-soft)] px-5 py-4 sm:px-6">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800">
          <Plus size={18} aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Add a resource record</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Provide a workload observation. Utilization values are percentages.
          </p>
        </div>
      </div>

      <form className="space-y-5 p-5 sm:p-6" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <label className="text-sm font-medium text-slate-700">
            Workload ID
            <input
              className={inputClass}
              name="workload_id"
              value={values.workload_id}
              onChange={(event) => updateValue('workload_id', event.target.value)}
              maxLength={128}
              required
              placeholder="e.g. batch-job-42"
              autoComplete="off"
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Observation timestamp
            <input
              className={inputClass}
              name="timestamp"
              type="datetime-local"
              value={values.timestamp}
              onChange={(event) => updateValue('timestamp', event.target.value)}
              required
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              Sent as an ISO-8601 timestamp.
            </span>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Duration (seconds)
            <input
              className={inputClass}
              name="duration_seconds"
              type="number"
              min="0"
              step="any"
              value={values.duration_seconds}
              onChange={(event) => updateValue('duration_seconds', event.target.value)}
              required
              placeholder="Must be greater than 0"
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            CPU utilization (%)
            <input
              className={inputClass}
              name="cpu_utilization"
              type="number"
              min="0"
              max="100"
              step="any"
              value={values.cpu_utilization}
              onChange={(event) => updateValue('cpu_utilization', event.target.value)}
              required
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Memory utilization (%)
            <input
              className={inputClass}
              name="memory_utilization"
              type="number"
              min="0"
              max="100"
              step="any"
              value={values.memory_utilization}
              onChange={(event) => updateValue('memory_utilization', event.target.value)}
              required
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            P99 latency (ms)
            <input
              className={inputClass}
              name="latency_p99_ms"
              type="number"
              min="0"
              step="any"
              value={values.latency_p99_ms}
              onChange={(event) => updateValue('latency_p99_ms', event.target.value)}
              placeholder="Optional"
            />
          </label>
        </div>

        {error && <ErrorNotice message={error} />}
        {success && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
            Resource record created successfully.
          </p>
        )}

        <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-slate-500">
            CPU and memory must be between 0 and 100. Duration must be greater than 0.
          </p>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus size={16} aria-hidden="true" />
            )}
            {submitting ? 'Saving record…' : 'Add record'}
          </button>
        </div>
      </form>
    </section>
  )
}

function CsvUpload({
  onUploaded,
}: {
  onUploaded: (summary: CsvUploadSummary) => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<CsvUploadSummary | null>(null)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!file) {
      setError('Choose a CSV file to upload.')
      return
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('The selected file must have a .csv extension.')
      return
    }

    setUploading(true)
    setError(null)
    setSummary(null)
    try {
      const result = await uploadResourceCsv(file)
      setSummary(result)
      onUploaded(result)
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
    } catch (uploadError) {
      setError(getErrorMessage(uploadError))
    } finally {
      setUploading(false)
    }
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-start gap-3 border-b border-[var(--color-border-soft)] px-5 py-4 sm:px-6">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800">
          <FileSpreadsheet size={18} aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Import records from CSV</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Upload one CSV file. The server reports inserted rows and row-level validation errors.
          </p>
        </div>
      </div>
      <form className="space-y-4 p-5 sm:p-6" onSubmit={submit}>
        <div>
          <label
            htmlFor="resource-csv"
            className="mb-1.5 block text-sm font-medium text-slate-700"
          >
            CSV file
          </label>
          <input
            ref={fileInput}
            id="resource-csv"
            name="file"
            type="file"
            accept=".csv,text/csv"
            disabled={uploading}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null)
              setError(null)
              setSummary(null)
            }}
            className="block w-full rounded-lg border border-slate-300 bg-white text-sm text-slate-700 file:mr-4 file:border-0 file:border-r file:border-slate-200 file:bg-slate-50 file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-60"
          />
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Expected CSV columns:{' '}
            <code className="break-all rounded bg-slate-100 px-1 py-0.5 text-[11px] text-slate-700">
              workload_id, timestamp, cpu_utilization, memory_utilization, duration_seconds
            </code>
            . Optional column: <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] text-slate-700">latency_p99_ms</code>.
          </p>
        </div>

        {error && <ErrorNotice message={error} />}
        {summary && (
          <div
            className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/70 p-4"
            role="status"
          >
            <p className="text-sm font-semibold text-emerald-950">CSV processing complete</p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-emerald-900">
              <span>Inserted: <strong>{summary.inserted_count}</strong></span>
              <span>Rejected: <strong>{summary.rejected_count}</strong></span>
            </div>
            {summary.errors.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-rose-900">Validation errors</h4>
                <ul className="mt-2 max-h-48 space-y-1 overflow-auto rounded-md border border-rose-200 bg-white p-3 text-xs leading-5 text-rose-900">
                  {summary.errors.map((rowError, index) => (
                    <li key={`${index}-${rowError}`}>{rowError}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end border-t border-slate-100 pt-4">
          <button
            type="submit"
            disabled={uploading || !file}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploading ? (
              <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Upload size={16} aria-hidden="true" />
            )}
            {uploading ? 'Uploading and validating…' : 'Upload CSV'}
          </button>
        </div>
      </form>
    </section>
  )
}

export function ResourceExplorerPage() {
  const [records, setRecords] = useState<ResourceRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<ResourceFilters>({ from_dt: '', to_dt: '' })
  const [appliedFilters, setAppliedFilters] = useState<ResourceFilters>({
    from_dt: '',
    to_dt: '',
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [filterError, setFilterError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    listResourceRecords(
      {
        page,
        page_size: PAGE_SIZE,
        ...(appliedFilters.from_dt && {
          from_dt: toIsoTimestamp(appliedFilters.from_dt),
        }),
        ...(appliedFilters.to_dt && {
          to_dt: toIsoTimestamp(appliedFilters.to_dt),
        }),
      },
      controller.signal,
    )
      .then((result) => {
        setRecords(result.records)
        setTotal(result.total)
        setError(null)
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return
        setError(getErrorMessage(loadError))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [appliedFilters, page, reload])

  const refreshRecords = () => {
    setLoading(true)
    setError(null)
    setReload((current) => current + 1)
  }

  const applyFilters = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (
      filters.from_dt &&
      filters.to_dt &&
      new Date(filters.from_dt).getTime() > new Date(filters.to_dt).getTime()
    ) {
      setFilterError('The start date must be earlier than or equal to the end date.')
      return
    }
    setFilterError(null)
    setError(null)
    setLoading(true)
    setPage(1)
    setAppliedFilters({ ...filters })
  }

  const clearFilters = () => {
    const emptyFilters = { from_dt: '', to_dt: '' }
    setFilters(emptyFilters)
    setAppliedFilters(emptyFilters)
    setFilterError(null)
    setError(null)
    setLoading(true)
    setPage(1)
  }

  const changePage = (nextPage: number) => {
    setPage(nextPage)
    setLoading(true)
    setError(null)
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const firstRecord = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const lastRecord = Math.min(page * PAGE_SIZE, total)

  return (
    <div className="space-y-7">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold text-emerald-800">Resources</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-[2rem]">
            Resource Explorer
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Browse workload observations, narrow records by timestamp, or add resource data.
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
          <span className="size-1.5 rounded-full bg-slate-400" aria-hidden="true" />
          Records from GreenOps API
        </span>
      </section>

      <div className="grid gap-5">
        <ResourceRecordForm onCreated={refreshRecords} />
        <CsvUpload
          onUploaded={(result) => {
            if (result.inserted_count > 0) refreshRecords()
          }}
        />
      </div>

      <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex flex-col gap-3 border-b border-[var(--color-border-soft)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Resource records</h3>
            <p className="mt-1 text-xs text-slate-500">
              {loading ? 'Loading records…' : `${total} matching record${total === 1 ? '' : 's'}`}
            </p>
          </div>
          <button
            type="button"
            onClick={refreshRecords}
            disabled={loading}
            className="inline-flex w-fit items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={15} aria-hidden="true" />
            Refresh
          </button>
        </div>

        <form
          onSubmit={applyFilters}
          className="grid gap-3 border-b border-[var(--color-border-soft)] bg-slate-50/70 p-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end sm:px-6"
        >
          <label className="text-xs font-semibold text-slate-600">
            From date and time
            <span className="relative mt-1.5 block">
              <CalendarDays
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="datetime-local"
                name="from_dt"
                value={filters.from_dt}
                onChange={(event) => setFilters((current) => ({ ...current, from_dt: event.target.value }))}
                className="block min-h-10 w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-2 text-sm font-normal text-slate-800 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
              />
            </span>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            To date and time
            <span className="relative mt-1.5 block">
              <Clock3
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="datetime-local"
                name="to_dt"
                value={filters.to_dt}
                onChange={(event) => setFilters((current) => ({ ...current, to_dt: event.target.value }))}
                className="block min-h-10 w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-2 text-sm font-normal text-slate-800 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
              />
            </span>
          </label>
          <button
            type="submit"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
          >
            <CalendarDays size={15} aria-hidden="true" />
            Apply filters
          </button>
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
          >
            <FilterX size={15} aria-hidden="true" />
            Clear
          </button>
          {filterError && (
            <p className="text-xs font-medium text-rose-800 sm:col-span-4" role="alert">
              {filterError}
            </p>
          )}
        </form>

        {error ? (
          <div className="p-5 sm:p-6">
            <ErrorNotice message={`Could not load resource records: ${error}`} onRetry={refreshRecords} />
          </div>
        ) : loading ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 px-4 text-sm text-slate-600" role="status" aria-live="polite">
            <LoaderCircle size={22} className="animate-spin text-emerald-800" aria-hidden="true" />
            Loading resource records…
          </div>
        ) : records.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-5 py-12 text-center" role="status">
            <span className="flex size-11 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
              <FileSpreadsheet size={20} aria-hidden="true" />
            </span>
            <h4 className="mt-4 text-sm font-semibold text-slate-800">
              {total === 0 ? 'No resource records found' : 'No records on this page'}
            </h4>
            <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">
              {total === 0
                ? 'Add a record or import a CSV to get started. If date filters are active, try clearing them.'
                : 'Use the pagination controls to view another page.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] border-collapse text-left">
              <caption className="sr-only">Resource usage records returned by the GreenOps API</caption>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th scope="col" className="px-5 py-3.5 sm:px-6">Workload</th>
                  <th scope="col" className="px-4 py-3.5">Timestamp</th>
                  <th scope="col" className="px-4 py-3.5">CPU</th>
                  <th scope="col" className="px-4 py-3.5">Memory</th>
                  <th scope="col" className="px-4 py-3.5">Duration</th>
                  <th scope="col" className="px-4 py-3.5">P99 latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((record: ResourceRecord) => (
                  <tr key={record.id} className="text-sm text-slate-700 hover:bg-slate-50/70">
                    <th scope="row" className="max-w-56 px-5 py-4 font-medium text-slate-900 sm:px-6">
                      <span className="block truncate" title={record.workload_id}>{record.workload_id}</span>
                      <span className="mt-1 block truncate font-mono text-[10px] font-normal text-slate-400" title={record.id}>
                        {record.id}
                      </span>
                    </th>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-600">{formatTimestamp(record.timestamp)}</td>
                    <td className="whitespace-nowrap px-4 py-4">{formatNumber(record.cpu_utilization)}%</td>
                    <td className="whitespace-nowrap px-4 py-4">{formatNumber(record.memory_utilization)}%</td>
                    <td className="whitespace-nowrap px-4 py-4">{formatNumber(record.duration_seconds)} s</td>
                    <td className="whitespace-nowrap px-4 py-4">
                      {record.latency_p99_ms == null ? (
                        <span className="text-slate-400">Not provided</span>
                      ) : (
                        `${formatNumber(record.latency_p99_ms)} ms`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-[var(--color-border-soft)] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-xs text-slate-500" aria-live="polite">
            {loading ? 'Updating record range…' : `Showing ${firstRecord}–${lastRecord} of ${total}`}
          </p>
          <nav aria-label="Resource records pagination" className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => changePage(page - 1)}
              disabled={loading || page <= 1}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <ChevronLeft size={16} aria-hidden="true" />
              Previous
            </button>
            <span className="px-1 text-xs text-slate-600">
              Page {page} of {pageCount}
            </span>
            <button
              type="button"
              onClick={() => changePage(page + 1)}
              disabled={loading || page >= pageCount}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Next
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </nav>
        </div>
      </section>
    </div>
  )
}
