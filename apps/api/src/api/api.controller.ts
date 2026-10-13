import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import fs from 'node:fs';
import path from 'node:path';
import { DataSource } from 'typeorm';
import { NotifyService } from '../notify/notify.service.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { purchaseRating } from '../ipo/rating.js';
import { analyse as scoreAnalysis } from '../analysis/score.js';
import { technicals, type Technicals } from '../analysis/technicals.js';
import { QuoteService } from '../quote/quote.service.js';
import { CircuitService } from '../circuit/circuit.service.js';
import { PythonBridgeService } from '../bridge/python-bridge.service.js';
import { loadConfig } from '../config/app.config.js';
import { adjustBars, type RawBar } from '../data/adjust.js';
import { DataService } from '../data/data.service.js';
import { PicksService } from '../picks/picks.service.js';
import { SentimentService } from '../sentiment/sentiment.service.js';
import type { Fundamentals } from '../picks/types.js';

const SYMBOL = /^[A-Z0-9&-]{1,20}$/;

@Controller()
export class ApiController {
  private readonly cfg = loadConfig();

  constructor(
    private readonly picks: PicksService,
    private readonly data: DataService,
    private readonly sentiment: SentimentService,
    private readonly bridge: PythonBridgeService,
    private readonly circuits: CircuitService,
    private readonly quotes: QuoteService,
    private readonly notify: NotifyService,
    private readonly scheduler: SchedulerService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  @Get('health')
  health() {
    return { ok: true, time: new Date().toISOString() };
  }

  /** Operational status: data freshness, last pipeline, scheduler, alerts. */
  @Get('system')
  async system() {
    const latest = await this.data.latestDate();
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const lastRun = await this.picks.latest();
    return {
      dataLatest: latest,
      todayIst: today,
      publishedAsOf: lastRun?.asOf ?? null,
      pipeline: this.picks.state,
      jobs: this.scheduler.jobs(),
      lastRetrain: this.scheduler.lastRetrain,
      alerts: { telegram: this.notify.enabled, recent: this.notify.events.slice(0, 10) },
    };
  }

  private healthCache: { at: number; data: unknown } | null = null;

  /** Model health: live rank-IC of published rankings, recent out-of-sample IC by month, feature drift. */
  @Get('model/health')
  async modelHealth(@Query('refresh') refresh?: string) {
    if (!refresh && this.healthCache && Date.now() - this.healthCache.at < 6 * 3600_000) return this.healthCache.data;
    const data = await this.bridge.run('health', {}, 10 * 60_000);
    this.healthCache = { at: Date.now(), data };
    return data;
  }

  @Post('system/test-alert')
  async testAlert() {
    const delivered = await this.notify.send('info', 'Test alert from Vermax. If you can read this, Telegram alerts work.');
    return { delivered, telegram: this.notify.enabled };
  }

  // ---- picks -------------------------------------------------------------------
  @Get('picks/latest')
  async latest() {
    const r = await this.picks.latest();
    if (!r) throw new NotFoundException('No picks published yet - run the pipeline (POST /api/pipeline/run).');
    const { ranking: _ranking, ...rest } = r;
    return rest;
  }

  @Get('picks/history')
  history() {
    return this.picks.history(60);
  }

  @Get('picks/:asOf')
  async byDate(@Param('asOf') asOf: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new BadRequestException('asOf must be YYYY-MM-DD');
    const r = await this.picks.byDate(asOf);
    if (!r) throw new NotFoundException(`No run for ${asOf}`);
    return r;
  }

  @Post('pipeline/run')
  run(@Body() body: { ingest?: boolean }) {
    const started = this.picks.start({ ingest: body?.ingest ?? true });
    return { started, state: this.picks.state };
  }

  @Get('pipeline/state')
  state() {
    return this.picks.state;
  }

  // ---- data ------------------------------------------------------------------------------------
  @Get('data/status')
  dataStatus() {
    return this.data.status();
  }

  @Post('data/ingest')
  async ingest(@Body() body: { from?: string; to?: string }) {
    if (body?.from && body?.to) return this.data.ingestRange(body.from, body.to);
    return this.data.catchUp();
  }

  @Get('quote/:symbol')
  async quote(@Param('symbol') raw: string) {
    const symbol = raw.toUpperCase();
    if (!SYMBOL.test(symbol)) throw new BadRequestException('bad symbol');
    return { quote: await this.quotes.get(symbol) };
  }

  @Get('ipos')
  async ipos() {
    const latest = await this.data.latestDate();
    const file = path.join(this.cfg.repoRoot, 'data', 'screener', `ipos-${latest}.json`);
    if (!fs.existsSync(file)) await this.bridge.run('ipos', {}, 10 * 60_000);
    if (!fs.existsSync(file)) throw new NotFoundException('IPO data unavailable');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  private ipoQualityBuilding = false;
  private ipoRated: { key: string; data: unknown } | null = null;

  /** Curated recent IPOs (12-month superset; the UI narrows to 3/6/12 months). Serves the newest file and refreshes in the background. */
  @Get('ipos/quality')
  async ipoQuality() {
    const latest = await this.data.latestDate();
    const dir = path.join(this.cfg.repoRoot, 'data', 'screener');
    const want = path.join(dir, `ipo-quality-12m-${latest}.json`);
    if (!fs.existsSync(want) && !this.ipoQualityBuilding) {
      this.ipoQualityBuilding = true;
      void this.bridge.run('ipo-quality', { months: 12 }, 40 * 60_000).finally(() => (this.ipoQualityBuilding = false));
    }
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith('ipo-quality-12m-')).sort() : [];
    if (!files.length) return { building: true, rows: [], asOf: null };
    const file = files.at(-1)!;
    const hourKey = `${file}:${fs.statSync(path.join(dir, file)).mtimeMs}:${new Date().toISOString().slice(0, 13)}`;
    if (this.ipoRated?.key !== hourKey) {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as { rows: Record<string, any>[] };
      const run = await this.picks.latest();
      const market = run ? { regime: run.regime.label, breadth50: run.regime.breadth50, fiiIndexLongRatio: (run.regime as { fiiIndexLongRatio?: number | null }).fiiIndexLongRatio ?? null } : null;
      // News sentiment for every listing (cached 3 h in SentimentService), a few at a time.
      for (let i = 0; i < data.rows.length; i += 6) {
        await Promise.all(data.rows.slice(i, i + 6).map(async (r) => {
          const s = await this.sentiment.analyse(r.symbol, r.name);
          r.sentiment = { score: s.score, label: s.label, severe: s.severe, headlines: s.headlines, items: s.items.slice(0, 4) };
        }));
      }
      for (const r of data.rows) {
        r.rating = purchaseRating({
          fundamentals: r.fundamentals, sentiment: r.sentiment, weeks: r.weeks, months: r.months, vsIssue: r.vsIssue ?? null,
          fromHigh: r.fromHigh ?? null, listingGain: r.listingGain ?? null, deliveryAvg: r.deliveryAvg ?? null, turnoverCr: r.turnoverCr ?? null, market,
        });
      }
      this.ipoRated = { key: hourKey, data };
    }
    return { ...(this.ipoRated.data as object), building: this.ipoQualityBuilding, stale: file !== path.basename(want) };
  }

  private trustedWorking = false;
  private trustedFailed = new Map<string, number>();

  /**
   * Steady IPOs: the price screen (never below the listing price, monthly / quarterly closes up, RSI) comes from Python;
   * each candidate then gets the Stock Analysis Buy score (fundamentals, valuation, risk, news) computed in the background
   * (3 at a time, cached 30 min) and a "trusted" verdict (no red flag, liquid, real delivery buying, no lower circuit, clean news).
   */
  @Get('trusted')
  async trusted() {
    const latest = await this.data.latestDate();
    const dir = path.join(this.cfg.repoRoot, 'data', 'screener');
    const want = path.join(dir, `trusted-${latest}.json`);
    if (!fs.existsSync(want) && !this.trustedWorking) {
      this.trustedWorking = true;
      void this.bridge.run('trusted', {}, 20 * 60_000).finally(() => (this.trustedWorking = false));
    }
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^trusted-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() : [];
    if (!files.length) return { building: true, asOf: null, rows: [] };
    const data = JSON.parse(fs.readFileSync(path.join(dir, files.at(-1)!), 'utf8')) as { rows: Record<string, any>[] };
    const fresh = (sym: string) => {
      const hit = this.analysisCache.get(sym);
      return hit && Date.now() - hit.at < 30 * 60_000 ? (hit.data as Record<string, any>) : null;
    };
    const todo = data.rows.map((r) => r.symbol as string).filter((sym) => !fresh(sym) && Date.now() - (this.trustedFailed.get(sym) ?? 0) > 30 * 60_000);
    if (todo.length && !this.analysing) {
      this.analysing = true;
      void (async () => {
        try {
          for (let i = 0; i < todo.length; i += 3)
            await Promise.all(todo.slice(i, i + 3).map((sym) => this.buildAnalysis(sym, false).catch(() => this.trustedFailed.set(sym, Date.now()))));
        } finally { this.analysing = false; }
      })();
    }
    const rows = data.rows.map((r) => {
      const a = fresh(r.symbol);
      if (!a) return { ...r, analysis: null, trust: null, fundamentals: null };
      const chk = new Map<string, boolean | null>((a.analysis.checks as { id: string; pass: boolean | null }[]).map((c) => [c.id, c.pass]));
      const fails: string[] = [...(a.analysis.redFlags as string[])];
      const need: [string, string][] = [['liq', 'thin trading (< ₹5 Cr a day)'], ['deliv', 'low delivery buying (< 35%)'], ['lc', 'lower circuit in the last 12 months'],
        ['flags', 'red-flag headline'], ['news', 'negative news tone'], ['promoter', 'promoter holding below 40%']];
      for (const [id, why] of need) if (chk.get(id) === false) fails.push(why);
      const f = a.fundamentals ?? {};
      return {
        ...r,
        fundamentals: { verdict: f.verdict ?? null, qualityScore: f.qualityScore ?? null, roe: f.roe3yAvg ?? f.roe ?? null, roce: f.roce ?? null, debtToEquity: f.debtToEquity ?? null,
          salesCagr: f.salesCagr ?? null, profitCagr: f.profitCagr ?? null, pe: f.pe ?? null, marketCapCr: f.marketCapCr ?? null, insiderHolding: f.insiderHolding ?? null },
        industryPe: a.industry?.pe ?? null,
        analysis: { score: a.analysis.score, verdict: a.analysis.verdict, label: a.analysis.label, redFlags: a.analysis.redFlags, strengths: a.analysis.strengths, concerns: a.analysis.concerns, coverage: a.analysis.coverage },
        trust: { ok: fails.length === 0, fails },
        news: a.sentiment ? { label: a.sentiment.label, score: a.sentiment.score, headlines: a.sentiment.headlines } : null,
      };
    });
    return { ...data, rows, pending: rows.filter((r) => !r.analysis).length, stale: files.at(-1) !== path.basename(want), building: this.trustedWorking || this.analysing };
  }

  private analysing = false;

  private ipoStudyBuilding = false;

  /** All-IPO study: time below issue / listing price, recovery, grouped by subscription. Newest file; rebuilt in background. */
  @Get('ipos/study')
  async ipoStudy() {
    const latest = await this.data.latestDate();
    const dir = path.join(this.cfg.repoRoot, 'data', 'screener');
    const want = path.join(dir, `ipo-study-${latest}.json`);
    if (!fs.existsSync(want) && !this.ipoStudyBuilding) {
      this.ipoStudyBuilding = true;
      void this.bridge.run('ipo-study', {}, 60 * 60_000).finally(() => (this.ipoStudyBuilding = false));
    }
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith('ipo-study-')).sort() : [];
    if (!files.length) return { building: true, rows: [], asOf: null };
    return { ...JSON.parse(fs.readFileSync(path.join(dir, files.at(-1)!), 'utf8')), building: this.ipoStudyBuilding, stale: files.at(-1) !== path.basename(want) };
  }

