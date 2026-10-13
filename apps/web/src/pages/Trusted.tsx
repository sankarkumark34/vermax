import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, ChevronDown, ChevronRight, Loader2, Minus, X } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Chip, ErrorBox, Loading, Section } from '../components/ui'
import { inr, pctRaw, tone } from '../lib/format'

interface Period { total: number; up: number; toDate: number | null; list: { period: string; ret: number; complete: boolean }[] }
interface Row {
  symbol: string; name: string; sector: string; listingDate: string; sessions: number; issuePrice: number | null; listPrice: number; close: number; chg1: number | null
  vsListing: number; vsIssue: number | null; minCloseVsListing: number; minLowVsListing: number; sessionsBelowListing: number; lastBelowListing: string | null
  fromHigh: number; rsi: number | null; months: Period; quarters: Period; turnoverCr: number | null; deliveryAvg: number | null
  fundamentals: { verdict: string | null; qualityScore: number | null; roe: number | null; roce: number | null; debtToEquity: number | null; salesCagr: number | null; profitCagr: number | null; pe: number | null; marketCapCr: number | null; insiderHolding: number | null } | null
  industryPe?: number | null
  analysis: { score: number | null; verdict: 'STRONG_BUY' | 'BUY' | 'WATCH' | 'AVOID' | 'NOT_ENOUGH_DATA'; label: string; redFlags: string[]; strengths: string[]; concerns: string[] } | null
  trust: { ok: boolean; fails: string[] } | null
  news: { label: string; score: number; headlines: number } | null
}
interface Resp { asOf: string | null; building?: boolean; pending?: number; stale?: boolean; scanned: number; tooExpensive: number; fellBelowListing: number; maxPrice: number; slackPct: number; rows: Row[] }

const FUND = [{ k: 'pass', label: 'Pass' }, { k: 'watch', label: 'Pass + Watch' }, { k: 'any', label: 'Any' }] as const
const BUY = [{ k: 'buy', label: 'Buy / Strong buy' }, { k: 'watch', label: 'Watch or better' }, { k: 'any', label: 'Any' }] as const
const WINDOWS_M = [{ k: 3, label: 'last 3' }, { k: 6, label: 'last 6' }, { k: 12, label: 'last 12' }, { k: 0, label: 'all' }]
const WINDOWS_Q = [{ k: 2, label: 'last 2' }, { k: 4, label: 'last 4' }, { k: 0, label: 'all' }]
const VERDICT_TONE: Record<string, string> = { STRONG_BUY: 'bg-pos text-white', BUY: 'bg-pos-bg text-pos', WATCH: 'bg-amber-bg text-amber', AVOID: 'bg-neg-bg text-neg', NOT_ENOUGH_DATA: 'bg-soft text-sub' }
const d = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })

interface Rule { key: string; label: string; pass: boolean | null; detail: string }

function Strip({ p, window: w, label }: { p: Period; window: number; label: string }) {
  const done = p.list.filter((x) => x.complete)
  const shown = w ? done.slice(-w) : done
  return (
    <div title={`${label}: ${p.list.map((x) => `${x.period} ${x.ret > 0 ? '+' : ''}${x.ret}%`).join(' · ')}`} className="flex flex-wrap gap-0.5">
      {shown.slice(-12).map((x) => <span key={x.period} className={clsx('size-2.5 rounded-sm', x.ret > 0 ? 'bg-pos' : 'bg-neg')} />)}
      {p.toDate != null && <span className={clsx('size-2.5 rounded-sm opacity-40', p.toDate > 0 ? 'bg-pos' : 'bg-neg')} title="current period (not counted)" />}
    </div>
  )
}

