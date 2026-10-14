import { Controller, Get, Post } from '@nestjs/common';
import { SteadyService } from './steady.service.js';

/** Steady Picks: never-below-start, monthly / quarterly gains, RSI, fundamentals and a buy plan for every NSE stock. */
@Controller('v1/steady')
export class SteadyController {
  constructor(private readonly steady: SteadyService) {}

  @Get()
  async latest() {
    const r = this.steady.latest();
    const bar = await this.steady.latestBarDate();
    const stale = !r || r.asOf < bar;
    if (stale && !this.steady.state.running) this.steady.run();       // first visit or new session: build in the background
    return { ...(r ?? { asOf: null, rows: [] }), stale, state: this.steady.state };
  }

  @Get('state')
  state() { return this.steady.state; }

  @Post('run')
  run() { return { started: this.steady.run(), state: this.steady.state }; }
}
