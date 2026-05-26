import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('notifications_log')
export class NotificationLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: true })
  listing_id: number | null;

  @Column({ type: 'int', nullable: true })
  keyword_id: number | null;

  @CreateDateColumn()
  sent_at: Date;
}
