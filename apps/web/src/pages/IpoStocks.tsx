import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Link } from 'react-router'
import { useMemo, useState } from 'react'
import { Chip, ErrorBox, Loading, Section } from '../components/ui'
import { inr, pct, pctRaw, tone } from '../lib/format'
import { retVs, useLiveQuotes } from '../lib/live'

interface Period { period: string; ret: number | null; complete: boolean }
interface Consistency { total: number; up: number; list: Period[]; toDate: number | null; worst: number | null }
interface Fund {
  ok?: boolean; verdict?: 'PASS' | 'WATCH' | 'AVOID' | 'UNKNOWN'; qualityScore?: number | null; flags?: string[]; positives?: string[]
  roe?: number | null; roe3yAvg?: number | null; roce?: number | null; debtToEquity?: number | null; salesCagr?: number | null
  profitCagr?: number | null; revenueGrowth?: number | null; earningsGrowth?: number | null; profitMargin?: number | null
  pe?: number | null; marketCapCr?: number | null
}
interface Row {
  symbol: string; name: string | null; sector: string; close: number; prevClose?: number | null; chg1: number | null; turnoverCr: number
  listingDate: string; sessions: number; listOpen: number | null; sinceListing: number | null; fromHigh: number | null
  issuePrice?: number | null; vsIssue?: number | null; listingGain?: number | null
  weeks: Consistency; months: Consistency; fundamentals: Fund
  rating?: Rating; sentiment?: { score: number; label: string; severe: boolean; headlines: number; items: { title: string; link: string; source: string | null }[] }
}
interface RatingComp { key: string; label: string; weight: number; score: number; note: string }
interface Rating { score: number; grade: 'STRONG_BUY' | 'BUY' | 'WATCH' | 'AVOID'; label: string; vetoes: string[]; components: RatingComp[] }
interface Resp { asOf: string | null; rows: Row[]; building?: boolean; stale?: boolean }

const WINDOWS = [3, 6, 12]
const GRADE_ORDER = { STRONG_BUY: 3, BUY: 2, WATCH: 1, AVOID: 0 } as const
const gradeTone = (g?: string) => (g === 'STRONG_BUY' ? 'bg-pos text-white' : g === 'BUY' ? 'bg-pos-bg text-pos' : g === 'WATCH' ? 'bg-amber-bg text-amber' : 'bg-neg-bg text-neg')

function RatingBlock({ r }: { r: Rating }) {
  return (
    <div className="mt-4 rounded-xl bg-soft px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Purchase rating</span>
        <span className="num text-[13px] font-semibold text-ink">{r.score}/100</span>
      </div>
      <div className="space-y-1.5">
        {r.components.map((c) => (
          <div key={c.key} className="grid grid-cols-[112px_1fr_28px] items-center gap-2 text-[11.5px]" title={c.note}>
            <span className="truncate text-sub">{c.label} <span className="text-mute">{Math.round(c.weight * 100)}%</span></span>
            <span className="h-1.5 overflow-hidden rounded-full bg-line"><span className={clsx('block h-full rounded-full', c.score >= 65 ? 'bg-pos' : c.score >= 45 ? 'bg-amber' : 'bg-neg')} style={{ width: `${c.score}%` }} /></span>
            <span className="num text-right font-medium text-ink">{c.score}</span>
          </div>
        ))}
      </div>
      {r.vetoes.length > 0 && <p className="mt-2 text-[11.5px] font-medium text-neg">Vetoed: {r.vetoes.join('; ')}</p>}
    </div>
  )
}
const FUND = [{ k: 'pass', label: 'PASS only' }, { k: 'watch', label: 'PASS or WATCH' }, { k: 'any', label: 'Any' }] as const
const CONS = [
  { k: 'strict', label: 'Every week & month up' },
  { k: 'months', label: 'Every month up' },
  { k: 'mostly', label: 'Every month + ≥75% weeks up' },
  { k: 'any', label: 'Any' },
] as const

