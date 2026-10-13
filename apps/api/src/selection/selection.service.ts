import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PythonBridgeService } from '../bridge/python-bridge.service.js';
import { adjustBars } from '../data/adjust.js';
import { NotifyService } from '../notify/notify.service.js';
import {
  analyzeStock, ENGINE_VERSION, DEFAULT_CONFIG, normaliseConfig, resolveTemplate, templateKeyFor, validateConfig,
  type AnalysisResult, type CompanyData, type IndexPoint, type PriceBar, type RedFlag, type SelectionConfig,
} from './domain/index.js';
import { AnalysisRunEntity, JobRunEntity, RedFlagEntity, StepScoreEntity, ThresholdConfigEntity, WatchlistItemEntity } from './entities.js';
import { effectiveSector, sectorIndexName } from './sectors.js';

type Medians = Record<string, { evToEbitda: number | null; pe: number | null; n: number }>;
interface Surveillance { asOf: string; ok: boolean; stale?: boolean; symbols: Record<string, string[]> }

export interface UniverseState {
  running: boolean;
  step: string;
  done: number;
  total: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  counts: { BUY: number; WAIT: number; AVOID: number; failed: number };
}

const nowIso = () => new Date().toISOString();
const istDay = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const BATCH = 20;

/**
 * Orchestrates the selection engine: loads data (DB + Python data layer), runs the pure domain engine,
 * persists runs, keeps the config versions, the watchlist alerts and the red-flag review queue.
 */
@Injectable()
export class SelectionService {
  private readonly log = new Logger(SelectionService.name);
  private configCache: SelectionConfig | null = null;
  private surveillanceCache: { day: string; data: Surveillance } | null = null;
  private mediansCache: { at: number; data: Medians } | null = null;
  private benchmarkCache: { day: string; points: IndexPoint[] } | null = null;
  private indexCache = new Map<string, { day: string; points: IndexPoint[] }>();

