import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Chip, ErrorBox, Loading } from '../components/ui'
import { api } from '../lib/api'
import { inr, pctRaw, tone } from '../lib/format'
import type { ScreenerRow } from '../lib/types'

const BUCKETS = [
  { k: 'b1', label: '₹50 – 100', lo: 50, hi: 100 },
  { k: 'b2', label: '₹100 – 150', lo: 100, hi: 150 },
  { k: 'b3', label: '₹150 – 200', lo: 150, hi: 200 },
  { k: 'b4', label: '₹200 +', lo: 200, hi: Infinity },
] as const
type BK = (typeof BUCKETS)[number]['k']

const HZ = [
  { k: 'd5', label: '5D' }, { k: 'd10', label: '10D' }, { k: 'w3', label: '3W' }, { k: 'm1', label: '1M' },
  { k: 'q1', label: '3M' }, { k: 'h1', label: '6M' }, { k: 'y1', label: '1Y' },
] as const
type HK = (typeof HZ)[number]['k']

const PRESETS: { label: string; keys: HK[] }[] = [
  { label: 'Short term (5D–1M)', keys: ['d5', 'd10', 'w3', 'm1'] },
  { label: 'Up to 3 months', keys: ['d5', 'd10', 'w3', 'm1', 'q1'] },
  { label: 'Up to 6 months', keys: ['d5', 'd10', 'w3', 'm1', 'q1', 'h1'] },
  { label: 'All horizons', keys: ['d5', 'd10', 'w3', 'm1', 'q1', 'h1', 'y1'] },
]

type SortKey = 'symbol' | 'ratingScore' | 'modelRank' | 'close' | 'chg1' | 'turnoverCr' | 'npos' | HK

