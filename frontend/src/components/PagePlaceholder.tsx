import type { LucideIcon } from 'lucide-react'

interface PagePlaceholderProps {
  eyebrow: string
  title: string
  description: string
  icon: LucideIcon
}

export function PagePlaceholder({
  eyebrow,
  title,
  description,
  icon: Icon,
}: PagePlaceholderProps) {
  return (
    <section>
      <p className="text-sm font-semibold text-emerald-700">{eyebrow}</p>
      <div className="mt-2 max-w-3xl">
        <h2 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
          {title}
        </h2>
        <p className="mt-3 text-base leading-7 text-slate-600">{description}</p>
      </div>

      <div className="mt-8 flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
          <Icon size={22} aria-hidden="true" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-slate-900">
          This workspace is ready for your data
        </h3>
        <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">
          No data is displayed yet. Connect the verified GreenOps API in a later
          phase to populate this area.
        </p>
      </div>
    </section>
  )
}
