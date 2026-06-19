# Mistral Deal Intelligence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace brute-force price scoring with a 2-pass Mistral pipeline: extract the exact model from every new listing title, compute per-model market averages, then run a legitimacy + deal analysis on candidates — surfacing only AI-confirmed deals in a new `/validated` dashboard page.

**Architecture:** Two scraper tiers (30 s fast scan / 10 min market scan) feed an in-memory `AsyncQueue`. Pass 1 (all new items) extracts `model_label` via Mistral and updates `model_market_avg`. Pass 2 (profit candidates only) scores legitimacy and stores a `DealAnalysis` row linked from `keyword_listings.analysis_id`.

**Tech Stack:** NestJS 11, TypeORM 0.3, PostgreSQL 16, axios (Mistral REST), Next.js 16, Tailwind 4, Lucide React.

---

## File Map

**Create:**
- `backend/src/analysis/async-queue.ts`
- `backend/src/analysis/mistral.service.ts`
- `backend/src/analysis/deal-analysis.entity.ts`
- `backend/src/analysis/model-market-avg.entity.ts`
- `backend/src/analysis/analysis.module.ts`
- `backend/src/analysis/analysis.controller.ts`
- `frontend/src/app/validated/page.tsx`

**Modify:**
- `db/init.sql` — new tables + ALTER statements
- `backend/src/listings/listing.entity.ts` — add `model_label`, `model_confidence`
- `backend/src/keywords/keyword.entity.ts` — add `market_scan_pages`
- `backend/src/listings/keyword-listing.entity.ts` — add `model_market_avg`, `analysis_id`
- `backend/src/listings/listings.service.ts` — updated `computeMarketAvg`, new `updateModelMarketAvg`, `getValidated`, `rescoreWithModel`, updated `upsertListing` return type
- `backend/src/listings/listings.module.ts` — register new entities
- `backend/src/listings/listings.controller.ts` — add `GET /validated`
- `backend/src/scraper/scraper.service.ts` — `fastTick` + `marketTick`, wire queues
- `backend/src/scraper/scraper.module.ts` — import `AnalysisModule`
- `backend/src/app.module.ts` — register new entities
- `backend/.env.example` — add `MISTRAL_API_KEY`
- `docker-compose.yml` — add `MISTRAL_API_KEY` env
- `frontend/src/lib/api.ts` — new types + `validated` endpoint + `mistral.test`
- `frontend/src/components/DealCard.tsx` — model badge, freshness badge, AI confidence
- `frontend/src/components/Sidebar.tsx` — add `/validated` link
- `frontend/src/app/listings/[id]/page.tsx` — AI analysis block
- `frontend/src/app/settings/page.tsx` — Mistral panel

---

## Task 1: DB Schema

**Files:**
- Modify: `db/init.sql`

- [ ] **Step 1: Append new DDL to `db/init.sql`**

Add at the end of the file:

```sql
-- ── Mistral Deal Intelligence ─────────────────────────────────────────────

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS model_label VARCHAR(200),
  ADD COLUMN IF NOT EXISTS model_confidence DECIMAL(3,2);

ALTER TABLE keywords
  ADD COLUMN IF NOT EXISTS market_scan_pages INTEGER DEFAULT 5;

CREATE TABLE IF NOT EXISTS deal_analyses (
  id             SERIAL PRIMARY KEY,
  listing_id     INTEGER REFERENCES listings(id) ON DELETE CASCADE,
  keyword_id     INTEGER REFERENCES keywords(id) ON DELETE SET NULL,
  scam_risk      VARCHAR(10) NOT NULL,
  confidence     DECIMAL(3,2),
  recommendation VARCHAR(10) NOT NULL,
  reasoning      TEXT,
  analyzed_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_market_avg (
  keyword_id   INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  model_label  VARCHAR(200) NOT NULL,
  avg_price    DECIMAL(10,2),
  item_count   INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (keyword_id, model_label)
);

ALTER TABLE keyword_listings
  ADD COLUMN IF NOT EXISTS model_market_avg DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS analysis_id INTEGER REFERENCES deal_analyses(id);

CREATE INDEX IF NOT EXISTS idx_da_listing ON deal_analyses(listing_id);
CREATE INDEX IF NOT EXISTS idx_da_recommendation ON deal_analyses(recommendation, scam_risk);
CREATE INDEX IF NOT EXISTS idx_mma_keyword ON model_market_avg(keyword_id);
```

- [ ] **Step 2: Apply to running DB on server**

```bash
ssh -p 50022 freebox@88.165.36.69 "docker exec -i vinbot-db-1 psql -U postgres -d vinbot" < db/init.sql
```

Expected: commands ending in `ALTER TABLE`, `CREATE TABLE`, `CREATE INDEX` — no errors.

- [ ] **Step 3: Verify schema**

```bash
ssh -p 50022 freebox@88.165.36.69 "docker exec vinbot-db-1 psql -U postgres -d vinbot -c '\d listings' -c '\d keyword_listings' -c '\dt deal_analyses' -c '\dt model_market_avg'"
```

Expected: `model_label`, `model_confidence` on listings; `model_market_avg`, `analysis_id` on keyword_listings; both new tables listed.

- [ ] **Step 4: Commit**

```bash
git add db/init.sql
git commit -m "feat(db): add model_label, deal_analyses, model_market_avg schema"
```

---

## Task 2: New TypeORM Entities

**Files:**
- Create: `backend/src/analysis/deal-analysis.entity.ts`
- Create: `backend/src/analysis/model-market-avg.entity.ts`

- [ ] **Step 1: Create `deal-analysis.entity.ts`**

```typescript
// backend/src/analysis/deal-analysis.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('deal_analyses')
export class DealAnalysis {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: true })
  listing_id: number | null;

  @Column({ type: 'int', nullable: true })
  keyword_id: number | null;

  @Column({ type: 'varchar', length: 10 })
  scam_risk: string;

  @Column({ type: 'decimal', precision: 3, scale: 2, nullable: true })
  confidence: number | null;

  @Column({ type: 'varchar', length: 10 })
  recommendation: string;

  @Column({ type: 'text', nullable: true })
  reasoning: string | null;

  @CreateDateColumn()
  analyzed_at: Date;
}
```

- [ ] **Step 2: Create `model-market-avg.entity.ts`**

```typescript
// backend/src/analysis/model-market-avg.entity.ts
import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('model_market_avg')
export class ModelMarketAvg {
  @PrimaryColumn()
  keyword_id: number;

  @PrimaryColumn({ length: 200 })
  model_label: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  avg_price: number | null;

  @Column({ default: 0 })
  item_count: number;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  last_updated: Date;
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/analysis/
git commit -m "feat(analysis): add DealAnalysis and ModelMarketAvg entities"
```

---

## Task 3: AsyncQueue

**Files:**
- Create: `backend/src/analysis/async-queue.ts`
- Test: `backend/src/analysis/async-queue.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/analysis/async-queue.spec.ts
import { AsyncQueue } from './async-queue';

describe('AsyncQueue', () => {
  it('processes all items', async () => {
    const results: number[] = [];
    const q = new AsyncQueue<number>(async (n) => { results.push(n); }, 2, 100);
    await Promise.all([q.push(1), q.push(2), q.push(3)]);
    expect(results.sort()).toEqual([1, 2, 3]);
  });

  it('respects concurrency limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const q = new AsyncQueue<number>(async (_n) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(r => setTimeout(r, 20));
      concurrent--;
    }, 2, 100);
    await Promise.all([q.push(1), q.push(2), q.push(3), q.push(4)]);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('getStats returns correct counts', async () => {
    const q = new AsyncQueue<number>(async (_n) => {}, 1, 100);
    await q.push(1);
    await q.push(2);
    const stats = q.getStats();
    expect(stats.completed).toBe(2);
    expect(stats.pending).toBe(0);
    expect(stats.errors).toBe(0);
  });

  it('counts errors without throwing', async () => {
    const q = new AsyncQueue<number>(async (_n) => { throw new Error('fail'); }, 1, 100);
    await expect(q.push(1)).rejects.toThrow('fail');
    expect(q.getStats().errors).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest async-queue --no-coverage 2>&1 | tail -20
```

Expected: `FAIL` — `Cannot find module './async-queue'`

- [ ] **Step 3: Implement `async-queue.ts`**

```typescript
// backend/src/analysis/async-queue.ts
export interface QueueStats {
  pending: number;
  running: number;
  completed: number;
  errors: number;
  callsPerMinute: number;
}

export class AsyncQueue<T> {
  private queue: Array<{ item: T; resolve: () => void; reject: (e: Error) => void }> = [];
  private running = 0;
  private completed = 0;
  private errors = 0;
  private callTimestamps: number[] = [];

  constructor(
    private readonly handler: (item: T) => Promise<void>,
    private readonly concurrency: number = 1,
    private readonly ratePerSecond: number = 5,
  ) {}

  push(item: T): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ item, resolve, reject });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running >= this.concurrency || this.queue.length === 0) return;

    const now = Date.now();
    this.callTimestamps = this.callTimestamps.filter(t => now - t < 1000);
    if (this.callTimestamps.length >= this.ratePerSecond) {
      const waitMs = 1000 - (now - this.callTimestamps[0]) + 1;
      setTimeout(() => void this.drain(), waitMs);
      return;
    }

    const next = this.queue.shift();
    if (!next) return;

    this.running++;
    this.callTimestamps.push(Date.now());

    try {
      await this.handler(next.item);
      this.completed++;
      next.resolve();
    } catch (e: any) {
      this.errors++;
      next.reject(e);
    } finally {
      this.running--;
      void this.drain();
    }
  }

  getStats(): QueueStats {
    const now = Date.now();
    const callsPerMinute = this.callTimestamps.filter(t => now - t < 60_000).length;
    return {
      pending: this.queue.length,
      running: this.running,
      completed: this.completed,
      errors: this.errors,
      callsPerMinute,
    };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && npx jest async-queue --no-coverage 2>&1 | tail -10
```

