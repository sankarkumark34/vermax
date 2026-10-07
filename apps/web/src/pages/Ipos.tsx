import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ErrorBox, Loading } from '../components/ui'
import { api } from '../lib/api'
import { inr, pctRaw, tone } from '../lib/format'
import { refsFor, retVs, useLiveQuotes } from '../lib/live'
import type { IpoRow } from '../lib/types'

const HZ = [
  { k: 'd5', label: '1W' }, { k: 'd10', label: '2W' }, { k: 'w3', label: '3W' }, { k: 'w4', label: '4W' },
  { k: 'm1', label: '1M' }, { k: 'q1', label: '3M' }, { k: 'h1', label: '6M' }, { k: 'y1', label: '1Y' },
] as const
type HK = (typeof HZ)[number]['k']
const WINDOWS = [6, 12, 24, 36]   // stocks need >= 3 months of trading to be listed at all
type SortKey = 'listingDate' | 'symbol' | 'close' | 'vsIssue' | 'listingGain' | 'sinceListing' | 'fromHigh' | 'turnoverCr' | 'npos' | HK

export default function Ipos() {
  const q = useQuery({ queryKey: ['ipos'], queryFn: api.ipos, staleTime: 5 * 60_000 })
  const [months, setMonths] = useState(12)
  const [maxPrice, setMaxPrice] = useState(600)
  const [minTurn, setMinTurn] = useState(1)
  const [allPositive, setAllPositive] = useState(true)
  const [aboveListing, setAboveListing] = useState(false)
  const [live, setLive] = useState(false)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'listingDate', dir: -1 })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const rows = useMemo(() => (q.data?.rows ?? []).map((r) => {
    const avail = HZ.filter((h) => r[h.k] != null)
    return { ...r, avail: avail.length, npos: avail.filter((h) => (r[h.k] as number) > 0).length }
  }), [q.data])

  const shown = useMemo(() => {
    const asOf = q.data ? new Date(`${q.data.asOf}T00:00:00Z`) : new Date()
    const cut = new Date(asOf); cut.setUTCMonth(cut.getUTCMonth() - months)
    const cutS = cut.toISOString().slice(0, 10)
    const list = rows.filter((r) => r.listingDate >= cutS && r.turnoverCr >= minTurn && (!maxPrice || r.close <= maxPrice)
      && (!allPositive || (r.avail > 0 && r.npos === r.avail))
      && (!aboveListing || (r.sinceListing ?? -1) > 0)
      && (!search || r.symbol.includes(search.toUpperCase()) || (r.name ?? '').toLowerCase().includes(search.toLowerCase())))
    return [...list].sort((a, c) => {
      const av = (a as unknown as Record<string, number | string | null>)[sort.k]
      const cv = (c as unknown as Record<string, number | string | null>)[sort.k]
      if (av == null && cv == null) return 0
      if (av == null) return 1
      if (cv == null) return -1
      if (typeof av === 'string' && typeof cv === 'string') return av.localeCompare(cv) * sort.dir
      return ((av as number) - (cv as number)) * sort.dir
    })
  }, [rows, months, minTurn, maxPrice, allPositive, aboveListing, search, sort, q.data])
  const pages = Math.max(1, Math.ceil(shown.length / pageSize))
  const cur = Math.min(page, pages)
  const pageRows = shown.slice((cur - 1) * pageSize, cur * pageSize)
  const lq = useLiveQuotes(pageRows.map((r) => r.symbol), live)

  if (q.isLoading) return <Loading what="recent IPOs (first load takes ~1 min)" />
  if (q.error) return <ErrorBox error={q.error} />
  const data = q.data!
  const reset = () => setPage(1)
  const view = (r: IpoRow) => {
    const lv = live ? lq.data?.[r.symbol] : null
    if (!lv) return { price: r.close, chg1: r.chg1, vsIssue: r.vsIssue ?? null, since: r.sinceListing, ret: (k: HK) => r[k] as number | null, live: false }
    return { price: lv.price, chg1: retVs(lv.price, lv.prevClose ?? r.prevClose), vsIssue: retVs(lv.price, r.issuePrice), since: retVs(lv.price, r.listOpen), ret: (k: HK) => retVs(lv.price, refsFor(r, lv.time, data.asOf)?.[k] ?? null), live: true }
  }
  const head = (k: SortKey, label: string, right = true) => {
    const active = sort.k === k
    return (
      <th key={k} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
        className={clsx('label cursor-pointer select-none px-3 py-2.5 font-medium transition hover:text-ink', right && 'text-right', active && '!text-brand')}
        onClick={() => { setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : k === 'symbol' ? 1 : -1 })); reset() }}>
        <span className="inline-flex items-center gap-1">{label}{active ? (sort.dir === 1 ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />) : <ChevronsUpDown className="size-3 opacity-40" />}</span>
      </th>
    )
  }
  const pct = (v: number | null) => <span className={tone(v)}>{v == null ? 'n/a' : pctRaw(v, 1)}</span>
  const from = shown.length ? (cur - 1) * pageSize + 1 : 0
  const pageNums = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - cur) <= 1)

  return (
    <>
      <div>
        <div className="label">IPO screener</div>
        <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight">Recently listed stocks</h1>
        <p className="mt-1 max-w-3xl text-[13px] text-sub">
          Main-board IPOs from NSE's past-issues list (issue price and listing date; SME issues and direct listings excluded). Returns use the official NSE close of {data.asOf}; a period shows
          n/a until the stock has been listed that long. "Positive in every period" checks only the periods available since listing.
          Only stocks with at least <b>{data.minMonths ?? 3} months</b> of NSE trading are listed{data.excludedYoung ? ` (${data.excludedYoung} newer listings hidden)` : ''}.
        </p>
      </div>

      <div className="card mt-5 flex flex-wrap items-end gap-x-6 gap-y-4 p-5">
        <div>
          <div className="label mb-1.5">Listed within</div>
          <div className="flex gap-1 rounded-lg bg-soft p-1">
            {WINDOWS.map((m) => (
              <button key={m} onClick={() => { setMonths(m); reset() }} className={clsx('rounded-md px-3 py-1 text-[13px] font-medium', months === m ? 'bg-surface text-brand shadow-sm' : 'text-sub hover:text-ink')}>{m < 12 ? `${m}M` : `${m / 12}Y`}</button>
            ))}
          </div>
        </div>
        <label className="text-xs text-sub">Max price (₹)
          <input type="number" min={0} step={50} value={maxPrice || ''} placeholder="no limit" onChange={(e) => { setMaxPrice(Number(e.target.value) || 0); reset() }} className="num mt-1 block w-28" />
        </label>
        <label className="text-xs text-sub">Min turnover (₹ Cr/day)
          <input type="number" min={0} step={0.5} value={minTurn} onChange={(e) => { setMinTurn(Number(e.target.value) || 0); reset() }} className="num mt-1 block w-28" />
        </label>
        <label className="text-xs text-sub">Search
          <input value={search} onChange={(e) => { setSearch(e.target.value); reset() }} placeholder="Symbol or name" className="mt-1 block w-44" />
        </label>
        <div className="flex flex-wrap gap-2">
          {([['Positive in every period', allPositive, setAllPositive], ['Above listing price', aboveListing, setAboveListing], ['Live prices', live, setLive]] as const).map(([label, v, set]) => (
            <label key={label} className={clsx('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium', v ? 'border-brand bg-brand-soft text-brand' : 'border-line-strong text-sub')}>
              <input type="checkbox" checked={v} onChange={(e) => { set(e.target.checked); reset() }} className="size-4 accent-[#16345c]" />{label}
            </label>
          ))}
        </div>
      </div>

      <div className="card mt-4 overflow-x-auto">
        <table className="w-full min-w-[1500px] text-[13.5px]">
          <thead><tr className="border-b border-line">
            {head('symbol', 'Stock', false)}
            {head('listingDate', 'Listed', false)}
            <th className="label px-3 py-2.5 text-right font-medium">Issue price</th>
            {head('listingGain', 'Listing gain')}
            <th className="label px-3 py-2.5 text-right font-medium">Listing price</th>
            {head('close', 'Price')}
            {head('vsIssue', 'vs Issue')}
            {head('sinceListing', 'Since listing')}
            <th className="label px-3 py-2.5 text-right font-medium">1D</th>
            {HZ.map((h) => head(h.k, h.label))}
            {head('fromHigh', 'From high')}
            {head('turnoverCr', 'Turnover')}
            {head('npos', 'Up in')}
          </tr></thead>
          <tbody>
            {pageRows.length === 0 && <tr><td colSpan={20} className="px-3 py-10 text-center text-mute">No recent listings match. Widen "Listed within", raise max price, or untick a filter.</td></tr>}
            {pageRows.map((r) => {
              const v = view(r)
              return (
                <tr key={r.symbol} className="border-b border-line hover:bg-soft/70">
                  <td className="px-3 py-2"><Link to={`/stock/${r.symbol}`} className="font-semibold hover:text-brand">{r.symbol}</Link><div className="max-w-[200px] truncate text-xs text-mute">{r.name}</div></td>
                  <td className="num px-3 py-2"><div>{new Date(`${r.listingDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}</div><div className="text-xs text-mute">{r.sessions} sessions</div></td>
                  <td className="num px-3 py-2 text-right text-sub">{r.issuePrice ? `₹${inr(r.issuePrice)}` : '-'}</td>
                  <td className="num px-3 py-2 text-right">{pct(r.listingGain ?? null)}</td>
                  <td className="num px-3 py-2 text-right text-sub">₹{inr(r.listOpen)}</td>
                  <td className="num px-3 py-2 text-right font-medium">₹{inr(v.price)}{v.live && <span className="ml-1 rounded bg-blue-bg px-1 text-[9.5px] font-semibold text-blue">LIVE</span>}</td>
                  <td className="num px-3 py-2 text-right font-medium">{pct(v.vsIssue)}</td>
                  <td className="num px-3 py-2 text-right font-medium">{pct(v.since)}</td>
                  <td className="num px-3 py-2 text-right">{pct(v.chg1)}</td>
                  {HZ.map((h) => { const x = v.ret(h.k); return <td key={h.k} className={clsx('num px-3 py-2 text-right', x == null ? 'text-mute' : tone(x))}>{x == null ? 'n/a' : pctRaw(x, 1)}</td> })}
                  <td className="num px-3 py-2 text-right">{pct(r.fromHigh)}</td>
                  <td className="num px-3 py-2 text-right text-sub">₹{r.turnoverCr} Cr</td>
                  <td className="num px-3 py-2 text-right font-medium">{r.npos}/{r.avail}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {shown.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] text-sub">
            <div className="flex items-center gap-3">
              <span>Showing <b className="num text-ink">{from}–{Math.min(cur * pageSize, shown.length)}</b> of <b className="num text-ink">{shown.length}</b></span>
              <label className="flex items-center gap-1.5 text-xs">Rows
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); reset() }} className="!py-1">{[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select>
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
        <b className="text-ink">Read with care.</b> "Issue price" is the IPO price from NSE; "listing price" is the first traded price on listing day. New listings swing hard and have
        short histories, so "positive in every period" may rest on only one or two periods — check the "Up in" column. Live prices are delayed and only recompute the visible rows; filters use the official NSE close.
      </div>
    </>
  )
}
