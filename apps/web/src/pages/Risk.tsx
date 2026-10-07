import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Disclaimer, PageHead } from '../components/selection'
import { Section, Stat } from '../components/ui'
import { inr, inr0 } from '../lib/format'
import { sel } from '../lib/selection'

const STORE = 'vermax.risk.v1'
const load = () => {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '{}') as { capital?: string; riskPct?: string } } catch { return {} }
}

export default function Risk() {
  const [params] = useSearchParams()
  const cfg = useQuery({ queryKey: ['sel-config'], queryFn: sel.config })
  const saved = load()
  const [f, setF] = useState({
    capital: saved.capital ?? '', riskPct: saved.riskPct ?? '', symbol: params.get('symbol') ?? '',
    entry: params.get('entry') ?? '', stop: params.get('stop') ?? '', target: params.get('target') ?? '', adtvCr: '', marketCapCr: '',
  })
  useEffect(() => {
    if (cfg.data) setF((x) => ({ ...x, capital: x.capital || String(cfg.data.risk.capitalInr), riskPct: x.riskPct || String(cfg.data.risk.riskPct) }))
  }, [cfg.data])
  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ capital: f.capital, riskPct: f.riskPct })) } catch { /* storage unavailable */ }
  }, [f.capital, f.riskPct])

  const calc = useMutation({
    mutationFn: () => sel.positionSize({
      capital: Number(f.capital), riskPct: Number(f.riskPct), entry: Number(f.entry), stop: Number(f.stop),
      target: f.target ? Number(f.target) : undefined, symbol: f.symbol ? f.symbol.toUpperCase() : undefined,
      adtvCr: f.adtvCr ? Number(f.adtvCr) : undefined, marketCapCr: f.marketCapCr ? Number(f.marketCapCr) : undefined,
    }),
  })
  const r = calc.data
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const field = (k: keyof typeof f, label: string, hint?: string) => (
    <label className="text-[12.5px]"><div className="label mb-1.5">{label}</div><input value={f[k]} onChange={set(k)} type={k === 'symbol' ? 'text' : 'number'} step="any" placeholder={hint} className="w-full" /></label>
  )

  return (
    <>
      <PageHead label="Stock selection" title="Risk and position size" sub="Quantity = the smallest of three limits: the risk budget at the stop, the position cap (10% large caps, 5% mid/small), and 1% of average daily traded value so the position can be exited in a day. The stop comes from the chart, never from the quantity you want." />
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <form onSubmit={(e) => { e.preventDefault(); calc.mutate() }} className="card grid grid-cols-2 gap-3 p-4">
          {field('capital', 'Capital (₹)')}
          {field('riskPct', 'Risk per trade (%)', '1')}
          {field('entry', 'Entry (₹)')}
          {field('stop', 'Stop-loss (₹)')}
          {field('target', 'Target (₹, optional)')}
          {field('symbol', 'Symbol (fills liquidity)', 'e.g. BEL')}
          {field('adtvCr', 'Avg traded value (₹ Cr)', 'from symbol')}
          {field('marketCapCr', 'Market cap (₹ Cr)', 'from symbol')}
          <button className="col-span-2 rounded-lg bg-brand px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-60" disabled={calc.isPending}>Calculate</button>
          {calc.error && <p className="col-span-2 text-[12.5px] text-neg">{(calc.error as Error).message}</p>}
        </form>
        <div className="card p-5">
          {!r && <p className="text-sm text-mute">Enter the trade and press Calculate. Open it from a stock's verdict page to pre-fill entry, stop and target.</p>}
          {r && (
            <>
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                <Stat label="Quantity" value={inr0(r.qty)} sub={`limited by ${r.binding === 'positionCap' ? 'position cap' : r.binding}`} />
                <Stat label="Position value" value={`₹${inr0(r.positionValue)}`} sub={`${r.positionPctOfCapital}% of capital`} />
                <Stat label="Risk at stop" value={`₹${inr0(r.actualRisk)}`} sub={`${r.actualRiskPctOfCapital}% of capital`} tone="text-neg" />
                <Stat label="Reward : risk" value={r.rewardRisk ? `1 : ${r.rewardRisk}` : '-'} sub={r.potentialGain ? `gain ₹${inr0(r.potentialGain)}` : undefined} tone={r.rewardRisk && r.rewardRisk >= 2 ? 'text-pos' : undefined} />
              </div>
              <table className="mt-5 w-full text-[13px]">
                <tbody>
                  {[
                    ['By risk', r.qtyByRisk, `₹${inr0(r.riskBudget)} budget ÷ ₹${inr(r.riskPerShare)} risk per share`, 'risk'],
                    ['By position cap', r.qtyByCap, `${r.capPct}% of capital (${r.capClass} cap)`, 'positionCap'],
                    ['By liquidity', r.qtyByLiquidity ?? '-', r.inputs.adtvCr ? `${r.limits.liquidityPctOfAdtv}% of ₹${r.inputs.adtvCr} Cr a day` : 'no traded value given', 'liquidity'],
                  ].map(([label, qty, why, key]) => (
                    <tr key={String(key)} className={clsx('border-b border-line/70', r.binding === key && 'font-semibold')}>
                      <td className="py-2">{label}</td><td className="num py-2">{typeof qty === 'number' ? inr0(qty) : qty}</td><td className="py-2 text-sub">{why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.liquidityCheck.orderPctOfAdtv != null && (
                <p className={clsx('mt-3 text-[12.5px]', r.liquidityCheck.exitableInOneDay ? 'text-pos' : 'text-neg')}>
                  Order is {r.liquidityCheck.orderPctOfAdtv}% of a day's traded value: {r.liquidityCheck.exitableInOneDay ? 'can be exited within a day' : 'may be hard to exit quickly'}.
                </p>
              )}
            </>
          )}
        </div>
      </div>
      <Portfolio />
      <Disclaimer />
    </>
  )
}

function Portfolio() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['portfolio-risk'], queryFn: sel.portfolioRisk })
  const [p, setP] = useState({ symbol: '', qty: '', entry: '', stop: '' })
  const add = useMutation({
    mutationFn: () => sel.addPosition({ symbol: p.symbol.toUpperCase(), qty: Number(p.qty), entry: Number(p.entry), stop: Number(p.stop) }),
    onSuccess: () => { setP({ symbol: '', qty: '', entry: '', stop: '' }); qc.invalidateQueries({ queryKey: ['portfolio-risk'] }) },
  })
  const remove = useMutation({ mutationFn: sel.removePosition, onSuccess: () => qc.invalidateQueries({ queryKey: ['portfolio-risk'] }) })
  const d = q.data
  return (
    <Section title="Portfolio risk" sub="Open positions you record here (Vermax never places orders), checked against the sector cap and the total open-risk limit.">
      {d && (
        <div className="card mb-4 grid grid-cols-2 gap-5 p-4 sm:grid-cols-4">
          <Stat label="Invested" value={`₹${inr0(d.invested)}`} sub={`${d.investedPct}% of ₹${inr0(d.capital)}`} />
          <Stat label="Open risk" value={`${d.totalOpenRiskPct}%`} sub={`limit ${d.limits.totalOpenRiskPct}%`} tone={d.totalOpenRiskPct > d.limits.totalOpenRiskPct ? 'text-neg' : 'text-pos'} />
          <Stat label="Largest sector" value={d.sectors[0] ? `${d.sectors[0].pct}%` : '-'} sub={d.sectors[0] ? `${d.sectors[0].sector} · cap ${d.limits.sectorCapPct}%` : undefined} tone={d.sectors[0]?.overCap ? 'text-neg' : undefined} />
          <Stat label="Positions" value={d.positions.length} />
          {d.breaches.length > 0 && <div className="col-span-full text-[13px] text-neg">{d.breaches.join(' · ')}</div>}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); add.mutate() }} className="card mb-3 flex flex-wrap items-end gap-3 p-3">
        {(['symbol', 'qty', 'entry', 'stop'] as const).map((k) => (
          <label key={k} className="text-[12.5px]"><div className="label mb-1">{k}</div><input value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} type={k === 'symbol' ? 'text' : 'number'} step="any" className="w-28" /></label>
        ))}
        <button className="rounded-lg border border-line px-3 py-1.5 text-[13px] hover:bg-soft" disabled={add.isPending}>Add position</button>
        {add.error && <span className="text-[12.5px] text-neg">{(add.error as Error).message}</span>}
      </form>
      {d && d.positions.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[700px] text-[13px]">
            <thead className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-mute"><tr><th className="px-3 py-2">Stock</th><th>Sector</th><th className="text-right">Qty</th><th className="text-right">Entry</th><th className="text-right">Last</th><th className="text-right">Stop</th><th className="text-right">Value</th><th className="text-right">Open risk</th><th /></tr></thead>
            <tbody>
              {d.positions.map((x) => (
                <tr key={x.id} className="border-b border-line/70 last:border-0">
                  <td className="px-3 py-2"><Link to={`/verdict/${x.symbol}`} className="font-semibold hover:text-brand">{x.symbol}</Link></td>
                  <td className="text-sub">{x.sector ?? '-'}</td>
                  <td className="num text-right">{x.qty}</td><td className="num text-right">₹{inr(x.entry)}</td><td className="num text-right">₹{inr(x.price)}</td>
                  <td className="num text-right">₹{inr(x.stop)}</td><td className="num text-right">₹{inr0(x.value)}</td><td className="num text-right">₹{inr0(x.openRisk)}</td>
                  <td className="px-2"><button onClick={() => remove.mutate(x.id)} className="rounded p-1.5 text-mute hover:bg-neg-bg hover:text-neg"><Trash2 className="size-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}
