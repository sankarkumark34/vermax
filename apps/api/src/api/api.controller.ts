import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import fs from 'node:fs';
import path from 'node:path';
import { DataSource } from 'typeorm';
import { NotifyService } from '../notify/notify.service.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { purchaseRating } from '../ipo/rating.js';
import { analyse as scoreAnalysis } from '../analysis/score.js';
import { QuoteService } from '../quote/quote.service.js';
import { CircuitService } from '../circuit/circuit.service.js';
import { PythonBridgeService } from '../bridge/python-bridge.service.js';
import { loadConfig } from '../config/app.config.js';
import { DataService } from '../data/data.service.js';
import { JournalService } from '../journal/journal.service.js';
import { PicksService } from '../picks/picks.service.js';
import { SentimentService } from '../sentiment/sentiment.service.js';
import type { Fundamentals } from '../picks/types.js';

const SYMBOL = /^[A-Z0-9&-]{1,20}$/;

@Controller()
export class ApiController {
  private readonly cfg = loadConfig();

  constructor(
    private readonly picks: PicksService,
    private readonly journal: JournalService,
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

  // ---- sectors / theme -------------------------------------------------------------
  @Get('sectors')
  async sectors() {
    const r = await this.picks.latest();
    if (!r) throw new NotFoundException('No run yet');
    return { asOf: r.asOf, regime: r.regime, sectors: r.sectors };
  }

  // ---- journal ---------------------------------------------------------------------------
  @Get('journal')
  async journalList() {
    const picks = await this.journal.list(300);
    const brief = new Map<string, Awaited<ReturnType<CircuitService['brief']>>>();
    for (const sym of new Set(picks.map((p) => p.symbol))) brief.set(sym, await this.circuits.brief(sym));
    return { stats: await this.journal.stats(), picks: picks.map((p) => ({ ...p, circuit: brief.get(p.symbol) ?? null })) };
  }

  @Post('journal/refresh')
  async journalRefresh() {
    return { updated: await this.journal.refresh(), stats: await this.journal.stats() };
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

  // ---- performance (research artefacts written by the Python report) -------------------------
  @Get('performance')
  performance() {
    const p = path.join(this.cfg.researchDir, 'summary.json');
    if (!fs.existsSync(p)) throw new NotFoundException('No backtest summary yet - run `python -m vermax.report` in ml/');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }

  // ---- screener (price buckets x multi-horizon returns; computed by Python, cached per session date) ----
  @Get('screener')
  async screener() {
    const latest = await this.data.latestDate();
    const file = path.join(this.cfg.repoRoot, 'data', 'screener', `${latest}.json`);
    if (!fs.existsSync(file)) await this.bridge.run('screener', {}, 5 * 60_000);
    if (!fs.existsSync(file)) throw new NotFoundException('Screener data unavailable');
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { rows: Record<string, unknown>[] };
    // Buy rank = position in the model's latest daily ranking of liquid stocks (1 = best).
    const latestRun = await this.picks.latest();
    const rank = new Map((latestRun?.ranking ?? []).map((r, i) => [r.symbol, { modelRank: i + 1, modelScore: r.score }]));
    const veto = new Map((latestRun?.rejected ?? []).map((r) => [r.symbol, r.rejectReasons.join('; ')]));
    const of = latestRun?.ranking?.length ?? 0;
    const tag = new Map<string, 'elite' | 'core' | 'theme'>();
    for (const [list, name] of [[latestRun?.theme, 'theme'], [latestRun?.core, 'core'], [latestRun?.elite, 'elite']] as const)
      for (const p of list ?? []) tag.set(p.symbol, name);
    const band = [this.cfg.picks.minPrice, this.cfg.picks.maxPrice];
    // Tomorrow rating: grade from the model's rank percentile, gated by the live pick rules.
    const rate = (r: Record<string, unknown>) => {
      const sym = r.symbol as string;
      const mr = (rank.get(sym)?.modelRank ?? null) as number | null;
      const pctl = mr && of ? 1 - (mr - 1) / of : 0;
      const reasons: string[] = [];
      if (mr == null) reasons.push('not in the model universe (turnover < ₹5 Cr/day)');
      if ((r.close as number) < band[0] || (r.close as number) > band[1]) reasons.push(`price outside ₹${band[0]}–${band[1]}`);
      if (!((r.d10 as number | null) != null && (r.d10 as number) > 0)) reasons.push('not up over the last 10 sessions');
      if (veto.get(sym)) reasons.push(`vetoed: ${veto.get(sym)}`);
      const eligible = reasons.length === 0;
      const grade = mr == null ? '-' : pctl >= 0.95 ? 'A' : pctl >= 0.85 ? 'B' : pctl >= 0.6 ? 'C' : 'D';
      const t = tag.get(sym) ?? null;
      const score = (t === 'elite' ? 300 : t === 'core' ? 200 : t === 'theme' ? 150 : 0) + (eligible ? 100 : 0) + Math.round(pctl * 100);
      return { grade, eligible, reasons, tomorrow: t, score };
    };
    return { ...data, rankAsOf: latestRun?.asOf ?? null, rankOf: of, rows: data.rows.map((r) => ({ ...r, ...(rank.get(r.symbol as string) ?? { modelRank: null, modelScore: null }), vetoReason: veto.get(r.symbol as string) ?? null, rating: rate(r) })) };
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
    const hourKey = `${file}:${new Date().toISOString().slice(0, 13)}`;
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
    const hit = this.analysisCache.get(symbol);
    if (!refresh && hit && Date.now() - hit.at < 30 * 60_000) return hit.data;
    const base = await this.bridge.run<Record<string, any>>('analyse', { symbol }, 5 * 60_000);
    if (base.status === 'unknown') throw new NotFoundException(`No NSE data or IPO record for ${symbol}`);
    const [sent, circ, quote] = await Promise.all([
      this.sentiment.analyse(symbol, base.name ?? null),
      base.status === 'listed' ? this.circuits.forSymbol(symbol) : Promise.resolve(null),
      base.status === 'listed' ? this.quotes.get(symbol) : Promise.resolve(null),
    ]);
    const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const score = scoreAnalysis({
      status: base.status, sector: base.sector ?? null, price: base.price, fundamentals: base.fundamentals, industry: base.industry, ipo: base.ipo,
      sentiment: { score: sent.score, headlines: sent.headlines, severe: sent.severe },
      circuitEventsLast12m: circ ? circ.list.filter((e) => e.endDate >= yearAgo).length : null,
      lockedNow: circ?.lockedNow ?? false,
      today: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10),
    });
    const data = { ...base, quote, sentiment: { score: sent.score, label: sent.label, severe: sent.severe, headlines: sent.headlines, items: sent.items.slice(0, 5) }, analysis: score };
    this.analysisCache.set(symbol, { at: Date.now(), data });
    return data;
  }

  // ---- single stock --------------------------------------------------------------------------
  @Get('stock/:symbol')
  async stock(@Param('symbol') raw: string, @Query('deep') deep?: string) {
    const symbol = raw.toUpperCase();
    if (!SYMBOL.test(symbol)) throw new BadRequestException('bad symbol');
    const bars = await this.ds.query(
      `SELECT date, open, high, low, close, volume, "deliveryPct" AS deliveryPct FROM daily_bars WHERE symbol = ? ORDER BY date DESC LIMIT 420`,
      [symbol],
    );
    if (!bars.length) throw new NotFoundException(`No price history for ${symbol}`);
    const [info] = await this.ds.query('SELECT symbol, name, sector FROM stocks WHERE symbol = ?', [symbol]);
    const model = await this.picks.stockRank(symbol);
    const out: Record<string, unknown> = { symbol, info: info ?? null, bars: bars.reverse(), model, circuit: await this.circuits.forSymbol(symbol) };
    if (deep === '1') {
      const [fund] = await this.bridge.run<Fundamentals[]>('fundamentals', { symbols: [symbol], sectors: { [symbol]: info?.sector ?? '' } }, 120_000).catch(() => [null as unknown as Fundamentals]);
      out.fundamentals = fund ?? null;
      out.sentiment = await this.sentiment.analyse(symbol, fund?.name ?? info?.name ?? null);
    }
    return out;
  }
}
