import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** One published daily run: the full enriched payload (regime, picks, sectors, rejected) as JSON. */
@Entity('pick_runs')
@Index(['asOf'], { unique: true })
export class PickRunEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** Signal date (last completed session the model saw), YYYY-MM-DD. */
  @Column({ type: 'varchar', length: 10 })
  asOf: string;

  @Column({ type: 'varchar', length: 20 })
  regime: string;

  @Column({ type: 'text' })
  payload: string;

  @Column({ type: 'varchar', length: 30 })
  createdAt: string;
}
