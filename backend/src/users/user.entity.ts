import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string;

  @Column({ name: 'telegram_chat_id', length: 50 })
  telegram_chat_id: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;
}
