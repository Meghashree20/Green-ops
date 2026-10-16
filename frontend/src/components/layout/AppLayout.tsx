import {
  Activity,
  BarChart3,
  Cloud,
  Coins,
  Leaf,
  LayoutDashboard,
  Menu,
  Server,
  Sparkles,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { getHealth } from '../../services/api'

type ApiHealth =
  | { state: 'checking' }
  | { state: 'connected'; service: string }
  | { state: 'unavailable'; message: string }

const navigation = [
  { label: 'Overview', to: '/overview', icon: LayoutDashboard },
  { label: 'Resource Explorer', to: '/resources', icon: Server },
  { label: 'Analytics', to: '/analytics', icon: BarChart3 },
  { label: 'Cost & Carbon', to: '/cost-carbon', icon: Coins },
  { label: 'Recommendations', to: '/recommendations', icon: Sparkles },
]

export function AppLayout() {
  const [openMenuPath, setOpenMenuPath] = useState<string | null>(null)
  const [apiHealth, setApiHealth] = useState<ApiHealth>({ state: 'checking' })
  const [healthRetry, setHealthRetry] = useState(0)
  const location = useLocation()
  const menuOpen = openMenuPath === location.pathname
  const currentPage =
    navigation.find((item) => item.to === location.pathname)?.label ?? 'GreenOps'

  useEffect(() => {
    if (!menuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenuPath(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  useEffect(() => {
    const controller = new AbortController()
    getHealth(controller.signal)
      .then((health) => {
        if (controller.signal.aborted) return
        if (health.status === 'ok') {
          setApiHealth({ state: 'connected', service: health.service })
        } else {
          setApiHealth({
            state: 'unavailable',
            message: `Health endpoint returned status "${health.status}".`,
          })
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setApiHealth({
            state: 'unavailable',
            message: error instanceof Error ? error.message : 'API health check failed.',
          })
        }
      })
    return () => controller.abort()
  }, [healthRetry])

  const retryHealth = () => {
    setApiHealth({ state: 'checking' })
    setHealthRetry((current) => current + 1)
  }

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] text-[var(--color-ink)]">
      <aside
        id="primary-navigation"
        className={`fixed inset-y-0 left-0 z-30 flex w-[min(19rem,calc(100vw-3rem))] flex-col border-r border-[var(--color-border)] bg-white transition-transform duration-200 lg:w-72 lg:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-20 shrink-0 items-center gap-3 border-b border-[var(--color-border-soft)] px-6">
          <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-800 text-white shadow-sm">
            <Leaf size={21} aria-hidden="true" />
          </div>
          <div>
            <p className="text-lg font-bold tracking-tight text-slate-950">GreenOps</p>
            <p className="text-xs text-slate-500">Cloud efficiency advisor</p>
          </div>
          <button
            aria-label="Close navigation menu"
            className="ml-auto rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 lg:hidden"
            onClick={() => setOpenMenuPath(null)}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </div>

        <div className="px-4 pt-7">
          <p className="px-3 pb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            Workspace
          </p>
          <nav aria-label="Main navigation" className="space-y-1">
            {navigation.map(({ label, to, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setOpenMenuPath(null)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
                    isActive
                      ? 'border-emerald-100 bg-emerald-50 text-emerald-900'
                      : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                  }`
                }
              >
                <Icon size={18} aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="mt-auto p-4">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
            <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-white text-emerald-700 shadow-sm">
              <Cloud size={18} aria-hidden="true" />
            </div>
            <p className="text-sm font-semibold text-slate-800">Efficiency, with evidence</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Explore workload usage and understand its estimated impact.
            </p>
          </div>
          <p className="px-2 pt-4 text-xs text-slate-400">GreenOps · Advisor workspace</p>
        </div>
      </aside>

      {menuOpen && (
        <button
          aria-label="Close navigation menu"
          tabIndex={-1}
          className="fixed inset-0 z-20 cursor-default bg-slate-950/35 lg:hidden"
          onClick={() => setOpenMenuPath(null)}
        />
      )}

      <div className="lg:pl-72">
        <header className="sticky top-0 z-10 flex min-h-20 items-center justify-between border-b border-[var(--color-border)] bg-white/95 px-4 backdrop-blur sm:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              aria-label="Open navigation menu"
              aria-controls="primary-navigation"
              aria-expanded={menuOpen}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 lg:hidden"
              onClick={() => setOpenMenuPath(location.pathname)}
            >
              <Menu size={20} aria-hidden="true" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-slate-500">GreenOps workspace</p>
              <h1 className="truncate text-lg font-semibold tracking-tight text-slate-950">
                {currentPage}
              </h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            {apiHealth.state === 'checking' ? (
              <span className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600" role="status" aria-live="polite">
                <span className="size-1.5 animate-pulse rounded-full bg-slate-400" aria-hidden="true" />
                Checking API…
              </span>
            ) : apiHealth.state === 'connected' ? (
              <span
                className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-900"
                title={`Connected to ${apiHealth.service}`}
                role="status"
                aria-live="polite"
              >
                <span className="size-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
                API connected
              </span>
            ) : (
              <div className="flex items-center gap-2" role="status" aria-live="polite">
                <span
                  className="flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-900"
                  title={apiHealth.message}
                >
                  <Activity size={13} aria-hidden="true" />
                  API unavailable
                </span>
                <button
                  type="button"
                  onClick={retryHealth}
                  className="rounded-md px-2 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] px-4 py-7 sm:px-8 sm:py-9 xl:px-10">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
