import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import PickCard, { type Settings } from '../components/PickCard'
import { Chip, ErrorBox, Loading, Section } from '../components/ui'
import { api } from '../lib/api'
import { dateLabel, inr0, pct, tone } from '../lib/format'

const KEY = 'vermax.settings.v2' // v2: default risk lowered to 0.5%
const defaults: Settings = { capital: 500000, riskPct: 0.005 }

function useSettings() {
  const [s, setS] = useState<Settings>(() => {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { return defaults }
  })
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode */ } }, [s])
  return [s, setS] as const
}

function Metric({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="min-w-[110px]">
      <div className="label">{label}</div>
      <div className={`num mt-1 text-[17px] font-semibold leading-none ${cls ?? 'text-ink'}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-mute">{sub}</div>}
    </div>
  )
}

export default function Today() {
  const q = useQuery({ queryKey: ['latest'], queryFn: api.latest })
  const [settings, setSettings] = useSettings()
  if (q.isLoading) return <Loading what="tomorrow's picks" />
  if (q.error) return <ErrorBox error={q.error} hint="Press “Refresh picks” (top right) to run the pipeline: ingest → score → fundamentals → news." />
  const run = q.data!
  const r = run.regime
  const m = r.sizeMultiplier
  const rt = r.label === 'BULLISH' ? 'green' : r.label === 'PULLBACK' ? 'gold' : 'red'

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label">Trade plan for</div>
          <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight">{dateLabel(run.tradeDate)}</h1>
          <p className="mt-1 text-[13px] text-sub">Based on the {dateLabel(run.asOf)} close · {run.universe.liquidStocks} liquid stocks ranked · hold up to {run.config.horizonDays} days</p>
        </div>
        <Chip tone="gold">★ Defence &amp; Engineering priority</Chip>
      </div>

      <div className="card mt-5 grid gap-6 p-5 lg:grid-cols-[1fr_auto]">
        <div>
          <div className="mb-3 flex items-center gap-2"><span className="label">Market</span><Chip tone={rt}>{r.label === 'DEFENSIVE' ? 'Defensive' : r.label === 'PULLBACK' ? 'Pullback' : 'Bullish'}</Chip></div>
          <div className="flex flex-wrap gap-x-8 gap-y-4">
            <Metric label="Nifty vs 200-DMA" value={pct(r.niftyVs200dma, 1, true)} cls={tone(r.niftyVs200dma)} />
            <Metric label="Nifty vs 50-DMA" value={pct(r.niftyVs50dma, 1, true)} cls={tone(r.niftyVs50dma)} />
            <Metric label="India VIX" value={r.vix.toFixed(1)} />
            <Metric label="Stocks > 50-DMA" value={pct(r.breadth50, 0)} />
            <Metric label="Position size" value={`${m}×`} sub={m < 1 ? 'reduced' : 'normal'} />
          </div>
          {m < 1 && <p className="mt-3 text-xs text-mute">{r.note}</p>}
        </div>
        <div className="flex items-end gap-3 border-t border-line pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <label className="text-xs text-sub">Capital (₹)
            <input type="number" min={10000} step={10000} value={settings.capital} onChange={(e) => setSettings({ ...settings, capital: Number(e.target.value) || 0 })} className="num mt-1 block w-32" />
          </label>
          <label className="text-xs text-sub">Risk / trade (%)
            <input type="number" min={0.25} max={3} step={0.25} value={settings.riskPct * 100} onChange={(e) => setSettings({ ...settings, riskPct: (Number(e.target.value) || 1) / 100 })} className="num mt-1 block w-24" />
          </label>
        </div>
      </div>
      <p className="mt-2 text-xs text-mute">Max 5 open positions ≈ ₹{inr0(settings.capital * settings.riskPct * m * 5)} at risk in total.</p>

      <Section title="Top picks" sub={`₹${run.universe.priceBand[0]}–${run.universe.priceBand[1]} price band · every pick is up over the last 2 weeks, after fundamentals and news checks`}>
        {run.core.length === 0 ? <div className="card p-6 text-sm text-sub">No qualifying picks today. Standing aside is a valid position.</div> : (
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {run.core.map((p, i) => <PickCard key={p.symbol} p={p} index={i + 1} settings={settings} multiplier={m} />)}
          </div>
        )}
      </Section>

      <Section title="Defence &amp; Engineering" sub={`Best-scoring stocks in your priority themes, within the same ₹${run.universe.priceBand[0]}–${run.universe.priceBand[1]} price band.`}>
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {run.theme.map((p, i) => <PickCard key={p.symbol} p={p} index={i + 1} settings={settings} multiplier={m} />)}
        </div>
      </Section>

      {run.rejected.length > 0 && (
        <Section title="Filtered out" sub="High model score, rejected on fundamentals or news.">
          <div className="card divide-y divide-line">
            {run.rejected.map((p) => (
              <div key={p.symbol} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-[13px]">
                <span className="w-28 font-semibold">{p.symbol}</span>
                <span className="text-mute">{p.sector}</span>
                <span className="text-sub">{p.rejectReasons.join(' · ')}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <p className="mt-10 max-w-3xl text-xs leading-relaxed text-mute">{run.disclaimer}</p>
    </>
  )
}
