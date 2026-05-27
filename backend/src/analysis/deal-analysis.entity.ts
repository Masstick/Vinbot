import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('deal_analyses')
export class DealAnalysis {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: true })
  listing_id: number | null;

  @Column({ type: 'int', nullable: true })
  keyword_id: number | null;

  @Column({ type: 'varchar', length: 10 })
  scam_risk: string;

  @Column({ type: 'decimal', precision: 3, scale: 2, nullable: true })
  confidence: number | null;

  @Column({ type: 'varchar', length: 10 })
  recommendation: string;

  @Column({ type: 'text', nullable: true })
  reasoning: string | null;

  @CreateDateColumn()
  analyzed_at: Date;
}
