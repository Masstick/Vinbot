# SP1 — Débrancher la valorisation + Telegram sur filtres — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retirer entièrement le moteur de valorisation (prix moyen, deal_score, profit, pipeline Mistral) et déclencher les alertes Telegram sur chaque nouvelle annonce matchant un mot-clé.

**Architecture:** Refactor backend (NestJS) qui supprime le calcul de marché et Mistral, simplifie le scraper (fast scan + vendeur unique + pause), et rebranche Telegram sur l'événement « nouvelle annonce ». Nettoyage frontend des affichages de valorisation. Migration SQL destructive appliquée manuellement.

**Tech Stack:** NestJS, TypeORM (synchronize:false), PostgreSQL, Socket.io, Next.js 16, Jest.

## Global Constraints

- Spec de référence : `docs/superpowers/specs/2026-06-18-sp1-remove-valuation-design.md`.
- `TELEGRAM_CHAT_ID` global comme destination (le routage par utilisateur est SP2 — hors périmètre).
- Telegram se déclenche sur **nouvelle annonce uniquement** (pas sur baisse de prix). Dédup `notifications_log` 24 h conservée.
- Schéma : migration **destructive**, appliquée **manuellement** (jamais en auto au démarrage).
- Conserver : filtre vendeur unique (`seller_item_count`/`seller_checked_at`), `seller_country`/`country_code`/`vinted_created_at`, `price_history`, `scraper_state`, pause/reprise scraper.
- Commandes backend depuis `backend/`, frontend depuis `frontend/`, `git` depuis la racine.
- Ne pas corriger le lint préexistant hors lignes touchées.

---

### Task 1: Déplacer `async-queue` hors du module analysis

`AsyncQueue` est dans `analysis/` mais reste utilisé par la `sellerQueue` du scraper (filtre vendeur unique). Il faut le sortir avant de supprimer `analysis/`.

**Files:**
- Move: `backend/src/analysis/async-queue.ts` → `backend/src/scraper/async-queue.ts`
- Move: `backend/src/analysis/async-queue.spec.ts` → `backend/src/scraper/async-queue.spec.ts`
- Modify: `backend/src/scraper/scraper.service.ts` (import)

**Interfaces:**
- Produces: `AsyncQueue` importable depuis `../scraper/async-queue` (API inchangée).

- [ ] **Step 1: Déplacer les fichiers (préserve l'historique git)**

```bash
git mv backend/src/analysis/async-queue.ts backend/src/scraper/async-queue.ts
git mv backend/src/analysis/async-queue.spec.ts backend/src/scraper/async-queue.spec.ts
```

- [ ] **Step 2: Corriger l'import dans `scraper.service.ts`**

Remplacer :
```ts
import { AsyncQueue } from '../analysis/async-queue';
```
par :
```ts
import { AsyncQueue } from './async-queue';
```

- [ ] **Step 3: Vérifier que les tests async-queue passent encore**

Run : `npx jest async-queue`
Expected : PASS (le déplacement n'a pas changé la logique).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(backend): move AsyncQueue from analysis to scraper module"
```

---

### Task 2: Retirer la valorisation du backend (cœur)

Refactor atomique : tout le code de valorisation et Mistral est retiré, le scraper simplifié, Telegram rebranché. Le backend ne compile de nouveau qu'à la fin de la tâche — la vérification est en fin de tâche.

**Files:**
- Modify: `backend/src/listings/listings.service.ts`
- Modify: `backend/src/scraper/scraper.service.ts`
- Modify: `backend/src/notifications/telegram.service.ts`
- Modify: `backend/src/notifications/deals.gateway.ts`
- Modify: `backend/src/listings/listings.controller.ts`
- Modify: `backend/src/scraper/scraper.controller.ts`
- Modify: `backend/src/listings/listings.module.ts`
- Modify: `backend/src/scraper/scraper.module.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/keywords/keyword.entity.ts`
- Modify: `backend/src/keywords/dto/create-keyword.dto.ts`
- Delete: `backend/src/analysis/` (reste : mistral.service.ts, mistral.service.spec.ts, analysis.controller.ts, analysis.module.ts, deal-analysis.entity.ts, model-market-avg.entity.ts)

**Interfaces:**
- Produces: `ListingsService.upsertListing(item, keyword, countryCode?) → { listing: Listing; isNew: boolean; priceChanged: boolean }`
- Produces: `TelegramService.sendListingAlert(listing: Listing, keyword: Keyword, countryCode: string): Promise<void>`
- Produces: `DealsGateway.emitNewListing(payload: ListingEvent)` avec `ListingEvent = { listingId, title, price, photoUrl, url, keywordLabel, vintedCreatedAt }`

- [ ] **Step 1: `keyword.entity.ts` — retirer les colonnes de valorisation**

Supprimer les blocs `target_margin`, `shipping_estimate`, `market_scan_pages` :
```ts
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 10 })
  target_margin: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 4 })
  shipping_estimate: number;
