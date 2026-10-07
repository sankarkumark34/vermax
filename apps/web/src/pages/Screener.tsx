import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Disclaimer, PageHead, RunSelectionButton, ScoreBar, VerdictBadge } from '../components/selection'
import { ErrorBox, Loading } from '../components/ui'
import { cr, inr } from '../lib/format'
import { sel, type Verdict } from '../lib/selection'

type SortKey = 'score' | 'symbol' | 'tradedValue' | 'marketCap' | 'coverage'

const VERDICTS: Verdict[] = ['BUY', 'WAIT', 'AVOID']

export default function Screener() {
  const [verdicts, setVerdicts] = useState<Verdict[]>(['BUY', 'WAIT'])
  const [minScore, setMinScore] = useState('')
  const [sector, setSector] = useState('')
  const [minTv, setMinTv] = useState('')
  const [query, setQuery] = useState('')
  const [ready, setReady] = useState(false)
  const [sort, setSort] = useState<SortKey>('score')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)

  const params = { verdict: verdicts.join(','), minScore, sector, minTradedValue: minTv, query, technicalReady: ready, sort, order, page, pageSize: 50 }
  const q = useQuery({ queryKey: ['screener', params], queryFn: () => sel.screener(params), placeholderData: (p) => p })
  const d = q.data

  const toggle = (v: Verdict) => { setPage(1); setVerdicts((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v])) }
  const sortBy = (k: SortKey) => { setPage(1); if (k === sort) setOrder(order === 'asc' ? 'desc' : 'asc'); else { setSort(k); setOrder(k === 'symbol' ? 'asc' : 'desc') } }
  const Th = ({ k, children, className }: { k?: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={clsx('px-3 py-2.5 text-left text-[11.5px] uppercase tracking-wide text-mute', className)}>
      {k ? (
        <button onClick={() => sortBy(k)} className="inline-flex items-center gap-1 hover:text-ink">
          {children}
          {sort === k && (order === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
        </button>
      ) : children}
    </th>
  )

  return (
    <>
      <PageHead
        label="Stock selection"
        title="Screener"
        sub="Every liquid NSE stock run through the 18-step framework: gates first (liquidity, pledge, solvency, surveillance, red flags), then a 100-point quality score, then valuation and the technical entry. BUY needs all three."
        right={<RunSelectionButton />}
      />

      <div className="card flex flex-wrap items-end gap-4 p-4">
        <div>
          <div className="label mb-1.5">Verdict</div>
          <div className="flex gap-1.5">
            {VERDICTS.map((v) => (
              <button key={v} onClick={() => toggle(v)} className={clsx('rounded-lg border px-3 py-1.5 text-[12.5px] font-medium', verdicts.includes(v) ? 'border-brand bg-brand-soft text-brand' : 'border-line text-sub hover:bg-soft')}>
                {v} <span className="num text-mute">{d?.counts[v] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="text-[12.5px]"><div className="label mb-1.5">Min score</div><input value={minScore} onChange={(e) => { setMinScore(e.target.value); setPage(1) }} type="number" placeholder="e.g. 70" className="w-24" /></label>
        <label className="text-[12.5px]">
          <div className="label mb-1.5">Sector</div>
          <select value={sector} onChange={(e) => { setSector(e.target.value); setPage(1) }} className="max-w-56">
            <option value="">All sectors</option>
            {d?.sectors.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-[12.5px]"><div className="label mb-1.5">Min traded value (₹ Cr/day)</div><input value={minTv} onChange={(e) => { setMinTv(e.target.value); setPage(1) }} type="number" placeholder="e.g. 10" className="w-28" /></label>
        <label className="text-[12.5px]"><div className="label mb-1.5">Search</div><input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} placeholder="Symbol or name" className="w-44" /></label>
        <label className="flex items-center gap-2 pb-2 text-[13px] text-sub"><input type="checkbox" checked={ready} onChange={(e) => { setReady(e.target.checked); setPage(1) }} /> Entry trigger ready</label>
      </div>

      {q.isLoading && <div className="mt-4"><Loading what="screener" /></div>}
      {q.error && <div className="mt-4"><ErrorBox error={q.error} /></div>}
      {d && d.total === 0 && !Object.keys(d.counts).length && (
        <div className="card mt-4 p-8 text-center text-sm text-sub">No analysis stored yet. Press <b>Run analysis</b> to evaluate the liquid universe (the first run fetches company data and takes about an hour), or open any stock from the search box.</div>
      )}
      {d && (d.total > 0 || Object.keys(d.counts).length > 0) && (
        <div className="card mt-4 overflow-x-auto">
          <table className="w-full min-w-[960px] text-[13.5px]">
            <thead className="border-b border-line">
              <tr>
                <Th k="symbol">Stock</Th><Th>Verdict</Th><Th k="score" className="w-44">Score</Th><Th k="coverage">Data</Th><Th>Sector</Th>
                <Th className="text-right">Close</Th><Th k="tradedValue">Traded / day</Th><Th k="marketCap">M-cap</Th><Th>Why</Th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id} className="border-b border-line/70 last:border-0 hover:bg-soft">
                  <td className="px-3 py-2.5">
                    <Link to={`/verdict/${r.symbol}`} className="font-semibold text-ink hover:text-brand">{r.symbol}</Link>
                    <div className="max-w-48 truncate text-[11.5px] text-mute">{r.name}</div>
                  </td>
                  <td className="px-3 py-2.5"><VerdictBadge v={r.verdict} />{r.technicalReady && <div className="mt-1 text-[11px] text-pos">entry ready</div>}</td>
                  <td className="px-3 py-2.5"><div className="num mb-1 font-semibold">{r.totalScore}</div><ScoreBar score={r.totalScore} /></td>
                  <td className="num px-3 py-2.5 text-sub" title="Share of the framework that could be evaluated with available data">{Math.round(r.coverage * 100)}%</td>
                  <td className="px-3 py-2.5 text-sub">{r.sector ?? '-'}</td>
                  <td className="num px-3 py-2.5 text-right">₹{inr(r.close)}</td>
                  <td className="num px-3 py-2.5">{cr(r.adtvCr)}</td>
                  <td className="num px-3 py-2.5">{cr(r.marketCapCr)}</td>
                  <td className="max-w-80 px-3 py-2.5 text-[12.5px] text-sub">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-line px-3 py-2.5 text-[12.5px] text-sub">
            <span className="num">{d.total} stocks · as of {d.rows[0]?.asOfDate ?? '-'}</span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded p-1 hover:bg-soft disabled:opacity-30"><ChevronLeft className="size-4" /></button>
              <span className="num">page {page} of {Math.max(1, Math.ceil(d.total / d.pageSize))}</span>
              <button disabled={page * d.pageSize >= d.total} onClick={() => setPage(page + 1)} className="rounded p-1 hover:bg-soft disabled:opacity-30"><ChevronRight className="size-4" /></button>
            </div>
          </div>
        </div>
      )}
      <Disclaimer />
    </>
  )
}
