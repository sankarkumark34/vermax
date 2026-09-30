import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { inr, pct, tone } from '../lib/format'
import type { Bar as PriceBar } from '../lib/types'

// Session-based short horizons; month horizons are CALENDAR months (same convention as Google Finance).
const RANGES = [
  { k: '5D', n: 5 }, { k: '10D', n: 10 }, { k: '20D', n: 20 }, { k: '1M', m: 1 },
  { k: '3M', m: 3 }, { k: '6M', m: 6 }, { k: '1Y', m: 12 },
] as const
const RETURNS = [{ k: '1D', n: 1 }, { k: '5D', n: 5 }, { k: '10D', n: 10 }, { k: '20D', n: 20 }, { k: '1M', m: 1 }, { k: '3M', m: 3 }] as const
type Span = { n?: number; m?: number }

function ema(values: number[], span: number): number[] {
  const a = 2 / (span + 1)
  const out: number[] = []
  values.forEach((v, i) => out.push(i === 0 ? v : v * a + out[i - 1] * (1 - a)))
  return out
}
function sma(values: number[], n: number): (number | null)[] {
  return values.map((_, i) => (i + 1 < n ? null : values.slice(i + 1 - n, i + 1).reduce((s, x) => s + x, 0) / n))
}

export default function PriceChart({ bars }: { bars: PriceBar[] }) {
  const [range, setRange] = useState<(typeof RANGES)[number]['k']>('1M')
  const [show, setShow] = useState({ ema20: true, ema50: false, sma200: false, volume: true })

  const all = useMemo(() => {
    const c = bars.map((b) => b.close)
    const e20 = ema(c, 20), e50 = ema(c, 50), s200 = sma(c, 200)
    return bars.map((b, i) => ({ date: b.date, close: b.close, volume: b.volume, ema20: e20[i], ema50: e50[i], sma200: s200[i] }))
  }, [bars])

  // index of the reference bar: N sessions back, or the first close on/after the same date M calendar months ago
  const refIndex = (span: Span) => {
    if (span.n != null) return Math.max(0, all.length - 1 - span.n)
    const d = new Date(`${all.at(-1)!.date}T00:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() - (span.m ?? 1))
    const cut = d.toISOString().slice(0, 10)
    const idx = all.findIndex((b) => b.date >= cut)
    return idx < 0 ? all.length - 1 : idx
  }
  const data = all.slice(refIndex(RANGES.find((r) => r.k === range)!))
  const first = data[0]?.close ?? 0
  const last = data.at(-1)?.close ?? 0
  const chg = first ? last / first - 1 : 0
  const lo = Math.min(...data.map((d) => d.close)), hi = Math.max(...data.map((d) => d.close))
  const up = chg >= 0
  const line = up ? '#0a7a52' : '#b3261e'
  const maxVol = Math.max(...data.map((d) => d.volume), 1)

  return (
    <div className="card p-5">
      <div className="label mb-2">Returns to the NSE close of {all.at(-1)?.date} · 5D/10D/20D = sessions, 1M+ = calendar months</div>
      <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
        {RETURNS.map((h) => {
          const k = h.k
          const ref = all[refIndex(h)]?.close
          const r = ref ? (all.at(-1)!.close / ref - 1) : null
          const target = RANGES.find((x) => x.k === k)?.k ?? '5D'
          return (
            <button key={k} onClick={() => target && setRange(target)} className="rounded-lg border border-line bg-soft px-3 py-2 text-left transition hover:border-line-strong">
              <div className="label">{k}</div>
              <div className={clsx('num mt-1 text-[15px] font-semibold', tone(r))}>{pct(r, 1, true)}</div>
            </button>
          )
        })}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-soft p-1">
          {RANGES.map((r) => (
            <button key={r.k} onClick={() => setRange(r.k)} className={clsx('rounded-md px-3 py-1 text-[13px] font-medium transition', range === r.k ? 'bg-surface text-brand shadow-sm' : 'text-sub hover:text-ink')}>{r.k}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[13px] text-sub">
          {([['ema20', 'EMA 20', '#b8791a'], ['ema50', 'EMA 50', '#1c4f94'], ['sma200', 'DMA 200', '#6b3fa0'], ['volume', 'Volume', '#8492a6']] as const).map(([k, label, color]) => (
            <label key={k} className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} className="size-3.5" style={{ accentColor: color }} />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px]">
        <span className={clsx('num text-[15px] font-semibold', tone(chg))}>{pct(chg, 2, true)} <span className="font-normal text-mute">over {range}</span></span>
        <span className="num text-sub">High ₹{inr(hi)}</span>
        <span className="num text-sub">Low ₹{inr(lo)}</span>
      </div>

      <div className="h-80">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ left: 0, right: 8, top: 6 }}>
            <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={line} stopOpacity={0.16} /><stop offset="100%" stopColor={line} stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid stroke="#eef1f6" vertical={false} />
            <XAxis dataKey="date" stroke="#8492a6" fontSize={11} minTickGap={36} tickFormatter={(d: string) => d.slice(5)} />
            <YAxis yAxisId="p" stroke="#8492a6" fontSize={11} domain={[(m: number) => m * 0.985, (m: number) => m * 1.015]} width={56} tickFormatter={(v: number) => v.toFixed(0)} />
            <YAxis yAxisId="v" orientation="right" hide domain={[0, maxVol * 5]} />
            <Tooltip
              contentStyle={{ background: '#fff', border: '1px solid #e4e8ef', borderRadius: 8, fontSize: 12 }}
              formatter={(v, name) => [name === 'volume' ? Number(v).toLocaleString('en-IN') : `₹${inr(Number(v))}`, String(name)]}
            />
            {show.volume && <Bar isAnimationActive={false} yAxisId="v" dataKey="volume" fill="#cfd6e2" radius={[2, 2, 0, 0]} />}
            <Area isAnimationActive={false} yAxisId="p" dataKey="close" stroke={line} strokeWidth={2} fill="url(#pg)" dot={data.length <= 12} />
            {show.ema20 && <Line isAnimationActive={false} yAxisId="p" dataKey="ema20" stroke="#b8791a" strokeWidth={1.4} dot={false} />}
            {show.ema50 && <Line isAnimationActive={false} yAxisId="p" dataKey="ema50" stroke="#1c4f94" strokeWidth={1.4} dot={false} />}
            {show.sma200 && <Line isAnimationActive={false} yAxisId="p" dataKey="sma200" stroke="#6b3fa0" strokeWidth={1.4} dot={false} connectNulls />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
