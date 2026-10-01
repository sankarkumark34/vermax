import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Crown, ListFilter, FlaskConical, Layers, Loader2, RefreshCw, Search, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Route, Routes, useNavigate } from 'react-router'
import { api } from './lib/api'
import Elite from './pages/Elite'
import Journal from './pages/Journal'
import Performance from './pages/Performance'
import Sectors from './pages/Sectors'
import Screener from './pages/Screener'
import Stock from './pages/Stock'
import Today from './pages/Today'

const nav = [
  { to: '/', label: 'Tomorrow', icon: Sparkles },
  { to: '/elite', label: 'Elite 3', icon: Crown },
  { to: '/screener', label: 'Screener', icon: ListFilter },
  { to: '/sectors', label: 'Sectors', icon: Layers },
  { to: '/journal', label: 'Journal', icon: BookOpen },
  { to: '/performance', label: 'Backtest', icon: FlaskConical },
]

function PipelineButton() {
  const qc = useQueryClient()
  const state = useQuery({ queryKey: ['pipeline'], queryFn: api.state, refetchInterval: (q) => (q.state.data?.running ? 2500 : 20000) })
  const run = useMutation({ mutationFn: api.run, onSuccess: () => qc.invalidateQueries({ queryKey: ['pipeline'] }) })
  const s = state.data
  if (s && !s.running && s.lastAsOf) qc.invalidateQueries({ queryKey: ['latest'] })
  return (
    <div>
      <button
        onClick={() => run.mutate()}
        disabled={s?.running || run.isPending}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3.5 py-2.5 text-[13px] font-medium text-white shadow-sm transition hover:bg-brand/90 disabled:opacity-60"
      >
        {s?.running ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        {s?.running ? 'Updating…' : 'Refresh picks'}
      </button>
      {s?.running && <p className="mt-2 text-center text-xs text-mute">{s.step}</p>}
      {s?.error && <p className="mt-2 text-xs text-neg" title={s.error}>{s.error.slice(0, 90)}</p>}
    </div>
  )
}

function SystemStatus() {
  const q = useQuery({ queryKey: ['system'], queryFn: api.system, refetchInterval: 60_000 })
  const s = q.data
  if (!s) return null
  const fmt = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '-')
  const stale = s.dataLatest && s.publishedAsOf && s.publishedAsOf < s.dataLatest
  const next = s.jobs.find((j) => j.name === 'daily-pipeline')?.next
  return (
    <div className="mb-3 space-y-1 rounded-lg bg-soft px-3 py-2.5 text-[11.5px] text-sub">
      <div className="flex justify-between"><span>NSE data</span><b className="num text-ink">{fmt(s.dataLatest)}</b></div>
      <div className="flex justify-between"><span>Picks from</span><b className={`num ${stale ? 'text-amber' : 'text-ink'}`}>{fmt(s.publishedAsOf)}</b></div>
      {next && <div className="flex justify-between"><span>Next run</span><span className="num">{new Date(next).toLocaleString('en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>}
      <div className="flex justify-between"><span>Alerts</span><span className={s.alerts.telegram ? 'text-pos' : 'text-mute'}>{s.alerts.telegram ? 'Telegram on' : 'Telegram off'}</span></div>
    </div>
  )
}

function SymbolSearch() {
  const [q, setQ] = useState('')
  const go = useNavigate()
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) { go(`/stock/${q.trim().toUpperCase()}`); setQ('') } }} className="relative">
      <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-mute" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search symbol" className="w-full pl-8" />
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
              <div className="mt-1 text-[11px] text-mute">NSE swing desk</div>
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
          <div className="mt-auto"><SystemStatus /><PipelineButton /></div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 pb-20 pt-7 md:px-8 2xl:px-12">
        <div className="mx-auto w-full max-w-[1760px]">
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/elite" element={<Elite />} />
            <Route path="/screener" element={<Screener />} />
            <Route path="/sectors" element={<Sectors />} />
            <Route path="/journal" element={<Journal />} />
            <Route path="/performance" element={<Performance />} />
            <Route path="/stock/:symbol" element={<Stock />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
