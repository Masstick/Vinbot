import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('model_market_avg')
export class ModelMarketAvg {
  @PrimaryColumn()
  keyword_id: number;

  @PrimaryColumn({ length: 200 })
  model_label: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  avg_price: number | null;

  @Column({ default: 0 })
  item_count: number;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  last_updated: Date;
}
