import { describe, expect, it } from 'vitest';
import { emaSeries, fairValueGaps, fibonacci, findSwings, marketStructure, rsiSeries, technicals, tradePlans, type TBar } from './technicals.js';

const bar = (i: number, close: number, spread = 1): TBar => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, open: close, high: close + spread, low: close - spread, close });
const path = (closes: number[]) => closes.map((c, i) => bar(i, c));

describe('technicals', () => {
  it('EMA and RSI match textbook values', () => {
    expect(emaSeries([1, 2, 3], 3)).toEqual([1, 1.5, 2.25]);
    const up = rsiSeries(Array.from({ length: 30 }, (_, i) => 100 + i));
    expect(up.at(-1)).toBe(100);
    expect(up[5]).toBeNull();
  });

  it('labels swings and flags BOS then CHoCH', () => {
    // up, pull back, higher high (BOS up) ... then a collapse below the last swing low (CHoCH down)
    const b = path([10, 12, 14, 16, 14, 13, 12, 13, 15, 17, 19, 21, 18, 16, 15, 16, 17, 14, 11, 9, 8, 7, 6]);
    const sw = findSwings(b, 2);
    expect(sw.some((s) => s.label === 'HH')).toBe(true);
    const ms = marketStructure(b, sw, 2);
    expect(ms.events.map((e) => `${e.type}-${e.dir}`)).toEqual(['BOS-up', 'CHoCH-down']);
    expect(ms.trend).toBe('bearish');
  });

  it('fibonacci of an up-leg retraces down from the high', () => {
    const b = path([...Array.from({ length: 21 }, (_, i) => 100 + i * 5), 170]);   // leg 99 -> 201, close 170
    const f = fibonacci(b)!;
    expect(f.dir).toBe('up');
    expect(f.levels.find((l) => l.ratio === 0.5)!.price).toBe(150);
    expect(f.levels.find((l) => l.ratio === 1.618)!.price).toBeCloseTo(99 + 1.618 * 102, 1);
  });

  it('finds an unfilled bullish fair value gap', () => {
    const b: TBar[] = [bar(0, 100), bar(1, 100), { date: 'x', open: 101, high: 108, low: 100.5, close: 107 }, { date: 'y', open: 107, high: 110, low: 104, close: 109 }];
    const g = fairValueGaps(b);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ dir: 'bull', bottom: 101, top: 104 });
  });

  it('trade plans are exactly 1 : 3', () => {
    const p = tradePlans(200, 4, null, null);
    expect(p.long.riskPct).toBe(3);
    expect(p.long.stop).toBe(194);
    expect(p.long.target).toBe(218);
    expect(p.short.stop).toBe(206);
    expect(p.short.target).toBe(182);
  });

  it('returns null for a short history', () => {
    expect(technicals(path([1, 2, 3]))).toBeNull();
  });
});
