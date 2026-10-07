import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Disclaimer, PageHead, VerdictBadge } from '../components/selection'
import { ErrorBox, Loading } from '../components/ui'
import { inr } from '../lib/format'
import { sel } from '../lib/selection'

export default function Watchlist() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['watchlist'], queryFn: sel.watchlist })
  const [symbol, setSymbol] = useState('')
  const [alert, setAlert] = useState('')
  const add = useMutation({
    mutationFn: () => sel.watch({ symbol: symbol.trim().toUpperCase(), alertPrice: alert ? Number(alert) : undefined }),
    onSuccess: () => { setSymbol(''); setAlert(''); qc.invalidateQueries({ queryKey: ['watchlist'] }) },
  })
  const remove = useMutation({ mutationFn: sel.unwatch, onSuccess: () => qc.invalidateQueries({ queryKey: ['watchlist'] }) })
  const edit = useMutation({ mutationFn: (b: { symbol: string; alertPrice: number }) => sel.watch(b), onSuccess: () => qc.invalidateQueries({ queryKey: ['watchlist'] }) })

  return (
    <>
      <PageHead
        label="Stock selection"
        title="Watchlist"
        sub="WAIT stocks with the level at which they could become actionable. After every nightly run you get a Telegram alert when a watched stock turns BUY or closes at its alert level."
      />
      <form onSubmit={(e) => { e.preventDefault(); if (symbol.trim()) add.mutate() }} className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <label><div className="label mb-1.5">Symbol</div><input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="e.g. BEL" className="w-36 uppercase" /></label>
        <label><div className="label mb-1.5">Alert price (optional)</div><input value={alert} onChange={(e) => setAlert(e.target.value)} type="number" step="0.05" placeholder="engine watch level" className="w-44" /></label>
        <button className="rounded-lg bg-brand px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-60" disabled={add.isPending}>Add</button>
        {add.error && <span className="text-[12.5px] text-neg">{(add.error as Error).message}</span>}
      </form>
      {q.isLoading && <Loading what="watchlist" />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && q.data.length === 0 && <div className="card p-8 text-center text-sm text-sub">Nothing watched yet. Add a symbol above, or press Watch on a stock's verdict page.</div>}
      {q.data && q.data.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[860px] text-[13.5px]">
            <thead className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-mute">
              <tr><th className="px-3 py-2.5">Stock</th><th className="px-3">Verdict</th><th className="px-3">Score</th><th className="px-3 text-right">Close</th><th className="px-3">Alert level</th><th className="px-3">Distance</th><th className="px-3">Why</th><th /></tr>
            </thead>
            <tbody>
              {q.data.map((w) => (
                <tr key={w.symbol} className="border-b border-line/70 last:border-0">
                  <td className="px-3 py-2.5"><Link to={`/verdict/${w.symbol}`} className="font-semibold hover:text-brand">{w.symbol}</Link><div className="text-[11px] text-mute">{w.asOfDate ?? 'not analysed yet'}</div></td>
                  <td className="px-3"><VerdictBadge v={w.verdict} /></td>
                  <td className="num px-3">{w.totalScore ?? '-'}</td>
                  <td className="num px-3 text-right">₹{inr(w.close)}</td>
                  <td className="px-3">
                    <input
                      defaultValue={w.alertPrice ?? ''}
                      type="number"
                      step="0.05"
                      onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && v !== w.alertPrice) edit.mutate({ symbol: w.symbol, alertPrice: v }) }}
                      className="num w-28 !py-1"
                    />
                    {w.zone && <div className="mt-0.5 max-w-56 truncate text-[11px] text-mute" title={w.zone}>{w.zone}</div>}
                  </td>
                  <td className={clsx('num px-3', w.distancePct != null && w.distancePct <= 1 ? 'font-semibold text-pos' : 'text-sub')}>{w.distancePct == null ? '-' : `${w.distancePct > 0 ? '+' : ''}${w.distancePct}%`}</td>
                  <td className="max-w-72 px-3 text-[12.5px] text-sub">{w.reason}</td>
                  <td className="px-3"><button onClick={() => remove.mutate(w.symbol)} className="rounded p-1.5 text-mute hover:bg-neg-bg hover:text-neg" title="Remove"><Trash2 className="size-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Disclaimer />
    </>
  )
}
