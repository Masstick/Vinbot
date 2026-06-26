import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VintedAccount, AccountStatus } from './vinted-account.entity';
import { encryptSession, decryptSession } from './session-crypto';

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);
  private warnedDefaultKey = false;

  constructor(
    @InjectRepository(VintedAccount)
    private readonly repo: Repository<VintedAccount>,
    private readonly config: ConfigService,
  ) {}

  private key(): string {
    const k = this.config.get<string>('SESSION_ENCRYPTION_KEY', 'vinbot-dev-key');
    if (k === 'vinbot-dev-key' && !this.warnedDefaultKey) {
      this.warnedDefaultKey = true;
      this.logger.warn('⚠️ SESSION_ENCRYPTION_KEY non défini — clé par défaut non sécurisée (à changer en prod)');
    }
    return k;
  }

  async getAccount(): Promise<VintedAccount | null> {
    const all = await this.repo.find();
    if (!all.length) return null;
    return all.sort((a, b) => a.id - b.id)[0];
  }

  async saveSession(input: { vintedUserId: number; sessionJson: string; label?: string }): Promise<VintedAccount> {
    const now = new Date();
    const enc = encryptSession(input.sessionJson, this.key());
    let acc = await this.getAccount();
    if (!acc) {
      acc = this.repo.create({ label: input.label ?? 'Mon compte Vinted' });
    } else if (input.label) {
      acc.label = input.label;
    }
    acc.vinted_user_id = input.vintedUserId;
    acc.session_data = enc;
    acc.status = 'connected';
    acc.connected_at = now;
    acc.last_refresh_at = now;
    return this.repo.save(acc);
  }

  async getDecryptedSession(): Promise<string | null> {
    const acc = await this.getAccount();
    if (!acc?.session_data) return null;
    return decryptSession(acc.session_data, this.key());
  }

  async setStatus(status: AccountStatus): Promise<void> {
    const acc = await this.getAccount();
    if (!acc) return;
    await this.repo.update(acc.id, { status, updated_at: new Date() });
  }

  async touchRefreshed(sessionJson: string): Promise<void> {
    const acc = await this.getAccount();
    if (!acc) return;
    await this.repo.update(acc.id, {
      session_data: encryptSession(sessionJson, this.key()),
      last_refresh_at: new Date(),
      status: 'connected',
      updated_at: new Date(),
    });
  }
}
