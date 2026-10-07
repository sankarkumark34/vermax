import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Info, Loader2, Play } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { DISCLAIMER, sel, STATUS_STYLE, STATUS_TEXT, VERDICT_STYLE, type Status, type Verdict } from '../lib/selection'

export function VerdictBadge({ v, size = 'sm' }: { v: Verdict | null; size?: 'sm' | 'lg' }) {
  if (!v) return <span className="text-mute">-</span>
  return (
    <span className={clsx('inline-flex items-center rounded-md font-semibold tracking-wide', VERDICT_STYLE[v], size === 'lg' ? 'px-3.5 py-1.5 text-[17px]' : 'px-2 py-0.5 text-[11.5px]')}>
      {v}
    </span>
  )
}

/** Traffic light with its text label, so colour is never the only signal (proposal 11). */
export function StatusPill({ s }: { s: Status }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-sub">
      <span className={clsx('size-2.5 rounded-full', STATUS_STYLE[s])} />
      {STATUS_TEXT[s]}
    </span>
  )
}

export function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (score / max) * 100))
  const tone = pct >= 75 ? 'bg-pos' : pct >= 60 ? 'bg-amber' : 'bg-neg'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-soft">
      <div className={clsx('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Disclaimer() {
  return (
    <p className="mt-8 flex gap-2 rounded-lg bg-soft px-3.5 py-3 text-[12px] text-sub">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      {DISCLAIMER}
    </p>
  )
}

/** Starts the full-universe selection run and shows its progress. */
export function RunSelectionButton() {
  const qc = useQueryClient()
  const st = useQuery({ queryKey: ['sel-state'], queryFn: sel.state, refetchInterval: (q) => (q.state.data?.running ? 3000 : 30_000) })
  const run = useMutation({ mutationFn: () => sel.run(), onSuccess: () => qc.invalidateQueries({ queryKey: ['sel-state'] }) })
  const s = st.data
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && s && !s.running) qc.invalidateQueries({ queryKey: ['screener'] })   // refresh results when a run finishes
    wasRunning.current = !!s?.running
  }, [s, qc])
  return (
    <div className="flex items-center gap-3">
      {s?.running && (
        <span className="num text-[12.5px] text-sub">
          {s.step} · {s.done}/{s.total}
        </span>
      )}
      {s?.error && !s.running && <span className="text-[12px] text-neg" title={s.error}>last run failed</span>}
      <button
        onClick={() => run.mutate()}
        disabled={s?.running || run.isPending}
        className="flex items-center gap-2 rounded-lg bg-brand px-3.5 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-brand/90 disabled:opacity-60"
        title="Analyse every liquid NSE stock with the 18-step framework (also runs nightly at 7:30 PM IST)"
      >
        {s?.running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
        {s?.running ? 'Running…' : 'Run analysis'}
      </button>
    </div>
  )
}

export function PageHead({ label, title, sub, right }: { label: string; title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="label">{label}</div>
        <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight">{title}</h1>
        {sub && <p className="mt-1 max-w-3xl text-[13px] text-sub">{sub}</p>}
      </div>
      {right}
    </div>
  )
}
