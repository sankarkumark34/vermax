import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { Journey } from '../components/IpoJourney'
import { Section, Stat } from '../components/ui'
import { inr, pctRaw, tone } from '../lib/format'

type Basis = 'vsIssue' | 'vsListing'
interface Agg {
  n: number; pctListedBelow?: number; pctEverBelow?: number; pctBelowNow?: number; pctStillBelowSinceListing?: number
  medianSessionsToRecover?: number | null; medianDaysToRecover?: number | null; recoveredWithin30d?: number | null; recoveredWithin90d?: number | null
  recoveredWithin365d?: number | null; medianPctSessionsBelow?: number; medianDeepest?: number; medianCurrent?: number
}
interface Row {
  symbol: string; name: string; listingDate: string; year: number; issuePrice: number | null; listOpen: number; close: number; listingGain: number | null
  subscription: { qib: number | null; nii: number | null; retail: number | null; total: number | null } | null; qibBucket: string; totalBucket: string
  vsIssue: Journey | null; vsListing: Journey
}
interface Study {
  asOf: string | null; count?: number; building?: boolean; qibBuckets?: string[]; totalBuckets?: string[]
  groups?: Record<Basis, { overall: Agg; byQib: Record<string, Agg>; byTotal: Record<string, Agg>; byYear: Record<string, Agg> }>; rows: Row[]
}

const STATUS_LABEL: Record<Journey['status'], string> = {
  never_below: 'Never in loss', recovered: 'Recovered', below_now: 'In loss again', below_since_listing: 'In loss since listing',
}
const STATUS_CLS: Record<Journey['status'], string> = {
  never_below: 'bg-pos-bg text-pos', recovered: 'bg-blue-bg text-blue', below_now: 'bg-amber-bg text-amber', below_since_listing: 'bg-neg-bg text-neg',
}