```
et
```ts
  @Column({ default: 5 })
  market_scan_pages: number;
```

- [ ] **Step 2: `create-keyword.dto.ts` — retirer `target_margin` et `shipping_estimate`**

Supprimer les deux blocs :
```ts
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  target_margin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shipping_estimate?: number;
```

- [ ] **Step 2b: Entités — retirer les colonnes droppées (sinon `klRepo.find` casse après migration)**

`backend/src/listings/keyword-listing.entity.ts` : supprimer les colonnes `deal_score`, `market_avg`, `potential_profit`, `model_market_avg`, `analysis_id`. Le fichier ne conserve que :
```ts
import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Keyword } from '../keywords/keyword.entity';
import { Listing } from './listing.entity';

@Entity('keyword_listings')
export class KeywordListing {
  @PrimaryColumn()
  keyword_id: number;

  @PrimaryColumn()
  listing_id: number;

  @ManyToOne(() => Keyword, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'keyword_id' })
  keyword: Keyword;

  @ManyToOne(() => Listing, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listing_id' })
  listing: Listing;

  @CreateDateColumn()
  matched_at: Date;

  /** Nb d'annonces actives du vendeur correspondant au mot-clé (profil Vinted). Null = pas encore vérifié. */
  @Column({ type: 'int', nullable: true })
  seller_item_count: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  seller_checked_at: Date | null;
}
```

`backend/src/listings/listing.entity.ts` : supprimer les colonnes `model_label` et `model_confidence` (les deux blocs `@Column ... model_label` et `@Column ... model_confidence`). Conserver tout le reste (dont `seller_country`, `country_code`, `view_count`, `favourite_count`, `vinted_created_at`).

- [ ] **Step 3: `telegram.service.ts` — remplacer `sendDealAlert` par `sendListingAlert`**

Supprimer la méthode `sendDealAlert(...)` et la remplacer par :
```ts
  async sendListingAlert(listing: Listing, keyword: Keyword, countryCode: string): Promise<void> {
    if (!this.configured) {
      this.logger.warn('Telegram non configuré — alerte ignorée');
      return;
    }
    if (await this.alreadyNotified(listing.id, keyword.id)) return;

    const country = countryCode ? countryCode.toUpperCase() : '';
    const caption = [
      `🆕 *${this.escape(listing.title ?? 'Annonce Vinted')}*`,
      ``,
      `💶 *${this.escape(String(listing.price ?? '?'))}€*`,
      listing.brand
        ? `🏷️ ${this.escape(listing.brand)}${listing.condition_label ? ' · ' + this.escape(listing.condition_label) : ''}`
        : '',
      `🔑 _${this.escape(keyword.label)}_${country ? ' · ' + this.escape(country) : ''}`,
      `[Voir l'annonce](${listing.url})`,
    ].filter(Boolean).join('\n');

    try {
      if (listing.photo_url) {
        await axios.post(`https://api.telegram.org/bot${this.token}/sendPhoto`, {
          chat_id: this.chatId,
          photo: listing.photo_url,
          caption,
          parse_mode: 'MarkdownV2',
        });
      } else {
        await axios.post(`https://api.telegram.org/bot${this.token}/sendMessage`, {
          chat_id: this.chatId,
          text: caption,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: false,
        });
      }
      await this.logRepo.save({ listing_id: listing.id, keyword_id: keyword.id });
      this.logger.log(`Alerte Telegram envoyée : listing ${listing.id} / keyword ${keyword.id}`);
    } catch (err: any) {
      this.logger.error(`Erreur Telegram: ${err.response?.data?.description ?? err.message}`);
    }
  }
