import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('keywords')
export class Keyword {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ length: 255 })
  label: string;

  @Column({ length: 500 })
  search_text: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  min_price: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  max_price: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  category: string | null;

  @Column({ type: 'int', nullable: true })
  catalog_id: number | null;

  @Column({ type: 'simple-array', default: 'fr' })
  country_codes: string[];

  @Column({ default: 120 })
  scan_interval_seconds: number;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
