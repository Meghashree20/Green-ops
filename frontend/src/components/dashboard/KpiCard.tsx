import type { LucideIcon } from 'lucide-react'

interface KpiCardProps {
  label: string
  description: string
  icon: LucideIcon
  value?: string | null
}

export function KpiCard({ label, description, icon: Icon, value = null }: KpiCardProps) {
  return (
    <article
      aria-label={`${label}: ${value ?? 'no data available'}`}
      className="rounded-xl border border-[var(--color-border)] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-slate-600">{label}</h3>
          <p className={`mt-4 text-3xl font-semibold tracking-tight ${value === null ? 'text-slate-400' : 'text-slate-950'}`}>
            {value ?? '—'}
          </p>
        </div>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800">
          <Icon size={19} aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">{description}</p>
    </article>
  )
}