```

- [ ] **Step 4: `deals.gateway.ts` — retirer `emitNewDeal` et alléger `ListingEvent`**

Remplacer l'interface `ListingEvent` par :
```ts
export interface ListingEvent {
  listingId: number;
  title: string;
  price: number;
  photoUrl: string | null;
  url: string | null;
  keywordLabel: string;
  vintedCreatedAt: string | null;
}
```
Supprimer entièrement la méthode `emitNewDeal(...)`. Conserver `emitNewListing` et `emitKeywordChanged`.

- [ ] **Step 5: `listings.service.ts` — retirer la valorisation**

Appliquer :
- Supprimer les imports `ModelMarketAvg` et `DealAnalysis`.
- Supprimer les helpers/constantes `median`, `MIN_MODEL_ITEMS`, `MIN_KEYWORD_ITEMS`, et l'interface `MarketAvgResult`.
- Dans le constructeur, retirer les injections `modelAvgRepo` (ModelMarketAvg) et `analysisRepo` (DealAnalysis).
- Supprimer les méthodes : `computeMarketAvg`, `fetchPrices`, `updateModelMarketAvg`, `rescoreWithModel`, `saveDealAnalysis`, `updateListingModel`, `getListingsWithoutModel`, `getOpportunities`, `getValidated`.
- Remplacer `upsertListing` par :
```ts
  async upsertListing(item: VintedItem, keyword: Keyword, countryCode?: string): Promise<{ listing: Listing; isNew: boolean; priceChanged: boolean }> {
    const existing = await this.listingRepo.findOneBy({ vinted_id: item.vinted_id });
    let isNew = false; let priceChanged = false; let listing: Listing;
    if (!existing) {
      isNew = true;
      listing = this.listingRepo.create({
        vinted_id: item.vinted_id, title: item.title, price: item.price, url: item.url,
        photo_url: item.photo_url, brand: item.brand, size_label: item.size_label,
        condition_label: item.condition_label, seller_name: item.seller_name,
        seller_id: item.seller_id, country_code: countryCode ?? 'fr', last_seen_at: new Date(),
        vinted_created_at: item.vinted_created_at ?? null,
      });
      listing = await this.listingRepo.save(listing);
      await this.historyRepo.save({ listing_id: listing.id, price: item.price });
    } else {
      listing = existing;
      await this.listingRepo.update(existing.id, { last_seen_at: new Date() });
      if (parseFloat(String(existing.price)) !== item.price) {
        priceChanged = true;
        await this.listingRepo.update(existing.id, { price: item.price });
        await this.historyRepo.save({ listing_id: existing.id, price: item.price });
        listing.price = item.price;
      }
    }
    await this.klRepo.upsert(
      { keyword_id: keyword.id, listing_id: listing.id, matched_at: new Date() },
      ['keyword_id', 'listing_id'],
    );
    return { listing, isNew, priceChanged };
  }
```
- Dans `getListings`, retirer du `SELECT` `kl.deal_score, kl.market_avg, kl.model_market_avg, kl.potential_profit`, retirer `LEFT JOIN deal_analyses da ON da.id = kl.analysis_id` et `da.recommendation, da.scam_risk, da.reasoning`. Le `SELECT` interne devient :
```sql
        SELECT DISTINCT ON (l.id)
          l.*, kl.matched_at,
          kl.seller_item_count,
          k.label AS keyword_label, k.id AS keyword_id,
          EXTRACT(EPOCH FROM (NOW() - l.first_seen_at)) / 3600 AS freshness_hours
        FROM keyword_listings kl
        INNER JOIN listings l ON l.id = kl.listing_id
        INNER JOIN keywords k ON k.id = kl.keyword_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY l.id, kl.matched_at DESC
