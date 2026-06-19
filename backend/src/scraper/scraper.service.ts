import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { KeywordsService } from '../keywords/keywords.service';
import { ListingsService } from '../listings/listings.service';
import { TelegramService } from '../notifications/telegram.service';
import { DealsGateway } from '../notifications/deals.gateway';
import { VintedClientPool } from './vinted.client';
import { Keyword } from '../keywords/keyword.entity';
import { Listing } from '../listings/listing.entity';
import { AsyncQueue } from './async-queue';

// Vérification du profil vendeur (filtre "vendeur unique") : on ne re-vérifie pas
// un même vendeur/mot-clé plus d'une fois par fenêtre, pour limiter les appels Vinted.
const SELLER_CHECK_TTL_MS = 6 * 60 * 60 * 1000; // 6h

// Contrôle de disponibilité (annonces vendues/supprimées) : on re-vérifie chaque
// annonce affichée au plus une fois par fenêtre, par lots, pour ménager Vinted.
const AVAILABILITY_CHECK_TTL_SECONDS = 24 * 60 * 60;      // re-check d'une même annonce au plus 1×/jour
const AVAILABILITY_STALE_SECONDS = 30 * 60;              // on ne vérifie que les annonces non revues depuis 30 min
const AVAILABILITY_RECENCY_SECONDS = 14 * 24 * 60 * 60;  // borne aux annonces vues pour la 1re fois < 14 jours
const AVAILABILITY_BATCH_SIZE = 40;                      // annonces enfilées par tick (sous le plafond 1 req/s)
const AVAILABILITY_TICK_MS = 45_000;                    // cadence d'enfilement

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

interface SellerCheckItem {
  sellerId: number;
  keywordId: number;
  countryCode: string;
}

interface AvailabilityCheckItem {
  listingId: number;
  vintedId: number;
  countryCode: string;
}

@Injectable()
export class ScraperService implements OnModuleInit {
  private readonly logger = new Logger(ScraperService.name);
  private readonly clientPool = new VintedClientPool();
  private isFastRunning = false;
  // Pause manuelle persistée (table scraper_state) : quand true, les scans
  // périodiques (fast scan) sont court-circuités. La file vendeur déjà
  // remplie se vide d'elle-même (plus rien n'y entre).
  private paused = false;
  private lastRunAt: Map<number, number> = new Map();
  private lastScrapeTime: Date | null = null;

  private readonly sellerQueue: AsyncQueue<SellerCheckItem>;
  // Dédup : `${keywordId}:${sellerId}` en cours de vérif / dernière vérif (epoch ms)
  private readonly sellerCheckInFlight = new Set<string>();
  private readonly sellerCheckedAt = new Map<string, number>();

  private readonly availabilityQueue: AsyncQueue<AvailabilityCheckItem>;
  private readonly availabilityInFlight = new Set<number>();

  constructor(
    private readonly keywordsService: KeywordsService,
    private readonly listingsService: ListingsService,
    private readonly telegramService: TelegramService,
    private readonly dealsGateway: DealsGateway,
    private readonly dataSource: DataSource,
  ) {
    // 1 vérif/sec max : la vérification profil est secondaire, on ménage Vinted.
    this.sellerQueue = new AsyncQueue(this.processSellerCheck.bind(this), 1, 1);
    // Concurrence 3 : la page item (~2 Mo) prend quelques secondes, le facteur limitant
    // est la latence par requête (pas le rate-limit), d'où plusieurs vérifs en parallèle.
    this.availabilityQueue = new AsyncQueue(this.processAvailabilityCheck.bind(this), 3, 3);
  }

  async onModuleInit() {
    await this.loadPausedState();
    await this.ensureListingSchema();
    this.logger.log(`ScraperService initialisé — état : ${this.paused ? 'EN PAUSE' : 'actif'}, premier fast scan dans 5s`);
    setTimeout(() => this.scheduleFastTick(), 5000);
    setTimeout(() => this.scheduleAvailabilityTick(), 20_000);
  }

