import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('listings')
export class Listing {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'bigint', unique: true })
  vinted_id: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  title: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  price: number | null;

  @Column({ type: 'text', nullable: true })
  url: string | null;

  @Column({ type: 'text', nullable: true })
  photo_url: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  brand: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  size_label: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  condition_label: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  seller_name: string | null;

  @Column({ type: 'bigint', nullable: true })
  seller_id: number | null;

  @Column({ type: 'varchar', length: 5, nullable: true, default: 'fr' })
  country_code: string | null;

  @Column({ type: 'int', nullable: true })
  view_count: number | null;

  @Column({ type: 'int', nullable: true })
  favourite_count: number | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  model_label: string | null;

  @Column({ type: 'decimal', precision: 3, scale: 2, nullable: true })
  model_confidence: number | null;

  @CreateDateColumn()
  first_seen_at: Date;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  last_seen_at: Date;

  @Column({ type: 'varchar', length: 200, nullable: true })
  model_label: string | null;

  @Column({ type: 'decimal', precision: 3, scale: 2, nullable: true })
  model_confidence: number | null;
}