```
- Dans `getListing`, retirer la ligne `const analysis = await this.analysisRepo.findOneBy(...)` et le champ `analysis` du retour.
- Dans `getStats`, retirer la requête `validatedDeals` et la clé `validated_deals` du retour.

- [ ] **Step 6: `scraper.service.ts` — simplifier**

Appliquer :
- Supprimer les imports `MistralService`.
- Supprimer les constantes `MARKET_TICK_MS`, `BOOTSTRAP_PAGES`, `BOOTSTRAP_MIN_LISTINGS`, `AI_DEAL_SCORE_THRESHOLD`, `AI_MIN_MARKET_ITEMS`, `AI_MIN_PRICE`.
- Supprimer les interfaces `ModelQueueItem`, `AnalysisQueueItem` et les champs/queues `modelQueue`, `analysisQueue`, `isMarketRunning`, `bootstrappedKeywords`, `bootstrappingKeyword`.
- Retirer `MistralService` du constructeur.
- Supprimer les méthodes : `scheduleMarketTick`, `marketTick`, `runMarketScan`, `bootstrapNewKeywords`, `queueModelExtraction`, `processModelExtraction`, `processDealAnalysis`, `maybeAlertClassic`, `backfillMistral`.
- `onModuleInit` : retirer la ligne `setTimeout(() => this.scheduleMarketTick(), MARKET_TICK_MS);`.
- `runFastScan` : retirer l'appel à `bootstrapNewKeywords`. Pour chaque annonce, remplacer la destructuration par `const { listing, isNew, priceChanged } = await this.listingsService.upsertListing(item, keyword, countryCode);`. Remplacer le bloc `if (isNew) { emitNewListing(...) }` par :
```ts
            if (isNew) {
              this.dealsGateway.emitNewListing({
                listingId: listing.id,
                title: listing.title ?? item.title,
                price: parseFloat(String(listing.price ?? item.price)),
                photoUrl: listing.photo_url ?? null,
                url: listing.url ?? null,
                keywordLabel: keyword.label,
                vintedCreatedAt: listing.vinted_created_at ? listing.vinted_created_at.toISOString() : null,
              });
              await this.maybeAlertNewListing(listing, keyword, countryCode);
            }
```
  Supprimer ensuite tout le bloc `if (!isNew && !priceChanged) continue; ... maybeAlertClassic ...` qui suivait.
- Ajouter la méthode :
```ts
  private async maybeAlertNewListing(listing: Listing, keyword: Keyword, countryCode: string): Promise<void> {
    await this.telegramService
      .sendListingAlert(listing, keyword, countryCode)
      .catch(err => this.logger.warn(`Alerte Telegram échouée : ${err.message}`));
  }
```
- `getStatus` : retirer `isMarketRunning`, `bootstrappingKeyword`, `mistralEnabled`, et les stats `model`/`analysis` de `queueStats` (ne garder que `seller`).
- Conserver `backfill` mais retirer toute référence valorisation (il n'en a pas — il appelle `upsertListing` et lit `isNew`, OK).

- [ ] **Step 7: Contrôleurs — retirer les routes mortes**

`listings.controller.ts` : supprimer les méthodes `getOpportunities` (`@Get('opportunities')`) et `getValidated` (`@Get('validated')`).
`scraper.controller.ts` : supprimer la méthode `backfillMistral` (`@Post('backfill-mistral')`) et l'import inutilisé éventuel.

- [ ] **Step 8: Modules — retirer Mistral/analysis**

`listings.module.ts` : `forFeature([Listing, KeywordListing, PriceHistory])` (retirer `ModelMarketAvg`, `DealAnalysis` et leurs imports).
`scraper.module.ts` : retirer `AnalysisModule` des imports et son import en tête.
`app.module.ts` : retirer `AnalysisModule` des imports ; retirer `DealAnalysis` et `ModelMarketAvg` du tableau `entities` et de leurs imports.

- [ ] **Step 9: Supprimer les fichiers Mistral/analysis restants**

```bash
git rm backend/src/analysis/mistral.service.ts backend/src/analysis/mistral.service.spec.ts backend/src/analysis/analysis.controller.ts backend/src/analysis/analysis.module.ts backend/src/analysis/deal-analysis.entity.ts backend/src/analysis/model-market-avg.entity.ts
```
(Le dossier `analysis/` doit alors être vide ; `async-queue.*` a déjà été déplacé en Task 1.)

- [ ] **Step 10: Vérifier la compilation backend**

Run : `npm run build`
Expected : exit 0, aucune erreur TypeScript.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(backend): remove valuation engine + Mistral, alert Telegram on new matching listing"
```