export default function Trusted() {
  const q = useQuery({
    queryKey: ['trusted'], queryFn: async () => (await (await fetch('/api/trusted')).json()) as Resp, staleTime: 60_000,
    refetchInterval: (qq) => (!qq.state.data?.asOf || (qq.state.data?.pending ?? 0) > 0 ? 15_000 : false),
  })
  const [maxPrice, setMaxPrice] = useState(1000)
  const [mWin, setMWin] = useState(3)
  const [qWin, setQWin] = useState(2)
  const [rsiMin, setRsiMin] = useState(40)
  const [rsiMax, setRsiMax] = useState(70)
  const [fund, setFund] = useState<(typeof FUND)[number]['k']>('pass')
  const [buy, setBuy] = useState<(typeof BUY)[number]['k']>('buy')
  const [trustedOnly, setTrustedOnly] = useState(true)
  const [basis, setBasis] = useState<'close' | 'low'>('close')
  const [open, setOpen] = useState<string | null>(null)

  const evaluated = useMemo(() => (q.data?.rows ?? []).map((r) => {
    const mDone = r.months.list.filter((x) => x.complete), qDone = r.quarters.list.filter((x) => x.complete)
    const mSel = mWin ? mDone.slice(-mWin) : mDone, qSel = qWin ? qDone.slice(-qWin) : qDone
    const minVs = basis === 'close' ? r.minCloseVsListing : r.minLowVsListing
    const v = r.analysis?.verdict
    const rules: Rule[] = [
      { key: 'price', label: `Price ≤ ₹${maxPrice}`, pass: r.close <= maxPrice, detail: `₹${inr(r.close)}` },
      { key: 'listing', label: 'Never below listing price', pass: minVs >= 0, detail: `lowest ${basis === 'close' ? 'close' : 'intraday'} ${pctRaw(minVs, 1)} vs ₹${inr(r.listPrice)}${r.lastBelowListing ? ` · last below ${d(r.lastBelowListing)}` : ''}` },
      { key: 'months', label: `Every month up (${mWin ? `last ${mWin}` : 'all'})`, pass: mSel.length >= (mWin || 1) && mSel.every((x) => x.ret > 0), detail: `${mSel.filter((x) => x.ret > 0).length} of ${mSel.length} up` },
      { key: 'quarters', label: `Every quarter up (${qWin ? `last ${qWin}` : 'all'})`, pass: qSel.length >= (qWin || 1) && qSel.every((x) => x.ret > 0), detail: `${qSel.filter((x) => x.ret > 0).length} of ${qSel.length} up` },
      { key: 'rsi', label: `RSI ${rsiMin}–${rsiMax}`, pass: r.rsi == null ? null : r.rsi >= rsiMin && r.rsi <= rsiMax, detail: r.rsi == null ? 'n/a' : `RSI ${r.rsi}` },
      { key: 'fund', label: 'Good fundamentals', pass: !r.analysis ? null : fund === 'any' || r.fundamentals?.verdict === 'PASS' || (fund === 'watch' && r.fundamentals?.verdict === 'WATCH'), detail: r.fundamentals?.verdict ? `${r.fundamentals.verdict}${r.fundamentals.qualityScore != null ? ` · ${r.fundamentals.qualityScore}/100` : ''}` : 'no data' },
      { key: 'buy', label: 'Buy option', pass: !r.analysis ? null : buy === 'any' || v === 'STRONG_BUY' || v === 'BUY' || (buy === 'watch' && v === 'WATCH'), detail: r.analysis ? `${r.analysis.label}${r.analysis.score != null ? ` · ${r.analysis.score}/100` : ''}` : 'checking…' },
      { key: 'trust', label: 'Trusted', pass: !r.trust ? null : !trustedOnly || r.trust.ok, detail: r.trust ? (r.trust.ok ? 'no red flags' : r.trust.fails.join('; ')) : 'checking…' },
    ]
    return { r, rules, fails: rules.filter((x) => x.pass === false), pending: rules.some((x) => x.pass === null) }
  }).sort((a, b) => (b.r.analysis?.score ?? -1) - (a.r.analysis?.score ?? -1) || b.r.sessions - a.r.sessions), [q.data, maxPrice, mWin, qWin, rsiMin, rsiMax, fund, buy, trustedOnly, basis])

  if (q.isLoading) return <Loading what="steady IPOs" />
  if (q.error) return <ErrorBox error={q.error} />
  const data = q.data!
  if (!data.asOf) return <div className="card p-8 text-center text-sm text-sub">Scanning every IPO for the first time. The page refreshes automatically.</div>

  const pass = evaluated.filter((e) => e.fails.length === 0 && !e.pending)
  const checking = evaluated.filter((e) => e.fails.length === 0 && e.pending)
  const near = evaluated.filter((e) => e.fails.length === 1)
  const btn = (on: boolean) => clsx('rounded-md px-3 py-1 text-[13px] font-medium', on ? 'bg-surface text-brand shadow-sm' : 'text-sub hover:text-ink')
  const group = (label: string, children: React.ReactNode) => <div><div className="label mb-1.5">{label}</div><div className="flex gap-1 rounded-lg bg-soft p-1">{children}</div></div>

  const table = (items: typeof evaluated, showFail: boolean) => (
    <div className="card overflow-x-auto">
      <table className="num w-full min-w-[1000px] text-[13px]">
        <thead><tr className="border-b border-line text-left">
          {['Stock', 'Price', 'vs listing', 'Months', 'Quarters', 'RSI', 'Fundamentals', 'Buy score', 'Trusted', showFail ? 'Missed' : ''].map((h, i) => <th key={h + i} className={clsx('label px-3 py-2.5 font-medium', i > 0 && i < 9 && 'text-right')}>{h}</th>)}
        </tr></thead>
        <tbody>
          {items.map(({ r, rules, fails }) => {
            const a = r.analysis
            return (
              <Fragment key={r.symbol}>
                <tr className="cursor-pointer border-b border-line hover:bg-soft" onClick={() => setOpen(open === r.symbol ? null : r.symbol)}>
                  <td className="px-3 py-2.5 font-sans">
                    <div className="flex items-center gap-2">
                      {open === r.symbol ? <ChevronDown className="size-4 text-mute" /> : <ChevronRight className="size-4 text-mute" />}
                      <div><span className="font-semibold text-ink">{r.symbol}</span> {(r.sector === 'Defence' || r.sector === 'Engineering') && <Chip tone={r.sector === 'Defence' ? 'gold' : 'blue'}>{r.sector}</Chip>}
                        <div className="max-w-[200px] truncate text-xs text-mute">{r.name} · listed {d(r.listingDate)}</div></div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right">₹{inr(r.close)}<div className={clsx('text-xs', tone(r.chg1))}>{pctRaw(r.chg1, 2)}</div></td>
                  <td className="px-3 py-2.5 text-right"><span className={tone(r.vsListing)}>{pctRaw(r.vsListing, 1)}</span><div className="text-xs text-mute">low {pctRaw(basis === 'close' ? r.minCloseVsListing : r.minLowVsListing, 1)}</div></td>
                  <td className="px-3 py-2.5"><div className="flex justify-end"><Strip p={r.months} window={mWin} label="Months" /></div></td>
                  <td className="px-3 py-2.5"><div className="flex justify-end"><Strip p={r.quarters} window={qWin} label="Quarters" /></div></td>
                  <td className={clsx('px-3 py-2.5 text-right', r.rsi != null && r.rsi > rsiMax && 'text-neg')}>{r.rsi ?? '–'}</td>
                  <td className="px-3 py-2.5 text-right">{r.fundamentals?.verdict ? <Chip tone={r.fundamentals.verdict === 'PASS' ? 'green' : r.fundamentals.verdict === 'AVOID' ? 'red' : 'gold'}>{r.fundamentals.verdict}</Chip> : a ? '–' : <Loader2 className="ml-auto size-4 animate-spin text-mute" />}</td>
                  <td className="px-3 py-2.5 text-right">{a ? <span className={clsx('rounded-md px-2 py-0.5 text-xs font-semibold', VERDICT_TONE[a.verdict])}>{a.score ?? '–'} · {a.label}</span> : <Loader2 className="ml-auto size-4 animate-spin text-mute" />}</td>
                  <td className="px-3 py-2.5 text-right">{r.trust ? (r.trust.ok ? <Check className="ml-auto size-4 text-pos" strokeWidth={3} /> : <X className="ml-auto size-4 text-neg" strokeWidth={3} />) : <Loader2 className="ml-auto size-4 animate-spin text-mute" />}</td>
                  <td className="px-3 py-2.5 font-sans text-xs text-neg">{showFail ? fails.map((f) => f.label).join(', ') : ''}</td>
                </tr>
                {open === r.symbol && (
                  <tr className="border-b border-line bg-soft/60">
                    <td colSpan={10} className="px-5 py-4 font-sans">
                      <div className="grid gap-5 md:grid-cols-3">
                        <div>
                          <div className="label mb-2">Rules</div>
                          <ul className="space-y-1.5 text-[13px]">
                            {rules.map((x) => (
                              <li key={x.key} className="flex items-start gap-2">
                                {x.pass === true ? <Check className="mt-0.5 size-4 shrink-0 text-pos" strokeWidth={3} /> : x.pass === false ? <X className="mt-0.5 size-4 shrink-0 text-neg" strokeWidth={3} /> : <Minus className="mt-0.5 size-4 shrink-0 text-mute" />}
                                <span><span className="text-ink">{x.label}</span> <span className="text-mute">· {x.detail}</span></span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="label mb-2">Business</div>
                          {r.fundamentals ? (
                            <ul className="space-y-1.5 text-[13px]">
                              {([['ROE (3y)', r.fundamentals.roe != null ? `${(r.fundamentals.roe * 100).toFixed(0)}%` : '–'], ['ROCE', r.fundamentals.roce != null ? `${(r.fundamentals.roce * 100).toFixed(0)}%` : '–'],
                                ['Debt / equity', r.fundamentals.debtToEquity?.toFixed(2) ?? '–'], ['Sales growth', r.fundamentals.salesCagr != null ? `${(r.fundamentals.salesCagr * 100).toFixed(0)}%` : '–'],
                                ['Profit growth', r.fundamentals.profitCagr != null ? `${(r.fundamentals.profitCagr * 100).toFixed(0)}%` : '–'], ['P/E vs industry', r.fundamentals.pe != null ? `${r.fundamentals.pe.toFixed(1)} vs ${r.industryPe?.toFixed(1) ?? '–'}` : '–'],
                                ['Promoter holding', r.fundamentals.insiderHolding != null ? `${(r.fundamentals.insiderHolding * 100).toFixed(0)}%` : '–'], ['Market cap', r.fundamentals.marketCapCr ? `₹${Math.round(r.fundamentals.marketCapCr).toLocaleString('en-IN')} Cr` : '–']] as const).map(([k, v]) => (
                                <li key={k} className="flex justify-between"><span className="text-sub">{k}</span><span className="num text-ink">{v}</span></li>
                              ))}
                              <li className="flex justify-between"><span className="text-sub">Trading</span><span className="num text-ink">₹{r.turnoverCr} Cr/day · delivery {r.deliveryAvg ?? '–'}%</span></li>
                            </ul>
                          ) : <p className="text-[13px] text-mute">Loading…</p>}
                        </div>
                        <div className="space-y-2 text-[13px]">
                          {a?.strengths.length ? <div><div className="label !text-pos mb-1">Strengths</div><ul className="space-y-1">{a.strengths.map((s) => <li key={s}>{s}</li>)}</ul></div> : null}
                          {a?.concerns.length ? <div><div className="label !text-neg mb-1">Concerns</div><ul className="space-y-1">{a.concerns.map((s) => <li key={s}>{s}</li>)}</ul></div> : null}
                          {r.news && <div className="text-sub">News tone: {r.news.label} ({r.news.headlines} headlines)</div>}
                          <Link to={`/analyse/${r.symbol}`} className="inline-block font-medium text-brand hover:underline">Full analysis →</Link>
                          <span className="mx-2 text-mute">|</span>
                          <Link to={`/stock/${r.symbol}`} className="inline-block font-medium text-brand hover:underline">Chart →</Link>
                        </div>
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

  return (
    <>
      <div>
        <div className="label">Steady IPOs</div>
        <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight">Never below the listing price, up every month and quarter</h1>
        <p className="mt-1 max-w-4xl text-[13px] text-sub">
          Of {data.scanned} main-board IPOs that have traded at least 3 months, {data.fellBelowListing} closed more than {data.slackPct}% below their listing price at some point and {data.tooExpensive} cost more than ₹{data.maxPrice}.
          The rest are checked here against your rules; each stock then gets fundamentals, a Buy score and a trust check. Listing price = the listing-day open. A month or quarter is up when its last close beats the previous period's last close (the first one is compared with the listing price);
          the current unfinished month or quarter does not count. Official NSE close of {data.asOf}.
        </p>
      </div>

      <div className="card mt-5 flex flex-wrap items-end gap-x-6 gap-y-4 p-5">
        {group('Max price', [1000, 1500].map((p) => <button key={p} onClick={() => setMaxPrice(p)} className={btn(maxPrice === p)}>₹{p}</button>))}
        {group('Never below listing (basis)', <>
          <button onClick={() => setBasis('close')} className={btn(basis === 'close')}>Closing price</button>
          <button onClick={() => setBasis('low')} className={btn(basis === 'low')}>Intraday low</button></>)}
        {group('Every month up', WINDOWS_M.map((w) => <button key={w.k} onClick={() => setMWin(w.k)} className={btn(mWin === w.k)}>{w.label}</button>))}
        {group('Every quarter up', WINDOWS_Q.map((w) => <button key={w.k} onClick={() => setQWin(w.k)} className={btn(qWin === w.k)}>{w.label}</button>))}
        <div>
          <div className="label mb-1.5">RSI (14)</div>
          <div className="flex items-center gap-1.5 text-[13px]">
            <select value={rsiMin} onChange={(e) => setRsiMin(+e.target.value)} className="!py-1.5">{[30, 40, 45, 50].map((v) => <option key={v} value={v}>from {v}</option>)}</select>
            <select value={rsiMax} onChange={(e) => setRsiMax(+e.target.value)} className="!py-1.5">{[60, 65, 70, 75].map((v) => <option key={v} value={v}>to {v}</option>)}</select>
          </div>
        </div>
        {group('Fundamentals', FUND.map((f) => <button key={f.k} onClick={() => setFund(f.k)} className={btn(fund === f.k)}>{f.label}</button>))}
        {group('Buy option', BUY.map((f) => <button key={f.k} onClick={() => setBuy(f.k)} className={btn(buy === f.k)}>{f.label}</button>))}
        <label className="flex cursor-pointer items-center gap-1.5 pb-2 text-[13px] text-sub"><input type="checkbox" checked={trustedOnly} onChange={(e) => setTrustedOnly(e.target.checked)} className="size-3.5" />Trusted only</label>
      </div>

      {(data.pending ?? 0) > 0 && (
        <div className="card mt-4 flex items-center gap-3 border-amber/30 bg-amber-bg p-4 text-[13px] text-amber">
          <Loader2 className="size-4 animate-spin" />
          Checking fundamentals, news and Buy score for {data.pending} stocks (first time takes a few minutes; this page updates by itself).
        </div>
      )}

      <Section title={`Passes every rule (${pass.length})`} sub="Sorted by Buy score.">
        {pass.length ? table(pass, false) : (
          <div className="card p-6 text-sm text-sub">
            No stock passes all rules right now{checking.length ? ` (${checking.length} still being checked)` : ''}. That is what a strict rule set looks like: very few IPOs stay above their listing price <i>and</i> go up every period.
            Look at the near misses below, or relax one rule (for example fewer months, or the intraday-low basis → closing basis).
          </div>
        )}
      </Section>

      {checking.length > 0 && <Section title={`Being checked (${checking.length})`} sub="These pass the price rules; fundamentals / Buy score / trust are loading.">{table(checking, false)}</Section>}

      <Section title={`One rule short (${near.length})`} sub="Fail exactly one rule: the column on the right says which.">
        {near.length ? table(near, true) : <div className="card p-6 text-sm text-sub">None.</div>}
      </Section>
      <p className="max-w-4xl text-xs text-mute">
        Fundamentals come from Yahoo Finance statements (new listings often have short history, which can show "no data"). The Buy score is the same one as on Stock Analysis (business quality, valuation, trend, risk, news; MACD and structure included).
        "Trusted" = no red flag (loss-making, very high debt, governance headline, locked at lower circuit), at least ₹5 Cr traded a day, delivery ≥ 35%, no lower circuit in 12 months, news not negative, promoter holding ≥ 40% when known.
        These are rule-based filters, not a guarantee, and past monthly gains do not promise future ones.
      </p>
    </>
  )
}
