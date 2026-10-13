import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { WinnersService } from './winners.service.js';

/** Top Picks: periodic winners that pass the 18-step analysis, ranked. */
@Controller('v1/top-picks')
export class WinnersController {
  constructor(private readonly winners: WinnersService) {}

  @Get()
  async latest() {
    const r = await this.winners.latest();
    if (!r) throw new NotFoundException('No Top Picks run yet - POST /api/v1/top-picks/run');
    return r;
  }

  @Get('state')
  state() {
    return { ...this.winners.state, backtest: this.winners.backtestState };
  }

  @Get('history')
  history() {
    return this.winners.history();
  }

  @Get('backtest')
  backtest() {
    const b = this.winners.readBacktest();
    if (!b) throw new NotFoundException(this.winners.backtestState.running ? 'backtest is running' : 'no backtest yet - POST /api/v1/top-picks/backtest');
    return { ...b, running: this.winners.backtestState.running };
  }

  @Post('backtest')
  runBacktest() {
    return { started: this.winners.backtest() };
  }

  @Post('run')
  run(@Body() b: { ingest?: boolean }) {
    return { started: this.winners.run({ ingest: b?.ingest ?? true }), state: this.winners.state };
  }

  @Get(':asOf')
  async byDate(@Param('asOf') asOf: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new BadRequestException('asOf must be YYYY-MM-DD');
    const r = await this.winners.byDate(asOf);
    if (!r) throw new NotFoundException(`No run for ${asOf}`);
    return r;
  }
}
