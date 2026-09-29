import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiController } from './api/api.controller.js';
import { PythonBridgeService } from './bridge/python-bridge.service.js';
import { CircuitService } from './circuit/circuit.service.js';
import { DataModule } from './data/data.module.js';
import { DatabaseModule } from './database/database.module.js';
import { JournalService } from './journal/journal.service.js';
import { PicksService } from './picks/picks.service.js';
import { SchedulerService } from './scheduler/scheduler.service.js';
import { SentimentService } from './sentiment/sentiment.service.js';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule, DataModule],
  controllers: [ApiController],
  providers: [CircuitService, PythonBridgeService, SentimentService, JournalService, PicksService, SchedulerService],
})
export class AppModule {}
