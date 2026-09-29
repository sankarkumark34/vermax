import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config/app.config.js';
import { DailyBarEntity } from './entities/daily-bar.entity.js';
import { IndexBarEntity } from './entities/index-bar.entity.js';
import { IngestLogEntity } from './entities/ingest-log.entity.js';
import { PickEntity } from './entities/pick.entity.js';
import { PickRunEntity } from './entities/pick-run.entity.js';
import { StockEntity } from './entities/stock.entity.js';

export const ENTITIES = [StockEntity, DailyBarEntity, IndexBarEntity, IngestLogEntity, PickRunEntity, PickEntity];

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        const cfg = loadConfig();
        fs.mkdirSync(path.dirname(cfg.sqlitePath), { recursive: true });
        return {
          type: 'better-sqlite3' as const,
          database: cfg.sqlitePath,
          entities: ENTITIES,
          synchronize: true,
          logging: false,
          prepareDatabase: (db: { pragma: (s: string) => unknown }) => {
            db.pragma('journal_mode = WAL');
            db.pragma('synchronous = NORMAL');
            db.pragma('busy_timeout = 15000');
            db.pragma('cache_size = -64000');
          },
        };
      },
    }),
    TypeOrmModule.forFeature(ENTITIES),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