function AggTable({ title, keys, data, sub }: { title: string; keys: string[]; data: Record<string, Agg>; sub?: string }) {
  const cell = (v: number | null | undefined, suffix = '%') => (v == null ? '-' : `${v}${suffix}`)
  return (
    <Section title={title} sub={sub}>
      <div className="card overflow-x-auto">
        <table className="num w-full min-w-[900px] text-[13px]">
          <thead><tr className="border-b border-line text-left">
            {['Group', 'IPOs', 'Listed in loss', 'Ever in loss', 'In loss today', 'Never recovered', 'Median days to recover', 'Recovered ≤ 90 days', 'Median now'].map((h) => <th key={h} className="label px-3 py-2.5 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {keys.filter((k) => data[k]?.n).map((k) => {
              const a = data[k]
              return (
                <tr key={k} className="border-b border-line">
                  <td className="px-3 py-2 font-medium text-ink">{k}</td>
                  <td className="px-3 py-2">{a.n}</td>
                  <td className="px-3 py-2">{cell(a.pctListedBelow)}</td>
                  <td className="px-3 py-2">{cell(a.pctEverBelow)}</td>
                  <td className={clsx('px-3 py-2', (a.pctBelowNow ?? 0) >= 50 ? 'text-neg' : 'text-ink')}>{cell(a.pctBelowNow)}</td>
                  <td className="px-3 py-2">{cell(a.pctStillBelowSinceListing)}</td>
                  <td className="px-3 py-2">{cell(a.medianDaysToRecover, ' d')}</td>
                  <td className="px-3 py-2">{cell(a.recoveredWithin90d)}</td>
                  <td className={clsx('px-3 py-2', tone(a.medianCurrent))}>{a.medianCurrent == null ? '-' : pctRaw(a.medianCurrent, 1)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

type SortKey = 'listingDate' | 'symbol' | 'qib' | 'total' | 'listingGain' | 'pctBelow' | 'streak' | 'recover' | 'current'

export default function IpoStudy() {
  const q = useQuery({ queryKey: ['ipo-study'], queryFn: async () => (await (await fetch('/api/ipos/study')).json()) as Study, refetchInterval: (qq) => (qq.state.data?.building && !qq.state.data?.asOf ? 20_000 : false) })
  const [basis, setBasis] = useState<Basis>('vsIssue')
  const [status, setStatus] = useState<'all' | Journey['status']>('all')
  const [bucket, setBucket] = useState('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'listingDate', dir: -1 })
  const [page, setPage] = useState(1)
  const size = 25

  const rows = useMemo(() => {
    const val = (r: Row, k: SortKey): number | string | null => {
      const j = r[basis]
      switch (k) {
        case 'listingDate': return r.listingDate
        case 'symbol': return r.symbol
        case 'qib': return r.subscription?.qib ?? null
        case 'total': return r.subscription?.total ?? null
        case 'listingGain': return r.listingGain
        case 'pctBelow': return j?.pctSessionsBelow ?? null
        case 'streak': return j?.longestLossStreak ?? null
        case 'recover': return j?.daysToRecover ?? null
        case 'current': return j?.current ?? null
      }
    }
    return (q.data?.rows ?? [])
      .filter((r) => r[basis] && (status === 'all' || r[basis]!.status === status) && (bucket === 'all' || r.qibBucket === bucket)
        && (!search || r.symbol.includes(search.toUpperCase()) || r.name.toLowerCase().includes(search.toLowerCase())))
      .sort((a, b) => {
        const av = val(a, sort.k), bv = val(b, sort.k)
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        return (typeof av === 'string' ? av.localeCompare(bv as string) : av - (bv as number)) * sort.dir
      })
  }, [q.data, basis, status, bucket, search, sort])

  if (q.isLoading) return <div className="card p-8 text-center text-sm text-mute">Loading IPO study…</div>
  const d = q.data
  if (!d?.asOf || !d.groups) return <div className="card p-8 text-center text-sm text-sub">Building the IPO study for the first time (every IPO since 2019 and its subscription data). This takes a few minutes; the page refreshes automatically.</div>
  const g = d.groups[basis]
  const o = g.overall
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const cur = Math.min(page, pages)
  const head = (k: SortKey, label: string) => (
    <th key={k} className={clsx('label cursor-pointer select-none px-3 py-2.5 font-medium hover:text-ink', sort.k === k && '!text-brand')}
      onClick={() => { setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : -1 })); setPage(1) }}>
      <span className="inline-flex items-center gap-1">{label}{sort.k === k ? (sort.dir === 1 ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />) : <ChevronsUpDown className="size-3 opacity-40" />}</span>
    </th>
  )
  const btn = (on: boolean) => clsx('rounded-md px-3 py-1 text-[13px] font-medium', on ? 'bg-surface text-brand shadow-sm' : 'text-sub hover:text-ink')

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label">IPO study</div>
          <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight">How IPOs behave after listing</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-sub">
            Every main-board IPO listed since 2019 ({d.count} with full price history): how often it fell into loss, how long it stayed there, when it recovered — and whether heavy
            subscription made a difference. Official NSE closes to {d.asOf}, split/bonus adjusted.
          </p>
        </div>
        <div>
          <div className="label mb-1.5">Loss measured against</div>
          <div className="flex gap-1 rounded-lg bg-soft p-1">
            <button onClick={() => setBasis('vsIssue')} className={btn(basis === 'vsIssue')}>Issue price</button>
            <button onClick={() => setBasis('vsListing')} className={btn(basis === 'vsListing')}>Listing-day price</button>
          </div>
        </div>
      </div>

      <div className="card mt-5 grid grid-cols-2 gap-6 p-5 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="IPOs studied" value={o.n} />
        <Stat label="Listed in loss" value={`${o.pctListedBelow ?? '-'}%`} sub="day-1 close below" />
        <Stat label="Ever in loss" value={`${o.pctEverBelow ?? '-'}%`} sub="at least one close below" />
        <Stat label="In loss today" value={`${o.pctBelowNow ?? '-'}%`} tone={(o.pctBelowNow ?? 0) >= 50 ? 'text-neg' : undefined} />
        <Stat label="Never recovered" value={`${o.pctStillBelowSinceListing ?? '-'}%`} sub="below since day 1" tone="text-neg" />
        <Stat label="Median recovery" value={o.medianDaysToRecover != null ? `${o.medianDaysToRecover} d` : '-'} sub="for those listed in loss" />
        <Stat label="Recovered ≤ 90 days" value={`${o.recoveredWithin90d ?? '-'}%`} sub="of those listed in loss" />
      </div>

      <AggTable title="By institutional (QIB) subscription" sub="Does heavy institutional demand protect IPO investors?" keys={[...(d.qibBuckets ?? []), 'unknown']} data={g.byQib} />
      <AggTable title="By total subscription" keys={[...(d.totalBuckets ?? []), 'unknown']} data={g.byTotal} />
      <AggTable title="By listing year" keys={Object.keys(g.byYear).sort().reverse()} data={g.byYear} />

      <Section title="Every IPO">
        <div className="card mb-3 flex flex-wrap items-end gap-x-6 gap-y-3 p-4">
          <div><div className="label mb-1.5">Status</div><div className="flex flex-wrap gap-1 rounded-lg bg-soft p-1">
            {(['all', 'never_below', 'recovered', 'below_now', 'below_since_listing'] as const).map((s) => <button key={s} onClick={() => { setStatus(s); setPage(1) }} className={btn(status === s)}>{s === 'all' ? 'All' : STATUS_LABEL[s]}</button>)}
          </div></div>
          <label className="text-xs text-sub">QIB subscription
            <select value={bucket} onChange={(e) => { setBucket(e.target.value); setPage(1) }} className="mt-1 block">{['all', ...(d.qibBuckets ?? []), 'unknown'].map((b) => <option key={b} value={b}>{b === 'all' ? 'All' : b}</option>)}</select>
          </label>
          <label className="text-xs text-sub">Search
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Symbol or name" className="mt-1 block w-48" />
          </label>
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[1200px] text-[13px]">
            <thead><tr className="border-b border-line text-left">
              {head('symbol', 'IPO')}{head('listingDate', 'Listed')}
              <th className="label px-3 py-2.5 font-medium">Issue</th>
              {head('qib', 'QIB ×')}{head('total', 'Total ×')}{head('listingGain', 'Listing gain')}
              <th className="label px-3 py-2.5 font-medium">Status</th>
              {head('pctBelow', 'Sessions in loss')}{head('streak', 'Longest loss streak')}{head('recover', 'First recovery')}{head('current', 'Now vs ref')}
            </tr></thead>
            <tbody>
              {rows.slice((cur - 1) * size, cur * size).map((r) => {
                const j = r[basis]!
                return (
                  <tr key={r.symbol} className="num border-b border-line hover:bg-soft/70">
                    <td className="px-3 py-2"><Link to={`/analyse/${r.symbol}`} className="font-semibold text-ink hover:text-brand">{r.symbol}</Link><div className="max-w-[220px] truncate text-xs text-mute">{r.name}</div></td>
                    <td className="px-3 py-2 text-sub">{r.listingDate}</td>
                    <td className="px-3 py-2 text-sub">{r.issuePrice ? `₹${inr(r.issuePrice)}` : '-'}</td>
                    <td className="px-3 py-2">{r.subscription?.qib != null ? `${r.subscription.qib.toFixed(1)}×` : '-'}</td>
                    <td className="px-3 py-2">{r.subscription?.total != null ? `${r.subscription.total.toFixed(1)}×` : '-'}</td>
                    <td className={clsx('px-3 py-2', tone(r.listingGain))}>{pctRaw(r.listingGain, 1)}</td>
                    <td className="px-3 py-2"><span className={clsx('rounded-md px-2 py-0.5 text-xs font-semibold', STATUS_CLS[j.status])}>{STATUS_LABEL[j.status]}</span></td>
                    <td className="px-3 py-2">{j.sessionsBelow}/{j.sessions} <span className="text-mute">({j.pctSessionsBelow}%)</span></td>
                    <td className="px-3 py-2">{j.longestLossStreak ? `${j.longestLossStreak} sessions` : '-'}</td>
                    <td className="px-3 py-2">{j.listedBelow ? (j.firstRecoveryOn ? `${j.firstRecoveryOn} (${j.daysToRecover} d)` : <span className="text-neg">not yet</span>) : <span className="text-mute">listed above</span>}</td>
                    <td className={clsx('px-3 py-2 font-medium', tone(j.current))}>{pctRaw(j.current, 1)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[13px] text-sub">
            <span>Showing <b className="num text-ink">{rows.length ? (cur - 1) * size + 1 : 0}–{Math.min(cur * size, rows.length)}</b> of <b className="num text-ink">{rows.length}</b></span>
            <div className="flex items-center gap-2">
              <button disabled={cur === 1} onClick={() => setPage(cur - 1)} className="grid size-8 place-items-center rounded-md border border-line-strong hover:bg-soft disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="size-4" /></button>
              <span className="num">{cur} / {pages}</span>
              <button disabled={cur === pages} onClick={() => setPage(cur + 1)} className="grid size-8 place-items-center rounded-md border border-line-strong hover:bg-soft disabled:opacity-40" aria-label="Next page"><ChevronRight className="size-4" /></button>
            </div>
          </div>
        </div>
      </Section>

      <p className="mt-6 max-w-4xl text-xs leading-relaxed text-mute">
        "In loss" = a session whose close is below the reference price (issue price or the first traded price on listing day). Recovery = first close back above it. Subscription figures
        are NSE's final category-wise numbers. IPOs listed before 2019 are not included because our price history starts in 2019. Past patterns describe what happened; they do not predict
        any single IPO.
      </p>
    </>
  )
}
