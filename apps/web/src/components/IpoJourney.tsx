import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { inr, pctRaw, tone } from '../lib/format'

export interface Journey {
  ref: number; status: 'never_below' | 'recovered' | 'below_now' | 'below_since_listing'; listedBelow: boolean
  sessionsBelow: number; pctSessionsBelow: number; sessions: number; longestLossStreak: number; currentLossStreak: number
  deepest: number; current: number; firstRecoveryOn: string | null; sessionsToRecover: number | null; daysToRecover: number | null
  lastRecoveryOn: string | null; episodes: number
  worstEpisodes?: { start: string; end: string; sessions: number; deepest: number; recoveredOn: string | null }[]
}
export interface JourneyPair { listingDate: string; issueAdj?: number; adjFactor?: number; vsIssue?: Journey; vsListing: Journey }

interface StudyAgg { n: number; pctListedBelow?: number; pctEverBelow?: number; pctBelowNow?: number; medianDaysToRecover?: number | null; recoveredWithin90d?: number | null }
interface Study { asOf: string | null; groups?: Record<'vsIssue' | 'vsListing', { overall: StudyAgg; byQib: Record<string, StudyAgg> }> }

const STATUS: Record<Journey['status'], { text: string; cls: string }> = {
  never_below: { text: 'Never closed below', cls: 'bg-pos-bg text-pos' },
  recovered: { text: 'Was in loss, recovered', cls: 'bg-blue-bg text-blue' },
  below_now: { text: 'In loss again now', cls: 'bg-amber-bg text-amber' },
  below_since_listing: { text: 'In loss since listing', cls: 'bg-neg-bg text-neg' },
}
const d = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-')

export const qibBucket = (q: number | null | undefined) => (q == null ? 'unknown' : q < 10 ? 'QIB < 10×' : q < 50 ? 'QIB 10–50×' : q < 100 ? 'QIB 50–100×' : 'QIB ≥ 100×')

function Side({ title, j }: { title: string; j: Journey }) {
  const st = STATUS[j.status]
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-ink">{title} <span className="num font-normal text-mute">₹{inr(j.ref)}</span></div>
        <span className={clsx('rounded-md px-2 py-0.5 text-xs font-semibold', st.cls)}>{st.text}</span>
      </div>
      <ul className="space-y-1.5 text-[13px]">
        <li className="flex justify-between"><span className="text-sub">Now vs reference</span><b className={clsx('num', tone(j.current))}>{pctRaw(j.current, 1)}</b></li>
        <li className="flex justify-between"><span className="text-sub">Sessions closed in loss</span><span className="num text-ink">{j.sessionsBelow} of {j.sessions} ({j.pctSessionsBelow}%)</span></li>
        <li className="flex justify-between"><span className="text-sub">Longest loss streak</span><span className="num text-ink">{j.longestLossStreak} sessions</span></li>
        {j.currentLossStreak > 0 && <li className="flex justify-between"><span className="text-sub">Current loss streak</span><span className="num text-neg">{j.currentLossStreak} sessions</span></li>}
        <li className="flex justify-between"><span className="text-sub">Deepest fall</span><span className={clsx('num', tone(j.deepest))}>{pctRaw(j.deepest, 1)}</span></li>
        {j.listedBelow && (
          <li className="flex justify-between"><span className="text-sub">First recovery</span>
            <span className="num text-ink">{j.firstRecoveryOn ? `${d(j.firstRecoveryOn)} · ${j.sessionsToRecover} sessions (${j.daysToRecover} days)` : 'not yet'}</span></li>
        )}
        {j.lastRecoveryOn && j.lastRecoveryOn !== j.firstRecoveryOn && <li className="flex justify-between"><span className="text-sub">Last recovery</span><span className="num text-ink">{d(j.lastRecoveryOn)}</span></li>}
      </ul>
    </div>
  )
}

export default function IpoJourney({ journey, qib }: { journey: JourneyPair; qib?: number | null }) {
  const study = useQuery({ queryKey: ['ipo-study'], queryFn: async () => (await (await fetch('/api/ipos/study')).json()) as Study, staleTime: 30 * 60_000 })
  const g = study.data?.groups?.vsIssue
  const bucket = qibBucket(qib)
  const peer = g?.byQib?.[bucket]
  return (
    <div className="card p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="label">After listing: loss & recovery</div>
        <span className="text-xs text-mute">Listed {d(journey.listingDate)}{journey.adjFactor && journey.adjFactor !== 1 ? ' · prices adjusted for splits/bonus' : ''}</span>
      </div>
      <p className="mb-3 text-[12.5px] text-sub">A session is "in loss" when it closes below the reference price. Recovery = first close back above it.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {journey.vsIssue && <Side title="vs Issue price (IPO investor)" j={journey.vsIssue} />}
        <Side title="vs Listing price (bought on listing day)" j={journey.vsListing} />
      </div>
      {peer && peer.n > 0 && (
        <p className="mt-3 rounded-lg bg-soft px-3 py-2 text-[12.5px] text-sub">
          Other IPOs with <b className="text-ink">{bucket}</b> subscription ({peer.n} since 2019): {peer.pctListedBelow}% listed below issue, {peer.pctEverBelow}% closed below issue at some point,
          {' '}{peer.pctBelowNow}% are below issue today{peer.medianDaysToRecover != null ? `; those that listed below took a median ${peer.medianDaysToRecover} days to recover` : ''}.
        </p>
      )}
    </div>
  )
}
