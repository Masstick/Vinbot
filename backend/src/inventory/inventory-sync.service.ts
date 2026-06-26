import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AccountsService } from '../accounts/accounts.service';
import { InventoryService } from './inventory.service';
import { VintedSellerClient } from './vinted-seller.client';

@Injectable()
export class InventorySyncService {
  private readonly logger = new Logger(InventorySyncService.name);
  private running = false;

  constructor(
    private readonly accounts: AccountsService,
    private readonly inventory: InventoryService,
  ) {}

  /** Fabrique le client (overridable en test). */
  protected makeClient(sessionJson: string): VintedSellerClient {
    return new VintedSellerClient(sessionJson);
  }

  async syncNow(): Promise<{ items: number; sales: number } | { skipped: string }> {
    const acc = await this.accounts.getAccount();
    if (!acc || acc.status !== 'connected' || !acc.vinted_user_id) {
      return { skipped: 'no-account' };
    }
    const session = await this.accounts.getDecryptedSession();
    if (!session) return { skipped: 'no-account' };

    const client = this.makeClient(session);
    try {
      const fresh = await client.keepAlive();
      await this.accounts.touchRefreshed(fresh);

      // Résolution des catégories : catalog_id → libellé, récupéré une fois par synchro.
      const catalogMap = await client.getCatalogMap();

      const items = await client.getMemberItems(acc.vinted_user_id);
      for (const it of items) {
        it.category = catalogMap.get(it.catalog_id ?? -1) ?? null;
        await this.inventory.upsertListing(acc.id, it);
      }

      const sales = await client.getSales();
      for (const s of sales) await this.inventory.upsertSale(acc.id, s);

      this.logger.log(`Synchro stock : ${items.length} articles, ${sales.length} ventes`);
      return { items: items.length, sales: sales.length };
    } catch (err: any) {
      if (err.message === 'SESSION_EXPIRED') {
        await this.accounts.setStatus('expired');
        this.logger.warn('Session Vinted expirée — reconnexion requise');
        return { skipped: 'expired' };
      }
      this.logger.error(`Synchro stock échouée: ${err.message}`);
      return { skipped: 'error' };
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async scheduled(): Promise<void> {
    if (this.running) return;
    this.running = true;
    // jitter 0-20s pour ne pas taper Vinted à un horaire trop régulier
    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 20000)));
    try {
      await this.syncNow();
    } finally {
      this.running = false;
    }
  }
}
