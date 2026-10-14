import { describe, expect, it } from 'vitest';
import type { Bar } from '../../winners/domain/periods.js';
import { isCandidate, refWindow, steadyFacts, steadyScore } from './steady.js';

/** Business-day bars from `start`, closes from the generator. */
function series(start: string, n: number, f: (i: number) => number): Bar[] {
  const out: Bar[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; out.length < n; i++) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) { const c = f(out.length); out.push({ date: d.toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c }); }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe('steady screen', () => {
  it('uses the listing-day open for a stock that listed inside the window', () => {
    const b = series('2026-03-02', 150, (i) => 100 + i * 0.3);
    const w = refWindow(b, 12, '2026-03-02', true)!;
    expect(w.fromListing).toBe(true);
    expect(w.ref).toBe(100);
    expect(w.minClosePct).toBeGreaterThanOrEqual(0);
    expect(w.sessionsBelow).toBe(0);
  });

  it('uses the first session of the window for an old stock', () => {
    const b = series('2024-01-01', 700, (i) => 100 + i * 0.2);
    const w = refWindow(b, 6, '2015-06-01', false)!;
    expect(w.fromListing).toBe(false);
    expect(w.refDate >= '2026-0').toBe(true);
    expect(w.ref).toBeGreaterThan(150);
  });

  it('flags a close below the reference', () => {
    const b = series('2026-01-05', 200, (i) => (i === 100 ? 90 : 100 + i * 0.1));
    const w = refWindow(b, 12, '2026-01-05', true)!;
    expect(w.sessionsBelow).toBe(1);
    expect(w.minClosePct).toBeLessThan(0);
    expect(w.lastBelow).toBe(b[100].date);
  });

  it('a steady riser has every month and quarter up, an RSI below 100 and passes the candidate filter only when not overbought', () => {
    const b = series('2025-06-02', 330, (i) => 100 * Math.pow(1.0015, i) + Math.sin(i / 3) * 0.8);
    const f = steadyFacts(b, '2010-01-01', '2019-01-01', b.at(-1)!.date)!;
    expect(f.listedInData).toBe(false);
    expect(f.months.length).toBeGreaterThanOrEqual(10);
    expect(f.months.every((m) => m.ret > 0)).toBe(true);
    expect(f.quarters.every((q) => q.ret > 0)).toBe(true);
    expect(f.rsi).not.toBeNull();
    expect(isCandidate({ ...f, rsi: 80 })).toBe(false);
    expect(isCandidate({ ...f, rsi: 55 })).toBe(true);
    expect(steadyScore({ ...f, rsi: 55 })).toBeGreaterThanOrEqual(6);   // 3 months + 2 quarters + RSI in range (+ clean windows)
    expect(steadyScore({ ...f, rsi: 80, months: f.months.map((m) => ({ ...m, ret: -1 })) })).toBe(steadyScore({ ...f, rsi: 55 }) - 4);
  });

  it('compares the first month of a new listing with the listing-day open', () => {
    const b = series('2026-01-20', 180, (i) => 100 + i * 0.4);
    const f = steadyFacts(b, '2026-01-20', '2019-01-01', b.at(-1)!.date)!;
    expect(f.listedInData).toBe(true);
    expect(f.months[0].ret).toBeGreaterThan(0);
  });
});