---

### Task 3: Adapter les tests backend

**Files:**
- Modify: `backend/src/listings/listings.service.spec.ts`

**Interfaces:**
- Consumes: `ListingsService` (constructeur sans repos ModelMarketAvg/DealAnalysis).

- [ ] **Step 1: Remplacer `listings.service.spec.ts`**

Le service n'a plus `computeMarketAvg`/`updateModelMarketAvg` ni les repos `ModelMarketAvg`/`DealAnalysis`. Remplacer tout le fichier par une version qui ne teste que `getListings` (solo_seller) :
```ts
import { ListingsService } from './listings.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Listing } from './listing.entity';
import { KeywordListing } from './keyword-listing.entity';
import { PriceHistory } from './price-history.entity';
import { DataSource } from 'typeorm';

function mockRepo<T>(overrides: Partial<any> = {}): T {
  return {
    findOneBy: jest.fn(), save: jest.fn(), upsert: jest.fn(), update: jest.fn(),
    find: jest.fn(), count: jest.fn(), create: jest.fn(),
    ...overrides,
  } as unknown as T;
}

async function buildService(queryMock: jest.Mock) {
  const module = await Test.createTestingModule({
    providers: [
      ListingsService,
      { provide: getRepositoryToken(Listing), useValue: mockRepo() },
      { provide: getRepositoryToken(KeywordListing), useValue: mockRepo() },
      { provide: getRepositoryToken(PriceHistory), useValue: mockRepo() },
      { provide: DataSource, useValue: { query: queryMock } },
    ],
  }).compile();
  return module.get(ListingsService);
}

describe('ListingsService.getListings', () => {
  it('includes solo_seller filter when soloSeller=true', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const svc = await buildService(queryMock);
    await svc.getListings({ keywordId: 3, soloSeller: true });
    const sql: string = queryMock.mock.calls[0][0];
    expect(sql).toContain('kl.seller_item_count IS NOT NULL');
    expect(sql).toContain('kl.seller_item_count <= 1');
  });

  it('omits solo_seller filter when soloSeller=false', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const svc = await buildService(queryMock);
    await svc.getListings({ keywordId: 3, soloSeller: false });
    const sql: string = queryMock.mock.calls[0][0];
    expect(sql).not.toContain('seller_item_count IS NOT NULL');
  });
});
```

- [ ] **Step 2: Lancer toute la suite**

Run : `npm test`
Expected : tous les suites passent (plus de `mistral.service.spec`, plus de `computeMarketAvg`). `scraper.service.spec` (pause/resume) et `vinted.client.spec` doivent rester verts — le constructeur de `ScraperService` n'a plus `MistralService` : vérifier que `scraper.service.spec.ts` n'injecte pas `MistralService`.

- [ ] **Step 3: Corriger `scraper.service.spec.ts` si besoin**

Si le test échoue car il passait un mock `mistralService` au constructeur, ajuster l'instanciation pour correspondre à la nouvelle signature `new ScraperService(keywordsService, listingsService, telegramService, dealsGateway, dataSource)` (retirer l'argument mistral). Re-lancer `npx jest scraper.service.spec` → PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(backend): adapt specs to valuation removal"
```

---

### Task 4: Migration de schéma + init.sql

**Files:**
- Create: `db/migrations/006_drop_valuation.sql`
- Modify: `db/init.sql`

- [ ] **Step 1: Créer `db/migrations/006_drop_valuation.sql`**

```sql
-- SP1 : retrait de la valorisation. DESTRUCTIF — sauvegarder avant (pg_dump).
ALTER TABLE keywords         DROP COLUMN IF EXISTS target_margin;
ALTER TABLE keywords         DROP COLUMN IF EXISTS shipping_estimate;
ALTER TABLE keywords         DROP COLUMN IF EXISTS market_scan_pages;
ALTER TABLE keyword_listings DROP COLUMN IF EXISTS deal_score;
ALTER TABLE keyword_listings DROP COLUMN IF EXISTS market_avg;
ALTER TABLE keyword_listings DROP COLUMN IF EXISTS model_market_avg;
ALTER TABLE keyword_listings DROP COLUMN IF EXISTS potential_profit;
ALTER TABLE keyword_listings DROP COLUMN IF EXISTS analysis_id;
ALTER TABLE listings         DROP COLUMN IF EXISTS model_label;
ALTER TABLE listings         DROP COLUMN IF EXISTS model_confidence;
DROP TABLE IF EXISTS deal_analyses;
DROP TABLE IF EXISTS model_market_avg;
```

- [ ] **Step 2: Mettre `db/init.sql` en miroir (installs neuves)**

Dans la table `keywords`, retirer les lignes :
```sql
  target_margin         DECIMAL(10,2) DEFAULT 10,
  shipping_estimate     DECIMAL(10,2) DEFAULT 4,
