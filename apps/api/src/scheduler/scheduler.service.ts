import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PythonBridgeService } from '../bridge/python-bridge.service.js';
import { loadConfig } from '../config/app.config.js';
import { PicksService } from '../picks/picks.service.js';

/** Daily pipeline after NSE publishes the final bhavcopy; weekly model refresh on Sunday. */
@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly log = new Logger(SchedulerService.name);
  private readonly cfg = loadConfig();

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly picks: PicksService,
    private readonly bridge: PythonBridgeService,
  ) {}

  onModuleInit() {
    if (!this.cfg.scheduler.enabled) return this.log.warn('scheduler disabled (SCHEDULER_ENABLED=false)');
    const { dailyCron, retrainCron, timezone } = this.cfg.scheduler;
    this.add('daily-pipeline', dailyCron, timezone, () => {
      this.log.log('cron: daily pipeline');
      this.picks.start({ ingest: true });
    });
    this.add('weekly-retrain', retrainCron, timezone, async () => {
      this.log.log('cron: weekly retrain');
      try {
        await this.bridge.run('train', {}, 60 * 60_000);
      } catch (e) {
        this.log.error(`retrain failed: ${(e as Error).message}`);
      }
    });
    this.log.log(`scheduled: daily "${dailyCron}", retrain "${retrainCron}" (${timezone})`);
  }

  private add(name: string, expr: string, tz: string, fn: () => void | Promise<void>) {
    const job = CronJob.from({ cronTime: expr, onTick: fn, start: true, timeZone: tz });
    this.registry.addCronJob(name, job);
  }
}
