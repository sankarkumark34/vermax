/** Types and client for /api/v1/top-picks (mirrors apps/api/src/winners). */
import type { Verdict } from './selection'

export interface PeriodResult { kind: 'week' | 'month' | 'quarter' | 'fy'; label: string; from: string; to: string; ret: number | null; ok: boolean }
export interface Dip { peakDate: string; troughDate: string; depthPct: number; recoveredOn: string | null; sessionsToRecover: number | null }
export interface Screen {
  asOf: string
  periods: Record<'week' | 'month' | 'quarter' | 'fy', PeriodResult | null>
  fytd: { label: string; ret: number | null }
  monthStreak: number
  weeksUp: { up: number; total: number }
  monthsUp: { up: number; total: number }
  ret1m: number | null; ret3m: number | null; ret6m: number | null; ret1y: number | null
  resilience: { maxDrawdown3mPct: number; currentDrawdownPct: number; worstWeekPct: number | null; dips: Dip[]; ok: boolean; reasons: string[] }
  ticks: { week: boolean; month: boolean; quarter: boolean; fy: boolean; streak: boolean; resilient: boolean }
  pass: boolean
  missing: string[]
}
export interface PickRow {
  symbol: string; name: string | null; sector: string | null; close: number | null; adtvCr: number | null; marketCapCr: number | null
  screen: Screen
  verdict: Verdict; totalScore: number; coverage: number; valuationStretched: boolean; gates: string[]; reason: string; template: string
  technical: {
    trend: string; ready: boolean; atrPct?: number
    checks: { trendOk: boolean; atLevel: boolean; triggerConfirmed: boolean; extended: boolean; rewardRisk: number; rrOk: boolean }
    plan: { entry: number; stop: number; target: number; rewardRisk: number; riskPct: number; stopBasis: string; targetBasis: string }
    targets: { price: number; basis: string; pct: number }[]
    watch: { alertPrice: number; zone: string } | null
    patterns: string[]; levelReasons: string[]; rsi: number | null; rs3m: number | null
    structure: { type: 'BOS' | 'CHoCH'; dir: 'up' | 'down'; date: string; level: number } | null
    fibZone: string | null; poc: number | null
  } | null
  position: { qty: number; value: number; risk: number } | null
  rank?: number; composite?: number; momentumScore?: number; fundamentalScore?: number; technicalScore?: number; action?: 'BUY now' | 'Wait for entry'
  rejectedFor?: string
}
export interface TopPicks {
  runId: number; asOf: string; generatedAt: string
  criteria: { minAdtvCr: number; minPrice: number; minMonthStreak: number; maxDrawdown3mPct: number; maxCurrentDrawdownPct: number; dipPct: number; maxRecoverySessions: number; worstWeekPct: number; waitMin: number }
  market: { periods: Screen['periods']; fytd: Screen['fytd']; ret3m: number | null; monthStreak: number } | null
  funnel: { liquid: number; screened: number; week: number; month: number; quarter: number; fy: number; streak: number; resilient: number; analysed: number; failed?: number; rejected: number; final: number; buyNow: number }
  rows: PickRow[]
  rejected: PickRow[]
  nearMisses: { symbol: string; missing: string; screen: Screen }[]
  failed?: { symbol: string; error: string }[]
}
export interface Backtest {
  generatedAt: string; from: string; to: string; running: boolean; notes: string[]
  summary: {
    months: number; monthsWithPicks: number; avgPicksPerMonth: number; avgMonthlyPicks: number; avgMonthlyPicksUptrend: number; avgMonthlyUniverse: number
    avgMonthlyNifty: number; avg3mPicks: number; stockHitRate: number; monthsBeatNifty: number; monthsBeatUniverse: number; cumulativePicks: number
    cumulativeNifty: number; worstMonthPicks: number
  }
  months: { month: string; picks: number; picksRet: number | null; niftyRet: number; universeRet: number | null; hitRate: number | null }[]
  split: string
  benchmarks: Record<'nifty' | 'universe', { avg1m: number; avg3m: number; avg1mFirstHalf: number; avg1mSecondHalf: number; cumulative: number }>
  variants: {
    key: string; label: string; avgPicks: number; monthsWithPicks: number; avg1m: number | null; avg3m: number | null; avg1mFirstHalf: number | null
    avg1mSecondHalf: number | null; hitRate: number | null; monthsBeatNifty: number; cumulative: number | null; worstMonth: number | null
  }[]
}
export interface RunState { running: boolean; step: string; done: number; total: number; startedAt: string | null; finishedAt: string | null; error: string | null; backtest: { running: boolean; error: string | null } }

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  if (!r.ok) {
    let msg = `${r.status}`
    try { const b = await r.json(); msg = Array.isArray(b.message) ? b.message.join('; ') : b.message ?? msg } catch { /* not json */ }
    throw new Error(msg)
  }
  return r.json() as Promise<T>
}
const post = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }

export const tp = {
  latest: () => j<TopPicks>('/api/v1/top-picks'),
  state: () => j<RunState>('/api/v1/top-picks/state'),
  run: () => j<{ started: boolean }>('/api/v1/top-picks/run', post),
  backtest: () => j<Backtest>('/api/v1/top-picks/backtest'),
}
