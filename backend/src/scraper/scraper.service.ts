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
import { ProductClassifierService } from '../listings/product-classifier.service';
import { ProductTypeStatsService } from '../listings/product-type-stats.service';
import { DEAL_SCORE_THRESHOLD, MIN_RELIABLE_ITEM_COUNT } from '../listings/deal-score.constants';

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

// Classification différée (fallback Mistral) : reprend les annonces catégorie-seule
// non reconnues par les règles, en tick périodique séparé du scan principal.
const CLASSIFICATION_TICK_MS = 60_000;      // cadence du sweep Mistral
const CLASSIFICATION_BATCH_SIZE = 20;       // annonces non classées traitées par tick

// Scan principal : exécution parallèle bornée des scans (mot-clé × pays) dus, pour
// réduire la latence de détection sans saturer Vinted. Le tick passe souvent vérifier
// les échéances ; c'est `scan_interval_seconds` (par mot-clé) qui cadence le travail réel.
const SCAN_CONCURRENCY = 3;                              // scans simultanés max
const FAST_TICK_MIN_MS = 10_000;                        // cadence min de vérification des échéances
const FAST_TICK_MAX_MS = 15_000;                        // cadence max
const SCAN_INTERVAL_FLOOR_SECONDS = 15;                 // garde-fou : on ne scanne jamais plus vite que ça

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
  // Clé `${keywordId}:${countryCode}` → dernier scan (epoch ms). Sert à honorer
  // scan_interval_seconds par couple mot-clé/pays.
  private lastRunAt: Map<string, number> = new Map();
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
    private readonly productClassifier: ProductClassifierService,
    private readonly productTypeStats: ProductTypeStatsService,
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
    setTimeout(() => this.scheduleClassificationTick(), 30_000);
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
      await this.dataSource.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS product_type_key VARCHAR(200)`);
      await this.dataSource.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS product_type_attempts SMALLINT NOT NULL DEFAULT 0`);
      await this.dataSource.query(`ALTER TABLE keyword_listings ADD COLUMN IF NOT EXISTS deal_score DECIMAL(5,2)`);
      await this.dataSource.query(
        `CREATE TABLE IF NOT EXISTS product_type_stats (
           keyword_id        INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
           product_type_key  VARCHAR(200) NOT NULL,
           avg_price         DECIMAL(10,2),
           item_count        INTEGER NOT NULL DEFAULT 0,
           last_updated      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           PRIMARY KEY (keyword_id, product_type_key)
         )`,
      );
      await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_listings_product_type ON listings(product_type_key)`);
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
      const next = randInt(FAST_TICK_MIN_MS, FAST_TICK_MAX_MS);
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

    // Construit la liste des scans dus (mot-clé × pays) en honorant scan_interval_seconds :
    // un mot-clé n'est re-scanné que si son intervalle est écoulé pour ce pays.
    const now = Date.now();
    const jobs: { keyword: Keyword; countryCode: string }[] = [];
    for (const keyword of keywords) {
      const intervalMs =
        Math.max(keyword.scan_interval_seconds ?? 120, SCAN_INTERVAL_FLOOR_SECONDS) * 1000;
      for (const countryCode of this.getCountryCodes(keyword)) {
        const last = this.lastRunAt.get(`${keyword.id}:${countryCode}`);
        if (last && now - last < intervalMs) continue; // pas encore dû
        jobs.push({ keyword, countryCode });
      }
    }
    if (jobs.length === 0) return;

    // Exécution parallèle bornée : divise la latence de détection par le facteur de
    // concurrence tout en gardant un trafic Vinted raisonnable.
    await this.runJobsWithConcurrency(jobs, SCAN_CONCURRENCY, job =>
      this.scanKeywordCountry(job.keyword, job.countryCode),
    );
  }

  /** Scanne un couple (mot-clé, pays) : recherche, upsert, alerte. Isolé pour la parallélisation. */
  private async scanKeywordCountry(keyword: Keyword, countryCode: string): Promise<void> {
    try {
      const client = this.clientPool.getClient(countryCode);
      const items = await client.search(
        keyword.search_text, keyword.min_price, keyword.max_price, 96, 1, keyword.catalog_id,
      );
      // On marque le scan fait dès la réponse OK (même vide) : l'intervalle repart de là.
      this.lastRunAt.set(`${keyword.id}:${countryCode}`, Date.now());
      this.lastScrapeTime = new Date();
      if (items.length === 0) return;

      const newCount = await this.scanAndProcess(keyword, items, countryCode);

      this.logger.log(`[FastScan] "${keyword.search_text}" [${countryCode}] → ${items.length} annonces, ${newCount} nouvelles/modifiées`);
    } catch (err: any) {
      if (err.message === 'BANNED') {
        this.logger.warn(`[FastScan] Keyword #${keyword.id} [${countryCode}] bloqué — pause 60s`);
        await this.delay(60_000);
      } else {
        this.logger.error(`[FastScan] Keyword #${keyword.id} [${countryCode}]: ${err.message}`);
      }
    }
  }

  /** Traite un lot d'items déjà récupérés pour un mot-clé/pays : upsert, classification
   *  (mots-clés catégorie-seule uniquement), émission WS, alerte. Isolé de
   *  scanKeywordCountry pour être testable sans mocker le client Vinted. */
  private async scanAndProcess(keyword: Keyword, items: any[], countryCode: string): Promise<number> {
    let newCount = 0;
    for (const item of items) {
      const { listing, isNew, priceChanged } = await this.listingsService.upsertListing(item, keyword, countryCode);

      // Filtre "vendeur unique" : on vérifie le profil du vendeur en arrière-plan.
      this.queueSellerCheck(item.seller_id, keyword, countryCode);

      if (isNew) {
        let avgPrice: number | null = null;
        let dealScore: number | null = null;
        let isDeal = false;

        const isCategoryOnly = keyword.search_text === '';
        if (isCategoryOnly) {
          const key = this.productClassifier.classifyByRules(item.title);
          if (key) {
            await this.listingsService.setProductTypeKey(listing.id, key);
            const stats = await this.productTypeStats.recompute(keyword.id, key);
            if (stats.itemCount >= MIN_RELIABLE_ITEM_COUNT) {
              avgPrice = stats.avgPrice;
              dealScore = ((stats.avgPrice - item.price) / stats.avgPrice) * 100;
              await this.listingsService.setDealScore(keyword.id, listing.id, dealScore);
              isDeal = dealScore >= DEAL_SCORE_THRESHOLD;
            }
          }
        }

        this.dealsGateway.emitNewListing({
          listingId: listing.id,
          title: listing.title ?? item.title,
          price: parseFloat(String(listing.price ?? item.price)),
          photoUrl: listing.photo_url ?? null,
          url: listing.url ?? null,
          keywordLabel: keyword.label,
          vintedCreatedAt: listing.vinted_created_at ? listing.vinted_created_at.toISOString() : null,
          userId: keyword.user_id,
          avgPrice,
          dealScore,
          isDeal,
        });

        // Mots-clés catégorie-seule : alerte uniquement si intéressant.
        // Mots-clés avec texte de recherche : comportement SP1 inchangé (alerte sur tout match).
        if (!isCategoryOnly || isDeal) {
          await this.maybeAlertNewListing(listing, keyword, countryCode);
        }
      }
      if (isNew || priceChanged) newCount++;
    }
    return newCount;
  }

  // ── Classification différée (fallback Mistral) ─────────────────────────────
  private scheduleClassificationTick(): void {
    this.enqueueClassificationSweep()
      .catch(err => this.logger.warn(`[Classification] tick: ${err.message}`))
      .finally(() => {
        setTimeout(() => this.scheduleClassificationTick(), CLASSIFICATION_TICK_MS);
      });
  }

  private async enqueueClassificationSweep(): Promise<void> {
    if (this.paused) return;
    // Reprend aussi bien les annonces jamais passées par les règles (backfill des
    // annonces déjà en base avant ce chantier) que celles où les règles ont échoué
    // à l'ingestion — d'où le retest des règles ci-dessous avant le fallback Mistral.
    const candidates = await this.listingsService.getUnclassifiedListings(CLASSIFICATION_BATCH_SIZE);
    for (const candidate of candidates) {
      await this.classifyPendingListingAndScore(candidate);
    }
  }

  private async classifyPendingListingAndScore(candidate: { id: number; title: string; price: number; keywordId: number }): Promise<void> {
    const key = this.productClassifier.classifyByRules(candidate.title) ?? await this.productClassifier.classifyWithMistral(candidate.title);
    if (!key) {
      await this.listingsService.incrementClassificationAttempts(candidate.id);
      return;
    }
    await this.listingsService.setProductTypeKey(candidate.id, key);
    const stats = await this.productTypeStats.recompute(candidate.keywordId, key);

    if (stats.itemCount < MIN_RELIABLE_ITEM_COUNT) {
      this.dealsGateway.emitDealUpdated({ listingId: candidate.id, avgPrice: null, dealScore: null, isDeal: false });
      return;
    }

    const dealScore = ((stats.avgPrice - candidate.price) / stats.avgPrice) * 100;
    await this.listingsService.setDealScore(candidate.keywordId, candidate.id, dealScore);
    const isDeal = dealScore >= DEAL_SCORE_THRESHOLD;
    this.dealsGateway.emitDealUpdated({ listingId: candidate.id, avgPrice: stats.avgPrice, dealScore, isDeal });

    if (isDeal) {
      const listing = await this.listingsService.getListingById(candidate.id);
      const keyword = await this.keywordsService.findOne(candidate.keywordId);
      if (listing) {
        await this.maybeAlertNewListing(listing, keyword, listing.country_code ?? 'fr');
      }
    }
  }

  /**
   * Exécute `jobs` avec au plus `concurrency` workers en parallèle. Chaque worker
   * tire le job suivant et applique un léger jitter entre deux scans pour humaniser
   * le trafic (un même worker ne tape pas Vinted en rafale).
   */
  private async runJobsWithConcurrency<J>(
    jobs: J[],
    concurrency: number,
    worker: (job: J) => Promise<void>,
  ): Promise<void> {
    let idx = 0;
    const runners = Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (idx < jobs.length) {
        const job = jobs[idx++];
        await worker(job);
        if (idx < jobs.length) await this.delay(randInt(800, 1800));
      }
    });
    await Promise.all(runners);
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
      keywords: keywords.map(kw => {
        const codes = this.getCountryCodes(kw);
        const times = codes
          .map(c => this.lastRunAt.get(`${kw.id}:${c}`))
          .filter((t): t is number => typeof t === 'number');
        const last = times.length ? Math.max(...times) : null;
        return {
          id: kw.id,
          label: kw.label,
          countryCodes: codes,
          lastRunAt: last ? new Date(last) : null,
          nextRunInSeconds: 0,
        };
      }),
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
