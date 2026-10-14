import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, ChevronDown, ChevronRight, Loader2, Minus, X } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Disclaimer, PageHead, VerdictBadge } from '../components/selection'
import { ErrorBox, Loading } from '../components/ui'
import { dateLabel, inr } from '../lib/format'
import { fetchSteady, runSteady, type PeriodRet, type SteadyRow } from '../lib/steady'
import { buyPlan } from './TopPicks'

const FUND = [{ k: 75, label: 'Strong (75+)' }, { k: 60, label: 'OK (60+)' }, { k: 0, label: 'Any' }] as const
const BUY = [{ k: 'buy', label: 'BUY (entry ready)' }, { k: 'wait', label: 'BUY or WAIT (not AVOID)' }, { k: 'any', label: 'Any' }] as const
const pctTxt = (x: number | null | undefined, d = 1) => (x == null ? 'n/a' : `${x > 0 ? '+' : ''}${x.toFixed(d)}%`)

interface Rule { key: string; label: string; pass: boolean; detail: string }

function Tick({ ok }: { ok: boolean | null }) {
  return (
    <span className={clsx('grid size-[18px] shrink-0 place-items-center rounded-full', ok == null ? 'bg-soft text-mute' : ok ? 'bg-pos-bg text-pos' : 'bg-neg-bg text-neg')}>
      {ok == null ? <Minus className="size-3" strokeWidth={3} /> : ok ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
    </span>
  )
}

function Strip({ list, title }: { list: PeriodRet[]; title: string }) {
  return (
    <div title={`${title}: ${list.map((x) => `${x.period} ${pctTxt(x.ret)}`).join(' · ')}`} className="flex flex-wrap justify-end gap-0.5">
      {list.map((x) => <span key={x.period} className={clsx('size-2.5 rounded-sm', x.ret > 0 ? 'bg-pos' : 'bg-neg')} />)}
    </div>
  )
}

export default function Steady() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['steady'], queryFn: fetchSteady, staleTime: 30_000, refetchInterval: (x) => (x.state.data?.state.running || !x.state.data?.asOf ? 5000 : false) })
  const [maxPrice, setMaxPrice] = useState(1000)
  const [win, setWin] = useState<'6' | '12'>('12')
  const [basis, setBasis] = useState<'close' | 'low'>('close')
  const [mWin, setMWin] = useState(3)
  const [qWin, setQWin] = useState(2)
  const [rsiMin, setRsiMin] = useState(40)
  const [rsiMax, setRsiMax] = useState(70)
  const [fund, setFund] = useState<number>(75)
  const [buy, setBuy] = useState<(typeof BUY)[number]['k']>('wait')
  const [trustedOnly, setTrustedOnly] = useState(true)
  const [open, setOpen] = useState<string | null>(null)

  const evaluated = useMemo(() => (q.data?.rows ?? []).map((r: SteadyRow) => {
    const f = r.steady, w = f.windows[win]
    const mSel = f.months.slice(-mWin), qSel = f.quarters.slice(-qWin)
    const minVs = basis === 'close' ? w.minClosePct : w.minLowPct
    const refName = w.fromListing ? `listing price ₹${inr(w.ref)}` : `₹${inr(w.ref)} on ${dateLabel(w.refDate)}`
    const rules: Rule[] = [
      { key: 'price', label: `Price ≤ ₹${maxPrice}`, pass: f.close <= maxPrice, detail: `₹${inr(f.close)}` },
      { key: 'ref', label: w.fromListing ? 'Never below listing price' : `Never below its price ${win} months ago`, pass: minVs >= 0,
        detail: `lowest ${basis === 'close' ? 'close' : 'low'} ${pctTxt(minVs)} vs ${refName}${w.lastBelow ? ` · last below ${dateLabel(w.lastBelow)}` : ''}` },
      { key: 'months', label: `Every month up (last ${mWin})`, pass: mSel.length >= mWin && mSel.every((x) => x.ret > 0), detail: `${mSel.filter((x) => x.ret > 0).length} of ${mSel.length} up` },
      { key: 'quarters', label: `Every quarter up (last ${qWin})`, pass: qSel.length >= qWin && qSel.every((x) => x.ret > 0), detail: `${qSel.filter((x) => x.ret > 0).length} of ${qSel.length} up` },
      { key: 'rsi', label: `RSI ${rsiMin}–${rsiMax}`, pass: f.rsi != null && f.rsi >= rsiMin && f.rsi <= rsiMax, detail: f.rsi == null ? 'n/a' : `RSI ${f.rsi}` },
      { key: 'fund', label: `Fundamentals ${fund ? `≥ ${fund}` : 'any'}`, pass: r.totalScore >= fund, detail: `score ${r.totalScore}/100 · data ${Math.round(r.coverage * 100)}%` },
      { key: 'buy', label: `Buy option (${BUY.find((b) => b.k === buy)!.label})`, pass: buy === 'any' || r.verdict === 'BUY' || (buy === 'wait' && r.verdict === 'WAIT'), detail: `${r.verdict}${r.reason ? ` · ${r.reason}` : ''}` },
      { key: 'trust', label: 'Trusted (no red-flag gate)', pass: !trustedOnly || r.gates.length === 0, detail: r.gates.length ? r.gates.join('; ') : 'no gate triggered' },
    ]
    return { r, rules, fails: rules.filter((x) => !x.pass) }
  }).sort((a, b) => (b.r.verdict === 'BUY' ? 1 : 0) - (a.r.verdict === 'BUY' ? 1 : 0) || b.r.totalScore - a.r.totalScore), [q.data, maxPrice, win, basis, mWin, qWin, rsiMin, rsiMax, fund, buy, trustedOnly])

  if (q.isLoading) return <Loading what="steady picks" />
  if (q.error) return <ErrorBox error={q.error} />
  const d = q.data!
  const st = d.state
  if (!d.asOf) {
    return (
      <div className="card p-8 text-center text-sm text-sub">
        <Loader2 className="mx-auto mb-3 size-5 animate-spin" />
        Screening every NSE stock for the first time and analysing the survivors (about 10–20 minutes). {st.step}{st.total ? ` (${st.done}/${st.total})` : ''}. This page updates by itself.
        {st.error && <p className="mt-2 text-neg">{st.error}</p>}
      </div>
    )
  }
  const pass = evaluated.filter((e) => e.fails.length === 0)
  const near = evaluated.filter((e) => e.fails.length === 1)
  const btn = (on: boolean) => clsx('rounded-md px-3 py-1 text-[13px] font-medium', on ? 'bg-surface text-brand shadow-sm' : 'text-sub hover:text-ink')
  const group = (label: string, children: React.ReactNode) => <div><div className="label mb-1.5">{label}</div><div className="flex gap-1 rounded-lg bg-soft p-1">{children}</div></div>

  const table = (items: typeof evaluated, showFail: boolean) => (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[1080px] text-[13px]">
        <thead><tr className="border-b border-line text-left">
          {['Stock', 'Price', 'Buy plan (tomorrow)', 'vs start', 'Months', 'Quarters', 'RSI', 'Fund.', 'Verdict', 'Trusted', showFail ? 'Missed' : ''].map((h, i) => <th key={h + i} className={clsx('label px-3 py-2.5 font-medium', i > 0 && i < 10 && 'text-right')}>{h}</th>)}
        </tr></thead>
        <tbody>
          {items.map(({ r, rules, fails }) => {
            const f = r.steady, w = f.windows[win], bp = buyPlan(r)
            return (
              <Fragment key={r.symbol}>
                <tr className="cursor-pointer border-b border-line/70 hover:bg-soft/60" onClick={() => setOpen(open === r.symbol ? null : r.symbol)}>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      {open === r.symbol ? <ChevronDown className="size-4 text-mute" /> : <ChevronRight className="size-4 text-mute" />}
                      <div>
                        <Link to={`/verdict/${r.symbol}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-ink hover:text-brand">{r.symbol}</Link>
                        <div className="max-w-44 truncate text-[11.5px] text-mute" title={r.name ?? ''}>{r.name}</div>
                        <div className="text-[11px] text-mute">{r.sector ?? ''}{w.fromListing ? ' · new listing' : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num px-3 py-3 text-right">₹{inr(f.close)}<div className={clsx('text-[11px]', (f.chg1 ?? 0) >= 0 ? 'text-pos' : 'text-neg')}>{pctTxt(f.chg1, 2)}</div></td>
                  <td className="num px-3 py-3 text-right text-[12px]">
                    {bp && bp.price != null ? (
                      <>
                        <div className={clsx('text-[14px] font-semibold', bp.now ? 'text-pos' : 'text-amber')}>{bp.now ? 'Buy now ₹' : 'Buy at ₹'}{inr(bp.price)}{!bp.now && <span className="text-[11px] font-normal text-mute"> or below</span>}</div>
                        {!bp.now && bp.distPct != null && <div className="text-[11px] text-mute">{bp.distPct}% from now</div>}
                        <div><span className="text-neg">SL {inr(bp.stop)}</span> · <span className="text-pos">T {inr(bp.target)}</span></div>
                        <div className="text-[11px] text-mute">R:R {bp.rr != null ? `1:${bp.rr}` : 'n/a'}</div>
                      </>
                    ) : <span className="text-mute">no clear level</span>}
                  </td>
                  <td className="num px-3 py-3 text-right"><span className={clsx(w.minClosePct >= 0 ? 'text-pos' : 'text-neg')}>{pctTxt(basis === 'close' ? w.minClosePct : w.minLowPct)}</span><div className="text-[11px] text-mute">lowest</div></td>
                  <td className="px-3 py-3"><Strip list={f.months.slice(-Math.max(mWin, 6))} title="Months" /></td>
                  <td className="px-3 py-3"><Strip list={f.quarters.slice(-Math.max(qWin, 2))} title="Quarters" /></td>
                  <td className={clsx('num px-3 py-3 text-right', f.rsi != null && f.rsi > rsiMax && 'text-neg')}>{f.rsi ?? '–'}</td>
                  <td className="num px-3 py-3 text-right">{r.totalScore}<div className="text-[11px] text-mute">{Math.round(r.coverage * 100)}% data</div></td>
                  <td className="px-3 py-3 text-right"><VerdictBadge v={r.verdict} /></td>
                  <td className="px-3 py-3"><div className="flex justify-end"><Tick ok={r.gates.length === 0} /></div></td>
                  <td className="px-3 py-3 text-xs text-neg">{showFail ? fails.map((x) => x.label).join(', ') : ''}</td>
                </tr>
                {open === r.symbol && (
                  <tr className="border-b border-line bg-soft/60">
                    <td colSpan={11} className="px-5 py-4">
                      <div className="grid gap-5 md:grid-cols-2">
                        <div>
                          <div className="label mb-2">Rules</div>
                          <ul className="space-y-1.5 text-[13px]">
                            {rules.map((x) => (
                              <li key={x.key} className="flex items-start gap-2"><Tick ok={x.pass} /><span><span className="text-ink">{x.label}</span> <span className="text-mute">· {x.detail}</span></span></li>
                            ))}
                          </ul>
                        </div>
                        <div className="space-y-2 text-[13px] text-sub">
                          <div><span className="text-ink">Why:</span> {r.reason}</div>
                          {r.technical && <div><span className="text-ink">Trend:</span> {r.technical.trend}{r.technical.patterns.length ? ` · ${r.technical.patterns.join(', ')}` : ''}{r.technical.levelReasons[0] ? ` · ${r.technical.levelReasons[0]}` : ''}</div>}
                          <div><span className="text-ink">Started:</span> {w.fromListing ? `listed ${dateLabel(f.firstDate)}` : `window began ${dateLabel(w.refDate)}`} at ₹{inr(w.ref)}; {w.sessionsBelow} closes below it; {pctTxt(f.fromHigh)} from the 52-week high.</div>
                          <div className="flex gap-3 pt-1">
                            <Link to={`/verdict/${r.symbol}`} className="font-medium text-brand hover:underline">Full verdict →</Link>
                            <Link to={`/stock/${r.symbol}`} className="font-medium text-brand hover:underline">Chart →</Link>
                          </div>
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
      <PageHead
        label="Steady picks"
        title="Never below where it started, up every month and quarter"
        sub={`Every liquid NSE stock priced ₹${d.price?.min}–${d.price?.max} that has traded at least ${d.minMonths} months. "Start" is the listing price for a stock listed inside the window, otherwise its price at the start of the window. A month or quarter is up when its close beats the previous one; the unfinished period does not count. Official NSE close of ${dateLabel(d.asOf)}.`}
        right={<button onClick={async () => { await runSteady(); qc.invalidateQueries({ queryKey: ['steady'] }) }} disabled={st.running} className="rounded-lg border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-soft disabled:opacity-60">{st.running ? 'Updating…' : 'Refresh'}</button>}
      />

      {d.funnel && (
        <div className="mb-4 flex flex-wrap gap-2 text-[12px]">
          {([['Liquid stocks ₹50–1500', d.funnel.liquid], ['Screened', d.funnel.screened], ['Near their start & RSI 30–75', d.funnel.candidates], ['Fully analysed', d.funnel.analysed]] as const).map(([k, v]) => (
            <span key={k} className="rounded-lg bg-soft px-3 py-1.5 text-sub"><b className="num text-ink">{v}</b> {k}</span>
          ))}
          <span className="rounded-lg bg-pos-bg px-3 py-1.5 text-pos"><b className="num">{pass.length}</b> pass your rules now</span>
        </div>
      )}
      {st.running && (
        <div className="card mb-4 flex items-center gap-3 border-amber/30 bg-amber-bg p-4 text-[13px] text-amber">
          <Loader2 className="size-4 animate-spin" /> Updating for the latest session: {st.step}{st.total ? ` (${st.done}/${st.total})` : ''}. Showing the previous run meanwhile.
        </div>
      )}

      <div className="card flex flex-wrap items-end gap-x-6 gap-y-4 p-5">
        {group('Max price', [1000, 1500].map((p) => <button key={p} onClick={() => setMaxPrice(p)} className={btn(maxPrice === p)}>₹{p}</button>))}
        {group('Start = price', <>
          <button onClick={() => setWin('6')} className={btn(win === '6')}>6 months ago</button>
          <button onClick={() => setWin('12')} className={btn(win === '12')}>12 months ago</button></>)}
        {group('Never below start (basis)', <>
          <button onClick={() => setBasis('close')} className={btn(basis === 'close')}>Closing price</button>
          <button onClick={() => setBasis('low')} className={btn(basis === 'low')}>Intraday low</button></>)}
        {group('Every month up', [3, 6, 12].map((m) => <button key={m} onClick={() => setMWin(m)} className={btn(mWin === m)}>last {m}</button>))}
        {group('Every quarter up', [2, 4].map((m) => <button key={m} onClick={() => setQWin(m)} className={btn(qWin === m)}>last {m}</button>))}
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

      <h2 className="mb-1 mt-7 text-[17px] font-semibold">Buy list for tomorrow · passes every rule ({pass.length})</h2>
      <p className="mb-3 text-[12.5px] text-sub">"Buy now" = the entry is confirmed at today's close, so buy at tomorrow's open if it is near that price. "Buy at … or below" = wait for the pullback level. Stop and target come from the chart structure.</p>
      {pass.length ? table(pass, false) : (
        <div className="card p-6 text-sm text-sub">
          No stock passes every rule today. That is normal for a strict rule set: few stocks stay above their start <i>and</i> rise every month and quarter <i>and</i> are not overbought <i>and</i> have strong fundamentals. Relax one rule above, or look at the near misses below.
        </div>
      )}

      <h2 className="mb-1 mt-8 text-[17px] font-semibold">One rule short ({near.length})</h2>
      <p className="mb-3 text-[12.5px] text-sub">These fail exactly one rule; the last column says which.</p>
      {near.length ? table(near, true) : <div className="card p-6 text-sm text-sub">None.</div>}

      <p className="mt-4 max-w-4xl text-xs text-mute">
        Fundamentals, verdict, trust gates and the buy plan are the 18-step analysis used on Top Picks (a stock with a red-flag gate, such as very low interest cover, high pledging or exchange surveillance, is not "trusted").
        Past monthly gains do not promise future ones; these are rule-based filters, not advice. The monthly / quarterly rules are not backtested here: Top Picks has a backtest of a similar screen.
      </p>
      <Disclaimer />
    </>
  )
}
