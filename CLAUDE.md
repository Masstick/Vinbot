# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Vinbot

A Vinted deal-hunting bot: it scrapes Vinted.fr for second-hand listings matching configured keywords, computes a market average price and profit potential, then fires Telegram notifications and real-time WebSocket alerts to a dashboard.

## Project Structure

```
backend/           NestJS API — scraper, business logic, WebSocket gateway
frontend/          Next.js 16 dashboard — deal feed, keywords management
db/                init.sql — PostgreSQL schema (source of truth, no migrations)
connect-browser/   Sidecar Docker (Chromium + Xvfb + x11vnc + noVNC) — navigateur streamé pour la connexion au compte Vinted
docker-compose.yml
```

## Development Commands

### Full stack (recommended)
```bash
# Copy and fill env vars first
cp .env.example .env

# Start everything (Postgres + API + Frontend)
docker compose up --build
```
- API → http://localhost:3003
- Frontend → http://localhost:3002

### Backend (local dev, needs a running Postgres)
```bash
cd backend
npm install
npm run start:dev      # watch mode, hot reload
npm run build          # compile to dist/
npm run test           # unit tests (Jest)
npm run test:e2e       # e2e tests
npm run test -- --testPathPattern=scraper  # run a single test file
npm run lint           # ESLint --fix
npm run format         # Prettier
```

Backend listens on port **3001** by default (`PORT` env var overrides).

### Frontend (local dev)
```bash
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:3001 npm run dev   # port 3000
npm run build
npm run lint
```

> **Important:** `NEXT_PUBLIC_API_URL` is baked in at Next.js build time. In Docker it is passed as a build arg. This is Next.js **16** — APIs and conventions differ from v14/v15, check `node_modules/next/dist/docs/` before touching routing or config.

## Architecture & Data Flow

### Backend NestJS modules

| Module | Responsibility |
|---|---|
| `keywords` | CRUD for search keyword configurations (label, search text, price range, catalog_id, scan interval, target margin) |
| `listings` | Vinted listing storage + market average computation + upsert logic |
| `scraper` | Scheduled 15 s tick → processes keywords whose `scan_interval_seconds` has elapsed |
| `notifications` | Telegram alerts + Socket.io `DealsGateway` for real-time push |
| `accounts` | Compte Vinted connecté : session chiffrée, statut, refresh, flux de connexion noVNC (via le sidecar connect-browser) |
| `inventory` | Stock vendeur : synchro HTTP authentifiée (articles + ventes), produits/annonces/ventes, calcul de marge |

### Scrape cycle (ScraperService)
1. Every 15 s, `tick()` calls `processNextDueKeyword()`
2. Active keywords overdue for a scan are batched; 5 s delay between keywords
3. `VintedClient.search()` hits `https://www.vinted.fr/api/v2/catalog/items` with a cookie-jar session; on 403 the session is reset and a `BANNED` error bubbles up (→ 60 s pause)
4. Each item is `upsertListing()`-ed: new listings are inserted + price history recorded; existing ones get `last_seen_at` updated and price history appended if changed
5. `computeMarketAvg()` uses a trimmed mean of the last 200 prices for that keyword (removes top 10% and bottom 10%, ignores outliers > 5× median)
6. `deal_score = (marketAvg - price) / marketAvg * 100`; `potential_profit = marketAvg - price - shippingEstimate`
7. If `potential_profit >= target_margin`: Telegram notification (deduplicated per listing per 24 h via `notifications_log`) + WebSocket `new-deal` event to all connected dashboards

### Database schema (`db/init.sql`)
- `keywords` — search configs
- `listings` — Vinted item data (unique on `vinted_id`)
- `keyword_listings` — join table with computed `deal_score`, `market_avg`, `potential_profit`
- `price_history` — append-only price log per listing
- `notifications_log` — alert dedup log

**TypeORM `synchronize: false`** — schema is managed exclusively by `db/init.sql`. Never enable synchronize; write schema changes directly in that file and recreate the container volume.

### Frontend → Backend communication
- **REST:** `frontend/src/lib/api.ts` — all calls prefixed `/api`, base URL from `NEXT_PUBLIC_API_URL`
- **WebSocket:** `frontend/src/lib/useDealsSocket.ts` — Socket.io client, listens for `new-deal` events, used for live toast notifications in the dashboard

## Environment Variables

See `.env.example`. Key vars:

| Var | Default | Notes |
|---|---|---|
| `DB_*` | postgres/changeme | Database connection |
| `TELEGRAM_BOT_TOKEN` | — | Required for Telegram alerts |
| `TELEGRAM_CHAT_ID` | — | Target chat/channel |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | Frontend build-time API base |
| `SESSION_ENCRYPTION_KEY` | — | Encryption key for Vinted session storage (change in prod) |
| `CDP_URL` | — | Chrome DevTools Protocol URL (connect-browser sidecar) |
| `NEXT_PUBLIC_NOVNC_URL` | — | noVNC WebSocket URL for browser streaming (frontend build-time) |
