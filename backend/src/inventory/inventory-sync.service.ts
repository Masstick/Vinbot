import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AccountsService } from '../accounts/accounts.service';
import { InventoryService } from './inventory.service';
import { VintedSellerClient, MEMBER_ITEMS_PER_PAGE, SALES_PER_PAGE } from './vinted-seller.client';

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
    // Garde de ré-entrance : protège à la fois le cron et l'endpoint manuel.
    if (this.running) return { skipped: 'busy' };
    this.running = true;
    try {
      const acc = await this.accounts.getAccount();
      if (!acc || acc.status !== 'connected' || !acc.vinted_user_id) {
        return { skipped: 'no-account' };
      }

      try {
        // Fix 3 : déchiffrement à l'intérieur du try pour que toute exception soit capturée.
        const session = await this.accounts.getDecryptedSession();
        if (!session) return { skipped: 'no-account' };

        const client = this.makeClient(session);
        const fresh = await client.keepAlive();
        await this.accounts.touchRefreshed(fresh);

        // Résolution des catégories : catalog_id → libellé, récupéré une fois par synchro.
        const catalogMap = await client.getCatalogMap();

        const runStart = new Date();
        const items: any[] = [];
        for (let page = 1; page <= 50; page++) {
          const batch = await client.getMemberItems(acc.vinted_user_id, page);
          items.push(...batch);
          if (batch.length < MEMBER_ITEMS_PER_PAGE) break;
        }
        for (const it of items) {
          it.category = catalogMap.get(it.catalog_id ?? -1) ?? null;
          await this.inventory.upsertListing(acc.id, it);
        }

        // Réconciliation : on ne marque DELETED que si on a bien reçu des articles
        // (évite de tout supprimer sur une réponse vide due à une erreur transitoire).
        if (items.length > 0) {
          await this.inventory.markUnseenAsDeleted(acc.id, runStart);
        }

        const sales: any[] = [];
        for (let page = 1; page <= 50; page++) {
          const batch = await client.getSales(page);
          sales.push(...batch);
          if (batch.length < SALES_PER_PAGE) break;
        }
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
    } finally {
      this.running = false;
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async scheduled(): Promise<void> {
    // jitter 0-20s pour ne pas taper Vinted à un horaire trop régulier
    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 20000)));
    await this.syncNow();
  }
}
