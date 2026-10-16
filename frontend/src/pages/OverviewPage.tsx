import {
  Activity,
  AlertCircle,
  BarChart3,
  Cpu,
  Database,
  LoaderCircle,
  MemoryStick,
  RefreshCw,
  Server,
  Sparkles,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { DashboardEmptyState, DashboardPanel } from '../components/dashboard/DashboardPanel'
import { KpiCard } from '../components/dashboard/KpiCard'
import { analyzeResourceRecords, listResourceRecords } from '../services/api'
import type { AnalyticsResult } from '../types/analytics'
import type { ResourceRecord, ResourceRecordPage } from '../types/resource'

const AnalyticsTrendChart = lazy(() =>
  import('../components/analytics/AnalyticsTrendChart').then((module) => ({
    default: module.AnalyticsTrendChart,
  })),
)

interface OverviewData {
  resources: ResourceRecordPage
  analytics: AnalyticsResult | null
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function asAnalysisRecord(record: ResourceRecord) {
  return {
    workload_id: record.workload_id,
    timestamp: record.timestamp,
    cpu_utilization: record.cpu_utilization,
    memory_utilization: record.memory_utilization,
    duration_seconds: record.duration_seconds,
    latency_p99_ms: record.latency_p99_ms,
  }
}

export function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listResourceRecords({ page: 1, page_size: 20 }, controller.signal)
      .then(async (resources) => {
        if (resources.records.length === 0) {
          return { resources, analytics: null }
        }
        const analytics = await analyzeResourceRecords({
          records: resources.records.map(asAnalysisRecord),
        })
        return { resources, analytics }
      })
      .then((overview) => {
        if (!controller.signal.aborted) {
          setData(overview)
          setError(null)
        }
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'Unable to load Overview data.',
          )
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [retry])

  const retryLoading = () => {
    setLoading(true)
    setError(null)
    setRetry((current) => current + 1)
  }

  const records = data?.resources.records ?? []
  const analytics = data?.analytics ?? null

  return (
    <div className="space-y-8 sm:space-y-9">
      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold text-emerald-800">Workspace overview</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-[2rem]">
            Cloud efficiency at a glance
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Resource metrics and findings are based on API responses for the latest
            page of resource observations.
          </p>
        </div>
        {data && (
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
            <Database size={14} aria-hidden="true" />
            {analytics ? `${analytics.record_count} observations analyzed` : 'No observations available'}
          </span>
        )}
      </section>

      {error && (
        <div className="flex flex-col gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <div className="flex items-start gap-2.5 text-sm text-rose-900">
            <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>Could not load Overview data: {error}</p>
          </div>
          <button
            type="button"
            onClick={retryLoading}
            disabled={loading}
            className="inline-flex w-fit items-center gap-2 rounded-md border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-900 hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 disabled:opacity-60"
          >
            <RefreshCw size={15} aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      {loading && (
        <div className="flex min-h-40 items-center justify-center gap-3 rounded-xl border border-[var(--color-border)] bg-white text-sm text-slate-600" role="status" aria-live="polite">
          <LoaderCircle size={20} className="animate-spin text-emerald-800" aria-hidden="true" />
          Loading resource data…
        </div>
      )}

      {!loading && !error && (
        <>
          <section aria-labelledby="kpi-heading">
            <div className="mb-3 flex items-center justify-between">
              <h3
                id="kpi-heading"
                className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-500"
              >
                Key indicators
              </h3>
              <p className="text-xs text-slate-500">
                {data?.resources.total ?? 0} total records · at most 20 analyzed
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <KpiCard
                label="Mean CPU utilization"
                value={analytics ? `${formatNumber(analytics.cpu.mean)}%` : null}
                description="API analysis of the latest records returned · percent"
                icon={Cpu}
              />
              <KpiCard
                label="Mean memory utilization"
                value={analytics ? `${formatNumber(analytics.memory.mean)}%` : null}
                description="API analysis of the latest records returned · percent"
                icon={MemoryStick}
              />
              <KpiCard
                label="Records analyzed"
                value={analytics ? formatNumber(analytics.record_count) : null}
                description="Observations included in the returned analysis"
                icon={Server}
              />
            </div>
          </section>

          {analytics ? (
            <>
              <section aria-labelledby="overview-trend-heading">
                <div className="mb-4">
                  <h3 id="overview-trend-heading" className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Resource utilization
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    CPU and memory values returned by the analytics endpoint.
                  </p>
                </div>
                <DashboardPanel
                  title="Utilization trend"
                  description="Timestamp-ordered observations · percentage"
                  icon={BarChart3}
                >
                  <Suspense
                    fallback={
                      <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-600" role="status">
                        <LoaderCircle size={18} className="animate-spin text-emerald-800" aria-hidden="true" />
                        Loading trend chart…
                      </div>
                    }
                  >
                    <AnalyticsTrendChart trend={analytics.trend} />
                  </Suspense>
                </DashboardPanel>
              </section>

              <section aria-labelledby="overview-activity-heading">
                <div className="mb-4">
                  <h3 id="overview-activity-heading" className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Activity &amp; findings
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Records and rule-based findings returned from backend services.
                  </p>
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  <DashboardPanel
                    title="Recent resource records"
                    description="Latest observations returned by the resource list API"
                    icon={Activity}
                  >
                    {records.length === 0 ? (
                      <DashboardEmptyState
                        title="No resource records"
                        description="The resource API returned no observations."
                      />
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {records.slice(0, 5).map((record) => (
                          <li key={record.id} className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-900">{record.workload_id}</p>
                              <p className="mt-0.5 text-xs text-slate-500">{formatTimestamp(record.timestamp)}</p>
                            </div>
                            <p className="text-xs text-slate-600">
                              CPU {formatNumber(record.cpu_utilization)}% · Memory {formatNumber(record.memory_utilization)}%
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </DashboardPanel>

                  <DashboardPanel
                    title="Underutilization findings"
                    description={`Estimated flags from ${analytics.underutilization.total_count} analyzed records`}
                    icon={Sparkles}
                  >
                    <div className="p-5 sm:p-6">
                      <p className="text-sm text-slate-600">
                        {analytics.underutilization.flagged_count} record(s) flagged where both
                        CPU and memory were below the configured thresholds.
                      </p>
                      <p className="mt-2 text-xs text-slate-500">
                        Thresholds: CPU {formatNumber(analytics.underutilization.cpu_threshold_pct)}% ·
                        {' '}Memory {formatNumber(analytics.underutilization.mem_threshold_pct)}%
                      </p>
                      {analytics.underutilization.flagged_workload_ids.length > 0 ? (
                        <ul className="mt-4 flex flex-wrap gap-2">
                          {analytics.underutilization.flagged_workload_ids.map((workloadId) => (
                            <li key={workloadId} className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-950">
                              {workloadId}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-4 text-xs text-slate-500">No workload IDs were flagged.</p>
                      )}
                      <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">
                        Rule-based estimate, not a direct measurement or an automatic recommendation.
                      </p>
                    </div>
                  </DashboardPanel>
                </div>
              </section>
            </>
          ) : (
            <DashboardPanel
              title="Resource activity"
              description="Data returned by the resource records API"
              icon={Activity}
            >
              <DashboardEmptyState
                title="No resource observations available"
                description="Add or upload records in Resource Explorer to populate utilization metrics and trends."
              />
            </DashboardPanel>
          )}
        </>
      )}
    </div>
  )
}
