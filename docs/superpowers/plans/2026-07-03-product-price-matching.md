# Prix moyen par type de produit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pour les mots-clés catégorie-seule (`search_text` vide, ex. "Piece info"), classer chaque annonce par type de produit (règles + fallback Mistral), calculer un prix moyen fiable par type, et n'alerter/mettre en avant que les annonces sous ce prix moyen — tout en affichant le prix moyen sur toute annonce classée.

**Architecture:** Classification synchrone par règles à l'ingestion (`ScraperService.scanKeywordCountry`), fallback Mistral en tick périodique différé pour les titres non reconnus. Prix moyen stocké par `(keyword_id, product_type_key)` dans une nouvelle table, recalculé (moyenne tronquée) à chaque nouvelle annonce classée du groupe. Le flux temps réel (WebSocket) et l'API REST du flux exposent `avgPrice`/`dealScore`/`isDeal` ; Telegram n'alerte que si `isDeal`.

**Tech Stack:** NestJS 11 + TypeORM (`synchronize: false`, schéma géré à la main), PostgreSQL, Socket.io, Next.js 16 (frontend), axios pour l'appel Mistral (déjà une dépendance).

## Global Constraints

- Pas de runner de migration : tout changement de schéma doit être appliqué en `CREATE TABLE/COLUMN IF NOT EXISTS` idempotent au démarrage du backend, **et** dupliqué dans `db/init.sql` + une migration numérotée dans `db/migrations/`.
- Ce chantier ne s'applique **qu'aux mots-clés dont `search_text` est une chaîne vide** (`''`). Les mots-clés avec texte de recherche gardent le comportement actuel (alerte Telegram sur tout nouveau match).
- Seuil "intéressant" : `deal_score >= 20` (20% sous le prix moyen). Seuil de fiabilité : `item_count >= 5`. Les deux sont des constantes de code, pas de config par mot-clé.
- Le type de produit (`product_type_key`) est basé sur les caractéristiques techniques uniquement, **sans la marque**.
- `avg_price` est une moyenne tronquée (retire les 10% de prix les plus hauts/bas), jamais une moyenne simple.
- Aucune dépendance Redis/BullMQ (repoussée à un chantier ultérieur) : le sweep Mistral est un tick périodique en mémoire, comme le tick `availability` existant.
- Réf. spec complète : `docs/superpowers/specs/2026-07-03-product-price-matching-design.md`.

---

### Task 1: Schéma DB — migration, init.sql, entités TypeORM

**Files:**
- Create: `db/migrations/009_add_product_type_matching.sql`
- Modify: `db/init.sql`
- Create: `backend/src/listings/product-type-stats.entity.ts`
- Modify: `backend/src/listings/listing.entity.ts`
- Modify: `backend/src/listings/keyword-listing.entity.ts`

**Interfaces:**
- Produces: table `product_type_stats(keyword_id, product_type_key, avg_price, item_count, last_updated)` ; colonnes `listings.product_type_key`, `listings.product_type_attempts` ; colonne `keyword_listings.deal_score`. Entité `ProductTypeStats` (TypeORM) avec ces mêmes champs, utilisée par les tasks suivantes.

- [ ] **Step 1: Écrire la migration**

`db/migrations/009_add_product_type_matching.sql` :
```sql
-- 009_add_product_type_matching.sql
-- Prix moyen par type de produit (mots-clés catégorie-seule).
-- Usage : docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" < db/migrations/009_add_product_type_matching.sql

ALTER TABLE listings ADD COLUMN IF NOT EXISTS product_type_key VARCHAR(200);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS product_type_attempts SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE keyword_listings ADD COLUMN IF NOT EXISTS deal_score DECIMAL(5,2);

CREATE TABLE IF NOT EXISTS product_type_stats (
  keyword_id        INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  product_type_key  VARCHAR(200) NOT NULL,
  avg_price         DECIMAL(10,2),
  item_count        INTEGER NOT NULL DEFAULT 0,
  last_updated      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (keyword_id, product_type_key)
);

CREATE INDEX IF NOT EXISTS idx_listings_product_type ON listings(product_type_key);
```

- [ ] **Step 2: Répercuter dans `db/init.sql`**

Dans le bloc `CREATE TABLE IF NOT EXISTS listings (...)` de `db/init.sql`, ajouter après `availability_checked_at TIMESTAMPTZ`:
```sql
  product_type_key VARCHAR(200),
  product_type_attempts SMALLINT NOT NULL DEFAULT 0
```
Dans le bloc `CREATE TABLE IF NOT EXISTS keyword_listings (...)`, ajouter après `seller_checked_at TIMESTAMPTZ,`:
```sql
  deal_score        DECIMAL(5,2),
```
Après le bloc `keyword_listings`, ajouter une nouvelle table (avant la section des index) :
```sql
CREATE TABLE IF NOT EXISTS product_type_stats (
  keyword_id        INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  product_type_key  VARCHAR(200) NOT NULL,
  avg_price         DECIMAL(10,2),
  item_count        INTEGER NOT NULL DEFAULT 0,
  last_updated      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (keyword_id, product_type_key)
);
```
Et dans la liste des `CREATE INDEX IF NOT EXISTS`, ajouter :
```sql
CREATE INDEX IF NOT EXISTS idx_listings_product_type ON listings(product_type_key);
```

- [ ] **Step 3: Entité `ProductTypeStats`**

Create `backend/src/listings/product-type-stats.entity.ts`:
```typescript
import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, UpdateDateColumn } from 'typeorm';
import { Keyword } from '../keywords/keyword.entity';

@Entity('product_type_stats')
export class ProductTypeStats {
  @PrimaryColumn()
  keyword_id: number;

  @ManyToOne(() => Keyword, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'keyword_id' })
  keyword: Keyword;

  @PrimaryColumn({ length: 200 })
  product_type_key: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  avg_price: number | null;

  @Column({ type: 'int', default: 0 })
  item_count: number;

  @UpdateDateColumn()
  last_updated: Date;
}
```

- [ ] **Step 4: Étendre `Listing` et `KeywordListing`**

In `backend/src/listings/listing.entity.ts`, add after the `availability_checked_at` column:
```typescript
  /** Type de produit normalisé (règles ou Mistral). Null = pas encore classé, 'unclassified' = abandonné après 3 échecs Mistral. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  product_type_key: string | null;

  /** Nombre de tentatives de classification Mistral (plafonné à 3, voir ScraperService). */
  @Column({ type: 'smallint', default: 0 })
  product_type_attempts: number;
```

In `backend/src/listings/keyword-listing.entity.ts`, add after `seller_checked_at`:
```typescript
  /** (avg_price - prix) / avg_price * 100, calculé une seule fois à la classification. Null tant que le type de produit n'est pas fiable (item_count < 5). */
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  deal_score: number | null;
```

- [ ] **Step 5: Vérifier la compilation**

Run: `cd backend && npm run build`
Expected: 0 erreur TypeScript (l'entité `ProductTypeStats` n'est pas encore enregistrée dans un module — c'est normal, ce sera fait au Task 7 ; `nest build` compile quand même chaque fichier isolément sans erreur de types).

- [ ] **Step 6: Commit**

```bash
git add db/migrations/009_add_product_type_matching.sql db/init.sql backend/src/listings/product-type-stats.entity.ts backend/src/listings/listing.entity.ts backend/src/listings/keyword-listing.entity.ts
git commit -m "feat(db): schéma product_type_stats + colonnes de classification"
```

---

### Task 2: Règles de classification (regex, pures)

**Files:**
- Create: `backend/src/listings/classifier-rules.ts`
- Test: `backend/src/listings/classifier-rules.spec.ts`

**Interfaces:**
- Produces: `CLASSIFICATION_RULES: ClassificationRule[]`, fonction `classifyTitle(title: string): string | null` — utilisée par `ProductClassifierService` (Task 3).

- [ ] **Step 1: Écrire les tests (échantillon réel observé en base)**

Create `backend/src/listings/classifier-rules.spec.ts`:
```typescript
import { classifyTitle } from './classifier-rules';

describe('classifyTitle', () => {
  it('reconnaît une barrette RAM DDR3 avec capacité', () => {
    expect(classifyTitle('16GB DDR3 Corsair xms CMX8GX3M2A1333C9')).toBe('RAM DDR3 16GB');
  });

  it('reconnaît une RAM DDR4 même avec un texte multilingue autour', () => {
    expect(classifyTitle('Kit 16GB ddr4 , 2 modulos de 8GB')).toBe('RAM DDR4 16GB');
  });

  it('reconnaît un CPU avec référence séparée par un espace', () => {
    expect(classifyTitle('Intel Core i7 4790K')).toBe('CPU i7-4790K');
  });

  it('reconnaît un CPU avec référence séparée par un tiret', () => {
    expect(classifyTitle('Processeur i5-2450M')).toBe('CPU i5-2450M');
  });

  it('retourne null pour un titre hors périmètre', () => {
    expect(classifyTitle('Lampadario a ventilatore')).toBeNull();
  });

  it('retourne null pour une RAM sans capacité extractible', () => {
    expect(classifyTitle('RAM DDR3')).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `cd backend && npx jest classifier-rules --no-coverage`
Expected: FAIL — `Cannot find module './classifier-rules'`

- [ ] **Step 3: Implémenter**

Create `backend/src/listings/classifier-rules.ts`:
```typescript
export interface ClassificationRule {
  family: string;
  familyPattern: RegExp;
  extract: (title: string) => string | null;
}

function extractCapacityGo(title: string): string | null {
  const m = title.match(/(\d+)\s?(?:go|gb)\b/i);
  return m ? `${m[1]}GB` : null;
}

function extractRamGeneration(title: string): string | null {
  const m = title.match(/ddr\s?([2-5])/i);
  return m ? `DDR${m[1]}` : null;
}

export const CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    family: 'RAM',
    familyPattern: /\bddr[2-5]\b|\bso-?dimm\b/i,
    extract: title => {
      const gen = extractRamGeneration(title);
      const capacity = extractCapacityGo(title);
      if (!gen || !capacity) return null;
      return `RAM ${gen} ${capacity}`;
    },
  },
  {
    family: 'CPU',
    familyPattern: /\bi[3579][\s-]\d{3,5}[a-z]*\b|\bryzen\b|\bxeon\b/i,
    extract: title => {
      const m = title.match(/\bi([3579])[\s-](\d{3,5}[a-z]*)\b/i);
      if (!m) return null;
      return `CPU i${m[1]}-${m[2].toUpperCase()}`;
    },
  },
];

