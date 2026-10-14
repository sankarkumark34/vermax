import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, ChevronDown, ChevronRight, X } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Disclaimer, PageHead } from '../components/selection'
import { SortHead, useSort, type SortCol } from '../components/sortable'
import { Chip, ErrorBox, Loading } from '../components/ui'
import { dateLabel, inr, pct, pctRaw, tone } from '../lib/format'
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
interface Resp { asOf: string | null; rows: Row[]; building?: boolean; stale?: boolean; minMonths?: number; excludedYoung?: number }
interface Rule { key: string; label: string; pass: boolean; detail: string }
interface Ev { n: number; r: Row; wk: number | null; mo: number | null; qt: number | null; qLabel: string; rules: Rule[]; fails: Rule[] }

const FUND = [{ k: 75, label: 'Best (PASS, 75+)' }, { k: 60, label: 'Good (PASS, 60+)' }, { k: 1, label: 'Any PASS' }, { k: 0, label: 'Any' }] as const
const gradeTone = (g?: string) => (g === 'STRONG_BUY' ? 'bg-pos text-white' : g === 'BUY' ? 'bg-pos-bg text-pos' : g === 'WATCH' ? 'bg-amber-bg text-amber' : 'bg-neg-bg text-neg')
const GRADE_ORDER = { STRONG_BUY: 3, BUY: 2, WATCH: 1, AVOID: 0 } as const
const FUND_ORDER = { PASS: 3, WATCH: 2, UNKNOWN: 1, AVOID: 0 } as const
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const signed = (x: number | null) => (x == null ? 'n/a' : `${x > 0 ? '+' : ''}${x.toFixed(1)}%`)

/** Last completed calendar quarter as of `asOf`: its months and a label such as "Jul-Sep 2026". A month is complete once the data has moved into the next one. */
function lastQuarter(asOf: string) {
  const cur = asOf.slice(0, 7)
  let y = +asOf.slice(0, 4)
  let q = Math.floor((+asOf.slice(5, 7) - 1) / 3)
  for (let i = 0; i < 2; i++) {
    const months = [0, 1, 2].map((k) => `${y}-${String(q * 3 + k + 1).padStart(2, '0')}`)
    if (months[2] < cur) return { months, label: `${MON[q * 3]}-${MON[q * 3 + 2]} ${y}` }
    if (--q < 0) { q = 3; y-- }
  }
  throw new Error('no completed quarter')
}

const lastDone = (c: Consistency) => [...c.list].reverse().find((p) => p.complete)?.ret ?? null

/** Return of the quarter = months of it compounded (the first month of a new listing is measured from the listing-day open). */
function quarterRet(r: Row, months: string[]): number | null {
  const by = new Map(r.months.list.filter((p) => p.complete && p.ret != null).map((p) => [p.period, p.ret as number]))
  const have = months.filter((m) => by.has(m))
  return have.length ? (have.reduce((x, m) => x * (1 + by.get(m)! / 100), 1) - 1) * 100 : null
}

