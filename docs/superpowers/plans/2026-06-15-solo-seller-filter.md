# Solo Seller Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `soloSeller` filter to `GET /listings` that returns only listings from sellers with a single active listing for the matched keyword, plus a toggle button on the frontend listings page.

**Architecture:** The filter is a SQL subquery injected into `ListingsService.getListings()` when `soloSeller: true`. The controller exposes it as `?solo_seller=1`. The frontend adds a boolean state and a toggle button that passes the param through the existing `latestQuery()` helper.

**Tech Stack:** NestJS (TypeORM / raw SQL), Next.js 16, TypeScript, lucide-react

---

### Task 1: Backend — extend `getListings()` with `soloSeller` option

**Files:**
- Modify: `backend/src/listings/listings.service.ts` (function `getListings`, lines 256-285)
- Test: `backend/src/listings/listings.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Open `backend/src/listings/listings.service.spec.ts` and add the following `describe` block after the existing `computeMarketAvg` suite (but still inside the outer `describe('ListingsService', ...)`):

```typescript
describe('getListings', () => {
  it('includes solo_seller subquery when soloSeller=true', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        ListingsService,
        { provide: getRepositoryToken(Listing), useValue: mockRepo() },
        { provide: getRepositoryToken(KeywordListing), useValue: mockRepo() },
        { provide: getRepositoryToken(PriceHistory), useValue: mockRepo() },
        { provide: getRepositoryToken(ModelMarketAvg), useValue: mockRepo() },
        { provide: getRepositoryToken(DealAnalysis), useValue: mockRepo() },
        { provide: DataSource, useValue: { query: queryMock } },
      ],
    }).compile();
    const svc = module.get(ListingsService);

    await svc.getListings({ keywordId: 3, soloSeller: true });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const sql: string = queryMock.mock.calls[0][0];
    expect(sql).toContain('seller_id NOT IN');
    expect(sql).toContain('HAVING COUNT(*) > 1');
  });

  it('omits solo_seller subquery when soloSeller=false', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        ListingsService,
        { provide: getRepositoryToken(Listing), useValue: mockRepo() },
        { provide: getRepositoryToken(KeywordListing), useValue: mockRepo() },
        { provide: getRepositoryToken(PriceHistory), useValue: mockRepo() },
        { provide: getRepositoryToken(ModelMarketAvg), useValue: mockRepo() },
        { provide: getRepositoryToken(DealAnalysis), useValue: mockRepo() },
        { provide: DataSource, useValue: { query: queryMock } },
      ],
    }).compile();
    const svc = module.get(ListingsService);

    await svc.getListings({ keywordId: 3, soloSeller: false });

    const sql: string = queryMock.mock.calls[0][0];
    expect(sql).not.toContain('seller_id NOT IN');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend
