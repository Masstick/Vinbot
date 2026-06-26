import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import type { SellerStatus } from './vinted-seller.client';

@Entity('seller_listings')
export class SellerListing {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'int', nullable: true }) product_id: number | null;
  @Column({ type: 'int' }) account_id: number;
  @Column({ type: 'bigint', transformer: { to: (v) => v, from: (v) => (v == null ? null : Number(v)) } }) vinted_id: number;
  @Column({ type: 'text', nullable: true }) url: string | null;
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true }) price: number | null;
  @Column({ type: 'varchar', length: 20, default: 'ONLINE' }) status: SellerStatus;
  @Column({ type: 'int', nullable: true }) view_count: number | null;
  @Column({ type: 'int', nullable: true }) favourite_count: number | null;
  @Column({ type: 'text', nullable: true }) photo_url: string | null;
  @Column({ type: 'timestamptz', nullable: true }) vinted_created_at: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) last_synced_at: Date | null;
}
