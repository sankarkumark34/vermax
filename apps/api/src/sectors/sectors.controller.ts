import { Controller, Get, Post } from '@nestjs/common';
import { SectorsService } from './sectors.service.js';

/** Sector Leaders: every NSE sector ranked by strength, with its best stocks on fundamentals + growth + technicals. */
@Controller('v1/sectors')
export class SectorsController {
  constructor(private readonly sectors: SectorsService) {}

  @Get()
  async latest() {
    const r = this.sectors.latest();
    const bar = await this.sectors.latestBarDate();
    const stale = !r || r.asOf < bar;
    if (stale && !this.sectors.state.running) this.sectors.run();       // first visit or new session: build in the background
    return { ...(r ?? { asOf: null, sectors: [], leaders: [], stocks: [] }), stale, state: this.sectors.state };
  }

  @Get('state')
  state() { return this.sectors.state; }

  @Post('run')
  run() { return { started: this.sectors.run(), state: this.sectors.state }; }
}