```
Dans la table `keyword_listings`, retirer les lignes :
```sql
  deal_score        DECIMAL(5,2),
  market_avg        DECIMAL(10,2),
  potential_profit  DECIMAL(10,2),
```
(Vérifier que la virgule de la ligne précédant `matched_at` reste correcte.)

- [ ] **Step 3: Vérifier la cohérence (lecture)**

Relire `init.sql` : `keyword_listings` doit contenir au minimum `keyword_id`, `listing_id`, `matched_at`, et la `PRIMARY KEY (keyword_id, listing_id)`. Pas d'erreur de virgule.

- [ ] **Step 4: Commit (sans appliquer)**

```bash
git add db/migrations/006_drop_valuation.sql db/init.sql
git commit -m "chore(db): migration 006 drop valuation columns/tables + sync init.sql"
```

- [ ] **Step 5: Application MANUELLE (à faire par l'utilisateur, hors agent)**

Documenter dans le message de fin. Commande (conteneur DB up) :
```bash
docker compose exec -T db pg_dump -U "$DB_USER" "$DB_NAME" > backup-pre-sp1.sql   # sauvegarde
docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" < db/migrations/006_drop_valuation.sql
```

---

### Task 5: Frontend — types & socket (`api.ts`, `useDealsSocket`, DealToast)

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/listingEvent.ts`
- Modify: `frontend/src/app/layout.tsx`
- Delete: `frontend/src/components/DealToast.tsx`, `frontend/src/lib/useDealsSocket.ts`

**Interfaces:**
- Produces: `Keyword` sans `target_margin`/`shipping_estimate` ; `Stats` sans `validated_deals` ; `KeywordListing` allégé ; plus de `api.mistral`.

- [ ] **Step 1: `api.ts` — alléger les types et retirer Mistral**

- `Keyword` : retirer `target_margin: number;` et `shipping_estimate: number;`.
- `Stats` : retirer `validated_deals: number;`.
- `KeywordListing` : retirer `deal_score`, `market_avg`, `potential_profit`, `analysis_confidence`, `recommendation`, `scam_risk`.
- `Listing` : retirer `reasoning?`.
- Dans `rowToKeywordListing`, retirer les champs correspondants (`deal_score`, `market_avg`, `potential_profit`, `analysis_confidence`, `recommendation`, `scam_risk`, `reasoning`).
- Retirer le bloc `mistral: { test: ... }` de l'objet `api`.

- [ ] **Step 2: `listingEvent.ts` — alléger**

```ts
export interface ListingEvent {
  listingId: number;
  title: string;
  price: number;
  photoUrl: string | null;
  url: string | null;
  keywordLabel: string;
  vintedCreatedAt: string | null;
}
```

- [ ] **Step 3: Retirer le toast « new-deal » (mort après suppression de emitNewDeal)**

Dans `frontend/src/app/layout.tsx` : retirer l'import `DealToastManager` et la balise `<DealToastManager />`.
Puis :
```bash
git rm frontend/src/components/DealToast.tsx frontend/src/lib/useDealsSocket.ts
```

- [ ] **Step 4: Typecheck**

