import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiController } from './api/api.controller.js';
import { PythonBridgeService } from './bridge/python-bridge.service.js';
import { CircuitService } from './circuit/circuit.service.js';
import { DataModule } from './data/data.module.js';
import { DatabaseModule } from './database/database.module.js';
import { QuoteService } from './quote/quote.service.js';
import { NotifyService } from './notify/notify.service.js';
import { PicksService } from './picks/picks.service.js';
import { SchedulerService } from './scheduler/scheduler.service.js';
import { SentimentService } from './sentiment/sentiment.service.js';
import { LlmClientService } from './selection/llm-client.service.js';
import { PortfolioService } from './selection/portfolio.service.js';
import { SelectionController } from './selection/selection.controller.js';
import { SelectionService } from './selection/selection.service.js';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule, DataModule],
  controllers: [ApiController, SelectionController],
  providers: [NotifyService, CircuitService, QuoteService, PythonBridgeService, SentimentService, PicksService, SchedulerService,
    SelectionService, PortfolioService, LlmClientService],
})
export class AppModule {}
