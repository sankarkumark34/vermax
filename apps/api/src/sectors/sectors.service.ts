import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { CronJob } from 'cron';
import fs from 'node:fs';
import path from 'node:path';
import { DataSource } from 'typeorm';
import { PythonBridgeService } from '../bridge/python-bridge.service.js';
import { loadConfig } from '../config/app.config.js';
import { adjustBars } from '../data/adjust.js';
import { DataService } from '../data/data.service.js';
import type { AnalysisResult, CompanyData } from '../selection/domain/index.js';
import { SelectionService } from '../selection/selection.service.js';
import { screen, type Bar, type ScreenResult } from '../winners/domain/periods.js';
import { marketDistribution } from '../winners/domain/rank.js';
import { slim, type RawRow } from '../winners/winners.service.js';
import { checks, growthFacts, leaderScores, priceScore, qualifies, sectorStats, trendFacts, type TrendFacts } from './domain/sectors.js';

const nowIso = () => new Date().toISOString();
const istDay = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const r4 = (x: number | null) => (x == null ? null : Math.round(x * 10000) / 10000);
const BATCH = 20;
const MIN_ADTV_CR = 1, MIN_PRICE = 20, LOOKBACK_DAYS = 640;
const PER_SECTOR = Number(process.env.SECTORS_PER_SECTOR ?? 10);     // deep (18-step) analysis per sector
const OTHERS = 'Others';

export interface SectorsState { running: boolean; step: string; done: number; total: number; startedAt: string | null; finishedAt: string | null; error: string | null }

/**
 * Sector Leaders: every liquid NSE stock (ADTV >= 1 Cr, price >= 20) is put in an NSE sector (NSE Total Market list,
 * Yahoo industry for the rest), scored on price growth and trend, sectors are ranked by strength, and the top
 * stocks of every sector get the 18-step fundamental + technical analysis. Weekdays after the other screens.
 */
@Injectable()
export class SectorsService implements OnModuleInit {
  private readonly log = new Logger(SectorsService.name);
  private readonly cfg = loadConfig();
  state: SectorsState = { running: false, step: 'idle', done: 0, total: 0, startedAt: null, finishedAt: null, error: null };

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly selection: SelectionService,
    private readonly bridge: PythonBridgeService,
    private readonly data: DataService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit() {
    if (!this.cfg.scheduler.enabled) return;
    const cron = process.env.SECTORS_CRON ?? '45 20 * * 1-5';      // after the 19:30 Top Picks and 20:15 Steady runs
    this.registry.addCronJob('sectors', CronJob.from({ cronTime: cron, timeZone: this.cfg.scheduler.timezone, start: true, onTick: () => void this.run() }));
    this.log.log(`sector leaders scheduled "${cron}" (${this.cfg.scheduler.timezone})`);
  }

  private dir() { return path.join(this.cfg.repoRoot, 'data', 'screener'); }

  latest(): (Record<string, any> & { asOf: string }) | null {
    const d = this.dir();
    const files = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /^sectors-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() : [];
    return files.length ? JSON.parse(fs.readFileSync(path.join(d, files.at(-1)!), 'utf8')) : null;
  }

  async latestBarDate(): Promise<string> {
    const [r] = (await this.ds.query('SELECT MAX(date) AS d FROM daily_bars')) as { d: string }[];
    return r.d;
  }

  run(): boolean {
    if (this.state.running) return false;
    this.state = { running: true, step: 'starting', done: 0, total: 0, startedAt: nowIso(), finishedAt: null, error: null };
    void this.doRun()
      .catch((e) => { this.state.error = (e as Error).message; this.log.error(`sector run failed: ${(e as Error).message}`); })
      .finally(() => { this.state.running = false; this.state.finishedAt = nowIso(); this.state.step = this.state.error ? 'failed' : 'done'; });
    return true;
  }

  private async loadBars(symbols: string[], from: string) {
    const out = new Map<string, RawRow[]>();
    for (let i = 0; i < symbols.length; i += 300) {
      const chunk = symbols.slice(i, i + 300);
      const rows: RawRow[] = await this.ds.query(
        `SELECT symbol, date, open, high, low, close, volume, "prevClose" AS prevClose, turnover, "deliveryPct" AS deliveryPct
         FROM daily_bars WHERE date >= ? AND symbol IN (${chunk.map(() => '?').join(',')}) ORDER BY symbol, date`, [from, ...chunk]);
      for (const r of rows) { const a = out.get(r.symbol) ?? []; a.push(r); out.set(r.symbol, a); }
    }
    return new Map([...out].map(([s, rows]) => [s, adjustBars(rows)]));
  }