/** Applique les règles dans l'ordre ; la première qui reconnaît une famille ET
 *  parvient à en extraire une clé exploitable l'emporte. Retourne null si aucune
 *  règle ne matche ou si la famille est reconnue mais l'extraction échoue
 *  (ex: "RAM DDR3" sans capacité). */
export function classifyTitle(title: string): string | null {
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.familyPattern.test(title)) {
      const key = rule.extract(title);
      if (key) return key;
    }
  }
  return null;
}
```

- [ ] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `cd backend && npx jest classifier-rules --no-coverage`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/listings/classifier-rules.ts backend/src/listings/classifier-rules.spec.ts
git commit -m "feat(listings): règles de classification RAM/CPU par regex"
```

---

### Task 3: `ProductClassifierService` (règles + fallback Mistral)

**Files:**
- Create: `backend/src/listings/product-classifier.service.ts`
- Test: `backend/src/listings/product-classifier.service.spec.ts`

**Interfaces:**
- Consumes: `classifyTitle` de `./classifier-rules` (Task 2).
- Produces: `ProductClassifierService.classifyByRules(title: string): string | null`, `ProductClassifierService.classifyWithMistral(title: string): Promise<string | null>` — utilisées par `ScraperService` (Tasks 9 et 10).

- [ ] **Step 1: Écrire les tests**

Create `backend/src/listings/product-classifier.service.spec.ts`:
```typescript
jest.mock('axios');
import axios from 'axios';
import { ProductClassifierService } from './product-classifier.service';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ProductClassifierService', () => {
  describe('classifyByRules', () => {
    it('délègue à classifyTitle', () => {
      const config: any = { get: jest.fn().mockReturnValue('') };
      const svc = new ProductClassifierService(config);
      expect(svc.classifyByRules('Processeur i5-2450M')).toBe('CPU i5-2450M');
      expect(svc.classifyByRules('Lampadario a ventilatore')).toBeNull();
    });
  });

  describe('classifyWithMistral', () => {
    it('retourne null immédiatement si MISTRAL_API_KEY est absent', async () => {
      const config: any = { get: jest.fn().mockReturnValue('') };
      const svc = new ProductClassifierService(config);
      const result = await svc.classifyWithMistral('Carte mère ASUS P8H67-M');
      expect(result).toBeNull();
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('retourne le type de produit renvoyé par Mistral', async () => {
      const config: any = { get: jest.fn().mockReturnValue('fake-key') };
      mockedAxios.post.mockResolvedValue({
        data: { choices: [{ message: { content: 'Carte mère ATX' } }] },
      });
      const svc = new ProductClassifierService(config);
      const result = await svc.classifyWithMistral('Scheda Madre ASUS P8H67-M');
      expect(result).toBe('Carte mère ATX');
    });

    it('retourne null si Mistral répond INCONNU', async () => {
      const config: any = { get: jest.fn().mockReturnValue('fake-key') };
      mockedAxios.post.mockResolvedValue({
        data: { choices: [{ message: { content: 'INCONNU' } }] },
      });
      const svc = new ProductClassifierService(config);
      const result = await svc.classifyWithMistral('Lampadario a ventilatore');
      expect(result).toBeNull();
    });

    it('retourne null si l’appel Mistral échoue', async () => {
      const config: any = { get: jest.fn().mockReturnValue('fake-key') };
      mockedAxios.post.mockRejectedValue(new Error('timeout'));
      const svc = new ProductClassifierService(config);
      const result = await svc.classifyWithMistral('Ventilateur Noctua NF-A9');
      expect(result).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `cd backend && npx jest product-classifier.service --no-coverage`
Expected: FAIL — `Cannot find module './product-classifier.service'`

- [ ] **Step 3: Implémenter**

Create `backend/src/listings/product-classifier.service.ts`:
```typescript
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { classifyTitle } from './classifier-rules';

@Injectable()
export class ProductClassifierService {
  private readonly logger = new Logger(ProductClassifierService.name);

  constructor(@Optional() private readonly config?: ConfigService) {}

  private get mistralKey(): string {
    return this.config?.get('MISTRAL_API_KEY') ?? process.env.MISTRAL_API_KEY ?? '';
  }

  classifyByRules(title: string): string | null {
    return classifyTitle(title);
  }

  async classifyWithMistral(title: string): Promise<string | null> {
    const key = this.mistralKey;
    if (!key) return null;
    try {
      const res = await axios.post(
        'https://api.mistral.ai/v1/chat/completions',
        {
          model: 'mistral-small-latest',
          temperature: 0,
          messages: [
            {
              role: 'user',
              content:
                `Extrais le type de produit générique (caractéristiques techniques ` +
                `uniquement, sans marque) depuis ce titre d'annonce Vinted : "${title}". ` +
                `Réponds uniquement avec le type de produit court (ex: "RAM DDR4 8GB", ` +
                `"Carte mère ATX"), ou "INCONNU" si le titre ne décrit pas un composant PC identifiable.`,
            },
          ],
        },
        { headers: { Authorization: `Bearer ${key}` }, timeout: 10_000 },
      );
      const text: string | undefined = res.data?.choices?.[0]?.message?.content?.trim();
      if (!text || text.toUpperCase().includes('INCONNU')) return null;
      return text;
    } catch (err: any) {
      this.logger.warn(`Classification Mistral échouée pour "${title}": ${err.message}`);
      return null;
    }
  }
}
```

- [ ] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `cd backend && npx jest product-classifier.service --no-coverage`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/listings/product-classifier.service.ts backend/src/listings/product-classifier.service.spec.ts
git commit -m "feat(listings): ProductClassifierService (règles + fallback Mistral)"
```

---

### Task 4: Moyenne tronquée + `ProductTypeStatsService`

**Files:**
- Create: `backend/src/listings/truncated-mean.ts`
- Test: `backend/src/listings/truncated-mean.spec.ts`
- Create: `backend/src/listings/product-type-stats.service.ts`
- Test: `backend/src/listings/product-type-stats.service.spec.ts`

**Interfaces:**
- Produces: `truncatedMean(prices: number[]): number` ; `ProductTypeStatsService.recompute(keywordId: number, productTypeKey: string): Promise<{ avgPrice: number; itemCount: number }>` — utilisée par `ScraperService` (Tasks 9, 10). Note : `ListingsService.getListings` (Task 6) n'utilise pas ce service — il lit la table `product_type_stats` par une jointure SQL directe.

- [ ] **Step 1: Tests de `truncatedMean`**

Create `backend/src/listings/truncated-mean.spec.ts`:
```typescript
import { truncatedMean } from './truncated-mean';

describe('truncatedMean', () => {
  it('retourne 0 pour un tableau vide', () => {
    expect(truncatedMean([])).toBe(0);
  });

  it('fait une moyenne simple quand il y a peu de valeurs (pas de troncature)', () => {
    expect(truncatedMean([10, 20, 30])).toBeCloseTo(20);
  });

  it('exclut les outliers hauts et bas sur un échantillon plus large', () => {
    // 10 valeurs : un outlier bas ("pour pièces" à 2€) et un outlier haut (200€)
    const prices = [2, 18, 19, 20, 20, 21, 22, 22, 23, 200];
    const result = truncatedMean(prices);
    // Sans troncature la moyenne serait tirée vers le haut par 200 ; avec troncature
    // (10% de chaque côté = 1 valeur retirée de chaque côté), 2 et 200 sont exclus.
    expect(result).toBeCloseTo((18 + 19 + 20 + 20 + 21 + 22 + 22 + 23) / 8);
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `cd backend && npx jest truncated-mean.spec --no-coverage`
Expected: FAIL — module introuvable

- [ ] **Step 3: Implémenter**

Create `backend/src/listings/truncated-mean.ts`:
```typescript
/** Moyenne tronquée : retire les 10% de prix les plus hauts et les plus bas avant
 *  de moyenner, pour absorber les annonces "pour pièces"/cassées et les erreurs de
 *  classification isolées. En dessous de 10 valeurs, aucune troncature n'a lieu
 *  (10% arrondi à 0) : moyenne simple. */
