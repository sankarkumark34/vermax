import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DailyBarEntity } from '../database/entities/daily-bar.entity.js';
import { IndexBarEntity } from '../database/entities/index-bar.entity.js';
import { IngestLogEntity } from '../database/entities/ingest-log.entity.js';
import { StockEntity } from '../database/entities/stock.entity.js';
import { MARKET_DATA_PROVIDER, type MarketDataProvider } from './providers/market-data.provider.js';

const CHUNK = 400;

export function weekdaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface IngestSummary {
  from: string;
  to: string;
  storedDays: number;
  holidays: number;
  errors: number;
  latestDate: string | null;
}

/** End-of-day ingestion: NSE bhavcopy + delivery (MTO) + index closes into the market database. */
@Injectable()
export class DataService {
  private readonly log = new Logger(DataService.name);

  constructor(
    @Inject(MARKET_DATA_PROVIDER) private readonly provider: MarketDataProvider,
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(StockEntity) private readonly stocks: Repository<StockEntity>,
    @InjectRepository(DailyBarEntity) private readonly bars: Repository<DailyBarEntity>,
    @InjectRepository(IngestLogEntity) private readonly logs: Repository<IngestLogEntity>,
  ) {}

  async latestDate(): Promise<string | null> {
    const r: { d: string | null }[] = await this.ds.query('SELECT MAX(date) AS d FROM daily_bars');
    return r[0]?.d ?? null;
  }