Expected: `PASS` — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add backend/src/analysis/async-queue.ts backend/src/analysis/async-queue.spec.ts
git commit -m "feat(analysis): add AsyncQueue with concurrency and rate limiting"
```

---

## Task 4: MistralService

**Files:**
- Create: `backend/src/analysis/mistral.service.ts`
- Test: `backend/src/analysis/mistral.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/analysis/mistral.service.spec.ts
import { MistralService } from './mistral.service';
import { ConfigService } from '@nestjs/config';

function makeService(key?: string): MistralService {
  const cfg = { get: jest.fn().mockReturnValue(key) } as unknown as ConfigService;
  const svc = new MistralService(cfg);
  svc.onModuleInit();
  return svc;
}

describe('MistralService', () => {
  describe('when API key is absent', () => {
    it('is disabled', () => {
      const svc = makeService(undefined);
      expect(svc.isEnabled()).toBe(false);
    });

    it('extractModel returns null model_label', async () => {
      const svc = makeService(undefined);
      const result = await svc.extractModel('Intel Core i7-12700K', 150);
      expect(result).toEqual({ model_label: null, confidence: 0 });
    });

    it('analyzeDeal returns null', async () => {
      const svc = makeService(undefined);
      const result = await svc.analyzeDeal({} as any, {} as any, 100, 5);
      expect(result).toBeNull();
    });
  });

  describe('parseExtractResponse', () => {
    it('parses valid JSON correctly', () => {
      const svc = makeService(undefined);
      // access private via cast
      const result = (svc as any).parseExtractResponse(
        JSON.stringify({ model_label: 'Intel Core i7-12700K', confidence: 0.95 })
      );
      expect(result).toEqual({ model_label: 'Intel Core i7-12700K', confidence: 0.95 });
    });

    it('handles null model_label', () => {
      const svc = makeService(undefined);
      const result = (svc as any).parseExtractResponse(
        JSON.stringify({ model_label: null, confidence: 0 })
      );
      expect(result).toEqual({ model_label: null, confidence: 0 });
    });

    it('returns null on invalid JSON', () => {
      const svc = makeService(undefined);
      const result = (svc as any).parseExtractResponse('not json');
      expect(result).toEqual({ model_label: null, confidence: 0 });
    });
  });

  describe('parseAnalysisResponse', () => {
    it('parses valid analysis JSON', () => {
      const svc = makeService(undefined);
      const json = JSON.stringify({
        scam_risk: 'low', confidence: 0.9, recommendation: 'buy',
        reasoning: 'Prix attractif pour ce modèle.',
      });
      const result = (svc as any).parseAnalysisResponse(json);
      expect(result.recommendation).toBe('buy');
      expect(result.scam_risk).toBe('low');
    });

    it('sanitizes unknown recommendation to skip', () => {
      const svc = makeService(undefined);
      const json = JSON.stringify({
        scam_risk: 'low', confidence: 0.5, recommendation: 'maybe',
        reasoning: 'Incertain.',
      });
      const result = (svc as any).parseAnalysisResponse(json);
      expect(result.recommendation).toBe('skip');
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd backend && npx jest mistral.service --no-coverage 2>&1 | tail -15
```

Expected: `FAIL` — `Cannot find module './mistral.service'`

- [ ] **Step 3: Implement `mistral.service.ts`**

```typescript
// backend/src/analysis/mistral.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { Listing } from '../listings/listing.entity';
import { Keyword } from '../keywords/keyword.entity';

export interface ModelExtraction {
  model_label: string | null;
  confidence: number;
}

export interface DealAnalysisResult {
  scam_risk: 'low' | 'medium' | 'high';
  confidence: number;
  recommendation: 'buy' | 'watch' | 'skip';
  reasoning: string;
}

@Injectable()
export class MistralService implements OnModuleInit {
  private readonly logger = new Logger(MistralService.name);
  private client: AxiosInstance | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const key = this.config.get<string>('MISTRAL_API_KEY');
    if (!key) {
      this.logger.warn('MISTRAL_API_KEY non défini — analyse IA désactivée (mode no-op)');
      return;
    }
    this.client = axios.create({
      baseURL: 'https://api.mistral.ai/v1',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      timeout: 8000,
    });
    this.logger.log('MistralService initialisé');
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async extractModel(title: string, price: number): Promise<ModelExtraction> {
    if (!this.client) return { model_label: null, confidence: 0 };
    try {
      const prompt =
        `Extrait le modèle exact de cet article Vinted en quelques mots normalisés.\n` +
        `Titre: "${title}"\nPrix: ${price}€\n\n` +
        `Réponds uniquement en JSON:\n` +
        `{"model_label": "modèle normalisé (ex: Intel Core i7-12700K, RTX 3080 10GB)", "confidence": 0.0-1.0}\n` +
        `Si le titre est trop vague pour identifier un modèle précis, renvoie {"model_label": null, "confidence": 0.0}`;
      const res = await this.client.post('/chat/completions', {
        model: 'mistral-small-latest',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 100,
      });
      return this.parseExtractResponse(res.data.choices[0].message.content);
    } catch (err: any) {
      this.logger.warn(`extractModel failed: ${err.message}`);
      return { model_label: null, confidence: 0 };
    }
  }

  async analyzeDeal(
    listing: Listing,
    keyword: Keyword,
    marketAvg: number,
    itemCount: number,
  ): Promise<DealAnalysisResult | null> {
    if (!this.client) return null;
    try {
      const price = parseFloat(String(listing.price ?? 0));
      const shippingEst = parseFloat(String(keyword.shipping_estimate)) || 4;
      const potentialProfit = marketAvg - price - shippingEst;
      const prompt =
        `Analyse cette annonce Vinted pour un acheteur-revendeur.\n` +
        `Titre: "${listing.title}"\n` +
        `Modèle identifié: ${listing.model_label ?? 'inconnu'}\n` +
        `Prix demandé: ${price}€\nÉtat: ${listing.condition_label ?? 'non renseigné'}\n` +
        `Vendeur: ${listing.seller_name ?? 'inconnu'}\n` +
        `Moyenne marché pour "${listing.model_label ?? listing.title}": ${marketAvg.toFixed(2)}€ (sur ${itemCount} annonces)\n` +
        `Profit potentiel estimé: ${potentialProfit.toFixed(2)}€\n\n` +
        `Réponds uniquement en JSON:\n` +
        `{"scam_risk":"low|medium|high","confidence":0.0-1.0,"recommendation":"buy|watch|skip","reasoning":"2-3 phrases en français"}`;
      const res = await this.client.post('/chat/completions', {
        model: 'mistral-small-latest',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 300,
      });
      return this.parseAnalysisResponse(res.data.choices[0].message.content);
    } catch (err: any) {
      if (err.response?.status === 429) {
        this.logger.warn('Mistral rate limit (429) — retry dans 10s');
        await new Promise(r => setTimeout(r, 10_000));
        return this.analyzeDeal(listing, keyword, marketAvg, itemCount);
      }
      this.logger.warn(`analyzeDeal failed: ${err.message}`);
      return null;
    }
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.client) return { ok: false, error: 'MISTRAL_API_KEY non configuré' };
    try {
      await this.client.get('/models');
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  private parseExtractResponse(content: string): ModelExtraction {
    try {
      const parsed = JSON.parse(content);
      return {
        model_label: parsed.model_label ?? null,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      };
    } catch {
      return { model_label: null, confidence: 0 };
    }
  }

  private parseAnalysisResponse(content: string): DealAnalysisResult {
    try {
      const parsed = JSON.parse(content);
      const scamRisk = ['low', 'medium', 'high'].includes(parsed.scam_risk)
        ? (parsed.scam_risk as 'low' | 'medium' | 'high')
        : 'low';
      const recommendation = ['buy', 'watch', 'skip'].includes(parsed.recommendation)
        ? (parsed.recommendation as 'buy' | 'watch' | 'skip')
        : 'skip';
      return {
        scam_risk: scamRisk,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        recommendation,
        reasoning: parsed.reasoning ?? '',
      };
    } catch {
      return { scam_risk: 'low', confidence: 0, recommendation: 'skip', reasoning: '' };
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && npx jest mistral.service --no-coverage 2>&1 | tail -10
```

Expected: `PASS` — 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add backend/src/analysis/mistral.service.ts backend/src/analysis/mistral.service.spec.ts
git commit -m "feat(analysis): add MistralService with 2-pass pipeline and no-op fallback"
```

---

## Task 5: AnalysisModule + AnalysisController + AppModule

**Files:**
- Create: `backend/src/analysis/analysis.module.ts`
- Create: `backend/src/analysis/analysis.controller.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create `analysis.controller.ts`**

```typescript
// backend/src/analysis/analysis.controller.ts
import { Controller, Post } from '@nestjs/common';
import { MistralService } from './mistral.service';

@Controller('mistral')
export class AnalysisController {
  constructor(private readonly mistral: MistralService) {}

  @Post('test')
  test() {
    return this.mistral.testConnection();
  }
}
```

- [ ] **Step 2: Create `analysis.module.ts`**

```typescript
// backend/src/analysis/analysis.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DealAnalysis } from './deal-analysis.entity';
import { ModelMarketAvg } from './model-market-avg.entity';
import { MistralService } from './mistral.service';
import { AnalysisController } from './analysis.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DealAnalysis, ModelMarketAvg])],
  providers: [MistralService],
  controllers: [AnalysisController],
  exports: [MistralService, TypeOrmModule],
})
export class AnalysisModule {}
```

- [ ] **Step 3: Register new entities in `app.module.ts`**

In `app.module.ts`, add the imports and update the `entities` array:

```typescript
import { AnalysisModule } from './analysis/analysis.module';
import { DealAnalysis } from './analysis/deal-analysis.entity';
import { ModelMarketAvg } from './analysis/model-market-avg.entity';
```

Update the `entities` array inside `TypeOrmModule.forRootAsync`:
```typescript
entities: [Keyword, Listing, KeywordListing, PriceHistory, NotificationLog, DealAnalysis, ModelMarketAvg],
```

Add `AnalysisModule` to the `imports` array of `AppModule`:
```typescript
imports: [
  ConfigModule.forRoot({ isGlobal: true }),
  TypeOrmModule.forRootAsync({ ... }),
  KeywordsModule,
  ListingsModule,
  ScraperModule,
  NotificationsModule,
  AnalysisModule,
],
```

- [ ] **Step 4: Verify it compiles**

```bash
cd backend && npm run build 2>&1 | tail -10
```

Expected: `Successfully compiled` with no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/analysis/ backend/src/app.module.ts
git commit -m "feat(analysis): add AnalysisModule, AnalysisController, wire into AppModule"
```

---

## Task 6: Update Existing Entities

**Files:**
- Modify: `backend/src/listings/listing.entity.ts`
- Modify: `backend/src/keywords/keyword.entity.ts`
- Modify: `backend/src/listings/keyword-listing.entity.ts`

- [ ] **Step 1: Add `model_label` and `model_confidence` to `Listing`**

In `listing.entity.ts`, add after `seller_id`:

```typescript
  @Column({ type: 'varchar', length: 200, nullable: true })
  model_label: string | null;

  @Column({ type: 'decimal', precision: 3, scale: 2, nullable: true })
  model_confidence: number | null;
```

- [ ] **Step 2: Add `market_scan_pages` to `Keyword`**

In `keyword.entity.ts`, add after `scan_interval_seconds`:

```typescript
  @Column({ default: 5 })
  market_scan_pages: number;
```

- [ ] **Step 3: Add `model_market_avg` and `analysis_id` to `KeywordListing`**

In `keyword-listing.entity.ts`, add after `potential_profit`:

```typescript
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  model_market_avg: number | null;

  @Column({ type: 'int', nullable: true })
  analysis_id: number | null;
```

- [ ] **Step 4: Verify it compiles**

```bash
cd backend && npm run build 2>&1 | tail -5
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/listings/listing.entity.ts backend/src/keywords/keyword.entity.ts backend/src/listings/keyword-listing.entity.ts
git commit -m "feat(entities): add model_label, market_scan_pages, analysis_id columns"
```

---

## Task 7: ListingsService — model market avg + computeMarketAvg update

**Files:**
- Modify: `backend/src/listings/listings.service.ts`
- Modify: `backend/src/listings/listings.module.ts`
- Test: `backend/src/listings/listings.service.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// backend/src/listings/listings.service.spec.ts
import { ListingsService } from './listings.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Listing } from './listing.entity';
import { KeywordListing } from './keyword-listing.entity';
import { PriceHistory } from './price-history.entity';
import { ModelMarketAvg } from '../analysis/model-market-avg.entity';
import { DealAnalysis } from '../analysis/deal-analysis.entity';
import { DataSource } from 'typeorm';

function mockRepo<T>(overrides: Partial<T> = {}): T {
  return {
    findOneBy: jest.fn(),
    save: jest.fn(),
    upsert: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue({
      innerJoin: jest.fn().mockReturnThis(),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
      getMany: jest.fn().mockResolvedValue([]),
    }),
    ...overrides,
  } as unknown as T;
}

async function buildService(modelAvgOverrides = {}) {
  const modelAvgRepo = mockRepo<any>(modelAvgOverrides);
  const module = await Test.createTestingModule({
    providers: [
      ListingsService,
      { provide: getRepositoryToken(Listing), useValue: mockRepo() },
      { provide: getRepositoryToken(KeywordListing), useValue: mockRepo() },
      { provide: getRepositoryToken(PriceHistory), useValue: mockRepo() },
      { provide: getRepositoryToken(ModelMarketAvg), useValue: modelAvgRepo },
      { provide: getRepositoryToken(DealAnalysis), useValue: mockRepo() },
      { provide: DataSource, useValue: { query: jest.fn() } },
    ],
  }).compile();
  return { svc: module.get(ListingsService), modelAvgRepo };
}

describe('ListingsService', () => {
  describe('updateModelMarketAvg', () => {
    it('creates a new record when none exists', async () => {
      const { svc, modelAvgRepo } = await buildService({
        findOneBy: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockResolvedValue({}),
      });
      await svc.updateModelMarketAvg(1, 'Intel Core i7-12700K', 150);
      expect(modelAvgRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ keyword_id: 1, model_label: 'Intel Core i7-12700K', avg_price: 150, item_count: 1 })
      );
    });

    it('computes incremental moving average on update', async () => {
      const { svc, modelAvgRepo } = await buildService({
        findOneBy: jest.fn().mockResolvedValue({ avg_price: '100.00', item_count: 2 }),
        save: jest.fn().mockResolvedValue({}),
      });
      await svc.updateModelMarketAvg(1, 'Intel Core i7-12700K', 160);
      // (100 * 2 + 160) / 3 = 120
      const saved = (modelAvgRepo.save as jest.Mock).mock.calls[0][0];
      expect(parseFloat(saved.avg_price)).toBeCloseTo(120, 1);
      expect(saved.item_count).toBe(3);
    });
  });

  describe('computeMarketAvg', () => {
    it('uses model_market_avg when item_count >= 3', async () => {
      const { svc } = await buildService({
        findOneBy: jest.fn().mockResolvedValue({ avg_price: '200.00', item_count: 5 }),
      });
      const result = await svc.computeMarketAvg(1, 'Intel Core i7-12700K');
      expect(result.avg).toBeCloseTo(200, 1);
      expect(result.source).toBe('model');
      expect(result.itemCount).toBe(5);
    });

    it('falls back to keyword avg when item_count < 3', async () => {
      const { svc } = await buildService({
        findOneBy: jest.fn().mockResolvedValue({ avg_price: '200.00', item_count: 2 }),
      });
      // fallback uses listingRepo.createQueryBuilder — already mocked to return []
      const result = await svc.computeMarketAvg(1, 'Intel Core i7-12700K');
      expect(result.source).toBe('keyword');
    });

    it('falls back when model_label is null', async () => {
      const { svc } = await buildService({
        findOneBy: jest.fn().mockResolvedValue(null),
      });
      const result = await svc.computeMarketAvg(1, null);
      expect(result.source).toBe('keyword');
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd backend && npx jest listings.service.spec --no-coverage 2>&1 | tail -15
```

Expected: `FAIL` — module/method not found errors.

- [ ] **Step 3: Update `ListingsModule` to include new repos**

```typescript
// backend/src/listings/listings.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Listing } from './listing.entity';
import { KeywordListing } from './keyword-listing.entity';
import { PriceHistory } from './price-history.entity';
import { ListingsService } from './listings.service';
import { ListingsController } from './listings.controller';
import { ModelMarketAvg } from '../analysis/model-market-avg.entity';
import { DealAnalysis } from '../analysis/deal-analysis.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Listing, KeywordListing, PriceHistory, ModelMarketAvg, DealAnalysis])],
  providers: [ListingsService],
  controllers: [ListingsController],
  exports: [ListingsService],
})
export class ListingsModule {}
```

- [ ] **Step 4: Update `ListingsService` — add new repos, update `computeMarketAvg`, add `updateModelMarketAvg`**

Replace the constructor and `computeMarketAvg` method, add `updateModelMarketAvg` and `rescoreWithModel`. Full updated service:

```typescript
// backend/src/listings/listings.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Listing } from './listing.entity';
import { KeywordListing } from './keyword-listing.entity';
import { PriceHistory } from './price-history.entity';
import { Keyword } from '../keywords/keyword.entity';
import { ModelMarketAvg } from '../analysis/model-market-avg.entity';
import { DealAnalysis } from '../analysis/deal-analysis.entity';

export interface VintedItem {
  vinted_id: number;
  title: string;
  price: number;
  url: string;
  photo_url: string;
  brand: string;
  size_label: string;
  condition_label: string;
  seller_name: string;
  seller_id: number;
  catalog_id: number | null;
}

export interface MarketAvgResult {
  avg: number | null;
  itemCount: number;
  source: 'model' | 'keyword';
}

@Injectable()
export class ListingsService {
  constructor(
    @InjectRepository(Listing)
    private readonly listingRepo: Repository<Listing>,
    @InjectRepository(KeywordListing)
    private readonly klRepo: Repository<KeywordListing>,
    @InjectRepository(PriceHistory)
    private readonly historyRepo: Repository<PriceHistory>,
    @InjectRepository(ModelMarketAvg)
    private readonly modelAvgRepo: Repository<ModelMarketAvg>,
    @InjectRepository(DealAnalysis)
    private readonly analysisRepo: Repository<DealAnalysis>,
    private readonly dataSource: DataSource,
  ) {}

  async computeMarketAvg(keywordId: number, modelLabel?: string | null): Promise<MarketAvgResult> {
    if (modelLabel) {
      const mma = await this.modelAvgRepo.findOneBy({ keyword_id: keywordId, model_label: modelLabel });
      if (mma && mma.item_count >= 3 && mma.avg_price) {
        return { avg: parseFloat(String(mma.avg_price)), itemCount: mma.item_count, source: 'model' };
      }
    }
    // Fallback: keyword-wide trimmed mean (existing logic)
    const rows = await this.listingRepo
      .createQueryBuilder('l')
      .innerJoin('keyword_listings', 'kl', 'kl.listing_id = l.id AND kl.keyword_id = :kid', { kid: keywordId })
      .select('l.price', 'price')
      .where('l.price IS NOT NULL')
      .orderBy('l.last_seen_at', 'DESC')
      .limit(200)
      .getRawMany<{ price: string }>();
    if (rows.length < 2) return { avg: null, itemCount: rows.length, source: 'keyword' };
    const prices = rows.map(r => parseFloat(r.price)).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    const filtered = prices.filter(p => p <= median * 5 && p > 0.5);
    if (filtered.length === 0) return { avg: null, itemCount: 0, source: 'keyword' };
    const start = Math.floor(filtered.length * 0.1);
    const end = filtered.length - start;
    const mid = filtered.slice(start, end || 1);
    const avg = mid.reduce((a, b) => a + b, 0) / mid.length;
    return { avg, itemCount: mid.length, source: 'keyword' };
  }

  async updateModelMarketAvg(keywordId: number, modelLabel: string, price: number): Promise<void> {
    const existing = await this.modelAvgRepo.findOneBy({ keyword_id: keywordId, model_label: modelLabel });
    if (!existing) {
      await this.modelAvgRepo.save({
        keyword_id: keywordId,
        model_label: modelLabel,
        avg_price: price,
        item_count: 1,
        last_updated: new Date(),
      });
      return;
    }
    const newCount = existing.item_count + 1;
    const prevAvg = parseFloat(String(existing.avg_price ?? price));
    const newAvg = (prevAvg * existing.item_count + price) / newCount;
    await this.modelAvgRepo.save({
      keyword_id: keywordId,
      model_label: modelLabel,
      avg_price: newAvg,
      item_count: newCount,
      last_updated: new Date(),
    });
  }

  async rescoreWithModel(
    listingId: number,
    keywordId: number,
    modelLabel: string,
    shippingEstimate: number,
  ): Promise<{ marketAvg: number | null; itemCount: number; potentialProfit: number | null; dealScore: number | null }> {
    const listing = await this.listingRepo.findOneBy({ id: listingId });
    if (!listing) return { marketAvg: null, itemCount: 0, potentialProfit: null, dealScore: null };

    const { avg: marketAvg, itemCount } = await this.computeMarketAvg(keywordId, modelLabel);
    const price = parseFloat(String(listing.price ?? 0));
    const dealScore = marketAvg ? ((marketAvg - price) / marketAvg) * 100 : null;
    const potentialProfit = marketAvg ? marketAvg - price - shippingEstimate : null;

    await this.klRepo.upsert(
      { keyword_id: keywordId, listing_id: listingId, deal_score: dealScore, market_avg: marketAvg, model_market_avg: marketAvg, potential_profit: potentialProfit, matched_at: new Date() },
      ['keyword_id', 'listing_id'],
    );

    return { marketAvg, itemCount, potentialProfit, dealScore };
  }

  async saveDealAnalysis(
    listingId: number,
    keywordId: number,
    analysis: { scam_risk: string; confidence: number; recommendation: string; reasoning: string },
  ): Promise<DealAnalysis> {
    // Upsert: replace previous analysis for this listing+keyword pair
    const existing = await this.analysisRepo.findOneBy({ listing_id: listingId, keyword_id: keywordId });
    if (existing) {
      await this.analysisRepo.update(existing.id, { ...analysis, analyzed_at: new Date() });
      const updated = await this.analysisRepo.findOneBy({ id: existing.id });
      await this.klRepo.upsert({ keyword_id: keywordId, listing_id: listingId, analysis_id: updated!.id }, ['keyword_id', 'listing_id']);
      return updated!;
    }
    const saved = await this.analysisRepo.save({ listing_id: listingId, keyword_id: keywordId, ...analysis });
    await this.klRepo.upsert({ keyword_id: keywordId, listing_id: listingId, analysis_id: saved.id }, ['keyword_id', 'listing_id']);
    return saved;
  }

  async upsertListing(item: VintedItem, keyword: Keyword): Promise<{ listing: Listing; isNew: boolean; priceChanged: boolean }> {
    const existing = await this.listingRepo.findOneBy({ vinted_id: item.vinted_id });
    let isNew = false;
    let priceChanged = false;
    let listing: Listing;

    if (!existing) {
      isNew = true;
      listing = this.listingRepo.create({
        vinted_id: item.vinted_id, title: item.title, price: item.price,
        url: item.url, photo_url: item.photo_url, brand: item.brand,
        size_label: item.size_label, condition_label: item.condition_label,
        seller_name: item.seller_name, seller_id: item.seller_id,
        last_seen_at: new Date(),
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

    const { avg: marketAvg } = await this.computeMarketAvg(keyword.id, listing.model_label);
    const shippingEst = parseFloat(String(keyword.shipping_estimate)) || 4;
    const dealScore = marketAvg ? ((marketAvg - item.price) / marketAvg) * 100 : null;
    const potentialProfit = marketAvg ? marketAvg - item.price - shippingEst : null;

    await this.klRepo.upsert(
      { keyword_id: keyword.id, listing_id: listing.id, deal_score: dealScore, market_avg: marketAvg, potential_profit: potentialProfit, matched_at: new Date() },
      ['keyword_id', 'listing_id'],
    );

    return { listing, isNew, priceChanged };
  }

  async getValidated(limit = 50): Promise<any[]> {
    return this.dataSource.query(
      `SELECT
        kl.keyword_id, kl.listing_id, kl.deal_score, kl.market_avg,
        kl.model_market_avg, kl.potential_profit, kl.matched_at,
        l.id AS id, l.title, l.price, l.url, l.photo_url, l.brand,
        l.condition_label, l.size_label, l.seller_name, l.first_seen_at,
        l.model_label, l.model_confidence,
        k.label AS keyword_label, k.target_margin, k.shipping_estimate,
        da.id AS analysis_id, da.scam_risk, da.confidence AS analysis_confidence,
        da.recommendation, da.reasoning, da.analyzed_at
       FROM keyword_listings kl
       INNER JOIN listings l ON l.id = kl.listing_id
       INNER JOIN keywords k ON k.id = kl.keyword_id
       INNER JOIN deal_analyses da ON da.id = kl.analysis_id
       WHERE da.recommendation IN ('buy', 'watch') AND da.scam_risk != 'high'
       ORDER BY da.confidence DESC, kl.potential_profit DESC
       LIMIT $1`,
      [limit],
    );
  }

  async getOpportunities(keywordId?: number, limit = 50): Promise<any[]> {
    const qb = this.klRepo
      .createQueryBuilder('kl')
      .innerJoinAndSelect('kl.listing', 'l')
      .innerJoinAndSelect('kl.keyword', 'k')
      .where('kl.potential_profit IS NOT NULL')
      .orderBy('kl.potential_profit', 'DESC')
      .limit(limit);
    if (keywordId) qb.andWhere('kl.keyword_id = :kid', { kid: keywordId });
    return qb.getMany();
  }

  async getListings(keywordId?: number, limit = 100): Promise<any[]> {
    const qb = this.klRepo
      .createQueryBuilder('kl')
      .innerJoinAndSelect('kl.listing', 'l')
      .innerJoinAndSelect('kl.keyword', 'k')
      .orderBy('kl.matched_at', 'DESC')
      .limit(limit);
    if (keywordId) qb.andWhere('kl.keyword_id = :kid', { kid: keywordId });
    return qb.getMany();
  }

  async getPriceHistory(listingId: number): Promise<PriceHistory[]> {
    return this.historyRepo.find({ where: { listing_id: listingId }, order: { recorded_at: 'ASC' } });
  }

  async getListing(id: number): Promise<any> {
    const listing = await this.listingRepo.findOneBy({ id });
    if (!listing) return null;
    const kls = await this.klRepo.find({ where: { listing_id: id }, relations: ['keyword'] });
    const history = await this.getPriceHistory(id);
    const analysis = await this.analysisRepo.findOneBy({ listing_id: id });
    return { ...listing, keyword_listings: kls, price_history: history, analysis };
  }

  async getKeywordListing(keywordId: number, listingId: number): Promise<KeywordListing | null> {
    return this.klRepo.findOneBy({ keyword_id: keywordId, listing_id: listingId });
  }

  async getStats(): Promise<any> {
    const totalListings = await this.listingRepo.count();
    const totalKeywords = await this.dataSource.query('SELECT COUNT(*) FROM keywords WHERE active = true');
    const recentAlerts = await this.dataSource.query("SELECT COUNT(*) FROM notifications_log WHERE sent_at > NOW() - INTERVAL '24 hours'");
    const validatedDeals = await this.dataSource.query("SELECT COUNT(*) FROM deal_analyses WHERE recommendation IN ('buy','watch') AND scam_risk != 'high'");
    return {
      total_listings: totalListings,
      active_keywords: parseInt(totalKeywords[0].count),
      alerts_24h: parseInt(recentAlerts[0].count),
      validated_deals: parseInt(validatedDeals[0].count),
    };
  }
}
```

- [ ] **Step 5: Run tests**

```bash
cd backend && npx jest listings.service.spec --no-coverage 2>&1 | tail -10
```

Expected: `PASS` — 5 tests passing.

- [ ] **Step 6: Commit**

```bash
git add backend/src/listings/
git commit -m "feat(listings): model-aware computeMarketAvg, updateModelMarketAvg, getValidated"
```

---

## Task 8: ListingsController — `/validated` endpoint

**Files:**
- Modify: `backend/src/listings/listings.controller.ts`

- [ ] **Step 1: Add `GET /validated`**

```typescript
// backend/src/listings/listings.controller.ts
import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ListingsService } from './listings.service';

@Controller('listings')
export class ListingsController {
  constructor(private readonly service: ListingsService) {}

  @Get()
  findAll(@Query('keyword_id') keywordId?: string) {
    return this.service.getListings(keywordId ? parseInt(keywordId) : undefined);
  }

  @Get('opportunities')
  getOpportunities(@Query('keyword_id') keywordId?: string) {
    return this.service.getOpportunities(keywordId ? parseInt(keywordId) : undefined);
  }

  @Get('validated')
  getValidated(@Query('limit') limit?: string) {
    return this.service.getValidated(limit ? parseInt(limit) : 50);
  }

  @Get('stats')
  getStats() {
    return this.service.getStats();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.getListing(id);
  }

  @Get(':id/history')
  getHistory(@Param('id', ParseIntPipe) id: number) {
    return this.service.getPriceHistory(id);
  }
}
```

- [ ] **Step 2: Build to verify**

```bash
cd backend && npm run build 2>&1 | tail -5
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add backend/src/listings/listings.controller.ts
git commit -m "feat(listings): add GET /api/listings/validated endpoint"
```

---

## Task 9: ScraperService Refactor

**Files:**
- Modify: `backend/src/scraper/scraper.service.ts`
- Modify: `backend/src/scraper/scraper.module.ts`

- [ ] **Step 1: Update `scraper.module.ts` to import `AnalysisModule`**

```typescript
// backend/src/scraper/scraper.module.ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ScraperService } from './scraper.service';
import { ScraperController } from './scraper.controller';
import { KeywordsModule } from '../keywords/keywords.module';
import { ListingsModule } from '../listings/listings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AnalysisModule } from '../analysis/analysis.module';

@Module({
  imports: [ScheduleModule.forRoot(), KeywordsModule, ListingsModule, NotificationsModule, AnalysisModule],
  providers: [ScraperService],
  controllers: [ScraperController],
})
export class ScraperModule {}
```

- [ ] **Step 2: Replace `scraper.service.ts`**

```typescript
// backend/src/scraper/scraper.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KeywordsService } from '../keywords/keywords.service';
import { ListingsService } from '../listings/listings.service';
import { TelegramService } from '../notifications/telegram.service';
import { DealsGateway } from '../notifications/deals.gateway';
import { MistralService } from '../analysis/mistral.service';
import { VintedClient } from './vinted.client';
import { Keyword } from '../keywords/keyword.entity';
import { Listing } from '../listings/listing.entity';
import { AsyncQueue } from '../analysis/async-queue';

const BETWEEN_KEYWORDS_DELAY_MS = 5000;
const FAST_TICK_MS = 30_000;
const MARKET_TICK_MS = 600_000;

interface ModelQueueItem {
  listingId: number;
  title: string;
  price: number;
  keywordId: number;
  shippingEstimate: number;
  targetMargin: number;
  keyword: Keyword;
}

interface AnalysisQueueItem {
  listing: Listing;
  keyword: Keyword;
  marketAvg: number;
  itemCount: number;
}

@Injectable()
export class ScraperService implements OnModuleInit {
  private readonly logger = new Logger(ScraperService.name);
  private readonly vintedClient = new VintedClient();
  private isFastRunning = false;
  private isMarketRunning = false;
  private lastRunAt: Map<number, number> = new Map();
  private lastScrapeTime: Date | null = null;

  private readonly modelQueue: AsyncQueue<ModelQueueItem>;
  private readonly analysisQueue: AsyncQueue<AnalysisQueueItem>;

  constructor(
    private readonly keywordsService: KeywordsService,
    private readonly listingsService: ListingsService,
    private readonly telegramService: TelegramService,
    private readonly dealsGateway: DealsGateway,
    private readonly mistralService: MistralService,
  ) {
    this.modelQueue = new AsyncQueue(this.processModelExtraction.bind(this), 3, 5);
    this.analysisQueue = new AsyncQueue(this.processDealAnalysis.bind(this), 1, 3);
  }

  onModuleInit() {
    this.logger.log('ScraperService initialisé — premier fast scan dans 5s');
    setTimeout(() => this.fastTick(), 5000);
  }

  @Interval(FAST_TICK_MS)
  async fastTick() {
    if (this.isFastRunning) return;
    this.isFastRunning = true;
    try {
      await this.runFastScan();
    } finally {
      this.isFastRunning = false;
    }
  }

  @Interval(MARKET_TICK_MS)
  async marketTick() {
    if (this.isMarketRunning) return;
    this.isMarketRunning = true;
    try {
      await this.runMarketScan();
    } finally {
      this.isMarketRunning = false;
    }
  }

  private async runFastScan(): Promise<void> {
    const keywords = await this.keywordsService.findActive();
    if (keywords.length === 0) return;

    for (const keyword of keywords) {
      try {
        const items = await this.vintedClient.search(
          keyword.search_text, keyword.min_price, keyword.max_price, 96, 1, keyword.catalog_id,
        );
        if (items.length === 0) continue;

        let newCount = 0;
        for (const item of items) {
          const { listing, isNew, priceChanged } = await this.listingsService.upsertListing(item, keyword);
          if (!isNew && !priceChanged) continue;
          newCount++;

          if (isNew && this.mistralService.isEnabled()) {
            this.modelQueue.push({
              listingId: listing.id,
              title: listing.title ?? item.title,
              price: parseFloat(String(listing.price ?? item.price)),
              keywordId: keyword.id,
              shippingEstimate: parseFloat(String(keyword.shipping_estimate)) || 4,
              targetMargin: parseFloat(String(keyword.target_margin)) || 10,
              keyword,
            }).catch(() => {});
          } else if (isNew || priceChanged) {
            // No Mistral: use classic scoring
            await this.maybeAlertClassic(listing, keyword);
          }
        }

        this.lastRunAt.set(keyword.id, Date.now());
        this.lastScrapeTime = new Date();
        this.logger.log(`[FastScan] "${keyword.search_text}" → ${items.length} annonces, ${newCount} nouvelles/modifiées`);
      } catch (err: any) {
        if (err.message === 'BANNED') {
          this.logger.warn(`[FastScan] Keyword #${keyword.id} bloqué — pause 60s`);
          await this.delay(60_000);
        } else {
          this.logger.error(`[FastScan] Keyword #${keyword.id}: ${err.message}`);
        }
      }
      if (keywords.indexOf(keyword) < keywords.length - 1) await this.delay(BETWEEN_KEYWORDS_DELAY_MS);
    }
  }

  private async runMarketScan(): Promise<void> {
    if (!this.mistralService.isEnabled()) return;
    const keywords = await this.keywordsService.findActive();
    for (const keyword of keywords) {
      const pages = keyword.market_scan_pages ?? 5;
      for (let page = 2; page <= pages; page++) {
        try {
          const items = await this.vintedClient.search(
            keyword.search_text, keyword.min_price, keyword.max_price, 96, page, keyword.catalog_id,
          );
          if (items.length === 0) break;
          for (const item of items) {
            const { listing, isNew } = await this.listingsService.upsertListing(item, keyword);
            if (isNew && item.title) {
              this.modelQueue.push({
                listingId: listing.id, title: listing.title ?? item.title,
                price: parseFloat(String(listing.price ?? item.price)),
                keywordId: keyword.id,
                shippingEstimate: parseFloat(String(keyword.shipping_estimate)) || 4,
                targetMargin: parseFloat(String(keyword.target_margin)) || 10,
                keyword,
              }).catch(() => {});
            }
          }
          await this.delay(3000);
        } catch (err: any) {
          if (err.message === 'BANNED') break;
          this.logger.error(`[MarketScan] Keyword #${keyword.id} page ${page}: ${err.message}`);
          break;
        }
      }
      this.logger.log(`[MarketScan] "${keyword.search_text}" pages 2-${pages} traités`);
      if (keywords.indexOf(keyword) < keywords.length - 1) await this.delay(5000);
    }
  }

  private async processModelExtraction(item: ModelQueueItem): Promise<void> {
    const extraction = await this.mistralService.extractModel(item.title, item.price);
    if (!extraction.model_label) return;

    // Store model_label on listing
    await this.listingsService.updateListingModel(
      item.listingId, extraction.model_label, extraction.confidence,
    );

    // Update model market avg
    await this.listingsService.updateModelMarketAvg(item.keywordId, extraction.model_label, item.price);

    // Re-score with model-specific market avg
    const { marketAvg, itemCount, potentialProfit } = await this.listingsService.rescoreWithModel(
      item.listingId, item.keywordId, extraction.model_label, item.shippingEstimate,
    );

    if (marketAvg && potentialProfit !== null && potentialProfit >= item.targetMargin) {
      const listing = await this.listingsService.getListingById(item.listingId);
      if (listing) {
        this.analysisQueue.push({ listing, keyword: item.keyword, marketAvg, itemCount }).catch(() => {});
      }
    }
  }

  private async processDealAnalysis(item: AnalysisQueueItem): Promise<void> {
    const result = await this.mistralService.analyzeDeal(
      item.listing, item.keyword, item.marketAvg, item.itemCount,
    );
    if (!result) return;

    await this.listingsService.saveDealAnalysis(item.listing.id, item.keyword.id, result);

    if (result.recommendation !== 'skip' && result.scam_risk !== 'high') {
      const price = parseFloat(String(item.listing.price ?? 0));
      const shippingEst = parseFloat(String(item.keyword.shipping_estimate)) || 4;
      const potentialProfit = item.marketAvg - price - shippingEst;
      const dealScore = ((item.marketAvg - price) / item.marketAvg) * 100;

      this.dealsGateway.emitNewDeal({
        listingId: item.listing.id,
        title: item.listing.title ?? 'Sans titre',
        price,
        marketAvg: item.marketAvg,
        profit: potentialProfit,
        dealScore,
        photoUrl: item.listing.photo_url ?? null,
        url: item.listing.url ?? null,
        keywordLabel: item.keyword.label,
      });

      this.logger.log(`✅ Deal validé par IA : "${item.listing.title}" → +${potentialProfit.toFixed(0)}€ (${result.recommendation}, scam: ${result.scam_risk})`);
    }
  }

  private async maybeAlertClassic(listing: Listing, keyword: Keyword): Promise<void> {
    const kl = await this.listingsService.getKeywordListing(keyword.id, listing.id);
    if (!kl) return;
    const potentialProfit = parseFloat(String(kl.potential_profit ?? 0));
    const targetMargin = parseFloat(String(keyword.target_margin ?? 10));
    if (potentialProfit >= targetMargin && kl.market_avg) {
      const marketAvg = parseFloat(String(kl.market_avg));
      const dealScore = parseFloat(String(kl.deal_score ?? 0));
      await this.telegramService.sendDealAlert(listing, keyword, dealScore, marketAvg, potentialProfit);
      this.dealsGateway.emitNewDeal({
        listingId: listing.id, title: listing.title ?? 'Sans titre',
        price: parseFloat(String(listing.price ?? 0)), marketAvg, profit: potentialProfit,
        dealScore, photoUrl: listing.photo_url ?? null, url: listing.url ?? null,
        keywordLabel: keyword.label,
      });
    }
  }

  async getStatus() {
    const keywords = await this.keywordsService.findActive();
    const now = Date.now();
    return {
      isFastRunning: this.isFastRunning,
      isMarketRunning: this.isMarketRunning,
      lastScrapeTime: this.lastScrapeTime,
      activeKeywords: keywords.length,
      mistralEnabled: this.mistralService.isEnabled(),
      queueStats: {
        model: this.modelQueue.getStats(),
        analysis: this.analysisQueue.getStats(),
      },
      keywords: keywords.map(kw => ({
        id: kw.id, label: kw.label,
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
      let inserted = 0; let completedPages = 0;
      for (let page = 1; page <= pages; page++) {
        try {
          const items = await this.vintedClient.search(keyword.search_text, keyword.min_price, keyword.max_price, 96, page, keyword.catalog_id);
          if (items.length === 0) break;
          for (const item of items) {
            const { isNew } = await this.listingsService.upsertListing(item, keyword);
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
```

- [ ] **Step 3: Add `updateListingModel` and `getListingById` helpers to `ListingsService`**

Append these two methods to `ListingsService` (before the closing `}`):

```typescript
  async updateListingModel(listingId: number, modelLabel: string, confidence: number): Promise<void> {
    await this.listingRepo.update(listingId, { model_label: modelLabel, model_confidence: confidence });
  }

  async getListingById(listingId: number): Promise<Listing | null> {
    return this.listingRepo.findOneBy({ id: listingId });
  }
```

- [ ] **Step 4: Build**

```bash
cd backend && npm run build 2>&1 | tail -10
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/scraper/ backend/src/listings/listings.service.ts
git commit -m "feat(scraper): split into fastTick/marketTick, wire Mistral 2-pass queue pipeline"
```

---

## Task 10: Environment Variables

**Files:**
- Modify: `backend/.env.example`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add `MISTRAL_API_KEY` to `.env.example`**

```
DB_HOST=db
DB_PORT=5432
DB_NAME=vinbot
DB_USER=postgres
DB_PASSWORD=changeme

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

MISTRAL_API_KEY=
```

- [ ] **Step 2: Add `MISTRAL_API_KEY` to `docker-compose.yml` api service environment**

In `docker-compose.yml`, under `api.environment`, add:
```yaml
      MISTRAL_API_KEY: ${MISTRAL_API_KEY:-}
```

- [ ] **Step 3: Commit**

```bash
git add .env.example docker-compose.yml
git commit -m "feat(config): add MISTRAL_API_KEY to env and docker-compose"
```

---

## Task 11: Frontend API Client

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Replace `frontend/src/lib/api.ts`**

```typescript
// frontend/src/lib/api.ts
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export interface Keyword {
  id: number; label: string; search_text: string;
  min_price: number | null; max_price: number | null;
  target_margin: number; shipping_estimate: number;
  category: string | null; catalog_id: number | null;
  scan_interval_seconds: number; market_scan_pages: number;
  active: boolean; created_at: string; updated_at: string;
}

export interface Listing {
  id: number; vinted_id: number; title: string | null;
  price: number | null; url: string | null; photo_url: string | null;
  brand: string | null; size_label: string | null;
  condition_label: string | null; seller_name: string | null;
  first_seen_at: string; last_seen_at: string;
  model_label?: string | null; model_confidence?: number | null;
}

export interface DealAnalysis {
  id: number; scam_risk: 'low' | 'medium' | 'high';
  confidence: number | null; recommendation: 'buy' | 'watch' | 'skip';
  reasoning: string | null; analyzed_at: string;
}

export interface KeywordListing {
  keyword_id: number; listing_id: number;
  deal_score: number | null; market_avg: number | null;
  model_market_avg?: number | null; potential_profit: number | null;
  matched_at: string; keyword: Keyword; listing: Listing;
  analysis?: DealAnalysis | null;
}

export interface ValidatedDeal {
  keyword_id: number; listing_id: number; id: number;
  deal_score: number | null; market_avg: number | null;
  model_market_avg: number | null; potential_profit: number | null;
  matched_at: string; title: string | null; price: number | null;
  url: string | null; photo_url: string | null; brand: string | null;
  condition_label: string | null; size_label: string | null;
  seller_name: string | null; first_seen_at: string;
  model_label: string | null; model_confidence: number | null;
  keyword_label: string; scam_risk: 'low' | 'medium' | 'high';
  analysis_confidence: number | null; recommendation: 'buy' | 'watch' | 'skip';
  reasoning: string | null; analyzed_at: string;
}

export interface PricePoint { id: number; price: number; recorded_at: string; }

export interface Stats {
  total_listings: number; active_keywords: number;
  alerts_24h: number; validated_deals: number;
}

export const api = {
  keywords: {
    list: () => req<Keyword[]>('/keywords'),
    get: (id: number) => req<Keyword>(`/keywords/${id}`),
    create: (data: Partial<Keyword>) => req<Keyword>('/keywords', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Keyword>) => req<Keyword>(`/keywords/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => req<void>(`/keywords/${id}`, { method: 'DELETE' }),
  },
  listings: {
    list: (keywordId?: number) => req<KeywordListing[]>(`/listings${keywordId ? `?keyword_id=${keywordId}` : ''}`),
    opportunities: (keywordId?: number) => req<KeywordListing[]>(`/listings/opportunities${keywordId ? `?keyword_id=${keywordId}` : ''}`),
    validated: (limit = 50) => req<ValidatedDeal[]>(`/listings/validated?limit=${limit}`),
    get: (id: number) => req<any>(`/listings/${id}`),
    history: (id: number) => req<PricePoint[]>(`/listings/${id}/history`),
    stats: () => req<Stats>('/listings/stats'),
  },
  telegram: {
    test: () => req<{ ok: boolean; error?: string }>('/telegram/test', { method: 'POST' }),
  },
  mistral: {
    test: () => req<{ ok: boolean; error?: string }>('/mistral/test', { method: 'POST' }),
  },
  scraper: {
    status: () => req<any>('/scraper/status'),
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(frontend/api): add ValidatedDeal type, validated endpoint, mistral.test"
```

---

## Task 12: DealCard Component Update

**Files:**
- Modify: `frontend/src/components/DealCard.tsx`

- [ ] **Step 1: Replace `DealCard.tsx`**

```tsx
// frontend/src/components/DealCard.tsx
'use client';
import Link from 'next/link';
import { KeywordListing } from '@/lib/api';
import { ExternalLink, TrendingDown, ArrowUpRight, Tag, Sparkles, AlertTriangle, Clock } from 'lucide-react';

function getScoreStyle(score: number | null) {
  if (score === null) return 'bg-zinc-800 text-zinc-400 border-zinc-700/50';
  if (score >= 40) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 glow-emerald';
  if (score >= 20) return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30 glow-cyan';
  return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
}

function getProfitStyle(profit: number | null) {
  if (profit === null || profit < 0) return 'text-zinc-500';
  if (profit >= 30) return 'text-emerald-400 font-extrabold';
  if (profit >= 15) return 'text-cyan-400 font-bold';
  return 'text-amber-400 font-semibold';
}

function isFresh(firstSeenAt: string): boolean {
  return Date.now() - new Date(firstSeenAt).getTime() < 5 * 60 * 1000;
}

interface Props { kl: KeywordListing; }

export function DealCard({ kl }: Props) {
  const { listing, keyword, deal_score, market_avg, model_market_avg, potential_profit, analysis } = kl;
  const price = listing.price ? parseFloat(String(listing.price)) : null;
  const effectiveAvg = model_market_avg
    ? parseFloat(String(model_market_avg))
    : market_avg ? parseFloat(String(market_avg)) : null;
  const profit = potential_profit ? parseFloat(String(potential_profit)) : null;
  const score = deal_score ? parseFloat(String(deal_score)) : null;
  const fresh = isFresh(listing.first_seen_at);
  const aiConfidence = analysis?.confidence ? parseFloat(String(analysis.confidence)) : null;

  return (
    <div className="group bg-zinc-900/60 border border-zinc-800/80 rounded-2xl overflow-hidden hover:border-zinc-700/80 hover:shadow-xl transition-all duration-300 hover:scale-[1.01] flex flex-col h-full">
      {/* Image */}
      <div className="relative aspect-[4/3] bg-zinc-950 overflow-hidden w-full shrink-0">
        <Link href={`/listings/${listing.id}`}>
          {listing.photo_url ? (
            <img src={listing.photo_url} alt={listing.title ?? ''} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">Aucune image</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent opacity-60" />
        </Link>

        {/* Score badge */}
        {score !== null && (
          <span className={`absolute top-2.5 right-2.5 flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border backdrop-blur-md ${getScoreStyle(score)}`}>
            <TrendingDown size={12} />-{score.toFixed(0)}%
          </span>
        )}

        {/* Fresh badge */}
        {fresh && (
          <span className="absolute top-2.5 left-2.5 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border backdrop-blur-md bg-indigo-500/20 text-indigo-300 border-indigo-500/40">
            <Clock size={10} />🆕 NOUVEAU
          </span>
        )}

        {/* Keyword label */}
        <span className="absolute bottom-2 left-2 text-[10px] font-medium tracking-wide uppercase px-2 py-0.5 rounded bg-zinc-950/80 text-zinc-400 border border-zinc-800/80 backdrop-blur-md">
          {keyword.label}
        </span>
      </div>

      {/* Content */}
      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {listing.brand && <span className="bg-zinc-800/60 text-zinc-300 px-2 py-0.5 rounded text-[10px] font-medium border border-zinc-700/30">{listing.brand}</span>}
            {listing.condition_label && <span className="bg-zinc-800/40 text-zinc-400 px-2 py-0.5 rounded text-[10px] font-medium border border-zinc-800/50">{listing.condition_label}</span>}
          </div>

          {/* Model label (Mistral extraction) */}
          {listing.model_label && (
            <div className="flex items-center gap-1 text-[10px] text-indigo-400">
              <Sparkles size={10} />
              <span className="font-mono font-semibold">{listing.model_label}</span>
            </div>
          )}

          <Link href={`/listings/${listing.id}`} className="block text-sm font-semibold text-zinc-100 hover:text-indigo-400 transition-colors line-clamp-1 mt-1">
            {listing.title ?? 'Sans titre'}
          </Link>

          {/* Pricing */}
          <div className="flex items-baseline justify-between pt-1">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-black text-white">{price?.toFixed(1)}€</span>
              {effectiveAvg && (
                <span className="text-xs text-zinc-500 line-through">
                  Moy.{model_market_avg ? ' modèle' : ''} {effectiveAvg.toFixed(0)}€
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-zinc-800/50">
          {profit !== null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">Marge estimée :</span>
              <span className={`text-sm ${getProfitStyle(profit)} flex items-center font-bold`}>
                {profit >= 0 ? '+' : ''}{profit.toFixed(0)}€
              </span>
            </div>
          )}

          {/* AI confidence */}
          {aiConfidence !== null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500 flex items-center gap-1"><Sparkles size={10} /> IA :</span>
              <span className={`font-bold text-xs ${aiConfidence >= 0.8 ? 'text-emerald-400' : aiConfidence >= 0.6 ? 'text-amber-400' : 'text-zinc-400'}`}>
                {Math.round(aiConfidence * 100)}% confiance
              </span>
            </div>
          )}

          {/* Scam risk (only show medium+) */}
          {analysis?.scam_risk === 'medium' && (
            <div className="flex items-center gap-1 text-[10px] text-amber-400">
              <AlertTriangle size={10} />
              <span>Risque moyen — vérifiez l'annonce</span>
            </div>
          )}
          {analysis?.scam_risk === 'high' && (
            <div className="flex items-center gap-1 text-[10px] text-rose-400">
              <AlertTriangle size={10} />
              <span>Risque élevé détecté</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Link href={`/listings/${listing.id}`} className="flex-1 text-center bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs py-2 rounded-xl transition-colors font-medium border border-zinc-700/30 flex items-center justify-center gap-1 group-hover:border-zinc-600">
              Détails <ArrowUpRight size={13} />
            </Link>
            {listing.url && (
              <a href={listing.url} target="_blank" rel="noopener noreferrer" className="bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded-xl transition-all duration-200 flex items-center justify-center glow-indigo" title="Ouvrir sur Vinted">
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/DealCard.tsx
git commit -m "feat(frontend): DealCard — model_label, freshness badge, AI confidence, scam risk"
```

---

## Task 13: Sidebar + `/validated` Page

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Create: `frontend/src/app/validated/page.tsx`

- [ ] **Step 1: Add `/validated` to Sidebar nav**

In `Sidebar.tsx`, update the `navLinks` array:

```typescript
import { LayoutDashboard, TrendingUp, Tags, Settings, Menu, X, Bot, Radio, ShieldCheck } from 'lucide-react';

const navLinks = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/validated', label: 'Deals validés', icon: ShieldCheck },
  { href: '/opportunities', label: 'Opportunités', icon: TrendingUp },
  { href: '/keywords', label: 'Mots-clés', icon: Tags },
  { href: '/settings', label: 'Réglages', icon: Settings },
];
```

- [ ] **Step 2: Create `/validated` page**

```tsx
// frontend/src/app/validated/page.tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ValidatedDeal } from '@/lib/api';
import { ShieldCheck, ExternalLink, Sparkles, TrendingDown, Clock, AlertTriangle } from 'lucide-react';

function isFresh(firstSeenAt: string): boolean {
  return Date.now() - new Date(firstSeenAt).getTime() < 5 * 60 * 1000;
}

function RecommendationBadge({ rec }: { rec: string }) {
  if (rec === 'buy') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
      ✅ ACHETER
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
      👀 SURVEILLER
    </span>
  );
}

export default function ValidatedPage() {
  const [deals, setDeals] = useState<ValidatedDeal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listings.validated(50)
      .then(setDeals)
      .catch(() => setDeals([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-2">
          <ShieldCheck className="text-emerald-400" size={26} />
          Deals validés par IA
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          Uniquement les annonces analysées et confirmées par Mistral. Recommandation "acheter" ou "surveiller", risque scam exclu.
        </p>
      </div>

      {loading ? (
        <div className="text-center text-zinc-500 py-24 animate-pulse">Analyse en cours…</div>
      ) : deals.length === 0 ? (
        <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-2xl p-16 text-center space-y-3">
          <div className="bg-zinc-950 p-4 rounded-full inline-block border border-zinc-800">
            <Sparkles size={32} className="text-zinc-500" />
          </div>
          <h3 className="text-sm font-bold text-zinc-200">Aucun deal validé pour l'instant</h3>
          <p className="text-xs text-zinc-500 max-w-xs mx-auto">
            Mistral analyse les candidats en arrière-plan. Revenez dans quelques minutes après le prochain cycle de scraping.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {deals.map(deal => {
            const price = parseFloat(String(deal.price ?? 0));
            const effectiveAvg = deal.model_market_avg
              ? parseFloat(String(deal.model_market_avg))
              : deal.market_avg ? parseFloat(String(deal.market_avg)) : null;
            const profit = deal.potential_profit ? parseFloat(String(deal.potential_profit)) : null;
            const confidence = deal.analysis_confidence ? parseFloat(String(deal.analysis_confidence)) : null;
            const fresh = isFresh(deal.first_seen_at);

            return (
              <div key={`${deal.keyword_id}-${deal.listing_id}`} className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl overflow-hidden hover:border-emerald-700/40 hover:shadow-xl transition-all duration-300 flex flex-col">
                {/* Image */}
                <div className="relative aspect-[4/3] bg-zinc-950 overflow-hidden">
                  <Link href={`/listings/${deal.listing_id}`}>
                    {deal.photo_url ? (
                      <img src={deal.photo_url} alt={deal.title ?? ''} className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">Aucune image</div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent opacity-60" />
                  </Link>
                  {fresh && (
                    <span className="absolute top-2.5 left-2.5 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border backdrop-blur-md bg-indigo-500/20 text-indigo-300 border-indigo-500/40">
                      <Clock size={10} />🆕 NOUVEAU
                    </span>
                  )}
                  <span className="absolute bottom-2 left-2 text-[10px] font-medium uppercase px-2 py-0.5 rounded bg-zinc-950/80 text-zinc-400 border border-zinc-800/80">
                    {deal.keyword_label}
                  </span>
                </div>

                {/* Content */}
                <div className="p-4 flex-1 flex flex-col gap-3">
                  {deal.model_label && (
                    <div className="flex items-center gap-1 text-[10px] text-indigo-400">
                      <Sparkles size={10} />
                      <span className="font-mono font-semibold">{deal.model_label}</span>
                    </div>
                  )}

                  <Link href={`/listings/${deal.listing_id}`} className="text-sm font-semibold text-zinc-100 hover:text-indigo-400 transition-colors line-clamp-2">
                    {deal.title ?? 'Sans titre'}
                  </Link>

                  <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-black text-white">{price.toFixed(1)}€</span>
                    {effectiveAvg && (
                      <span className="text-xs text-zinc-500">
                        Moy.{deal.model_market_avg ? ' modèle' : ''} {effectiveAvg.toFixed(0)}€
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5 text-xs">
                    {profit !== null && (
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Marge :</span>
                        <span className={`font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {profit >= 0 ? '+' : ''}{profit.toFixed(0)}€
                        </span>
                      </div>
                    )}
                    {confidence !== null && (
                      <div className="flex justify-between">
                        <span className="text-zinc-500 flex items-center gap-1"><Sparkles size={10} /> Confiance IA :</span>
                        <span className={`font-bold ${confidence >= 0.8 ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {Math.round(confidence * 100)}%
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-zinc-500">Verdict :</span>
                      <RecommendationBadge rec={deal.recommendation} />
                    </div>
                  </div>

                  {deal.reasoning && (
                    <p className="text-[10px] text-zinc-500 italic leading-relaxed border-t border-zinc-800 pt-2 line-clamp-3">
                      {deal.reasoning}
                    </p>
                  )}

                  {deal.scam_risk === 'medium' && (
                    <div className="flex items-center gap-1 text-[10px] text-amber-400">
                      <AlertTriangle size={10} />Risque modéré — vérifiez l'annonce
                    </div>
                  )}

                  <div className="flex gap-2 pt-1 mt-auto">
                    <Link href={`/listings/${deal.listing_id}`} className="flex-1 text-center bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs py-2 rounded-xl font-medium border border-zinc-700/30 transition-colors">
                      Détails
                    </Link>
                    {deal.url && (
                      <a href={deal.url} target="_blank" rel="noopener noreferrer" className="bg-emerald-600 hover:bg-emerald-500 text-white p-2 rounded-xl transition-all flex items-center justify-center">
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/app/validated/
git commit -m "feat(frontend): add /validated page and sidebar link"
```

---

## Task 14: Listing Detail — AI Analysis Block

**Files:**
- Modify: `frontend/src/app/listings/[id]/page.tsx`

- [ ] **Step 1: Add AI analysis block**

After the `PriceChart` section (around line 310), and import `Sparkles, ShieldCheck, AlertTriangle, Brain` from lucide-react. Add `Brain` to the existing import line:

```tsx
import { ArrowLeft, ExternalLink, Calculator, DollarSign, Coins, TrendingDown, Tag, User, Calendar, Percent, ShieldCheck, Brain, AlertTriangle, Sparkles } from 'lucide-react';
```

After the closing `</div>` of the "Suivi de l'évolution du prix" section, add:

```tsx
      {/* AI Analysis Block */}
      {listing.analysis && (
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 space-y-4 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Brain className="text-indigo-400" size={20} />
            <h2 className="text-base font-bold text-white">Analyse Mistral</h2>
            <span className="text-xs text-zinc-500 ml-auto">
              {new Date(listing.analysis.analyzed_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-3">
              <p className="text-xs text-zinc-500 mb-1">Recommandation</p>
              {listing.analysis.recommendation === 'buy' ? (
                <span className="text-emerald-400 font-bold text-sm">✅ Acheter</span>
              ) : listing.analysis.recommendation === 'watch' ? (
                <span className="text-amber-400 font-bold text-sm">👀 Surveiller</span>
              ) : (
                <span className="text-zinc-400 font-bold text-sm">❌ Passer</span>
              )}
            </div>
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-3">
              <p className="text-xs text-zinc-500 mb-1">Confiance IA</p>
              <span className={`font-bold text-sm ${listing.analysis.confidence && parseFloat(String(listing.analysis.confidence)) >= 0.8 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {listing.analysis.confidence ? `${Math.round(parseFloat(String(listing.analysis.confidence)) * 100)}%` : '—'}
              </span>
            </div>
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-3">
              <p className="text-xs text-zinc-500 mb-1">Risque scam</p>
              <span className={`font-bold text-sm ${listing.analysis.scam_risk === 'low' ? 'text-emerald-400' : listing.analysis.scam_risk === 'medium' ? 'text-amber-400' : 'text-rose-400'}`}>
                {listing.analysis.scam_risk === 'low' ? '🟢 Faible' : listing.analysis.scam_risk === 'medium' ? '🟡 Modéré' : '🔴 Élevé'}
              </span>
            </div>
          </div>

          {listing.analysis.reasoning && (
            <div className="bg-zinc-950/40 border border-zinc-800/60 rounded-xl p-4 text-xs text-zinc-300 leading-relaxed italic">
              <Sparkles size={12} className="inline text-indigo-400 mr-1" />
              {listing.analysis.reasoning}
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 2: Build frontend**

```bash
cd frontend && npm run build 2>&1 | tail -15
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/listings/
git commit -m "feat(frontend): add Mistral AI analysis block to listing detail page"
```

---

## Task 15: Settings — Mistral Panel

**Files:**
- Modify: `frontend/src/app/settings/page.tsx`

- [ ] **Step 1: Add Mistral test panel to settings**

Add to the `useState` imports: `useEffect`. Add after the `testTelegram` function:

```tsx
  const [testingMistral, setTestingMistral] = useState(false);
  const [mistralResult, setMistralResult] = useState<{ ok: boolean; error?: string } | null>(null);

  async function testMistral() {
    setTestingMistral(true);
    setMistralResult(null);
    try {
      const res = await api.mistral.test();
      setMistralResult(res);
    } catch {
      setMistralResult({ ok: false, error: 'Impossible de joindre l\'API' });
    } finally {
      setTestingMistral(false);
    }
  }
```

Add a new card after the Telegram card (before the "À propos du scraper" card). Import `Brain` from lucide-react in the existing import line:

```tsx
import { Settings, Send, Bot, Check, AlertCircle, Info, ChevronRight, Terminal, Brain } from 'lucide-react';
```

New card JSX to insert:

```tsx
        {/* Mistral AI Panel */}
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-6 space-y-5 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-500/10 text-indigo-400 p-2 rounded-xl border border-indigo-500/20">
              <Brain size={18} />
            </div>
            <div>
              <h2 className="font-bold text-white text-base">Analyse IA — Mistral</h2>
              <p className="text-xs text-zinc-500">Extraction du modèle exact + scoring de légitimité des deals.</p>
            </div>
          </div>

          <p className="text-sm text-zinc-400 leading-relaxed">
            La variable <code className="bg-zinc-950 text-indigo-400 px-1.5 py-0.5 rounded text-xs font-mono border border-zinc-800">MISTRAL_API_KEY</code> doit être définie dans votre fichier <code className="bg-zinc-950 text-indigo-400 px-1.5 py-0.5 rounded text-xs font-mono border border-zinc-800">.env</code>. Sans cette clé, le scraper fonctionne normalement sans analyse IA.
          </p>

          <div className="bg-zinc-950 border border-zinc-850 rounded-xl p-4 font-mono text-xs text-zinc-300 space-y-1">
            <div className="flex items-center gap-2 text-[10px] text-zinc-600 font-semibold uppercase tracking-wider mb-2 border-b border-zinc-900 pb-1.5">
              <Terminal size={12} />Configuration .env
            </div>
            <p className="text-zinc-500"># Clé API Mistral (console.mistral.ai)</p>
            <p className="text-sky-400"><span className="text-zinc-400">MISTRAL_API_KEY</span>=votre_clé_ici</p>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row items-center gap-4">
            <button
              onClick={testMistral}
              disabled={testingMistral}
              className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-xs font-semibold transition-all shadow-md glow-indigo disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Brain size={13} className={testingMistral ? 'animate-pulse' : ''} />
              {testingMistral ? 'Test en cours…' : 'Tester la connexion Mistral'}
            </button>
          </div>

          {mistralResult && (
            <div className={`flex items-center gap-2.5 text-xs p-4 rounded-xl border animate-fadeIn ${mistralResult.ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
              {mistralResult.ok ? (
                <><Check size={16} className="shrink-0" /><span>Connexion Mistral établie avec succès !</span></>
              ) : (
                <><AlertCircle size={16} className="shrink-0" /><span>Échec : {mistralResult.error}</span></>
              )}
            </div>
          )}
        </div>
```

- [ ] **Step 2: Build**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/settings/page.tsx
git commit -m "feat(frontend): add Mistral connection test panel to settings"
```

---

## Task 16: Deploy

- [ ] **Step 1: Push all commits to remote**

```bash
git push origin main
```

- [ ] **Step 2: Add `MISTRAL_API_KEY` to server `.env`**

```bash
ssh -p 50022 freebox@88.165.36.69 "echo 'MISTRAL_API_KEY=<ta_clé>' >> /home/freebox/vinbot/.env"
```

Replace `<ta_clé>` with your actual key from [console.mistral.ai](https://console.mistral.ai).

- [ ] **Step 3: Pull and rebuild on server**

```bash
ssh -p 50022 freebox@88.165.36.69 "cd /home/freebox/vinbot && git pull origin main && docker compose up -d --build api frontend 2>&1"
```

Expected: both `vinbot-api-1` and `vinbot-frontend-1` rebuilt and started.

- [ ] **Step 4: Apply DB migrations**

```bash
ssh -p 50022 freebox@88.165.36.69 "docker exec -i vinbot-db-1 psql -U postgres -d vinbot" < db/init.sql
```

Expected: `ALTER TABLE`, `CREATE TABLE` — no errors (idempotent due to `IF NOT EXISTS`).

- [ ] **Step 5: Verify Mistral is active**

```bash
ssh -p 50022 freebox@88.165.36.69 "docker logs vinbot-api-1 --tail 20 2>&1 | grep -i mistral"
```

Expected: `MistralService initialisé`

- [ ] **Step 6: Verify queue stats after 1 minute**

```bash
curl http://88.165.36.69:3003/api/scraper/status 2>/dev/null | python -m json.tool 2>/dev/null || curl http://88.165.36.69:3003/api/scraper/status
```

Expected: `"mistralEnabled": true`, queue stats showing `completed > 0` after the first fast scan.

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Fast scan 30s page 1 | Task 9 |
| Market scan 10min pages 2-N | Task 9 |
| `market_scan_pages` per keyword | Tasks 1, 6 |
| Mistral Pass 1 — model extraction | Task 4, 9 |
| Mistral Pass 2 — deal analysis | Task 4, 9 |
| `AsyncQueue` with concurrency + rate limit | Task 3 |
| `model_label`, `model_confidence` on listings | Tasks 1, 6 |
| `model_market_avg` table | Tasks 1, 2 |
| `deal_analyses` table | Tasks 1, 2 |
| `analysis_id` on `keyword_listings` | Tasks 1, 6 |
| `computeMarketAvg` with model fallback | Task 7 |
| `updateModelMarketAvg` incremental avg | Task 7 |
| `getValidated` endpoint | Tasks 7, 8 |
| No-op when `MISTRAL_API_KEY` absent | Task 4 |
| `/validated` frontend page | Task 13 |
| DealCard model badge + fresh badge + AI confidence | Task 12 |
| Listing detail AI block | Task 14 |
| Sidebar `/validated` link | Task 13 |
| Settings Mistral panel + test button | Task 15 |
| `MISTRAL_API_KEY` in env + docker-compose | Task 10 |

All spec sections covered. No placeholders found. Types are consistent across tasks (e.g., `MarketAvgResult` defined in Task 7, used in Task 9; `ValidatedDeal` defined in Task 11, used in Task 13).
