import { useQuery } from '@tanstack/react-query'
import { Crown } from 'lucide-react'
import { useEffect, useState } from 'react'
import PickCard, { type Settings } from '../components/PickCard'
import { Chip, ErrorBox, Loading, Section, Stat } from '../components/ui'
import { api } from '../lib/api'
import { dateLabel, tone } from '../lib/format'

const KEY = 'vermax.settings'

function useSettings(): Settings {
  const [s, setS] = useState<Settings>({ capital: 500000, riskPct: 0.01 })
  useEffect(() => { try { setS((p) => ({ ...p, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') })) } catch { /* ignore */ } }, [])
  return s
}

const RULES = [
  'Price between ₹200 and ₹650',
  'Uptrend: above 50-EMA and 200-DMA',
  'Up over the last 2 weeks and 20 days',
  'Its sector is in the top 40% by strength',
  'Highest model score (Defence/Engineering get a bonus)',
  'Fundamentals rated PASS (ROE, debt, growth, cash-flow)',
  'No negative news / red-flag headlines',
]

export default function Elite() {
  const q = useQuery({ queryKey: ['latest'], queryFn: api.latest })
  const perf = useQuery({ queryKey: ['perf'], queryFn: api.performance })
  const settings = useSettings()
  if (q.isLoading) return <Loading what="elite picks" />
  if (q.error) return <ErrorBox error={q.error} />
  const run = q.data!
  const elite = run.elite ?? []
  const st = perf.data?.elite?.elite

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-amber"><Crown className="size-4" /><span className="label !text-amber">Elite · stocks of the week</span></div>
          <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight">Top 3 for {dateLabel(run.tradeDate)}</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-sub">Only stocks that pass every check below. If fewer than three qualify, fewer are shown — quality over quantity.</p>
        </div>
        <Chip tone="gold">{run.regime.label === 'DEFENSIVE' ? 'Defensive market · half size' : 'Normal size'}</Chip>
      </div>

      <div className="card mt-5 p-5">
        <div className="label mb-3">Every Elite pick must satisfy</div>
        <ul className="grid gap-x-8 gap-y-2 text-[13.5px] text-ink sm:grid-cols-2">
          {RULES.map((r) => <li key={r} className="flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-pos" />{r}</li>)}
        </ul>
      </div>

      <Section title="This week's Elite picks">
        {elite.length === 0 ? (
          <div className="card p-8 text-center">
            <div className="text-[15px] font-semibold">No stock passes all Elite checks right now</div>
            <p className="mt-1 text-sm text-sub">Standing aside is a valid position. Check again after the next market close, or press Refresh picks if this run predates the Elite tab.</p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {elite.map((p, i) => <PickCard key={p.symbol} p={p} index={i + 1} settings={settings} multiplier={run.regime.sizeMultiplier} />)}
          </div>
        )}
      </Section>

      {st && (
        <Section title="What to realistically expect" sub={`Backtest of this exact rule, ${perf.data!.window[0]} → ${perf.data!.window[1]}, ${st.weeks} weeks, after costs. No filter makes a trade certain.`}>
          <div className="card grid grid-cols-2 gap-6 p-5 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Reach Target 1" value={`${st.t1HitPct}%`} sub="per pick" />
            <Stat label="Stopped out" value={`${st.stopPct}%`} sub="per pick" />
            <Stat label="≥ 1 of 3 hits T1" value={`${st.weeksAtLeast1T1Pct}%`} sub="of weeks" />
            <Stat label="≥ 2 of 3 hit T1" value={`${st.weeksAtLeast2T1Pct}%`} sub="of weeks" />
            <Stat label="All 3 lose" value={`${st.weeksAllThreeLosePct}%`} sub="of weeks" tone="text-neg" />
            <Stat label="Avg per trade" value={`${st.expectancyPct > 0 ? '+' : ''}${st.expectancyPct}%`} tone={tone(st.expectancyPct)} sub={`win ${st.avgWinPct}% / loss ${st.avgLossPct}%`} />
          </div>
          <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-sub">
            Read this plainly: roughly <b className="text-ink">1 in 3 Elite picks reaches Target 1</b>, about half get stopped out, and in about a quarter of weeks all three lose.
            The edge is a slightly better-than-coin-flip payoff, earned over many trades — not a guarantee on any single stock. Never risk more than 1% of capital per pick.
          </p>
        </Section>
      )}
    </>
  )
}