  private async doRun() {
    const config = await this.selection.getConfig();
    const wc = config.winners, waitMin = config.verdict.waitMin;
    const today = istDay();
    const latest = await this.latestBarDate();

    // ---- 1. sectors: NSE lists (refreshed weekly by the provider cache), Yahoo industry for the rest -------------
    this.state.step = 'updating NSE sector lists';
    await this.data.syncUniverse().catch((e) => this.log.warn(`sector list sync failed: ${(e as Error).message}`));

    this.state.step = 'selecting liquid stocks';
    const dates: { date: string }[] = await this.ds.query('SELECT DISTINCT date FROM daily_bars WHERE date <= ? ORDER BY date DESC LIMIT 50', [latest]);
    const liq: { symbol: string; adtv: number; n: number; last: string; close: number; name: string | null; sector: string | null }[] = await this.ds.query(
      `SELECT b.symbol, AVG(b.turnover) / 1e7 AS adtv, COUNT(*) AS n, MAX(b.date) AS last, s.name, s.sector,
              (SELECT close FROM daily_bars x WHERE x.symbol = b.symbol ORDER BY date DESC LIMIT 1) AS close
       FROM daily_bars b JOIN stocks s ON s.symbol = b.symbol
       WHERE b.date >= ? AND (s.isin IS NULL OR s.isin NOT LIKE 'INF%') GROUP BY b.symbol`, [dates.at(-1)!.date]);
    const universe = liq.filter((r) => r.last === latest && r.n >= 40 && r.adtv >= MIN_ADTV_CR && r.close >= MIN_PRICE);
    const sectorOf = new Map(universe.map((r) => [r.symbol, r.sector && r.sector !== 'Unclassified' ? r.sector : null]));
    const nse = [...sectorOf.values()].filter(Boolean).length;
    const unknown = universe.filter((r) => !sectorOf.get(r.symbol)).map((r) => r.symbol);
    if (unknown.length) {
      this.state.step = `finding the sector of ${unknown.length} stocks NSE does not classify (first run takes a few minutes)`;
      const m = await this.bridge.run<{ map: Record<string, { sector: string | null; industry: string | null }> }>('sector-map', { symbols: unknown }, 40 * 60_000)
        .catch((e) => { this.log.warn(`sector map failed: ${(e as Error).message}`); return null; });
      for (const s of unknown) sectorOf.set(s, m?.map[s]?.sector ?? null);
    }

    // ---- 2. price growth + trend for every stock ------------------------------------------------------------
    this.state.step = `scoring ${universe.length} stocks on growth and trend`;
    const from = new Date(Date.parse(latest) - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
    const bars = await this.loadBars(universe.map((r) => r.symbol), from);
    const meta = new Map(universe.map((r) => [r.symbol, r]));
    const scored: { symbol: string; sector: string; screen: ScreenResult; trend: TrendFacts }[] = [];
    for (const [symbol, b] of bars) {
      const s = screen(b as Bar[], b.length - 1, today, wc);
      const t = trendFacts(b as Bar[]);
      if (s && t) scored.push({ symbol, sector: sectorOf.get(symbol) ?? OTHERS, screen: s, trend: t });
    }
    const market = marketDistribution(scored.map((x) => x.screen));
    const price = new Map(scored.map((x) => [x.symbol, priceScore(x.screen, x.trend, market)]));
    const sectors = sectorStats(scored);

    // ---- 3. 18-step analysis of the top stocks of every sector --------------------------------------------------
    const bySector = new Map<string, typeof scored>();
    for (const x of scored) bySector.set(x.sector, [...(bySector.get(x.sector) ?? []), x]);
    const picked = [...bySector.values()].flatMap((g) => g.sort((a, z) => price.get(z.symbol)! - price.get(a.symbol)!).slice(0, PER_SECTOR));
    this.state.total = picked.length;
    const done = new Map<string, AnalysisResult>();
    const failed: { symbol: string; error: string }[] = [];
    const todo: string[] = [];
    for (const x of picked) {
      const a = await this.selection.stored(x.symbol);
      if (a) { done.set(x.symbol, a); this.state.done++; } else todo.push(x.symbol);
    }
    for (let i = 0; i < todo.length; i += BATCH) {
      const chunk = todo.slice(i, i + BATCH);
      this.state.step = `analysing fundamentals + technicals ${i + 1}-${i + chunk.length} of ${todo.length}`;
      const batch = await this.bridge.run<{ companies: Record<string, CompanyData>; sectorMedians: Record<string, { evToEbitda: number | null; pe: number | null; n: number }>; surveillance: { asOf: string; ok: boolean; stale?: boolean; symbols: Record<string, string[]> } }>(
        'company-batch', { symbols: chunk }, 30 * 60_000,
      ).catch((e) => { this.log.warn(`company batch failed: ${(e as Error).message}`); return null; });
      for (const s of chunk) {
        for (let attempt = 1; attempt <= 4; attempt++) {
          try {
            done.set(s, await this.selection.analyse(s, {
              company: batch?.companies[s] ?? null,
              surv: batch && (batch.surveillance.ok || batch.surveillance.stale) ? batch.surveillance : undefined,
              medians: batch?.sectorMedians,
            }));
            break;
          } catch (e) {
            const busy = /database is locked|SQLITE_BUSY/i.test((e as Error).message);
            if (busy && attempt < 4) { await new Promise((r) => setTimeout(r, 5000 * attempt)); continue; }
            failed.push({ symbol: s, error: (e as Error).message.slice(0, 160) });
            break;
          }
        }
        this.state.done++;
      }
    }

    // ---- 4. leaders per sector -----------------------------------------------------------------------------------
    const leaders = picked.flatMap((x) => {
      const a = done.get(x.symbol);
      if (!a) return [];
      const g = growthFacts(a);
      const c = checks(a, x.screen, x.trend, g, waitMin);
      return [{
        ...slim({ symbol: x.symbol, screen: x.screen, analysis: a }),
        sector: x.sector, trend: x.trend, growth: g, checks: c, qualified: qualifies(c), priceScore: price.get(x.symbol), ...leaderScores(a, x.screen, market),
      }];
    });
    const stocks = scored.map((x) => {
      const m = meta.get(x.symbol)!;
      return {
        symbol: x.symbol, name: m.name, sector: x.sector, close: x.trend.close, adtvCr: Math.round(m.adtv * 10) / 10,
        ret1w: r4(x.trend.chg1w), ret1m: r4(x.screen.ret1m), ret3m: r4(x.screen.ret3m), ret6m: r4(x.screen.ret6m), ret1y: r4(x.screen.ret1y),
        above50: x.trend.above50, above200: x.trend.above200, rsi: x.trend.rsi == null ? null : Math.round(x.trend.rsi), fromHigh52: x.trend.fromHigh52,
        monthsUp: x.screen.monthsUp, priceScore: price.get(x.symbol), analysed: done.has(x.symbol),
      };
    });
    const payload = {
      asOf: latest, generatedAt: nowIso(),
      params: { minAdtvCr: MIN_ADTV_CR, minPrice: MIN_PRICE, perSector: PER_SECTOR, waitMin },
      funnel: { liquid: universe.length, nseClassified: nse, scored: scored.length, others: scored.filter((x) => x.sector === OTHERS).length, analysed: leaders.length, failed: failed.length },
      sectors: sectors.map((s) => ({
        ...s,
        analysed: leaders.filter((l) => l.sector === s.sector).length,
        qualified: leaders.filter((l) => l.sector === s.sector && l.qualified).length,
        buy: leaders.filter((l) => l.sector === s.sector && l.qualified && l.verdict === 'BUY').length,
      })),
      leaders, stocks, failed,
    };
    fs.mkdirSync(this.dir(), { recursive: true });
    fs.writeFileSync(path.join(this.dir(), `sectors-${latest}.json`), JSON.stringify(payload));
    this.log.log(`sector leaders ${latest}: ${universe.length} liquid, ${sectors.length} sectors, ${leaders.length} analysed, ${leaders.filter((l) => l.qualified).length} qualified`);
  }
}