function Tick({ ok }: { ok: boolean }) {
  return (
    <span className={clsx('grid size-[18px] shrink-0 place-items-center rounded-full', ok ? 'bg-pos-bg text-pos' : 'bg-neg-bg text-neg')}>
      {ok ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
    </span>
  )
}

function RatingBlock({ r }: { r: Rating }) {
  return (
    <div className="rounded-xl bg-soft px-4 py-3">
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

const BASE_COLS: SortCol<Ev>[] = [
  { h: '#', get: (e) => e.n, title: 'Original rank (fundamentals, then rating)' },
  { h: 'Stock', get: (e) => e.r.symbol },
  { h: 'Listed', get: (e) => e.r.listingDate, right: true },
  { h: 'Price', get: (e) => e.r.close, right: true },
  { h: 'vs Issue', get: (e) => e.r.vsIssue, right: true },
  { h: 'Last week', get: (e) => e.wk, right: true },
  { h: 'Last month', get: (e) => e.mo, right: true },
  { h: 'Last quarter', get: (e) => e.qt, right: true },
  { h: 'Fund. score', get: (e) => (e.r.fundamentals?.verdict === 'PASS' ? 1000 : 0) + (e.r.fundamentals?.qualityScore ?? -1), right: true, title: 'PASS first, then quality score' },
  { h: 'ROE', get: (e) => e.r.fundamentals?.roe3yAvg ?? e.r.fundamentals?.roe, right: true },
  { h: 'D/E', get: (e) => e.r.fundamentals?.debtToEquity, right: true },
  { h: 'Sales growth', get: (e) => e.r.fundamentals?.salesCagr ?? e.r.fundamentals?.revenueGrowth, right: true },
  { h: 'Rating', get: (e) => e.r.rating?.score, right: true },
]
const MISS_COL: SortCol<Ev> = { h: 'Missed', get: (e) => e.fails.map((f) => f.label).join(', ') }

function Table({ items, live, showMiss }: { items: Ev[]; live: Record<string, { price: number } | null | undefined> | undefined; showMiss: boolean }) {
  const cols = useMemo(() => (showMiss ? [...BASE_COLS, MISS_COL] : BASE_COLS), [showMiss])
  const { sorted, sort, toggle } = useSort(items, cols)
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[1180px] text-[13px]">
        <SortHead cols={cols} sort={sort} toggle={toggle} />
        <tbody>
          {sorted.map((e) => {
            const { r } = e, f = r.fundamentals ?? {}
            const lv = live?.[r.symbol]
            const price = lv?.price ?? r.close
            const vsIssue = lv ? retVs(lv.price, r.issuePrice) : (r.vsIssue ?? null)
            const roe = f.roe3yAvg ?? f.roe, sales = f.salesCagr ?? f.revenueGrowth
            return (
              <Fragment key={r.symbol}>
                <tr className="cursor-pointer border-b border-line/70 hover:bg-soft/60" onClick={() => setOpen(open === r.symbol ? null : r.symbol)}>
                  <td className="num px-3 py-3 font-semibold text-mute">{e.n}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      {open === r.symbol ? <ChevronDown className="size-4 text-mute" /> : <ChevronRight className="size-4 text-mute" />}
                      <div>
                        <Link to={`/stock/${r.symbol}`} onClick={(ev) => ev.stopPropagation()} className="font-semibold text-ink hover:text-brand">{r.symbol}</Link>
                        <div className="max-w-48 truncate text-[11.5px] text-mute" title={r.name ?? ''}>{r.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num px-3 py-3 text-right text-[12px] text-sub">{dateLabel(r.listingDate).replace(/^\w+, /, '')}<div className="text-[11px] text-mute">{r.sessions} sessions</div></td>
                  <td className="num px-3 py-3 text-right">₹{inr(price)}{lv && <span className="ml-1 rounded bg-blue-bg px-1 align-middle text-[9.5px] font-semibold text-blue">LIVE</span>}<div className="text-[11px] text-mute">issue ₹{inr(r.issuePrice)}</div></td>
                  <td className={clsx('num px-3 py-3 text-right', tone(vsIssue))}>{pctRaw(vsIssue, 1)}</td>
                  {[e.wk, e.mo, e.qt].map((v, k) => <td key={k} className={clsx('num px-3 py-3 text-right', tone(v))}>{signed(v)}</td>)}
                  <td className="px-3 py-3 text-right">
                    <span className={clsx('inline-block rounded px-1.5 py-0.5 text-[11.5px] font-semibold', f.verdict === 'PASS' ? 'bg-pos-bg text-pos' : f.verdict === 'AVOID' ? 'bg-neg-bg text-neg' : 'bg-amber-bg text-amber')}>
                      {f.verdict === 'UNKNOWN' || !f.verdict ? 'n/a' : `${f.verdict} · ${f.qualityScore ?? '–'}`}
                    </span>
                  </td>
                  <td className="num px-3 py-3 text-right">{pct(roe, 0)}</td>
                  <td className="num px-3 py-3 text-right">{f.debtToEquity != null ? f.debtToEquity.toFixed(2) : '–'}</td>
                  <td className={clsx('num px-3 py-3 text-right', tone(sales))}>{pct(sales, 0)}</td>
                  <td className="px-3 py-3 text-right">{r.rating ? <span className={clsx('rounded px-2 py-0.5 text-xs font-semibold', gradeTone(r.rating.grade))}>{r.rating.label} · {r.rating.score}</span> : '–'}</td>
                  {showMiss && <td className="px-3 py-3 text-xs text-neg">{e.fails.map((x) => x.label).join(', ')}</td>}
                </tr>
                {open === r.symbol && (
                  <tr className="border-b border-line bg-soft/60">
                    <td colSpan={cols.length} className="px-5 py-4">
                      <div className="grid gap-5 lg:grid-cols-3">
                        <div>
                          <div className="label mb-2">Rules</div>
                          <ul className="space-y-1.5 text-[13px]">
                            {e.rules.map((x) => <li key={x.key} className="flex items-start gap-2"><Tick ok={x.pass} /><span><span className="text-ink">{x.label}</span> <span className="text-mute">· {x.detail}</span></span></li>)}
                          </ul>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {r.sentiment && <Chip tone={r.sentiment.label === 'POSITIVE' ? 'green' : r.sentiment.label === 'NEGATIVE' ? 'red' : 'default'}>News {r.sentiment.label.toLowerCase()}{r.sentiment.headlines ? ` · ${r.sentiment.headlines}` : ''}</Chip>}
                            {f.roce != null && <Chip>ROCE {pct(f.roce, 0)}</Chip>}
                            {f.profitMargin != null && <Chip>Margin {pct(f.profitMargin, 0)}</Chip>}
                            {f.pe != null && <Chip>P/E {f.pe.toFixed(0)}</Chip>}
                            {r.listingGain != null && <Chip>Listing gain {pctRaw(r.listingGain, 0)}</Chip>}
                          </div>
                          <div className="mt-3 text-xs text-mute">From high {pctRaw(r.fromHigh, 1)} · worst week {pctRaw(r.weeks.worst, 1)} · turnover ₹{r.turnoverCr} Cr/day</div>
                        </div>
                        <div className="space-y-3"><Strip c={r.weeks} label="Weeks" /><Strip c={r.months} label="Months" /></div>
                        <div>{r.rating && <RatingBlock r={r.rating} />}</div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function IpoStocks() {
  const q = useQuery({ queryKey: ['ipo-quality'], queryFn: async () => (await (await fetch('/api/ipos/quality')).json()) as Resp, refetchInterval: (qq) => (qq.state.data?.building ? 20_000 : false) })
  const [months, setMonths] = useState(12)
  const [fund, setFund] = useState<number>(75)
  const [needWeek, setNeedWeek] = useState(true)
  const [needMonth, setNeedMonth] = useState(true)
  const [needQuarter, setNeedQuarter] = useState(true)
  const [cleanNews, setCleanNews] = useState(true)
  const [maxPrice, setMaxPrice] = useState(0)
  const [live, setLive] = useState(false)

  const asOf = q.data?.asOf ?? null
  const quarter = useMemo(() => (asOf ? lastQuarter(asOf) : null), [asOf])

  const evaluated = useMemo<Ev[]>(() => {
    if (!asOf || !quarter) return []
    const cut = new Date(`${asOf}T00:00:00Z`); cut.setUTCMonth(cut.getUTCMonth() - months)
    const cutS = cut.toISOString().slice(0, 10)
    const rows = (q.data?.rows ?? []).filter((r) => r.listingDate >= cutS)
      .sort((a, b) => (FUND_ORDER[b.fundamentals?.verdict ?? 'UNKNOWN'] - FUND_ORDER[a.fundamentals?.verdict ?? 'UNKNOWN']) || ((b.fundamentals?.qualityScore ?? -1) - (a.fundamentals?.qualityScore ?? -1)) || ((b.rating?.score ?? 0) - (a.rating?.score ?? 0)))
    return rows.map((r, i) => {
      const wk = lastDone(r.weeks), mo = lastDone(r.months), qt = quarterRet(r, quarter.months)
      const f = r.fundamentals ?? {}, qs = f.qualityScore ?? null
      const rules: Rule[] = [
        { key: 'fund', label: FUND.find((x) => x.k === fund)!.label.replace(/^(\w+) /, 'Fundamentals: $1 '), pass: fund === 0 || (f.verdict === 'PASS' && (qs ?? 0) >= (fund === 1 ? 0 : fund)), detail: `${f.verdict ?? 'n/a'}${qs != null ? ` · quality ${qs}/100` : ''}` },
        { key: 'week', label: 'Last completed week closed up', pass: !needWeek || (wk ?? -1) > 0, detail: signed(wk) },
        { key: 'month', label: 'Last completed month closed up', pass: !needMonth || (mo ?? -1) > 0, detail: signed(mo) },
        { key: 'quarter', label: `Last quarter (${quarter.label}) closed up`, pass: !needQuarter || (qt ?? -1) > 0, detail: signed(qt) },
        { key: 'news', label: 'No red-flag headline / veto', pass: !cleanNews || !(r.rating?.vetoes.length), detail: r.rating?.vetoes.length ? r.rating.vetoes.join('; ') : 'clean' },
        { key: 'price', label: maxPrice ? `Price ≤ ₹${maxPrice}` : 'Price (no limit set)', pass: !maxPrice || r.close <= maxPrice, detail: `₹${inr(r.close)}` },
      ]
      return { n: i + 1, r, wk, mo, qt, qLabel: quarter.label, rules, fails: rules.filter((x) => !x.pass) }
    })
  }, [q.data, asOf, quarter, months, fund, needWeek, needMonth, needQuarter, cleanNews, maxPrice])

  const pass = evaluated.filter((e) => e.fails.length === 0)
  const near = evaluated.filter((e) => e.fails.length === 1)
  const lq = useLiveQuotes([...pass, ...near].map((e) => e.r.symbol), live)

  if (q.isLoading) return <Loading what="IPO stocks" />
  if (q.error) return <ErrorBox error={q.error} />
  const data = q.data!
  if (!data.asOf || !quarter) return <div className="card p-8 text-center text-sm text-sub">Building the IPO list for the first time (fundamentals for every recent listing). This takes about 10–15 minutes; the page refreshes automatically.</div>

  const btn = (on: boolean) => clsx('rounded-md px-3 py-1 text-[13px] font-medium', on ? 'bg-surface text-brand shadow-sm' : 'text-sub hover:text-ink')
  const check = (label: string, on: boolean, set: (v: boolean) => void) => (
    <label className="flex cursor-pointer items-center gap-1.5 pb-2 text-[13px] text-sub"><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="size-3.5" />{label}</label>
  )

  return (
    <>
      <PageHead
        label="IPO stocks"
        title="Recent IPOs with the best fundamentals that closed their periods up"
        sub={`Main-board IPOs from NSE's past-issues list (SME issues and direct listings excluded) with at least ${data.minMonths ?? 3} months of trading${data.excludedYoung ? ` (${data.excludedYoung} newer listings hidden)` : ''}. A period is up when its last close beats the previous period's last close (the first period of a new listing is measured from the listing-day open). The unfinished week / month does not count; the last completed quarter is ${quarter.label}. Official NSE close of ${dateLabel(data.asOf)}.${data.stale && data.building ? ' Updating to the latest session in the background…' : ''}`}
      />

      <div className="card flex flex-wrap items-end gap-x-6 gap-y-4 p-5">
        <div><div className="label mb-1.5">Listed within</div><div className="flex gap-1 rounded-lg bg-soft p-1">{[6, 9, 12].map((m) => <button key={m} onClick={() => setMonths(m)} className={btn(months === m)}>{m} months</button>)}</div></div>
        <div><div className="label mb-1.5">Fundamentals</div><div className="flex flex-wrap gap-1 rounded-lg bg-soft p-1">{FUND.map((f) => <button key={f.k} onClick={() => setFund(f.k)} className={btn(fund === f.k)}>{f.label}</button>)}</div></div>
        <div>
          <div className="label mb-1.5">Closed up in the last…</div>
          <div className="flex gap-4">{check('Week', needWeek, setNeedWeek)}{check('Month', needMonth, setNeedMonth)}{check('Quarter', needQuarter, setNeedQuarter)}</div>
        </div>
        {check('No red-flag news', cleanNews, setCleanNews)}
        <label className="text-xs text-sub">Max price (₹)
          <input type="number" min={0} step={50} value={maxPrice || ''} placeholder="no limit" onChange={(e) => setMaxPrice(Number(e.target.value) || 0)} className="num mt-1 block w-28" />
        </label>
        <label className={clsx('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium', live ? 'border-brand bg-brand-soft text-brand' : 'border-line-strong text-sub')}>
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="size-4 accent-[#16345c]" />Live prices
        </label>
      </div>

      <h2 className="mb-1 mt-7 text-[17px] font-semibold">{pass.length} IPO stock{pass.length === 1 ? '' : 's'} pass every rule</h2>
      <p className="mb-3 text-[12.5px] text-sub">Best fundamentals first. Click a column to sort, click a row for the rule check, week / month history and the purchase-rating breakdown.</p>
      {pass.length ? <Table items={pass} live={live ? lq.data : undefined} showMiss={false} /> : (
        <div className="card p-6 text-sm text-sub">No recent IPO passes every rule today. That is normal for a strict rule set. Relax one rule above, or look at the near misses below.</div>
      )}

      <h2 className="mb-1 mt-8 text-[17px] font-semibold">One rule short ({near.length})</h2>
      <p className="mb-3 text-[12.5px] text-sub">These fail exactly one rule; the last column says which.</p>
      {near.length ? <Table items={near} live={live ? lq.data : undefined} showMiss /> : <div className="card p-6 text-sm text-sub">None.</div>}

      <p className="mt-6 max-w-4xl text-xs text-mute">
        <b className="text-sub">Purchase rating</b> = 30% fundamentals + 15% news sentiment + 20% price strength + 20% investor demand (listing gain, delivery %, turnover) + 15% market backdrop. It is a transparent checklist score, not backtested.
        Fundamentals of new IPOs are often thin (n/a) because public sources carry little history. Very new listings have few completed periods, so a "positive quarter" can rest on one or two months; IPO momentum reverses sharply and often.
        Check the stock page (lower-circuit history, news) first and size small.
      </p>
      <Disclaimer />
    </>
  )
}
