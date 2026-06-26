import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'int' }) account_id: number;
  @Column({ type: 'varchar', length: 500, nullable: true }) title: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) brand: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) size_label: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) category: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) condition_label: string | null;
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true }) purchase_price: number | null;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