Run (depuis `frontend/`) : `npx tsc --noEmit`
Expected : des erreurs attendues dans `live/page.tsx`, `listings/[id]/page.tsx`, `settings/page.tsx`, `keywords` (champs supprimés) — elles seront corrigées Tasks 6-9. **Ne pas committer si d'autres fichiers que ceux-là cassent.** Si seuls ces fichiers cassent, continuer.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(frontend): slim types + events, drop new-deal toast and mistral api"
```

---

### Task 6: Frontend — page Live

**Files:**
- Modify: `frontend/src/app/live/page.tsx`

- [ ] **Step 1: Retirer score/profit et le filtre « rentables »**

- Supprimer la fonction `dealScoreColor`.
- Retirer l'état `filter` et les boutons de filtre `'all' | 'profitable'` (la barre de filtre entière).
- Remplacer `displayed` par `const displayed = items;`.
- Dans `ListingRow`, supprimer la colonne « Deal score » (le `<span>` utilisant `listing.dealScore`).
- Dans les en-têtes de colonnes, retirer `<span ...>Score</span>`.
- Le texte du vide « Rentables uniquement » est supprimé avec le filtre ; conserver « En attente des nouvelles annonces… ».

- [ ] **Step 2: Typecheck**

Run : `npx tsc --noEmit`
Expected : plus d'erreur dans `live/page.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/live/page.tsx
git commit -m "refactor(frontend): live feed shows raw listings (no score/profit)"
```

---

### Task 7: Frontend — page détail `/listings/[id]`

On retire la carte « Analyse du deal » et tout affichage de valorisation, on corrige le lien retour, on conserve la calculatrice d'arbitrage manuelle avec des valeurs par défaut neutres.

**Files:**
- Modify: `frontend/src/app/listings/[id]/page.tsx`
- Modify: `frontend/src/components/PriceChart.tsx` (retrait prop `marketAvg` si requis)

- [ ] **Step 1: Nettoyer la page détail**

- Import lucide : retirer `TrendingDown`, `Percent` (si plus utilisé après nettoyage, sinon garder `Percent` pour le ROI), `ShieldCheck` (si plus utilisé), `Brain`, `AlertCircle`. Garder ceux encore utilisés (`ArrowLeft`, `ExternalLink`, `Calculator`, `Tag`, `User`, `Calendar`, `Clock`, `Globe`).
- Lien retour : remplacer `href="/opportunities"` par `href="/listings"` et le `title` par « Retour aux annonces ».
- Supprimer les variables `marketAvg`, `profit`, `score` et les fonctions `scoreBarColor`, `scamRiskBadge`.
- Pré-remplissage calculatrice (dans le `useEffect`) : retirer la lecture de `kl.market_avg` et `kl.keyword.shipping_estimate`. Remplacer par des défauts neutres :
```ts
        if (l) {
          const lPrice = l.price ? String(l.price) : '0';
          setPurchasePriceInput(lPrice);
          setResalePriceInput((Number(lPrice) * 1.4).toFixed(0));
          setShippingInput('4');
        }
```
- Supprimer le badge `score` sur l'image (bloc `{score !== null && (...)}`).
- Supprimer le « Moyenne estimée » à côté du prix (bloc `{marketAvg && (...)}`).
- Supprimer **toute** la carte « Analyse du deal » (le `<div>` commençant par `{/* Deal Analysis Card */}` jusqu'à sa fermeture) : elle contient score, moy. marché, profit, badges IA.
- `PriceChart` en bas : remplacer `marketAvg={marketAvg}` par `marketAvg={null}` (le composant accepte déjà `marketAvg` nullable ; vérifier sa signature à l'étape suivante).
- Retirer la variable `kl` si elle n'est plus utilisée après nettoyage (le bloc métadonnées vendeur utilise `kl?.keyword?.label` — le conserver via `listing.keyword_listings?.[0]?.keyword?.label`).

- [ ] **Step 2: Vérifier `PriceChart` accepte `marketAvg` null**

Lire `frontend/src/components/PriceChart.tsx`. Si la prop `marketAvg` est requise (`number`), la rendre optionnelle (`marketAvg?: number | null`) et garder le rendu conditionnel. Sinon, aucune modification.

- [ ] **Step 3: Typecheck**

Run : `npx tsc --noEmit`
Expected : plus d'erreur dans `listings/[id]/page.tsx`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(frontend): detail page without valuation, keep manual arbitrage calculator"
```

