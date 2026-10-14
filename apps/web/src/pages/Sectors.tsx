import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, Loader2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Disclaimer, PageHead, VerdictBadge } from '../components/selection'
import { SortHead, useSort, type SortCol } from '../components/sortable'
import { ErrorBox, Loading } from '../components/ui'
import { dateLabel, inr, pct, tone } from '../lib/format'
import { fetchSectors, runSectors, type Checks, type LeaderRow, type SectorStats, type StockRow } from '../lib/sectors'
import { buyPlan } from './TopPicks'

const SHOW = [{ k: 'qualified', label: 'Qualified only' }, { k: 'all', label: 'All analysed' }] as const
const FUND = [{ k: 0, label: 'Any' }, { k: 60, label: '60+' }, { k: 75, label: '75+' }] as const
const CHECKS: { k: keyof Checks; label: string; hint: string }[] = [
  { k: 'fundamentals', label: 'F', hint: 'Fundamentals: no red-flag gate and 18-step score at or above the WAIT level' },
  { k: 'growth', label: 'G', hint: 'Business growth: sales CAGR and profit CAGR both positive' },
  { k: 'momentum', label: 'M', hint: 'Price growth: 3-month and 6-month returns both positive' },
  { k: 'trend', label: 'T', hint: 'Trend: price above its 50-day and 200-day EMA' },
  { k: 'entry', label: 'E', hint: 'Entry ready today (verdict BUY); not required to qualify' },
]
const LABEL_TONE = { Strong: 'bg-pos-bg text-pos', Neutral: 'bg-soft text-sub', Weak: 'bg-neg-bg text-neg' } as const

function Tick({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <span title={`${hint}: ${ok ? 'yes' : 'no'}`} className={clsx('grid size-[20px] shrink-0 place-items-center rounded-full text-[10px] font-bold', ok ? 'bg-pos-bg text-pos' : 'bg-neg-bg text-neg')}>
      {label}
    </span>
  )
}

function SectorCard({ s, active, onClick }: { s: SectorStats; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={clsx('card p-3.5 text-left transition hover:border-brand/50', active && 'border-brand ring-1 ring-brand')}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13.5px] font-semibold leading-tight text-ink">{s.sector}</div>
        <span className={clsx('shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium', LABEL_TONE[s.label])}>{s.label}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-soft"><div className={clsx('h-full rounded-full', s.label === 'Weak' ? 'bg-neg' : s.label === 'Strong' ? 'bg-pos' : 'bg-mute')} style={{ width: `${s.strength}%` }} /></div>
        <span className="num text-[12px] text-sub">{s.strength}</span>
      </div>
      <div className="num mt-2 grid grid-cols-3 gap-1 text-[11.5px]">
        {([['1W', s.med1w], ['1M', s.med1m], ['3M', s.med3m]] as const).map(([k, v]) => (
          <div key={k}><span className="text-mute">{k} </span><span className={tone(v)}>{pct(v, 1, true)}</span></div>
        ))}
      </div>
      <div className="mt-1.5 text-[11.5px] text-mute">
        {Math.round(s.breadth50 * 100)}% above 50-EMA · {s.stocks} stocks · <span className={s.qualified ? 'text-pos' : ''}>{s.qualified} qualified</span>{s.buy ? <span className="text-pos"> · {s.buy} BUY</span> : null}
      </div>
    </button>
  )
}

const VERDICT_RANK = { BUY: 3, WAIT: 2, AVOID: 1 } as const
type Ranked<T> = T & { n: number }
const numbered = <T,>(rows: T[]) => rows.map((r, i) => ({ ...r, n: i + 1 }))

const LEADER_COLS: SortCol<Ranked<LeaderRow>>[] = [
  { h: '#', get: (r) => r.n, title: 'Original rank (by score)' },
  { h: 'Stock', get: (r) => r.symbol },
  { h: 'Price', get: (r) => r.trend.close, right: true },
  { h: '1W', get: (r) => r.trend.chg1w, right: true },
  { h: '1M', get: (r) => r.screen.ret1m, right: true },
  { h: '3M', get: (r) => r.screen.ret3m, right: true },
  { h: '1Y', get: (r) => r.screen.ret1y, right: true },
  { h: 'Sales CAGR', get: (r) => r.growth.salesCagr, right: true },
  { h: 'Profit CAGR', get: (r) => r.growth.patCagr, right: true },
  { h: 'ROE', get: (r) => r.growth.roe, right: true },
  { h: 'Fund.', get: (r) => r.fundamentalScore, right: true },
  { h: 'Growth', get: (r) => r.growthScore, right: true },
  { h: 'Tech.', get: (r) => r.technicalScore, right: true },
  { h: 'Score', get: (r) => r.composite, right: true },
  { h: 'Checks', get: (r) => CHECKS.filter((c) => r.checks[c.k]).length, title: 'Sort by number of checks passed' },
  { h: 'Verdict', get: (r) => VERDICT_RANK[r.verdict as keyof typeof VERDICT_RANK] ?? 0, right: true },
  { h: 'Buy plan', get: (r) => { const bp = buyPlan(r); return bp?.price == null ? null : bp.now ? 0 : bp.distPct }, right: true, title: 'Sort by distance from the buy price (buy now = 0%)' },
]

