import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ErrorBox, Loading, Section } from '../components/ui'
import { api } from '../lib/api'
import { tone } from '../lib/format'

const axis = { stroke: '#8492a6', fontSize: 11 }
const tip = { contentStyle: { background: '#ffffff', border: '1px solid #e4e8ef', borderRadius: 8, fontSize: 12 }, cursor: { fill: 'rgba(22,52,92,0.05)' } }

function ModelHealth() {
  const q = useQuery({ queryKey: ['health'], queryFn: api.health, staleTime: 30 * 60_000 })
  if (q.isLoading) return <div className="card p-5 text-sm text-mute">Checking model health…</div>
  if (q.error || !q.data) return null
  const h = q.data
  const tone2 = h.status === 'OK' ? 'bg-pos-bg text-pos' : h.status === 'WATCH' ? 'bg-amber-bg text-amber' : 'bg-neg-bg text-neg'
  const months = h.oosMonthlyIC.map((m) => ({ y: m.month.slice(2), v: m.ic }))
  return (
    <Section title="Model health" sub={`Model trained to ${h.model.trainedTo ?? '-'}. Live check compares each published ranking with what happened over the next 10 sessions.`}>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr_1.2fr]">
        <div className="card p-5">
          <span className={clsx('rounded-md px-2.5 py-1 text-sm font-semibold', tone2)}>{h.status}</span>
          <ul className="mt-3 space-y-1 text-[13px] text-sub">
            {h.reasons.length ? h.reasons.map((r) => <li key={r}>• {r}</li>) : <li>No warning signs: ranking skill positive recently and inputs within their historical range.</li>}
          </ul>
          <div className="mt-4 text-[13px] text-sub">Live runs scored: <b className="text-ink">{h.liveRunsScored}</b>{h.liveICMean != null && <> · live IC <b className={tone(h.liveICMean)}>{h.liveICMean.toFixed(3)}</b></>}</div>
          {h.liveRunsScored < 20 && <p className="mt-1 text-xs text-mute">Needs about 20 published runs that are 10+ sessions old before the live number means much.</p>}
        </div>
        <div className="card h-56 p-3">
          <div className="label px-2 pt-1">Out-of-sample rank-IC by month</div>
          <ResponsiveContainer height="88%"><BarChart data={months}><CartesianGrid stroke="#e4e8ef" vertical={false} /><XAxis dataKey="y" {...axis} /><YAxis {...axis} /><Tooltip {...tip} />
            <Bar dataKey="v" radius={[3, 3, 0, 0]}>{months.map((d) => <Cell key={d.y} fill={d.v >= 0 ? '#1c4f94' : '#b3261e'} />)}</Bar></BarChart></ResponsiveContainer>
        </div>
        <div className="card p-4">
          <div className="label mb-2">Input drift (top features)</div>
          <ul className="space-y-1 text-[12.5px]">
            {h.drift.map((d) => (
              <li key={d.feature} className="flex justify-between gap-2">
                <span className="text-sub">{d.feature}</span>
                <span className={clsx('num', d.level === 'high' ? 'text-neg' : d.level === 'moderate' ? 'text-amber' : 'text-pos')}>
                  {d.kind === 'context' ? `${Math.round((d.percentile ?? 0) * 100)}th pct` : `PSI ${d.psi?.toFixed(2)}`} · {d.level}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  )
}

export default function Performance() {
  const q = useQuery({ queryKey: ['perf'], queryFn: api.performance })
  if (q.isLoading) return <Loading what="backtest" />
  if (q.error) return <ErrorBox error={q.error} hint="Run `python -m vermax.report` in the ml/ folder to generate the backtest summary." />
  const p = q.data!
  const pub = p.variants.find((v) => v.name.includes('(published)')) ?? p.variants[0]
  const years = Object.entries(pub.yearly).map(([y, v]) => ({ y, v }))
  const ic = Object.entries(p.ic).map(([y, v]) => ({ y, v: v.meanIC }))

  return (
    <>
      <div className="card border-amber/30 p-5">
        <h1 className="text-lg font-semibold">What the data says — honestly</h1>
        <p className="mt-2 text-sm leading-relaxed text-sub">
          Out-of-sample walk-forward {p.window[0]} → {p.window[1]}, {p.costsRoundTripPct}% round-trip costs. The model <b>ranks stocks better than chance every year</b>,
          but the money edge per trade is thin. A steady +5–12% <i>every week</i> is not achievable by this or any system — the portfolio hit ≥ +5% in about
          {' '}{pub['wk>=5%']}% of weeks and lost ≥ 3% in {pub['wk<=-3%']}% of weeks. Use it for small, controlled-risk trades and let the live journal confirm it.
        </p>
      </div>

      <ModelHealth />

      <Section title="Strategy comparison (net of costs)" sub="All rows use the same published trade plan; only the stock selection differs.">
        <div className="card overflow-x-auto">
          <table className="num w-full min-w-[860px] text-sm">
            <thead><tr className="border-b border-line text-left">
              {['Strategy', 'Trades', 'Positive', 'Expectancy', 'Profit factor', 'CAGR', 'Max DD', 'Weeks ≥ +5%', 'Weeks ≤ −3%'].map((h) => <th key={h} className="label px-3 py-2.5 font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {p.variants.map((v) => (
                <tr key={v.name} className={clsx('border-b border-line', v.name.includes('(published)') && 'bg-pos-bg/60')}>
                  <td className="px-3 py-2 font-medium">{v.name}</td>
                  <td className="px-3 py-2">{v.n}</td>
                  <td className="px-3 py-2">{v['pos%']}%</td>
                  <td className={clsx('px-3 py-2', tone(v['exp%']))}>{v['exp%'] > 0 ? '+' : ''}{v['exp%']}%</td>
                  <td className="px-3 py-2">{v.PF}</td>
                  <td className={clsx('px-3 py-2', tone(v['CAGR%']))}>{v['CAGR%']}%</td>
                  <td className="px-3 py-2 text-neg">{v['maxDD%']}%</td>
                  <td className="px-3 py-2">{v['wk>=5%']}%</td>
                  <td className="px-3 py-2">{v['wk<=-3%']}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Published strategy: return by year (%)">
          <div className="card h-64 p-3">
            <ResponsiveContainer><BarChart data={years}><CartesianGrid stroke="#e4e8ef" vertical={false} /><XAxis dataKey="y" {...axis} /><YAxis {...axis} /><Tooltip {...tip} />
              <Bar dataKey="v" radius={[4, 4, 0, 0]}>{years.map((d) => <Cell key={d.y} fill={d.v >= 0 ? '#0a7a52' : '#b3261e'} />)}</Bar></BarChart></ResponsiveContainer>
          </div>
        </Section>
        <Section title="Ranking skill: rank-IC by year">
          <div className="card h-64 p-3">
            <ResponsiveContainer><BarChart data={ic}><CartesianGrid stroke="#e4e8ef" vertical={false} /><XAxis dataKey="y" {...axis} /><YAxis {...axis} /><Tooltip {...tip} />
              <Bar dataKey="v" fill="#1c4f94" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
          </div>
        </Section>
        <Section title="Avg 10-day return by score decile (%)">
          <div className="card h-64 p-3">
            <ResponsiveContainer><BarChart data={p.deciles}><CartesianGrid stroke="#e4e8ef" vertical={false} /><XAxis dataKey="decile" {...axis} /><YAxis {...axis} /><Tooltip {...tip} />
              <Bar dataKey="avgFwdPct" fill="#b8791a" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
          </div>
        </Section>
      </div>

      <Section title="Trade plan that was simulated">
        <div className="card grid gap-3 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[['Entry', p.plan.entry], ['Stop', p.plan.stop], ['Target 1', p.plan.t1], ['Target 2 / time', `${p.plan.t2}; exit by day ${p.plan.timeStopDays}`]].map(([k, v]) => (
            <div key={k}><div className="label">{k}</div><div className="mt-0.5 text-ink">{v}</div></div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-mute">
          Caveats: the Defence/Engineering tilt weight was chosen after viewing these out-of-sample results, and the theme name-lists use today's knowledge (survivorship). Fundamentals and news are live overlays that are not in the backtest. Full write-up: docs/BACKTEST.md.
        </p>
      </Section>
    </>
  )
}
