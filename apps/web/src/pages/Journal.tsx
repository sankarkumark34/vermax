import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { RefreshCw } from 'lucide-react'
import { Link } from 'react-router'
import { Chip, ErrorBox, Loading, Section, Stat } from '../components/ui'
import { api } from '../lib/api'
import { inr, pct, tone } from '../lib/format'

export default function Journal() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['journal'], queryFn: api.journal })
  const refresh = useMutation({ mutationFn: api.journalRefresh, onSuccess: () => qc.invalidateQueries({ queryKey: ['journal'] }) })
  if (q.isLoading) return <Loading what="journal" />
  if (q.error) return <ErrorBox error={q.error} />
  const { stats, picks } = q.data!

  return (
    <>
      <div className="card grid grid-cols-2 gap-5 p-5 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Closed trades" value={stats.closed} sub={`${stats.open} open · ${stats.skipped} skipped`} />
        <Stat label="Win rate" value={stats.winRate != null ? `${stats.winRate}%` : '-'} />
        <Stat label="Expectancy / trade" value={stats.expectancyPct != null ? `${stats.expectancyPct > 0 ? '+' : ''}${stats.expectancyPct}%` : '-'} tone={tone(stats.expectancyPct)} sub="net of costs" />
        <Stat label="Profit factor" value={stats.profitFactor ?? '-'} />
        <Stat label="Avg win / loss" value={stats.avgWinPct != null ? `${stats.avgWinPct}% / ${stats.avgLossPct ?? '-'}%` : '-'} />
        <Stat label="Avg hold" value={stats.avgHoldDays != null ? `${stats.avgHoldDays} d` : '-'} />
      </div>
      <p className="mt-2 text-xs text-mute">
        Every published pick is paper-traded with the exact published rules (buy next open unless it gaps above +2.5%, stop, 50% at T1 then breakeven, T2, day-10 exit). Judge the system on 50 or more closed trades, not a few.
      </p>

      <Section
        title="Tracked picks"
        right={<button onClick={() => refresh.mutate()} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm text-sub hover:text-ink"><RefreshCw className={clsx('size-4', refresh.isPending && 'animate-spin')} /> Update outcomes</button>}
      >
        <div className="card overflow-x-auto">
          <table className="num w-full min-w-[1000px] text-sm">
            <thead><tr className="border-b border-line text-left">
              {['Signal', 'List', 'Symbol', 'Sector', 'Entry', 'Stop', 'T1', 'T2', 'Status', 'Days', 'Net P&L', 'Exit', 'Avg LC recovery'].map((h) => <th key={h} className="label px-3 py-2.5 font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {picks.length === 0 && <tr><td colSpan={13} className="px-3 py-8 text-center text-mute">No picks tracked yet. They appear after the first pipeline run.</td></tr>}
              {picks.map((p) => (
                <tr key={p.id} className="border-b border-line">
                  <td className="px-3 py-2 text-sub">{p.asOf}</td>
                  <td className="px-3 py-2"><Chip tone={p.list === 'theme' ? 'gold' : 'default'}>{p.list}</Chip></td>
                  <td className="px-3 py-2 font-medium"><Link to={`/stock/${p.symbol}`} className="hover:text-pos">{p.symbol}</Link></td>
                  <td className="px-3 py-2 text-sub">{p.sector}</td>
                  <td className="px-3 py-2">{p.entry != null ? inr(p.entry) : `≈${inr(p.entryRef)}`}</td>
                  <td className="px-3 py-2 text-neg">{inr(p.stopNow ?? p.stop)}</td>
                  <td className={clsx('px-3 py-2', p.t1Hit ? 'text-pos' : 'text-sub')}>{inr(p.t1)}{p.t1Hit && ' ✓'}</td>
                  <td className="px-3 py-2 text-sub">{inr(p.t2)}</td>
                  <td className="px-3 py-2"><Chip tone={p.status === 'CLOSED' ? 'default' : p.status === 'OPEN' ? 'blue' : 'gold'}>{p.status}</Chip></td>
                  <td className="px-3 py-2">{p.days || '-'}</td>
                  <td className={clsx('px-3 py-2 font-medium', tone(p.netRet))}>{p.netRet != null ? pct(p.netRet, 2, true) : '-'}</td>
                  <td className="px-3 py-2 text-sub">{p.exitLabel ?? (p.status === 'OPEN' ? 'running' : '-')}</td>
                  <td className="px-3 py-2">
                    {p.circuit && p.circuit.events > 0 ? (
                      <span title={`${p.circuit.events} lower circuits since 2019 · median ${p.circuit.medianRecoveryDays ?? '-'}d · ${p.circuit.recoveredWithin10Pct ?? '-'}% back within 10d · ${p.circuit.recoveredWithin30Pct ?? '-'}% within 30d`}>
                        <b className="font-semibold text-ink">{p.circuit.meanRecoveryDays != null ? `${p.circuit.meanRecoveryDays}d` : 'n/a'}</b>
                        <span className="ml-1 text-xs text-mute">({p.circuit.events} LC)</span>
                      </span>
                    ) : <span className="text-mute">No LC</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  )
}
