/**
 * Domain types for the 18-step stock selection engine (proposal sections 5-6, 8.6).
 * Everything in selection/domain is pure: no NestJS, TypeORM, HTTP or file I/O, so it can be unit-tested with plain objects.
 */
import type { SelectionConfig, SectorTemplate } from './config.js';

export type Verdict = 'BUY' | 'WAIT' | 'AVOID';
export type Phase = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type Status = 'pass' | 'watch' | 'fail' | 'na';
export type FlagLevel = 1 | 2 | 3;
export type FlagCategory = 'accounting' | 'governance' | 'financial' | 'market' | 'business';

export const PHASES: Record<Phase, string> = {
  A: 'Understand',
  B: 'Financial strength',
  C: 'Quality and trust',
  D: 'Tradability and price',
  E: 'Events and risk filter',
  F: 'Execution',
};

/** One scored metric inside a step. `frac` is the 0-1 share of the metric's points earned (null = no data). */
export interface MetricResult {
  key: string;
  label: string;
  value: number | string | boolean | null;
  display: string;
  standard: string;
  weight: number;
  frac: number | null;
  status: Status;
  note?: string;
}

export interface StepResult {
  step: number;
  name: string;
  phase: Phase;
  score: number;
  maxScore: number;
  /** false when the step does not apply to this sector template (excluded from the score and from coverage). */
  applicable: boolean;
  /** share (0-1) of the step's metric weight that had data */
  coverage: number;
  gate: boolean;
  status: Status;
  flags: string[];
  metrics: Record<string, number | string | boolean | null>;
  details: MetricResult[];
  note?: string;
}

export interface RedFlag {
  category: FlagCategory;
  level: FlagLevel;
  title: string;
  source: 'rule' | 'announcement' | 'news' | 'manual' | 'llm';
  status: 'auto' | 'suggested' | 'confirmed' | 'resolved';
  link?: string | null;
  date?: string | null;
}

export interface Catalyst {
  title: string;
  kind: string;
  date: string | null;
  link?: string | null;
}

export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number | null;   // INR
  deliveryPct: number | null;
}

export interface IndexPoint { date: string; close: number }

/** Annual / quarterly statement table: values aligned to `periods`, newest first, INR crore (eps and shares are raw). */
export interface StatementTable {
  periods: string[];
  [field: string]: (number | null)[] | string[];
}

export interface Announcement { date: string; category: string; text: string; link: string | null; id: string }

export interface CompanyData {
  statements?: {
    ok: boolean; name?: string | null; yahooSector?: string | null; yahooIndustry?: string | null; summary?: string | null;
    marketCapCr?: number | null; enterpriseValueCr?: number | null; pe?: number | null; pb?: number | null; evToEbitda?: number | null;
    currentRatio?: number | null; quickRatio?: number | null; trailingEps?: number | null; dividendYield?: number | null;
    annual?: StatementTable; quarterly?: StatementTable;
  } | null;
  holding?: {
    ok: boolean;
    promoterHistory: { quarter: string; promoter: number | null; public: number | null }[];
    pledge: { asOf: string | null; pledgedPctOfPromoter: number | null; pledgedPctOfTotal: number | null; promoterPct: number | null } | null;
  } | null;
  announcements?: { ok: boolean; items: Announcement[] } | null;
  peHistory?: { months: number; current: number; median: number; percentile: number } | null;
}

export interface AnalysisContext {
  symbol: string;
  name: string | null;
  sector: string | null;
  asOf: string;
  template: SectorTemplate;
  config: SelectionConfig;
  prices: PriceBar[];            // split-adjusted, oldest first
  benchmark: IndexPoint[];       // Nifty 50, oldest first
  sectorIndex: { name: string; points: IndexPoint[] } | null;
  company: CompanyData | null;
  sectorMedian: { evToEbitda: number | null; pe: number | null } | null;
  /** ASM / GSM list names for this symbol; null when the surveillance list could not be loaded. */
  surveillance: string[] | null;
  /** Flags stored in the database (manual, or suggested and then confirmed). */
  storedFlags: RedFlag[];
}

export interface StepAnalyzer {
  readonly step: number;
  readonly name: string;
  readonly phase: Phase;
  analyze(ctx: AnalysisContext, shared: SharedFacts): StepResult;
}

/** Facts computed once and shared between analyzers (so step 16 can see what step 7 or 13 found). */
export interface SharedFacts {
  redFlags: RedFlag[];
  catalysts: Catalyst[];
  adtvCr: number | null;
  valuationStretched: boolean;
}
