import clsx from 'clsx'
import { ChevronDown, Newspaper, ShieldAlert, ShieldCheck, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { inr, inr0, pct, pctRaw, sizeFor, tone } from '../lib/format'
import type { Pick } from '../lib/types'
import { Chip } from './ui'

export interface Settings { capital: number; riskPct: number }

const sectorTone = (s: string) => (s === 'Defence' ? 'gold' : s === 'Engineering' ? 'blue' : 'default') as 'gold' | 'blue' | 'default'

function Level({ label, price, pctVal, tone: t, sub }: { label: string; price: number; pctVal?: number; tone?: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-black/25 px-3 py-2">
      <div className="label">{label}</div>
      <div className={clsx('num text-[15px] font-semibold', t)}>₹{inr(price)}</div>
      {(pctVal != null || sub) && <div className="num text-[11px] text-slate-500">{pctVal != null && pctRaw(pctVal * 100)} {sub}</div>}
    </div>
  )
}

export default function PickCard({ p, index, settings, multiplier }: { p: Pick; index: number; settings: Settings; multiplier: number }) {
  const [open, setOpen] = useState(false)
  const s = sizeFor(settings.capital, settings.riskPct, multiplier, p.plan.stopPct, p.close)
  const f = p.fundamentals
  const n = p.sentiment
  const verdictTone = f?.verdict === 'PASS' ? 'green' : f?.verdict === 'AVOID' ? 'red' : 'gold'
  const roe = f?.roe3yAvg ?? f?.roe

  return (
    <article className="card overflow-hidden">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 p-4 pb-3">
        <div className="grid size-8 place-items-center rounded-lg bg-white/6 text-sm font-semibold text-slate-300">{index}</div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/stock/${p.symbol}`} className="text-lg font-semibold tracking-tight hover:text-emerald-300">{p.symbol}</Link>
            <Chip tone={sectorTone(p.sector)}>{p.sector}</Chip>
            {p.themeBoost && <Chip tone="gold" title="Priority theme in a strong sector: ranking bonus applied">★ priority</Chip>}
            {!p.inPriceBand && <Chip title="Outside your preferred ₹200–500 band">₹ band</Chip>}
          </div>
          <div className="num mt-1 text-sm text-slate-400">
            ₹{inr(p.close)} <span className={tone(p.changePct)}>{pctRaw(p.changePct)}</span> · ATR {p.atrPct.toFixed(1)}% · RSI {p.rsi.toFixed(0)}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Chip tone={p.decision === 'BUY' ? 'green' : 'gold'}>{p.decision === 'BUY' ? 'BUY' : 'WATCH'}</Chip>
          <div className="text-right">
            <div className="label">Model score</div>
            <div className="num text-base font-semibold text-emerald-300">{(p.score * 100).toFixed(1)}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 px-4 sm:grid-cols-5">
        <Level label="Buy at open ≤" price={p.plan.maxEntry} sub="skip if higher" />
        <Level label="Stop-loss" price={p.plan.stop} pctVal={-p.plan.stopPct} tone="text-rose-300" />
        <Level label="Target 1 · book 50%" price={p.plan.t1} pctVal={p.plan.t1Pct} tone="text-emerald-300" sub="→ SL to cost" />
        <Level label="Target 2 · exit rest" price={p.plan.t2} pctVal={p.plan.t2Pct} tone="text-emerald-300" />
        <div className="rounded-lg bg-black/25 px-3 py-2">
          <div className="label">Size @ ₹{inr0(settings.capital)}</div>
          <div className="num text-[15px] font-semibold">{s.qty} sh</div>
          <div className="num text-[11px] text-slate-500">₹{inr0(s.used)} · risk ₹{inr0(s.risk)}</div>
        </div>
      </div>
      <p className="px-4 pt-2 text-[11px] text-slate-500">
        Levels shown off last close (₹{inr(p.plan.entryRef)}); recompute from your actual fill. Hard time-stop: exit by day {p.plan.maxHoldDays} if neither level hits.
      </p>

      <div className="flex flex-wrap gap-1.5 px-4 pt-3">
        {p.tags.map((t) => <Chip key={t}>{t}</Chip>)}
      </div>

      <div className="mt-3 grid gap-3 border-t border-line/70 px-4 py-3 md:grid-cols-2">
        <div>
          <div className="label mb-1.5 flex items-center gap-1"><TrendingUp className="size-3" /> Why the model likes it</div>
          <ul className="space-y-1 text-[13px] text-slate-300">
            {p.reasons.slice(0, 4).map((r) => (
              <li key={r.feature} className="flex justify-between gap-3"><span>{r.label}</span><span className="num text-slate-400">{r.value}</span></li>
            ))}
          </ul>
        </div>
        <div className="space-y-2">
          <div>
            <div className="label mb-1.5 flex items-center gap-1">{f?.verdict === 'AVOID' ? <ShieldAlert className="size-3" /> : <ShieldCheck className="size-3" />} Fundamentals</div>
            {f?.ok ? (
              <div className="flex flex-wrap gap-1.5">
                <Chip tone={verdictTone}>{f.verdict} · {f.qualityScore}/100</Chip>
                <Chip>ROE {roe != null ? pct(roe, 0) : '-'}</Chip>
                <Chip>ROCE {f.roce != null ? pct(f.roce, 0) : '-'}</Chip>
                <Chip>D/E {f.debtToEquity != null ? f.debtToEquity.toFixed(2) : '-'}</Chip>
                <Chip>Sales CAGR {f.salesCagr != null ? pct(f.salesCagr, 0) : '-'}</Chip>
                <Chip>Profit CAGR {f.profitCagr != null ? pct(f.profitCagr, 0) : '-'}</Chip>
              </div>
            ) : <span className="text-xs text-slate-500">Fundamentals unavailable — treat as unverified.</span>}
            {f && f.flags.length > 0 && <div className="mt-1.5 text-xs text-amber-300/90">{f.flags.slice(0, 3).join(' · ')}</div>}
          </div>
          <div>
            <div className="label mb-1.5 flex items-center gap-1"><Newspaper className="size-3" /> News (10 days)</div>
            <div className="flex flex-wrap gap-1.5">
              <Chip tone={n?.label === 'POSITIVE' ? 'green' : n?.label === 'NEGATIVE' ? 'red' : 'default'}>{n?.label ?? 'n/a'}{n ? ` · ${n.score.toFixed(2)}` : ''}</Chip>
              <Chip>{n?.headlines ?? 0} headlines</Chip>
            </div>
          </div>
        </div>
      </div>

      {n && n.items.length > 0 && (
        <>
          <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between border-t border-line/70 px-4 py-2 text-xs text-slate-400 hover:text-slate-200">
            Headlines <ChevronDown className={clsx('size-4 transition', open && 'rotate-180')} />
          </button>
          {open && (
            <ul className="space-y-1.5 border-t border-line/70 px-4 py-3 text-[13px]">
              {n.items.slice(0, 6).map((h) => (
                <li key={h.link} className="flex gap-2">
                  <span className={clsx('mt-1.5 size-1.5 shrink-0 rounded-full', h.score > 0 ? 'bg-emerald-400' : h.score < 0 ? 'bg-rose-400' : 'bg-slate-600')} />
                  <a href={h.link} target="_blank" rel="noreferrer" className="text-slate-300 hover:text-white">
                    {h.title} <span className="text-slate-500">— {h.source ?? 'news'} · {h.ageDays}d</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  )
}
