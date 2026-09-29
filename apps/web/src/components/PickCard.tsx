import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { inr, inr0, pct, pctRaw, sizeFor, tone } from '../lib/format'
import type { Pick } from '../lib/types'
import { Chip } from './ui'

export interface Settings { capital: number; riskPct: number }

const sectorTone = (s: string) => (s === 'Defence' ? 'gold' : s === 'Engineering' ? 'blue' : 'default') as 'gold' | 'blue' | 'default'

function Level({ label, price, sub, color }: { label: string; price: number; sub?: string; color?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={clsx('num mt-1 text-[17px] font-semibold leading-none', color ?? 'text-ink')}>₹{inr(price)}</div>
      {sub && <div className="num mt-1 text-xs text-mute">{sub}</div>}
    </div>
  )
}

export default function PickCard({ p, index, settings, multiplier }: { p: Pick; index: number; settings: Settings; multiplier: number }) {
  const [open, setOpen] = useState(false)
  const s = sizeFor(settings.capital, settings.riskPct, multiplier, p.plan.stopPct, p.close)
  const f = p.fundamentals
  const n = p.sentiment
  const roe = f?.roe3yAvg ?? f?.roe
  const vTone = f?.verdict === 'PASS' ? 'green' : f?.verdict === 'AVOID' ? 'red' : 'gold'

  return (
    <article className="card overflow-hidden">
      <div className="flex items-start gap-3 p-5 pb-4">
        <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-brand-soft text-xs font-semibold text-brand">{index}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/stock/${p.symbol}`} className="text-[19px] font-semibold tracking-tight text-ink hover:text-brand">{p.symbol}</Link>
            <Chip tone={sectorTone(p.sector)}>{p.sector}</Chip>
            {p.themeBoost && <Chip tone="gold" title="Priority theme in a strong sector: ranking bonus applied">★ Priority</Chip>}
          </div>
          <div className="num mt-1 text-[13px] text-sub">
            ₹{inr(p.close)} <span className={tone(p.changePct)}>{pctRaw(p.changePct)}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Chip tone={p.decision === 'BUY' ? 'green' : 'gold'}>{p.decision === 'BUY' ? 'Buy' : 'Watch'}</Chip>
          <span className="num text-xs text-mute">Score {(p.score * 100).toFixed(1)}</span>
        </div>
      </div>

      <div className="mx-5 grid grid-cols-2 gap-x-4 gap-y-4 rounded-xl bg-soft px-4 py-4 sm:grid-cols-4">
        <Level label="Buy at open ≤" price={p.plan.maxEntry} sub="skip if higher" />
        <Level label="Stop-loss" price={p.plan.stop} sub={pctRaw(-p.plan.stopPct * 100)} color="text-neg" />
        <Level label="Target 1" price={p.plan.t1} sub={`${pctRaw(p.plan.t1Pct * 100)} · book half`} color="text-pos" />
        <Level label="Target 2" price={p.plan.t2} sub={pctRaw(p.plan.t2Pct * 100)} color="text-pos" />
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-5 pb-4 pt-3.5 text-[13px] text-sub">
        <span><b className="num font-semibold text-ink">{s.qty}</b> shares · ₹{inr0(s.used)}</span>
        <span>Risk <b className="num font-semibold text-ink">₹{inr0(s.risk)}</b></span>
        <span className="ml-auto flex items-center gap-1.5">
          {f && <Chip tone={vTone}>Fundamentals {f.verdict === 'UNKNOWN' ? 'n/a' : f.verdict.toLowerCase()}</Chip>}
          {n && <Chip tone={n.label === 'POSITIVE' ? 'green' : n.label === 'NEGATIVE' ? 'red' : 'default'}>News {n.label.toLowerCase()}</Chip>}
        </span>
      </div>

      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between border-t border-line px-5 py-2.5 text-[13px] font-medium text-sub hover:bg-soft hover:text-ink">
        {open ? 'Hide details' : 'Why this pick · details'}
        <ChevronDown className={clsx('size-4 transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="grid gap-6 border-t border-line bg-soft/60 px-5 py-5 md:grid-cols-2">
          <div>
            <div className="label mb-2">Model drivers</div>
            <ul className="space-y-1.5 text-[13px]">
              {p.reasons.slice(0, 5).map((r) => (
                <li key={r.feature} className="flex justify-between gap-3"><span className="text-sub">{r.label}</span><span className="num font-medium text-ink">{r.value}</span></li>
              ))}
            </ul>
            {p.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{p.tags.map((t) => <Chip key={t}>{t}</Chip>)}</div>}
          </div>
          <div>
            <div className="label mb-2">Quality check</div>
            {f?.ok ? (
              <ul className="space-y-1.5 text-[13px]">
                {([['ROE (3y)', roe != null ? pct(roe, 0) : '-'], ['ROCE', f.roce != null ? pct(f.roce, 0) : '-'], ['Debt / equity', f.debtToEquity != null ? f.debtToEquity.toFixed(2) : '-'], ['Sales CAGR', f.salesCagr != null ? pct(f.salesCagr, 0) : '-'], ['Profit CAGR', f.profitCagr != null ? pct(f.profitCagr, 0) : '-'], ['Score', `${f.qualityScore}/100`]] as const).map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-3"><span className="text-sub">{k}</span><span className="num font-medium text-ink">{v}</span></li>
                ))}
              </ul>
            ) : <p className="text-[13px] text-mute">Fundamentals unavailable — treat as unverified.</p>}
            {f && f.flags.length > 0 && <p className="mt-2 text-xs text-amber">{f.flags.slice(0, 3).join(' · ')}</p>}
          </div>
          {n && n.items.length > 0 && (
            <div className="md:col-span-2">
              <div className="label mb-2">Latest headlines</div>
              <ul className="space-y-1.5 text-[13px]">
                {n.items.slice(0, 4).map((h) => (
                  <li key={h.link} className="flex gap-2">
                    <span className={clsx('mt-[7px] size-1.5 shrink-0 rounded-full', h.score > 0 ? 'bg-pos' : h.score < 0 ? 'bg-neg' : 'bg-line-strong')} />
                    <a href={h.link} target="_blank" rel="noreferrer" className="text-ink hover:text-brand">{h.title} <span className="text-mute">— {h.source ?? 'news'}, {h.ageDays}d</span></a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11.5px] text-mute md:col-span-2">Levels are computed off the last close (₹{inr(p.plan.entryRef)}); recompute from your actual fill. Exit any remainder by day {p.plan.maxHoldDays}.</p>
        </div>
      )}
    </article>
  )
}
