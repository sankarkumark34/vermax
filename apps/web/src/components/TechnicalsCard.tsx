import clsx from 'clsx'
import { inr } from '../lib/format'
import type { Technicals, TradePlan } from '../lib/types'

const d = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const TREND = { bullish: 'bg-pos-bg text-pos', bearish: 'bg-neg-bg text-neg', neutral: 'bg-soft text-sub' } as const

function Row({ k, v, cls }: { k: string; v: React.ReactNode; cls?: string }) {
  return <li className="flex justify-between gap-3"><span className="text-sub">{k}</span><span className={clsx('num text-right text-ink', cls)}>{v}</span></li>
}

function Plan({ p, note }: { p: TradePlan; note?: string }) {
  const long = p.side === 'long'
  return (
    <div className={clsx('rounded-xl border p-4', long ? 'border-pos/25' : 'border-neg/25')}>
      <div className="mb-2 flex items-center justify-between">
        <div className={clsx('text-[13px] font-semibold', long ? 'text-pos' : 'text-neg')}>{long ? 'Long position (buy)' : 'Short position (sell)'}</div>
        <span className="rounded-md bg-soft px-2 py-0.5 text-xs font-semibold text-ink">R : R = 1 : {p.rr}</span>
      </div>
      <ul className="space-y-1.5 text-[13px]">
        <Row k="Entry (last close)" v={`₹${inr(p.entry)}`} />
        <Row k="Stop-loss" v={`₹${inr(p.stop)} (${long ? '−' : '+'}${p.riskPct}%)`} cls="text-neg" />
        <Row k={`Target (${p.rr}R)`} v={`₹${inr(p.target)} (${long ? '+' : '−'}${p.targetPct}%)`} cls="text-pos" />
      </ul>
      <p className="mt-2 text-xs text-mute">Stop: {p.stopBasis}.{note ? ` ${note}` : ''}</p>
    </div>
  )
}

export default function TechnicalsCard({ t }: { t: Technicals }) {
  const s = t.structure
  const fibRet = t.fib?.levels.filter((l) => l.kind === 'retracement') ?? []
  const fibExt = t.fib?.levels.filter((l) => l.kind === 'extension') ?? []
  return (
    <div className="card p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="label">Technical analysis</div>
        <span className="text-xs text-mute">NSE close {d(t.asOf)} · split/bonus adjusted · ATR {t.atrPct}%</span>
      </div>
      {t.signals.length > 0 && (
        <div className="mb-3 mt-2 flex flex-wrap gap-2">{t.signals.map((x) => <span key={x} className="rounded-md bg-blue-bg px-2 py-1 text-xs font-medium text-blue">{x}</span>)}</div>
      )}

      <div className="mt-3 grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-line p-4">
          <div className="mb-2 text-[13px] font-semibold text-ink">Momentum</div>
          <ul className="space-y-1.5 text-[13px]">
            <Row k="RSI (14)" v={t.rsi ?? '-'} cls={t.rsi != null && t.rsi > 70 ? 'text-neg' : t.rsi != null && t.rsi < 30 ? 'text-amber' : undefined} />
            <Row k="MACD / signal" v={`${t.macd.macd} / ${t.macd.signal}`} />
            <Row k="MACD state" v={`${t.macd.state}${t.macd.histRising ? ', strengthening' : ', weakening'}`} cls={t.macd.state === 'bullish' ? 'text-pos' : 'text-neg'} />
            <Row k="Last crossover" v={t.macd.lastCross ? `${t.macd.lastCross.dir === 'up' ? 'bullish' : 'bearish'} · ${d(t.macd.lastCross.date)} (${t.macd.lastCross.sessionsAgo}d ago)` : '-'} />
          </ul>
        </div>

        <div className="rounded-xl border border-line p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-ink">Market structure</span>
            <span className={clsx('rounded-md px-2 py-0.5 text-xs font-semibold capitalize', TREND[s.trend])}>{s.trend}</span>
          </div>
          <ul className="space-y-1.5 text-[13px]">
            <Row k="Last swing high" v={s.lastSwingHigh ? `₹${inr(s.lastSwingHigh.price)} · ${s.lastSwingHigh.label ?? 'H'} · ${d(s.lastSwingHigh.date)}` : '-'} />
            <Row k="Last swing low" v={s.lastSwingLow ? `₹${inr(s.lastSwingLow.price)} · ${s.lastSwingLow.label ?? 'L'} · ${d(s.lastSwingLow.date)}` : '-'} />
            {s.events.slice(-3).reverse().map((e) => (
              <Row key={e.date + e.dir} k={`${e.type} ${e.dir === 'up' ? '▲' : '▼'}`} v={`close beyond ₹${inr(e.level)} · ${d(e.date)}`} cls={e.dir === 'up' ? 'text-pos' : 'text-neg'} />
            ))}
          </ul>
          <p className="mt-2 text-xs text-mute">BOS = trend continues past the last swing; CHoCH = first break against the trend (possible reversal). Swing = 3 lower bars each side.</p>
        </div>

        <div className="rounded-xl border border-line p-4">
          <div className="mb-2 text-[13px] font-semibold text-ink">Fibonacci {t.fib ? `(${t.fib.dir}-leg)` : ''}</div>
          {t.fib ? (
            <>
              <p className="mb-2 text-xs text-sub">₹{inr(t.fib.from.price)} ({d(t.fib.from.date)}) → ₹{inr(t.fib.to.price)} ({d(t.fib.to.date)}) · {t.fib.zone}</p>
              <div className="grid grid-cols-2 gap-x-4 text-[12.5px]">
                <ul className="space-y-1">{fibRet.map((l) => <Row key={l.ratio} k={`${(l.ratio * 100).toFixed(1)}%`} v={`₹${inr(l.price)}`} cls={l.ratio === 0.618 || l.ratio === 0.5 ? 'font-semibold' : undefined} />)}</ul>
                <ul className="space-y-1">{fibExt.map((l) => <Row key={l.ratio} k={`ext ${l.ratio}`} v={`₹${inr(l.price)}`} />)}</ul>
              </div>
            </>
          ) : <p className="text-[13px] text-mute">Not enough history.</p>}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Plan p={t.plans.long} />
        <Plan p={t.plans.short} note="Shown for reference: overnight shorts are only possible in F&O stocks (futures/options); Vermax picks are long-only." />
        <div className="rounded-xl border border-line p-4">
          <div className="mb-2 text-[13px] font-semibold text-ink">Fair value gaps (unfilled)</div>
          {t.fvgs.length ? (
            <ul className="space-y-1.5 text-[13px]">
              {t.fvgs.slice().reverse().map((g) => (
                <Row key={g.date + g.dir} k={`${g.dir === 'bull' ? 'Bullish' : 'Bearish'} · ${d(g.date)}`} v={`₹${inr(g.bottom)}–${inr(g.top)} (${g.sizePct}%)${g.touched ? ' · tested' : ''}`} cls={g.dir === 'bull' ? 'text-pos' : 'text-neg'} />
              ))}
            </ul>
          ) : <p className="text-[13px] text-mute">No open gaps in the last 60 sessions.</p>}
          <p className="mt-2 text-xs text-mute">3-candle imbalance ≥ 0.3%; removed once a close passes through it.</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-mute">These are rule-based readings for your own judgement. Vermax's daily picks still come from the backtested model; these studies are only added to it if they improve the walk-forward test.</p>
    </div>
  )
}