  state: UniverseState = { running: false, step: 'idle', done: 0, total: 0, startedAt: null, finishedAt: null, error: null, counts: { BUY: 0, WAIT: 0, AVOID: 0, failed: 0 } };

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly bridge: PythonBridgeService,
    private readonly notify: NotifyService,
  ) {}


  // ---- configuration (versioned) ------------------------------------------------------------------
  async getConfig(): Promise<SelectionConfig> {
    if (this.configCache) return this.configCache;
    const repo = this.ds.getRepository(ThresholdConfigEntity);
    let row = await repo.findOne({ where: { active: true }, order: { version: 'DESC' } });
    if (!row) {
      row = await repo.save({ version: 1, data: JSON.stringify(DEFAULT_CONFIG), note: DEFAULT_CONFIG.note, active: true, createdAt: nowIso() });
    }
    this.configCache = normaliseConfig({ ...JSON.parse(row.data), version: row.version });
    return this.configCache;
  }

  async configVersions() {
    const rows = await this.ds.getRepository(ThresholdConfigEntity).find({ order: { version: 'DESC' }, take: 50 });
    return rows.map((r) => ({ version: r.version, note: r.note, active: r.active, createdAt: r.createdAt }));
  }

  async configVersion(version: number) {
    const row = await this.ds.getRepository(ThresholdConfigEntity).findOneBy({ version });
    if (!row) throw new NotFoundException(`config version ${version} not found`);
    return normaliseConfig({ ...JSON.parse(row.data), version: row.version });
  }

  /** Saves a new version (never edits an old one) and makes it active. */
  async saveConfig(raw: Partial<SelectionConfig>, note: string): Promise<SelectionConfig> {
    const merged = normaliseConfig(raw);
    const errors = validateConfig(merged);
    if (errors.length) throw new BadRequestException(errors);
    const repo = this.ds.getRepository(ThresholdConfigEntity);
    const last = await repo.find({ order: { version: 'DESC' }, take: 1 });
    const version = (last[0]?.version ?? 0) + 1;
    await this.ds.transaction(async (em) => {
      await em.getRepository(ThresholdConfigEntity).update({ active: true }, { active: false });
      await em.getRepository(ThresholdConfigEntity).save({ version, data: JSON.stringify({ ...merged, version }), note: note.slice(0, 300), active: true, createdAt: nowIso() });
    });
    this.configCache = null;
    return this.getConfig();
  }

  async activateConfig(version: number) {
    const repo = this.ds.getRepository(ThresholdConfigEntity);
    if (!(await repo.findOneBy({ version }))) throw new NotFoundException(`config version ${version} not found`);
    await this.ds.transaction(async (em) => {
      await em.getRepository(ThresholdConfigEntity).update({ active: true }, { active: false });
      await em.getRepository(ThresholdConfigEntity).update({ version }, { active: true });
    });
    this.configCache = null;
    return this.getConfig();
  }

  // ---- data loading ---------------------------------------------------------------------------------
  async prices(symbol: string, limit = 600): Promise<PriceBar[]> {
    const raw: (PriceBar & { prevClose: number })[] = await this.ds.query(
      `SELECT date, open, high, low, close, volume, "prevClose" AS prevClose, turnover, "deliveryPct" AS deliveryPct
       FROM daily_bars WHERE symbol = ? ORDER BY date DESC LIMIT ?`,
      [symbol, limit],
    );
    return adjustBars(raw.reverse()).map(({ prevClose: _p, ...b }) => b);
  }

  private async indexPoints(name: string, limit = 600): Promise<IndexPoint[]> {
    const day = istDay();
    const hit = this.indexCache.get(name);
    if (hit?.day === day) return hit.points;
    const rows: IndexPoint[] = await this.ds.query(
      `SELECT date, close FROM index_bars WHERE "indexName" = ? AND close IS NOT NULL ORDER BY date DESC LIMIT ?`, [name, limit]);
    const points = rows.reverse();
    this.indexCache.set(name, { day, points });
    return points;
  }

  /**
   * Some NSE sector indices are new (e.g. Nifty Capital Goods starts in 2026). When the index has under a year of history,
   * an equal-weighted index of the sector's own stocks is built from daily returns (close / prevClose, which the exchange
   * adjusts for corporate actions; daily moves are clipped at ±20%).
   */
  private async sectorSeries(nseSector: string | null | undefined, idxName: string | null): Promise<{ name: string; points: IndexPoint[] } | null> {
    if (idxName) {
      const pts = await this.indexPoints(idxName);
      if (pts.length >= 260 || !nseSector || nseSector === 'Unclassified') return pts.length ? { name: idxName, points: pts } : null;
    }
    if (!nseSector || nseSector === 'Unclassified') return null;
    const key = `ew:${nseSector}`;
    const day = istDay();
    const hit = this.indexCache.get(key);
    if (hit?.day !== day) {
      const rows: { date: string; r: number; n: number }[] = await this.ds.query(
        `SELECT b.date AS date, AVG(MIN(MAX(b.close / b."prevClose" - 1, -0.2), 0.2)) AS r, COUNT(*) AS n
         FROM daily_bars b JOIN stocks s ON s.symbol = b.symbol
         WHERE s.sector = ? AND b."prevClose" > 0 AND b.date >= date('now', '-800 day')
         GROUP BY b.date ORDER BY b.date`, [nseSector]);
      let level = 1000;
      const points = rows.filter((x) => x.n >= 3).map((x) => ({ date: x.date, close: Math.round((level *= 1 + x.r) * 100) / 100 }));
      this.indexCache.set(key, { day, points });
    }
    const points = this.indexCache.get(key)!.points;
    return points.length ? { name: `${nseSector} (equal-weight of NSE sector stocks)`, points } : null;
  }

  private async benchmark() {
    return this.indexPoints('Nifty 50');
  }

  private async surveillance(): Promise<Surveillance | null> {
    const day = istDay();
    if (this.surveillanceCache?.day === day) return this.surveillanceCache.data;
    try {
      const data = await this.bridge.run<Surveillance>('surveillance', {}, 120_000);
      if (data.ok || data.stale) this.surveillanceCache = { day, data };
      return data.ok || data.stale ? data : null;
    } catch (e) {
      this.log.warn(`surveillance list unavailable: ${(e as Error).message}`);
      return null;
    }
  }

  private async medians(): Promise<Medians> {
    if (this.mediansCache && Date.now() - this.mediansCache.at < 6 * 3600_000) return this.mediansCache.data;
    const data = await this.bridge.run<Medians>('sector-medians', {}, 120_000).catch(() => ({}) as Medians);
    this.mediansCache = { at: Date.now(), data };
    return data;
  }

  private async storedFlags(symbol: string): Promise<RedFlag[]> {
    const rows = await this.ds.getRepository(RedFlagEntity).findBy({ symbol });
    return rows.map((r) => ({ category: r.category as RedFlag['category'], level: r.level as RedFlag['level'], title: r.title, source: r.source as RedFlag['source'], status: r.status as RedFlag['status'], link: r.link, date: r.detectedOn }));
  }

  // ---- analysis -------------------------------------------------------------------------------------
  /** Runs the 18-step engine for one stock. Pass `company` / `surv` / `medians` when they were bulk-loaded. */
  async analyse(symbol: string, opts: { persist?: boolean; company?: CompanyData | null; surv?: Surveillance | null; medians?: Medians; forceData?: boolean } = {}): Promise<AnalysisResult> {
    const prices = await this.prices(symbol);
    if (!prices.length) throw new NotFoundException(`No NSE price history for ${symbol}`);
    const [info] = await this.ds.query('SELECT symbol, name, sector FROM stocks WHERE symbol = ?', [symbol]) as { symbol: string; name: string | null; sector: string | null }[];
    const company = opts.company !== undefined ? opts.company : await this.bridge.run<CompanyData>('company', { symbol, force: !!opts.forceData }, 5 * 60_000).catch((e) => {
      this.log.warn(`company data for ${symbol} failed: ${(e as Error).message}`);
      return null;
    });
    const surv = opts.surv !== undefined ? opts.surv : await this.surveillance();
    const medians = opts.medians ?? (await this.medians());
    const config = await this.getConfig();
    const st = company?.statements;
    const yahooSector = st?.yahooSector ?? null;
    const sector = effectiveSector(info?.sector, yahooSector);
    const idxName = sectorIndexName(info?.sector, yahooSector);
    const latestPat = (st?.annual?.pat as (number | null)[] | undefined)?.[0] ?? null;
    const template = resolveTemplate(config, templateKeyFor(info?.sector ?? null, yahooSector, latestPat));
    const med = sector ? medians[sector] : undefined;

    const result = analyzeStock({
      symbol,
      name: info?.name ?? st?.name ?? null,
      sector,
      asOf: prices[prices.length - 1].date,
      template,
      config,
      prices,
      benchmark: await this.benchmark(),
      sectorIndex: await this.sectorSeries(info?.sector, idxName),
      company,
      sectorMedian: med ? { evToEbitda: med.evToEbitda, pe: med.pe } : null,
      surveillance: surv ? surv.symbols[symbol] ?? [] : null,
      storedFlags: await this.storedFlags(symbol),
    });
    if (opts.persist !== false) await this.persist(result);
    return result;
  }

  private async persist(r: AnalysisResult) {
    await this.ds.transaction(async (em) => {
      const runs = em.getRepository(AnalysisRunEntity);
      const old = await runs.findOneBy({ symbol: r.symbol, asOfDate: r.asOfDate, configVersion: r.configVersion });
      if (old) {
        await em.getRepository(StepScoreEntity).delete({ runId: old.id });
        await runs.delete({ id: old.id });
      }
      const run = await runs.save({
        symbol: r.symbol, name: r.name, sector: r.sector, asOfDate: r.asOfDate, totalScore: r.totalScore, coverage: r.coverage, verdict: r.verdict,
        gateTriggered: r.gateTriggered, valuationStretched: r.valuationStretched, technicalReady: r.technicalReady, template: r.template.key,
        close: r.metrics.close, adtvCr: r.metrics.adtvCr, marketCapCr: r.metrics.marketCapCr, alertPrice: r.watch?.alertPrice ?? null,
        reason: r.reason.slice(0, 300), configVersion: r.configVersion, payload: JSON.stringify(r), createdAt: nowIso(),
      });
      await em.getRepository(StepScoreEntity).save(r.steps.map((s) => ({
        runId: run.id, stepNo: s.step, score: s.score, maxScore: s.maxScore, coverage: s.coverage, gate: s.gate, status: s.status, flags: s.flags, metrics: s.metrics,
      })));
      // suggested flags from filings go to the review queue (existing rows keep their reviewed status)
      const flags = em.getRepository(RedFlagEntity);
      for (const f of r.redFlags.filter((x) => x.status === 'suggested' && x.source !== 'manual')) {
        const title = f.title.slice(0, 300);
        if (!(await flags.findOneBy({ symbol: r.symbol, title }))) {
          await flags.save({ symbol: r.symbol, category: f.category, level: f.level, title, source: f.source, status: 'suggested', link: f.link ?? null, detectedOn: f.date ?? null, reviewedAt: null });
        }
      }
    });
  }

  /** Latest stored run for a symbol (optionally on a given date). */
  async latestRun(symbol: string, date?: string): Promise<AnalysisRunEntity | null> {
    const qb = this.ds.getRepository(AnalysisRunEntity).createQueryBuilder('r').where('r.symbol = :symbol', { symbol });
    if (date) qb.andWhere('r.asOfDate <= :date', { date });
    return qb.orderBy('r.asOfDate', 'DESC').addOrderBy('r.id', 'DESC').getOne();
  }

  async analysis(symbol: string, opts: { date?: string; refresh?: boolean }): Promise<AnalysisResult & { runId: number; cached: boolean }> {
    if (!opts.refresh) {
      const run = await this.latestRun(symbol, opts.date);
      const latestBar = await this.ds.query('SELECT MAX(date) AS d FROM daily_bars WHERE symbol = ?', [symbol]) as { d: string | null }[];
      const cfg = await this.getConfig();
      const stored = run ? (JSON.parse(run.payload) as AnalysisResult) : null;
      const current = stored?.engineVersion === ENGINE_VERSION;
      const fresh = run && (opts.date || (current && run.asOfDate === latestBar[0]?.d && run.configVersion === cfg.version));
      if (run && fresh) return { ...stored!, runId: run.id, cached: true };
      if (opts.date && !run) throw new NotFoundException(`No stored analysis for ${symbol} on or before ${opts.date}`);
    }
    const r = await this.analyse(symbol, { forceData: !!opts.refresh });
    const run = await this.latestRun(symbol);
    return { ...r, runId: run!.id, cached: false };
  }

  async history(symbol: string) {
    return this.ds.getRepository(AnalysisRunEntity).find({
      where: { symbol }, order: { asOfDate: 'DESC', id: 'DESC' }, take: 120,
      select: { id: true, asOfDate: true, totalScore: true, verdict: true, coverage: true, configVersion: true, close: true, reason: true },
    });
  }

  // ---- screener ---------------------------------------------------------------------------------------
  async screener(q: { verdict?: string; minScore?: number; sector?: string; minTradedValue?: number; query?: string; sort?: string; order?: string; page?: number; pageSize?: number; technicalReady?: boolean }) {
    const latest = this.ds.getRepository(AnalysisRunEntity).createQueryBuilder('x').select('MAX(x.id)').groupBy('x.symbol');
    const qb = this.ds.getRepository(AnalysisRunEntity).createQueryBuilder('r').where(`r.id IN (${latest.getQuery()})`);
    if (q.verdict) qb.andWhere('r.verdict IN (:...v)', { v: q.verdict.toUpperCase().split(',') });
    if (q.minScore != null) qb.andWhere('r.totalScore >= :ms', { ms: q.minScore });
    if (q.sector) qb.andWhere('r.sector = :sec', { sec: q.sector });
    if (q.minTradedValue != null) qb.andWhere('r.adtvCr >= :tv', { tv: q.minTradedValue });
    if (q.technicalReady) qb.andWhere('r.technicalReady = 1');
    if (q.query) qb.andWhere('(r.symbol LIKE :q OR r.name LIKE :q)', { q: `%${q.query.toUpperCase()}%` });
    const sortable: Record<string, string> = { score: 'r.totalScore', symbol: 'r.symbol', tradedValue: 'r.adtvCr', marketCap: 'r.marketCapCr', coverage: 'r.coverage', date: 'r.asOfDate' };
    qb.orderBy(sortable[q.sort ?? 'score'] ?? 'r.totalScore', q.order === 'asc' ? 'ASC' : 'DESC');
    const pageSize = Math.min(200, Math.max(10, q.pageSize ?? 50));
    const page = Math.max(1, q.page ?? 1);
    const [rows, total] = await qb.skip((page - 1) * pageSize).take(pageSize).getManyAndCount();
    const counts: { verdict: string; n: number }[] = await this.ds.query(
      `SELECT verdict, COUNT(*) AS n FROM analysis_runs WHERE id IN (SELECT MAX(id) FROM analysis_runs GROUP BY symbol) GROUP BY verdict`);
    const sectors: { sector: string }[] = await this.ds.query(
      `SELECT DISTINCT sector FROM analysis_runs WHERE sector IS NOT NULL ORDER BY sector`);
    return {
      page, pageSize, total,
      counts: Object.fromEntries(counts.map((c) => [c.verdict, Number(c.n)])),
      sectors: sectors.map((s) => s.sector),
      lastRun: this.state.finishedAt,
      rows: rows.map(({ payload: _p, ...r }) => r),
    };
  }

  // ---- nightly universe run -------------------------------------------------------------------------
  async universe(): Promise<{ symbol: string; adtvCr: number }[]> {
    const cfg = await this.getConfig();
    const [{ d }] = await this.ds.query('SELECT MAX(date) AS d FROM daily_bars') as { d: string }[];
    const dates: { date: string }[] = await this.ds.query('SELECT DISTINCT date FROM daily_bars WHERE date <= ? ORDER BY date DESC LIMIT 50', [d]);
    const from = dates.at(-1)?.date ?? d;
    const rows: { symbol: string; adtv: number; n: number; last: string }[] = await this.ds.query(
      `SELECT symbol, AVG(turnover) / 1e7 AS adtv, COUNT(*) AS n, MAX(date) AS last FROM daily_bars WHERE date >= ? AND symbol IN (SELECT symbol FROM stocks WHERE isin IS NULL OR isin NOT LIKE 'INF%') GROUP BY symbol`, [from]);
    return rows
      .filter((r) => r.last === d && r.n >= 20 && r.adtv >= cfg.universe.minAdtvCr)
      .sort((a, b) => b.adtv - a.adtv)
      .slice(0, cfg.universe.maxStocks)
      .map((r) => ({ symbol: r.symbol, adtvCr: Math.round(r.adtv * 10) / 10 }));
  }

  /** Full-universe run: company data in Python batches, engine per stock, then watchlist alerts. */
  runUniverse(opts: { symbols?: string[] } = {}): boolean {
    if (this.state.running) return false;
    this.state = { running: true, step: 'selecting universe', done: 0, total: 0, startedAt: nowIso(), finishedAt: null, error: null, counts: { BUY: 0, WAIT: 0, AVOID: 0, failed: 0 } };
    void this.doRun(opts).catch((e) => {
      this.state.error = (e as Error).message;
      this.log.error(`selection run failed: ${(e as Error).message}`);
    }).finally(() => {
      this.state.running = false;
      this.state.finishedAt = nowIso();
      this.state.step = this.state.error ? 'failed' : 'done';
    });
    return true;
  }

  private async doRun(opts: { symbols?: string[] }) {
    const jobs = this.ds.getRepository(JobRunEntity);
    const job = await jobs.save({ name: 'selection-universe', startedAt: nowIso(), endedAt: null, status: 'RUNNING', rows: 0, error: null });
    try {
      const symbols = opts.symbols?.length ? opts.symbols : (await this.universe()).map((u) => u.symbol);
      this.state.total = symbols.length;
      let surv: Surveillance | null = null;
      let medians: Medians = {};
      for (let i = 0; i < symbols.length; i += BATCH) {
        const chunk = symbols.slice(i, i + BATCH);
        this.state.step = `fetching company data ${i + 1}-${i + chunk.length} of ${symbols.length}`;
        const batch = await this.bridge.run<{ companies: Record<string, CompanyData>; sectorMedians: Medians; surveillance: Surveillance }>(
          'company-batch', { symbols: chunk }, 30 * 60_000,
        ).catch((e) => {
          this.log.warn(`company batch failed: ${(e as Error).message}`);
          return null;
        });
        if (batch) {
          medians = batch.sectorMedians;
          surv = batch.surveillance?.ok || batch.surveillance?.stale ? batch.surveillance : surv;
        }
        this.state.step = `analysing ${i + 1}-${i + chunk.length} of ${symbols.length}`;
        for (const s of chunk) {
          try {
            const r = await this.analyse(s, { company: batch?.companies[s] ?? null, surv, medians });
            this.state.counts[r.verdict]++;
          } catch (e) {
            this.state.counts.failed++;
            this.log.warn(`analyse ${s}: ${(e as Error).message}`);
          }
          this.state.done++;
        }
      }
      this.mediansCache = { at: Date.now(), data: medians };
      this.state.step = 'checking watchlist alerts';
      await this.evaluateWatchlist();
      await jobs.update(job.id, { status: 'OK', endedAt: nowIso(), rows: this.state.done });
      const c = this.state.counts;
      await this.notify.send('info', `Selection run done: ${this.state.done} stocks · BUY ${c.BUY} · WAIT ${c.WAIT} · AVOID ${c.AVOID}${c.failed ? ` · failed ${c.failed}` : ''}`);
    } catch (e) {
      await jobs.update(job.id, { status: 'ERROR', endedAt: nowIso(), rows: this.state.done, error: (e as Error).message.slice(0, 500) });
      throw e;
    }
  }

  async jobs() {
    return this.ds.getRepository(JobRunEntity).find({ order: { id: 'DESC' }, take: 30 });
  }

  // ---- watchlist --------------------------------------------------------------------------------------
  async watchlist() {
    const items = await this.ds.getRepository(WatchlistItemEntity).find({ order: { addedAt: 'DESC' } });
    const out = [];
    for (const w of items) {
      const run = await this.latestRun(w.symbol);
      const close = run?.close ?? null;
      const alert = w.alertPrice ?? run?.alertPrice ?? null;
      out.push({
        ...w,
        alertPrice: alert,
        zone: w.zone ?? (run ? (JSON.parse(run.payload) as AnalysisResult).watch?.zone ?? null : null),
        verdict: run?.verdict ?? null, totalScore: run?.totalScore ?? null, asOfDate: run?.asOfDate ?? null, close, reason: run?.reason ?? null,
        distancePct: close != null && alert != null ? Math.round((close / alert - 1) * 1000) / 10 : null,
      });
    }
    return out;
  }

  async addWatch(symbol: string, body: { alertPrice?: number | null; zone?: string | null; note?: string | null }) {
    const repo = this.ds.getRepository(WatchlistItemEntity);
    const run = await this.latestRun(symbol);
    const existing = await repo.findOneBy({ symbol });
    const row = {
      ...(existing ?? { symbol, addedAt: nowIso(), lastVerdict: run?.verdict ?? null, lastClose: run?.close ?? null, triggeredAt: null }),
      alertPrice: body.alertPrice ?? existing?.alertPrice ?? run?.alertPrice ?? null,
      zone: body.zone ?? existing?.zone ?? null,
      note: body.note ?? existing?.note ?? null,
    };
    return repo.save(row);
  }

  async removeWatch(symbol: string) {
    await this.ds.getRepository(WatchlistItemEntity).delete({ symbol });
    return { removed: symbol };
  }

  /** After each run: alert when a watched stock turns BUY, or its close reaches the alert level. */
  async evaluateWatchlist() {
    const repo = this.ds.getRepository(WatchlistItemEntity);
    const alerts: string[] = [];
    for (const w of await repo.find()) {
      const run = await this.latestRun(w.symbol);
      if (!run) continue;
      const alert = w.alertPrice ?? run.alertPrice;
      if (run.verdict === 'BUY' && w.lastVerdict !== 'BUY') alerts.push(`${w.symbol} turned BUY (score ${run.totalScore}) at ₹${run.close}`);
      else if (alert != null && run.close != null && run.close <= alert * 1.01 && (w.lastClose == null || w.lastClose > alert * 1.01)) {
        alerts.push(`${w.symbol} reached its alert level ₹${alert} (close ₹${run.close}, verdict ${run.verdict})`);
      }
      await repo.update(w.id, { lastVerdict: run.verdict, lastClose: run.close, triggeredAt: alerts.some((a) => a.startsWith(`${w.symbol} `)) ? nowIso() : w.triggeredAt });
    }
    if (alerts.length) await this.notify.send('info', `Watchlist alerts:\n${alerts.join('\n')}`);
    return alerts;
  }

  // ---- red-flag review --------------------------------------------------------------------------------
  async flags(status?: string, symbol?: string) {
    const where: Record<string, string> = {};
    if (status) where.status = status;
    if (symbol) where.symbol = symbol;
    return this.ds.getRepository(RedFlagEntity).find({ where, order: { id: 'DESC' }, take: 300 });
  }

  async reviewFlag(id: number, status: 'confirmed' | 'resolved' | 'suggested') {
    const repo = this.ds.getRepository(RedFlagEntity);
    const f = await repo.findOneBy({ id });
    if (!f) throw new NotFoundException(`flag ${id} not found`);
    await repo.update(id, { status, reviewedAt: nowIso() });
    return { ...f, status };
  }

  async addFlag(symbol: string, body: { category: string; level: number; title: string; link?: string | null }) {
    return this.ds.getRepository(RedFlagEntity).save({
      symbol, category: body.category, level: body.level, title: body.title.slice(0, 300), source: 'manual', status: 'confirmed', link: body.link ?? null,
      detectedOn: istDay(), reviewedAt: nowIso(),
    });
  }
}
