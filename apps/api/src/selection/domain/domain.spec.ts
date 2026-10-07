import { classifyAnnouncements } from './announcements.js';
import { DEFAULT_CONFIG, normaliseConfig, resolveTemplate, templateKeyFor, validateConfig } from './config.js';
import { analyzeStock, DecisionEngine } from './engine.js';
import { portfolioRisk, positionSize } from './risk.js';
import { bandFrac, scoreHigher, scoreLower } from './scoring.js';
import { cagr, risingStreak, slope, yoy } from './series.js';
import { candlePatterns, levelZones } from './technical.js';
import type { AnalysisContext, CompanyData, PriceBar, StepResult } from './types.js';

describe('scoring helpers (proposal 8.6)', () => {
  it('interpolates linearly between bad and good', () => {
    expect(scoreHigher(0.2, 0.15, 0.08, 10)).toBe(10);
    expect(scoreHigher(0.08, 0.15, 0.08, 10)).toBe(0);
    expect(scoreHigher(0.115, 0.15, 0.08, 10)).toBeCloseTo(5);
    expect(scoreLower(0.5, 0.5, 1, 4)).toBe(4);
    expect(scoreLower(0.75, 0.5, 1, 4)).toBeCloseTo(2);
    expect(scoreLower(2, 0.5, 1, 4)).toBe(0);
  });
  it('infers direction from the band', () => {
    expect(bandFrac(30, { good: 25, bad: 5 })).toBe(1);
    expect(bandFrac(0.3, { good: 0.1, bad: 0.25 })).toBe(0);
  });
});

describe('series helpers (newest first)', () => {
  it('computes CAGR, yoy, slope and streaks', () => {
    expect(cagr([200, 150, 100])).toBeCloseTo(Math.SQRT2 - 1);
    expect(yoy([110, 100])[0]).toBeCloseTo(0.1);
    expect(yoy([10, -10])[0]).toBeCloseTo(2);   // from a loss of 10 to a profit of 10
    expect(slope([0.3, 0.2, 0.1])).toBeCloseTo(0.1);
    expect(risingStreak([40, 35, 30, 20])).toBe(3);
    expect(risingStreak([30, 35, 30])).toBe(0);
  });
});

describe('position size (proposal 6.6 worked example)', () => {
  const r = positionSize({ capital: 500000, riskPct: 1, entry: 250, stop: 235, adtvCr: 10, marketCapCr: 120000, capLargePct: 10, capMidSmallPct: 5, largeCapMinCr: 100000, liquidityPctOfAdtv: 1 });
  it('takes the minimum of risk, cap and liquidity quantities', () => {
    expect(r.qtyByRisk).toBe(333);
    expect(r.qtyByCap).toBe(200);
    expect(r.qtyByLiquidity).toBe(4000);
    expect(r.qty).toBe(200);
    expect(r.binding).toBe('positionCap');
    expect(r.actualRisk).toBe(3000);
    expect(r.actualRiskPctOfCapital).toBe(0.6);
  });
  it('uses the 5% cap for mid and small caps', () => {
    expect(positionSize({ capital: 500000, riskPct: 1, entry: 250, stop: 235, adtvCr: 10, marketCapCr: 5000, capLargePct: 10, capMidSmallPct: 5, largeCapMinCr: 100000, liquidityPctOfAdtv: 1 }).qty).toBe(100);
  });
  it('rejects a stop above the entry', () => {
    expect(positionSize({ capital: 1e5, riskPct: 1, entry: 100, stop: 101, adtvCr: 1, marketCapCr: 1, capLargePct: 10, capMidSmallPct: 5, largeCapMinCr: 1e5, liquidityPctOfAdtv: 1 }).ok).toBe(false);
  });
  it('reports portfolio limit breaches', () => {
    const p = portfolioRisk([{ symbol: 'A', sector: 'IT', qty: 100, entry: 1000, stop: 900 }, { symbol: 'B', sector: 'IT', qty: 100, entry: 500, stop: 450 }], 500000, 25, 6);
    expect(p.sectors[0].pct).toBe(30);
    expect(p.totalOpenRiskPct).toBe(3);
    expect(p.breaches).toHaveLength(1);
  });
});

