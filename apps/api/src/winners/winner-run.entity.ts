import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** One Top Picks run per NSE session: funnel counts, ranked rows, rejections and near misses as JSON. */
@Entity('winner_runs')
@Index(['asOf'])
export class WinnerRunEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 10 }) asOf: string;
  @Column({ type: 'varchar', length: 30 }) createdAt: string;
  @Column({ type: 'text' }) payload: string;
}