const STOCK_COLS: SortCol<Ranked<StockRow>>[] = [
  { h: '#', get: (r) => r.n, title: 'Original rank (by price score)' },
  { h: 'Stock', get: (r) => r.symbol },
  { h: 'Price', get: (r) => r.close, right: true },
  { h: '1W', get: (r) => r.ret1w, right: true },
  { h: '1M', get: (r) => r.ret1m, right: true },
  { h: '3M', get: (r) => r.ret3m, right: true },
  { h: '6M', get: (r) => r.ret6m, right: true },
  { h: '1Y', get: (r) => r.ret1y, right: true },
  { h: 'Months up', get: (r) => (r.monthsUp.total ? r.monthsUp.up / r.monthsUp.total : null), right: true },
  { h: 'RSI', get: (r) => r.rsi, right: true },
  { h: 'vs 52W high', get: (r) => r.fromHigh52, right: true },
  { h: 'Trend', get: (r) => (r.above50 ? 1 : 0) + (r.above200 ? 1 : 0), right: true, title: 'Sort by trend (above 50 and 200 EMA first)' },
  { h: 'Price score', get: (r) => r.priceScore, right: true },
]

function LeaderTable({ rows }: { rows: LeaderRow[] }) {
  const data = useMemo(() => numbered(rows), [rows])
  const { sorted, sort, toggle } = useSort(data, LEADER_COLS)
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[1240px] text-[13px]">
        <SortHead cols={LEADER_COLS} sort={sort} toggle={toggle} />
        <tbody>
          {sorted.map((r) => {
            const bp = buyPlan(r)
            return (
              <tr key={r.symbol} className="border-b border-line/70 last:border-0 hover:bg-soft/60">
                <td className="num px-3 py-3 font-semibold text-mute">{r.n}</td>
                <td className="px-3 py-3">
                  <Link to={`/verdict/${r.symbol}`} className="font-semibold text-ink hover:text-brand">{r.symbol}</Link>
                  <div className="max-w-44 truncate text-[11.5px] text-mute" title={r.name ?? ''}>{r.name}</div>
                </td>
                <td className="num px-3 py-3 text-right">₹{inr(r.trend.close)}</td>
                {[r.trend.chg1w, r.screen.ret1m, r.screen.ret3m, r.screen.ret1y].map((v, k) => <td key={k} className={clsx('num px-3 py-3 text-right', tone(v))}>{pct(v, 1, true)}</td>)}
                {[r.growth.salesCagr, r.growth.patCagr, r.growth.roe].map((v, k) => <td key={k} className={clsx('num px-3 py-3 text-right', tone(v))}>{pct(v, 0, k < 2)}</td>)}
                <td className="num px-3 py-3 text-right">{r.fundamentalScore}</td>
                <td className="num px-3 py-3 text-right">{Math.round(r.growthScore)}</td>
                <td className="num px-3 py-3 text-right">{r.technicalScore}</td>
                <td className="num px-3 py-3 text-right font-semibold text-ink">{r.composite}</td>
                <td className="px-3 py-3"><div className="flex gap-0.5">{CHECKS.map((c) => <Tick key={c.k} ok={r.checks[c.k]} label={c.label} hint={c.hint} />)}</div></td>
                <td className="px-3 py-3 text-right"><VerdictBadge v={r.verdict} /></td>
                <td className="num px-3 py-3 text-right text-[12px]">
                  {bp && bp.price != null ? (
                    <>
                      <div className={clsx('font-semibold', bp.now ? 'text-pos' : 'text-amber')}>{bp.now ? 'Buy ₹' : 'At ₹'}{inr(bp.price)}</div>
                      <div><span className="text-neg">SL {inr(bp.stop)}</span> · <span className="text-pos">T {inr(bp.target)}</span></div>
                    </>
                  ) : <span className="text-mute">no clear level</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function StockTable({ rows }: { rows: StockRow[] }) {
  const data = useMemo(() => numbered(rows), [rows])
  const { sorted, sort, toggle } = useSort(data, STOCK_COLS)
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[900px] text-[13px]">
        <SortHead cols={STOCK_COLS} sort={sort} toggle={toggle} />
        <tbody>
          {sorted.map((r) => (
            <tr key={r.symbol} className="border-b border-line/70 last:border-0 hover:bg-soft/60">
              <td className="num px-3 py-2 text-mute">{r.n}</td>
              <td className="px-3 py-2">
                <Link to={`/verdict/${r.symbol}`} className="font-semibold text-ink hover:text-brand">{r.symbol}</Link>
                {r.analysed && <span className="ml-1.5 text-[10.5px] text-brand">analysed</span>}
                <div className="max-w-48 truncate text-[11.5px] text-mute" title={r.name ?? ''}>{r.name}</div>
              </td>
              <td className="num px-3 py-2 text-right">₹{inr(r.close)}</td>
              {[r.ret1w, r.ret1m, r.ret3m, r.ret6m, r.ret1y].map((v, k) => <td key={k} className={clsx('num px-3 py-2 text-right', tone(v))}>{pct(v, 1, true)}</td>)}
              <td className="num px-3 py-2 text-right">{r.monthsUp.up}/{r.monthsUp.total}</td>
              <td className="num px-3 py-2 text-right">{r.rsi ?? '–'}</td>
              <td className="num px-3 py-2 text-right text-sub">{r.fromHigh52}%</td>
              <td className="px-3 py-2 text-right">
                <span className={clsx('inline-flex items-center gap-0.5 text-[11.5px]', r.above50 && r.above200 !== false ? 'text-pos' : 'text-neg')}>
                  {r.above50 && r.above200 !== false ? <Check className="size-3" /> : <X className="size-3" />}{r.above50 ? '>50' : '<50'} · {r.above200 == null ? 'n/a' : r.above200 ? '>200' : '<200'}
                </span>
              </td>
              <td className="num px-3 py-2 text-right font-medium">{Math.round(r.priceScore)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Sectors() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['sectors'], queryFn: fetchSectors, staleTime: 30_000, refetchInterval: (x) => (x.state.data?.state.running || !x.state.data?.asOf ? 5000 : false) })
  const [sel, setSel] = useState<string | null>(null)
  const [show, setShow] = useState<(typeof SHOW)[number]['k']>('qualified')
  const [fund, setFund] = useState<number>(0)
  const [buyOnly, setBuyOnly] = useState(false)

  const leadersBy = useMemo(() => {
    const m = new Map<string, LeaderRow[]>()
    for (const r of q.data?.leaders ?? []) {
      if (show === 'qualified' && !r.qualified) continue
      if (r.fundamentalScore < fund || (buyOnly && r.verdict !== 'BUY')) continue
      m.set(r.sector!, [...(m.get(r.sector!) ?? []), r])
    }
    for (const v of m.values()) v.sort((a, b) => b.composite - a.composite)
    return m
  }, [q.data, show, fund, buyOnly])

  if (q.isLoading) return <Loading what="sector leaders" />
  if (q.error) return <ErrorBox error={q.error} />
  const d = q.data!
  const st = d.state
  if (!d.asOf) {
    return (
      <div className="card p-8 text-center text-sm text-sub">
        <Loader2 className="mx-auto mb-3 size-5 animate-spin" />
        Sorting every NSE stock into its sector and analysing the best of each sector for the first time (about 20–40 minutes; later runs are faster). {st.step}{st.total ? ` (${st.done}/${st.total})` : ''}. This page updates by itself.
        {st.error && <p className="mt-2 text-neg">{st.error}</p>}
      </div>
    )
  }
  const btn = (on: boolean) => clsx('rounded-md px-3 py-1 text-[13px] font-medium', on ? 'bg-surface text-brand shadow-sm' : 'text-sub hover:text-ink')
  const group = (label: string, children: React.ReactNode) => <div><div className="label mb-1.5">{label}</div><div className="flex gap-1 rounded-lg bg-soft p-1">{children}</div></div>
  const selStats = d.sectors.find((s) => s.sector === sel)
  const shown = sel ? d.sectors.filter((s) => s.sector === sel) : d.sectors

  return (
    <>
      <PageHead
        label="Sector leaders"
        title="Every NSE sector, and its best stocks on fundamentals, growth and technicals"
        sub={`Every liquid NSE stock (₹${d.params?.minAdtvCr} Cr+ a day, price ₹${d.params?.minPrice}+) is placed in its NSE sector and scored on price growth and trend. The top ${d.params?.perSector} of each sector get the full 18-step fundamental + technical analysis. Sectors are ranked by strength against each other. Official NSE close of ${dateLabel(d.asOf)}.`}
        right={<button onClick={async () => { await runSectors(); qc.invalidateQueries({ queryKey: ['sectors'] }) }} disabled={st.running} className="rounded-lg border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-soft disabled:opacity-60">{st.running ? 'Updating…' : 'Refresh'}</button>}
      />

      {d.funnel && (
        <div className="mb-4 flex flex-wrap gap-2 text-[12px]">
          {([['Liquid stocks', d.funnel.liquid], ['Sectors', d.sectors.length], ['NSE-classified', d.funnel.nseClassified], ['Fully analysed', d.funnel.analysed]] as const).map(([k, v]) => (
            <span key={k} className="rounded-lg bg-soft px-3 py-1.5 text-sub"><b className="num text-ink">{v}</b> {k}</span>
          ))}
          <span className="rounded-lg bg-pos-bg px-3 py-1.5 text-pos"><b className="num">{d.leaders.filter((l) => l.qualified).length}</b> qualified leaders</span>
        </div>
      )}
      {st.running && (
        <div className="card mb-4 flex items-center gap-3 border-amber/30 bg-amber-bg p-4 text-[13px] text-amber">
          <Loader2 className="size-4 animate-spin" /> Updating for the latest session: {st.step}{st.total ? ` (${st.done}/${st.total})` : ''}. Showing the previous run meanwhile.
        </div>
      )}

      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[17px] font-semibold">Sector strength</h2>
        {sel && <button onClick={() => setSel(null)} className="text-[13px] font-medium text-brand hover:underline">Show all sectors</button>}
      </div>
      <p className="mb-3 text-[12.5px] text-sub">Median return of the sector's stocks and the share trading above their 50-day EMA. Strength 0–100 compares sectors with each other: it describes the recent past, not next week. Click a sector to see every stock in it.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {d.sectors.map((s) => <SectorCard key={s.sector} s={s} active={sel === s.sector} onClick={() => setSel(sel === s.sector ? null : s.sector)} />)}
      </div>

      <div className="card mt-6 flex flex-wrap items-end gap-x-6 gap-y-4 p-5">
        {group('Show', SHOW.map((f) => <button key={f.k} onClick={() => setShow(f.k)} className={btn(show === f.k)}>{f.label}</button>))}
        {group('Fundamentals', FUND.map((f) => <button key={f.k} onClick={() => setFund(f.k)} className={btn(fund === f.k)}>{f.label}</button>))}
        <label className="flex cursor-pointer items-center gap-1.5 pb-2 text-[13px] text-sub"><input type="checkbox" checked={buyOnly} onChange={(e) => setBuyOnly(e.target.checked)} className="size-3.5" />Entry ready (BUY) only</label>
        <div className="flex flex-wrap gap-x-3 gap-y-1 pb-2 text-[12px] text-sub">
          {CHECKS.map((c) => <span key={c.k} className="flex items-center gap-1"><Tick ok label={c.label} hint={c.hint} />{c.hint.split(':')[0]}</span>)}
        </div>
      </div>

      {shown.map((s) => {
        const rows = leadersBy.get(s.sector) ?? []
        const list = sel ? rows : rows.slice(0, 5)
        return (
          <section key={s.sector} className="mt-7">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h2 className="text-[17px] font-semibold">{s.sector}</h2>
              <span className={clsx('rounded-md px-1.5 py-0.5 text-[11px] font-medium', LABEL_TONE[s.label])}>{s.label} · {s.strength}</span>
              <span className="text-[12.5px] text-sub">{rows.length} shown of {s.analysed} analysed · {s.stocks} stocks</span>
              {!sel && rows.length > 5 && <button onClick={() => setSel(s.sector)} className="text-[12.5px] font-medium text-brand hover:underline">all {rows.length} →</button>}
            </div>
            {list.length ? <LeaderTable rows={list} /> : <div className="card p-4 text-[13px] text-sub">No analysed stock in this sector passes the filters today.</div>}
          </section>
        )
      })}

      {selStats && (
        <section className="mt-8">
          <h2 className="mb-1 text-[17px] font-semibold">Every stock in {selStats.sector} ({selStats.stocks})</h2>
          <p className="mb-3 text-[12.5px] text-sub">Ranked by price score (70% growth vs the whole market, 30% trend). Only the top {d.params?.perSector} get the full fundamental analysis; open any stock for its own verdict.</p>
          <StockTable rows={d.stocks.filter((x) => x.sector === selStats.sector).sort((a, b) => b.priceScore - a.priceScore)} />
        </section>
      )}

      <p className="mt-6 max-w-4xl text-xs text-mute">
        Sectors are NSE's own classification (Nifty Total Market list); stocks outside it use their Yahoo Finance industry mapped to the same sectors, and the rest are under "Others".
        Score = 40% fundamentals (18-step) + 35% growth (market percentile of 3M / 6M / 1Y returns and up weeks / months) + 25% technical setup.
        "Qualified" = fundamentals, sales and profit growth, 3M and 6M returns and trend all positive. Sales / profit CAGR come from the free Yahoo statements (4–5 years).
        A strong sector or a qualified stock can still fall next week: these are rule-based filters, not a forecast or advice.
      </p>
      <Disclaimer />
    </>
  )
}
