import { describe, expect, it } from 'vitest';
import type { Bar, ScreenResult } from '../../winners/domain/periods.js';
import { checks, qualifies, sectorStats, trendFacts, trendScore, type GrowthFacts, type TrendFacts } from './sectors.js';

function series(n: number, f: (i: number) => number): Bar[] {
  const out: Bar[] = [];
  const d = new Date('2025-01-01T00:00:00Z');
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) { const c = f(out.length); out.push({ date: d.toISOString().slice(0, 10), open: c, high: c, low: c, close: c }); }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const scr = (ret1m: number, ret3m: number, ret6m: number) => ({ ret1m, ret3m, ret6m, ret1y: ret6m }) as unknown as ScreenResult;
const tr = (above50: boolean, chg1w = 0.01): TrendFacts => ({ close: 100, chg1w, above50, above200: above50, rsi: 55, fromHigh52: -3 });

describe('sector leaders', () => {
  it('reads the trend of a rising stock', () => {
    const t = trendFacts(series(260, (i) => 100 + i))!;
    expect(t.above50).toBe(true);
    expect(t.above200).toBe(true);
    expect(t.fromHigh52).toBe(0);
    expect(t.chg1w).toBeGreaterThan(0);
  });

  it('a falling stock is below its averages and scores low on trend', () => {
    const t = trendFacts(series(260, (i) => 400 - i))!;
    expect(t.above50).toBe(false);
    expect(t.above200).toBe(false);
    expect(trendScore(t)).toBeLessThanOrEqual(20);
  });

  it('ranks the sector with better returns and breadth first', () => {
    const rows = [
      ...[1, 2, 3].map(() => ({ sector: 'IT', screen: scr(0.05, 0.12, 0.2), trend: tr(true) })),
      ...[1, 2, 3].map(() => ({ sector: 'Metals', screen: scr(-0.04, -0.08, -0.1), trend: tr(false, -0.02) })),
      ...[1, 2].map(() => ({ sector: 'Power', screen: scr(0.01, 0.02, 0.05), trend: tr(true) })),
    ];
    const s = sectorStats(rows);
    expect(s.map((x) => x.sector)).toEqual(['IT', 'Power', 'Metals']);
    expect(s[0].label).toBe('Strong');
    expect(s[2].label).toBe('Weak');
    expect(s[0].breadth50).toBe(1);
    expect(s[2].upWeek).toBe(0);
  });

  it('qualifies only with fundamentals, business growth, price growth and trend all positive', () => {
    const a = { gateTriggered: false, totalScore: 70, verdict: 'WAIT' } as never;
    const g: GrowthFacts = { salesCagr: 0.12, patCagr: 0.18, roe: 0.2, debtToEquity: 0.3 };
    const ok = checks(a, scr(0.02, 0.1, 0.15), tr(true), g, 60);
    expect(qualifies(ok)).toBe(true);
    expect(ok.entry).toBe(false);
    expect(qualifies(checks(a, scr(0.02, 0.1, 0.15), tr(true), { ...g, patCagr: -0.05 }, 60))).toBe(false);
    expect(qualifies(checks(a, scr(0.02, -0.01, 0.15), tr(true), g, 60))).toBe(false);
    expect(qualifies(checks({ ...(a as object), gateTriggered: true } as never, scr(0.02, 0.1, 0.15), tr(true), g, 60))).toBe(false);
  });
});
