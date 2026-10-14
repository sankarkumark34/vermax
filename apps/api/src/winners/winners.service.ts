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
import { NotifyService } from '../notify/notify.service.js';
import { emaSeries } from '../analysis/technicals.js';
import type { AnalysisResult, CompanyData } from '../selection/domain/index.js';
import { SelectionService } from '../selection/selection.service.js';
import { screen, type Bar, type ScreenResult, type WinnerCriteria } from './domain/periods.js';
import { marketDistribution, rankWinners, rejected, type RankedRow } from './domain/rank.js';
import { WinnerRunEntity } from './winner-run.entity.js';

const nowIso = () => new Date().toISOString();
const istDay = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const r2 = (x: number) => Math.round(x * 100) / 100;
const BATCH = 20;

export interface RawRow { symbol: string; date: string; open: number; high: number; low: number; close: number; volume: number; prevClose: number; turnover: number | null; deliveryPct: number | null }

export interface WinnerState { running: boolean; step: string; done: number; total: number; startedAt: string | null; finishedAt: string | null; error: string | null }

/** Slim row for the UI (the full 18-step result stays in analysis_runs). */
export function slim(r: RankedRow | { symbol: string; screen: ScreenResult; analysis: AnalysisResult }, extra: Record<string, unknown> = {}) {
  const a = r.analysis, t = a.technical;
  return {
    symbol: r.symbol, name: a.name, sector: a.sector, close: a.metrics.close, adtvCr: a.metrics.adtvCr, marketCapCr: a.metrics.marketCapCr,
    screen: r.screen,
    verdict: a.verdict, totalScore: a.totalScore, coverage: a.coverage, valuationStretched: a.valuationStretched, gates: a.gates, reason: a.reason,
    template: a.template.label,
    technical: t ? {
      trend: t.trend, ready: t.technicalReady, atrPct: t.atrPct, checks: t.checks, plan: t.plan, targets: t.targets.slice(0, 3), watch: t.watch,
      patterns: t.patterns.filter((p) => p.bullish).map((p) => p.name), levelReasons: t.levelReasons, rsi: t.rsi14, rs3m: t.rs.m3,
      structure: t.lastStructure, fibZone: t.fib?.zone ?? null, poc: t.volumeProfile?.poc ?? null,
    } : null,
    position: a.position?.ok ? { qty: a.position.qty, value: a.position.positionValue, risk: a.position.actualRisk } : null,
    ...('composite' in r ? { rank: r.rank, composite: r.composite, momentumScore: r.momentumScore, fundamentalScore: r.fundamentalScore, technicalScore: r.technicalScore, action: r.action } : {}),
    ...extra,
  };
}

/**
 * Top Picks pipeline (weekdays 19:30 IST, after the 18:45 data ingest):
 *   1. every liquid NSE stock -> periodic screen (week / month / quarter / FY positive, N-month streak, quick recovery)
 *   2. passers -> the proposal's 18-step fundamental + technical analysis
 *   3. gated or weak-fundamental stocks rejected; the rest ranked by momentum + fundamentals + technical setup
 * The price-only part of the screen is also backtested month by month (see backtest()).
 */
@Injectable()
export class WinnersService implements OnModuleInit {
  private readonly log = new Logger(WinnersService.name);
  private readonly cfg = loadConfig();
  state: WinnerState = { running: false, step: 'idle', done: 0, total: 0, startedAt: null, finishedAt: null, error: null };
  backtestState: { running: boolean; error: string | null } = { running: false, error: null };

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly selection: SelectionService,
    private readonly bridge: PythonBridgeService,
    private readonly data: DataService,
    private readonly notify: NotifyService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit() {
    if (!this.cfg.scheduler.enabled) return;
    const cron = process.env.WINNERS_CRON ?? '30 19 * * 1-5';
    this.registry.addCronJob('top-picks', CronJob.from({ cronTime: cron, timeZone: this.cfg.scheduler.timezone, start: true, onTick: () => void this.run() }));
    this.log.log(`top picks scheduled "${cron}" (${this.cfg.scheduler.timezone})`);
  }

  private async criteria(): Promise<WinnerCriteria & { minAdtvCr: number; minPrice: number; maxAnalyse: number; waitMin: number }> {
    const c = await this.selection.getConfig();
    return { ...c.winners, waitMin: c.verdict.waitMin };
  }