export function truncatedMean(prices: number[]): number {
  if (prices.length === 0) return 0;
  const sorted = [...prices].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * 0.1);
  const trimmed = cut > 0 ? sorted.slice(cut, sorted.length - cut) : sorted;
  const effective = trimmed.length > 0 ? trimmed : sorted;
  return effective.reduce((sum, p) => sum + p, 0) / effective.length;
}
```

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `cd backend && npx jest truncated-mean.spec --no-coverage`
Expected: PASS (3 tests)

- [ ] **Step 5: Tests de `ProductTypeStatsService`**

Create `backend/src/listings/product-type-stats.service.spec.ts`:
```typescript
import { ProductTypeStatsService } from './product-type-stats.service';

describe('ProductTypeStatsService', () => {
  it('recompute lit les prix du groupe, calcule la moyenne tronquée et upsert product_type_stats', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ price: '20.00' }, { price: '22.00' }, { price: '18.00' }]) // SELECT prices
      .mockResolvedValueOnce([]); // INSERT ... ON CONFLICT
    const svc = new ProductTypeStatsService({ query } as any);

    const result = await svc.recompute(7, 'RAM DDR4 8GB');

    expect(result.itemCount).toBe(3);
    expect(result.avgPrice).toBeCloseTo(20);
    expect(query.mock.calls[0][0]).toContain('FROM listings l');
    expect(query.mock.calls[0][1]).toEqual([7, 'RAM DDR4 8GB']);
    expect(query.mock.calls[1][0]).toContain('ON CONFLICT (keyword_id, product_type_key)');
    expect(query.mock.calls[1][1]).toEqual([7, 'RAM DDR4 8GB', result.avgPrice, 3]);
  });

});
```

- [ ] **Step 6: Lancer, vérifier l'échec**

Run: `cd backend && npx jest product-type-stats.service.spec --no-coverage`
Expected: FAIL — module introuvable

- [ ] **Step 7: Implémenter**

Create `backend/src/listings/product-type-stats.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { truncatedMean } from './truncated-mean';

export interface ProductTypeStatsResult {
  avgPrice: number;
  itemCount: number;
}

@Injectable()
export class ProductTypeStatsService {
  constructor(private readonly dataSource: DataSource) {}

  /** Recalcule la moyenne tronquée du groupe à partir de tous les prix connus,
   *  et upsert le résultat dans product_type_stats. Coût négligeable : le volume
   *  par groupe (type de produit) reste de l'ordre de la centaine d'annonces. */
  async recompute(keywordId: number, productTypeKey: string): Promise<ProductTypeStatsResult> {
    const rows = await this.dataSource.query(
      `SELECT l.price FROM listings l
       INNER JOIN keyword_listings kl ON kl.listing_id = l.id
       WHERE kl.keyword_id = $1 AND l.product_type_key = $2 AND l.price IS NOT NULL`,
      [keywordId, productTypeKey],
    );
    const prices = rows.map((r: any) => parseFloat(r.price));
    const avgPrice = truncatedMean(prices);
    const itemCount = prices.length;
    await this.dataSource.query(
      `INSERT INTO product_type_stats (keyword_id, product_type_key, avg_price, item_count, last_updated)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (keyword_id, product_type_key)
       DO UPDATE SET avg_price = $3, item_count = $4, last_updated = NOW()`,
      [keywordId, productTypeKey, avgPrice, itemCount],
    );
    return { avgPrice, itemCount };
  }
}
```

- [ ] **Step 8: Lancer, vérifier le succès**

Run: `cd backend && npx jest product-type-stats.service.spec --no-coverage`
Expected: PASS (1 test)

- [ ] **Step 9: Commit**

```bash
git add backend/src/listings/truncated-mean.ts backend/src/listings/truncated-mean.spec.ts backend/src/listings/product-type-stats.service.ts backend/src/listings/product-type-stats.service.spec.ts
git commit -m "feat(listings): moyenne tronquée + ProductTypeStatsService"
```

---

### Task 5: Constantes partagées + nouvelles méthodes `ListingsService`

**Files:**
- Create: `backend/src/listings/deal-score.constants.ts`
- Modify: `backend/src/listings/listings.service.ts`
- Modify: `backend/src/listings/listings.service.spec.ts`

**Interfaces:**
- Produces: `DEAL_SCORE_THRESHOLD = 20`, `MIN_RELIABLE_ITEM_COUNT = 5` ; `ListingsService.setProductTypeKey(listingId: number, key: string): Promise<void>`, `ListingsService.setDealScore(keywordId: number, listingId: number, dealScore: number): Promise<void>`, `ListingsService.getUnclassifiedListings(limit: number): Promise<{ id: number; title: string; price: number; keywordId: number }[]>`, `ListingsService.incrementClassificationAttempts(listingId: number): Promise<void>` — utilisées par `ScraperService` (Tasks 9, 10).

- [ ] **Step 1: Constantes partagées**

Create `backend/src/listings/deal-score.constants.ts`:
```typescript
/** Seuil "intéressant" : deal_score >= ce pourcentage sous le prix moyen du type de produit. */
export const DEAL_SCORE_THRESHOLD = 20;

