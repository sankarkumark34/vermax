import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type PickStatus = 'PENDING' | 'SKIPPED' | 'OPEN' | 'CLOSED' | 'NO_DATA';

/** A published pick, tracked forward as a paper trade using the exact published exit rules. */
@Entity('picks')
@Index(['asOf', 'symbol'], { unique: true })
@Index(['status'])
export class PickEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 10 }) asOf: string;
  @Column({ type: 'varchar', length: 8 }) list: 'core' | 'theme';
  @Column({ type: 'varchar', length: 32 }) symbol: string;
  @Column({ type: 'varchar', length: 80 }) sector: string;
  @Column({ type: 'integer' }) rank: number;
  @Column({ type: 'float' }) score: number;
  @Column({ type: 'float' }) entryRef: number;
  @Column({ type: 'float' }) stopPct: number;
  @Column({ type: 'float' }) atrPct: number;
  @Column({ type: 'float' }) stop: number;
  @Column({ type: 'float' }) t1: number;
  @Column({ type: 'float' }) t2: number;
  @Column({ type: 'varchar', length: 10, nullable: true }) fundVerdict: string | null;
  @Column({ type: 'float', nullable: true }) sentiment: number | null;

  @Column({ type: 'varchar', length: 10, default: 'PENDING' }) status: PickStatus;
  @Column({ type: 'float', nullable: true }) entry: number | null;
  @Column({ type: 'boolean', default: false }) t1Hit: boolean;
  @Column({ type: 'integer', default: 0 }) days: number;
  @Column({ type: 'float', nullable: true }) netRet: number | null;
  @Column({ type: 'integer', nullable: true }) exitReason: number | null;
  @Column({ type: 'float', nullable: true }) lastClose: number | null;
  @Column({ type: 'float', nullable: true }) stopNow: number | null;
  @Column({ type: 'varchar', length: 30 }) updatedAt: string;
}
