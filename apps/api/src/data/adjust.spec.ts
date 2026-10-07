import { describe, expect, it } from 'vitest';
import { adjustBars, type RawBar } from './adjust.js';

const b = (date: string, open: number, high: number, low: number, close: number, prevClose: number): RawBar => ({ date, open, high, low, close, prevClose, volume: 1000 });

describe('adjustBars', () => {
  it('adjusts a bonus when PREVCLOSE was not adjusted (LIC-style 1:1)', () => {
    const out = adjustBars([b('1', 820, 835, 815, 830, 825), b('2', 417.6, 421.45, 410, 411.35, 830)]);
    expect(out[0].close).toBeCloseTo(415, 0);
    expect(out[1].close).toBe(411.35);
    expect(out[1].close / out[1].prevClose - 1).toBeGreaterThan(-0.05);
  });
  it('adjusts a split the exchange already reflected in PREVCLOSE', () => {
    const out = adjustBars([b('1', 1000, 1010, 990, 1000, 995), b('2', 101, 103, 99, 102, 100)]);
    expect(out[0].close).toBe(100);
  });
  it('leaves an ordinary series untouched', () => {
    const bars = [b('1', 100, 102, 98, 101, 100), b('2', 101, 106, 100, 105, 101), b('3', 105, 105, 95, 96, 105)];
    expect(adjustBars(bars).map((x) => x.close)).toEqual([101, 105, 96]);
  });
});
