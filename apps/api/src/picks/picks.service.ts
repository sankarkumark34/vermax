import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import fs from 'node:fs';
import { DataSource, Repository } from 'typeorm';
import { PythonBridgeService } from '../bridge/python-bridge.service.js';
import { loadConfig } from '../config/app.config.js';
import { CircuitService } from '../circuit/circuit.service.js';
import { NotifyService } from '../notify/notify.service.js';
import { DataService } from '../data/data.service.js';
import { PickRunEntity } from '../database/entities/pick-run.entity.js';
import { StockEntity } from '../database/entities/stock.entity.js';
import { SentimentService, type SentimentResult } from '../sentiment/sentiment.service.js';
import { nextSession, positionSize } from './sizing.js';
import type { EnrichedPick, Fundamentals, PublishedRun, PyPick, PyScoreFile } from './types.js';

export interface PipelineState {
  running: boolean;
  step: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  lastAsOf: string | null;
}

function summarize(run: PublishedRun): string {
  const line = (p: PublishedRun['core'][number]) => `${p.symbol} ₹${p.close} · SL ${p.plan.stop} · T1 ${p.plan.t1} · T2 ${p.plan.t2}`;
  const out = [`Picks for ${run.tradeDate} (close ${run.asOf}) · market ${run.regime.label}`];
  if (run.core.length) out.push('', 'Top picks', ...run.core.map(line));
  if (run.theme.length) out.push('', 'Defence & Engineering', run.theme.map((p) => p.symbol).join(', '));
  out.push('', 'Buy only at open ≤ the listed limit; exit by day 10.');
  return out.join('\n');
}

const DISCLAIMER =
  'Decision-support output from a statistical model, not investment advice. Backtested edge is small; ' +
  'losses are normal. Fundamentals and news are overlays and were not part of the backtest.';

@Injectable()
export class PicksService {
  private readonly log = new Logger(PicksService.name);
  private readonly cfg = loadConfig();
  readonly state: PipelineState = { running: false, step: 'idle', startedAt: null, finishedAt: null, error: null, lastAsOf: null };

  constructor(
    private readonly bridge: PythonBridgeService,
    private readonly data: DataService,
    private readonly sentiment: SentimentService,
    private readonly circuits: CircuitService,
    private readonly notify: NotifyService,
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(PickRunEntity) private readonly runs: Repository<PickRunEntity>,
    @InjectRepository(StockEntity) private readonly stocks: Repository<StockEntity>,
  ) {}

  private step(s: string) {
    this.state.step = s;
    this.log.log(`pipeline: ${s}`);
  }

  /** Fire-and-forget entry point used by the API and the scheduler. */
  start(opts: { ingest?: boolean } = {}): boolean {
    if (this.state.running) return false;
    Object.assign(this.state, { running: true, startedAt: new Date().toISOString(), finishedAt: null, error: null });
    const step0 = () => this.state.step;
    void this.runPipeline(opts.ingest ?? true)
      .then((run) => this.notify.send('info', summarize(run)))
      .catch((err: Error) => {
        this.state.error = err.message;
        this.log.error(`pipeline failed: ${err.message}`);
        void this.notify.send('error', `Daily pipeline FAILED at step "${step0()}":
${err.message.slice(0, 400)}`);
      })
      .finally(() => {
        this.state.running = false;
        this.state.step = 'idle';
        this.state.finishedAt = new Date().toISOString();
      });
    return true;
  }