  private async isFinal(date: string): Promise<boolean> {
    const row = await this.logs.findOne({ where: { date, source: 'equity' }, order: { id: 'DESC' } });
    if (!row) return false;
    if (row.status === 'OK') return true;
    if (row.status === 'EMPTY') {
      // An empty result is only final once the IST calendar day has moved past the trading date.
      const loggedIst = new Date(new Date(row.createdAt).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
      return loggedIst > date;
    }
    return false;
  }

  async ingestDate(date: string, force = false): Promise<number> {
    if (!force && (await this.isFinal(date))) return this.bars.count({ where: { date } });
    let equity;
    try {
      equity = await this.provider.fetchEquityBars(date);
    } catch (err) {
      await this.writeLog(date, 'equity', 'ERROR', 0, (err as Error).message);
      throw err;
    }
    if (!equity.length) {
      await this.writeLog(date, 'equity', 'EMPTY', 0, 'No bhavcopy (holiday or not yet published)');
      return 0;
    }
    const delivery = await this.provider.fetchDelivery(date);
    const rows = equity
      .filter((b) => Number.isFinite(b.open) && Number.isFinite(b.high) && Number.isFinite(b.low) && b.close > 0 && b.high >= b.low)
      .map((b) => {
        const d = delivery.get(b.symbol);
        return {
          symbol: b.symbol,
          date,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          prevClose: Number.isFinite(b.prevClose) ? b.prevClose : b.open,
          volume: Number.isFinite(b.volume) ? b.volume : 0,
          turnover: Number.isFinite(b.turnover) ? b.turnover : 0,
          trades: b.trades,
          deliveryQty: d ? d.deliveryQty : null,
          deliveryPct: d ? d.deliveryPct : null,
        };
      });
    await this.ds.transaction(async (em) => {
      await em.delete(DailyBarEntity, { date });
      for (let i = 0; i < rows.length; i += CHUNK) await em.insert(DailyBarEntity, rows.slice(i, i + CHUNK));
    });
    await this.registerSymbols(equity.map((b) => ({ symbol: b.symbol, isin: b.isin })), date);
    await this.writeLog(date, 'equity', 'OK', rows.length, delivery.size ? `${delivery.size} delivery rows merged` : 'delivery unavailable');
    try {
      const idx = await this.provider.fetchIndexBars(date);
      if (idx.length) {
        await this.ds.transaction(async (em) => {
          await em.delete(IndexBarEntity, { date });
          for (let i = 0; i < idx.length; i += CHUNK) await em.insert(IndexBarEntity, idx.slice(i, i + CHUNK));
        });
        await this.writeLog(date, 'indices', 'OK', idx.length, null);
      } else await this.writeLog(date, 'indices', 'EMPTY', 0, 'index close file missing');
    } catch (err) {
      await this.writeLog(date, 'indices', 'ERROR', 0, (err as Error).message);
    }
    return rows.length;
  }

  /** Catch up from the day after the last stored session to `to` (default: today, IST). */
  async catchUp(to?: string): Promise<IngestSummary> {
    const last = (await this.latestDate()) ?? '2019-01-01';
    const today = to ?? new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    // NSE publishes bhavcopy first; index closes and delivery (MTO) files can appear later. Re-fetch the recent
    // sessions whose index or delivery data is still missing so nothing stays half-loaded.
    const incomplete: { date: string }[] = await this.ds.query(
      `SELECT b.date AS date FROM (SELECT date, COUNT(deliveryPct) AS dl FROM daily_bars WHERE date >= ? GROUP BY date) b
       LEFT JOIN (SELECT date, COUNT(*) AS n FROM index_bars WHERE indexName = 'Nifty 50' GROUP BY date) i ON i.date = b.date
       WHERE COALESCE(i.n, 0) = 0 OR b.dl = 0`,
      [addDays(last, -7)],
    );
    for (const { date } of incomplete) {
      try {
        await this.ingestDate(date, true);
        this.log.log(`re-ingested incomplete session ${date}`);
      } catch (err) {
        this.log.warn(`re-ingest ${date} failed: ${(err as Error).message}`);
      }
    }
    return this.ingestRange(addDays(last, 1), today);
  }

  async ingestRange(from: string, to: string, force = false): Promise<IngestSummary> {
    let stored = 0;
    let holidays = 0;
    let errors = 0;
    for (const d of weekdaysBetween(from, to)) {
      try {
        const n = await this.ingestDate(d, force);
        if (n > 0) stored++;
        else holidays++;
      } catch (err) {
        errors++;
        this.log.warn(`ingest ${d} failed: ${(err as Error).message}`);
      }
    }
    return { from, to, storedDays: stored, holidays, errors, latestDate: await this.latestDate() };
  }

  /** Refresh company names / sectors from the NSE master + Nifty 500 list (used for sector mapping). */
  async syncUniverse(): Promise<number> {
    const members = await this.provider.fetchUniverse();
    for (const m of members) {
      const ex = await this.stocks.findOne({ where: { symbol: m.symbol } });
      if (ex) {
        ex.name = m.name || ex.name;
        ex.sector = m.industry;
        ex.industry = m.industry;
        ex.inNifty500 = true;
        ex.isin = m.isin ?? ex.isin;
        await this.stocks.save(ex);
      } else {
        await this.stocks.insert({ symbol: m.symbol, name: m.name, isin: m.isin, sector: m.industry, industry: m.industry, inNifty500: true, firstDate: null, lastDate: null });
      }
    }
    try {
      const master = await this.provider.fetchSymbolMaster();
      const existing = new Map((await this.stocks.find({ select: { symbol: true, name: true, isin: true } })).map((s) => [s.symbol, s]));
      await this.ds.transaction(async (em) => {
        for (const m of master) {
          const cur = existing.get(m.symbol);
          if (!cur || (cur.name && cur.isin)) continue;
          await em.update(StockEntity, { symbol: m.symbol }, { name: cur.name ?? m.name, isin: cur.isin ?? m.isin });
        }
      });
    } catch (err) {
      this.log.warn(`symbol master sync failed: ${(err as Error).message}`);
    }
    return members.length;
  }

  private async registerSymbols(list: { symbol: string; isin: string | null }[], date: string) {
    const existing = new Set((await this.stocks.find({ select: { symbol: true } })).map((s) => s.symbol));
    const fresh = list.filter((s) => !existing.has(s.symbol));
    for (let i = 0; i < fresh.length; i += CHUNK) {
      await this.stocks.insert(
        fresh.slice(i, i + CHUNK).map((s) => ({ symbol: s.symbol, name: null, isin: s.isin, sector: 'Unclassified', industry: null, inNifty500: false, firstDate: date, lastDate: date })),
      );
    }
    await this.ds.query(
      'UPDATE stocks SET "lastDate" = ? WHERE symbol IN (SELECT symbol FROM daily_bars WHERE date = ?) AND ("lastDate" IS NULL OR "lastDate" < ?)',
      [date, date, date],
    );
  }

  async status() {
    const [range] = await this.ds.query('SELECT MIN(date) AS first, MAX(date) AS last, COUNT(DISTINCT date) AS days FROM daily_bars');
    const recent = await this.logs.find({ order: { id: 'DESC' }, take: 12 });
    return { firstDate: range.first, lastDate: range.last, tradingDays: Number(range.days), recentLogs: recent };
  }

  private async writeLog(date: string, source: string, status: 'OK' | 'EMPTY' | 'ERROR', rows: number, message: string | null) {
    await this.logs.insert({ date, source, status, rows, message, createdAt: new Date().toISOString() });
  }
}