/** Nombre minimum d'annonces vues pour un type de produit avant de considérer son avg_price fiable. */
export const MIN_RELIABLE_ITEM_COUNT = 5;
```

- [ ] **Step 2: Écrire les tests des nouvelles méthodes**

Append to `backend/src/listings/listings.service.spec.ts` (before the final closing `});` of the `describe('ListingsService.getListings', ...)` block, add a new `describe`):
```typescript
describe('ListingsService — classification', () => {
  it('setProductTypeKey met à jour la colonne product_type_key', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const svc = await buildService(queryMock);
    await svc.setProductTypeKey(42, 'RAM DDR4 8GB');
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE listings SET product_type_key'),
      [42, 'RAM DDR4 8GB'],
    );
  });

  it('setDealScore met à jour keyword_listings pour la paire (keyword_id, listing_id)', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const svc = await buildService(queryMock);
    await svc.setDealScore(7, 42, 25.5);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE keyword_listings SET deal_score'),
      [7, 42, 25.5],
    );
  });

  it('getUnclassifiedListings ne sélectionne que les mots-clés catégorie-seule sous 3 tentatives', async () => {
    const queryMock = jest.fn().mockResolvedValue([{ id: 1, title: 'x', price: '10.00', keyword_id: 7 }]);
    const svc = await buildService(queryMock);
    const rows = await svc.getUnclassifiedListings(20);
    expect(queryMock.mock.calls[0][0]).toContain("k.search_text = ''");
    expect(queryMock.mock.calls[0][0]).toContain('product_type_attempts < 3');
    expect(rows).toEqual([{ id: 1, title: 'x', price: 10, keywordId: 7 }]);
  });

  it('incrementClassificationAttempts bascule sur unclassified à la 3e tentative', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const svc = await buildService(queryMock);
    await svc.incrementClassificationAttempts(42);
    expect(queryMock.mock.calls[0][0]).toContain("'unclassified'");
    expect(queryMock.mock.calls[0][1]).toEqual([42]);
  });
});
```

- [ ] **Step 3: Lancer, vérifier l'échec**

Run: `cd backend && npx jest listings.service.spec --no-coverage`
Expected: FAIL — `svc.setProductTypeKey is not a function` (et les 3 suivants du même type)

- [ ] **Step 4: Implémenter dans `listings.service.ts`**

Add these methods to the `ListingsService` class in `backend/src/listings/listings.service.ts` (e.g. right after `updateSellerCountry`):
```typescript
  async setProductTypeKey(listingId: number, key: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE listings SET product_type_key = $2 WHERE id = $1`,
      [listingId, key],
    );
  }

  async setDealScore(keywordId: number, listingId: number, dealScore: number): Promise<void> {
    await this.dataSource.query(
      `UPDATE keyword_listings SET deal_score = $3 WHERE keyword_id = $1 AND listing_id = $2`,
      [keywordId, listingId, dealScore],
    );
  }

  /** Annonces d'un mot-clé catégorie-seule pas encore classées (ni par les règles, ni
   *  abandonnées après 3 échecs Mistral) — candidates au sweep périodique. */
  async getUnclassifiedListings(limit: number): Promise<{ id: number; title: string; price: number; keywordId: number }[]> {
    const rows = await this.dataSource.query(
      `SELECT l.id, l.title, l.price, kl.keyword_id
       FROM listings l
       INNER JOIN keyword_listings kl ON kl.listing_id = l.id
       INNER JOIN keywords k ON k.id = kl.keyword_id
       WHERE l.product_type_key IS NULL
         AND k.search_text = ''
         AND l.product_type_attempts < 3
       ORDER BY l.first_seen_at DESC
       LIMIT $1`,
      [limit],
    );
    return rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      price: parseFloat(r.price),
      keywordId: r.keyword_id,
    }));
  }

  /** Incrémente le compteur d'essais Mistral ; à la 3e tentative infructueuse,
   *  bascule product_type_key sur la sentinelle 'unclassified' pour ne plus jamais
   *  retenter (l'annonce reste visible normalement, juste jamais éligible à une alerte). */
  async incrementClassificationAttempts(listingId: number): Promise<void> {
    await this.dataSource.query(
      `UPDATE listings
       SET product_type_attempts = product_type_attempts + 1,
           product_type_key = CASE WHEN product_type_attempts + 1 >= 3 THEN 'unclassified' ELSE product_type_key END
       WHERE id = $1`,
      [listingId],
    );
  }
```

- [ ] **Step 5: Lancer, vérifier le succès**

Run: `cd backend && npx jest listings.service.spec --no-coverage`
Expected: PASS (tous les tests, anciens + 4 nouveaux)

- [ ] **Step 6: Commit**

```bash
git add backend/src/listings/deal-score.constants.ts backend/src/listings/listings.service.ts backend/src/listings/listings.service.spec.ts
git commit -m "feat(listings): méthodes de classification + constantes de seuil"
```

---

### Task 6: `getListings` — exposer `avg_price`/`deal_score`/`is_deal` + filtre `onlyDeals`

**Files:**
- Modify: `backend/src/listings/listings.service.ts`
- Modify: `backend/src/listings/listings.service.spec.ts`

**Interfaces:**
- Consumes: `DEAL_SCORE_THRESHOLD` de `./deal-score.constants` (Task 5).
- Produces: `getListings(opts: { ...; onlyDeals?: boolean })` — chaque ligne retournée porte désormais `avg_price`, `deal_score`, `is_deal`. Consommé par `ListingsController` (Task 13) et, via l'API REST, par le frontend (Task 12).

- [ ] **Step 1: Écrire les tests**

Add to `backend/src/listings/listings.service.spec.ts`, inside `describe('ListingsService.getListings', ...)`:
```typescript
  it('joint product_type_stats et expose avg_price/deal_score/is_deal', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const svc = await buildService(queryMock);
    await svc.getListings({});
    const sql: string = queryMock.mock.calls[0][0];
    expect(sql).toContain('LEFT JOIN product_type_stats pts');
    expect(sql).toContain('pts.item_count >= 5 THEN pts.avg_price');
    expect(sql).toContain('kl.deal_score >= 20');
  });

  it('ajoute le filtre onlyDeals quand demandé', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const svc = await buildService(queryMock);
    await svc.getListings({ onlyDeals: true });
    const sql: string = queryMock.mock.calls[0][0];
    expect(sql).toContain('kl.deal_score IS NOT NULL AND kl.deal_score >= 20');
  });

  it("n'ajoute pas le filtre onlyDeals par défaut", async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const svc = await buildService(queryMock);
    await svc.getListings({});
    const sql: string = queryMock.mock.calls[0][0];
    const whereOccurrences = sql.split('kl.deal_score IS NOT NULL AND kl.deal_score >= 20').length - 1;
    expect(whereOccurrences).toBe(0);
  });
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `cd backend && npx jest listings.service.spec --no-coverage`
Expected: FAIL — les 3 nouvelles assertions ne trouvent pas les fragments SQL attendus

- [ ] **Step 3: Modifier `getListings`**

In `backend/src/listings/listings.service.ts`, add the import at the top:
```typescript
import { DEAL_SCORE_THRESHOLD } from './deal-score.constants';
```

Replace the `getListings` method's `opts` type, `where` construction, and SQL with:
```typescript
  async getListings(opts: { keywordId?: number; limit?: number; offset?: number; country?: string; q?: string; maxAgeHours?: number; soloSeller?: boolean; userId?: number; onlyDeals?: boolean } = {}): Promise<any[]> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    const params: any[] = [];
    const where: string[] = [];
    if (opts.keywordId) { params.push(opts.keywordId); where.push(`kl.keyword_id = $${params.length}`); }
    if (opts.country) { params.push(opts.country.toLowerCase()); where.push(`LOWER(COALESCE(l.seller_country, l.country_code)) = $${params.length}`); }
    if (opts.q) { params.push(`%${opts.q}%`); where.push(`l.title ILIKE $${params.length}`); }
    if (opts.maxAgeHours) { params.push(opts.maxAgeHours); where.push(`l.first_seen_at > NOW() - ($${params.length} || ' hours')::interval`); }
    if (opts.soloSeller) {
      where.push(`kl.seller_item_count IS NOT NULL AND kl.seller_item_count <= 1`);
    }
    if (opts.userId) { params.push(opts.userId); where.push(`k.user_id = $${params.length}`); }
    if (opts.onlyDeals) {
      where.push(`kl.deal_score IS NOT NULL AND kl.deal_score >= ${DEAL_SCORE_THRESHOLD}`);
    }
    where.push(`l.unavailable_at IS NULL`);
    where.push(`(k.min_price IS NULL OR l.price >= k.min_price)`);
    where.push(`(k.max_price IS NULL OR l.price <= k.max_price)`);
    params.push(limit, offset);
    const sql = `
      SELECT * FROM (
        SELECT DISTINCT ON (l.id)
          l.*, kl.matched_at,
          kl.seller_item_count,
          kl.deal_score,
          CASE WHEN pts.item_count >= 5 THEN pts.avg_price ELSE NULL END AS avg_price,
          (kl.deal_score IS NOT NULL AND kl.deal_score >= ${DEAL_SCORE_THRESHOLD}) AS is_deal,
          k.label AS keyword_label, k.id AS keyword_id,
          EXTRACT(EPOCH FROM (NOW() - l.first_seen_at)) / 3600 AS freshness_hours
        FROM keyword_listings kl
        INNER JOIN listings l ON l.id = kl.listing_id
        INNER JOIN keywords k ON k.id = kl.keyword_id
        LEFT JOIN product_type_stats pts ON pts.keyword_id = kl.keyword_id AND pts.product_type_key = l.product_type_key
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY l.id, kl.matched_at DESC
      ) t
      ORDER BY t.first_seen_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    return this.dataSource.query(sql, params);
  }
```

Note : `MIN_RELIABLE_ITEM_COUNT` (valeur 5) est inlinée en dur dans le SQL (`pts.item_count >= 5`) plutôt qu'interpolée depuis la constante, car ce fragment est un littéral SQL statique — garder la même valeur que `MIN_RELIABLE_ITEM_COUNT` dans `deal-score.constants.ts` si elle change un jour.

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `cd backend && npx jest listings.service.spec --no-coverage`
Expected: PASS (tous les tests)

- [ ] **Step 5: Build complet**

Run: `cd backend && npm run build`
Expected: 0 erreur

- [ ] **Step 6: Commit**

```bash
git add backend/src/listings/listings.service.ts backend/src/listings/listings.service.spec.ts
git commit -m "feat(listings): getListings expose avg_price/deal_score/is_deal + filtre onlyDeals"
```

---

### Task 7: Enregistrer les nouveaux providers dans `ListingsModule`

**Files:**
- Modify: `backend/src/listings/listings.module.ts`

**Interfaces:**
- Consumes: `ProductTypeStats` (Task 1), `ProductClassifierService` (Task 3), `ProductTypeStatsService` (Task 4).
- Produces: `ListingsModule` exporte désormais aussi `ProductClassifierService` et `ProductTypeStatsService`, importables par `ScraperModule` (Task 11).

- [ ] **Step 1: Modifier le module**

Replace `backend/src/listings/listings.module.ts` with:
```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Listing } from './listing.entity';
import { KeywordListing } from './keyword-listing.entity';
import { PriceHistory } from './price-history.entity';
import { ProductTypeStats } from './product-type-stats.entity';
import { ListingsService } from './listings.service';
import { ListingsController } from './listings.controller';
import { ProductClassifierService } from './product-classifier.service';
import { ProductTypeStatsService } from './product-type-stats.service';

@Module({
  imports: [TypeOrmModule.forFeature([Listing, KeywordListing, PriceHistory, ProductTypeStats])],
  providers: [ListingsService, ProductClassifierService, ProductTypeStatsService],
  controllers: [ListingsController],
  exports: [ListingsService, ProductClassifierService, ProductTypeStatsService],
})
export class ListingsModule {}
```

- [ ] **Step 2: Vérifier que le backend démarre**

Run: `cd backend && npm run build`
Expected: 0 erreur

- [ ] **Step 3: Commit**

```bash
git add backend/src/listings/listings.module.ts
git commit -m "chore(listings): expose ProductClassifierService/ProductTypeStatsService"
```

---

### Task 8: `DealsGateway` — étendre `ListingEvent` + `emitDealUpdated`

**Files:**
- Modify: `backend/src/notifications/deals.gateway.ts`

**Interfaces:**
- Produces: `ListingEvent` avec `avgPrice: number | null`, `dealScore: number | null`, `isDeal: boolean` ; `DealsGateway.emitDealUpdated(payload: { listingId: number; avgPrice: number | null; dealScore: number | null; isDeal: boolean }): void` — utilisés par `ScraperService` (Tasks 9, 10) et le frontend (Task 12).

- [ ] **Step 1: Modifier `deals.gateway.ts`**

Replace `backend/src/notifications/deals.gateway.ts` with:
```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

export interface ListingEvent {
  listingId: number;
  title: string;
  price: number;
  photoUrl: string | null;
  url: string | null;
  keywordLabel: string;
  vintedCreatedAt: string | null;
  userId: number;
  avgPrice: number | null;
  dealScore: number | null;
  isDeal: boolean;
}

export interface DealUpdatedEvent {
  listingId: number;
  avgPrice: number | null;
  dealScore: number | null;
  isDeal: boolean;
}

@WebSocketGateway({ cors: { origin: '*' } })
export class DealsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(DealsGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client WS connecté : ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client WS déconnecté : ${client.id}`);
  }

  emitNewListing(payload: ListingEvent) {
    this.server.emit('new-listing', payload);
    this.logger.log(`📡 Listing émis WS : "${payload.title}" — ${payload.price}€`);
  }

  /** Classification différée (sweep Mistral) : met à jour une carte déjà affichée. */
  emitDealUpdated(payload: DealUpdatedEvent) {
    this.server.emit('deal-updated', payload);
    this.logger.log(`📡 Deal mis à jour WS : listing ${payload.listingId} — isDeal=${payload.isDeal}`);
  }

  emitKeywordChanged() {
    this.server.emit('keyword-changed');
  }
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd backend && npm run build`
Expected: échoue à ce stade — `scraper.service.ts` construit encore un objet `ListingEvent` sans `avgPrice`/`dealScore`/`isDeal` (Task 9 corrige ça). C'est attendu : ce Task casse temporairement le build, réparé au Task suivant. Ne pas commit tant que Task 9 n'est pas fait — enchaîner directement sur Task 9 avant de committer les deux ensemble.

---

### Task 9: `ScraperService` — classification synchrone + gating des alertes

**Files:**
- Modify: `backend/src/scraper/scraper.service.ts`
- Modify: `backend/src/scraper/scraper.service.spec.ts`

**Interfaces:**
- Consumes: `ProductClassifierService.classifyByRules` (Task 3), `ProductTypeStatsService.recompute`/`.get` (Task 4), `ListingsService.setProductTypeKey`/`.setDealScore` (Task 5), `DEAL_SCORE_THRESHOLD`/`MIN_RELIABLE_ITEM_COUNT` (Task 5), `DealsGateway.emitNewListing` avec le nouveau shape (Task 8).
- Produces: `ScraperService` construit désormais avec deux dépendances supplémentaires (`ProductClassifierService`, `ProductTypeStatsService`) — le constructeur change, impacte tout appelant (Task 11 pour le module).

- [ ] **Step 1: Écrire les tests**

Replace `backend/src/scraper/scraper.service.spec.ts` with (garde les tests existants, ajoute un nouveau describe) :
```typescript
jest.mock('axios-cookiejar-support', () => ({ wrapper: (c: any) => c }));
jest.mock('tough-cookie', () => ({ CookieJar: class {} }));
jest.mock('axios', () => ({ create: () => ({}) }));

