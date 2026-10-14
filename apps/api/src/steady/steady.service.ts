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
import type { AnalysisResult, CompanyData } from '../selection/domain/index.js';
import { SelectionService } from '../selection/selection.service.js';
import { screen, type Bar } from '../winners/domain/periods.js';
import { slim, type RawRow } from '../winners/winners.service.js';
import { isCandidate, steadyFacts, steadyScore, type SteadyFacts } from './domain/steady.js';

const nowIso = () => new Date().toISOString();
const istDay = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const BATCH = 20;
const MIN_PRICE = 50, MAX_PRICE = 1500, MIN_MONTHS = 3, LOOKBACK_DAYS = 520;

export interface SteadyState { running: boolean; step: string; done: number; total: number; startedAt: string | null; finishedAt: string | null; error: string | null }

/**
 * Steady Picks: every liquid NSE stock priced 50-1500 that has traded for at least 3 months, screened for
 * "never closed below where it started (listing price / start of the window), every month and quarter up, RSI",
 * then the survivors get the 18-step fundamental + technical analysis (verdict, entry / stop / target).
 * The UI applies the exact rule thresholds, so changing a threshold needs no re-run.
 */
@Injectable()
export class SteadyService implements OnModuleInit {
  private readonly log = new Logger(SteadyService.name);
  private readonly cfg = loadConfig();
  state: SteadyState = { running: false, step: 'idle', done: 0, total: 0, startedAt: null, finishedAt: null, error: null };

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly selection: SelectionService,
    private readonly bridge: PythonBridgeService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit() {
    if (!this.cfg.scheduler.enabled) return;
    const cron = process.env.STEADY_CRON ?? '15 20 * * 1-5';      // after the 18:45 ingest and the 19:30 Top Picks run
    this.registry.addCronJob('steady', CronJob.from({ cronTime: cron, timeZone: this.cfg.scheduler.timezone, start: true, onTick: () => void this.run() }));
    this.log.log(`steady picks scheduled "${cron}" (${this.cfg.scheduler.timezone})`);
  }

  private dir() { return path.join(this.cfg.repoRoot, 'data', 'screener'); }

  latest(): (Record<string, any> & { asOf: string }) | null {
    const d = this.dir();
    const files = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /^steady-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() : [];
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
      .catch((e) => { this.state.error = (e as Error).message; this.log.error(`steady run failed: ${(e as Error).message}`); })
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
    const wc = (await this.selection.getConfig()).winners;
    const today = istDay();
    const latest = await this.latestBarDate();
    const cutSeasoned = new Date(Date.parse(latest) - MIN_MONTHS * 31 * 86_400_000).toISOString().slice(0, 10);

    this.state.step = 'selecting liquid stocks';
    const dates: { date: string }[] = await this.ds.query('SELECT DISTINCT date FROM daily_bars WHERE date <= ? ORDER BY date DESC LIMIT 50', [latest]);
    const [{ d: dataStart }] = (await this.ds.query('SELECT MIN(date) AS d FROM daily_bars')) as { d: string }[];
    const liq: { symbol: string; adtv: number; n: number; last: string; first: string; close: number }[] = await this.ds.query(
      `SELECT symbol, AVG(CASE WHEN date >= ? THEN turnover END) / 1e7 AS adtv, COUNT(*) AS n, MAX(date) AS last, MIN(date) AS first,
              (SELECT close FROM daily_bars x WHERE x.symbol = b.symbol ORDER BY date DESC LIMIT 1) AS close
       FROM daily_bars b WHERE b.symbol IN (SELECT symbol FROM stocks WHERE isin IS NULL OR isin NOT LIKE 'INF%') GROUP BY symbol`, [dates.at(-1)!.date]);
    const universe = liq.filter((r) => r.last === latest && r.adtv >= wc.minAdtvCr && r.close >= MIN_PRICE && r.close <= MAX_PRICE && r.first <= cutSeasoned);
    const first = new Map(universe.map((r) => [r.symbol, r.first]));

    this.state.step = `screening ${universe.length} stocks`;
    const from = new Date(Date.parse(latest) - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
    const bars = await this.loadBars(universe.map((r) => r.symbol), from);
    const facts = new Map<string, SteadyFacts>();
    for (const [sym, b] of bars) {
      const f = steadyFacts(b as Bar[], first.get(sym)!, dataStart, today);
      if (f) facts.set(sym, f);
    }
    const cands = [...facts].filter(([, f]) => isCandidate(f)).map(([symbol]) => symbol);
    const ret3m = (s: string) => { const b = bars.get(s)!; return b[b.length - 1].close / b[Math.max(0, b.length - 64)].close - 1; };
    const picked = cands.sort((a, z) => steadyScore(facts.get(z)!) - steadyScore(facts.get(a)!) || ret3m(z) - ret3m(a)).slice(0, wc.maxAnalyse);

    this.state.total = picked.length;
    const failed: { symbol: string; error: string }[] = [];
    const todo: string[] = [];
    const done = new Map<string, AnalysisResult>();
    for (const s of picked) {
      const a = await this.selection.stored(s);
      if (a) { done.set(s, a); this.state.done++; } else todo.push(s);
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
    const rows: Record<string, unknown>[] = [];
    for (const s of picked) {
      const analysis = done.get(s);
      const b = bars.get(s)!;
      const sc = screen(b as Bar[], b.length - 1, today, wc);
      if (!analysis || !sc) continue;
      rows.push(slim({ symbol: s, screen: sc, analysis }, { steady: facts.get(s) }));
    }
    const payload = {
      asOf: latest, generatedAt: nowIso(), price: { min: MIN_PRICE, max: MAX_PRICE }, minMonths: MIN_MONTHS,
      funnel: { liquid: universe.length, screened: facts.size, candidates: cands.length, analysed: rows.length, failed: failed.length },
      rows, failed,
    };
    fs.mkdirSync(this.dir(), { recursive: true });
    fs.writeFileSync(path.join(this.dir(), `steady-${latest}.json`), JSON.stringify(payload));
    this.log.log(`steady picks ${latest}: ${universe.length} liquid -> ${cands.length} candidates -> ${rows.length} analysed`);
  }
}
