import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('stocks')
export class StockEntity {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  symbol: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  name: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  isin: string | null;

  /** Sector taken from the NSE index constituent list ("Industry" column). */
  @Column({ type: 'varchar', length: 80, default: 'Unclassified' })
  sector: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  industry: string | null;

  @Column({ type: 'boolean', default: false })
  inNifty500: boolean;

  @Column({ type: 'varchar', length: 10, nullable: true })
  firstDate: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  lastDate: string | null;
}