  async runPipeline(ingest = true): Promise<PublishedRun> {
    if (ingest) {
      this.step('ingesting NSE end-of-day data');
      const sum = await this.data.catchUp();
      this.log.log(`ingest: ${JSON.stringify(sum)}`);
    }
    this.step('derivatives positioning (FII / F&O open interest)');
    const since = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
    await this.bridge.run('derivs', { start: since }, 15 * 60_000).catch((e: Error) => this.log.warn(`derivs update failed: ${e.message}`));

    this.step('scoring universe (python)');
    const res = await this.bridge.run<{ path: string; asOf: string }>('score', {
      shortlist: this.cfg.picks.shortlist + 10,
      min_price: this.cfg.picks.minPrice,
      max_price: this.cfg.picks.maxPrice,
    });
    const file = JSON.parse(fs.readFileSync(res.path, 'utf8')) as PyScoreFile;

    // Overlay pool: enough candidates that vetoes still leave a full list.
    const corePool = file.picks.slice(0, this.cfg.picks.shortlist);
    const themePool = file.themeWatch.slice(0, this.cfg.picks.shortlist);
    const symbols = [...new Set([...corePool, ...themePool].map((p) => p.symbol))];

    this.step(`fundamentals for ${symbols.length} stocks`);
    const sectorMap = Object.fromEntries([...corePool, ...themePool].map((p) => [p.symbol, p.sector]));
    let fundList: Fundamentals[] = [];
    try {
      fundList = await this.bridge.run<Fundamentals[]>('fundamentals', { symbols, sectors: sectorMap }, 30 * 60_000);
    } catch (err) {
      this.log.warn(`fundamentals unavailable: ${(err as Error).message}`);
    }
    const fund = new Map(fundList.map((f) => [f.symbol, f]));

    this.step('news sentiment');
    const names = new Map((await this.stocks.find({ select: { symbol: true, name: true } })).filter((s) => symbols.includes(s.symbol)).map((s) => [s.symbol, s.name]));
    const sent = new Map<string, SentimentResult>();
    for (let i = 0; i < symbols.length; i += 5) {
      const batch = symbols.slice(i, i + 5);
      const out = await Promise.all(batch.map((s) => this.sentiment.analyse(s, fund.get(s)?.name ?? names.get(s) ?? null)));
      out.forEach((r) => sent.set(r.symbol, r));
    }

    this.step('assembling final picks');
    const circ = new Map<string, Awaited<ReturnType<CircuitService['brief']>>>();
    for (const sym of symbols) circ.set(sym, await this.circuits.brief(sym));
    const enrich = (p: PyPick, list: 'core' | 'theme'): EnrichedPick => {
      const f = fund.get(p.symbol) ?? null;
      const s = sent.get(p.symbol) ?? null;
      const reasons: string[] = [];
      if (f?.verdict === 'AVOID') reasons.push(...f.flags.slice(0, 3).map((x) => `fundamentals: ${x}`));
      if (s?.severe) reasons.push('news: recent governance/legal red flag');
      let decision: EnrichedPick['decision'] = 'BUY';
      if (reasons.length) decision = 'REJECT';
      else if (!f || f.verdict === 'WATCH' || f.verdict === 'UNKNOWN' || (s && s.score <= -0.3)) decision = 'WATCH';
      return {
        ...p,
        list,
        decision,
        rejectReasons: reasons,
        fundamentals: f,
        sentiment: s,
        circuit: circ.get(p.symbol) ?? null,
        sizing: positionSize({
          capital: this.cfg.picks.capital,
          riskPerTrade: this.cfg.picks.riskPerTrade,
          maxPositionPct: this.cfg.picks.maxPositionPct,
          stopPct: p.plan.stopPct,
          price: p.close,
          regimeMultiplier: file.regime.sizeMultiplier,
        }),
      };
    };
    const coreAll = corePool.map((p) => enrich(p, 'core'));
    const themeAll = themePool.map((p) => enrich(p, 'theme'));
    const core = coreAll.filter((p) => p.decision !== 'REJECT').slice(0, this.cfg.picks.finalCore);
    const theme = themeAll.filter((p) => p.decision !== 'REJECT').slice(0, this.cfg.picks.finalTheme);
    const rejected = [...coreAll, ...themeAll].filter((p, i, a) => p.decision === 'REJECT' && a.findIndex((q) => q.symbol === p.symbol) === i);

    const run: PublishedRun = {
      asOf: file.asOf,
      tradeDate: nextSession(file.asOf),
      generatedAt: new Date().toISOString(),
      model: file.model,
      universe: file.universe,
      regime: file.regime,
      config: file.config,
      core,
      theme,
      rejected,
      disclaimer: DISCLAIMER,
    };
    await this.persist(run, file.ranking ?? []);
    // Refresh the IPO caches for the new session so those pages open instantly (non-fatal).
    this.step('refreshing IPO lists');
    for (const [cmd, args] of [['ipos', {}], ['ipo-quality', { months: 12 }], ['ipo-study', {}]] as const) await this.bridge.run(cmd, args, 40 * 60_000).catch((e: Error) => this.log.warn(`${cmd} refresh failed: ${e.message}`));
    this.state.lastAsOf = run.asOf;
    this.step('done');
    return run;
  }

  private async persist(run: PublishedRun, ranking: PyScoreFile['ranking']) {
    const payload = JSON.stringify({ ...run, ranking });
    const existing = await this.runs.findOne({ where: { asOf: run.asOf } });
    if (existing) await this.runs.update({ id: existing.id }, { regime: run.regime.label, payload, createdAt: new Date().toISOString() });
    else await this.runs.insert({ asOf: run.asOf, regime: run.regime.label, payload, createdAt: new Date().toISOString() });
  }

  async latest(): Promise<(PublishedRun & { ranking?: PyScoreFile['ranking'] }) | null> {
    const r = await this.runs.findOne({ where: {}, order: { asOf: 'DESC' } });
    return r ? JSON.parse(r.payload) : null;
  }

  async byDate(asOf: string) {
    const r = await this.runs.findOne({ where: { asOf } });
    return r ? (JSON.parse(r.payload) as PublishedRun) : null;
  }

  async history(limit = 30) {
    const rs = await this.runs.find({ order: { asOf: 'DESC' }, take: limit, select: { asOf: true, regime: true, createdAt: true } });
    return rs;
  }

  /** Model rank + latest plan for any listed stock (from the last scored universe). */
  async stockRank(symbol: string) {
    const latest = await this.latest();
    if (!latest?.ranking) return null;
    const sorted = latest.ranking;
    const idx = sorted.findIndex((r) => r.symbol === symbol);
    if (idx < 0) return null;
    return { ...sorted[idx], modelRank: idx + 1, of: sorted.length, asOf: latest.asOf };
  }
}
