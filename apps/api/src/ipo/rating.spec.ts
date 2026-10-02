import { describe, expect, it } from 'vitest';
import { purchaseRating, type RatingInput } from './rating.js';

const base: RatingInput = {
  fundamentals: { verdict: 'PASS', qualityScore: 85 },
  sentiment: { score: 0.3, headlines: 6, severe: false },
  weeks: { up: 6, total: 6 },
  months: { up: 2, total: 2 },
  vsIssue: 45,
  fromHigh: -3,
  listingGain: 30,
  deliveryAvg: 55,
  turnoverCr: 40,
  market: { regime: 'BULLISH', breadth50: 0.6, fiiIndexLongRatio: 0.6 },
};

describe('purchaseRating', () => {
  it('rates a strong, consistent IPO highly', () => {
    const r = purchaseRating(base);
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.grade).toBe('STRONG_BUY');
    expect(r.components).toHaveLength(5);
  });
  it('weights sum to 1', () => {
    expect(purchaseRating(base).components.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1);
  });
  it('vetoes on AVOID fundamentals regardless of momentum', () => {
    const r = purchaseRating({ ...base, fundamentals: { verdict: 'AVOID', qualityScore: 20 } });
    expect(r.grade).toBe('AVOID');
    expect(r.vetoes).toContain('fundamentals rated AVOID');
  });
  it('vetoes on a red-flag headline', () => {
    const r = purchaseRating({ ...base, sentiment: { score: -0.8, headlines: 3, severe: true } });
    expect(r.grade).toBe('AVOID');
  });
  it('a weak market and falling price lower the grade', () => {
    const r = purchaseRating({ ...base, weeks: { up: 1, total: 6 }, months: { up: 0, total: 2 }, vsIssue: -15, fromHigh: -35, market: { regime: 'DEFENSIVE', breadth50: 0.2, fiiIndexLongRatio: 0.1 } });
    expect(['WATCH', 'AVOID']).toContain(r.grade);
  });
  it('missing data stays neutral, not extreme', () => {
    const r = purchaseRating({ ...base, fundamentals: null, sentiment: null, listingGain: null, deliveryAvg: null, turnoverCr: null, market: null });
    expect(r.score).toBeGreaterThan(30);
    expect(r.score).toBeLessThan(80);
  });
});