export default function Screener() {
  const q = useQuery({ queryKey: ['screener'], queryFn: api.screener, staleTime: 5 * 60_000 })
  const [buckets, setBuckets] = useState<BK[]>(['b1'])
  const [req, setReq] = useState<HK[]>(['d5', 'd10', 'w3', 'm1'])
  const [minTurn, setMinTurn] = useState(2)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'ratingScore', dir: -1 })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const rows = useMemo(() => (q.data?.rows ?? []).map((r) => ({ ...r, npos: HZ.filter((h) => (r[h.k] ?? -1) > 0).length, ratingScore: r.rating?.score ?? -1 })), [q.data])

  const passing = useMemo(
    () => rows.filter((r) => r.turnoverCr >= minTurn && req.every((k) => r[k] != null && (r[k] as number) > 0) && (!search || r.symbol.includes(search.toUpperCase()) || (r.name ?? '').toLowerCase().includes(search.toLowerCase()))),
    [rows, req, minTurn, search],
  )
  const counts = useMemo(() => Object.fromEntries(BUCKETS.map((b) => [b.k, passing.filter((r) => r.close >= b.lo && r.close < b.hi).length])), [passing])
  const shown = useMemo(() => {
    const ranges = BUCKETS.filter((x) => buckets.includes(x.k))
    const list = passing.filter((r) => ranges.some((b) => r.close >= b.lo && r.close < b.hi))
    return [...list].sort((a, c) => {
      const av = (a as unknown as Record<string, number | string | null>)[sort.k]
      const cv = (c as unknown as Record<string, number | string | null>)[sort.k]
      if (typeof av === 'string' && typeof cv === 'string') return av.localeCompare(cv) * sort.dir
      if (av == null && cv == null) return 0
      if (av == null) return 1
      if (cv == null) return -1
      return ((av as number) - (cv as number)) * sort.dir
    })
  }, [passing, buckets, sort])

  if (q.isLoading) return <Loading what="screener (first load takes ~20s)" />
  if (q.error) return <ErrorBox error={q.error} />
  const data = q.data!

  const pages = Math.max(1, Math.ceil(shown.length / pageSize))
  const cur = Math.min(page, pages)
  const pageRows = shown.slice((cur - 1) * pageSize, cur * pageSize)
  const from = shown.length ? (cur - 1) * pageSize + 1 : 0
  const pageNums = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - cur) <= 1)
  const toggle = (k: HK) => { setReq((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k])); setPage(1) }
  const head = (k: SortKey, label: string, right = true) => {
    const active = sort.k === k
    return (
      <th key={k} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} title={active ? (sort.dir === 1 ? 'Ascending — click for descending' : 'Descending — click for ascending') : 'Click to sort'}
        className={clsx('label cursor-pointer select-none px-3 py-2.5 font-medium transition hover:text-ink', right && 'text-right', active && '!text-brand')}
        onClick={() => { setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : k === 'modelRank' || k === 'symbol' ? 1 : -1 })); setPage(1) }}>
        <span className="inline-flex items-center gap-1">{label}
          {active ? (sort.dir === 1 ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />) : <ChevronsUpDown className="size-3 opacity-40" />}
        </span>
      </th>
    )
  }
  const cell = (v: number | null) => <td className={clsx('num px-3 py-2 text-right', tone(v))}>{v == null ? '-' : pctRaw(v, 1)}</td>

  return (
    <>
      <div>
        <div className="label">Screener</div>
        <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight">Positive-everywhere stocks by price range</h1>
        <p className="mt-1 max-w-3xl text-[13px] text-sub">Shows stocks that closed <b>up</b> over every horizon you tick — so the trend is positive short-term <i>and</i> longer-term. Data as of {data.asOf}, split/bonus adjusted (5D–3W = trading sessions; 1M, 3M, 6M, 1Y = calendar months, like Google), {data.count.toLocaleString('en-IN')} stocks scanned.</p>
      </div>

      <div className="card mt-5 p-5">
        <div className="label mb-2.5">Must be positive over</div>
        <div className="flex flex-wrap items-center gap-2">
          {HZ.map((h) => (
            <button key={h.k} onClick={() => toggle(h.k)} className={clsx('rounded-lg border px-3.5 py-1.5 text-[13px] font-medium transition', req.includes(h.k) ? 'border-brand bg-brand text-white' : 'border-line-strong bg-surface text-sub hover:text-ink')}>{h.label}</button>
          ))}
          <span className="mx-2 hidden h-6 w-px bg-line sm:block" />
          {PRESETS.map((p) => (
            <button key={p.label} onClick={() => { setReq(p.keys); setPage(1) }} className="rounded-lg bg-soft px-3 py-1.5 text-[12.5px] font-medium text-sub hover:text-ink">{p.label}</button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-6">
          <label className="text-xs text-sub">Min daily turnover (₹ Cr)
            <input type="number" min={0} step={0.5} value={minTurn} onChange={(e) => { setMinTurn(Number(e.target.value) || 0); setPage(1) }} className="num mt-1 block w-28" />
          </label>
          <label className="text-xs text-sub">Search
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Symbol or name" className="mt-1 block w-48" />
          </label>
          <p className="max-w-md text-xs text-mute">Turnover = 20-day average traded value. Below ~₹1 Cr/day it can be hard to exit; raise it for safety.</p>
        </div>
      </div>

      <div className="card mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <div>
          <div className="label">Price range</div>
          <div className="mt-0.5 text-xs text-mute">Select one or more</div>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Price range">
          {BUCKETS.map((b) => {
            const on = buckets.includes(b.k)
            return (
              <button
                key={b.k}
                role="checkbox"
                aria-checked={on}
                onClick={() => { setBuckets((p) => (p.includes(b.k) ? (p.length > 1 ? p.filter((x) => x !== b.k) : p) : [...p, b.k])); setPage(1) }}
                className={clsx('group flex items-center gap-2.5 rounded-lg border px-3.5 py-2 text-[13.5px] font-medium tracking-tight transition',
                  on ? 'border-brand bg-brand-soft text-brand shadow-sm' : 'border-line-strong bg-surface text-sub hover:border-mute hover:text-ink')}
              >
                <span className={clsx('grid size-[18px] place-items-center rounded-[5px] border transition', on ? 'border-brand bg-brand text-white' : 'border-line-strong bg-surface text-transparent group-hover:border-mute')}>
                  <Check className="size-3" strokeWidth={3} />
                </span>
                <span className="num">{b.label}</span>
                <span className={clsx('num rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold', on ? 'bg-brand text-white' : 'bg-soft text-mute')}>{counts[b.k]}</span>
              </button>
            )
          })}
        </div>
        <button onClick={() => { setBuckets(buckets.length === BUCKETS.length ? ['b1'] : BUCKETS.map((b) => b.k)); setPage(1) }} className="ml-auto text-[13px] font-medium text-brand hover:underline">
          {buckets.length === BUCKETS.length ? 'Reset to ₹50–100' : 'Select all'}
        </button>
      </div>

      <div className="card mt-4 overflow-x-auto">
        <table className="w-full min-w-[1100px] text-[13.5px]">
          <thead><tr className="border-b border-line">
            {head('symbol', 'Stock', false)}
            {head('ratingScore', 'Tomorrow rating', false)}
            {head('modelRank', 'Buy rank')}
            <th className="label px-3 py-2.5 text-left font-medium">Sector</th>
            {head('close', 'Price')}
            {head('chg1', '1D')}
            {HZ.map((h) => head(h.k, h.label))}
            {head('turnoverCr', 'Turnover')}
            {head('npos', 'Up in')}
          </tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={15} className="px-3 py-10 text-center text-mute">No stocks match. Untick a horizon or lower the turnover filter.</td></tr>}
            {pageRows.map((r: ScreenerRow & { npos: number; ratingScore: number }) => (
              <tr key={r.symbol} className="border-b border-line hover:bg-soft/70">
                <td className="px-3 py-2"><Link to={`/stock/${r.symbol}`} className="font-semibold hover:text-brand">{r.symbol}</Link></td>
                <td className="px-3 py-2">
                  {r.rating && (
                    <span className="inline-flex items-center gap-1.5" title={r.rating.eligible ? 'Meets every pick rule (price band, up 10 sessions, not vetoed).' : `Not eligible: ${r.rating.reasons.join('; ')}`}>
                      {r.rating.tomorrow === 'elite' && <Chip tone="gold">★ Elite</Chip>}
                      {r.rating.tomorrow === 'core' && <Chip tone="green">Top pick</Chip>}
                      {r.rating.tomorrow === 'theme' && <Chip tone="blue">Priority pick</Chip>}
                      {!r.rating.tomorrow && (r.rating.eligible ? <Chip tone="brand">Eligible</Chip> : <Chip>Not eligible</Chip>)}
                      {r.rating.grade !== '-' && (
                        <span className={clsx('num grid size-6 place-items-center rounded-md text-xs font-bold', r.rating.grade === 'A' ? 'bg-pos-bg text-pos' : r.rating.grade === 'B' ? 'bg-blue-bg text-blue' : r.rating.grade === 'C' ? 'bg-amber-bg text-amber' : 'bg-soft text-mute')}>{r.rating.grade}</span>
                      )}
                    </span>
                  )}
                </td>
                <td className="num px-3 py-2 text-right">
                  {r.modelRank != null ? (
                    <span title={`Model score ${((r.modelScore ?? 0) * 100).toFixed(1)} · rank ${r.modelRank} of ${data.rankOf} liquid stocks`}>
                      <b className={clsx('font-semibold', r.modelRank <= 20 ? 'text-pos' : r.modelRank <= 100 ? 'text-ink' : 'text-sub')}>#{r.modelRank}</b>
 {r.vetoReason && <span className="ml-1 cursor-help rounded bg-neg-bg px-1 text-[10px] font-semibold text-neg" title={`Vetoed: ${r.vetoReason}`}>!</span>}
                    </span>
                  ) : <span className="text-mute" title="Not in the model's liquid universe (turnover below ₹5 Cr/day)">-</span>}
                </td>
                <td className="px-3 py-2 text-sub">{r.sector === 'Defence' || r.sector === 'Engineering' ? <Chip tone={r.sector === 'Defence' ? 'gold' : 'blue'}>{r.sector}</Chip> : r.sector}</td>
                <td className="num px-3 py-2 text-right">₹{inr(r.close)}</td>
                {cell(r.chg1)}
                {HZ.map((h) => <td key={h.k} className={clsx('num px-3 py-2 text-right', tone(r[h.k]), req.includes(h.k) && 'bg-pos-bg/40')}>{r[h.k] == null ? '-' : pctRaw(r[h.k] as number, 1)}</td>)}
                <td className="num px-3 py-2 text-right text-sub">₹{r.turnoverCr} Cr</td>
                <td className="num px-3 py-2 text-right font-medium">{r.npos}/7</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] text-sub">
            <div className="flex items-center gap-3">
              <span>Showing <b className="num text-ink">{from}–{Math.min(cur * pageSize, shown.length)}</b> of <b className="num text-ink">{shown.length}</b></span>
              <label className="flex items-center gap-1.5 text-xs">Rows
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }} className="!py-1">
                  {[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-1">
              <button disabled={cur === 1} onClick={() => setPage(cur - 1)} className="grid size-8 place-items-center rounded-md border border-line-strong hover:bg-soft disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="size-4" /></button>
              {pageNums.map((n, i) => (
                <span key={n} className="flex items-center gap-1">
                  {i > 0 && n - pageNums[i - 1] > 1 && <span className="px-1 text-mute">…</span>}
                  <button onClick={() => setPage(n)} className={clsx('num size-8 rounded-md text-[13px] font-medium', n === cur ? 'bg-brand text-white' : 'border border-line-strong hover:bg-soft')}>{n}</button>
                </span>
              ))}
              <button disabled={cur === pages} onClick={() => setPage(cur + 1)} className="grid size-8 place-items-center rounded-md border border-line-strong hover:bg-soft disabled:opacity-40" aria-label="Next page"><ChevronRight className="size-4" /></button>
            </div>
          </div>
        )}
      </div>

      <div className="card mt-5 border-amber/30 p-4 text-[13px] leading-relaxed text-sub">
        <b className="text-ink">Tomorrow rating</b>: grade A/B/C/D = the model's rank percentile (A = top 5%, B = top 15%, C = top 40%); a tag (Elite / Top pick / Priority pick) means it is on tomorrow's published list; "Not eligible" means it fails a pick rule (price band, up over 10 sessions, or vetoed) — hover for the reason. <b className="text-ink">Buy rank</b> is the model's position (1 = best) among ~1,000 liquid stocks as of {data.rankAsOf ?? 'the last run'}; it is the same ranking behind the Tomorrow and Elite picks. <b className="text-ink">Use the rest as a shortlist filter, not a prediction.</b> In our backtest, stocks positive over 5D–6M did only slightly better over the next 10 days than the average stock
        (about +0.6% vs +0.4%, coin-flip hit rate). Lower-priced stocks (₹50–150) swing more — bigger gains and bigger losses — and are more prone to circuits, so check the stock page for its lower-circuit history,
        fundamentals and news before acting. Weekly picks in <b className="text-ink">Tomorrow</b> and <b className="text-ink">Elite 3</b> add the model score, stop-loss and targets.
      </div>
    </>
  )
}
