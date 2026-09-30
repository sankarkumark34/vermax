import { Injectable, Logger } from '@nestjs/common';

export interface LiveQuote {
  symbol: string;
  price: number;
  prevClose: number | null;
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  time: string | null;
  source: 'yahoo';
}

const TTL_MS = 60_000;

/**
 * Intraday price for display only (Yahoo Finance, typically delayed). All analytics — returns, indicators,
 * model scores, stops and targets — stay on official NSE end-of-day closes.
 */
@Injectable()
export class QuoteService {
  private readonly log = new Logger(QuoteService.name);
  private readonly cache = new Map<string, { at: number; q: LiveQuote | null }>();

  async get(symbol: string): Promise<LiveQuote | null> {
    const hit = this.cache.get(symbol);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.q;
    let q: LiveQuote | null = null;
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?range=1d&interval=5m`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const meta = (await res.json())?.chart?.result?.[0]?.meta;
      const price = Number(meta?.regularMarketPrice);
      if (Number.isFinite(price) && price > 0) {
        const prev = Number(meta.previousClose ?? meta.chartPreviousClose);
        q = {
          symbol,
          price,
          prevClose: Number.isFinite(prev) ? prev : null,
          changePct: Number.isFinite(prev) && prev > 0 ? (price / prev - 1) * 100 : null,
          dayHigh: Number.isFinite(Number(meta.regularMarketDayHigh)) ? Number(meta.regularMarketDayHigh) : null,
          dayLow: Number.isFinite(Number(meta.regularMarketDayLow)) ? Number(meta.regularMarketDayLow) : null,
          time: meta.regularMarketTime ? new Date(Number(meta.regularMarketTime) * 1000).toISOString() : null,
          source: 'yahoo',
        };
      }
    } catch (err) {
      this.log.warn(`live quote failed for ${symbol}: ${(err as Error).message}`);
    }
    this.cache.set(symbol, { at: Date.now(), q });
    return q;
  }
}
