/**
 * Selection tables (proposal 9.3) on the existing SQLite database. Money and scores are REAL (SQLite has no DECIMAL);
 * every run stores the config version and as-of date so any past verdict can be reproduced.
 */
import { Column, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity('analysis_runs')
@Index(['symbol', 'asOfDate', 'configVersion'], { unique: true })
@Index(['asOfDate', 'verdict', 'totalScore'])
export class AnalysisRunEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 32 }) symbol: string;
  @Column({ type: 'varchar', length: 200, nullable: true }) name: string | null;
  @Column({ type: 'varchar', length: 80, nullable: true }) sector: string | null;
  @Column({ type: 'varchar', length: 10 }) asOfDate: string;
  @Column({ type: 'float' }) totalScore: number;
  @Column({ type: 'float' }) coverage: number;
  @Column({ type: 'varchar', length: 5 }) verdict: 'BUY' | 'WAIT' | 'AVOID';
  @Column({ type: 'boolean', default: false }) gateTriggered: boolean;
  @Column({ type: 'boolean', default: false }) valuationStretched: boolean;
  @Column({ type: 'boolean', default: false }) technicalReady: boolean;
  @Column({ type: 'varchar', length: 20 }) template: string;
  @Column({ type: 'float', nullable: true }) close: number | null;
  @Column({ type: 'float', nullable: true }) adtvCr: number | null;
  @Column({ type: 'float', nullable: true }) marketCapCr: number | null;
  @Column({ type: 'float', nullable: true }) alertPrice: number | null;
  @Column({ type: 'varchar', length: 300 }) reason: string;
  @Column({ type: 'integer' }) configVersion: number;
  /** full AnalysisResult JSON (steps are also normalised into step_scores) */
  @Column({ type: 'text' }) payload: string;
  @Column({ type: 'varchar', length: 30 }) createdAt: string;
}

@Entity('step_scores')
export class StepScoreEntity {
  @PrimaryColumn({ type: 'integer' }) runId: number;
  @PrimaryColumn({ type: 'integer' }) stepNo: number;
  @Column({ type: 'float' }) score: number;
  @Column({ type: 'float' }) maxScore: number;
  @Column({ type: 'float' }) coverage: number;
  @Column({ type: 'boolean', default: false }) gate: boolean;
  @Column({ type: 'varchar', length: 8 }) status: string;
  @Column({ type: 'simple-json', nullable: true }) flags: string[] | null;
  @Column({ type: 'simple-json', nullable: true }) metrics: Record<string, unknown> | null;
}

@Entity('threshold_config')
export class ThresholdConfigEntity {
  @PrimaryColumn({ type: 'integer' }) version: number;
  @Column({ type: 'text' }) data: string;
  @Column({ type: 'varchar', length: 300, default: '' }) note: string;
  @Column({ type: 'boolean', default: false }) active: boolean;
  @Column({ type: 'varchar', length: 30 }) createdAt: string;
}

@Entity('watchlist_items')
export class WatchlistItemEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 32, unique: true }) symbol: string;
  @Column({ type: 'float', nullable: true }) alertPrice: number | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) zone: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) note: string | null;
  @Column({ type: 'varchar', length: 5, nullable: true }) lastVerdict: string | null;
  @Column({ type: 'float', nullable: true }) lastClose: number | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) triggeredAt: string | null;
  @Column({ type: 'varchar', length: 30 }) addedAt: string;
}

@Entity('red_flags')
@Index(['symbol', 'title'], { unique: true })
export class RedFlagEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 32 }) symbol: string;
  @Column({ type: 'varchar', length: 12 }) category: string;
  @Column({ type: 'integer' }) level: number;
  @Column({ type: 'varchar', length: 300 }) title: string;
  @Column({ type: 'varchar', length: 12 }) source: string;
  /** suggested -> confirmed | resolved (only confirmed flags affect the verdict) */
  @Column({ type: 'varchar', length: 10 }) status: string;
  @Column({ type: 'varchar', length: 400, nullable: true }) link: string | null;
  @Column({ type: 'varchar', length: 10, nullable: true }) detectedOn: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) reviewedAt: string | null;
}

@Entity('positions')
export class PositionEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 32 }) symbol: string;
  @Column({ type: 'varchar', length: 80, nullable: true }) sector: string | null;
  @Column({ type: 'integer' }) qty: number;
  @Column({ type: 'float' }) entry: number;
  @Column({ type: 'float' }) stop: number;
  @Column({ type: 'float', nullable: true }) target: number | null;
  @Column({ type: 'varchar', length: 10 }) openedOn: string;
  @Column({ type: 'varchar', length: 300, nullable: true }) note: string | null;
}

@Entity('job_runs')
export class JobRunEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 40 }) name: string;
  @Column({ type: 'varchar', length: 30 }) startedAt: string;
  @Column({ type: 'varchar', length: 30, nullable: true }) endedAt: string | null;
  @Column({ type: 'varchar', length: 10 }) status: 'RUNNING' | 'OK' | 'ERROR';
  @Column({ type: 'integer', default: 0 }) rows: number;
  @Column({ type: 'varchar', length: 500, nullable: true }) error: string | null;
}

@Entity('explanations')
export class ExplanationEntity {
  @PrimaryColumn({ type: 'integer' }) runId: number;
  @Column({ type: 'text' }) text: string;
  @Column({ type: 'varchar', length: 60 }) model: string;
  @Column({ type: 'boolean', default: true }) grounded: boolean;
  @Column({ type: 'varchar', length: 30 }) createdAt: string;
}

export const SELECTION_ENTITIES = [AnalysisRunEntity, StepScoreEntity, ThresholdConfigEntity, WatchlistItemEntity, RedFlagEntity, PositionEntity, JobRunEntity, ExplanationEntity];