  async latest() {
    const row = await this.ds.getRepository(WinnerRunEntity).findOne({ where: {}, order: { asOf: 'DESC', id: 'DESC' } });
    return row ? { ...JSON.parse(row.payload), runId: row.id } : null;
  }

  async history() {
    return this.ds.getRepository(WinnerRunEntity).find({ order: { asOf: 'DESC' }, take: 60, select: { id: true, asOf: true, createdAt: true } });
  }

  async byDate(asOf: string) {
    const row = await this.ds.getRepository(WinnerRunEntity).findOne({ where: { asOf }, order: { id: 'DESC' } });
    return row ? { ...JSON.parse(row.payload), runId: row.id } : null;
  }

  run(opts: { ingest?: boolean } = {}): boolean {
    if (this.state.running) return false;
    this.state = { running: true, step: 'starting', done: 0, total: 0, startedAt: nowIso(), finishedAt: null, error: null };
    void this.doRun(opts.ingest ?? true)
      .catch((e) => { this.state.error = (e as Error).message; this.log.error(`top picks failed: ${(e as Error).message}`); })
      .finally(() => { this.state.running = false; this.state.finishedAt = nowIso(); this.state.step = this.state.error ? 'failed' : 'done'; });
    return true;
  }

  /** Loads split-adjusted bars for many symbols in chunks (one query per chunk). */
  private async loadBars(symbols: string[], from: string): Promise<Map<string, (Bar & { volume: number; turnover: number | null; deliveryPct: number | null })[]>> {
    const out = new Map<string, RawRow[]>();
    for (let i = 0; i < symbols.length; i += 300) {
      const chunk = symbols.slice(i, i + 300);
      const rows: RawRow[] = await this.ds.query(
        `SELECT symbol, date, open, high, low, close, volume, "prevClose" AS prevClose, turnover, "deliveryPct" AS deliveryPct
         FROM daily_bars WHERE date >= ? AND symbol IN (${chunk.map(() => '?').join(',')}) ORDER BY symbol, date`,
        [from, ...chunk],
      );
      for (const r of rows) {
        const arr = out.get(r.symbol) ?? [];
        arr.push(r);
        out.set(r.symbol, arr);
      }
    }
    const adjusted = new Map<string, (Bar & { volume: number; turnover: number | null; deliveryPct: number | null })[]>();
    for (const [s, rows] of out) adjusted.set(s, adjustBars(rows));
    return adjusted;
  }

