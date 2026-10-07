/**
 * Thresholds, weights and sector templates (proposal 6.1-6.7 and Appendix A).
 * These are DATA: the active version is stored in the `threshold_config` table and can be edited from Settings without a
 * redeploy. Every analysis run records the config version it used, so past verdicts can be reproduced.
 * The defaults are common-practice starting points, not backtested rules.
 */

/** Linear band: full points at or beyond `good`, zero at or beyond `bad`. Works for higher- and lower-is-better metrics. */
export interface Band { good: number; bad: number }

export type TemplateKey = 'standard' | 'financial' | 'cyclical' | 'capitalIntensive' | 'lossMaking';

export interface Thresholds {
  salesCagr: Band; revenueUpYears: Band; receivablesVsSales: Band;
  patCagr: Band; epsCagr: Band; otherIncomeShare: Band;
  opmSlope: Band; grossMarginStd: Band;
  cfoToPat: Band; cfoToEbitda: Band; fcfPositiveYears: Band;
  debtToEquity: Band; netDebtToEbitda: Band; interestCoverage: Band;
  roce: Band; roe: Band; roa: Band; equityMultiplier: Band;
  debtorDaysRises: Band; inventoryDaysRises: Band; cccRises: Band;
  pledgePct: Band; promoterChange: Band;
  roceStd: Band; opmStd: Band;
  adtvCr: Band; deliveryPct: Band; currentRatio: Band; quickRatio: Band; cashToShortDebt: Band;
  pePercentile: Band; peg: Band; fcfYield: Band; earningsYieldSpread: Band; evEbitdaVsSector: Band; evToSales: Band; pbVsSector: Band;
  sectorRs12m: Band; sectorRs3m: Band;
  profitableYears: Band; revenueDrops: Band;
}

export interface SectorTemplate {
  key: TemplateKey;
  label: string;
  description: string;
  /** steps that do not apply (excluded from score and coverage) */
  skipSteps: number[];
  /** metric keys that are replaced by other metrics in this template */
  skipMetrics: string[];
  thresholds: Thresholds;
}

export interface SelectionConfig {
  version: number;
  note: string;
  weights: Record<number, number>;
  verdict: { buyMin: number; waitMin: number; minCoverageForBuy: number };
  gates: { interestCoverageBelow: number; pledgeAbovePct: number; minAdtvCr: number; surveillanceIsGate: boolean; negCfoYearsWithProfit: number };
  penalties: { level2Points: number };
  technical: { extendedAboveEma50Pct: number; minRewardRisk: number; volumeMultiple: number; zoneAtrMultiple: number };
  risk: { capitalInr: number; riskPct: number; capLargePct: number; capMidSmallPct: number; liquidityPctOfAdtv: number; largeCapMinCr: number; sectorCapPct: number; totalOpenRiskPct: number };
  universe: { minAdtvCr: number; maxStocks: number };
  gSecYieldPct: number;
  templates: Record<TemplateKey, Omit<SectorTemplate, 'thresholds'> & { overrides: Partial<Thresholds> }>;
  thresholds: Thresholds;
}