  /**
   * Crée les colonnes de disponibilité si absentes (pas de runner de migration).
   * Idempotent : sûr à chaque démarrage.
   */
  private async ensureListingSchema(): Promise<void> {
    try {
      await this.dataSource.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS unavailable_at TIMESTAMPTZ`);
      await this.dataSource.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS unavailable_reason VARCHAR(10)`);
      await this.dataSource.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS availability_checked_at TIMESTAMPTZ`);
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_listings_availability ON listings (unavailable_at, availability_checked_at)`,
      );
    } catch (err: any) {
      this.logger.error(`[Schema] colonnes de disponibilité non créées : ${err.message}`);
    }
  }

  /**
   * Crée la table de state si absente (le schéma n'a pas de runner de migration)
   * et charge le flag de pause. Idempotent : sûr à chaque démarrage.
   */
  private async loadPausedState(): Promise<void> {
    try {
      await this.dataSource.query(
        `CREATE TABLE IF NOT EXISTS scraper_state (
           id INT PRIMARY KEY DEFAULT 1,
           paused BOOLEAN NOT NULL DEFAULT FALSE,
           updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           CONSTRAINT scraper_state_singleton CHECK (id = 1)
         )`,
      );
      await this.dataSource.query(
        `INSERT INTO scraper_state (id, paused) VALUES (1, FALSE) ON CONFLICT (id) DO NOTHING`,
      );
      const rows = await this.dataSource.query(`SELECT paused FROM scraper_state WHERE id = 1`);
      this.paused = rows.length > 0 && rows[0].paused === true;
    } catch (err: any) {
      this.logger.error(`[ScraperState] chargement impossible, scraper actif par défaut : ${err.message}`);
      this.paused = false;
    }
  }

  /** Met en pause / relance les scans périodiques (persiste le choix en base). */
  async setPaused(paused: boolean): Promise<{ paused: boolean }> {
    this.paused = paused;
    await this.dataSource.query(
      `UPDATE scraper_state SET paused = $1, updated_at = NOW() WHERE id = 1`,
      [paused],
    );
    this.logger.log(`Scraper ${paused ? 'mis en pause' : 'relancé'} manuellement`);
    return { paused };
  }

  isPaused(): boolean {
    return this.paused;
  }

  private scheduleFastTick(): void {
    this.fastTick().finally(() => {
      const next = randInt(25_000, 35_000);
      setTimeout(() => this.scheduleFastTick(), next);
    });
  }

  async fastTick() {
    if (this.isFastRunning) return;
    this.isFastRunning = true;
    try { await this.runFastScan(); } finally { this.isFastRunning = false; }
  }

  private getCountryCodes(keyword: Keyword): string[] {
    return Array.isArray(keyword.country_codes)
      ? keyword.country_codes
      : String(keyword.country_codes ?? 'fr').split(',').map(s => s.trim()).filter(Boolean);
  }

  /** Programme une vérif du profil vendeur (dédupliquée + TTL) pour le filtre "vendeur unique". */
  private queueSellerCheck(sellerId: number | null | undefined, keyword: Keyword, countryCode: string): void {
    if (!sellerId) return;
    const key = `${keyword.id}:${sellerId}`;
    if (this.sellerCheckInFlight.has(key)) return;
    const last = this.sellerCheckedAt.get(key);
    if (last && Date.now() - last < SELLER_CHECK_TTL_MS) return;
    this.sellerCheckInFlight.add(key);
    this.sellerQueue
      .push({ sellerId, keywordId: keyword.id, countryCode })
      .catch(() => {});
  }

  private async processSellerCheck(item: SellerCheckItem): Promise<void> {
    const key = `${item.keywordId}:${item.sellerId}`;
    try {
      const client = this.clientPool.getClient(item.countryCode);
      const profile = await client.getSellerProfile(item.sellerId);
      if (profile !== null) {
        if (profile.countryIso) {
          await this.listingsService.updateSellerCountry(item.sellerId, profile.countryIso);
        }
        await this.listingsService.updateSellerItemCount(item.keywordId, item.sellerId, profile.itemCount);
        this.sellerCheckedAt.set(key, Date.now());
      }
    } catch (err: any) {
      if (err.message === 'BANNED') {
        this.logger.warn('[SellerCheck] bloqué par Vinted — pause 60s');
        await this.delay(60_000);
      } else {
        this.logger.warn(`[SellerCheck] vendeur ${item.sellerId}: ${err.message}`);
      }
    } finally {
      this.sellerCheckInFlight.delete(key);
    }
  }

  // ── Contrôle de disponibilité des annonces (vendues / supprimées) ──────────────
  private scheduleAvailabilityTick(): void {
    this.enqueueAvailabilityChecks()
      .catch(err => this.logger.warn(`[Availability] tick: ${err.message}`))
      .finally(() => {
        setTimeout(() => this.scheduleAvailabilityTick(), AVAILABILITY_TICK_MS);
      });
  }

  private async enqueueAvailabilityChecks(): Promise<void> {
    if (this.paused) return; // pas de charge Vinted supplémentaire pendant une pause
    const candidates = await this.listingsService.getListingsToVerify(
      AVAILABILITY_BATCH_SIZE,
      AVAILABILITY_CHECK_TTL_SECONDS,
      AVAILABILITY_STALE_SECONDS,
      AVAILABILITY_RECENCY_SECONDS,
    );
    for (const c of candidates) {
      if (this.availabilityInFlight.has(c.id)) continue;
      this.availabilityInFlight.add(c.id);
      this.availabilityQueue
        .push({ listingId: c.id, vintedId: Number(c.vinted_id), countryCode: c.country_code ?? 'fr' })
        .catch(() => {});
    }
  }

  private async processAvailabilityCheck(item: AvailabilityCheckItem): Promise<void> {
    try {
      const client = this.clientPool.getClient(item.countryCode);
      const status = await client.getItemStatus(item.vintedId);
      if (status === 'gone' || status === 'sold') {
        await this.listingsService.markListingUnavailable(item.listingId, status);
        this.logger.log(`[Availability] annonce ${item.listingId} (vinted ${item.vintedId}) → ${status}, masquée`);
      } else if (status === 'active') {
        await this.listingsService.markListingChecked(item.listingId);
      }
      // status null → erreur transitoire : on ne conclut rien, recheck au prochain cycle
    } catch (err: any) {
      if (err.message === 'BANNED') {
        this.logger.warn('[Availability] bloqué par Vinted — pause 60s');
        await this.delay(60_000);
      } else {
        this.logger.warn(`[Availability] annonce ${item.listingId}: ${err.message}`);
      }
    } finally {
      this.availabilityInFlight.delete(item.listingId);
    }
  }

  private async runFastScan(): Promise<void> {
    if (this.paused) return;
    const keywords = await this.keywordsService.findActive();
    if (keywords.length === 0) return;

    for (const keyword of keywords) {
      const countryCodes = this.getCountryCodes(keyword);
      for (const countryCode of countryCodes) {
        try {
          const client = this.clientPool.getClient(countryCode);
          const items = await client.search(
            keyword.search_text, keyword.min_price, keyword.max_price, 96, 1, keyword.catalog_id,
          );
          if (items.length === 0) continue;

          let newCount = 0;
          for (const item of items) {
            const { listing, isNew, priceChanged } = await this.listingsService.upsertListing(item, keyword, countryCode);

            // Filtre "vendeur unique" : on vérifie le profil du vendeur en arrière-plan.
            this.queueSellerCheck(item.seller_id, keyword, countryCode);

            if (isNew) {
              this.dealsGateway.emitNewListing({
                listingId: listing.id,
                title: listing.title ?? item.title,
                price: parseFloat(String(listing.price ?? item.price)),
                photoUrl: listing.photo_url ?? null,
                url: listing.url ?? null,
                keywordLabel: keyword.label,
                vintedCreatedAt: listing.vinted_created_at ? listing.vinted_created_at.toISOString() : null,
                userId: keyword.user_id,
              });
              await this.maybeAlertNewListing(listing, keyword, countryCode);
            }
            if (isNew || priceChanged) newCount++;
          }

          this.lastRunAt.set(keyword.id, Date.now());
          this.lastScrapeTime = new Date();
          this.logger.log(`[FastScan] "${keyword.search_text}" [${countryCode}] → ${items.length} annonces, ${newCount} nouvelles/modifiées`);
        } catch (err: any) {
          if (err.message === 'BANNED') {
            this.logger.warn(`[FastScan] Keyword #${keyword.id} [${countryCode}] bloqué — pause 60s`);
            await this.delay(60_000);
          } else {
            this.logger.error(`[FastScan] Keyword #${keyword.id} [${countryCode}]: ${err.message}`);
          }
        }
        if (countryCodes.indexOf(countryCode) < countryCodes.length - 1) {
          await this.delay(randInt(2_000, 4_000));
        }
      }
      if (keywords.indexOf(keyword) < keywords.length - 1) {
        await this.delay(randInt(3_000, 7_000));
      }
    }
  }

  private async maybeAlertNewListing(listing: Listing, keyword: Keyword, countryCode: string): Promise<void> {
    await this.telegramService
      .sendListingAlert(listing, keyword, countryCode)
      .catch(err => this.logger.warn(`Alerte Telegram échouée : ${err.message}`));
  }

  async getStatus() {
    const keywords = await this.keywordsService.findActive();
    return {
      paused: this.paused,
      isFastRunning: this.isFastRunning,
      lastScrapeTime: this.lastScrapeTime,
      activeKeywords: keywords.length,
      queueStats: {
        seller: this.sellerQueue.getStats(),
        availability: this.availabilityQueue.getStats(),
      },
      keywords: keywords.map(kw => ({
        id: kw.id,
        label: kw.label,
        countryCodes: this.getCountryCodes(kw),
        lastRunAt: this.lastRunAt.get(kw.id) ? new Date(this.lastRunAt.get(kw.id)!) : null,
        nextRunInSeconds: 0,
      })),
    };
  }

  async backfill(keywordId?: number, pages = 20) {
    const allKeywords = await this.keywordsService.findActive();
    const keywords = keywordId ? allKeywords.filter(kw => kw.id === keywordId) : allKeywords;
    const results: { keyword: string; pages: number; inserted: number }[] = [];
    for (const keyword of keywords) {
      const primaryCountry = this.getCountryCodes(keyword)[0] ?? 'fr';
      const client = this.clientPool.getClient(primaryCountry);
      let inserted = 0; let completedPages = 0;
      for (let page = 1; page <= pages; page++) {
        try {
          const items = await client.search(keyword.search_text, keyword.min_price, keyword.max_price, 96, page, keyword.catalog_id);
          if (items.length === 0) break;
          for (const item of items) {
            const { isNew } = await this.listingsService.upsertListing(item, keyword, primaryCountry);
            if (isNew) inserted++;
          }
          completedPages++;
          if (page < pages) await this.delay(3000);
        } catch (err: any) {
          if (err.message === 'BANNED') break;
          break;
        }
      }
      results.push({ keyword: keyword.label, pages: completedPages, inserted });
      if (keywords.indexOf(keyword) < keywords.length - 1) await this.delay(5000);
    }
    return results;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