  private async doRun(ingest: boolean) {
    const c = await this.criteria();
    if (ingest) {
      this.state.step = 'updating NSE data';
      await this.data.catchUp().catch((e) => this.log.warn(`ingest skipped: ${(e as Error).message}`));
    }
    const today = istDay();
    const [{ d: latest }] = (await this.ds.query('SELECT MAX(date) AS d FROM daily_bars')) as { d: string }[];

    // ---- 1. liquid universe --------------------------------------------------------------------------
    this.state.step = 'selecting liquid stocks';
    const dates: { date: string }[] = await this.ds.query('SELECT DISTINCT date FROM daily_bars WHERE date <= ? ORDER BY date DESC LIMIT 50', [latest]);
    const from50 = dates.at(-1)!.date;
    const liq: { symbol: string; adtv: number; n: number; last: string; close: number }[] = await this.ds.query(
      `SELECT symbol, AVG(turnover) / 1e7 AS adtv, COUNT(*) AS n, MAX(date) AS last,
              (SELECT close FROM daily_bars x WHERE x.symbol = b.symbol ORDER BY date DESC LIMIT 1) AS close
       FROM daily_bars b WHERE date >= ? AND b.symbol IN (SELECT symbol FROM stocks WHERE isin IS NULL OR isin NOT LIKE 'INF%') GROUP BY symbol`, [from50]);   // INF* ISINs are ETF / fund units, not companies
    const universe = liq.filter((r) => r.last === latest && r.n >= 40 && r.adtv >= c.minAdtvCr && r.close >= c.minPrice).map((r) => r.symbol);

    // ---- 2. periodic screen on ~20 months of adjusted bars ------------------------------------------
    this.state.step = `screening ${universe.length} liquid stocks`;
    const lookbackFrom = new Date(Date.parse(latest) - 640 * 86_400_000).toISOString().slice(0, 10);
    const bars = await this.loadBars(universe, lookbackFrom);
    const screened: { symbol: string; screen: ScreenResult }[] = [];
    for (const s of universe) {
      const b = bars.get(s);
      if (!b || !b.length) continue;
      const r = screen(b, b.length - 1, today, c);
      if (r) screened.push({ symbol: s, screen: r });
    }
    const periodic = screened.filter((x) => x.screen.ticks.week && x.screen.ticks.month && x.screen.ticks.quarter && x.screen.ticks.fy && x.screen.ticks.streak);
    const passers = periodic.filter((x) => x.screen.ticks.resilient)
      .sort((a, b) => (b.screen.ret3m ?? 0) - (a.screen.ret3m ?? 0))
      .slice(0, c.maxAnalyse);
    const near = screened.filter((x) => x.screen.missing.length === 1).sort((a, b) => (b.screen.ret3m ?? 0) - (a.screen.ret3m ?? 0)).slice(0, 40);

    // ---- 3. 18-step fundamental + technical analysis on the passers ---------------------------------
    const analysed: { symbol: string; screen: ScreenResult; analysis: AnalysisResult }[] = [];
    const failed: { symbol: string; error: string }[] = [];
    this.state.total = passers.length;
    for (let i = 0; i < passers.length; i += BATCH) {
      const chunk = passers.slice(i, i + BATCH);
      this.state.step = `analysing fundamentals + technicals ${i + 1}-${i + chunk.length} of ${passers.length}`;
      const batch = await this.bridge.run<{ companies: Record<string, CompanyData>; sectorMedians: Record<string, { evToEbitda: number | null; pe: number | null; n: number }>; surveillance: { asOf: string; ok: boolean; stale?: boolean; symbols: Record<string, string[]> } }>(
        'company-batch', { symbols: chunk.map((x) => x.symbol) }, 30 * 60_000,
      ).catch((e) => { this.log.warn(`company batch failed: ${(e as Error).message}`); return null; });
      for (const x of chunk) {
        // SQLite allows one writer: if another Vermax process is ingesting, wait and retry rather than drop the stock
        for (let attempt = 1; attempt <= 4; attempt++) {
          try {
            const analysis = await this.selection.analyse(x.symbol, {
              company: batch?.companies[x.symbol] ?? null,
              surv: batch && (batch.surveillance.ok || batch.surveillance.stale) ? batch.surveillance : undefined,
              medians: batch?.sectorMedians,
            });
            analysed.push({ ...x, analysis });
            break;
          } catch (e) {
            const busy = /database is locked|SQLITE_BUSY/i.test((e as Error).message);
            if (busy && attempt < 4) { await new Promise((r) => setTimeout(r, 5000 * attempt)); continue; }
            failed.push({ symbol: x.symbol, error: (e as Error).message.slice(0, 160) });
            this.log.warn(`analyse ${x.symbol}: ${(e as Error).message}`);
            break;
          }
        }
        this.state.done++;
      }
    }

    // ---- 4. reject and rank ------------------------------------------------------------------------
    const rejectedRows = analysed.map((x) => ({ x, why: rejected(x.analysis, c.waitMin) })).filter((r) => r.why);
    const ranked = rankWinners(analysed.filter((x) => !rejected(x.analysis, c.waitMin)), marketDistribution(screened.map((x) => x.screen)));

    const niftyBars = (await this.ds.query(
      `SELECT date, close AS open, close AS high, close AS low, close FROM index_bars WHERE "indexName" = 'Nifty 50' AND date >= ? ORDER BY date`, [lookbackFrom])) as Bar[];
    const nifty = niftyBars.length > 70 ? screen(niftyBars, niftyBars.length - 1, today, { ...c, maxDrawdown3mPct: 100, maxCurrentDrawdownPct: 100, dipPct: 100, worstWeekPct: -100 }) : null;

    const payload = {
      asOf: latest,
      generatedAt: nowIso(),
      criteria: c,
      market: nifty ? { periods: nifty.periods, fytd: nifty.fytd, ret3m: nifty.ret3m, monthStreak: nifty.monthStreak } : null,
      funnel: {
        liquid: universe.length, screened: screened.length,
        week: screened.filter((x) => x.screen.ticks.week).length,
        month: screened.filter((x) => x.screen.ticks.week && x.screen.ticks.month).length,
        quarter: screened.filter((x) => x.screen.ticks.week && x.screen.ticks.month && x.screen.ticks.quarter).length,
        fy: screened.filter((x) => x.screen.ticks.week && x.screen.ticks.month && x.screen.ticks.quarter && x.screen.ticks.fy).length,
        streak: periodic.length,
        resilient: periodic.filter((x) => x.screen.ticks.resilient).length,
        analysed: analysed.length,
        failed: failed.length,
        rejected: rejectedRows.length,
        final: ranked.length,
        buyNow: ranked.filter((r) => r.action === 'BUY now').length,
      },
      rows: ranked.map((r) => slim(r)),
      rejected: rejectedRows.map(({ x, why }) => slim(x, { rejectedFor: why })),
      failed,
      nearMisses: near.map((x) => ({ symbol: x.symbol, missing: x.screen.missing[0], screen: x.screen })),
    };
    await this.ds.transaction(async (em) => {
      await em.getRepository(WinnerRunEntity).delete({ asOf: latest });
      await em.getRepository(WinnerRunEntity).save({ asOf: latest, createdAt: nowIso(), payload: JSON.stringify(payload) });
    });
    const top = ranked.slice(0, 10).map((r) => `${r.rank}. ${r.symbol} ${r.action === 'BUY now' ? 'BUY' : 'wait'} · score ${r.composite} · 3M ${r.screen.ret3m != null ? `${(r.screen.ret3m * 100).toFixed(1)}%` : 'n/a'}`);
    await this.notify.send('info', `Top Picks ${latest}: ${ranked.length} stocks passed every check (${payload.funnel.buyNow} with an entry today).\n${top.join('\n')}`);
    if (!fs.existsSync(this.backtestFile()) || Date.now() - fs.statSync(this.backtestFile()).mtimeMs > 7 * 86_400_000) void this.backtest();
  }

