/** Types and client for /api/v1/steady (mirrors apps/api/src/steady). */
import type { PickRow } from './topPicks'

export interface RefWindow {
  months: number; ref: number; refDate: string; fromListing: boolean
  minClosePct: number; minLowPct: number; sessionsBelow: number; lastBelow: string | null
}
export interface PeriodRet { period: string; ret: number }
export interface SteadyFacts {
  asOf: string; firstDate: string; listedInData: boolean; sessionsSinceFirst: number; close: number; chg1: number | null; rsi: number | null; fromHigh: number
  windows: Record<'6' | '12', RefWindow>
  months: PeriodRet[]
  quarters: PeriodRet[]
}
export type SteadyRow = PickRow & { steady: SteadyFacts }
export interface SteadyState { running: boolean; step: string; done: number; total: number; startedAt: string | null; finishedAt: string | null; error: string | null }
export interface Steady {
  asOf: string | null; generatedAt?: string; stale: boolean; state: SteadyState
  price?: { min: number; max: number }; minMonths?: number
  funnel?: { liquid: number; screened: number; candidates: number; analysed: number; failed: number }
  rows: SteadyRow[]
}

export async function fetchSteady(): Promise<Steady> {
  const r = await fetch('/api/v1/steady')
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
}
export const runSteady = () => fetch('/api/v1/steady/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
