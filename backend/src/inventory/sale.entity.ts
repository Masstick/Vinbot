import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('sales')
export class Sale {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'int' }) account_id: number;
  @Column({ type: 'int', nullable: true }) seller_listing_id: number | null;
  @Column({ type: 'bigint', nullable: true, transformer: { to: (v) => v, from: (v) => (v == null ? null : Number(v)) } }) vinted_order_id: number | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) buyer_name: string | null;
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true }) sale_price: number | null;
  @Column({ type: 'varchar', length: 50, nullable: true }) shipping_status: string | null;
  @Column({ type: 'timestamptz', nullable: true }) sold_at: Date | null;
}
