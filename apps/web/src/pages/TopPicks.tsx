import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, Check, ChevronRight, Minus, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Disclaimer, PageHead, VerdictBadge } from '../components/selection'
import { ErrorBox, Loading } from '../components/ui'
import { cr, dateLabel, inr } from '../lib/format'
import { tp, type PeriodResult, type PickRow, type Screen, type TopPicks } from '../lib/topPicks'

const pctTxt = (x: number | null | undefined, d = 1) => (x == null ? 'n/a' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%`)

function Tick({ ok, children, title }: { ok: boolean | null; children?: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className={clsx('grid size-[18px] shrink-0 place-items-center rounded-full', ok == null ? 'bg-soft text-mute' : ok ? 'bg-pos-bg text-pos' : 'bg-neg-bg text-neg')}>
        {ok == null ? <Minus className="size-3" strokeWidth={3} /> : ok ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
      </span>
      {children && <span className={clsx('num text-[12px]', ok ? 'text-ink' : 'text-sub')}>{children}</span>}
    </span>
  )
}

const PeriodTick = ({ p }: { p: PeriodResult | null }) => (
  <Tick ok={p ? p.ok : null} title={p ? `${p.label}: ${p.from} → ${p.to}` : 'not enough history'}>{p ? pctTxt(p.ret) : 'n/a'}</Tick>
)

function RecoveryTick({ s }: { s: Screen }) {
  const r = s.resilience
  const last = r.dips.at(-1)
  const title = [
    `Max fall from a peak (3 months): ${r.maxDrawdown3mPct}%`,
    `Below 3-month high now: ${r.currentDrawdownPct}%`,
    r.worstWeekPct != null ? `Worst week (13 weeks): ${r.worstWeekPct}%` : '',
    ...r.dips.map((d) => `Dip ${d.depthPct}% from ${d.peakDate}: ${d.sessionsToRecover != null ? `recovered in ${d.sessionsToRecover} sessions` : 'not recovered'}`),
    ...r.reasons,
  ].filter(Boolean).join('\n')
  return <Tick ok={r.ok} title={title}>{last ? `dip ${last.depthPct}% · ${last.sessionsToRecover ?? '-'}d` : `max ${r.maxDrawdown3mPct}%`}</Tick>
}

function Funnel({ f }: { f: TopPicks['funnel'] }) {
  const steps: [string, number][] = [
    ['Liquid NSE stocks', f.liquid], ['Last week +', f.week], ['+ last month +', f.month], ['+ last quarter +', f.quarter], ['+ last FY +', f.fy],
    ['+ 2-month streak', f.streak], ['+ no major fall', f.resilient], ['+ fundamentals & gates', f.final], ['Entry ready today', f.buyNow],
  ]
  const max = Math.max(1, f.liquid)
  return (
    <div className="card p-4">
      <div className="label mb-3">How the list was filtered</div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-9">
        {steps.map(([label, n], i) => (
          <div key={label} className={clsx('rounded-lg px-2.5 py-2', i === steps.length - 1 ? 'bg-pos-bg' : i === steps.length - 2 ? 'bg-brand-soft' : 'bg-soft')}>
            <div className="num text-[20px] font-semibold leading-none text-ink">{n}</div>
            <div className="mt-1 text-[11px] leading-tight text-sub">{label}</div>
            <div className="mt-1.5 h-1 rounded-full bg-line"><div className="h-1 rounded-full bg-brand" style={{ width: `${Math.max(2, (n / max) * 100)}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BacktestCard() {
  const [open, setOpen] = useState(false)
  const q = useQuery({ queryKey: ['tp-backtest'], queryFn: tp.backtest, retry: false, refetchInterval: (x) => (x.state.error ? 60_000 : false) })
  if (q.error) return <div className="card p-4 text-[13px] text-mute">Backtest of the screen is being computed (runs after the first Top Picks run)…</div>
  if (!q.data) return null
  const d = q.data, s = d.summary, n = d.benchmarks.nifty, u = d.benchmarks.universe
  const sign = (x: number | null) => (x == null ? 'n/a' : `${x > 0 ? '+' : ''}${x}%`)
  const good = (s.avgMonthlyPicks ?? 0) > (n.avg1m ?? 0)
  const split = d.split.slice(0, 4)
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="label">Backtest of these rules · every month-end {d.from.slice(0, 7)} → {d.to.slice(0, 7)} · after 0.4% costs</div>
        <span className={clsx('text-[12px] font-medium', good ? 'text-pos' : 'text-neg')}>{good ? 'beat the Nifty 50 on average' : 'did not beat the Nifty 50 on average'}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {[
          ['Picks, avg 1 month', sign(s.avgMonthlyPicks), `Nifty ${sign(n.avg1m)} · all stocks ${sign(u.avg1m)}`],
          ['Picks, avg 3 months', sign(s.avg3mPicks), `Nifty ${sign(n.avg3m)} · all stocks ${sign(u.avg3m)}`],
          ['Months beating Nifty', `${s.monthsBeatNifty}%`, `${s.monthsWithPicks} months with picks`],
          ['Picks up after 1 month', `${s.stockHitRate}%`, `about ${s.avgPicksPerMonth} stocks a month`],
          ['Cumulative (1-month holds)', sign(s.cumulativePicks), `Nifty ${sign(n.cumulative)}`],
          ['Worst month', sign(s.worstMonthPicks), ''],
        ].map(([k, v, sub]) => (
          <div key={k}><div className="num text-[18px] font-semibold leading-none">{v}</div><div className="mt-1 text-[11.5px] text-sub">{k}</div>{sub && <div className="text-[11px] text-mute">{sub}</div>}</div>
        ))}
      </div>
      <button onClick={() => setOpen(!open)} className="mt-3 text-[12.5px] font-medium text-brand">{open ? 'Hide' : 'Show'} which rules help (rule-by-rule test)</button>
      {open && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[900px] text-[12.5px]">
            <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-mute">
              <tr><th className="py-2 pr-3">Rule set</th><th className="pr-3 text-right">Stocks / month</th><th className="pr-3 text-right">Avg 1M</th><th className="pr-3 text-right">Avg 3M</th>
                <th className="pr-3 text-right">1M before {split}</th><th className="pr-3 text-right">1M from {split}</th><th className="pr-3 text-right">Beat Nifty</th><th className="pr-3 text-right">Cumulative</th><th className="text-right">Worst month</th></tr>
            </thead>
            <tbody>
              {d.variants.map((v) => (
                <tr key={v.key} className={clsx('border-b border-line/60', v.key === 'all' && 'font-medium')}>
                  <td className="py-1.5 pr-3">{v.label}</td>
                  <td className="num pr-3 text-right">{v.avgPicks}</td>
                  <td className={clsx('num pr-3 text-right', (v.avg1m ?? 0) > n.avg1m ? 'text-pos' : 'text-neg')}>{sign(v.avg1m)}</td>
                  <td className="num pr-3 text-right">{sign(v.avg3m)}</td>
                  <td className="num pr-3 text-right">{sign(v.avg1mFirstHalf)}</td>
                  <td className="num pr-3 text-right">{sign(v.avg1mSecondHalf)}</td>
                  <td className="num pr-3 text-right">{v.monthsBeatNifty}%</td>
                  <td className="num pr-3 text-right">{sign(v.cumulative)}</td>
                  <td className="num text-right">{sign(v.worstMonth)}</td>
                </tr>
              ))}
              {(['nifty', 'universe'] as const).map((k) => (
                <tr key={k} className="border-b border-line/60 text-sub">
                  <td className="py-1.5 pr-3">{k === 'nifty' ? 'Nifty 50 (benchmark)' : 'Every liquid stock, equal weight'}</td><td />
                  <td className="num pr-3 text-right">{sign(d.benchmarks[k].avg1m)}</td><td className="num pr-3 text-right">{sign(d.benchmarks[k].avg3m)}</td>
                  <td className="num pr-3 text-right">{sign(d.benchmarks[k].avg1mFirstHalf)}</td><td className="num pr-3 text-right">{sign(d.benchmarks[k].avg1mSecondHalf)}</td>
                  <td /><td className="num pr-3 text-right">{sign(d.benchmarks[k].cumulative)}</td><td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[11.5px] text-mute">{d.notes.join(' ')}</p>
    </div>
  )
}

/** Where to buy: now (entry confirmed) or the pullback level where the setup would become valid, with stop / target / R:R at that price. */
export function buyPlan(r: PickRow) {
  const t = r.technical
  if (!t || r.close == null) return null
  const now = t.ready
  const price = now ? t.plan.entry : t.watch?.alertPrice ?? null
  if (price == null) return { now, price: null, stop: t.plan.stop, target: t.plan.target, rr: null, distPct: null, zone: null as string | null }
  // the stop was set for the current close; at a lower buy price keep it at least 1 x ATR below that price (a tighter stop is just noise)
  const stop = now || !t.atrPct ? t.plan.stop : Math.round(Math.min(t.plan.stop, price * (1 - t.atrPct / 100)) * 100) / 100
  const risk = price - stop
  const rr = risk > 0 ? Math.round(((t.plan.target - price) / risk) * 100) / 100 : null
  return { now, price, stop, target: t.plan.target, rr, distPct: Math.round((price / r.close - 1) * 1000) / 10, zone: now ? null : t.watch?.zone ?? null }
}

function Row({ r }: { r: PickRow }) {
  const t = r.technical
  const s = r.screen
  const bp = buyPlan(r)
  return (
    <tr className="border-b border-line/70 last:border-0 hover:bg-soft/60">
      <td className="num px-3 py-3 text-[13px] font-semibold text-mute">{r.rank ?? ''}</td>
      <td className="px-3 py-3">
        <Link to={`/verdict/${r.symbol}`} className="font-semibold text-ink hover:text-brand">{r.symbol}</Link>
        <div className="max-w-44 truncate text-[11.5px] text-mute" title={r.name ?? ''}>{r.name}</div>
        <div className="text-[11px] text-mute">{r.sector ?? ''}</div>
      </td>
      <td className="num px-3 py-3 text-[13px]">₹{inr(r.close)}</td>
      <td className="px-3 py-3">
        {r.rejectedFor ? <span className="text-[12px] text-neg">{r.rejectedFor}</span> : (
          <>
            <span className={clsx('whitespace-nowrap rounded-md px-2 py-0.5 text-[11.5px] font-semibold', r.action === 'BUY now' ? 'bg-pos text-white' : 'bg-amber-bg text-amber')}>{r.action}</span>
            <div className="mt-1"><VerdictBadge v={r.verdict} /></div>
          </>
        )}
      </td>
      <td className="num px-3 py-3 text-[12px]">
        {bp && bp.price != null ? (
          <>
            <div className={clsx('text-[14px] font-semibold', bp.now ? 'text-pos' : 'text-amber')}>
              {bp.now ? 'Buy now ₹' : 'Buy at ₹'}{inr(bp.price)}{!bp.now && <span className="text-[11px] font-normal text-mute"> or below</span>}
            </div>
            {!bp.now && bp.distPct != null && <div className="text-[11px] text-mute">{bp.distPct}% from now{bp.zone ? ` · ${bp.zone}` : ''}</div>}
            <div className="mt-0.5"><span className="text-neg">SL {inr(bp.stop)}</span> · <span className="text-pos">T {inr(bp.target)}</span></div>
            <div className="text-[11px] text-mute">R:R {bp.rr != null ? `1:${bp.rr}` : 'n/a'}{t?.targets[1] ? ` · T2 ₹${inr(t.targets[1].price)} (+${t.targets[1].pct}%)` : ''}</div>
          </>
        ) : <span className="text-mute">no clear level</span>}
      </td>
      <td className="px-2 py-3"><PeriodTick p={s.periods.week} /></td>
      <td className="px-2 py-3"><PeriodTick p={s.periods.month} /></td>
      <td className="px-2 py-3"><PeriodTick p={s.periods.quarter} /></td>
      <td className="px-2 py-3"><PeriodTick p={s.periods.fy} /></td>
      <td className="px-2 py-3"><Tick ok={s.ticks.streak} title={`Consecutive positive months: ${s.monthStreak}; up months ${s.monthsUp.up}/${s.monthsUp.total}; up weeks ${s.weeksUp.up}/${s.weeksUp.total}`}>{s.monthStreak} mo</Tick></td>
      <td className="px-2 py-3"><RecoveryTick s={s} /></td>
      <td className="num px-3 py-3 text-[12.5px]" title="Fundamental score (18-step, out of 100) and data coverage">{r.totalScore}<span className="text-mute"> · {Math.round(r.coverage * 100)}%</span></td>
      <td className="px-3 py-3 text-[12px]">
        {t ? (
          <div className="space-y-0.5">
            <div className="flex gap-1.5">
              <Tick ok={t.checks.trendOk} title="Trend: close above EMA200 with higher highs / higher lows" />
              <Tick ok={t.checks.atLevel} title={t.levelReasons[0] ?? 'Not at support / EMA50 / order block / POC / Fib confluence'} />
              <Tick ok={t.checks.triggerConfirmed} title={t.patterns.join(', ') || 'No bullish candle with above-average volume'} />
              <Tick ok={!t.checks.extended} title="Not more than 20% above EMA50" />
              <Tick ok={t.checks.rrOk} title={`Reward : risk 1 : ${t.checks.rewardRisk}`} />
            </div>
            <div className="max-w-52 truncate text-[11px] text-mute" title={[t.levelReasons.join('; '), t.fibZone ? `Fib: ${t.fibZone}` : '', t.structure ? `${t.structure.type} ${t.structure.dir} ${t.structure.date}` : ''].filter(Boolean).join('\n')}>
              {t.patterns[0] ?? t.levelReasons[0] ?? t.trend}
            </div>
          </div>
        ) : 'n/a'}
      </td>
      <td className="num px-3 py-3 text-right">
        {r.composite != null && <div className="text-[15px] font-semibold">{r.composite}</div>}
        {r.composite != null && <div className="text-[10.5px] text-mute" title="momentum · fundamentals · technical">{r.momentumScore} · {r.fundamentalScore} · {r.technicalScore}</div>}
      </td>
      <td className="px-2"><Link to={`/verdict/${r.symbol}`} className="text-mute hover:text-brand"><ChevronRight className="size-4" /></Link></td>
    </tr>
  )
}

// ---- filters (all combine with AND) and sorting ----------------------------------------------------------
type SortKey = 'rank' | 'symbol' | 'price' | 'dist' | 'rr' | 'ret3m' | 'ret1y' | 'fund' | 'score'
interface Filters {
  q: string; action: 'all' | 'now' | 'wait'; sectors: string[]; minFund: string; minScore: string; minRet3m: string; minRet1y: string
  minPrice: string; maxPrice: string; maxDist: string; minRr: string
  checks: { trend: boolean; level: boolean; candle: boolean; notExtended: boolean; rr: boolean }
}
const EMPTY: Filters = { q: '', action: 'all', sectors: [], minFund: '', minScore: '', minRet3m: '', minRet1y: '', minPrice: '', maxPrice: '', maxDist: '', minRr: '', checks: { trend: false, level: false, candle: false, notExtended: false, rr: false } }

const num = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v))

function applyFilters(rows: PickRow[], f: Filters): PickRow[] {
  const minFund = num(f.minFund), minScore = num(f.minScore), r3 = num(f.minRet3m), r1 = num(f.minRet1y)
  const pMin = num(f.minPrice), pMax = num(f.maxPrice), maxDist = num(f.maxDist), minRr = num(f.minRr)
  const q = f.q.trim().toUpperCase()
  return rows.filter((r) => {
    const t = r.technical, bp = buyPlan(r)
    if (q && !r.symbol.includes(q) && !(r.name ?? '').toUpperCase().includes(q)) return false
    if (f.action === 'now' && r.action !== 'BUY now') return false
    if (f.action === 'wait' && r.action !== 'Wait for entry') return false
    if (f.sectors.length && !f.sectors.includes(r.sector ?? 'Unclassified')) return false
    if (minFund != null && r.totalScore < minFund) return false
    if (minScore != null && (r.composite ?? 0) < minScore) return false
    if (r3 != null && (r.screen.ret3m == null || r.screen.ret3m * 100 < r3)) return false
    if (r1 != null && (r.screen.ret1y == null || r.screen.ret1y * 100 < r1)) return false
    if (pMin != null && (r.close ?? 0) < pMin) return false
    if (pMax != null && (r.close ?? Infinity) > pMax) return false
    if (maxDist != null && (bp?.distPct == null || Math.abs(bp.distPct) > maxDist)) return false
    if (minRr != null && (bp?.rr == null || bp.rr < minRr)) return false
    if (f.checks.trend && !t?.checks.trendOk) return false
    if (f.checks.level && !t?.checks.atLevel) return false
    if (f.checks.candle && !t?.checks.triggerConfirmed) return false
    if (f.checks.notExtended && (t?.checks.extended ?? true)) return false
    if (f.checks.rr && !t?.checks.rrOk) return false
    return true
  })
}

const SORT_VALUE: Record<SortKey, (r: PickRow) => number | string> = {
  rank: (r) => r.rank ?? 9999, symbol: (r) => r.symbol, price: (r) => r.close ?? 0, dist: (r) => Math.abs(buyPlan(r)?.distPct ?? 999),
  rr: (r) => buyPlan(r)?.rr ?? -1, ret3m: (r) => r.screen.ret3m ?? -9, ret1y: (r) => r.screen.ret1y ?? -9, fund: (r) => r.totalScore, score: (r) => r.composite ?? 0,
}

function NumInput({ label, value, onChange, w = 'w-20', ph }: { label: string; value: string; onChange: (v: string) => void; w?: string; ph?: string }) {
  return (
    <label className="text-[11px] text-mute">
      <div className="mb-1 uppercase tracking-wide">{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} type="number" step="any" placeholder={ph} className={clsx('num !py-1 text-[12.5px]', w)} />
    </label>
  )
}

function FilterBar({ f, set, sectors, shown, total }: { f: Filters; set: (f: Filters) => void; sectors: string[]; shown: number; total: number }) {
  const active = JSON.stringify(f) !== JSON.stringify(EMPTY)
  const toggleSector = (s: string) => set({ ...f, sectors: f.sectors.includes(s) ? f.sectors.filter((x) => x !== s) : [...f.sectors, s] })
  const checks: [keyof Filters['checks'], string][] = [['trend', 'Uptrend'], ['level', 'At a level'], ['candle', 'Candle trigger'], ['notExtended', 'Not extended'], ['rr', 'R:R ≥ 2']]
  return (
    <div className="card mb-3 space-y-3 p-3.5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[11px] text-mute"><div className="mb-1 uppercase tracking-wide">Search</div><input value={f.q} onChange={(e) => set({ ...f, q: e.target.value })} placeholder="Symbol or name" className="!py-1 w-40 text-[12.5px]" /></label>
        <label className="text-[11px] text-mute"><div className="mb-1 uppercase tracking-wide">Action</div>
          <select value={f.action} onChange={(e) => set({ ...f, action: e.target.value as Filters['action'] })} className="!py-1 text-[12.5px]"><option value="all">All</option><option value="now">Buy now</option><option value="wait">Wait for entry</option></select>
        </label>
        <details className="relative text-[11px] text-mute">
          <summary className="mb-1 cursor-pointer list-none uppercase tracking-wide">Sector{f.sectors.length ? ` (${f.sectors.length})` : ''}</summary>
          <div className="absolute z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-lg border border-line-strong bg-surface p-2 shadow-lg">
            {sectors.map((s) => (
              <label key={s} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12.5px] text-ink hover:bg-soft"><input type="checkbox" checked={f.sectors.includes(s)} onChange={() => toggleSector(s)} />{s}</label>
            ))}
          </div>
          <div className="rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-[12.5px] text-ink">{f.sectors.length ? f.sectors.slice(0, 2).join(', ') + (f.sectors.length > 2 ? '…' : '') : 'All sectors'}</div>
        </details>
        <NumInput label="Price from ₹" value={f.minPrice} onChange={(v) => set({ ...f, minPrice: v })} ph="200" />
        <NumInput label="Price to ₹" value={f.maxPrice} onChange={(v) => set({ ...f, maxPrice: v })} />
        <NumInput label="Within % of buy price" value={f.maxDist} onChange={(v) => set({ ...f, maxDist: v })} w="w-28" ph="e.g. 3" />
        <NumInput label="Min R:R" value={f.minRr} onChange={(v) => set({ ...f, minRr: v })} ph="2" />
        <NumInput label="Min fundamentals" value={f.minFund} onChange={(v) => set({ ...f, minFund: v })} w="w-28" ph="75" />
        <NumInput label="Min total score" value={f.minScore} onChange={(v) => set({ ...f, minScore: v })} w="w-24" />
        <NumInput label="3M return ≥ %" value={f.minRet3m} onChange={(v) => set({ ...f, minRet3m: v })} w="w-24" />
        <NumInput label="1Y return ≥ %" value={f.minRet1y} onChange={(v) => set({ ...f, minRet1y: v })} w="w-24" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-mute">Must have</span>
        {checks.map(([k, label]) => (
          <button key={k} onClick={() => set({ ...f, checks: { ...f.checks, [k]: !f.checks[k] } })} className={clsx('rounded-full border px-2.5 py-1 text-[12px]', f.checks[k] ? 'border-brand bg-brand-soft text-brand' : 'border-line text-sub hover:bg-soft')}>{f.checks[k] ? '✓ ' : ''}{label}</button>
        ))}
        <span className="num ml-auto text-[12px] text-sub">{shown} of {total}</span>
        {active && <button onClick={() => set(EMPTY)} className="text-[12px] font-medium text-brand">Clear all</button>}
      </div>
    </div>
  )
}

function Table({ rows }: { rows: PickRow[] }) {
  const [f, setF] = useState<Filters>(EMPTY)
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'rank', dir: 1 })
  const sectors = [...new Set(rows.map((r) => r.sector ?? 'Unclassified'))].sort()
  const shown = applyFilters(rows, f).sort((a, b) => {
    const x = SORT_VALUE[sort.k](a), y = SORT_VALUE[sort.k](b)
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
  })
  const Th = ({ k, children, className }: { k?: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={clsx('px-3', className)}>
      {k ? (
        <button onClick={() => setSort(sort.k === k ? { k, dir: sort.dir === 1 ? -1 : 1 } : { k, dir: k === 'symbol' || k === 'rank' || k === 'dist' ? 1 : -1 })} className="inline-flex items-center gap-1 uppercase hover:text-ink">
          {children}{sort.k === k && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
        </button>
      ) : children}
    </th>
  )
  return (
    <>
      <FilterBar f={f} set={setF} sectors={sectors} shown={shown.length} total={rows.length} />
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1500px]">
          <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-mute">
            <tr>
              <Th k="rank" className="py-2.5">#</Th><Th k="symbol">Stock</Th><Th k="price">Price</Th><Th>Action</Th><Th k="dist">Buy price · SL · target</Th>
              <th className="px-2">Week</th><th className="px-2">Month</th><th className="px-2">Quarter</th><th className="px-2">Fin. year</th>
              <th className="px-2">Streak</th><th className="px-2">No major fall</th><Th k="fund">Fundamentals</Th>
              <th className="px-3" title="trend · level · candle · not extended · R:R">Technical</th>
              <Th k="score" className="text-right">Score</Th><th />
            </tr>
          </thead>
          <tbody>{shown.map((r) => <Row key={r.symbol} r={r} />)}</tbody>
        </table>
        {shown.length === 0 && <div className="p-8 text-center text-sm text-sub">No stock matches this combination of filters.</div>}
      </div>
    </>
  )
}

