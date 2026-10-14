/**
 * Sector Leaders (pure): every liquid NSE stock grouped by NSE sector, then the best of each sector on
 * fundamentals + positive growth + technicals.
 *
 *   price layer (every stock)  growth   = Top Picks momentum score (market percentile of 3M / 6M / 1Y returns + up weeks / months)
 *                              trend    = above EMA50 (40) + above EMA200 (40) + RSI 40-70 (20)
 *                              priceScore = 70% growth + 30% trend; picks which stocks of a sector get the deep analysis
 *   sector layer               medians of 1W / 1M / 3M / 6M returns and breadth (share above EMA50 / EMA200);
 *                              strength 0-100 = percentile among sectors (1M 30%, 3M 30%, 6M 15%, breadth 25%)
 *   deep layer (top N / sector) 18-step fundamentals + technical entry;
 *                              composite = 40% fundamentals + 35% growth + 25% technical setup
 */
import { emaSeries, rsiSeries } from '../../analysis/technicals.js';
import type { AnalysisResult } from '../../selection/domain/index.js';
import type { Bar, ScreenResult } from '../../winners/domain/periods.js';
import { momentumScore, technicalPoints, type MarketDistribution } from '../../winners/domain/rank.js';

export interface TrendFacts {
  close: number;
  chg1w: number | null;        // fraction, vs 5 sessions back
  above50: boolean;
  above200: boolean | null;    // null with < 200 sessions
  rsi: number | null;
  fromHigh52: number;          // % below the 52-week closing high (<= 0)
}

export interface GrowthFacts { salesCagr: number | null; patCagr: number | null; roe: number | null; debtToEquity: number | null }

export interface Checks { fundamentals: boolean; growth: boolean; momentum: boolean; trend: boolean; entry: boolean }

export interface SectorStats {
  sector: string;
  stocks: number;
  med1w: number | null; med1m: number | null; med3m: number | null; med6m: number | null;   // fractions
  breadth50: number;           // share of stocks above EMA50 (0-1)
  breadth200: number;
  upWeek: number;              // share of stocks up over the last week
  strength: number;            // 0-100, relative to the other sectors
  label: 'Strong' | 'Neutral' | 'Weak';
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function trendFacts(b: Bar[]): TrendFacts | null {
  if (b.length < 60) return null;
  const close = b.map((x) => x.close);
  const last = close.length - 1;
  const e50 = emaSeries(close, 50)[last];
  const e200 = close.length >= 200 ? emaSeries(close, 200)[last] : null;
  const hi = Math.max(...close.slice(-250));
  return {
    close: close[last],
    chg1w: last >= 5 ? close[last] / close[last - 5] - 1 : null,
    above50: close[last] > e50,
    above200: e200 == null ? null : close[last] > e200,
    rsi: rsiSeries(close, 14)[last] ?? null,
    fromHigh52: r1((close[last] / hi - 1) * 100),
  };
}

export function trendScore(t: TrendFacts): number {
  return (t.above50 ? 40 : 0) + (t.above200 ? 40 : 0) + (t.rsi != null && t.rsi >= 40 && t.rsi <= 70 ? 20 : 0);
}

export function priceScore(s: ScreenResult, t: TrendFacts, m: MarketDistribution): number {
  return r1(0.7 * momentumScore(s, m) + 0.3 * trendScore(t));
}

const median = (v: (number | null)[]) => {
  const x = v.filter((y): y is number => y != null).sort((a, b) => a - b);
  if (!x.length) return null;
  const h = x.length >> 1;
  return x.length % 2 ? x[h] : (x[h - 1] + x[h]) / 2;
};

/** Share (0-1) of `all` strictly below `v`, ties counted half: a rank percentile that works for ~20 sectors. */
function rankPct(all: (number | null)[], v: number | null): number {
  const xs = all.filter((y): y is number => y != null);
  if (v == null || xs.length < 2) return 0.5;
  const below = xs.filter((y) => y < v).length, eq = xs.filter((y) => y === v).length - 1;
  return (below + eq / 2) / (xs.length - 1);
}

export function sectorStats(rows: { sector: string; screen: ScreenResult; trend: TrendFacts }[]): SectorStats[] {
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(r.sector, [...(groups.get(r.sector) ?? []), r]);
  const base = [...groups].map(([sector, g]) => ({
    sector,
    stocks: g.length,
    med1w: median(g.map((r) => r.trend.chg1w)),
    med1m: median(g.map((r) => r.screen.ret1m)),
    med3m: median(g.map((r) => r.screen.ret3m)),
    med6m: median(g.map((r) => r.screen.ret6m)),
    breadth50: g.filter((r) => r.trend.above50).length / g.length,
    breadth200: g.filter((r) => r.trend.above200).length / g.length,
    upWeek: g.filter((r) => (r.trend.chg1w ?? 0) > 0).length / g.length,
  }));
  const col = <K extends keyof (typeof base)[number]>(k: K) => base.map((s) => s[k] as number | null);
  return base.map((s) => {
    const strength = Math.round(100 * (0.3 * rankPct(col('med1m'), s.med1m) + 0.3 * rankPct(col('med3m'), s.med3m)
      + 0.15 * rankPct(col('med6m'), s.med6m) + 0.25 * rankPct(col('breadth50'), s.breadth50)));
    return { ...s, strength, label: (strength >= 65 ? 'Strong' : strength <= 35 ? 'Weak' : 'Neutral') as SectorStats['label'] };
  }).sort((a, b) => b.strength - a.strength);
}

/** Sales / profit growth, ROE and debt from the 18-step results (fractions; null when the statements lack them). */
export function growthFacts(a: AnalysisResult): GrowthFacts {
  const m = (step: number, key: string) => num(a.steps.find((s) => s.step === step)?.metrics[key]);
  return { salesCagr: m(3, 'salesCagr'), patCagr: m(4, 'patCagr'), roe: m(8, 'roe'), debtToEquity: m(7, 'debtToEquity') };
}

export function checks(a: AnalysisResult, s: ScreenResult, t: TrendFacts, g: GrowthFacts, waitMin: number): Checks {
  return {
    fundamentals: !a.gateTriggered && a.totalScore >= waitMin,
    growth: (g.salesCagr ?? -1) > 0 && (g.patCagr ?? -1) > 0,
    momentum: (s.ret3m ?? -1) > 0 && (s.ret6m ?? -1) > 0,
    trend: t.above50 && t.above200 !== false,
    entry: a.verdict === 'BUY',
  };
}

export function leaderScores(a: AnalysisResult, s: ScreenResult, m: MarketDistribution) {
  const growthScore = momentumScore(s, m);
  const technicalScore = technicalPoints(a);
  const fundamentalScore = a.totalScore;
  return { fundamentalScore, growthScore, technicalScore, composite: r1(0.4 * fundamentalScore + 0.35 * growthScore + 0.25 * technicalScore) };
}

/** A leader passes when fundamentals, business growth, price growth and trend are all positive (entry is shown, not required). */
export const qualifies = (c: Checks) => c.fundamentals && c.growth && c.momentum && c.trend;
