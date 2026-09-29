import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import fs from 'node:fs';
import path from 'node:path';
import { DataSource } from 'typeorm';
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
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  @Get('health')
  health() {
    return { ok: true, time: new Date().toISOString() };
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
    return { stats: await this.journal.stats(), picks: await this.journal.list(300) };
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