export default function TopPicksPage() {
  const [tab, setTab] = useState<'picks' | 'rejected' | 'near'>('picks')
  const q = useQuery({ queryKey: ['top-picks'], queryFn: tp.latest, retry: false })
  const d = q.data
  return (
    <>
      <PageHead
        label="Top Picks"
        title={d ? `Strongest stocks · ${dateLabel(d.asOf)}` : 'Strongest stocks'}
        sub="Closed positive in the last week, month, quarter and financial year; rising at least 2 months in a row; no major fall and dips recovered quickly. Every survivor then goes through the proposal's fundamental, liquidity, governance and technical analysis (trend, candles, support/resistance, Fibonacci retracement and extension, structure, order blocks, volume profile). Ranked by momentum, fundamentals and technical setup."
      />
      {q.isLoading && <Loading what="Top Picks" />}
      {q.error && <ErrorBox error={q.error} hint="Press Refresh Top Picks in the sidebar to build the first list (about 10-20 minutes)." />}
      {d && (
        <div className="space-y-4">
          {d.market && (
            <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-[12.5px]">
              <span className="label">Nifty 50</span>
              {(['week', 'month', 'quarter', 'fy'] as const).map((k) => (
                <span key={k} className="flex items-center gap-1.5"><span className="text-sub">{d.market!.periods[k]?.label ?? k}</span><PeriodTick p={d.market!.periods[k]} /></span>
              ))}
              <span className="text-sub">{d.market.fytd.label} <b className="num text-ink">{pctTxt(d.market.fytd.ret)}</b></span>
            </div>
          )}
          <Funnel f={d.funnel} />
          {!!d.failed?.length && <p className="text-[12px] text-amber">Could not analyse {d.failed.length}: {d.failed.map((f) => f.symbol).join(', ')} (press Refresh to retry).</p>}
          <BacktestCard />
          <div className="flex gap-1.5">
            {([['picks', `Top Picks (${d.rows.length})`], ['rejected', `Failed fundamentals (${d.rejected.length})`], ['near', `Missed one check (${d.nearMisses.length})`]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} className={clsx('rounded-lg border px-3 py-1.5 text-[13px]', tab === k ? 'border-brand bg-brand-soft text-brand' : 'border-line text-sub hover:bg-soft')}>{label}</button>
            ))}
          </div>
          {tab === 'picks' && (d.rows.length ? <Table rows={d.rows} /> : <div className="card p-8 text-center text-sm text-sub">No stock passed every check today. That is the screen protecting capital in a weak market — see “Missed one check”.</div>)}
          {tab === 'rejected' && <Table rows={d.rejected} />}
          {tab === 'near' && (
            <div className="card divide-y divide-line">
              {d.nearMisses.map((n) => (
                <div key={n.symbol} className="flex flex-wrap items-center gap-4 px-4 py-2.5 text-[13px]">
                  <Link to={`/verdict/${n.symbol}`} className="w-32 font-semibold hover:text-brand">{n.symbol}</Link>
                  <span className="flex gap-3">
                    <PeriodTick p={n.screen.periods.week} /><PeriodTick p={n.screen.periods.month} /><PeriodTick p={n.screen.periods.quarter} /><PeriodTick p={n.screen.periods.fy} />
                    <Tick ok={n.screen.ticks.streak}>{n.screen.monthStreak} mo</Tick><RecoveryTick s={n.screen} />
                  </span>
                  <span className="text-[12.5px] text-amber">missing: {n.missing}</span>
                  <span className="num ml-auto text-sub">3M {pctTxt(n.screen.ret3m)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[12px] text-mute">
            Hover a tick for details. Liquidity ≥ {cr(d.criteria.minAdtvCr)}/day, price ≥ ₹{d.criteria.minPrice}; no fall deeper than {d.criteria.maxDrawdown3mPct}% in 3 months,
            within {d.criteria.maxCurrentDrawdownPct}% of the 3-month high, every dip of {d.criteria.dipPct}%+ recovered within {d.criteria.maxRecoverySessions} sessions,
            no week worse than {d.criteria.worstWeekPct}%. Prices are split/bonus adjusted NSE closes.
          </p>
        </div>
      )}
      <Disclaimer />
    </>
  )
}
