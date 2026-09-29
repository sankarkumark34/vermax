import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('index_bars')
@Index(['indexName', 'date'], { unique: true })
@Index(['date'])
export class IndexBarEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 80 })
  indexName: string;

  @Column({ type: 'varchar', length: 10 })
  date: string;

  @Column({ type: 'float', nullable: true }) open: number | null;
  @Column({ type: 'float', nullable: true }) high: number | null;
  @Column({ type: 'float', nullable: true }) low: number | null;
  @Column({ type: 'float' }) close: number;
  @Column({ type: 'float', nullable: true }) changePct: number | null;
  @Column({ type: 'float', nullable: true }) volume: number | null;
  @Column({ type: 'float', nullable: true }) turnoverCr: number | null;
  @Column({ type: 'float', nullable: true }) pe: number | null;
  @Column({ type: 'float', nullable: true }) pb: number | null;
  @Column({ type: 'float', nullable: true }) divYield: number | null;
}