export const STEP_NAMES: Record<number, string> = {
  1: 'Business', 2: 'Industry', 3: 'Revenue', 4: 'Profit', 5: 'Margins', 6: 'Cash flow', 7: 'Debt', 8: 'ROE / ROCE', 9: 'Working capital',
  10: 'Promoter', 11: 'Management', 12: 'Moat', 13: 'Liquidity', 14: 'Valuation', 15: 'Catalyst', 16: 'Red flags', 17: 'Technical entry', 18: 'Risk and position',
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  salesCagr: { good: 0.15, bad: 0.08 },
  revenueUpYears: { good: 0.8, bad: 0.5 },
  receivablesVsSales: { good: 0, bad: 0.1 },          // receivable CAGR minus sales CAGR
  patCagr: { good: 0.15, bad: 0.08 },
  epsCagr: { good: 0.15, bad: 0.08 },
  otherIncomeShare: { good: 0.1, bad: 0.25 },
  opmSlope: { good: 0, bad: -0.02 },                  // change in operating margin per year
  grossMarginStd: { good: 0.02, bad: 0.06 },
  cfoToPat: { good: 0.8, bad: 0.6 },
  cfoToEbitda: { good: 0.7, bad: 0.4 },
  fcfPositiveYears: { good: 0.8, bad: 0.4 },
  debtToEquity: { good: 0.5, bad: 1 },
  netDebtToEbitda: { good: 2, bad: 3 },
  interestCoverage: { good: 4, bad: 2 },
  roce: { good: 0.15, bad: 0.1 },
  roe: { good: 0.15, bad: 0.1 },
  roa: { good: 0.015, bad: 0.007 },
  equityMultiplier: { good: 2.5, bad: 4 },
  debtorDaysRises: { good: 0, bad: 3 },               // consecutive years of rising debtor days
  inventoryDaysRises: { good: 0, bad: 3 },
  cccRises: { good: 0, bad: 3 },
  pledgePct: { good: 0, bad: 25 },
  promoterChange: { good: 0, bad: -5 },               // percentage points over 8 quarters
  roceStd: { good: 0.03, bad: 0.1 },
  opmStd: { good: 0.02, bad: 0.06 },
  adtvCr: { good: 25, bad: 5 },
  deliveryPct: { good: 40, bad: 20 },
  currentRatio: { good: 1.5, bad: 1 },
  quickRatio: { good: 1, bad: 0.7 },
  cashToShortDebt: { good: 1, bad: 0.3 },
  pePercentile: { good: 60, bad: 85 },
  peg: { good: 1, bad: 2 },
  fcfYield: { good: 0.05, bad: 0.02 },
  earningsYieldSpread: { good: 1, bad: -1 },          // earnings yield minus 10y G-Sec, percentage points
  evEbitdaVsSector: { good: 0.9, bad: 1.3 },
  evToSales: { good: 3, bad: 8 },
  pbVsSector: { good: 0.9, bad: 1.5 },
  sectorRs12m: { good: 5, bad: -10 },                 // sector index 12m return minus Nifty 50, points
  sectorRs3m: { good: 2, bad: -5 },
  profitableYears: { good: 1, bad: 0.5 },
  revenueDrops: { good: 0, bad: 2 },                  // years with revenue down > 10%
};

export const DEFAULT_CONFIG: SelectionConfig = {
  version: 1,
  note: 'Proposal v1.0 defaults',
  weights: { 1: 4, 2: 6, 3: 10, 4: 8, 5: 7, 6: 12, 7: 10, 8: 10, 9: 5, 10: 6, 11: 4, 12: 5, 13: 4, 14: 7, 15: 2, 16: 0, 17: 0, 18: 0 },
  verdict: { buyMin: 75, waitMin: 60, minCoverageForBuy: 0.7 },
  gates: { interestCoverageBelow: 1.5, pledgeAbovePct: 50, minAdtvCr: 2, surveillanceIsGate: true, negCfoYearsWithProfit: 3 },
  penalties: { level2Points: 7 },
  technical: { extendedAboveEma50Pct: 20, minRewardRisk: 2, volumeMultiple: 1, zoneAtrMultiple: 0.5 },
  risk: { capitalInr: 500000, riskPct: 1, capLargePct: 10, capMidSmallPct: 5, liquidityPctOfAdtv: 1, largeCapMinCr: 100000, sectorCapPct: 25, totalOpenRiskPct: 6 },
  universe: { minAdtvCr: 5, maxStocks: 800 },
  gSecYieldPct: 6.5,
  thresholds: DEFAULT_THRESHOLDS,
  templates: {
    standard: { key: 'standard', label: 'Standard', description: 'Default metric set', skipSteps: [], skipMetrics: [], overrides: {} },
    financial: {
      key: 'financial', label: 'Banks, NBFCs, insurers',
      description: 'Debt/equity, ROCE, working capital, cash flow and interest coverage are not meaningful for lenders; ROA and ROE are used instead. Capital adequacy, GNPA/NNPA and CASA are not in the free data feed.',
      skipSteps: [6, 7, 9], skipMetrics: ['equityMultiplier', 'debtToEquity', 'netDebtToEbitda', 'interestCoverage', 'roce', 'currentRatio', 'quickRatio', 'cashToShortDebt', 'evEbitdaVsSector', 'fcfYield', 'roceStd', 'grossMarginStd', 'opmSlope', 'opmStd'],
      overrides: {},
    },
    cyclical: {
      key: 'cyclical', label: 'Cyclicals (metals, cement, autos)',
      description: 'Valued on EV/EBITDA and P/B against the sector rather than single-year earnings multiples; growth judged on multi-year averages.',
      skipSteps: [], skipMetrics: ['pePercentile', 'peg'],
      overrides: { salesCagr: { good: 0.12, bad: 0.05 }, patCagr: { good: 0.12, bad: 0.03 } },
    },
    capitalIntensive: {
      key: 'capitalIntensive', label: 'Capital-intensive (power, infrastructure)',
      description: 'Leverage and ROCE are judged with looser absolute bands, since these businesses carry structurally higher debt.',
      skipSteps: [], skipMetrics: [],
      overrides: { debtToEquity: { good: 1, bad: 2 }, netDebtToEbitda: { good: 3.5, bad: 5.5 }, roce: { good: 0.12, bad: 0.08 }, interestCoverage: { good: 3, bad: 1.8 } },
    },
    lossMaking: {
      key: 'lossMaking', label: 'Early-stage or loss-making',
      description: 'P/E is meaningless with negative earnings; EV/Sales and the gross-margin trend are used instead.',
      skipSteps: [], skipMetrics: ['pePercentile', 'peg', 'earningsYieldSpread', 'fcfYield'],
      overrides: {},
    },
  },
};

