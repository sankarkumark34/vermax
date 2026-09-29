import { describe, expect, it } from 'vitest';
import { nextSession, positionSize } from './sizing.js';

describe('positionSize', () => {
  const base = { capital: 500_000, riskPerTrade: 0.01, maxPositionPct: 0.2, regimeMultiplier: 1 };
  it('risks ~1% of capital at the stop', () => {
    const s = positionSize({ ...base, stopPct: 0.05, price: 300 });
    expect(s.riskAmount).toBeGreaterThan(4_500);
    expect(s.riskAmount).toBeLessThanOrEqual(5_000);
  });
  it('caps a tight stop at the max position weight', () => {
    const s = positionSize({ ...base, stopPct: 0.03, price: 250 });
    expect(s.positionPct).toBeLessThanOrEqual(20);
  });
  it('halves risk in a defensive regime', () => {
    const a = positionSize({ ...base, stopPct: 0.06, price: 300 });
    const b = positionSize({ ...base, stopPct: 0.06, price: 300, regimeMultiplier: 0.5 });
    expect(b.qty).toBeLessThan(a.qty);
  });
  it('returns zero for bad inputs', () => {
    expect(positionSize({ ...base, stopPct: 0, price: 300 }).qty).toBe(0);
  });
});

describe('nextSession', () => {
  it('skips the weekend', () => {
    expect(nextSession('2026-09-18')).toBe('2026-09-21'); // Friday -> Monday
    expect(nextSession('2026-09-21')).toBe('2026-09-22');
  });
});