  // ---- backtest of the price-based screen ------------------------------------------------------------
  backtestFile() {
    return path.join(this.cfg.repoRoot, 'data', 'screener', 'top-picks-backtest.json');
  }

  readBacktest() {
    const f = this.backtestFile();
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  }

  /**
   * Every month-end since 2021: apply the same screen with only the data known that day, hold the passers for one
   * month (and three), equal weight. Compared with all liquid stocks and the Nifty 50. Fundamentals are not part of the
   * test because the free statements are not point-in-time; the result therefore measures the periodic screen only.
   */
  backtest(): boolean {
    if (this.backtestState.running) return false;
    this.backtestState = { running: true, error: null };
    void this.doBacktest()
      .catch((e) => { this.backtestState.error = (e as Error).message; this.log.error(`backtest failed: ${(e as Error).message}`); })
      .finally(() => (this.backtestState.running = false));
    return true;
  }

  private async doBacktest() {
    const c = await this.criteria();
    const COST = 0.004;   // round trip: brokerage, STT, charges, slippage
    const SPLIT = '2024-01-01';
    const nifty: { date: string; close: number }[] = await this.ds.query(`SELECT date, close FROM index_bars WHERE "indexName" = 'Nifty 50' AND close IS NOT NULL ORDER BY date`);
    const nIdx = new Map(nifty.map((p, i) => [p.date, i]));
    const monthEnds: string[] = [];
    for (let i = 0; i < nifty.length - 1; i++) if (nifty[i].date.slice(0, 7) !== nifty[i + 1].date.slice(0, 7) && nifty[i].date >= '2021-01-01') monthEnds.push(nifty[i].date);
    const usable = monthEnds.filter((d) => (nIdx.get(d) ?? 0) + 21 < nifty.length);

    // one observation per liquid stock per month-end, with only the data known that day
    interface Obs { f1: number; f3: number | null; s: ScreenResult | null; trend: boolean }
    const obs = new Map<string, Obs[]>(usable.map((d) => [d, []]));
    const symbols: { symbol: string }[] = await this.ds.query(`SELECT symbol FROM daily_bars WHERE symbol IN (SELECT symbol FROM stocks WHERE isin IS NULL OR isin NOT LIKE 'INF%') GROUP BY symbol HAVING COUNT(*) >= 300`);
    for (const { symbol } of symbols) {
      const raw: RawRow[] = await this.ds.query(
        `SELECT symbol, date, open, high, low, close, volume, "prevClose" AS prevClose, turnover, "deliveryPct" AS deliveryPct FROM daily_bars WHERE symbol = ? ORDER BY date`, [symbol]);
      const b = adjustBars(raw);
      const ema200 = emaSeries(b.map((x) => x.close), 200);
      let k = 0;
      for (const me of usable) {
        while (k + 1 < b.length && b[k + 1].date <= me) k++;
        if (b[k].date > me || Date.parse(me) - Date.parse(b[k].date) > 5 * 86_400_000 || k < 260 || k === b.length - 1) continue;
        let tv = 0;
        for (let j = k - 49; j <= k; j++) tv += b[j].turnover ?? 0;
        if (tv / 50 / 1e7 < c.minAdtvCr || b[k].close < c.minPrice) continue;
        const f1 = b[Math.min(k + 21, b.length - 1)].close / b[k].close - 1;   // stocks that stop trading keep their last close
        const f3 = k + 63 < b.length || (nIdx.get(me) ?? 0) + 63 >= nifty.length ? null : b[b.length - 1].close / b[k].close - 1;
        const f3full = k + 63 < b.length ? b[k + 63].close / b[k].close - 1 : f3;
        obs.get(me)!.push({ f1, f3: f3full, s: screen(b, k, me, c), trend: b[k].close > ema200[k] });
      }
    }

    const mean = (v: number[]) => (v.length ? v.reduce((t, x) => t + x, 0) / v.length : null);
    const fwdNifty = (me: string, n: number) => { const i = nIdx.get(me)!; return i + n < nifty.length ? nifty[i + n].close / nifty[i].close - 1 : null; };
    const allTicks = (s: ScreenResult, skip: keyof ScreenResult['ticks'] | null) =>
      (Object.keys(s.ticks) as (keyof ScreenResult['ticks'])[]).every((k) => k === skip || s.ticks[k]);
    const variants: { key: string; label: string; pick: (o: Obs) => boolean; top?: number }[] = [
      { key: 'all', label: 'All your rules (W, M, Q, FY, 2-month streak, no major fall)', pick: (o) => !!o.s?.pass },
      { key: 'noFy', label: 'Same, without the financial-year rule', pick: (o) => !!o.s && allTicks(o.s, 'fy') },
      { key: 'noResilience', label: 'Same, without the no-major-fall rule', pick: (o) => !!o.s && allTicks(o.s, 'resilient') },
      { key: 'periodsOnly', label: 'Week + month + quarter + FY positive only', pick: (o) => !!o.s && o.s.ticks.week && o.s.ticks.month && o.s.ticks.quarter && o.s.ticks.fy },
      { key: 'trend', label: 'All rules + price above the 200-day EMA', pick: (o) => !!o.s?.pass && o.trend },
      { key: 'streak3', label: 'All rules with a 3-month streak', pick: (o) => !!o.s?.pass && o.s.monthStreak >= 3 },
      { key: 'top10', label: 'All rules, top 10 by 6-month return', pick: (o) => !!o.s?.pass, top: 10 },
    ];
    const r2n = (x: number | null) => (x == null ? null : r2(x * 100));
    const study = variants.map((v) => {
      const rows = usable.map((me) => {
        let picks = obs.get(me)!.filter(v.pick);
        if (v.top) picks = picks.sort((x, y) => (y.s?.ret6m ?? -9) - (x.s?.ret6m ?? -9)).slice(0, v.top);
        const f3s = picks.map((x) => x.f3).filter((x): x is number => x != null);
        return { me, n: picks.length, r1: mean(picks.map((x) => x.f1)), r3: f3s.length ? mean(f3s) : null, hit: picks.length ? picks.filter((x) => x.f1 > 0).length / picks.length : null, n1: fwdNifty(me, 21)! };
      });
      const withP = rows.filter((x) => x.r1 != null);
      const half = (early: boolean) => mean(withP.filter((x) => (x.me < SPLIT) === early).map((x) => x.r1! - COST));
      const r3s = withP.filter((x) => x.r3 != null).map((x) => x.r3! - COST);
      return {
        key: v.key, label: v.label,
        avgPicks: r2(withP.reduce((t, x) => t + x.n, 0) / Math.max(1, withP.length)),
        monthsWithPicks: withP.length,
        avg1m: r2n(mean(withP.map((x) => x.r1! - COST))), avg3m: r2n(mean(r3s)),
        avg1mFirstHalf: r2n(half(true)), avg1mSecondHalf: r2n(half(false)),
        hitRate: r2n(mean(withP.map((x) => x.hit!))),
        monthsBeatNifty: r2((withP.filter((x) => x.r1! - COST > x.n1).length / Math.max(1, withP.length)) * 100),
        cumulative: r2n(rows.reduce((t, x) => t * (1 + (x.r1 != null ? x.r1 - COST : 0)), 1) - 1),
        worstMonth: r2n(Math.min(...withP.map((x) => x.r1! - COST))),
        months: rows.map((x) => ({ month: x.me, picks: x.n, ret: r2n(x.r1), hitRate: r2n(x.hit) })),
      };
    });
    const uni1 = usable.map((me) => mean(obs.get(me)!.map((x) => x.f1))!);
    const uni3 = usable.map((me) => mean(obs.get(me)!.map((x) => x.f3).filter((x): x is number => x != null))).filter((x): x is number => x != null);
    const n1 = usable.map((me) => fwdNifty(me, 21)!);
    const n3 = usable.map((me) => fwdNifty(me, 63)).filter((x): x is number => x != null);
    const half = (xs: number[], early: boolean) => mean(xs.filter((_, i) => (usable[i] < SPLIT) === early));
    const benchmarks = {
      nifty: { avg1m: r2n(mean(n1)), avg3m: r2n(mean(n3)), avg1mFirstHalf: r2n(half(n1, true)), avg1mSecondHalf: r2n(half(n1, false)), cumulative: r2n(n1.reduce((t, x) => t * (1 + x), 1) - 1) },
      universe: { avg1m: r2n(mean(uni1)), avg3m: r2n(mean(uni3)), avg1mFirstHalf: r2n(half(uni1, true)), avg1mSecondHalf: r2n(half(uni1, false)), cumulative: r2n(uni1.reduce((t, x) => t * (1 + x), 1) - 1) },
    };
    const base = study[0];
    const result = {
      generatedAt: nowIso(),
      from: usable[0], to: usable.at(-1),
      criteria: c,
      costPerTrade: COST,
      split: SPLIT,
      summary: {
        months: usable.length, monthsWithPicks: base.monthsWithPicks, avgPicksPerMonth: base.avgPicks,
        avgMonthlyPicks: base.avg1m, avgMonthlyNifty: benchmarks.nifty.avg1m, avgMonthlyUniverse: benchmarks.universe.avg1m,
        avg3mPicks: base.avg3m, avg3mNifty: benchmarks.nifty.avg3m, avg3mUniverse: benchmarks.universe.avg3m,
        stockHitRate: base.hitRate, monthsBeatNifty: base.monthsBeatNifty, cumulativePicks: base.cumulative, cumulativeNifty: benchmarks.nifty.cumulative,
        worstMonthPicks: base.worstMonth,
      },
      benchmarks,
      variants: study.map(({ months: _m, ...v }) => v),
      months: base.months.map((m, i) => ({ month: m.month, picks: m.picks, picksRet: m.ret, hitRate: m.hitRate, niftyRet: r2n(n1[i]), universeRet: r2n(uni1[i]) })),
      notes: [
        'Price rules only, evaluated with the data known at each month-end; equal weight; 0.4% round-trip cost deducted.',
        'Includes stocks that later stopped trading (survivorship-safe). ETFs and fund units excluded.',
        'Fundamental and technical-entry filters are not in the test: the free financial statements are not point-in-time.',
      ],
    };
    fs.mkdirSync(path.dirname(this.backtestFile()), { recursive: true });
    fs.writeFileSync(this.backtestFile(), JSON.stringify(result));
    this.log.log(`top-picks backtest: ${usable.length} months; all rules ${base.avg1m}%/m vs nifty ${benchmarks.nifty.avg1m}%/m`);
  }
}
