import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Link } from 'react-router'
import { Chip, ErrorBox, Loading, Section } from '../components/ui'
import { api } from '../lib/api'
import { pct, tone } from '../lib/format'

function Bar({ v, max = 0.15 }: { v: number; max?: number }) {
  const w = Math.min(Math.abs(v) / max, 1) * 50
  return (
    <div className="relative h-2 w-28 rounded bg-line">
      <div className="absolute left-1/2 top-0 h-2 w-px bg-line-strong" />
      <div
        className={clsx('absolute top-0 h-2 rounded', v >= 0 ? 'bg-pos' : 'bg-neg')}
        style={v >= 0 ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }}
      />
    </div>
  )
}

export default function Sectors() {
  const q = useQuery({ queryKey: ['latest'], queryFn: api.latest })
  if (q.isLoading) return <Loading what="sector strength" />
  if (q.error) return <ErrorBox error={q.error} />
  const run = q.data!
  const rows = [...run.sectors].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
  const themes = rows.filter((r) => r.isTheme)

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {themes.map((s) => (
          <div key={s.sector} className="card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">{s.sector}</h2>
                <Chip tone={s.sector === 'Defence' ? 'gold' : 'blue'}>priority theme</Chip>
              </div>
              <div className="text-right">
                <div className="label">Strength rank</div>
                <div className={clsx('num text-xl font-semibold', (s.rank ?? 0) >= 0.6 ? 'text-pos' : 'text-amber')}>{s.rank != null ? `${Math.round(s.rank * 100)}th pct` : '-'}</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-3 text-sm">
              {([['5d', s.ret5], ['20d', s.ret20], ['60d', s.ret60], ['20d vs Nifty', s.rs20]] as const).map(([l, v]) => (
                <div key={l}><div className="label">{l}</div><div className={clsx('num font-semibold', tone(v))}>{pct(v, 1, true)}</div></div>
              ))}
            </div>
            <p className="mt-3 text-sm text-sub">
              {(s.rank ?? 0) >= 0.6
                ? 'Sector is in its strong zone — the ranking bonus for this theme is ACTIVE.'
                : 'Sector is not in its strong zone (< 60th percentile) — the ranking bonus is OFF. Backtest: theme picks made when the sector is weak lose money.'}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-mute">Model's top names:</span>
              {s.top.map((t) => <Link key={t} to={`/stock/${t}`}><Chip tone="green">{t}</Chip></Link>)}
              <span className="ml-auto text-mute">{s.stocks} liquid stocks · {pct(s.breadth50, 0)} above 50-DMA</span>
            </div>
          </div>
        ))}
      </div>

      <Section title="All sectors ranked by 20-day strength" sub="Equal-weight basket returns of liquid stocks; rank = percentile among sectors. Bars show 20-day return vs Nifty.">
        <div className="card overflow-x-auto">
          <table className="num w-full min-w-[820px] text-sm">
            <thead className="text-left text-mute"><tr className="border-b border-line">
              {['Sector', 'Rank', '5d', '20d', '60d', '20d vs Nifty', '60d vs Nifty', 'Breadth', 'Top names'].map((h) => <th key={h} className="label px-3 py-2.5 font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.sector} className={clsx('border-b border-line', s.isTheme && 'bg-amber-bg/60')}>
                  <td className="px-3 py-2 font-medium">{s.sector}{s.isTheme && <span className="ml-2 text-amber">★</span>}</td>
                  <td className="px-3 py-2">{s.rank != null ? Math.round(s.rank * 100) : '-'}</td>
                  <td className={clsx('px-3 py-2', tone(s.ret5))}>{pct(s.ret5, 1, true)}</td>
                  <td className={clsx('px-3 py-2', tone(s.ret20))}>{pct(s.ret20, 1, true)}</td>
                  <td className={clsx('px-3 py-2', tone(s.ret60))}>{pct(s.ret60, 1, true)}</td>
                  <td className="px-3 py-2"><div className="flex items-center gap-2"><Bar v={s.rs20} /><span className={tone(s.rs20)}>{pct(s.rs20, 1, true)}</span></div></td>
                  <td className={clsx('px-3 py-2', tone(s.rs60))}>{pct(s.rs60, 1, true)}</td>
                  <td className="px-3 py-2">{pct(s.breadth50, 0)}</td>
                  <td className="px-3 py-2 text-sub">{s.top.map((t, i) => <span key={t}>{i > 0 && ', '}<Link to={`/stock/${t}`} className="hover:text-pos">{t}</Link></span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  )
}
