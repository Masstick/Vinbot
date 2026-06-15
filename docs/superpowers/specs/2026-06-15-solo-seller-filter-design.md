# Solo Seller Filter

**Date:** 2026-06-15
**Status:** Approved

## Problem

When hunting deals on specific categories (e.g. Pokémon cards), professional resellers flood the results with many listings. These sellers know the market price well and rarely underprice. The best deals come from occasional sellers who are listing a single item and may not know its true value.

## Goal

Add a toggle filter on the listings page that shows only listings where the seller has no other active listing in the same keyword's results.

## Architecture

> **Révision (2026-06-15)** : l'approche initiale comptait les annonces présentes
> dans *notre* DB. C'est faussé — on ne connaît que ce qu'on a scrapé (souvent la
> page 1 d'un mot-clé), donc un pro passait à travers. La détection se fait
> désormais sur le **profil Vinted réel du vendeur**, mis en cache.

### Détection — profil vendeur, vérifié en arrière-plan

`VintedClient.countSellerItemsMatching(sellerId, searchText)` interroge
`GET /api/v2/users/{id}/items` et compte les annonces actives du vendeur dont le
titre matche les tokens du mot-clé (réutilise `filterByTitle`). Retourne `null`
en cas d'erreur pour ne pas polluer le cache.

Le scraper (`ScraperService`) programme ces vérifications via une `AsyncQueue`
throttlée à 1/sec (`sellerQueue`), dédupliquée par `${keywordId}:${sellerId}`
avec un TTL de 6h — une vérif profil sert toutes les annonces du vendeur pour ce
mot-clé. Un appel live par annonce affichée serait impossible (48 req → ban).

### Stockage — `keyword_listings`

Deux colonnes (migration `003_add_seller_item_count.sql`) :
- `seller_item_count INTEGER` — nb d'annonces du vendeur matchant le mot-clé. `NULL` = pas encore vérifié.
- `seller_checked_at TIMESTAMPTZ` — horodatage de la dernière vérif.

`ListingsService.updateSellerItemCount(keywordId, sellerId, count)` propage le
compte sur toutes les `keyword_listings` du vendeur pour ce mot-clé.

### Filtre — `ListingsService.getListings()`

Avec `soloSeller = true` :

```sql
AND kl.seller_item_count IS NOT NULL AND kl.seller_item_count <= 1
```

`NULL` (non vérifié) est exclu : on n'affiche que des vendeurs uniques **confirmés**.
Les annonces fraîchement scrapées apparaissent dès que la file les a traitées.

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
