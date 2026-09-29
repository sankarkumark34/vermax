/** Shapes of the JSON emitted by the Python scorer (ml/vermax/production.py) and the enriched payload we publish. */
import type { SentimentResult } from '../sentiment/sentiment.service.js';

export interface TradePlan {
  entryRef: number;
  maxEntry: number;
  stopPct: number;
  stop: number;
  t1Pct: number;
  t1: number;
  t2Pct: number;
  t2: number;
  maxHoldDays: number;
  bookAtT1: number;
}

export interface PyReason {
  feature: string;
  label: string;
  value: string;
  impact: number;
}

export interface PyPick {
  rank: number;
  symbol: string;
  sector: string;
  isTheme: boolean;
  score: number;
  rankScore: number;
  themeBoost: boolean;
  close: number;
  changePct: number;
  inPriceBand: boolean;
  turnover20Cr: number;
  atrPct: number;
  rsi: number;
  volRatio: number | null;
  delivPct: number | null;
  rs60: number | null;
  sectorRank: number | null;
  tags: string[];
  reasons: PyReason[];
  plan: TradePlan;
}

export interface PySector {
  sector: string;
  isTheme: boolean;
  stocks: number;
  rank: number | null;
  ret5: number;
  ret20: number;
  ret60: number;
  rs20: number;
  rs60: number;
  breadth50: number;
  avgScore: number;
  top: string[];
}

export interface PyRegime {
  label: 'BULLISH' | 'PULLBACK' | 'DEFENSIVE';
  sizeMultiplier: number;
  niftyVs50dma: number;
  niftyVs200dma: number;
  niftyRet20: number;
  vix: number;
  vixPercentile: number;
  breadth50: number;
  breadth200: number;
  advanceRatio: number;
  note: string;
}

export interface PyScoreFile {
  asOf: string;
  generatedAt: string;
  model: { trainedTo: string; trainedAt: string; rounds: number };
  universe: { liquidStocks: number; priceBand: [number, number]; inBand: number };
  regime: PyRegime;
  picks: PyPick[];
  themeWatch: PyPick[];
  elite: PyPick[];
  sectors: PySector[];
  ranking: { symbol: string; sector: string; score: number; rankScore: number; close: number; changePct: number }[];
  config: { tilt: number; tiltMinSectorRank: number; sectorCap: number; horizonDays: number };
}

export interface Fundamentals {
  symbol: string;
  ok: boolean;
  name?: string | null;
  marketCapCr?: number | null;
  roe?: number | null;
  roe3yAvg?: number | null;
  roce?: number | null;
  debtToEquity?: number | null;
  salesCagr?: number | null;
  profitCagr?: number | null;
  insiderHolding?: number | null;
  pe?: number | null;
  nextEarnings?: string | null;
  qualityScore: number | null;
  verdict: 'PASS' | 'WATCH' | 'AVOID' | 'UNKNOWN';
  flags: string[];
  positives: string[];
}

export type Decision = 'BUY' | 'WATCH' | 'REJECT';

export interface Sizing {
  qty: number;
  capitalUsed: number;
  riskAmount: number;
  positionPct: number;
}

export interface EnrichedPick extends PyPick {
  list: 'core' | 'theme' | 'elite';
  decision: Decision;
  rejectReasons: string[];
  fundamentals: Fundamentals | null;
  sentiment: SentimentResult | null;
  sizing: Sizing;
}

export interface PublishedRun {
  asOf: string;
  tradeDate: string;
  generatedAt: string;
  model: PyScoreFile['model'];
  universe: PyScoreFile['universe'];
  regime: PyRegime;
  config: PyScoreFile['config'];
  core: EnrichedPick[];
  theme: EnrichedPick[];
  elite: EnrichedPick[];
  rejected: EnrichedPick[];
  sectors: PySector[];
  disclaimer: string;
}
