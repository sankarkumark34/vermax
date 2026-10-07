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
  list: 'core' | 'theme'; decision: 'BUY' | 'WATCH' | 'REJECT'; rejectReasons: string[]
  fundamentals: Fundamentals | null; sentiment: Sentiment | null; sizing: Sizing; circuit?: CircuitBrief | null
}
export interface Regime {
  label: 'BULLISH' | 'PULLBACK' | 'DEFENSIVE'; sizeMultiplier: number; niftyVs50dma: number; niftyVs200dma: number
  niftyRet20: number; vix: number; vixPercentile: number; breadth50: number; breadth200: number; advanceRatio: number; note: string
  fiiIndexLongRatio?: number | null; fiiIndexLongChg5?: number | null
}
export interface Run {
  asOf: string; tradeDate: string; generatedAt: string
  model: { trainedTo: string; trainedAt: string; rounds: number }
  universe: { liquidStocks: number; priceBand: [number, number]; inBand: number }
  regime: Regime; config: { minRet10?: number; tilt: number; tiltMinSectorRank: number; sectorCap: number; horizonDays: number }
  core: Pick[]; theme: Pick[]; rejected: Pick[]; disclaimer: string
}
export interface PipelineState { running: boolean; step: string; startedAt: string | null; finishedAt: string | null; error: string | null; lastAsOf: string | null }
export interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number; deliveryPct: number | null }
export interface StockResp {
  symbol: string; info: { name: string | null; sector: string } | null; bars: Bar[]
  model: { modelRank: number; of: number; score: number; rankScore: number; asOf: string } | null
  fundamentals?: Fundamentals | null; sentiment?: Sentiment | null; circuit?: CircuitSummary
  technicals?: Technicals | null
}

// mirrors apps/api/src/analysis/technicals.ts
export interface Swing { i: number; date: string; price: number; kind: 'H' | 'L'; label: 'HH' | 'LH' | 'HL' | 'LL' | null }
export interface StructureEvent { i: number; date: string; type: 'BOS' | 'CHoCH'; dir: 'up' | 'down'; level: number; swingDate: string }
export interface Fvg { i: number; date: string; dir: 'bull' | 'bear'; top: number; bottom: number; sizePct: number; touched: boolean }
export interface TradePlan { side: 'long' | 'short'; entry: number; stop: number; riskPct: number; target: number; targetPct: number; rr: number; stopBasis: string }
export interface Technicals {
  asOf: string
  series: { date: string; macd: number; signal: number; hist: number; rsi: number | null }[]
  macd: { macd: number; signal: number; hist: number; state: 'bullish' | 'bearish'; lastCross: { date: string; dir: 'up' | 'down'; sessionsAgo: number } | null; histRising: boolean }
  rsi: number | null
  swings: Swing[]
  structure: { trend: 'bullish' | 'bearish' | 'neutral'; events: StructureEvent[]; last: StructureEvent | null; lastSwingHigh: Swing | null; lastSwingLow: Swing | null }
  fib: { dir: 'up' | 'down'; from: { date: string; price: number }; to: { date: string; price: number }; levels: { ratio: number; price: number; kind: 'retracement' | 'extension' }[]; zone: string } | null
  fvgs: Fvg[]
  plans: { long: TradePlan; short: TradePlan }
  atrPct: number
  signals: string[]
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

export interface ScreenerRow {
  symbol: string; name: string | null; sector: string; close: number; chg1: number | null; turnoverCr: number; bars: number
  deliveryPct: number | null; d5: number | null; d10: number | null; w3: number | null; w4: number | null; m1: number | null; q1: number | null; h1: number | null; y1: number | null
  prevClose?: number | null; refs?: Record<string, number | null>; refsLive?: Record<string, number | null>
  modelRank: number | null; modelScore: number | null; vetoReason?: string | null
  rating?: { grade: 'A' | 'B' | 'C' | 'D' | '-'; eligible: boolean; reasons: string[]; tomorrow: 'core' | 'theme' | null; score: number }
}
export interface ScreenerResp { asOf: string; liveSession?: string; generatedAt: string; count: number; rankAsOf: string | null; rankOf: number; minMonths?: number; excludedYoung?: number; rows: ScreenerRow[] }

export interface LiveQuote { symbol: string; price: number; prevClose: number | null; changePct: number | null; dayHigh: number | null; dayLow: number | null; time: string | null; source: 'yahoo' }

export interface IpoRow extends ScreenerRow {
  listingDate: string; sessions: number; listOpen: number | null; listClose: number | null; sinceListing: number | null
  highSinceListing: number | null; fromHigh: number | null; lowSinceListing: number | null
  issuePrice?: number | null; vsIssue?: number | null; listingGain?: number | null
}
export interface IpoResp { asOf: string; liveSession?: string; generatedAt: string; count: number; months: number; minMonths?: number; excludedYoung?: number; rows: IpoRow[] }
