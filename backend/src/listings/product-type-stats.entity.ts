import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, UpdateDateColumn } from 'typeorm';
import { Keyword } from '../keywords/keyword.entity';

@Entity('product_type_stats')
export class ProductTypeStats {
  @PrimaryColumn()
  keyword_id: number;

  @ManyToOne(() => Keyword, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'keyword_id' })
  keyword: Keyword;

  @PrimaryColumn({ length: 200 })
  product_type_key: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  avg_price: number | null;

  @Column({ type: 'int', default: 0 })
  item_count: number;

  @UpdateDateColumn()
  last_updated: Date;
}
