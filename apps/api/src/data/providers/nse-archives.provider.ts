import { Injectable, Logger } from '@nestjs/common';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../config/app.config.js';
import type {
  MarketDataProvider,
  RawDelivery,
  RawEquityBar,
  RawIndexBar,
  SymbolMasterRow,
  UniverseMember,
} from './market-data.provider.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** NSE switched the equity bhavcopy to the UDiFF layout from this date. */
const UDIFF_START = '2024-07-08';

const num = (v: unknown): number => {
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim();
  if (s === '' || s === '-') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};
const numOrNull = (v: unknown): number | null => {
  const n = num(v);
  return Number.isFinite(n) ? n : null;
};

export class NseNotAvailableError extends Error {}

/**
 * Pulls end-of-day files from nsearchives.nseindia.com and caches the raw files
 * on disk so backfills can be re-run without hitting NSE again.
 */
@Injectable()
export class NseArchivesProvider implements MarketDataProvider {
  readonly name = 'nse-archives';
  private readonly log = new Logger(NseArchivesProvider.name);
  private readonly cfg = loadConfig();
  private lastRequestAt = 0;

  private parts(date: string) {
    const [y, m, d] = date.split('-');
    return { y, m, d, mon: MONTHS[Number(m) - 1], ymd: `${y}${m}${d}`, dmy: `${d}${m}${y}` };
  }

