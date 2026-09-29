import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { analyseCircuits, type CircuitBar, type CircuitSummary } from './circuit.js';

/** Historical lower-circuit events and recovery times for a stock (from stored NSE bars, 2019 onward). */
@Injectable()
export class CircuitService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async forSymbol(symbol: string): Promise<CircuitSummary> {
    const bars: CircuitBar[] = await this.ds.query(
      'SELECT date, low, close, "prevClose" AS prevClose FROM daily_bars WHERE symbol = ? ORDER BY date',
      [symbol],
    );
    return analyseCircuits(bars);
  }

  /** Compact version for pick cards. */
  async brief(symbol: string) {
    const s = await this.forSymbol(symbol);
    const { list: _list, ...rest } = s;
    return rest;
  }
}
