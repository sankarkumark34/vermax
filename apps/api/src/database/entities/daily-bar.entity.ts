import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('daily_bars')
@Index(['symbol', 'date'], { unique: true })
@Index(['date'])
export class DailyBarEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 32 })
  symbol: string;

  /** ISO date YYYY-MM-DD (portable across sqlite/postgres) */
  @Column({ type: 'varchar', length: 10 })
  date: string;

  @Column({ type: 'float' }) open: number;
  @Column({ type: 'float' }) high: number;
  @Column({ type: 'float' }) low: number;
  @Column({ type: 'float' }) close: number;
  @Column({ type: 'float' }) prevClose: number;
  @Column({ type: 'float' }) volume: number;
  /** Traded value in INR */
  @Column({ type: 'float' }) turnover: number;
  @Column({ type: 'float', nullable: true }) trades: number | null;
  @Column({ type: 'float', nullable: true }) deliveryQty: number | null;
  @Column({ type: 'float', nullable: true }) deliveryPct: number | null;
}