function Strip({ c, label }: { c: Consistency; label: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11.5px]">
        <span className="text-sub">{label}</span>
        <span className="num font-semibold text-ink">{c.up}/{c.total} up{c.toDate != null && <span className={clsx('ml-1.5 font-normal', tone(c.toDate))}>· now {pctRaw(c.toDate, 1)}</span>}</span>
      </div>
      <div className="flex flex-wrap gap-[3px]">
        {c.list.map((p) => (
          <span key={p.period} title={`${p.period}: ${p.ret == null ? '-' : pctRaw(p.ret, 1)}${p.complete ? '' : ' (in progress)'}`}
            className={clsx('h-3.5 min-w-3.5 flex-1 rounded-[3px]', !p.complete && 'opacity-40 ring-1 ring-inset ring-mute', (p.ret ?? 0) > 0 ? 'bg-pos' : 'bg-neg')} />
        ))}
      </div>
    </div>
  )
}

export default function IpoStocks() {
  const q = useQuery({ queryKey: ['ipo-quality'], queryFn: async () => (await (await fetch('/api/ipos/quality')).json()) as Resp, refetchInterval: (qq) => (qq.state.data?.building ? 20_000 : false) })
  const [months, setMonths] = useState(6)
  const [fund, setFund] = useState<(typeof FUND)[number]['k']>('pass')
  const [cons, setCons] = useState<(typeof CONS)[number]['k']>('strict')
  const [maxPrice, setMaxPrice] = useState(600)
  const [live, setLive] = useState(false)
  const [sortBy, setSortBy] = useState<'rating' | 'consistency' | 'vsIssue'>('rating')
  const [minGrade, setMinGrade] = useState<'any' | 'WATCH' | 'BUY'>('any')

  const { shown, near } = useMemo(() => {
    const rows = q.data?.rows ?? []
    if (!q.data?.asOf) return { shown: [] as Row[], near: [] as Row[] }
    const cut = new Date(`${q.data.asOf}T00:00:00Z`); cut.setUTCMonth(cut.getUTCMonth() - months)
    const cutS = cut.toISOString().slice(0, 10)
    const base = rows.filter((r) => r.listingDate >= cutS && (!maxPrice || r.close <= maxPrice))
    const fOk = (r: Row) => fund === 'any' || r.fundamentals?.verdict === 'PASS' || (fund === 'watch' && r.fundamentals?.verdict === 'WATCH')
    const wkAll = (r: Row) => r.weeks.total > 0 && r.weeks.up === r.weeks.total
    const moAll = (r: Row) => r.months.total === 0 ? (r.months.toDate ?? -1) > 0 : r.months.up === r.months.total
    const cOk = (r: Row) => cons === 'any' || (cons === 'strict' ? wkAll(r) && moAll(r) : cons === 'months' ? moAll(r) : moAll(r) && r.weeks.up / Math.max(1, r.weeks.total) >= 0.75)
    const score = (r: Row) => r.weeks.up / Math.max(1, r.weeks.total) + r.months.up / Math.max(1, r.months.total)
    const gOk = (r: Row) => minGrade === 'any' || GRADE_ORDER[r.rating?.grade ?? 'AVOID'] >= GRADE_ORDER[minGrade]
    const order = (a: Row, b: Row) => sortBy === 'rating' ? (b.rating?.score ?? 0) - (a.rating?.score ?? 0)
      : sortBy === 'vsIssue' ? (b.vsIssue ?? -1e9) - (a.vsIssue ?? -1e9) : score(b) - score(a) || (b.sinceListing ?? 0) - (a.sinceListing ?? 0)
    const shown = base.filter((r) => fOk(r) && cOk(r) && gOk(r)).sort(order)
    const near = base.filter((r) => fOk(r) && !cOk(r)).sort((a, b) => (b.rating?.score ?? 0) - (a.rating?.score ?? 0)).slice(0, 8)
    return { shown, near }
  }, [q.data, months, fund, cons, maxPrice, sortBy, minGrade])
  const lq = useLiveQuotes(shown.map((r) => r.symbol), live)

  if (q.isLoading) return <Loading what="IPO stocks" />
  if (q.error) return <ErrorBox error={q.error} />
  const data = q.data!
  if (!data.asOf) return <div className="card p-8 text-center text-sm text-sub">Building the IPO list for the first time (fundamentals for every recent listing). This takes about 10–15 minutes; the page refreshes automatically.</div>

  const btn = (on: boolean) => clsx('rounded-md px-3 py-1 text-[13px] font-medium', on ? 'bg-surface text-brand shadow-sm' : 'text-sub hover:text-ink')

  return (
    <>
      <div>
        <div className="label">IPO stocks</div>
        <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight">Recent IPOs with good fundamentals that keep closing higher</h1>
        <p className="mt-1 max-w-3xl text-[13px] text-sub">
          Main-board IPOs from NSE's past-issues list (SME issues and direct listings excluded). A week counts as up when its last close beats the previous week's last close; a month when its month-end close beats the
          previous month-end (the first period compares with the listing price). The current, unfinished week/month is shown faded and does not count. Official NSE close of {data.asOf}.
          {data.stale && data.building && ' Updating to the latest session in the background…'}
        </p>
      </div>

      <div className="card mt-5 flex flex-wrap items-end gap-x-6 gap-y-4 p-5">
        <div><div className="label mb-1.5">Listed within</div><div className="flex gap-1 rounded-lg bg-soft p-1">{WINDOWS.map((m) => <button key={m} onClick={() => setMonths(m)} className={btn(months === m)}>{m} months</button>)}</div></div>
        <div><div className="label mb-1.5">Fundamentals</div><div className="flex gap-1 rounded-lg bg-soft p-1">{FUND.map((f) => <button key={f.k} onClick={() => setFund(f.k)} className={btn(fund === f.k)}>{f.label}</button>)}</div></div>
        <div><div className="label mb-1.5">Closing pattern</div><div className="flex flex-wrap gap-1 rounded-lg bg-soft p-1">{CONS.map((c) => <button key={c.k} onClick={() => setCons(c.k)} className={btn(cons === c.k)}>{c.label}</button>)}</div></div>
        <div><div className="label mb-1.5">Min rating</div><div className="flex gap-1 rounded-lg bg-soft p-1">{([['any', 'Any'], ['WATCH', 'Watch+'], ['BUY', 'Buy+']] as const).map(([k, l]) => <button key={k} onClick={() => setMinGrade(k)} className={btn(minGrade === k)}>{l}</button>)}</div></div>
        <div><div className="label mb-1.5">Sort by</div><div className="flex gap-1 rounded-lg bg-soft p-1">{([['rating', 'Rating'], ['consistency', 'Consistency'], ['vsIssue', 'vs Issue']] as const).map(([k, l]) => <button key={k} onClick={() => setSortBy(k)} className={btn(sortBy === k)}>{l}</button>)}</div></div>
        <label className="text-xs text-sub">Max price (₹)
          <input type="number" min={0} step={50} value={maxPrice || ''} placeholder="no limit" onChange={(e) => setMaxPrice(Number(e.target.value) || 0)} className="num mt-1 block w-28" />
        </label>
        <label className={clsx('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium', live ? 'border-brand bg-brand-soft text-brand' : 'border-line-strong text-sub')}>
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="size-4 accent-[#16345c]" />Live prices
        </label>
      </div>

      <Section title={`${shown.length} IPO stock${shown.length === 1 ? '' : 's'} match`}>
        {shown.length === 0 ? (
          <div className="card p-6 text-sm text-sub">No recent IPO passes every rule right now. Closest candidates are listed below — or relax "Closing pattern" or "Fundamentals".</div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {shown.map((r) => {
              const lv = live ? lq.data?.[r.symbol] : null
              const price = lv?.price ?? r.close
              const vsIssue = lv ? retVs(lv.price, r.issuePrice) : (r.vsIssue ?? null)
              const f = r.fundamentals ?? {}
              return (
                <article key={r.symbol} className="card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link to={`/stock/${r.symbol}`} className="text-[19px] font-semibold tracking-tight hover:text-brand">{r.symbol}</Link>
                      <div className="truncate text-[13px] text-sub">{r.name}</div>
                      <div className="mt-1 text-xs text-mute">Listed {new Date(`${r.listingDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · {r.sessions} sessions</div>
                    </div>
                    <div className="text-right">
                      {r.rating && <div className={clsx('mb-1 inline-block rounded-md px-2.5 py-1 text-[12.5px] font-semibold', gradeTone(r.rating.grade))}>{r.rating.label} · {r.rating.score}</div>}
                      <div className="num text-[19px] font-semibold">₹{inr(price)}{lv && <span className="ml-1 rounded bg-blue-bg px-1 align-middle text-[9.5px] font-semibold text-blue">LIVE</span>}</div>
                      <div className="num text-xs text-mute">issue ₹{inr(r.issuePrice)} · <span className={tone(vsIssue)}>{pctRaw(vsIssue, 1)}</span></div>
                      <div className="num text-xs text-mute">listed at ₹{inr(r.listOpen)} ({pctRaw(r.listingGain, 0)})</div>
                    </div>
                  </div>
                  <div className="mt-4 space-y-3">
                    <Strip c={r.weeks} label="Weeks" />
                    <Strip c={r.months} label="Months" />
                  </div>
                  {r.rating && <RatingBlock r={r.rating} />}
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {r.sentiment && <Chip tone={r.sentiment.label === 'POSITIVE' ? 'green' : r.sentiment.label === 'NEGATIVE' ? 'red' : 'default'}>News {r.sentiment.label.toLowerCase()}{r.sentiment.headlines ? ` · ${r.sentiment.headlines}` : ''}</Chip>}
                    <Chip tone={f.verdict === 'PASS' ? 'green' : f.verdict === 'AVOID' ? 'red' : 'gold'}>Fundamentals {f.verdict === 'UNKNOWN' || !f.verdict ? 'n/a' : `${f.verdict.toLowerCase()} · ${f.qualityScore}/100`}</Chip>
                    {(f.roe3yAvg ?? f.roe) != null && <Chip>ROE {pct(f.roe3yAvg ?? f.roe, 0)}</Chip>}
                    {f.roce != null && <Chip>ROCE {pct(f.roce, 0)}</Chip>}
                    {f.debtToEquity != null && <Chip>D/E {f.debtToEquity.toFixed(2)}</Chip>}
                    {(f.salesCagr ?? f.revenueGrowth) != null && <Chip>Sales {pct(f.salesCagr ?? f.revenueGrowth, 0)}</Chip>}
                    {f.profitMargin != null && <Chip>Margin {pct(f.profitMargin, 0)}</Chip>}
                    {f.pe != null && <Chip>P/E {f.pe.toFixed(0)}</Chip>}
                  </div>
                  <div className="mt-3 flex justify-between text-xs text-mute">
                    <span>From high {pctRaw(r.fromHigh, 1)}</span><span>Worst week {pctRaw(r.weeks.worst, 1)}</span><span>Turnover ₹{r.turnoverCr} Cr/day</span>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </Section>

      {near.length > 0 && (
        <Section title="Closest candidates" sub="Pass the fundamentals and price filters but missed at least one week or month.">
          <div className="card divide-y divide-line">
            {near.map((r) => (
              <div key={r.symbol} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3 text-[13px]">
                <Link to={`/stock/${r.symbol}`} className="w-32 font-semibold hover:text-brand">{r.symbol}</Link>
                {r.rating && <span className={clsx('rounded px-2 py-0.5 text-xs font-semibold', gradeTone(r.rating.grade))}>{r.rating.label} · {r.rating.score}</span>}
                <span className="num text-sub">₹{inr(r.close)}</span>
                <span className="num text-sub">weeks {r.weeks.up}/{r.weeks.total}</span>
                <span className="num text-sub">months {r.months.up}/{r.months.total}</span>
                <span className={clsx('num', tone(r.vsIssue))}>vs issue {pctRaw(r.vsIssue ?? null, 1)}</span>
                <span className="text-mute">fundamentals {r.fundamentals?.verdict?.toLowerCase() ?? 'n/a'}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="card mt-6 border-amber/30 p-4 text-[13px] leading-relaxed text-sub">
        <b className="text-ink">Purchase rating</b> = 30% fundamentals + 15% news sentiment + 20% price strength (weekly/monthly closes, vs issue, from high) + 20% investor demand
        (listing gain, delivery %, turnover) + 15% market backdrop (regime, breadth, FII positioning). Strong buy ≥ 75, Buy ≥ 60, Watch ≥ 45, otherwise Avoid; AVOID fundamentals or a
        red-flag headline force Avoid. It is a transparent checklist score, <b className="text-ink">not backtested</b> — it ranks and explains, it does not guarantee returns.
        <br /><br />
        <b className="text-ink">Read with care.</b> Very new listings have few completed weeks/months, so "every week up" can rest on 2–3 data points. Fundamentals for new IPOs often show
        n/a because public sources carry little history. Recent momentum in IPOs reverses sharply and often; size small and check the stock page (lower-circuit history, news) first.
      </div>
    </>
  )
}
