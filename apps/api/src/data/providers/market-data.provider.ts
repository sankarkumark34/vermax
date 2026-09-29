/**
 * Data-layer abstraction. The rest of the system never talks to NSE directly,
 * so swapping in a licensed vendor / official API later only requires a new
 * implementation of this interface.
 */

export interface RawEquityBar {
  symbol: string;
  date: string; // YYYY-MM-DD
  series: string;
  isin: string | null;
  open: number;
  high: number;
  low: number;
  close: number;
  prevClose: number;
  volume: number;
  turnover: number;
  trades: number | null;
}

export interface RawIndexBar {
  indexName: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  changePct: number | null;
  volume: number | null;
  turnoverCr: number | null;
  pe: number | null;
  pb: number | null;
  divYield: number | null;
}

export interface RawDelivery {
  symbol: string;
  tradedQty: number;
  deliveryQty: number;
  deliveryPct: number;
}

export interface UniverseMember {
  symbol: string;
  name: string;
  industry: string;
  isin: string | null;
}

export interface FundamentalsSnapshot {
  symbol: string;
  asOf: string;
  revenueGrowth: number | null;
  profitGrowth: number | null;
  eps: number | null;
  roe: number | null;
  roce: number | null;
  debtToEquity: number | null;
  pe: number | null;
  pb: number | null;
  promoterHolding: number | null;
  institutionalHolding: number | null;
}

export interface SymbolMasterRow {
  symbol: string;
  name: string;
  isin: string | null;
  listingDate: string | null;
}

export interface MarketDataProvider {
  readonly name: string;
  /** Empty array means "no data for that date" (holiday / not yet published). */
  fetchEquityBars(date: string): Promise<RawEquityBar[]>;
  fetchIndexBars(date: string): Promise<RawIndexBar[]>;
  fetchDelivery(date: string): Promise<Map<string, RawDelivery>>;
  fetchUniverse(): Promise<UniverseMember[]>;
  /** Full list of listed equities with company names (for search / display). */
  fetchSymbolMaster(): Promise<SymbolMasterRow[]>;
}

export interface FundamentalsProvider {
  readonly name: string;
  /** Returns null when no reliable point-in-time fundamentals exist for the date. */
  fetch(symbol: string, asOf: string): Promise<FundamentalsSnapshot | null>;
}

export const MARKET_DATA_PROVIDER = Symbol('MARKET_DATA_PROVIDER');
export const FUNDAMENTALS_PROVIDER = Symbol('FUNDAMENTALS_PROVIDER');

/**
 * Free NSE archives do not include point-in-time fundamentals. Until a licensed
 * provider is plugged in, the fundamentals factor scores neutral (50/100) and
 * the report says so explicitly.
 */
export class NoopFundamentalsProvider implements FundamentalsProvider {
  readonly name = 'none';
  async fetch(): Promise<FundamentalsSnapshot | null> {
    return null;
  }
}
