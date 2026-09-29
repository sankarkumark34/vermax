import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ErrorBox, Loading, Section } from '../components/ui'
import { api } from '../lib/api'
import { tone } from '../lib/format'

const axis = { stroke: '#4b5b7c', fontSize: 11 }
const tip = { contentStyle: { background: '#0d1424', border: '1px solid #1e2a44', borderRadius: 8, fontSize: 12 }, cursor: { fill: 'rgba(255,255,255,0.04)' } }

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
      <div className="card border-amber-400/25 p-5">
        <h1 className="text-lg font-semibold">What the data says — honestly</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Out-of-sample walk-forward {p.window[0]} → {p.window[1]}, {p.costsRoundTripPct}% round-trip costs. The model <b>ranks stocks better than chance every year</b>,
          but the money edge per trade is thin. A steady +5–12% <i>every week</i> is not achievable by this or any system — the portfolio hit ≥ +5% in about
          {' '}{pub['wk>=5%']}% of weeks and lost ≥ 3% in {pub['wk<=-3%']}% of weeks. Use it for small, controlled-risk trades and let the live journal confirm it.
        </p>
      </div>

      <Section title="Strategy comparison (net of costs)" sub="All rows use the same published trade plan; only the stock selection differs.">
        <div className="card overflow-x-auto">
          <table className="num w-full min-w-[860px] text-sm">
            <thead><tr className="border-b border-line text-left">
              {['Strategy', 'Trades', 'Positive', 'Expectancy', 'Profit factor', 'CAGR', 'Max DD', 'Weeks ≥ +5%', 'Weeks ≤ −3%'].map((h) => <th key={h} className="label px-3 py-2.5 font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {p.variants.map((v) => (
                <tr key={v.name} className={clsx('border-b border-line/50', v.name.includes('(published)') && 'bg-emerald-400/[0.06]')}>
                  <td className="px-3 py-2 font-medium">{v.name}</td>
                  <td className="px-3 py-2">{v.n}</td>
                  <td className="px-3 py-2">{v['pos%']}%</td>
                  <td className={clsx('px-3 py-2', tone(v['exp%']))}>{v['exp%'] > 0 ? '+' : ''}{v['exp%']}%</td>
                  <td className="px-3 py-2">{v.PF}</td>
                  <td className={clsx('px-3 py-2', tone(v['CAGR%']))}>{v['CAGR%']}%</td>
                  <td className="px-3 py-2 text-rose-300">{v['maxDD%']}%</td>
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
            <ResponsiveContainer><BarChart data={years}><CartesianGrid stroke="#1a2540" vertical={false} /><XAxis dataKey="y" {...axis} /><YAxis {...axis} /><Tooltip {...tip} />
              <Bar dataKey="v" radius={[4, 4, 0, 0]}>{years.map((d) => <Cell key={d.y} fill={d.v >= 0 ? '#34d399' : '#fb7185'} />)}</Bar></BarChart></ResponsiveContainer>
          </div>
        </Section>
        <Section title="Ranking skill: rank-IC by year">
          <div className="card h-64 p-3">
            <ResponsiveContainer><BarChart data={ic}><CartesianGrid stroke="#1a2540" vertical={false} /><XAxis dataKey="y" {...axis} /><YAxis {...axis} /><Tooltip {...tip} />
              <Bar dataKey="v" fill="#60a5fa" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
          </div>
        </Section>
        <Section title="Avg 10-day return by score decile (%)">
          <div className="card h-64 p-3">
            <ResponsiveContainer><BarChart data={p.deciles}><CartesianGrid stroke="#1a2540" vertical={false} /><XAxis dataKey="decile" {...axis} /><YAxis {...axis} /><Tooltip {...tip} />
              <Bar dataKey="avgFwdPct" fill="#f5b942" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
          </div>
        </Section>
      </div>

      <Section title="Trade plan that was simulated">
        <div className="card grid gap-3 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[['Entry', p.plan.entry], ['Stop', p.plan.stop], ['Target 1', p.plan.t1], ['Target 2 / time', `${p.plan.t2}; exit by day ${p.plan.timeStopDays}`]].map(([k, v]) => (
            <div key={k}><div className="label">{k}</div><div className="mt-0.5 text-slate-200">{v}</div></div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Caveats: the Defence/Engineering tilt weight was chosen after viewing these out-of-sample results, and the theme name-lists use today's knowledge (survivorship). Fundamentals and news are live overlays that are not in the backtest. Full write-up: docs/BACKTEST.md.
        </p>
      </Section>
    </>
  )
}
