import { Module } from '@nestjs/common';
import { DataService } from './data.service.js';
import { MARKET_DATA_PROVIDER } from './providers/market-data.provider.js';
import { NseArchivesProvider } from './providers/nse-archives.provider.js';

@Module({
  providers: [NseArchivesProvider, { provide: MARKET_DATA_PROVIDER, useExisting: NseArchivesProvider }, DataService],
  exports: [DataService],
})
export class DataModule {}