const step = (n: number, score: number, maxScore: number, gate = false): StepResult => ({
  step: n, name: `s${n}`, phase: 'B', score, maxScore, applicable: true, coverage: 1, gate, status: 'pass', flags: gate ? ['GATE: test gate'] : [], metrics: {}, details: [],
});

describe('DecisionEngine', () => {
  const base = { buyMin: 75, waitMin: 60, minCoverageForBuy: 0.7, coverage: 1 };
  it('reproduces the Example Ltd walk-through (6.8): 80 points, stretched valuation -> WAIT', () => {
    const scores = [[3, 4], [5, 6], [8, 10], [6, 8], [6, 7], [10, 12], [9, 10], [8, 10], [4, 5], [5, 6], [3, 4], [4, 5], [4, 4], [4, 7], [1, 2]];
    const steps = scores.map(([s, m], i) => step(i + 1, s, m));
    const total = steps.reduce((a, s) => a + s.score, 0);
    expect(total).toBe(80);
    expect(new DecisionEngine().decide({ ...base, steps, totalScore: total, technicalReady: false, valuationStretched: true }).verdict).toBe('WAIT');
    expect(new DecisionEngine().decide({ ...base, steps, totalScore: total, technicalReady: true, valuationStretched: false }).verdict).toBe('BUY');
  });
  it('any gate forces AVOID regardless of score', () => {
    const d = new DecisionEngine().decide({ ...base, steps: [step(7, 10, 10, true)], totalScore: 95, technicalReady: true, valuationStretched: false });
    expect(d.verdict).toBe('AVOID');
    expect(d.reasons[0]).toContain('test gate');
  });
  it('score below 60 is AVOID; low coverage blocks BUY', () => {
    expect(new DecisionEngine().decide({ ...base, steps: [], totalScore: 55, technicalReady: true, valuationStretched: false }).verdict).toBe('AVOID');
    expect(new DecisionEngine().decide({ ...base, coverage: 0.5, steps: [], totalScore: 90, technicalReady: true, valuationStretched: false }).verdict).toBe('WAIT');
  });
});

describe('announcement classifier', () => {
  it('suggests red flags and finds catalysts', () => {
    const r = classifyAnnouncements([
      { date: '2026-09-01T10:00:00', category: 'Resignation of Auditor', text: 'Statutory auditor has resigned with immediate effect', link: null, id: '1' },
      { date: '2026-09-02T10:00:00', category: 'General Updates', text: 'Company has received an order worth Rs 500 crore from NHAI', link: null, id: '2' },
      { date: '2026-09-03T10:00:00', category: 'Credit Rating', text: 'CRISIL has reaffirmed the rating with stable outlook', link: null, id: '3' },
    ]);
    expect(r.flags).toHaveLength(1);
    expect(r.flags[0]).toMatchObject({ level: 3, category: 'accounting', status: 'suggested' });
    expect(r.catalysts.map((c) => c.kind)).toEqual(['Order win']);
  });
  it('recognises NSE "informed the Exchange about order of" wording but not court orders', () => {
    const r = classifyAnnouncements([
      { date: '2026-09-30T13:48:43', category: 'General Updates', text: 'ACE has informed the Exchange about order of ACE Backhoe Loaders for Ministry of Defence', link: null, id: '1' },
      { date: '2026-09-29T10:00:00', category: 'Updates', text: 'Order of the Honble High Court in the matter of a tax dispute', link: null, id: '2' },
    ]);
    expect(r.catalysts).toHaveLength(1);
    expect(classifyAnnouncements([{ date: '2026-07-15T10:00:00', category: 'Updates', text: 'Receipt of approval from the Reserve Bank of India for appointment of Mr X as Part-time Chairman', link: null, id: '3' }]).catalysts).toHaveLength(0);
  });
});