  /** Delayed live quotes for up to 60 symbols (display-only; analytics stay on NSE closes). */
  @Get('quotes')
  async quotesBatch(@Query('symbols') symbols = '') {
    const list = [...new Set(symbols.toUpperCase().split(',').map((x) => x.trim()).filter((x) => SYMBOL.test(x)))].slice(0, 60);
    const out: Record<string, unknown> = {};
    for (let i = 0; i < list.length; i += 8) {
      const batch = await Promise.all(list.slice(i, i + 8).map((sym) => this.quotes.get(sym)));
      batch.forEach((q, j) => (out[list[i + j]] = q));
    }
    return out;
  }

  // ---- stock analysis -----------------------------------------------------------------------------
  private searchIndex: { at: number; rows: { symbol: string; name: string; kind: 'stock' | 'ipo' }[] } | null = null;

  /** Symbol / company-name search across listed stocks and NSE IPOs (including ones not listed yet). */
  @Get('search')
  async search(@Query('q') q = '') {
    const STOP = new Set(['LTD', 'LTD.', 'LIMITED', 'IPO', 'THE', 'AND', '&', 'CO', 'CO.']);
    const norm = (x: string) => x.toUpperCase().replace(/[().,]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
    const words = norm(q);
    const term = words.join(' ');
    if (term.length < 2) return [];
    if (!this.searchIndex || Date.now() - this.searchIndex.at > 3600_000) {
      const stocks: { symbol: string; name: string | null }[] = await this.ds.query(
        `SELECT s.symbol, s.name FROM stocks s WHERE s."lastDate" >= date('now', '-30 day')`,
      );
      const rows: { symbol: string; name: string; kind: 'stock' | 'ipo' }[] = stocks.map((r) => ({ symbol: r.symbol, name: r.name ?? r.symbol, kind: 'stock' as const }));
      const ipoFile = path.join(this.cfg.repoRoot, 'data', 'cache', 'universe', 'ipo_past_issues.json');
      if (fs.existsSync(ipoFile)) {
        const known = new Set(rows.map((r) => r.symbol));
        for (const x of JSON.parse(fs.readFileSync(ipoFile, 'utf8')) as Record<string, string>[]) {
          const sym = (x.symbol ?? '').trim();
          if (sym && !known.has(sym) && ['EQ', 'BE'].includes(x.securityType)) { rows.push({ symbol: sym, name: x.companyName ?? x.company ?? sym, kind: 'ipo' }); known.add(sym); }
        }
      }
      this.searchIndex = { at: Date.now(), rows };
    }
    const scored = this.searchIndex.rows
      .map((r) => {
        const n = norm(r.name).join(' ');
        let s = 0;
        const compact = words.join('');
        if (r.symbol === compact) s = 100;
        else if (r.symbol.startsWith(compact)) s = 80;
        else if (words.every((w) => n.includes(w))) s = 60 + (n.startsWith(words[0]) ? 10 : 0);
        else if (r.symbol.includes(compact)) s = 40;
        return { ...r, s };
      })
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || a.name.length - b.name.length)
      .slice(0, 10);
    return scored.map(({ s: _s, ...r }) => r);
  }

