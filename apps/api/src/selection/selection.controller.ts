import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { positionSize, type SelectionConfig } from './domain/index.js';
import { FlagDto, FlagReviewDto, PositionDto, PositionSizeDto, PositionUpdateDto, RunDto, WatchDto } from './dto.js';
import { ExplanationEntity } from './entities.js';
import { LlmClientService, templateExplanation } from './llm-client.service.js';
import { PortfolioService } from './portfolio.service.js';
import { SelectionService } from './selection.service.js';

const SYMBOL = /^[A-Z0-9&-]{1,20}$/;
const sym = (raw: string) => {
  const s = raw.toUpperCase();
  if (!SYMBOL.test(s)) throw new BadRequestException('bad symbol');
  return s;
};
const numQ = (v?: string) => (v == null || v === '' ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined);

/** Stock selection platform API (proposal section 10), served under /api/v1. */
@Controller('v1')
export class SelectionController {
  constructor(
    private readonly selection: SelectionService,
    private readonly portfolio: PortfolioService,
    private readonly llm: LlmClientService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ---- stocks -----------------------------------------------------------------------------------------
  @Get('stocks')
  async search(@Query('query') query = '') {
    const q = query.trim().toUpperCase();
    if (q.length < 2) return [];
    return this.ds.query(
      `SELECT s.symbol, s.name, s.sector, r.verdict, r."totalScore" AS totalScore FROM stocks s
       LEFT JOIN analysis_runs r ON r.id = (SELECT MAX(id) FROM analysis_runs x WHERE x.symbol = s.symbol)
       WHERE (s.symbol LIKE ? OR UPPER(s.name) LIKE ?) AND s."lastDate" >= date('now', '-30 day')
       ORDER BY CASE WHEN s.symbol = ? THEN 0 WHEN s.symbol LIKE ? THEN 1 ELSE 2 END, s.symbol LIMIT 15`,
      [`%${q}%`, `%${q}%`, q, `${q}%`],
    );
  }

  @Get('screener')
  screener(
    @Query('verdict') verdict?: string, @Query('minScore') minScore?: string, @Query('sector') sector?: string, @Query('minTradedValue') minTradedValue?: string,
    @Query('query') query?: string, @Query('sort') sort?: string, @Query('order') order?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('technicalReady') technicalReady?: string,
  ) {
    return this.selection.screener({
      verdict, sector, query, sort, order, minScore: numQ(minScore), minTradedValue: numQ(minTradedValue), page: numQ(page), pageSize: numQ(pageSize),
      technicalReady: technicalReady === '1' || technicalReady === 'true',
    });
  }

  @Get('stocks/:symbol')
  async profile(@Param('symbol') raw: string) {
    const symbol = sym(raw);
    const [info] = await this.ds.query('SELECT symbol, name, sector, industry, isin, "inNifty500" AS inNifty500, "firstDate" AS firstDate, "lastDate" AS lastDate FROM stocks WHERE symbol = ?', [symbol]);
    if (!info) throw new NotFoundException(`${symbol} not found`);
    const run = await this.selection.latestRun(symbol);
    return { ...info, latest: run ? { verdict: run.verdict, totalScore: run.totalScore, asOfDate: run.asOfDate, reason: run.reason, coverage: run.coverage } : null };
  }

  @Get('stocks/:symbol/analysis')
  analysis(@Param('symbol') raw: string, @Query('date') date?: string, @Query('refresh') refresh?: string) {
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    return this.selection.analysis(sym(raw), { date, refresh: refresh === '1' || refresh === 'true' });
  }

  @Get('stocks/:symbol/technical')
  async technical(@Param('symbol') raw: string) {
    const a = await this.selection.analysis(sym(raw), {});
    if (!a.technical) throw new NotFoundException('not enough price history');
    return { symbol: a.symbol, asOfDate: a.asOfDate, ...a.technical };
  }

  @Get('stocks/:symbol/prices')
  async prices(@Param('symbol') raw: string, @Query('range') range = '1y') {
    const n = ({ '1m': 22, '3m': 66, '6m': 130, '1y': 252, '2y': 504 } as Record<string, number>)[range] ?? 252;
    const bars = await this.selection.prices(sym(raw), n);
    if (!bars.length) throw new NotFoundException('no prices');
    return { symbol: sym(raw), range, bars };
  }

  @Get('stocks/:symbol/history')
  history(@Param('symbol') raw: string) {
    return this.selection.history(sym(raw));
  }

  /** LLM verdict explanation, cached per run; falls back to a deterministic explanation when the LLM service is unavailable. */
  @Post('stocks/:symbol/explain')
  async explain(@Param('symbol') raw: string, @Query('refresh') refresh?: string) {
    const a = await this.selection.analysis(sym(raw), {});
    const repo = this.ds.getRepository(ExplanationEntity);
    const cached = await repo.findOneBy({ runId: a.runId });
    if (cached && !refresh) return { ...cached, cached: true };
    const llm = await this.llm.explainVerdict(a);
    const row = llm
      ? { runId: a.runId, text: llm.text, model: llm.model, grounded: llm.grounded, createdAt: new Date().toISOString() }
      : { runId: a.runId, text: templateExplanation(a), model: 'template (LLM service unavailable)', grounded: true, createdAt: new Date().toISOString() };
    if (llm) await repo.save(row);
    return { ...row, cached: false };
  }

  // ---- risk -------------------------------------------------------------------------------------------
  @Post('risk/position-size')
  async positionSize(@Body() b: PositionSizeDto) {
    const cfg = await this.selection.getConfig();
    let { adtvCr, marketCapCr } = b;
    if (b.symbol && (adtvCr == null || marketCapCr == null)) {
      const run = await this.selection.latestRun(b.symbol);
      adtvCr ??= run?.adtvCr ?? undefined;
      marketCapCr ??= run?.marketCapCr ?? undefined;
    }
    const r = positionSize({
      capital: b.capital, riskPct: b.riskPct, entry: b.entry, stop: b.stop, target: b.target ?? null, adtvCr: adtvCr ?? null, marketCapCr: marketCapCr ?? null,
      capLargePct: cfg.risk.capLargePct, capMidSmallPct: cfg.risk.capMidSmallPct, largeCapMinCr: cfg.risk.largeCapMinCr, liquidityPctOfAdtv: cfg.risk.liquidityPctOfAdtv,
    });
    if (!r.ok) throw new BadRequestException(r.error);
    return { ...r, inputs: { adtvCr: adtvCr ?? null, marketCapCr: marketCapCr ?? null }, limits: cfg.risk };
  }

  // ---- watchlist --------------------------------------------------------------------------------------
  @Get('watchlist')
  watchlist() {
    return this.selection.watchlist();
  }

  @Post('watchlist')
  addWatch(@Body() b: WatchDto) {
    return this.selection.addWatch(b.symbol, b);
  }

  @Delete('watchlist/:symbol')
  removeWatch(@Param('symbol') raw: string) {
    return this.selection.removeWatch(sym(raw));
  }

  // ---- portfolio --------------------------------------------------------------------------------------
  @Get('portfolio/positions')
  positions() {
    return this.portfolio.list();
  }

  @Post('portfolio/positions')
  addPosition(@Body() b: PositionDto) {
    if (b.stop >= b.entry) throw new BadRequestException('stop must be below entry');
    return this.portfolio.add(b);
  }

  @Patch('portfolio/positions/:id')
  updatePosition(@Param('id', ParseIntPipe) id: number, @Body() b: PositionUpdateDto) {
    return this.portfolio.update(id, b);
  }

  @Delete('portfolio/positions/:id')
  removePosition(@Param('id', ParseIntPipe) id: number) {
    return this.portfolio.remove(id);
  }

  @Get('portfolio/risk')
  portfolioRisk() {
    return this.portfolio.risk();
  }

  // ---- red flags ----------------------------------------------------------------------------------------
  @Get('flags')
  flags(@Query('status') status?: string, @Query('symbol') symbol?: string) {
    return this.selection.flags(status, symbol ? sym(symbol) : undefined);
  }

  @Patch('flags/:id')
  reviewFlag(@Param('id', ParseIntPipe) id: number, @Body() b: FlagReviewDto) {
    return this.selection.reviewFlag(id, b.status);
  }

  @Post('stocks/:symbol/flags')
  addFlag(@Param('symbol') raw: string, @Body() b: FlagDto) {
    return this.selection.addFlag(sym(raw), b);
  }

  // ---- configuration ------------------------------------------------------------------------------------
  @Get('config/thresholds')
  config() {
    return this.selection.getConfig();
  }

  @Get('config/thresholds/versions')
  versions() {
    return this.selection.configVersions();
  }

  @Get('config/thresholds/versions/:version')
  version(@Param('version', ParseIntPipe) v: number) {
    return this.selection.configVersion(v);
  }

  @Put('config/thresholds')
  saveConfig(@Body() body: { config: Partial<SelectionConfig>; note?: string }) {
    if (!body?.config || typeof body.config !== 'object') throw new BadRequestException('body must be { config, note }');
    return this.selection.saveConfig(body.config, body.note ?? '');
  }

  @Post('config/thresholds/versions/:version/activate')
  activate(@Param('version', ParseIntPipe) v: number) {
    return this.selection.activateConfig(v);
  }

  // ---- jobs ---------------------------------------------------------------------------------------------
  @Post('selection/run')
  run(@Body() b: RunDto) {
    const symbols = b?.symbols?.map((s) => sym(s));
    return { started: this.selection.runUniverse({ symbols }), state: this.selection.state };
  }

  @Get('selection/state')
  async state() {
    return { ...this.selection.state, llm: { ...this.llm.circuit, health: await this.llm.health() } };
  }

  @Get('selection/universe')
  universe() {
    return this.selection.universe();
  }

  @Get('jobs')
  jobs() {
    return this.selection.jobs();
  }
}