  private cachePath(kind: string, file: string) {
    const dir = path.join(this.cfg.cacheDir, kind);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, file);
  }

  private async throttle() {
    const wait = this.cfg.requestDelayMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
  }

  /** Download with retry. Returns null for 404 (file does not exist = holiday/not published). */
  private async download(url: string): Promise<Buffer | null> {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.throttle();
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': this.cfg.userAgent,
            Accept: '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            Referer: 'https://www.nseindia.com/',
          },
          signal: AbortSignal.timeout(30_000),
        });
        if (res.status === 404 || res.status === 403 && attempt === 3) return null;
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const head = buf.subarray(0, 64).toString('utf8').toLowerCase();
        if (head.includes('<html') || head.includes('<!doctype')) {
          throw new Error(`NSE returned HTML instead of data for ${url}`);
        }
        return buf;
      } catch (err) {
        lastErr = err;
        this.log.warn(`attempt ${attempt} failed: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 1200 * attempt));
      }
    }
    throw new NseNotAvailableError((lastErr as Error)?.message ?? 'download failed');
  }

  /** Returns cached text if present, otherwise downloads (and unzips) then caches. */
  private async getText(kind: string, cacheFile: string, url: string, zipped: boolean): Promise<string | null> {
    const p = this.cachePath(kind, cacheFile);
    const missing = `${p}.missing`;
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    if (fs.existsSync(missing)) {
      // A "missing" marker is only trusted if it was written on a later IST day than
      // the trading date — otherwise the file may just not have been published yet.
      const dataDate = cacheFile.replace(/^(\d{4})(\d{2})(\d{2}).*$/, '$1-$2-$3');
      const writtenAt = new Date(fs.readFileSync(missing, 'utf8').trim() || 0);
      const writtenIst = Number.isNaN(writtenAt.getTime()) ? '' : new Date(writtenAt.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
      if (writtenIst > dataDate) return null;
      fs.unlinkSync(missing);
    }
    const buf = await this.download(url);
    if (!buf) {
      fs.writeFileSync(missing, new Date().toISOString());
      return null;
    }
    let text: string;
    if (zipped) {
      const zip = new AdmZip(buf);
      const entry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith('.csv'));
      if (!entry) throw new NseNotAvailableError('zip without csv');
      text = entry.getData().toString('utf8');
    } else {
      text = buf.toString('utf8');
    }
    fs.writeFileSync(p, text);
    return text;
  }

  async fetchEquityBars(date: string): Promise<RawEquityBar[]> {
    const { y, mon, d, ymd } = this.parts(date);
    let text: string | null = null;
    if (date >= UDIFF_START) {
      text = await this.getText(
        'bhav',
        `${ymd}.csv`,
        `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${ymd}_F_0000.csv.zip`,
        true,
      );
      if (text) return this.parseUdiff(text, date);
    }
    text = await this.getText(
      'bhav-legacy',
      `${ymd}.csv`,
      `https://nsearchives.nseindia.com/content/historical/EQUITIES/${y}/${mon}/cm${d}${mon}${y}bhav.csv.zip`,
      true,
    );
    return text ? this.parseLegacy(text, date) : [];
  }

  private parseUdiff(text: string, date: string): RawEquityBar[] {
    const rows = parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
    const out: RawEquityBar[] = [];
    for (const r of rows) {
      if (r.Sgmt !== 'CM' || r.FinInstrmTp !== 'STK') continue;
      const series = (r.SctySrs ?? '').trim();
      if (series !== 'EQ') continue;
      const close = num(r.ClsPric);
      if (!Number.isFinite(close)) continue;
      out.push({
        symbol: r.TckrSymb.trim(),
        date,
        series,
        isin: r.ISIN?.trim() || null,
        open: num(r.OpnPric),
        high: num(r.HghPric),
        low: num(r.LwPric),
        close,
        prevClose: num(r.PrvsClsgPric),
        volume: num(r.TtlTradgVol),
        turnover: num(r.TtlTrfVal),
        trades: numOrNull(r.TtlNbOfTxsExctd),
      });
    }
    return out;
  }

  private parseLegacy(text: string, date: string): RawEquityBar[] {
    const rows = parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
    const out: RawEquityBar[] = [];
    for (const r of rows) {
      if ((r.SERIES ?? '').trim() !== 'EQ') continue;
      const close = num(r.CLOSE);
      if (!Number.isFinite(close)) continue;
      out.push({
        symbol: r.SYMBOL.trim(),
        date,
        series: 'EQ',
        isin: r.ISIN?.trim() || null,
        open: num(r.OPEN),
        high: num(r.HIGH),
        low: num(r.LOW),
        close,
        prevClose: num(r.PREVCLOSE),
        volume: num(r.TOTTRDQTY),
        turnover: num(r.TOTTRDVAL),
        trades: numOrNull(r.TOTALTRADES),
      });
    }
    return out;
  }

  async fetchIndexBars(date: string): Promise<RawIndexBar[]> {
    const { dmy, ymd } = this.parts(date);
    const text = await this.getText(
      'indices',
      `${ymd}.csv`,
      `https://nsearchives.nseindia.com/content/indices/ind_close_all_${dmy}.csv`,
      false,
    );
    if (!text) return [];
    const rows = parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true }) as Record<string, string>[];
    const seen = new Set<string>();
    const out: RawIndexBar[] = [];
    for (const r of rows) {
      const name = (r['Index Name'] ?? '').trim();
      const close = num(r['Closing Index Value']);
      if (!name || !Number.isFinite(close) || seen.has(name)) continue;
      seen.add(name);
      out.push({
        indexName: name,
        date,
        open: numOrNull(r['Open Index Value']),
        high: numOrNull(r['High Index Value']),
        low: numOrNull(r['Low Index Value']),
        close,
        changePct: numOrNull(r['Change(%)']),
        volume: numOrNull(r['Volume']),
        turnoverCr: numOrNull(r['Turnover (Rs. Cr.)']),
        pe: numOrNull(r['P/E']),
        pb: numOrNull(r['P/B']),
        divYield: numOrNull(r['Div Yield']),
      });
    }
    return out;
  }

  async fetchDelivery(date: string): Promise<Map<string, RawDelivery>> {
    const { dmy, ymd } = this.parts(date);
    const map = new Map<string, RawDelivery>();
    let text: string | null;
    try {
      text = await this.getText(
        'mto',
        `${ymd}.dat`,
        `https://nsearchives.nseindia.com/archives/equities/mto/MTO_${dmy}.DAT`,
        false,
      );
    } catch (err) {
      this.log.warn(`delivery data unavailable for ${date}: ${(err as Error).message}`);
      return map;
    }
    if (!text) return map;
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('20,')) continue;
      const c = line.split(',');
      if (c.length < 7 || c[3].trim() !== 'EQ') continue;
      const symbol = c[2].trim();
      map.set(symbol, {
        symbol,
        tradedQty: num(c[4]),
        deliveryQty: num(c[5]),
        deliveryPct: num(c[6]),
      });
    }
    return map;
  }

  async fetchSymbolMaster(): Promise<SymbolMasterRow[]> {
    const p = this.cachePath('universe', 'equity_l.csv');
    const stale = !fs.existsSync(p) || Date.now() - fs.statSync(p).mtimeMs > 7 * 86_400_000;
    let text: string | null = null;
    if (stale) {
      try {
        const buf = await this.download('https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv');
        if (buf) {
          text = buf.toString('utf8');
          fs.writeFileSync(p, text);
        }
      } catch (err) {
        this.log.warn(`symbol master download failed: ${(err as Error).message}`);
      }
    }
    if (!text) {
      if (!fs.existsSync(p)) return [];
      text = fs.readFileSync(p, 'utf8');
    }
    const rows = parse(text, { columns: (h: string[]) => h.map((c) => c.trim()), skip_empty_lines: true, relax_column_count: true, bom: true, trim: true }) as Record<string, string>[];
    return rows
      .filter((r) => r.SYMBOL && r['NAME OF COMPANY'])
      .map((r) => ({
        symbol: r.SYMBOL.trim(),
        name: r['NAME OF COMPANY'].trim(),
        isin: r['ISIN NUMBER']?.trim() || null,
        listingDate: r['DATE OF LISTING']?.trim() || null,
      }));
  }

  /** Nifty 500 (default) or Nifty Total Market (Nifty 500 + Microcap 250, ~750 stocks) with NSE's sector ("Industry"). */
  async fetchUniverse(list: 'nifty500' | 'totalmarket' = 'nifty500'): Promise<UniverseMember[]> {
    const p = this.cachePath('universe', `${list}.csv`);
    const stale = !fs.existsSync(p) || Date.now() - fs.statSync(p).mtimeMs > 7 * 86_400_000;
    let text: string;
    if (stale) {
      const buf = await this.download(`https://nsearchives.nseindia.com/content/indices/${list === 'nifty500' ? 'ind_nifty500list.csv' : 'ind_niftytotalmarket_list.csv'}`);
      if (!buf) {
        if (fs.existsSync(p)) text = fs.readFileSync(p, 'utf8');
        else return [];
      } else {
        text = buf.toString('utf8');
        fs.writeFileSync(p, text);
      }
    } else {
      text = fs.readFileSync(p, 'utf8');
    }
    const rows = parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true }) as Record<string, string>[];
    return rows
      .filter((r) => r.Symbol && r.Industry)
      .map((r) => ({
        symbol: r.Symbol.trim(),
        name: (r['Company Name'] ?? '').trim(),
        industry: r.Industry.trim(),
        isin: r['ISIN Code']?.trim() || null,
      }));
  }
}
