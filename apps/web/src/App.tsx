import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Loader2, RefreshCw, Rocket, Search, ShieldCheck, Trophy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink, Route, Routes, useNavigate } from 'react-router'
import { api } from './lib/api'
import { tp } from './lib/topPicks'
import IpoStocks from './pages/IpoStocks'
import Ipos from './pages/Ipos'
import Stock from './pages/Stock'
import TopPicksPage from './pages/TopPicks'
import Trusted from './pages/Trusted'
import VerdictPage from './pages/Verdict'

const nav = [
  { to: '/', label: 'Top Picks', icon: Trophy },
  { to: '/trusted', label: 'Steady IPOs', icon: ShieldCheck },
  { to: '/ipo-stocks', label: 'IPO Stocks', icon: BadgeCheck },
  { to: '/ipos', label: 'IPO Screener', icon: Rocket },
]

function RefreshButton() {
  const qc = useQueryClient()
  const state = useQuery({ queryKey: ['tp-state'], queryFn: tp.state, refetchInterval: (q) => (q.state.data?.running ? 3000 : 30_000) })
  const run = useMutation({ mutationFn: tp.run, onSuccess: () => qc.invalidateQueries({ queryKey: ['tp-state'] }) })
  const s = state.data
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && s && !s.running) { qc.invalidateQueries({ queryKey: ['top-picks'] }); qc.invalidateQueries({ queryKey: ['tp-backtest'] }) }
    wasRunning.current = !!s?.running
  }, [s, qc])
  return (
    <div>
      <button
        onClick={() => run.mutate()}
        disabled={s?.running || run.isPending}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3.5 py-2.5 text-[13px] font-medium text-white shadow-sm transition hover:bg-brand/90 disabled:opacity-60"
        title="Update NSE data, screen every liquid stock and re-run the full analysis (also runs on weekdays at 7:30 PM IST)"
      >
        {s?.running ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        {s?.running ? 'Updating…' : 'Refresh Top Picks'}
      </button>
      {s?.running && <p className="mt-2 text-center text-xs text-mute">{s.step}{s.total ? ` (${s.done}/${s.total})` : ''}</p>}
      {s?.error && !s.running && <p className="mt-2 text-xs text-neg" title={s.error}>{s.error.slice(0, 90)}</p>}
    </div>
  )
}

function SystemStatus() {
  const q = useQuery({ queryKey: ['system'], queryFn: api.system, refetchInterval: 60_000 })
  const picks = useQuery({ queryKey: ['top-picks'], queryFn: tp.latest, retry: false })
  const s = q.data
  if (!s) return null
  const fmt = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '-')
  const asOf = picks.data?.asOf ?? null
  const stale = s.dataLatest && asOf && asOf < s.dataLatest
  return (
    <div className="mb-3 space-y-1 rounded-lg bg-soft px-3 py-2.5 text-[11.5px] text-sub">
      <div className="flex justify-between"><span>NSE data</span><b className="num text-ink">{fmt(s.dataLatest)}</b></div>
      <div className="flex justify-between"><span>Top Picks from</span><b className={`num ${stale ? 'text-amber' : 'text-ink'}`}>{fmt(asOf)}</b></div>
      <div className="flex justify-between"><span>Alerts</span><span className={s.alerts.telegram ? 'text-pos' : 'text-mute'}>{s.alerts.telegram ? 'Telegram on' : 'Telegram off'}</span></div>
    </div>
  )
}

function SymbolSearch() {
  const [q, setQ] = useState('')
  const go = useNavigate()
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) { go(`/verdict/${q.trim().toUpperCase()}`); setQ('') } }} className="relative">
      <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-mute" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Analyse a symbol" className="w-full pl-8" />
    </form>
  )
}

export default function App() {
  return (
    <div className="min-h-screen lg:flex">
      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col gap-5 p-4 lg:p-5">
          <NavLink to="/" className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-lg bg-brand text-[16px] font-bold text-white">V</div>
            <div>
              <div className="text-[17px] font-semibold leading-none tracking-tight text-ink">Vermax</div>
              <div className="mt-1 text-[11px] text-mute">NSE stock selection</div>
            </div>
          </NavLink>
          <SymbolSearch />
          <nav className="flex gap-1 overflow-x-auto lg:flex-col">
            {nav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[14px] font-medium transition ${isActive ? 'bg-brand-soft text-brand' : 'text-sub hover:bg-soft hover:text-ink'}`
                }
              >
                <Icon className="size-[18px]" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto"><SystemStatus /><RefreshButton /></div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 pb-20 pt-7 md:px-8 2xl:px-12">
        <div className="mx-auto w-full max-w-[1760px]">
          <Routes>
            <Route path="/" element={<TopPicksPage />} />
            <Route path="/verdict/:symbol" element={<VerdictPage />} />
            <Route path="/stock/:symbol" element={<Stock />} />
            <Route path="/trusted" element={<Trusted />} />
            <Route path="/ipo-stocks" element={<IpoStocks />} />
            <Route path="/ipos" element={<Ipos />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
