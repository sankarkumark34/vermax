import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { portfolioRisk } from './domain/index.js';
import { PositionEntity } from './entities.js';
import { SelectionService } from './selection.service.js';

/** Open positions and portfolio risk limits (sector exposure cap, total open risk). Read-only record keeping: no orders. */
@Injectable()
export class PortfolioService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly selection: SelectionService,
  ) {}

  list() {
    return this.ds.getRepository(PositionEntity).find({ order: { openedOn: 'DESC' } });
  }

  async add(p: { symbol: string; qty: number; entry: number; stop: number; target?: number | null; openedOn?: string; note?: string | null }) {
    const [info] = (await this.ds.query('SELECT sector FROM stocks WHERE symbol = ?', [p.symbol])) as { sector: string | null }[];
    const run = await this.selection.latestRun(p.symbol);
    return this.ds.getRepository(PositionEntity).save({
      symbol: p.symbol, sector: run?.sector ?? info?.sector ?? null, qty: p.qty, entry: p.entry, stop: p.stop, target: p.target ?? null,
      openedOn: p.openedOn ?? new Date().toISOString().slice(0, 10), note: p.note ?? null,
    });
  }

  async update(id: number, p: Partial<{ qty: number; stop: number; target: number | null; note: string | null }>) {
    const repo = this.ds.getRepository(PositionEntity);
    if (!(await repo.findOneBy({ id }))) throw new NotFoundException(`position ${id} not found`);
    await repo.update(id, p);
    return repo.findOneBy({ id });
  }

  async remove(id: number) {
    await this.ds.getRepository(PositionEntity).delete({ id });
    return { removed: id };
  }

  async risk() {
    const cfg = await this.selection.getConfig();
    const rows = await this.list();
    const withPrice = [];
    for (const p of rows) {
      const [last] = (await this.ds.query('SELECT close FROM daily_bars WHERE symbol = ? ORDER BY date DESC LIMIT 1', [p.symbol])) as { close: number }[];
      withPrice.push({ symbol: p.symbol, sector: p.sector, qty: p.qty, entry: p.entry, stop: p.stop, lastPrice: last?.close ?? null, id: p.id, target: p.target });
    }
    return { capital: cfg.risk.capitalInr, ...portfolioRisk(withPrice, cfg.risk.capitalInr, cfg.risk.sectorCapPct, cfg.risk.totalOpenRiskPct) };
  }
}
