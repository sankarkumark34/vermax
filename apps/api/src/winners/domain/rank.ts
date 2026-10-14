/**
 * Ranking of stocks that passed the periodic screen. Pure.
 *
 *   composite = 40% momentum + 35% fundamentals + 25% technical setup
 *
 *   momentum      percentile within the whole liquid market of the 3-month, 6-month and 1-year returns, plus the
 *                 share of up weeks / months (stable even when only a handful of stocks pass)
 *   fundamentals  the 18-step score (steps 1-15, after red-flag penalties)
 *   technical     the proposal's entry rule as points: trend 30, at a level 20, candle trigger 20, not extended 15, R:R 15
 *
 * Stocks with a hard gate or a score below the WAIT level are rejected, never ranked.
 */
import type { AnalysisResult } from '../../selection/domain/index.js';
import type { ScreenResult } from './periods.js';

export interface RankInput { symbol: string; screen: ScreenResult; analysis: AnalysisResult }

export interface RankedRow extends RankInput {
  momentumScore: number;
  technicalScore: number;
  fundamentalScore: number;
  composite: number;
  rank: number;
  action: 'BUY now' | 'Wait for entry';
}

/** Share (0-1) of the reference distribution at or below `v`; 0.5 when unknown. */
export function percentileIn(sorted: number[], v: number | null): number {
  if (v == null || !sorted.length) return 0.5;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= v) lo = mid + 1; else hi = mid; }
  return lo / sorted.length;
}

export interface MarketDistribution { ret3m: number[]; ret6m: number[]; ret1y: number[] }

export function marketDistribution(screens: { ret3m: number | null; ret6m: number | null; ret1y: number | null }[]): MarketDistribution {
  const col = (k: 'ret3m' | 'ret6m' | 'ret1y') => screens.map((s) => s[k]).filter((x): x is number => x != null).sort((a, b) => a - b);
  return { ret3m: col('ret3m'), ret6m: col('ret6m'), ret1y: col('ret1y') };
}

export function technicalPoints(a: AnalysisResult): number {
  const c = a.technical?.checks;
  if (!c) return 0;
  return (c.trendOk ? 30 : 0) + (c.atLevel ? 20 : 0) + (c.triggerConfirmed ? 20 : 0) + (!c.extended ? 15 : 0) + (c.rrOk ? 15 : 0);
}

export function rejected(a: AnalysisResult, waitMin: number): string | null {
  if (a.gateTriggered) return `gate: ${a.gates[0]}`;
  if (a.totalScore < waitMin) return `weak fundamentals (score ${a.totalScore} < ${waitMin})`;
  return null;
}

/** 0-100: market percentile of the 3-month, 6-month and 1-year returns (75%) plus the share of up weeks / months (25%). */
export function momentumScore(s: ScreenResult, market: MarketDistribution): number {
  const w = s.weeksUp.total ? s.weeksUp.up / s.weeksUp.total : 0.5;
  const m = s.monthsUp.total ? s.monthsUp.up / s.monthsUp.total : 0.5;
  const pr = (percentileIn(market.ret3m, s.ret3m) + percentileIn(market.ret6m, s.ret6m) + percentileIn(market.ret1y, s.ret1y)) / 3;
  return Math.round((pr * 0.75 + ((w + m) / 2) * 0.25) * 1000) / 10;
}

export function rankWinners(rows: RankInput[], market: MarketDistribution): RankedRow[] {
  const ranked = rows.map((r) => {
    const momentum = momentumScore(r.screen, market);
    const technicalScore = technicalPoints(r.analysis);
    const fundamentalScore = r.analysis.totalScore;
    const composite = Math.round((0.4 * momentum + 0.35 * fundamentalScore + 0.25 * technicalScore) * 10) / 10;
    return { ...r, momentumScore: momentum, technicalScore, fundamentalScore, composite, rank: 0, action: (r.analysis.verdict === 'BUY' ? 'BUY now' : 'Wait for entry') as RankedRow['action'] };
  });
  ranked.sort((a, b) => (b.action === 'BUY now' ? 1 : 0) - (a.action === 'BUY now' ? 1 : 0) || b.composite - a.composite);
  ranked.forEach((r, i) => (r.rank = i + 1));
  return ranked;
}
