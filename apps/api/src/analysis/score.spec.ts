import { describe, expect, it } from 'vitest';
import { analyse, type AnalysisInput } from './score.js';

const strong: AnalysisInput = {
  status: 'listed',
  sector: 'Capital Goods',
  price: { close: 500, dma50: 470, dma200: 420, fromHigh52: -5, rs6m: 12, rsi14: 58, atrPct: 2.5, turnoverCr: 40, deliveryAvg: 48 },
  fundamentals: { ok: true, roe3yAvg: 0.22, roce: 0.25, debtToEquity: 0.1, interestCoverage: 20, salesCagr: 0.18, profitCagr: 0.25, operatingMargin: 0.18, cfoToPat: 1.0, insiderHolding: 0.6, pe: 35, netIncomePositive: true },
  industry: { index: 'Nifty Capital Goods', pe: 44 },
  sentiment: { score: 0.2, headlines: 5, severe: false },
  circuitEventsLast12m: 0,
  today: '2026-10-04',
};

describe('stock analysis score', () => {
  it('a high-quality, fairly valued uptrend scores Strong buy', () => {
    const r = analyse(strong);
    expect(r.verdict).toBe('STRONG_BUY');
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.redFlags).toHaveLength(0);
  });
  it('a loss-making company is capped to Avoid', () => {
    const r = analyse({ ...strong, fundamentals: { ...strong.fundamentals, netIncomePositive: false } });
    expect(r.verdict).toBe('AVOID');
    expect(r.redFlags).toContain('company is loss-making');
  });
  it('results within 7 days downgrade to Watch', () => {
    const r = analyse({ ...strong, fundamentals: { ...strong.fundamentals, nextEarnings: '2026-10-08' } });
    expect(r.verdict).toBe('WATCH');
  });
  it('missing data is excluded, not counted as failure', () => {
    const r = analyse({ ...strong, fundamentals: { ok: false } });
    expect(r.checks.find((c) => c.id === 'roe')!.pass).toBeNull();
    expect(r.groups.find((g) => g.key === 'quality')!.score).toBeNull();
    expect(r.score).not.toBeNull();
  });
  it('debt checks do not apply to lenders', () => {
    const r = analyse({ ...strong, sector: 'Financial Services', fundamentals: { ...strong.fundamentals, debtToEquity: 6 } });
    expect(r.checks.find((c) => c.id === 'de')!.pass).toBeNull();
    expect(r.redFlags).not.toContain('very high debt (D/E > 2)');
  });
  it('a stock with under 60 sessions of history is capped at Buy', () => {
    const r = analyse({ ...strong, price: { ...strong.price!, sessions: 11 } })
    expect(r.verdict).toBe('BUY');
    expect(r.notes.join(' ')).toContain('11 sessions');
  });
  it('an upcoming IPO with only subscription data reports not enough data', () => {
    const r = analyse({ status: 'upcoming', sector: null, ipo: { recent: true, subscription: { qib: 180, nii: 115, retail: 30, total: 92 } } });
    expect(r.verdict).toBe('NOT_ENOUGH_DATA');
    expect(r.score).toBeNull();
    expect(r.checks.find((c) => c.id === 'qib')!.pass).toBe(true);
  });
});
