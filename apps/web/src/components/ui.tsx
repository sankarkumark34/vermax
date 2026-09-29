import clsx from 'clsx'
import type { ReactNode } from 'react'

type ChipTone = 'default' | 'green' | 'gold' | 'red' | 'blue' | 'brand'

export function Chip({ children, tone = 'default', title }: { children: ReactNode; tone?: ChipTone; title?: string }) {
  const t: Record<ChipTone, string> = {
    default: '',
    green: '!border-transparent !bg-pos-bg !text-pos',
    gold: '!border-transparent !bg-amber-bg !text-amber',
    red: '!border-transparent !bg-neg-bg !text-neg',
    blue: '!border-transparent !bg-blue-bg !text-blue',
    brand: '!border-transparent !bg-brand !text-white',
  }
  return <span title={title} className={clsx('chip', t[tone])}>{children}</span>
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={clsx('num mt-1 text-[19px] font-semibold leading-none text-ink', tone)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-mute">{sub}</div>}
    </div>
  )
}

export function Loading({ what = 'data' }: { what?: string }) {
  return <div className="card p-10 text-center text-sm text-mute">Loading {what}…</div>
}

export function ErrorBox({ error, hint }: { error: unknown; hint?: string }) {
  return (
    <div className="card border-neg/30 p-6 text-sm">
      <div className="font-medium text-neg">{(error as Error)?.message ?? 'Something went wrong'}</div>
      {hint && <div className="mt-1 text-sub">{hint}</div>}
    </div>
  )
}

export function Section({ title, sub, right, children }: { title: string; sub?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-9">
      <div className="mb-3.5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-ink">{title}</h2>
          {sub && <p className="mt-0.5 max-w-3xl text-[13px] text-sub">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}