describe('templates and config', () => {
  it('picks sector templates', () => {
    expect(templateKeyFor('Financial Services', null, 100)).toBe('financial');
    expect(templateKeyFor('Information Technology', 'Technology', -5)).toBe('lossMaking');
    expect(templateKeyFor('Metals & Mining', null, 100)).toBe('cyclical');
    expect(templateKeyFor('Power', null, 100)).toBe('capitalIntensive');
    expect(resolveTemplate(DEFAULT_CONFIG, 'capitalIntensive').thresholds.debtToEquity).toEqual({ good: 1, bad: 2 });
  });
  it('default weights add up to 100 and validate', () => {
    expect(validateConfig(DEFAULT_CONFIG)).toEqual([]);
    const bad = normaliseConfig({ ...DEFAULT_CONFIG, weights: { ...DEFAULT_CONFIG.weights, 6: 20 } });
    expect(validateConfig(bad)[0]).toContain('add up to 100');
  });
});

// ---- full engine run on a synthetic company ------------------------------------------------------
function bars(n: number, f: (i: number) => number, vol = 200000): PriceBar[] {
  const out: PriceBar[] = [];
  for (let i = 0; i < n; i++) {
    const c = f(i);
    const d = new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    out.push({ date: d, open: c * 0.995, high: c * 1.01, low: c * 0.99, close: c, volume: vol, turnover: c * vol, deliveryPct: 45 });
  }
  return out;
}

const goodCompany: CompanyData = {
  statements: {
    ok: true, name: 'Good Co', marketCapCr: 20000, enterpriseValueCr: 19500, pe: 25, evToEbitda: 15, currentRatio: 2, quickRatio: 1.4,
    annual: {
      periods: ['2026-03-31', '2025-03-31', '2024-03-31', '2023-03-31', '2022-03-31'],
      revenue: [2000, 1700, 1450, 1250, 1050], grossProfit: [800, 680, 580, 500, 420], operatingIncome: [400, 330, 280, 240, 200], ebitda: [450, 375, 320, 275, 230],
      ebit: [420, 350, 300, 255, 215], pbt: [410, 340, 290, 245, 205], pat: [300, 250, 210, 180, 150], eps: [30, 25, 21, 18, 15],
      interestIncome: [10, 8, 7, 6, 5], otherNonOperating: [2, 2, 2, 2, 2], interestExpense: [10, 10, 10, 10, 10],
      totalAssets: [2500, 2200, 1900, 1650, 1450], currentLiabilities: [500, 450, 400, 350, 300], equity: [1800, 1550, 1350, 1170, 1020],
      totalDebt: [100, 100, 100, 100, 100], currentDebt: [20, 20, 20, 20, 20], cash: [300, 250, 200, 150, 120],
      receivables: [300, 260, 225, 195, 165], inventory: [200, 175, 150, 130, 110], payables: [180, 155, 130, 115, 95],
      currentAssets: [900, 800, 700, 600, 520], cfo: [280, 230, 200, 160, 140], fcf: [200, 160, 140, 110, 90], capex: [-80, -70, -60, -50, -50], shares: [1e8, 1e8, 1e8, 1e8, 1e8],
    },
    quarterly: { periods: ['2026-06-30'], pat: [80] },
  },
  holding: { ok: true, promoterHistory: [{ quarter: '2026-06-30', promoter: 60, public: 40 }, { quarter: '2025-06-30', promoter: 59.5, public: 40.5 }], pledge: { asOf: null, pledgedPctOfPromoter: 0, pledgedPctOfTotal: 0, promoterPct: 60 } },
  announcements: { ok: true, items: [] },
  peHistory: { months: 48, current: 25, median: 28, percentile: 40 },
};