import { ScraperService } from './scraper.service';

describe('ScraperService — pause/resume', () => {
  let service: ScraperService;
  let query: jest.Mock;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    const keywordsService: any = { findActive: jest.fn().mockResolvedValue([]) };
    const dataSource: any = { query };
    service = new ScraperService(
      keywordsService,
      {} as any,
      {} as any,
      {} as any,
      dataSource,
      {} as any,
      {} as any,
    );
  });

  it('démarre actif par défaut', () => {
    expect(service.isPaused()).toBe(false);
  });

  it('setPaused(true) met en pause et persiste en base', async () => {
    const res = await service.setPaused(true);
    expect(res).toEqual({ paused: true });
    expect(service.isPaused()).toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE scraper_state SET paused'),
      [true],
    );
  });

  it('setPaused(false) relance et persiste en base', async () => {
    await service.setPaused(true);
    const res = await service.setPaused(false);
    expect(res).toEqual({ paused: false });
    expect(service.isPaused()).toBe(false);
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [false]);
  });

  it('getStatus expose le flag paused', async () => {
    await service.setPaused(true);
    const status = await service.getStatus();
    expect(status.paused).toBe(true);
  });
});

describe('ScraperService — classification & gating des alertes', () => {
  function buildService(overrides: {
    listingsService?: any;
    telegramService?: any;
    dealsGateway?: any;
    productClassifier?: any;
    productTypeStats?: any;
  } = {}) {
    const dataSource: any = { query: jest.fn().mockResolvedValue([]) };
    const keywordsService: any = { findActive: jest.fn().mockResolvedValue([]) };
    const listingsService: any = {
      upsertListing: jest.fn(),
      setProductTypeKey: jest.fn(),
      setDealScore: jest.fn(),
      updateSellerCountry: jest.fn(),
      ...overrides.listingsService,
    };
    const telegramService: any = { sendListingAlert: jest.fn().mockResolvedValue(undefined), ...overrides.telegramService };
    const dealsGateway: any = { emitNewListing: jest.fn(), emitDealUpdated: jest.fn(), ...overrides.dealsGateway };
    const productClassifier: any = { classifyByRules: jest.fn(), classifyWithMistral: jest.fn(), ...overrides.productClassifier };
    const productTypeStats: any = { recompute: jest.fn(), get: jest.fn(), ...overrides.productTypeStats };
    const service = new ScraperService(
      keywordsService, listingsService, telegramService, dealsGateway, dataSource, productClassifier, productTypeStats,
    );
    return { service, listingsService, telegramService, dealsGateway, productClassifier, productTypeStats };
  }

  const categoryKeyword = { id: 7, label: 'Piece info', search_text: '', min_price: null, max_price: null, catalog_id: 3025, country_codes: ['fr'], user_id: 1 };
  const textKeyword = { id: 4, label: 'Ddr4', search_text: 'Ddr4 3200 8gb', min_price: null, max_price: null, catalog_id: null, country_codes: ['fr'], user_id: 1 };
  const item = { vinted_id: 1, title: '16GB DDR4 Kingston', price: 20, url: 'https://vinted.fr/x', photo_url: null, brand: 'Kingston', size_label: null, condition_label: null, seller_name: 's', seller_id: 9, catalog_id: 3025, vinted_created_at: null };
  const listing = { id: 42, title: item.title, price: item.price, url: item.url, photo_url: null, vinted_created_at: null };

  it("alerte inconditionnellement sur un mot-clé avec texte de recherche (comportement inchangé)", async () => {
    const { service, listingsService, telegramService, productClassifier } = buildService({
      listingsService: { upsertListing: jest.fn().mockResolvedValue({ listing, isNew: true, priceChanged: false }) },
    });
    await (service as any).scanAndProcess(textKeyword, [item], 'fr');
    expect(productClassifier.classifyByRules).not.toHaveBeenCalled();
    expect(telegramService.sendListingAlert).toHaveBeenCalled();
  });

  it("mot-clé catégorie-seule, non classifié par les règles → pas d'alerte, avgPrice/dealScore null", async () => {
    const { service, telegramService, dealsGateway, productClassifier } = buildService({
      listingsService: { upsertListing: jest.fn().mockResolvedValue({ listing, isNew: true, priceChanged: false }) },
      productClassifier: { classifyByRules: jest.fn().mockReturnValue(null) },
    });
    await (service as any).scanAndProcess(categoryKeyword, [item], 'fr');
    expect(telegramService.sendListingAlert).not.toHaveBeenCalled();
    expect(dealsGateway.emitNewListing).toHaveBeenCalledWith(
      expect.objectContaining({ avgPrice: null, dealScore: null, isDeal: false }),
    );
  });

  it("mot-clé catégorie-seule, classifié mais groupe pas encore fiable (< 5) → pas d'alerte, avgPrice null", async () => {
    const { service, telegramService, dealsGateway } = buildService({
      listingsService: { upsertListing: jest.fn().mockResolvedValue({ listing, isNew: true, priceChanged: false }) },
      productClassifier: { classifyByRules: jest.fn().mockReturnValue('RAM DDR4 16GB') },
      productTypeStats: { recompute: jest.fn().mockResolvedValue({ avgPrice: 25, itemCount: 3 }) },
    });
    await (service as any).scanAndProcess(categoryKeyword, [item], 'fr');
    expect(telegramService.sendListingAlert).not.toHaveBeenCalled();
    expect(dealsGateway.emitNewListing).toHaveBeenCalledWith(
      expect.objectContaining({ avgPrice: null, dealScore: null, isDeal: false }),
    );
  });

  it("mot-clé catégorie-seule, fiable et deal_score sous le seuil → pas d'alerte, avgPrice renseigné", async () => {
    const { service, telegramService, dealsGateway, listingsService } = buildService({
      listingsService: { upsertListing: jest.fn().mockResolvedValue({ listing, isNew: true, priceChanged: false }) },
      productClassifier: { classifyByRules: jest.fn().mockReturnValue('RAM DDR4 16GB') },
      // avg=21, prix=20 → deal_score = (21-20)/21*100 ≈ 4.76% < seuil 20%
      productTypeStats: { recompute: jest.fn().mockResolvedValue({ avgPrice: 21, itemCount: 6 }) },
    });
    await (service as any).scanAndProcess(categoryKeyword, [item], 'fr');
    expect(telegramService.sendListingAlert).not.toHaveBeenCalled();
    expect(listingsService.setDealScore).toHaveBeenCalledWith(7, 42, expect.closeTo ? undefined : expect.any(Number));
    expect(dealsGateway.emitNewListing).toHaveBeenCalledWith(
      expect.objectContaining({ avgPrice: 21, isDeal: false }),
    );
  });

  it("mot-clé catégorie-seule, fiable et deal_score au-dessus du seuil → alerte + isDeal true", async () => {
    const { service, telegramService, dealsGateway } = buildService({
      listingsService: { upsertListing: jest.fn().mockResolvedValue({ listing, isNew: true, priceChanged: false }) },
      productClassifier: { classifyByRules: jest.fn().mockReturnValue('RAM DDR4 16GB') },
      // avg=30, prix=20 → deal_score = (30-20)/30*100 ≈ 33% >= seuil 20%
      productTypeStats: { recompute: jest.fn().mockResolvedValue({ avgPrice: 30, itemCount: 6 }) },
    });
    await (service as any).scanAndProcess(categoryKeyword, [item], 'fr');
    expect(telegramService.sendListingAlert).toHaveBeenCalled();
    expect(dealsGateway.emitNewListing).toHaveBeenCalledWith(
      expect.objectContaining({ avgPrice: 30, isDeal: true }),
    );
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `cd backend && npx jest scraper.service.spec --no-coverage`
Expected: FAIL — `ScraperService` attend seulement 5 arguments au constructeur, et `scanAndProcess` n'existe pas encore.

- [ ] **Step 3: Extraire `scanKeywordCountry` en `scanAndProcess` testable + intégrer la classification**

In `backend/src/scraper/scraper.service.ts` :

Add imports at the top:
```typescript
import { ProductClassifierService } from '../listings/product-classifier.service';
import { ProductTypeStatsService } from '../listings/product-type-stats.service';
import { DEAL_SCORE_THRESHOLD, MIN_RELIABLE_ITEM_COUNT } from '../listings/deal-score.constants';
```

Add to the constructor parameter list (after `dataSource: DataSource,`):
```typescript
    private readonly productClassifier: ProductClassifierService,
    private readonly productTypeStats: ProductTypeStatsService,
```

Replace the body of `scanKeywordCountry` (from `const items = await client.search(...)` through the closing of the `for (const item of items)` loop) so that it delegates the per-item work to a new `scanAndProcess` method:
```typescript
  private async scanKeywordCountry(keyword: Keyword, countryCode: string): Promise<void> {
    try {
      const client = this.clientPool.getClient(countryCode);
      const items = await client.search(
        keyword.search_text, keyword.min_price, keyword.max_price, 96, 1, keyword.catalog_id,
      );
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
```

Remove the now-redundant inline loop body that used to live directly in `scanKeywordCountry` (it has been moved into `scanAndProcess` above — make sure there is exactly one definition of the per-item loop after this edit).

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `cd backend && npx jest scraper.service.spec --no-coverage`
Expected: PASS (tous les tests — pause/resume + classification & gating)

Note : le test "fiable et deal_score sous le seuil" contient une assertion volontairement permissive sur `setDealScore` (`expect.any(Number)`) — l'important est qu'il soit appelé, la valeur exacte du score est déjà couverte par le calcul manuel dans le test suivant.

- [ ] **Step 5: Build complet (répare aussi le Task 8)**

Run: `cd backend && npm run build`
Expected: 0 erreur — le constructeur `ScraperService` a maintenant 7 paramètres, cohérent avec le `ListingEvent` étendu du Task 8.

- [ ] **Step 6: Commit (Tasks 8 + 9 ensemble)**

```bash
git add backend/src/notifications/deals.gateway.ts backend/src/scraper/scraper.service.ts backend/src/scraper/scraper.service.spec.ts
git commit -m "feat(scraper): classification synchrone + alerte conditionnée au prix moyen"
```

---

### Task 10: Sweep Mistral périodique

**Files:**
- Modify: `backend/src/scraper/scraper.service.ts`
- Modify: `backend/src/scraper/scraper.service.spec.ts`

**Interfaces:**
- Consumes: `ListingsService.getUnclassifiedListings`/`.incrementClassificationAttempts` (Task 5), `ProductClassifierService.classifyWithMistral` (Task 3), `KeywordsService.findOne` (existant), `ListingsService.getListingById` (existant).
- Produces: `ScraperService.enqueueClassificationSweep(): Promise<void>` (méthode privée, testée via un accès `as any` comme le reste des tests scraper).

- [ ] **Step 1: Écrire les tests**

Add to the `describe('ScraperService — classification & gating des alertes', ...)` block in `backend/src/scraper/scraper.service.spec.ts` (or a new sibling describe just after it):
```typescript
describe('ScraperService — sweep Mistral', () => {
  function buildService(overrides: { listingsService?: any; productClassifier?: any; productTypeStats?: any; dealsGateway?: any; telegramService?: any; keywordsService?: any } = {}) {
    const dataSource: any = { query: jest.fn().mockResolvedValue([]) };
    const keywordsService: any = { findActive: jest.fn().mockResolvedValue([]), findOne: jest.fn(), ...overrides.keywordsService };
    const listingsService: any = {
      getUnclassifiedListings: jest.fn().mockResolvedValue([]),
      incrementClassificationAttempts: jest.fn(),
      setProductTypeKey: jest.fn(),
      setDealScore: jest.fn(),
      getListingById: jest.fn(),
      ...overrides.listingsService,
    };
    const telegramService: any = { sendListingAlert: jest.fn().mockResolvedValue(undefined), ...overrides.telegramService };
    const dealsGateway: any = { emitDealUpdated: jest.fn(), ...overrides.dealsGateway };
    const productClassifier: any = { classifyWithMistral: jest.fn(), ...overrides.productClassifier };
    const productTypeStats: any = { recompute: jest.fn(), ...overrides.productTypeStats };
    const service = new ScraperService(
      keywordsService, listingsService, telegramService, dealsGateway, dataSource, productClassifier, productTypeStats,
    );
    return { service, listingsService, telegramService, dealsGateway, productClassifier, productTypeStats, keywordsService };
  }

  const candidate = { id: 42, title: 'Scheda Madre ASUS P8H67-M', price: 25, keywordId: 7 };

  it("titre non reconnu par Mistral → incrémente les tentatives, pas de mise à jour de stats", async () => {
    const { service, listingsService, productClassifier } = buildService({
      listingsService: { getUnclassifiedListings: jest.fn().mockResolvedValue([candidate]) },
      productClassifier: { classifyWithMistral: jest.fn().mockResolvedValue(null) },
    });
    await (service as any).enqueueClassificationSweep();
    expect(listingsService.incrementClassificationAttempts).toHaveBeenCalledWith(42);
    expect(listingsService.setProductTypeKey).not.toHaveBeenCalled();
  });

  it("titre reconnu par Mistral, groupe pas encore fiable → deal-updated avec avgPrice/dealScore null", async () => {
    const { service, listingsService, dealsGateway } = buildService({
      listingsService: { getUnclassifiedListings: jest.fn().mockResolvedValue([candidate]) },
      productClassifier: { classifyWithMistral: jest.fn().mockResolvedValue('Carte mère ATX') },
      productTypeStats: { recompute: jest.fn().mockResolvedValue({ avgPrice: 30, itemCount: 2 }) },
    });
    await (service as any).enqueueClassificationSweep();
    expect(listingsService.setProductTypeKey).toHaveBeenCalledWith(42, 'Carte mère ATX');
    expect(dealsGateway.emitDealUpdated).toHaveBeenCalledWith({ listingId: 42, avgPrice: null, dealScore: null, isDeal: false });
  });

  it("titre reconnu par Mistral, groupe fiable et intéressant → alerte Telegram + deal-updated isDeal=true", async () => {
    const fullListing = { id: 42, title: candidate.title, price: 25, url: 'https://vinted.fr/x', photo_url: null, country_code: 'fr' };
    const keyword = { id: 7, label: 'Piece info', user_id: 1 };
    const { service, telegramService, dealsGateway } = buildService({
      listingsService: {
        getUnclassifiedListings: jest.fn().mockResolvedValue([candidate]),
        getListingById: jest.fn().mockResolvedValue(fullListing),
      },
      keywordsService: { findOne: jest.fn().mockResolvedValue(keyword) },
      productClassifier: { classifyWithMistral: jest.fn().mockResolvedValue('Carte mère ATX') },
      // avg=40, prix=25 → deal_score = (40-25)/40*100 = 37.5% >= seuil 20%
      productTypeStats: { recompute: jest.fn().mockResolvedValue({ avgPrice: 40, itemCount: 6 }) },
    });
    await (service as any).enqueueClassificationSweep();
    expect(telegramService.sendListingAlert).toHaveBeenCalledWith(fullListing, keyword, 'fr');
    expect(dealsGateway.emitDealUpdated).toHaveBeenCalledWith({ listingId: 42, avgPrice: 40, dealScore: 37.5, isDeal: true });
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `cd backend && npx jest scraper.service.spec --no-coverage`
Expected: FAIL — `(service as any).enqueueClassificationSweep is not a function`

- [ ] **Step 3: Implémenter le sweep**

In `backend/src/scraper/scraper.service.ts`, add near the other tick constants at the top of the file:
```typescript
const CLASSIFICATION_TICK_MS = 60_000;      // cadence du sweep Mistral
const CLASSIFICATION_BATCH_SIZE = 20;       // annonces non classées traitées par tick
```

Add near `onModuleInit` (in the `setTimeout` calls block):
```typescript
    setTimeout(() => this.scheduleClassificationTick(), 30_000);
```

Add the new methods (e.g. right after `enqueueAvailabilityChecks`/`processAvailabilityCheck`):
```typescript
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
    const candidates = await this.listingsService.getUnclassifiedListings(CLASSIFICATION_BATCH_SIZE);
    for (const candidate of candidates) {
      await this.classifyWithMistralAndScore(candidate);
    }
  }

  private async classifyWithMistralAndScore(candidate: { id: number; title: string; price: number; keywordId: number }): Promise<void> {
    const key = await this.productClassifier.classifyWithMistral(candidate.title);
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
```

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `cd backend && npx jest scraper.service.spec --no-coverage`
Expected: PASS (tous les tests)

- [ ] **Step 5: Build complet**

Run: `cd backend && npm run build`
Expected: 0 erreur

- [ ] **Step 6: Commit**

```bash
git add backend/src/scraper/scraper.service.ts backend/src/scraper/scraper.service.spec.ts
git commit -m "feat(scraper): sweep Mistral différé pour les titres non reconnus par les règles"
```

---

### Task 11: `ScraperModule` + bootstrap schéma idempotent + config Mistral

**Files:**
- Modify: `backend/src/scraper/scraper.module.ts`
- Modify: `backend/src/scraper/scraper.service.ts`
- Modify: `.env.example`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: `ListingsModule` exporte désormais `ProductClassifierService`/`ProductTypeStatsService` (Task 7).
- Produces: le backend démarre avec les nouvelles colonnes/table créées automatiquement si absentes, et `MISTRAL_API_KEY` disponible via `ConfigService`.

- [ ] **Step 1: Étendre `ensureListingSchema`**

In `backend/src/scraper/scraper.service.ts`, in the `ensureListingSchema` method, add after the existing `ALTER TABLE`/`CREATE INDEX` calls (still inside the `try` block, before the `catch`):
```typescript
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
```

This is idempotent and safe to run alongside the migration/init.sql changes from Task 1 (all `IF NOT EXISTS`) — on a fresh volume `init.sql` already creates everything, on an existing volume this bootstrap patches it without needing the manual migration to be applied first.

- [ ] **Step 2: `.env.example`**

In `.env.example`, add after the `TELEGRAM_CHAT_ID=` line:
```
# Fallback de classification produit (mots-clés catégorie-seule). Optionnel :
# sans clé, seule la classification par règles (RAM/CPU) fonctionne.
MISTRAL_API_KEY=
```

- [ ] **Step 3: `docker-compose.yml`**

In `docker-compose.yml`, in the `api.environment` block, add after `TELEGRAM_CHAT_ID: ${TELEGRAM_CHAT_ID:-}`:
```yaml
      MISTRAL_API_KEY: ${MISTRAL_API_KEY:-}
```

- [ ] **Step 4: Vérifier `ScraperModule`**

`backend/src/scraper/scraper.module.ts` importe déjà `ListingsModule` en entier (`imports: [KeywordsModule, ListingsModule, NotificationsModule]`), donc `ProductClassifierService`/`ProductTypeStatsService` sont automatiquement injectables dans `ScraperService` dès que `ListingsModule` les exporte (fait au Task 7) — aucune modification de `scraper.module.ts` n'est nécessaire. Vérifier simplement que le fichier contient toujours cet import :
```typescript
import { ListingsModule } from '../listings/listings.module';
```

- [ ] **Step 5: Build + tests complets**

Run: `cd backend && npm run build && npm test`
Expected: build 0 erreur, tous les tests passent (y compris ceux des tasks précédentes)

- [ ] **Step 6: Commit**

```bash
git add backend/src/scraper/scraper.service.ts .env.example docker-compose.yml
git commit -m "feat(scraper): bootstrap idempotent du schéma product_type + config Mistral"
```

---

### Task 12: Frontend — types (`listingEvent.ts`, `api.ts`)

**Files:**
- Modify: `frontend/src/lib/listingEvent.ts`
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Produces: `ListingEvent` avec `avgPrice`/`dealScore`/`isDeal` ; `Listing` avec `product_type_key?`/`avg_price?`/`deal_score?`/`is_deal?` ; `api.listings.latest(...)` accepte un paramètre `onlyDeals?: boolean`. Consommé par `DealCard` (Task 14) et `listings/page.tsx` (Task 15).

- [ ] **Step 1: Étendre `ListingEvent`**

Replace `frontend/src/lib/listingEvent.ts` with:
```typescript
export interface ListingEvent {
  listingId: number;
  title: string;
  price: number;
  photoUrl: string | null;
  url: string | null;
  keywordLabel: string;
  vintedCreatedAt: string | null;
  userId: number;
  avgPrice: number | null;
  dealScore: number | null;
  isDeal: boolean;
}

export interface DealUpdatedEvent {
  listingId: number;
  avgPrice: number | null;
  dealScore: number | null;
  isDeal: boolean;
}
```

- [ ] **Step 2: Étendre `Listing`, `LatestListingsParams`, `latestQuery` et `rowToKeywordListing`**

In `frontend/src/lib/api.ts`, in the `Listing` interface, add after `seller_country?: string;`:
```typescript
  /** Type de produit normalisé (règles ou Mistral). Absent/null = pas encore classé. */
  product_type_key?: string | null;
  /** Prix moyen tronqué du groupe, renseigné seulement si le groupe est fiable (≥5 annonces). */
  avg_price?: number | null;
  /** (avg_price - prix)/avg_price*100, calculé au moment de la classification. */
  deal_score?: number | null;
  /** true si deal_score dépasse le seuil "intéressant". */
  is_deal?: boolean;
```

Update `LatestListingsParams` (around line 128) to add `onlyDeals`:
```typescript
export interface LatestListingsParams {
  keywordId?: number;
  limit?: number;
  offset?: number;
  country?: string;
  q?: string;
  maxAgeHours?: number;
  soloSeller?: boolean;
  onlyDeals?: boolean;
  userId?: number;
}
```

Update `rowToKeywordListing` (around line 143) so the flat SQL row's new columns are carried onto the nested `listing` object — add these three lines inside the `listing: { ... }` object, after `seller_country: row.seller_country ?? undefined,`:
```typescript
      avg_price: row.avg_price != null ? parseFloat(String(row.avg_price)) : null,
      deal_score: row.deal_score != null ? parseFloat(String(row.deal_score)) : null,
      is_deal: row.is_deal === true,
```

Update `latestQuery` (around line 170) to send the new param, add after `if (p.soloSeller) qs.set('solo_seller', '1');`:
```typescript
  if (p.onlyDeals) qs.set('only_deals', '1');
```

- [ ] **Step 3: Vérifier les types**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 erreur (les champs sont optionnels, aucun consommateur existant n'est cassé)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/listingEvent.ts frontend/src/lib/api.ts
git commit -m "feat(frontend): types avgPrice/dealScore/isDeal + paramètre onlyDeals"
```

---

### Task 13: Backend — route `/listings` transmet `onlyDeals`

**Files:**
- Modify: `backend/src/listings/listings.controller.ts`

**Interfaces:**
- Consumes: `ListingsService.getListings({ onlyDeals })` (Task 6).
- Produces: la route `GET /listings` accepte `?onlyDeals=true`.

- [ ] **Step 1: Ajouter le paramètre `only_deals` à la route**

Replace the `@Get()` `findAll` method in `backend/src/listings/listings.controller.ts` with:
```typescript
  @Get()
  findAll(
    @Query('keyword_id') keywordId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('country') country?: string,
    @Query('q') q?: string,
    @Query('max_age_hours') maxAgeHours?: string,
    @Query('solo_seller') soloSeller?: string,
    @Query('only_deals') onlyDeals?: string,
    @Query('user_id') userId?: string,
  ) {
    return this.service.getListings({
      keywordId: keywordId ? parseInt(keywordId) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
      country: country || undefined,
      q: q || undefined,
      maxAgeHours: maxAgeHours ? parseInt(maxAgeHours) : undefined,
      soloSeller: soloSeller === '1' || soloSeller === 'true',
      onlyDeals: onlyDeals === '1' || onlyDeals === 'true',
      userId: userId ? Number(userId) : undefined,
    });
  }
```

- [ ] **Step 2: Build**

Run: `cd backend && npm run build`
Expected: 0 erreur

- [ ] **Step 3: Commit**

```bash
git add backend/src/listings/listings.controller.ts
git commit -m "feat(listings): route /listings transmet le paramètre onlyDeals"
```

---

### Task 14: Frontend — `DealCard` affiche le prix moyen et la mise en avant

**Files:**
- Modify: `frontend/src/components/DealCard.tsx`

**Interfaces:**
- Consumes: `listing.avg_price`, `listing.is_deal` (Task 12).

- [ ] **Step 1: Ajouter l'affichage du prix moyen**

In `frontend/src/components/DealCard.tsx`, in the "Pricing" block (currently just `<span className="text-xl font-black text-white">{price?.toFixed(1)}€</span>`), replace it with:
```tsx
          {/* Pricing */}
          <div className="flex items-baseline gap-2 pt-1">
            <span className="text-xl font-black text-white">{price?.toFixed(1)}€</span>
            {listing.avg_price != null && (
              <span className="text-xs text-zinc-500">
                moy. {parseFloat(String(listing.avg_price)).toFixed(1)}€
              </span>
            )}
          </div>
```

- [ ] **Step 2: Ajouter la mise en avant visuelle quand `is_deal`**

In the root `<div>` of the card, the `className` currently branches only on `live`:
```tsx
      className={`group bg-zinc-900/60 border rounded-2xl overflow-hidden hover:shadow-xl transition-all duration-300 hover:scale-[1.01] flex flex-col h-full ${
        live ? 'border-red-500/50 shadow-[0_0_20px_-6px_rgba(244,63,94,0.4)]' : 'border-zinc-800/80 hover:border-zinc-700/80'
      }`}
```
Replace with (adds an `isDeal` branch, `live` keeps priority since it's temporary/rarer):
```tsx
      className={`group bg-zinc-900/60 border rounded-2xl overflow-hidden hover:shadow-xl transition-all duration-300 hover:scale-[1.01] flex flex-col h-full ${
        live
          ? 'border-red-500/50 shadow-[0_0_20px_-6px_rgba(244,63,94,0.4)]'
          : listing.is_deal
            ? 'border-emerald-500/60 shadow-[0_0_20px_-6px_rgba(16,185,129,0.5)] animate-pulse'
            : 'border-zinc-800/80 hover:border-zinc-700/80'
      }`}
```

- [ ] **Step 2b: Petit badge "Bonne affaire" (top-right, quand pas live)**

Just after the existing `{live && (...)}` block (the LIVE badge), add:
```tsx
        {!live && listing.is_deal && (
          <span className="absolute top-2.5 right-2.5 flex items-center gap-1 text-[10px] font-black tracking-wide px-2 py-0.5 rounded-lg bg-emerald-500/90 text-white shadow-lg backdrop-blur-md">
            BONNE AFFAIRE
          </span>
        )}
```

- [ ] **Step 3: Vérifier les types + le build**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 erreur

- [ ] **Step 4: Test manuel visuel**

Run: `cd frontend && npm run dev` (avec `NEXT_PUBLIC_API_URL` pointant vers un backend qui tourne), ouvrir `/listings`, vérifier au moins que la page rend sans erreur (les champs `avg_price`/`is_deal` sont optionnels donc les cartes existantes s'affichent normalement tant que le backend ne les renvoie pas encore en conditions réelles).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DealCard.tsx
git commit -m "feat(frontend): DealCard affiche le prix moyen et la mise en avant des bonnes affaires"
```

---

### Task 15: Frontend — toggle "Bonnes affaires uniquement" + `deal-updated`

**Files:**
- Modify: `frontend/src/lib/useListingsSocket.ts`
- Modify: `frontend/src/app/listings/page.tsx`

**Interfaces:**
- Consumes: `DealUpdatedEvent` (Task 12), `onlyDeals` sur `api.listings.latest` (Task 12).

- [ ] **Step 1: Étendre `useListingsSocket` pour le nouvel event**

Replace `frontend/src/lib/useListingsSocket.ts` with:
```typescript
'use client';
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { ListingEvent, DealUpdatedEvent } from './listingEvent';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Hook qui se connecte au WebSocket backend et appelle onListing()
 * chaque fois qu'une nouvelle annonce est scrapée par le scraper, et
 * onDealUpdated() quand une classification différée (sweep Mistral) met
 * à jour le prix moyen/deal_score d'une annonce déjà affichée.
 */
export function useListingsSocket(
  onListing: (listing: ListingEvent) => void,
  onDealUpdated?: (update: DealUpdatedEvent) => void,
) {
  const socketRef = useRef<Socket | null>(null);
  const callbackRef = useRef(onListing);
  callbackRef.current = onListing;
  const dealUpdatedRef = useRef(onDealUpdated);
  dealUpdatedRef.current = onDealUpdated;

  useEffect(() => {
    const socket = io(API_URL, {
      transports: ['websocket'],
      reconnectionDelay: 2000,
      reconnectionAttempts: Infinity,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[VinBot WS] Connecté au serveur de listings');
    });

    socket.on('new-listing', (listing: ListingEvent) => {
      callbackRef.current(listing);
    });

    socket.on('deal-updated', (update: DealUpdatedEvent) => {
      dealUpdatedRef.current?.(update);
    });

    socket.on('disconnect', () => {
      console.log('[VinBot WS] Déconnecté');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return socketRef;
}
```

- [ ] **Step 2: Ajouter le toggle et le state `onlyDeals` dans `listings/page.tsx`**

In `frontend/src/app/listings/page.tsx`:

Add `onlyDeals` to `StoredFilters`:
```typescript
interface StoredFilters {
  selectedKw?: number;
  country?: string;
  search?: string;
  maxAgeHours?: number;
  soloSeller?: boolean;
  onlyDeals?: boolean;
}
```

Add state right after `soloSeller`:
```typescript
  const [onlyDeals, setOnlyDeals] = useState(initialFilters.current.onlyDeals ?? false);
```

Update `activeFilterCount`:
```typescript
  const activeFilterCount =
    [selectedKw != null, !!country, !!search, maxAgeHours != null, soloSeller, onlyDeals].filter(Boolean).length;
```

Update the persisted-filters effect:
```typescript
  useEffect(() => {
    const filters: StoredFilters = { selectedKw, country, search, maxAgeHours, soloSeller, onlyDeals };
    window.localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  }, [selectedKw, country, search, maxAgeHours, soloSeller, onlyDeals]);
```

Update `baseParams`:
```typescript
  const baseParams = useCallback(() => ({
    keywordId: selectedKw,
    country: country || undefined,
    q: debouncedSearch || undefined,
    maxAgeHours,
    soloSeller: soloSeller || undefined,
    onlyDeals: onlyDeals || undefined,
    userId: activeUserId ?? undefined,
    limit: PAGE_SIZE,
  }), [selectedKw, country, debouncedSearch, maxAgeHours, soloSeller, onlyDeals, activeUserId]);
```

Update `matchesFilters` (live WS injection) to also respect the toggle:
```typescript
  const matchesFilters = useCallback((ev: ListingEvent): boolean => {
    if (activeUserId != null && ev.userId !== activeUserId) return false;
    if (country || soloSeller) return false;
    if (onlyDeals && !ev.isDeal) return false;
    if (selectedKw != null) {
      const kw = keywords.find(k => k.id === selectedKw);
      if (kw && kw.label !== ev.keywordLabel) return false;
    }
    if (debouncedSearch && !(ev.title ?? '').toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    if (maxAgeHours != null) {
      const ref = ev.vintedCreatedAt ?? new Date().toISOString();
      const ageH = (Date.now() - new Date(ref).getTime()) / 3_600_000;
      if (ageH > maxAgeHours) return false;
    }
    return true;
  }, [activeUserId, country, soloSeller, onlyDeals, selectedKw, keywords, debouncedSearch, maxAgeHours]);
```

Update `eventToKeywordListing` to carry the new fields through onto the synthetic `Listing`:
```typescript
function eventToKeywordListing(ev: ListingEvent): KeywordListing {
  const now = new Date().toISOString();
  return {
    keyword_id: -1,
    listing_id: ev.listingId,
    matched_at: now,
    keyword: { label: ev.keywordLabel } as Keyword,
    listing: {
      id: ev.listingId,
      vinted_id: 0,
      title: ev.title,
      price: ev.price,
      url: ev.url,
      photo_url: ev.photoUrl,
      brand: null,
      size_label: null,
      condition_label: null,
      seller_name: null,
      first_seen_at: now,
      last_seen_at: now,
      vinted_created_at: ev.vintedCreatedAt,
      avg_price: ev.avgPrice,
      deal_score: ev.dealScore,
      is_deal: ev.isDeal,
    } as Listing,
  };
}
```

Add a handler for `deal-updated` that patches an already-rendered item in place, and wire it into `useListingsSocket`:
```typescript
  const handleDealUpdated = useCallback((update: DealUpdatedEvent) => {
    setItems(prev => prev.map(kl =>
      kl.listing.id === update.listingId
        ? { ...kl, listing: { ...kl.listing, avg_price: update.avgPrice, deal_score: update.dealScore, is_deal: update.isDeal } }
        : kl,
    ));
  }, []);

  const socketRef = useListingsSocket(handleNewListing, handleDealUpdated);
```
(remplace la ligne existante `const socketRef = useListingsSocket(handleNewListing);`)

Add the `DealUpdatedEvent` import next to the existing `ListingEvent` import:
```typescript
import { ListingEvent, DealUpdatedEvent } from '@/lib/listingEvent';
```

Add the toggle button in the filters bar, right after the "Solo seller toggle" block:
```tsx
        {/* Only deals toggle */}
        <div className="w-full sm:w-auto flex items-end">
          <button
            onClick={() => setOnlyDeals(v => !v)}
            className={`w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
              onlyDeals
                ? 'bg-emerald-500/10 border-emerald-500 text-emerald-300'
                : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
            }`}
          >
            Bonnes affaires uniquement
          </button>
        </div>
```

- [ ] **Step 3: Vérifier les types**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 erreur

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: build réussi

- [ ] **Step 5: Test manuel**

Run: `cd frontend && npm run dev`, ouvrir `/listings`, vérifier que le bouton "Bonnes affaires uniquement" bascule visuellement et persiste au reload (localStorage), et que la page ne plante pas même sans backend connecté (juste "Hors ligne").

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/useListingsSocket.ts frontend/src/app/listings/page.tsx
git commit -m "feat(frontend): toggle bonnes affaires + mise à jour live via deal-updated"
```

---

## Vérification finale (après toutes les tasks)

- [ ] `cd backend && npm run build && npm test` → 0 erreur, tous les tests passent.
- [ ] `cd frontend && npx tsc --noEmit && npm run build` → 0 erreur.
- [ ] Sur la VM (`ssh -p 50022 freebox@88.165.36.69`), appliquer la migration puis redéployer :
  ```bash
  docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" < db/migrations/009_add_product_type_matching.sql
  docker compose up --build -d
  ```
  (Le bootstrap idempotent du Task 11 rend en fait cette étape manuelle optionnelle — le backend patchera le schéma tout seul au démarrage — mais l'exécuter explicitement documente le changement, cohérent avec les migrations précédentes.)
- [ ] Vérifier en conditions réelles : une nouvelle annonce "Piece info" reconnue par les règles (RAM ou CPU) affiche son prix moyen sur la carte une fois son groupe fiable (≥5 annonces), le toggle "Bonnes affaires uniquement" filtre bien, et une alerte Telegram part uniquement au-dessus du seuil de 20%.
