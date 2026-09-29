import clsx from 'clsx'
import type { ReactNode } from 'react'

export function Chip({ children, tone = 'default', title }: { children: ReactNode; tone?: 'default' | 'green' | 'gold' | 'red' | 'blue'; title?: string }) {
  const t = {
    default: '',
    green: '!border-emerald-400/30 !bg-emerald-400/10 !text-emerald-300',
    gold: '!border-amber-400/35 !bg-amber-400/10 !text-amber-300',
    red: '!border-rose-400/30 !bg-rose-400/10 !text-rose-300',
    blue: '!border-sky-400/30 !bg-sky-400/10 !text-sky-300',
  }[tone]
  return <span title={title} className={clsx('chip', t)}>{children}</span>
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={clsx('num mt-0.5 text-lg font-semibold', tone)}>{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

export function Loading({ what = 'data' }: { what?: string }) {
  return <div className="card p-8 text-center text-sm text-slate-400">Loading {what}…</div>
}

export function ErrorBox({ error, hint }: { error: unknown; hint?: string }) {
  return (
    <div className="card border-rose-400/30 p-6 text-sm">
      <div className="font-medium text-rose-300">{(error as Error)?.message ?? 'Something went wrong'}</div>
      {hint && <div className="mt-1 text-slate-400">{hint}</div>}
    </div>
  )
}

export function Section({ title, sub, right, children }: { title: string; sub?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {sub && <p className="mt-0.5 text-sm text-slate-400">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}
