# Live Feed — Design Spec

**Date:** 2026-05-28  
**Status:** Approved

## Overview

A dedicated `/live` page that streams all new Vinted listings in real-time as the scraper finds them, using the existing WebSocket infrastructure. Distinct from the `new-deal` flow which only fires for profitable listings.

## Backend Changes

### `DealsGateway` (`backend/src/notifications/deals.gateway.ts`)

Add `emitNewListing()` method emitting a `new-listing` event with payload:

```ts
{
  listingId: number;
  title: string;
  price: number;
  photoUrl: string | null;
  url: string | null;
  keywordLabel: string;
  vintedCreatedAt: string | null;
  dealScore: number | null;
  potentialProfit: number | null;
}
```

### `ScraperService` (`backend/src/scraper/scraper.service.ts`)

In `runFastScan()`, after each `upsertListing` call that returns `isNew = true`, call `dealsGateway.emitNewListing()`. The `dealScore` and `potentialProfit` fields are fetched from the resulting `keyword_listing` row if it exists, otherwise `null`.

No changes to the existing `new-deal` flow.

## Frontend Changes

### New hook: `useListingsSocket` (`frontend/src/lib/useListingsSocket.ts`)

Same pattern as `useDealsSocket`. Connects to the Socket.io server and calls `onListing(item)` on each `new-listing` event.

### New page: `/live` (`frontend/src/app/live/page.tsx`)

- Connects via `useListingsSocket`
- State: array capped at 200 items (prepend on new item, slice to 200)
- Filter bar (client-side): "Toutes" / "Rentables uniquement" (`potentialProfit > 0`)
- Live counter: "X annonces reçues depuis l'ouverture"
- WS connection indicator (green/red dot)

**Compact row** columns: thumbnail (32×32), title (truncated), price, keyword label, deal score (if available, colored), time received, external link to Vinted listing.

### Sidebar (`frontend/src/components/Sidebar.tsx`)

Add "Live" nav item with `Radio` or `Activity` icon from lucide-react, linking to `/live`.

## Data Flow

```
ScraperService.runFastScan()
  → upsertListing() returns isNew=true
  → dealsGateway.emitNewListing(payload)
  → WS event "new-listing" broadcast to all clients
  → useListingsSocket hook calls onListing()
  → /live page prepends item to state (cap 200)
  → row renders in feed
```

## Error Handling

- WS disconnect: show red dot indicator, items stop arriving. Reconnection is automatic (existing Socket.io reconnection logic).
- No market avg yet for a listing: `dealScore` and `potentialProfit` are `null`, display "—" in those columns.

## Out of Scope

- Persisting the live feed between page loads (intentionally ephemeral)
- Push notifications from the live feed
- Pagination or server-side filtering
