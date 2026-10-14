/** Types and client for /api/v1/sectors (mirrors apps/api/src/sectors). */
import type { PickRow } from './topPicks'

export interface SectorStats {
  sector: string; stocks: number
  med1w: number | null; med1m: number | null; med3m: number | null; med6m: number | null
  breadth50: number; breadth200: number; upWeek: number
  strength: number; label: 'Strong' | 'Neutral' | 'Weak'
  analysed: number; qualified: number; buy: number
}
export interface Checks { fundamentals: boolean; growth: boolean; momentum: boolean; trend: boolean; entry: boolean }
export type LeaderRow = PickRow & {
  trend: { close: number; chg1w: number | null; above50: boolean; above200: boolean | null; rsi: number | null; fromHigh52: number }
  growth: { salesCagr: number | null; patCagr: number | null; roe: number | null; debtToEquity: number | null }
  checks: Checks; qualified: boolean; priceScore: number
  fundamentalScore: number; growthScore: number; technicalScore: number; composite: number
}
export interface StockRow {
  symbol: string; name: string | null; sector: string; close: number; adtvCr: number
  ret1w: number | null; ret1m: number | null; ret3m: number | null; ret6m: number | null; ret1y: number | null
  above50: boolean; above200: boolean | null; rsi: number | null; fromHigh52: number
  monthsUp: { up: number; total: number }; priceScore: number; analysed: boolean
}
export interface SectorsState { running: boolean; step: string; done: number; total: number; startedAt: string | null; finishedAt: string | null; error: string | null }
export interface Sectors {
  asOf: string | null; generatedAt?: string; stale: boolean; state: SectorsState
  params?: { minAdtvCr: number; minPrice: number; perSector: number; waitMin: number }
  funnel?: { liquid: number; nseClassified: number; scored: number; others: number; analysed: number; failed: number }
  sectors: SectorStats[]; leaders: LeaderRow[]; stocks: StockRow[]
}

export async function fetchSectors(): Promise<Sectors> {
  const r = await fetch('/api/v1/sectors')
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
}
export const runSectors = () => fetch('/api/v1/sectors/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
