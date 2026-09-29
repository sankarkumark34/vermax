import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('ingest_logs')
@Index(['date'])
export class IngestLogEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 10 })
  date: string;

  @Column({ type: 'varchar', length: 40 })
  source: string;

  @Column({ type: 'varchar', length: 10 })
  status: 'OK' | 'EMPTY' | 'ERROR';

  @Column({ type: 'integer', default: 0 })
  rows: number;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ type: 'varchar', length: 30 })
  createdAt: string;
}