const CYCLICAL = new Set(['Metals & Mining', 'Construction Materials', 'Automobile and Auto Components', 'Chemicals', 'Textiles', 'Forest Materials']);
const CAPITAL_INTENSIVE = new Set(['Power', 'Construction', 'Oil Gas & Consumable Fuels', 'Telecommunication', 'Realty', 'Utilities']);

/** Picks the sector template: financials first, then loss-making, then sector groups. */
export function templateKeyFor(sector: string | null, yahooSector: string | null | undefined, latestPat: number | null): TemplateKey {
  if (sector === 'Financial Services' || yahooSector === 'Financial Services') return 'financial';
  if (latestPat != null && latestPat <= 0) return 'lossMaking';
  if (sector && CYCLICAL.has(sector)) return 'cyclical';
  if (yahooSector === 'Basic Materials') return 'cyclical';
  if (sector && CAPITAL_INTENSIVE.has(sector)) return 'capitalIntensive';
  if (yahooSector === 'Utilities') return 'capitalIntensive';
  return 'standard';
}

export function resolveTemplate(config: SelectionConfig, key: TemplateKey): SectorTemplate {
  const t = config.templates[key] ?? config.templates.standard;
  return { key: t.key, label: t.label, description: t.description, skipSteps: t.skipSteps, skipMetrics: t.skipMetrics, thresholds: { ...config.thresholds, ...t.overrides } };
}

/** Fills any keys missing from a stored (older) config with current defaults, so new metrics never crash old configs. */
export function normaliseConfig(raw: Partial<SelectionConfig> | null | undefined): SelectionConfig {
  const c = raw ?? {};
  return {
    ...DEFAULT_CONFIG,
    ...c,
    weights: { ...DEFAULT_CONFIG.weights, ...(c.weights ?? {}) },
    verdict: { ...DEFAULT_CONFIG.verdict, ...(c.verdict ?? {}) },
    gates: { ...DEFAULT_CONFIG.gates, ...(c.gates ?? {}) },
    penalties: { ...DEFAULT_CONFIG.penalties, ...(c.penalties ?? {}) },
    technical: { ...DEFAULT_CONFIG.technical, ...(c.technical ?? {}) },
    risk: { ...DEFAULT_CONFIG.risk, ...(c.risk ?? {}) },
    universe: { ...DEFAULT_CONFIG.universe, ...(c.universe ?? {}) },
    thresholds: { ...DEFAULT_THRESHOLDS, ...(c.thresholds ?? {}) },
    templates: Object.fromEntries(
      (Object.keys(DEFAULT_CONFIG.templates) as TemplateKey[]).map((k) => [k, { ...DEFAULT_CONFIG.templates[k], ...(c.templates?.[k] ?? {}) }]),
    ) as SelectionConfig['templates'],
  };
}

/** Validation for config edits from the Settings screen. Returns a list of problems (empty = valid). */
export function validateConfig(c: SelectionConfig): string[] {
  const errs: string[] = [];
  const total = Object.entries(c.weights).filter(([k]) => Number(k) <= 15).reduce((s, [, w]) => s + Number(w), 0);
  if (Math.abs(total - 100) > 0.001) errs.push(`step weights 1-15 must add up to 100 (now ${total})`);
  for (const [k, w] of Object.entries(c.weights)) if (!(Number(w) >= 0)) errs.push(`weight of step ${k} must be >= 0`);
  if (!(c.verdict.buyMin > c.verdict.waitMin)) errs.push('BUY minimum must be above the WAIT minimum');
  if (!(c.verdict.minCoverageForBuy >= 0 && c.verdict.minCoverageForBuy <= 1)) errs.push('minimum coverage must be between 0 and 1');
  for (const [k, b] of Object.entries(c.thresholds)) {
    if (!Number.isFinite(b.good) || !Number.isFinite(b.bad)) errs.push(`threshold ${k} needs numeric good and bad values`);
    else if (b.good === b.bad) errs.push(`threshold ${k}: good and bad must differ`);
  }
  if (!(c.risk.riskPct > 0 && c.risk.riskPct <= 5)) errs.push('risk per trade must be between 0 and 5%');
  return errs;
}
