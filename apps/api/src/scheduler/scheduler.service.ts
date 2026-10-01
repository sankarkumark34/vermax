import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PythonBridgeService } from '../bridge/python-bridge.service.js';
import { loadConfig } from '../config/app.config.js';
import { DataService } from '../data/data.service.js';
import { NotifyService } from '../notify/notify.service.js';
import { PicksService } from '../picks/picks.service.js';

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/**
 * - Daily pipeline after NSE publishes closing data, plus a later retry (files sometimes arrive late).
 * - Staleness watchdog: alert if today's session is still missing late in the evening.
 * - Weekly model retrain, with an alert on failure.
 */
@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly log = new Logger(SchedulerService.name);
  private readonly cfg = loadConfig();
  lastRetrain: { at: string; ok: boolean; message: string } | null = null;

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly picks: PicksService,
    private readonly bridge: PythonBridgeService,
    private readonly data: DataService,
    private readonly notify: NotifyService,
  ) {}

  onModuleInit() {
    if (!this.cfg.scheduler.enabled) return this.log.warn('scheduler disabled (SCHEDULER_ENABLED=false)');
    const { dailyCron, retryCron, watchdogCron, retrainCron, timezone } = this.cfg.scheduler;
    this.add('daily-pipeline', dailyCron, timezone, () => void this.picks.start({ ingest: true }));
    // Retry: only runs if the latest published run is older than the latest data or today's session is missing.
    this.add('daily-retry', retryCron, timezone, async () => {
      const latest = await this.data.latestDate();
      const run = (await this.picks.latest())?.asOf ?? null;
      if (latest !== istToday() || run !== latest) this.picks.start({ ingest: true });
    });
    this.add('staleness-watchdog', watchdogCron, timezone, async () => {
      const latest = await this.data.latestDate();
      if (latest && latest < istToday()) {
        await this.notify.send('warn', `No NSE closing data for ${istToday()} yet (latest stored session ${latest}). If today was a trading day, the bhavcopy may be delayed — the next run will retry.`);
      }
    });
    this.add('weekly-retrain', retrainCron, timezone, async () => {
      try {
        const meta = await this.bridge.run<{ data_to: string; train_rows: number }>('train', {}, 60 * 60_000);
        this.lastRetrain = { at: new Date().toISOString(), ok: true, message: `trained to ${meta.data_to} on ${meta.train_rows} rows` };
        await this.notify.send('info', `Weekly model retrain done (${this.lastRetrain.message}).`);
        const h = await this.bridge.run<{ status: string; reasons: string[] }>('health', {}, 10 * 60_000);
        if (h.status !== 'OK') await this.notify.send(h.status === 'ALERT' ? 'error' : 'warn', `Model health ${h.status}: ${h.reasons.join('; ')}`);
      } catch (e) {
        this.lastRetrain = { at: new Date().toISOString(), ok: false, message: (e as Error).message };
        await this.notify.send('error', `Weekly model retrain FAILED: ${(e as Error).message.slice(0, 300)}`);
      }
    });
    this.log.log(`scheduled: daily "${dailyCron}", retry "${retryCron}", watchdog "${watchdogCron}", retrain "${retrainCron}" (${timezone})`);
  }

  jobs() {
    return [...this.registry.getCronJobs().entries()].map(([name, job]) => ({ name, next: job.nextDate()?.toISO?.() ?? null }));
  }

  private add(name: string, expr: string, tz: string, fn: () => void | Promise<void>) {
    const job = CronJob.from({ cronTime: expr, onTick: fn, start: true, timeZone: tz });
    this.registry.addCronJob(name, job);
  }
}
