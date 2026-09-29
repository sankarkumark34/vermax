import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Shield } from 'lucide-react'
import { useEffect, useState } from 'react'
import PickCard, { type Settings } from '../components/PickCard'
import { Chip, ErrorBox, Loading, Section, Stat } from '../components/ui'
import { api } from '../lib/api'
import { dateLabel, inr0, pct, tone } from '../lib/format'
import type { Regime } from '../lib/types'

const KEY = 'vermax.settings'
const defaults: Settings = { capital: 500000, riskPct: 0.01 }

function useSettings() {
  const [s, setS] = useState<Settings>(() => {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { return defaults }
  })
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode */ } }, [s])
  return [s, setS] as const
}

function RegimeCard({ r }: { r: Regime }) {
  const t = r.label === 'BULLISH' ? 'green' : r.label === 'PULLBACK' ? 'gold' : 'red'
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="label">Market regime</div>
        <Chip tone={t}>{r.label}</Chip>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Stat label="Nifty vs 50-DMA" value={pct(r.niftyVs50dma, 1, true)} tone={tone(r.niftyVs50dma)} />
        <Stat label="Nifty vs 200-DMA" value={pct(r.niftyVs200dma, 1, true)} tone={tone(r.niftyVs200dma)} />
        <Stat label="India VIX" value={r.vix.toFixed(1)} sub={`${Math.round(r.vixPercentile * 100)}th pct (1y)`} />
        <Stat label="Breadth >50-DMA" value={pct(r.breadth50, 0)} sub={`>200-DMA ${pct(r.breadth200, 0)}`} />
      </div>
      <p className="mt-3 flex gap-2 text-xs text-slate-400"><Shield className="mt-0.5 size-3.5 shrink-0" /> {r.note} Size multiplier <b className="text-slate-200">{r.sizeMultiplier}×</b>.</p>
    </div>
  )
}

export default function Today() {
  const q = useQuery({ queryKey: ['latest'], queryFn: api.latest })
  const [settings, setSettings] = useSettings()
  if (q.isLoading) return <Loading what="tomorrow's picks" />
  if (q.error) return <ErrorBox error={q.error} hint="Press “Refresh picks” (top right) to run the pipeline: ingest → score → fundamentals → news." />
  const run = q.data!
  const m = run.regime.sizeMultiplier

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr_1fr]">
        <div className="card flex flex-col justify-between p-5">
          <div>
            <div className="label">Plan for the next session</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{dateLabel(run.tradeDate)}</h1>
            <p className="mt-1 text-sm text-slate-400">
              Signals from the <b className="text-slate-200">{dateLabel(run.asOf)}</b> close · {run.universe.liquidStocks} liquid stocks ranked · model trained to {run.model.trainedTo}.
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <Chip tone="gold">Defence & Engineering priority ON</Chip>
            <Chip>Max hold {run.config.horizonDays} days</Chip>
            <Chip>Max {run.config.sectorCap}/sector</Chip>
          </div>
        </div>
        <RegimeCard r={run.regime} />
        <div className="card p-4">
          <div className="label mb-3">Position calculator</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-400">Capital (₹)
              <input type="number" min={10000} step={10000} value={settings.capital} onChange={(e) => setSettings({ ...settings, capital: Number(e.target.value) || 0 })} className="num mt-1 w-full" />
            </label>
            <label className="text-xs text-slate-400">Risk per trade (%)
              <input type="number" min={0.25} max={3} step={0.25} value={settings.riskPct * 100} onChange={(e) => setSettings({ ...settings, riskPct: (Number(e.target.value) || 1) / 100 })} className="num mt-1 w-full" />
            </label>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Quantity = risk ÷ stop distance (max 20% of capital per stock), × {m} regime multiplier. Max 5 open positions ≈ {Math.round(settings.riskPct * m * 5 * 1000) / 10}% of capital at risk (₹{inr0(settings.capital * settings.riskPct * m * 5)}).
          </p>
        </div>
      </div>

      <Section title={`Top picks · ₹${run.universe.priceBand[0]}–${run.universe.priceBand[1]} band`} sub="Highest model score after fundamentals & news vetoes. Defence/Engineering names in strong sectors get a ranking bonus.">
        {run.core.length === 0 ? <div className="card p-6 text-sm text-slate-400">No qualifying picks today. Standing aside is a valid position.</div> : (
          <div className="grid gap-4 lg:grid-cols-2">
            {run.core.map((p, i) => <PickCard key={p.symbol} p={p} index={i + 1} settings={settings} multiplier={m} />)}
          </div>
        )}
      </Section>

      <Section title="Defence & Engineering priority list" sub="Best-scoring stocks in your priority themes, regardless of price band (higher-priced names need a larger account for a sensible position).">
        <div className="grid gap-4 lg:grid-cols-2">
          {run.theme.map((p, i) => <PickCard key={p.symbol} p={p} index={i + 1} settings={settings} multiplier={m} />)}
        </div>
      </Section>

      {run.rejected.length > 0 && (
        <Section title="Vetoed by the overlays" sub="High model score but rejected on fundamentals or news red flags.">
          <div className="card divide-y divide-line/70">
            {run.rejected.map((p) => (
              <div key={p.symbol} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <AlertTriangle className="size-4 text-amber-400" />
                <span className="font-medium">{p.symbol}</span>
                <span className="text-slate-500">{p.sector}</span>
                <span className="text-slate-400">{p.rejectReasons.join(' · ')}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <p className="mt-10 text-xs leading-relaxed text-slate-500">{run.disclaimer}</p>
    </>
  )
}
