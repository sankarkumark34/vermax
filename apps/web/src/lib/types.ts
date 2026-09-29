export interface TradePlan {
  entryRef: number; maxEntry: number; stopPct: number; stop: number
  t1Pct: number; t1: number; t2Pct: number; t2: number; maxHoldDays: number; bookAtT1: number
}
export interface Reason { feature: string; label: string; value: string; impact: number }
export interface NewsItem { title: string; link: string; source: string | null; publishedAt: string | null; ageDays: number; score: number; severe: boolean }
export interface Sentiment {
  symbol: string; score: number; label: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE'; severe: boolean
  headlines: number; positives: number; negatives: number; items: NewsItem[]; error?: string
}
export interface Fundamentals {
  symbol: string; ok: boolean; name?: string | null; marketCapCr?: number | null
  roe?: number | null; roe3yAvg?: number | null; roce?: number | null; debtToEquity?: number | null
  salesCagr?: number | null; profitCagr?: number | null; insiderHolding?: number | null; pe?: number | null
  nextEarnings?: string | null; qualityScore: number | null
  verdict: 'PASS' | 'WATCH' | 'AVOID' | 'UNKNOWN'; flags: string[]; positives: string[]
}
export interface Sizing { qty: number; capitalUsed: number; riskAmount: number; positionPct: number }
export interface Pick {
  rank: number; symbol: string; sector: string; isTheme: boolean; score: number; rankScore: number
  themeBoost: boolean; close: number; changePct: number; inPriceBand: boolean; turnover20Cr: number
  atrPct: number; rsi: number; volRatio: number | null; delivPct: number | null; rs60: number | null
  sectorRank: number | null; tags: string[]; reasons: Reason[]; plan: TradePlan
  list: 'core' | 'theme' | 'elite'; decision: 'BUY' | 'WATCH' | 'REJECT'; rejectReasons: string[]
  fundamentals: Fundamentals | null; sentiment: Sentiment | null; sizing: Sizing; circuit?: CircuitBrief | null
}
export interface SectorRow {
  sector: string; isTheme: boolean; stocks: number; rank: number | null
  ret5: number; ret20: number; ret60: number; rs20: number; rs60: number
  breadth50: number; avgScore: number; top: string[]
}
export interface Regime {
  label: 'BULLISH' | 'PULLBACK' | 'DEFENSIVE'; sizeMultiplier: number; niftyVs50dma: number; niftyVs200dma: number
  niftyRet20: number; vix: number; vixPercentile: number; breadth50: number; breadth200: number; advanceRatio: number; note: string
}
export interface Run {
  asOf: string; tradeDate: string; generatedAt: string
  model: { trainedTo: string; trainedAt: string; rounds: number }
  universe: { liquidStocks: number; priceBand: [number, number]; inBand: number }
  regime: Regime; config: { minRet10?: number; tilt: number; tiltMinSectorRank: number; sectorCap: number; horizonDays: number }
  core: Pick[]; theme: Pick[]; elite?: Pick[]; rejected: Pick[]; sectors: SectorRow[]; disclaimer: string
}
export interface PipelineState { running: boolean; step: string; startedAt: string | null; finishedAt: string | null; error: string | null; lastAsOf: string | null }
export interface JournalStats {
  closed: number; open: number; skipped: number; winRate: number | null; expectancyPct: number | null
  avgWinPct: number | null; avgLossPct: number | null; profitFactor: number | null; avgHoldDays: number | null
  bestPct: number | null; worstPct: number | null
}
export interface JournalPick {
  id: number; asOf: string; list: 'core' | 'theme'; symbol: string; sector: string; rank: number; score: number
  entryRef: number; stop: number; t1: number; t2: number; status: string; entry: number | null; t1Hit: boolean
  days: number; netRet: number | null; exitLabel: string | null; lastClose: number | null; stopNow: number | null; fundVerdict: string | null
}
export interface Journal { stats: JournalStats & { byList: Record<string, JournalStats> }; picks: JournalPick[] }
export interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number; deliveryPct: number | null }
export interface StockResp {
  symbol: string; info: { name: string | null; sector: string } | null; bars: Bar[]
  model: { modelRank: number; of: number; score: number; rankScore: number; asOf: string } | null
  fundamentals?: Fundamentals | null; sentiment?: Sentiment | null; circuit?: CircuitSummary
}
export interface Variant {
  name: string; n: number; 'win%': number; 'exp%': number; PF: number; 'pos%': number; 'CAGR%': number; 'maxDD%': number
  'wk_mean%': number; 'wk>=5%': number; 'wk<=-3%': number; final: number; yearly: Record<string, number>
}
export interface Performance {
  window: [string, string]; costsRoundTripPct: number
  plan: { stop: string; t1: string; t2: string; timeStopDays: number; entry: string }
  variants: Variant[]; ic: Record<string, { meanIC: number; ir: number }>
  deciles: { decile: number; avgFwdPct: number; hit3Pct: number }[]
  theme: Record<string, unknown>
  elite?: { rule: string; elite: EliteStats; baselineTop3Weekly: EliteStats }
}
export interface EliteStats {
  trades: number; weeks: number; t1HitPct: number; stopPct: number; positivePct: number; expectancyPct: number
  avgWinPct: number; avgLossPct: number; weeksAtLeast1T1Pct: number; weeksAtLeast2T1Pct: number; weeksAllThreeLosePct: number
  byYear: Record<string, { t1HitPct: number; expectancyPct: number }>
}

export interface CircuitEvent {
  date: string; endDate: string; band: number; lockDays: number; refPrice: number; lockClose: number; dropPct: number
  recovered: boolean; recoveryDays: number | null; halfRecoveryDays: number | null; furtherFallPct: number
  daysSince: number; currentVsRefPct: number
}
export interface CircuitBrief {
  events: number; recoveredCount: number; medianRecoveryDays: number | null; meanRecoveryDays: number | null
  medianHalfRecoveryDays: number | null; recoveredWithin10Pct: number | null; recoveredWithin30Pct: number | null
  medianFurtherFallPct: number | null; lastEventDate: string | null; lockedNow: boolean; recentDays: number | null
}
export interface CircuitSummary extends CircuitBrief { list: CircuitEvent[] }
