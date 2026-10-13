import { completedPeriods, periodOf, screen, type Bar, type WinnerCriteria } from './periods.js';

const C: WinnerCriteria = { minMonthStreak: 2, maxDrawdown3mPct: 15, maxCurrentDrawdownPct: 10, dipPct: 7, maxRecoverySessions: 20, worstWeekPct: -10, requireFy: true };

/** Weekday bars from `start`, closes produced by f(i). */
function bars(start: string, n: number, f: (i: number, date: string) => number): Bar[] {
  const out: Bar[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; out.length < n; i++) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      const date = d.toISOString().slice(0, 10);
      const c = f(out.length, date);
      out.push({ date, open: c, high: c * 1.005, low: c * 0.995, close: c });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe('periodOf (Indian financial calendar)', () => {
  it('maps weeks, months, FY quarters and financial years', () => {
    expect(periodOf('2026-10-07', 'week')).toMatchObject({ start: '2026-10-05', end: '2026-10-11', label: 'W/e 09 Oct' });
    expect(periodOf('2026-10-07', 'month')).toMatchObject({ start: '2026-10-01', end: '2026-10-31' });
    expect(periodOf('2026-10-07', 'quarter')).toMatchObject({ key: 'FY2027Q3', start: '2026-10-01', end: '2026-12-31' });
    expect(periodOf('2026-05-02', 'quarter')).toMatchObject({ key: 'FY2027Q1', start: '2026-04-01', end: '2026-06-30' });
    expect(periodOf('2027-02-10', 'quarter')).toMatchObject({ key: 'FY2027Q4', start: '2027-01-01', end: '2027-03-31' });
    expect(periodOf('2026-03-31', 'fy')).toMatchObject({ key: 'FY2026', start: '2025-04-01', end: '2026-03-31' });
    expect(periodOf('2026-04-01', 'fy').key).toBe('FY2027');
  });
});

describe('completedPeriods', () => {
  const b = bars('2026-08-03', 50, (i) => 100 + i);   // rising every day, last bar Fri 2026-10-09
  it('treats the running week as complete only after its Friday close or once today is past it', () => {
    const midWeek = b.findIndex((x) => x.date === '2026-10-07');
    expect(completedPeriods(b, midWeek, 'week', '2026-10-07')[0].label).toBe('W/e 02 Oct');
    expect(completedPeriods(b, b.length - 1, 'week', '2026-10-09')[0].label).toBe('W/e 09 Oct');
    expect(completedPeriods(b, midWeek, 'month', '2026-10-07')[0].label).toBe('Sep 2026');
  });
  it('measures each period from the previous period close', () => {
    const w = completedPeriods(b, b.length - 1, 'week', '2026-10-09')[0];
    expect(w.from).toBe('2026-10-02');
    expect(w.ret).toBeCloseTo(149 / 144 - 1);
    expect(w.ok).toBe(true);
  });
});

describe('screen', () => {
  // ~20 months of steady gains with small wiggles: passes everything
  const up = bars('2025-02-03', 430, (i) => 100 * 1.0015 ** i * (1 + 0.003 * Math.sin(i / 3)));
  const today = up.at(-1)!.date;
  it('ticks every period for a steady riser', () => {
    const r = screen(up, up.length - 1, today, C)!;
    expect(r.ticks).toEqual({ week: true, month: true, quarter: true, fy: true, streak: true, resilient: true });
    expect(r.pass).toBe(true);
    expect(r.monthStreak).toBeGreaterThanOrEqual(2);
  });
  it('fails resilience after a sharp fall that has not recovered', () => {
    const crash = up.map((x, i) => (i >= up.length - 15 ? { ...x, close: x.close * 0.8, low: x.close * 0.79, high: x.close * 0.81 } : x));
    const r = screen(crash, crash.length - 1, today, C)!;
    expect(r.ticks.resilient).toBe(false);
    expect(r.resilience.reasons.join(' ')).toMatch(/fell|below|recovered/);
    expect(r.pass).toBe(false);
  });
  it('accepts a dip that recovered quickly and records it', () => {
    const n = up.length;
    const dip = up.map((x, i) => (i >= n - 40 && i < n - 33 ? { ...x, close: x.close * 0.91 } : x));
    const r = screen(dip, n - 1, today, C)!;
    const d = r.resilience.dips.at(-1)!;
    expect(d.depthPct).toBeLessThanOrEqual(-7);
    expect(d.sessionsToRecover).not.toBeNull();
    expect(r.ticks.resilient).toBe(true);
  });
  it('requires the configured month streak', () => {
    // flat for 18 months then the last month positive only
    const b = bars('2025-02-03', 430, (i) => (i < 400 ? 100 - (i % 30 === 0 ? 1 : 0) - i * 0.01 : 96 + (i - 400) * 0.3));
    const r = screen(b, b.length - 1, b.at(-1)!.date, { ...C, maxDrawdown3mPct: 50, maxCurrentDrawdownPct: 50, dipPct: 90 })!;
    expect(r.monthStreak).toBeLessThan(2);
    expect(r.ticks.streak).toBe(false);
  });
});

describe('percentileIn', () => {
  it('ranks a value within the market distribution', async () => {
    const { percentileIn } = await import('./rank.js');
    expect(percentileIn([0.1, 0.2, 0.3, 0.4], 0.35)).toBe(0.75);
    expect(percentileIn([0.1, 0.2], null)).toBe(0.5);
  });
});