---

### Task 8: Frontend — formulaire & liste des mots-clés

**Files:**
- Modify: `frontend/src/components/KeywordForm.tsx`
- Modify: `frontend/src/app/keywords/page.tsx`

- [ ] **Step 1: `KeywordForm.tsx` — retirer les champs marge/frais de port**

Lire le fichier. Retirer les champs de saisie `target_margin` et `shipping_estimate` (label + input), leur état local et leur inclusion dans le payload envoyé à `api.keywords.create/update`. Conserver les autres champs (label, search_text, min/max price, category, catalog_id, country_codes, scan_interval_seconds, active).

- [ ] **Step 2: `keywords/page.tsx` — retirer l'affichage**

Retirer les lignes affichant `kw.target_margin` (« Marge cible ») et `kw.shipping_estimate` (« Envoi est. ») et les icônes `Coins`, `Truck` de l'import si elles ne servent plus.

- [ ] **Step 3: Typecheck**

Run : `npx tsc --noEmit`
Expected : plus d'erreur liée aux mots-clés.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(frontend): remove margin/shipping fields from keyword form"
```

---

### Task 9: Frontend — Réglages (retrait panneau Mistral) + env

**Files:**
- Modify: `frontend/src/app/settings/page.tsx`
- Modify: `docker-compose.yml`
- Modify: `.env.example`

- [ ] **Step 1: `settings/page.tsx` — retirer le panneau de test Mistral**

Retirer l'état `testingMistral`/`mistralResult`, la fonction `testMistral`, le bloc UI du panneau Mistral, et l'import `Brain` s'il n'est plus utilisé. Conserver le panneau Telegram, le contrôle du scraper, et « À propos du scraper ».

- [ ] **Step 2: `docker-compose.yml` — retirer `MISTRAL_API_KEY`**

Supprimer la ligne `MISTRAL_API_KEY: ${MISTRAL_API_KEY:-}` du service `api`.

- [ ] **Step 3: `.env.example` — retirer `MISTRAL_API_KEY`**

Supprimer la ligne `MISTRAL_API_KEY=` (et son éventuel commentaire).

- [ ] **Step 4: Typecheck**

Run : `npx tsc --noEmit`
Expected : exit 0 (toutes les erreurs frontend résolues).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove Mistral test panel and MISTRAL_API_KEY config"
```

---

### Task 10: Vérification finale

- [ ] **Step 1: Backend**

Run (depuis `backend/`) : `npm run build` puis `npm test`
Expected : build exit 0 ; tous les tests verts.

- [ ] **Step 2: Frontend**

Run (depuis `frontend/`) : `npx tsc --noEmit` puis `npm run build`
Expected : tsc exit 0 ; build réussi ; les routes ne contiennent plus opportunities/validated (déjà retirées au pivot précédent).

- [ ] **Step 3: Contrôles manuels (après application de la migration sur une base de test)**

- Le backend démarre sans les modules Mistral (aucun log MistralService).
- Ajouter un mot-clé précis, attendre un scan : une nouvelle annonce déclenche une alerte Telegram (vérifier le format : titre, prix, marque/état, mot-clé, lien) ; une 2ᵉ détection de la même annonce ne re-déclenche pas (dédup 24 h).
- `/listings`, `/listings/[id]`, `/live` s'affichent sans erreur ; la calculatrice d'arbitrage fonctionne.

- [ ] **Step 4: Commit éventuel des correctifs**

```bash
git add -A
git commit -m "chore: fixups final SP1"
```

---

## Notes d'exécution

- **Task 2 est volumineuse et atomique** : le backend ne recompile qu'à la fin (Step 10). C'est attendu pour un retrait transversal.
- **Migration destructive** : ne jamais l'exécuter en auto. L'utilisateur l'applique manuellement après `pg_dump` (Task 4, Step 5).
- Le `TELEGRAM_CHAT_ID` global reste la destination — SP2 (multi-utilisateurs) re-câblera `sendListingAlert` et l'ownership des mots-clés par utilisateur.