  private analysisCache = new Map<string, { at: number; data: unknown }>();

  /** Full checklist + Buy score for one stock or IPO. */
  @Get('analyse/:symbol')
  async analyseStock(@Param('symbol') raw: string, @Query('refresh') refresh?: string) {
    const symbol = raw.toUpperCase();
    if (!SYMBOL.test(symbol)) throw new BadRequestException('bad symbol');
    return this.buildAnalysis(symbol, !!refresh);
  }

  private async buildAnalysis(symbol: string, refresh: boolean) {
    const hit = this.analysisCache.get(symbol);
    if (!refresh && hit && Date.now() - hit.at < 30 * 60_000) return hit.data as Record<string, any>;
    const base = await this.bridge.run<Record<string, any>>('analyse', { symbol }, 5 * 60_000);
    if (base.status === 'unknown') throw new NotFoundException(`No NSE data or IPO record for ${symbol}`);
    const [sent, circ, quote, tech] = await Promise.all([
      this.sentiment.analyse(symbol, base.name ?? null),
      base.status === 'listed' ? this.circuits.forSymbol(symbol) : Promise.resolve(null),
      base.status === 'listed' ? this.quotes.get(symbol) : Promise.resolve(null),
      base.status === 'listed' ? this.technicalsFor(symbol) : Promise.resolve(null),
    ]);
    const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const score = scoreAnalysis({
      status: base.status, sector: base.sector ?? null, price: base.price, fundamentals: base.fundamentals, industry: base.industry, ipo: base.ipo,
      sentiment: { score: sent.score, headlines: sent.headlines, severe: sent.severe },
      circuitEventsLast12m: circ ? circ.list.filter((e) => e.endDate >= yearAgo).length : null,
      lockedNow: circ?.lockedNow ?? false,
      today: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10),
      technicals: tech ? { macdBullish: tech.macd.state === 'bullish', structure: tech.structure.trend, lastEvent: tech.structure.last ? `${tech.structure.last.type} ${tech.structure.last.dir}` : null } : null,
    });
    const data = { ...base, quote, technicals: tech, sentiment: { score: sent.score, label: sent.label, severe: sent.severe, headlines: sent.headlines, items: sent.items.slice(0, 5) }, analysis: score };
    this.analysisCache.set(symbol, { at: Date.now(), data });
    return data;
  }

  private async technicalsFor(symbol: string): Promise<Technicals | null> {
    const rawBars: RawBar[] = await this.ds.query(
      `SELECT date, open, high, low, close, volume, "prevClose" AS prevClose FROM daily_bars WHERE symbol = ? ORDER BY date DESC LIMIT 420`,
      [symbol],
    );
    return technicals(adjustBars(rawBars.reverse()));
  }

  // ---- single stock --------------------------------------------------------------------------
  @Get('stock/:symbol')
  async stock(@Param('symbol') raw: string, @Query('deep') deep?: string) {
    const symbol = raw.toUpperCase();
    if (!SYMBOL.test(symbol)) throw new BadRequestException('bad symbol');
    const rawBars: RawBar[] = await this.ds.query(
      `SELECT date, open, high, low, close, volume, "prevClose" AS prevClose, "deliveryPct" AS deliveryPct FROM daily_bars WHERE symbol = ? ORDER BY date DESC LIMIT 420`,
      [symbol],
    );
    const bars = adjustBars(rawBars.reverse()).reverse();   // split/bonus-adjusted so charts and returns show no fake crashes
    if (!bars.length) throw new NotFoundException(`No price history for ${symbol}`);
    const [info] = await this.ds.query('SELECT symbol, name, sector FROM stocks WHERE symbol = ?', [symbol]);
    const model = await this.picks.stockRank(symbol);
    const asc = bars.reverse();
    const out: Record<string, unknown> = { symbol, info: info ?? null, bars: asc, model, circuit: await this.circuits.forSymbol(symbol), technicals: technicals(asc) };
    if (deep === '1') {
      const [fund] = await this.bridge.run<Fundamentals[]>('fundamentals', { symbols: [symbol], sectors: { [symbol]: info?.sector ?? '' } }, 120_000).catch(() => [null as unknown as Fundamentals]);
      out.fundamentals = fund ?? null;
      out.sentiment = await this.sentiment.analyse(symbol, fund?.name ?? info?.name ?? null);
    }
    return out;
  }
}
