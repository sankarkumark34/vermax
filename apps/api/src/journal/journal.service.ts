import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PythonBridgeService } from '../bridge/python-bridge.service.js';
import { PickEntity } from '../database/entities/pick.entity.js';

interface TrackResult {
  id: number;
  status: 'PENDING' | 'SKIPPED' | 'OPEN' | 'CLOSED' | 'NO_DATA';
  entry?: number;
  days?: number;
  t1Hit?: boolean;
  stopNow?: number;
  lastClose?: number;
  netRet?: number;
  exitReason?: number | null;
}

const EXIT_LABEL: Record<number, string> = { 1: 'Target', [-1]: 'Stop', 0: 'Time exit', [-2]: 'Gap through stop' };

export interface JournalStats {
  closed: number;
  open: number;
  skipped: number;
  winRate: number | null; // % of closed trades with positive net return
  expectancyPct: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  profitFactor: number | null;
  avgHoldDays: number | null;
  bestPct: number | null;
  worstPct: number | null;
}

/** Forward paper-trading journal: every published pick is tracked with the exact published exit rules. */
@Injectable()
export class JournalService {
  private readonly log = new Logger(JournalService.name);

  constructor(
    private readonly bridge: PythonBridgeService,
    @InjectRepository(PickEntity) private readonly picks: Repository<PickEntity>,
  ) {}

  async refresh(): Promise<number> {
    const active = await this.picks.find({ where: { status: In(['PENDING', 'OPEN', 'NO_DATA']) } });
    if (!active.length) return 0;
    const results = await this.bridge.run<TrackResult[]>('track', {
      items: active.map((p) => ({ id: p.id, symbol: p.symbol, signalDate: p.asOf, stopPct: p.stopPct, atrPct: p.atrPct })),
    });
    let changed = 0;
    for (const r of results) {
      await this.picks.update(
        { id: r.id },
        {
          status: r.status,
          entry: r.entry ?? null,
          days: r.days ?? 0,
          t1Hit: r.t1Hit ?? false,
          stopNow: r.stopNow ?? null,
          lastClose: r.lastClose ?? null,
          netRet: r.status === 'CLOSED' || r.status === 'OPEN' ? (r.netRet ?? null) : null,
          exitReason: r.status === 'CLOSED' ? (r.exitReason ?? null) : null,
          updatedAt: new Date().toISOString(),
        },
      );
      changed++;
    }
    this.log.log(`journal refreshed ${changed} picks`);
    return changed;
  }

  async list(limit = 200) {
    const rows = await this.picks.find({ order: { asOf: 'DESC', rank: 'ASC' }, take: limit });
    return rows.map((r) => ({ ...r, exitLabel: r.exitReason === null ? null : (EXIT_LABEL[r.exitReason] ?? null) }));
  }

  async stats(): Promise<JournalStats & { byList: Record<string, JournalStats> }> {
    const rows = await this.picks.find();
    const calc = (xs: PickEntity[]): JournalStats => {
      const closed = xs.filter((r) => r.status === 'CLOSED' && r.netRet !== null);
      const rets = closed.map((r) => r.netRet as number);
      const wins = rets.filter((x) => x > 0);
      const losses = rets.filter((x) => x <= 0);
      const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
      const pct = (x: number) => Math.round(x * 10000) / 100;
      return {
        closed: closed.length,
        open: xs.filter((r) => r.status === 'OPEN').length,
        skipped: xs.filter((r) => r.status === 'SKIPPED').length,
        winRate: closed.length ? Math.round((wins.length / closed.length) * 1000) / 10 : null,
        expectancyPct: closed.length ? pct(sum(rets) / closed.length) : null,
        avgWinPct: wins.length ? pct(sum(wins) / wins.length) : null,
        avgLossPct: losses.length ? pct(sum(losses) / losses.length) : null,
        profitFactor: losses.length && sum(losses) < 0 ? Math.round((sum(wins) / -sum(losses)) * 100) / 100 : null,
        avgHoldDays: closed.length ? Math.round((sum(closed.map((r) => r.days)) / closed.length) * 10) / 10 : null,
        bestPct: rets.length ? pct(Math.max(...rets)) : null,
        worstPct: rets.length ? pct(Math.min(...rets)) : null,
      };
    };
    return { ...calc(rows), byList: { core: calc(rows.filter((r) => r.list === 'core')), theme: calc(rows.filter((r) => r.list === 'theme')), elite: calc(rows.filter((r) => r.list === 'elite')) } };
  }
}