function ctx(over: Partial<AnalysisContext> = {}): AnalysisContext {
  const prices = bars(300, (i) => 100 + i * 0.4 + 6 * Math.sin(i / 8));
  return {
    symbol: 'GOOD', name: 'Good Co', sector: 'Capital Goods', asOf: prices.at(-1)!.date, config: DEFAULT_CONFIG, template: resolveTemplate(DEFAULT_CONFIG, 'standard'),
    prices, benchmark: prices.map((p, i) => ({ date: p.date, close: 1000 + i })), sectorIndex: { name: 'Nifty Capital Goods', points: prices.map((p, i) => ({ date: p.date, close: 500 + i * 2 })) },
    company: goodCompany, sectorMedian: { evToEbitda: 18, pe: 30 }, surveillance: [], storedFlags: [], ...over,
  };
}

describe('analyzeStock', () => {
  it('scores a strong company highly with every step present', () => {
    const r = analyzeStock(ctx());
    expect(r.steps.map((s) => s.step)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(r.gateTriggered).toBe(false);
    expect(r.totalScore).toBeGreaterThanOrEqual(75);
    expect(r.coverage).toBeGreaterThan(0.9);
    expect(['BUY', 'WAIT']).toContain(r.verdict);
    expect(r.technical).not.toBeNull();
    expect(r.position?.ok).toBe(true);
  });
  it('surveillance listing is a hard gate', () => {
    const r = analyzeStock(ctx({ surveillance: ['LT-ASM Stage I'] }));
    expect(r.verdict).toBe('AVOID');
    expect(r.gates.join(' ')).toContain('surveillance');
  });
  it('promoter pledge above 50% is a hard gate', () => {
    const r = analyzeStock(ctx({ company: { ...goodCompany, holding: { ...goodCompany.holding!, pledge: { asOf: null, pledgedPctOfPromoter: 62, pledgedPctOfTotal: 37, promoterPct: 60 } } } }));
    expect(r.verdict).toBe('AVOID');
    expect(r.gates[0]).toContain('pledge');
  });
  it('a confirmed level-3 flag gates; a suggested one does not', () => {
    const flag = { category: 'accounting' as const, level: 3 as const, title: 'Auditor resignation: x', source: 'manual' as const };
    expect(analyzeStock(ctx({ storedFlags: [{ ...flag, status: 'suggested' }] })).gateTriggered).toBe(false);
    expect(analyzeStock(ctx({ storedFlags: [{ ...flag, status: 'confirmed' }] })).verdict).toBe('AVOID');
  });
  it('illiquid stocks are gated', () => {
    const r = analyzeStock(ctx({ prices: bars(300, (i) => 100 + i * 0.2, 1000) }));
    expect(r.gates.some((g) => g.includes('traded value'))).toBe(true);
  });
  it('financial template skips debt, cash flow and working capital', () => {
    const r = analyzeStock(ctx({ template: resolveTemplate(DEFAULT_CONFIG, 'financial') }));
    expect(r.steps.filter((s) => !s.applicable).map((s) => s.step)).toEqual([6, 7, 9]);
  });
  it('missing statements lower coverage and block BUY', () => {
    const r = analyzeStock(ctx({ company: null }));
    expect(r.coverage).toBeLessThan(0.5);
    expect(r.verdict).not.toBe('BUY');
  });
});

describe('technical helpers', () => {
  it('detects a bullish engulfing candle', () => {
    const b = bars(10, (i) => 100 - i);
    b[8] = { ...b[8], open: 93, close: 91, high: 93.5, low: 90.5 };
    b[9] = { ...b[9], open: 90.5, close: 94, high: 94.5, low: 90, volume: 400000 };
    const p = candlePatterns(b, 2);
    expect(p.some((x) => x.name === 'Bullish engulfing' && x.volumeRatio >= 1.9)).toBe(true);
  });
  it('clusters swing levels into zones', () => {
    const z = levelZones([{ i: 1, date: 'a', price: 100, kind: 'L', label: null }, { i: 2, date: 'b', price: 100.8, kind: 'L', label: null }, { i: 3, date: 'c', price: 120, kind: 'H', label: null }], 110, 1.5);
    expect(z).toHaveLength(2);
    expect(z[0]).toMatchObject({ kind: 'support', touches: 2 });
    expect(z[1].kind).toBe('resistance');
  });
});
