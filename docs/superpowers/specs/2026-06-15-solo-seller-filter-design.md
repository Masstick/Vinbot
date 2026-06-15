# Solo Seller Filter

**Date:** 2026-06-15
**Status:** Approved

## Problem

When hunting deals on specific categories (e.g. Pokémon cards), professional resellers flood the results with many listings. These sellers know the market price well and rarely underprice. The best deals come from occasional sellers who are listing a single item and may not know its true value.

## Goal

Add a toggle filter on the listings page that shows only listings where the seller has no other active listing in the same keyword's results.

## Architecture

### Backend — `ListingsService.getListings()`

Add a `soloSeller?: boolean` option to the existing `opts` parameter of `getListings()` in `backend/src/listings/listings.service.ts`.

When `soloSeller` is `true`, inject the following condition into the WHERE clause:

```sql
AND l.seller_id NOT IN (
  SELECT l2.seller_id
  FROM listings l2
  INNER JOIN keyword_listings kl2 ON kl2.listing_id = l2.id
  WHERE kl2.keyword_id = kl.keyword_id
    AND l2.last_seen_at > NOW() - INTERVAL '24 hours'
  GROUP BY l2.seller_id
  HAVING COUNT(*) > 1
)
```

"Active" is defined as `last_seen_at > NOW() - 24h`, consistent with `getOpportunities()`.

When no `keywordId` filter is provided, the subquery uses `kl.keyword_id` (the join column), so the filter applies per-keyword correctly.

### Backend — `ListingsController`

Add `solo_seller` as an optional query param on `GET /listings`. Parse it as boolean (`solo_seller=1` or `solo_seller=true`) and pass it to `getListings()`.

### Frontend — `api.ts`

- Add `soloSeller?: boolean` to `LatestListingsParams` interface.
- In `latestQuery()`, add: `if (p.soloSeller) qs.set('solo_seller', '1')`.

### Frontend — `listings/page.tsx`

- Add `const [soloSeller, setSoloSeller] = useState(false)`.
- Include `soloSeller` in `baseParams()`.
- Add a toggle button in the filters bar, between the freshness filter and the results count:
  - Inactive: `bg-zinc-950 border-zinc-800 text-zinc-400`
  - Active: `bg-indigo-500/10 border-indigo-500 text-indigo-300`
  - Icon: `UserCheck` from lucide-react
  - Label: "Vendeur unique"

## Data Flow

```
User clicks toggle
  → soloSeller=true → baseParams() updated
  → load(true) triggered via useEffect([load])
  → GET /listings?solo_seller=1&keyword_id=X
  → ListingsService.getListings({ soloSeller: true, keywordId: X })
  → SQL subquery excludes multi-listing sellers
  → Filtered results returned and rendered
```

## Scope

- Only affects the `/listings` page.
- No schema changes.
- No impact on scraping, notifications, or deal scoring.
- No new components or pages.

## Out of Scope

- Persisting the filter preference across sessions.
- Applying the filter to Telegram alerts or WebSocket events.
