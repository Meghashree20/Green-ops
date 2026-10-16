import { AlertCircle, LoaderCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface DashboardPanelProps {
  title: string
  description: string
  icon: LucideIcon
  className?: string
  children: React.ReactNode
}

export function DashboardPanel({
  title,
  description,
  icon: Icon,
  className = '',
  children,
}: DashboardPanelProps) {
  return (
    <section
      className={`min-w-0 rounded-xl border border-[var(--color-border)] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${className}`}
    >
      <div className="flex items-start gap-3 border-b border-[var(--color-border-soft)] px-5 py-4 sm:px-6">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800">
          <Icon size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

interface DashboardEmptyStateProps {
  title: string
  description: string
  className?: string
  state?: 'empty' | 'loading' | 'error'
  onRetry?: () => void
}

export function DashboardEmptyState({
  title,
  description,
  className = '',
  state = 'empty',
  onRetry,
}: DashboardEmptyStateProps) {
  const isLoading = state === 'loading'
  const isError = state === 'error'

  return (
    <div
      className={`flex flex-col items-center justify-center px-5 py-10 text-center ${className}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
    >
      <span
        className={`flex size-10 items-center justify-center rounded-full ${
          isError ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-500'
        }`}
      >
        {isLoading ? (
          <LoaderCircle size={19} className="animate-spin" aria-hidden="true" />
        ) : isError ? (
          <AlertCircle size={19} aria-hidden="true" />
        ) : (
          <span className="size-2 rounded-full bg-slate-400" aria-hidden="true" />
        )}
      </span>
      <p className="mt-3 text-sm font-medium text-slate-700">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{description}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          Try again
        </button>
      )}
    </div>
  )
}
