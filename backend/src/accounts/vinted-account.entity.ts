import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type AccountStatus = 'connected' | 'expired' | 'disconnected';

@Entity('vinted_accounts')
export class VintedAccount {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  label: string;

  @Column({ type: 'bigint', nullable: true, transformer: { to: (v) => v, from: (v) => (v == null ? null : Number(v)) } })
  vinted_user_id: number | null;

  @Column({ type: 'text', nullable: true })
  session_data: string | null;

  @Column({ type: 'varchar', length: 20, default: 'disconnected' })
  status: AccountStatus;

  @Column({ type: 'timestamptz', nullable: true })
  connected_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_refresh_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
