import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, BookOpen, FlaskConical, Layers, Loader2, Play, Search, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Route, Routes, useNavigate } from 'react-router'
import { api } from './lib/api'
import Journal from './pages/Journal'
import Performance from './pages/Performance'
import Sectors from './pages/Sectors'
import Stock from './pages/Stock'
import Today from './pages/Today'

const nav = [
  { to: '/', label: 'Tomorrow', icon: Sparkles },
  { to: '/sectors', label: 'Sectors', icon: Layers },
  { to: '/journal', label: 'Journal', icon: BookOpen },
  { to: '/performance', label: 'Backtest', icon: FlaskConical },
]

function PipelineButton() {
  const qc = useQueryClient()
  const state = useQuery({ queryKey: ['pipeline'], queryFn: api.state, refetchInterval: (q) => (q.state.data?.running ? 2500 : 15000) })
  const run = useMutation({
    mutationFn: api.run,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pipeline'] }),
  })
  const s = state.data
  const wasRunning = s?.running
  if (s && !wasRunning && s.lastAsOf) qc.invalidateQueries({ queryKey: ['latest'] })
  return (
    <div className="flex items-center gap-3">
      {s?.running && <span className="hidden text-xs text-slate-400 md:inline">{s.step}…</span>}
      {s?.error && <span className="hidden max-w-64 truncate text-xs text-rose-400 md:inline" title={s.error}>{s.error}</span>}
      <button
        onClick={() => run.mutate()}
        disabled={s?.running || run.isPending}
        className="flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-sm font-medium text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-60"
      >
        {s?.running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
        {s?.running ? 'Running' : 'Refresh picks'}
      </button>
    </div>
  )
}

function SymbolSearch() {
  const [q, setQ] = useState('')
  const nav = useNavigate()
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (q.trim()) { nav(`/stock/${q.trim().toUpperCase()}`); setQ('') } }}
      className="relative hidden sm:block"
    >
      <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Symbol e.g. HAL" className="w-40 pl-8 text-sm" />
    </form>
  )
}

export default function App() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-16 pt-4 md:px-6">
      <header className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <NavLink to="/" className="flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-lg bg-emerald-400/10 ring-1 ring-emerald-400/30">
            <Activity className="size-5 text-emerald-300" />
          </div>
          <div>
            <div className="text-lg font-semibold leading-none tracking-tight">Vermax</div>
            <div className="label mt-1">NSE swing desk</div>
          </div>
        </NavLink>
        <nav className="flex gap-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${isActive ? 'bg-white/8 text-white' : 'text-slate-400 hover:text-slate-200'}`
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <SymbolSearch />
          <PipelineButton />
        </div>
      </header>
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/sectors" element={<Sectors />} />
        <Route path="/journal" element={<Journal />} />
        <Route path="/performance" element={<Performance />} />
        <Route path="/stock/:symbol" element={<Stock />} />
      </Routes>
    </div>
  )
}