npm run test -- --testPathPattern=listings.service
```

Expected: 2 new tests FAIL with "soloSeller is not a valid option" or similar type error.

- [ ] **Step 3: Implement the `soloSeller` option in `getListings()`**

In `backend/src/listings/listings.service.ts`, update `getListings()`:

```typescript
async getListings(opts: { keywordId?: number; limit?: number; offset?: number; country?: string; q?: string; maxAgeHours?: number; soloSeller?: boolean } = {}): Promise<any[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const params: any[] = [];
  const where: string[] = [];
  if (opts.keywordId) { params.push(opts.keywordId); where.push(`kl.keyword_id = $${params.length}`); }
  if (opts.country) { params.push(opts.country.toLowerCase()); where.push(`l.country_code = $${params.length}`); }
  if (opts.q) { params.push(`%${opts.q}%`); where.push(`l.title ILIKE $${params.length}`); }
  if (opts.maxAgeHours) { params.push(opts.maxAgeHours); where.push(`l.first_seen_at > NOW() - ($${params.length} || ' hours')::interval`); }
  if (opts.soloSeller) {
    where.push(`l.seller_id NOT IN (
      SELECT l2.seller_id
      FROM listings l2
      INNER JOIN keyword_listings kl2 ON kl2.listing_id = l2.id
      WHERE kl2.keyword_id = kl.keyword_id
        AND l2.last_seen_at > NOW() - INTERVAL '24 hours'
      GROUP BY l2.seller_id
      HAVING COUNT(*) > 1
    )`);
  }
  params.push(limit, offset);
  // DISTINCT ON : une seule ligne par annonce même si elle matche plusieurs mots-clés
  const sql = `
    SELECT * FROM (
      SELECT DISTINCT ON (l.id)
        l.*, kl.deal_score, kl.market_avg, kl.model_market_avg, kl.potential_profit, kl.matched_at,
        k.label AS keyword_label, k.id AS keyword_id,
        EXTRACT(EPOCH FROM (NOW() - l.first_seen_at)) / 3600 AS freshness_hours,
        da.recommendation, da.scam_risk, da.reasoning
      FROM keyword_listings kl
      INNER JOIN listings l ON l.id = kl.listing_id
      INNER JOIN keywords k ON k.id = kl.keyword_id
      LEFT JOIN deal_analyses da ON da.id = kl.analysis_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY l.id, kl.matched_at DESC
    ) t
    ORDER BY t.first_seen_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;
  return this.dataSource.query(sql, params);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend
npm run test -- --testPathPattern=listings.service
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/listings/listings.service.ts backend/src/listings/listings.service.spec.ts
git commit -m "feat(backend): add soloSeller filter to getListings"
```

---

### Task 2: Backend — expose `solo_seller` query param in controller

**Files:**
- Modify: `backend/src/listings/listings.controller.ts` (function `findAll`, lines 8-25)

- [ ] **Step 1: Add the query param and pass it to the service**

In `backend/src/listings/listings.controller.ts`, update `findAll()`:

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
) {
  return this.service.getListings({
    keywordId: keywordId ? parseInt(keywordId) : undefined,
    limit: limit ? parseInt(limit) : undefined,
    offset: offset ? parseInt(offset) : undefined,
    country: country || undefined,
    q: q || undefined,
    maxAgeHours: maxAgeHours ? parseInt(maxAgeHours) : undefined,
    soloSeller: soloSeller === '1' || soloSeller === 'true',
  });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd backend
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/listings/listings.controller.ts
git commit -m "feat(backend): expose solo_seller query param on GET /listings"
```

---

### Task 3: Frontend — extend `LatestListingsParams` and `latestQuery()`

**Files:**
- Modify: `frontend/src/lib/api.ts` (interface `LatestListingsParams` lines 84-91, function `latestQuery` lines 131-141)

- [ ] **Step 1: Add `soloSeller` to the interface and query builder**

In `frontend/src/lib/api.ts`:

Update the `LatestListingsParams` interface (lines 84-91):

```typescript
export interface LatestListingsParams {
  keywordId?: number;
  limit?: number;
  offset?: number;
  country?: string;
  q?: string;
  maxAgeHours?: number;
  soloSeller?: boolean;
}
```

Update `latestQuery()` — add one line after the `maxAgeHours` check (before `const s = qs.toString()`):

```typescript
if (p.soloSeller) qs.set('solo_seller', '1');
```

So the full function becomes:

```typescript
function latestQuery(p: LatestListingsParams): string {
  const qs = new URLSearchParams();
  if (p.keywordId) qs.set('keyword_id', String(p.keywordId));
  if (p.limit) qs.set('limit', String(p.limit));
  if (p.offset) qs.set('offset', String(p.offset));
  if (p.country) qs.set('country', p.country);
  if (p.q) qs.set('q', p.q);
  if (p.maxAgeHours) qs.set('max_age_hours', String(p.maxAgeHours));
  if (p.soloSeller) qs.set('solo_seller', '1');
  const s = qs.toString();
  return s ? `?${s}` : '';
}
```

- [ ] **Step 2: Verify it type-checks**

```bash
cd frontend
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(frontend): add soloSeller param to LatestListingsParams"
```

---

### Task 4: Frontend — add toggle button on the listings page

**Files:**
- Modify: `frontend/src/app/listings/page.tsx`

- [ ] **Step 1: Add `soloSeller` state and wire it into `baseParams()`**

In `frontend/src/app/listings/page.tsx`:

1. Add `UserCheck` to the lucide-react import:

```typescript
import { Newspaper, Filter, Search, Clock, Globe, RefreshCw, ChevronDown, UserCheck } from 'lucide-react';
```

2. Add the state after the `maxAgeHours` state declaration (around line 42):

```typescript
const [soloSeller, setSoloSeller] = useState(false);
```

3. Update `baseParams()` to include `soloSeller`:

```typescript
const baseParams = useCallback(() => ({
  keywordId: selectedKw,
  country: country || undefined,
  q: debouncedSearch || undefined,
  maxAgeHours,
  soloSeller: soloSeller || undefined,
  limit: PAGE_SIZE,
}), [selectedKw, country, debouncedSearch, maxAgeHours, soloSeller]);
```

- [ ] **Step 2: Add the toggle button in the filters bar**

In the filters bar (`<div className="bg-zinc-900/50 border ...">`, around line 131), add the toggle button between the freshness filter and the results count badge. Insert after the closing `</div>` of the freshness filter block (around line 200):

```tsx
{/* Solo seller toggle */}
<div className="w-full sm:w-auto flex items-end">
  <button
    onClick={() => setSoloSeller(v => !v)}
    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
      soloSeller
        ? 'bg-indigo-500/10 border-indigo-500 text-indigo-300'
        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
    }`}
  >
    <UserCheck size={14} />
    Vendeur unique
  </button>
</div>
```

- [ ] **Step 3: Verify the page builds and type-checks**

```bash
cd frontend
npm run build
```

Expected: no TypeScript errors, no build warnings about missing imports.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/listings/page.tsx
git commit -m "feat(frontend): add solo seller toggle to listings page"
```

---

## Self-Review

**Spec coverage:**
- ✅ `soloSeller` SQL subquery excludes sellers with >1 active listing (24h window) per keyword
- ✅ Backend `getListings()` opts extended
- ✅ Controller exposes `?solo_seller=1`
- ✅ `LatestListingsParams` extended, `latestQuery()` updated
- ✅ Toggle button in filters bar, indigo active state

**Placeholder scan:** None found.

**Type consistency:**
- `soloSeller` (camelCase) used throughout TypeScript; `solo_seller` (snake_case) used in HTTP query params — consistent with all existing params in this codebase (`keyword_id`, `max_age_hours`, etc.)
- `opts.soloSeller` referenced in service matches the opts type definition added in Task 1
