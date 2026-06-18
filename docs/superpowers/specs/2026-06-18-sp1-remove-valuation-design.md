# SP1 — Débrancher la valorisation + Telegram déclenché par les filtres

**Date :** 2026-06-18
**Statut :** Design validé, en attente de relecture
**Sous-projet :** 1/4 du chantier de refonte (SP1→SP2 multi-utilisateurs→SP3 persistance filtres→SP4 PWA)

## Contexte & objectif

Le prix moyen de marché (médiane des prix *demandés*) est jugé non fiable ; les
fonctions qui en dépendent (opportunités, deals validés) ont déjà été retirées du
produit (pivot du flux filtré). SP1 va plus loin : **retirer entièrement le moteur de
valorisation** (calcul de prix moyen, deal_score, profit, pipeline Mistral) et
**remplacer le déclencheur d'alerte Telegram** — qui reposait sur un profit calculé —
par un déclencheur basé sur le **matching du mot-clé**.

## Périmètre

- **Inclus :** retrait du code et du schéma de valorisation, retrait du pipeline
  Mistral, simplification du scraper, nouveau déclencheur Telegram, nettoyage frontend
  associé.
- **Hors périmètre (sous-projets ultérieurs) :** multi-utilisateurs (SP2), persistance
  des filtres (SP3), PWA (SP4). En particulier, l'alerte Telegram de SP1 vise le chat
  global `TELEGRAM_CHAT_ID` actuel ; le routage par utilisateur sera traité en SP2.

## A. Déclencheur Telegram

- Une alerte part dès qu'une annonce est vue pour la **première fois** (`isNew`) lors
  d'un scan de mot-clé. L'annonce est déjà conforme aux critères du mot-clé (recherche
  ET via `filterByTitle`, fourchette `min_price`/`max_price`, `catalog_id`, pays).
- **Pas** de re-déclenchement sur baisse de prix d'une annonce déjà connue.
- Déduplication conservée : `notifications_log` (1 message max par annonce/mot-clé par
  24 h).
- Message = faits bruts : titre, prix, marque, état, libellé du mot-clé, drapeau pays,
  lien Vinted. Plus aucun score/prix moyen/profit.
- Destination : `TELEGRAM_CHAT_ID` global (re-câblé par utilisateur en SP2).
- Volume maîtrisé par la précision du mot-clé.

## B. Backend — retrait de la valorisation

### `backend/src/listings/listings.service.ts`
- Supprimer : `computeMarketAvg`, `fetchPrices`, `updateModelMarketAvg`,
  `rescoreWithModel`, `saveDealAnalysis`, `getOpportunities`, `getValidated`,
  `getListingsWithoutModel`, `updateListingModel`, le helper `median`, les constantes
  `MIN_MODEL_ITEMS`/`MIN_KEYWORD_ITEMS`.
- `upsertListing` : ne calcule plus rien ; insère/maj l'annonce + historique de prix,
  upsert `keyword_listings` (clé + `matched_at`), et retourne `{ listing, isNew,
  priceChanged }`.
- `getListings` (le flux) : retirer des `SELECT` les colonnes `kl.deal_score`,
  `kl.market_avg`, `kl.model_market_avg`, `kl.potential_profit`, et la jointure
  `LEFT JOIN deal_analyses` + `da.recommendation/scam_risk/reasoning`. Conserver
  `kl.seller_item_count`, le filtre solo-seller, pays, recherche, fraîcheur.
- `getListing` (détail) : retirer la récupération `analysisRepo`/analysis.
- `getStats` : retirer `validated_deals` (et sa requête `deal_analyses`).
- Retirer les injections de repos devenues inutiles (`ModelMarketAvg`, `DealAnalysis`).

### Mistral — suppression complète
- Supprimer `backend/src/analysis/` (MistralService, AnalysisModule, async-queue si
  uniquement utilisé là, entités `DealAnalysis` et `ModelMarketAvg`, specs associées).
- Retirer `AnalysisModule` des imports de `ScraperModule` et de `ListingsModule`.
- Retirer le `MistralController`/endpoint `/mistral/test` s'il existe.
- Retirer `MISTRAL_API_KEY` de `docker-compose.yml` et `.env.example`.

### `backend/src/scraper/scraper.service.ts`
- Supprimer : `modelQueue`, `analysisQueue`, `processModelExtraction`,
  `processDealAnalysis`, `bootstrapNewKeywords` + constantes BOOTSTRAP_*, `marketTick`/
  `runMarketScan` + `scheduleMarketTick`, `maybeAlertClassic`, `backfillMistral`, les
  constantes AI_*.
- Conserver : `fastTick`/`runFastScan` (scan page 1 par mot-clé × pays), `sellerQueue`
  + `processSellerCheck` (filtre vendeur unique), pause/reprise (`scraper_state`),
  `getStatus` (en retirant les stats de queues supprimées), `backfill` (peuplement du
  flux, sans valorisation).
- `runFastScan` : pour chaque annonce `isNew`, émettre l'event WebSocket
  `emitNewListing` **et** déclencher l'alerte Telegram (via un nouveau
  `maybeAlertNewListing(listing, keyword, countryCode)` qui respecte la dédup
  `notifications_log`).

### `backend/src/notifications/`
- `DealsGateway` : retirer `emitNewDeal` (lié à la valorisation), conserver
  `emitNewListing`.
- `TelegramService` : adapter/ajouter une méthode d'alerte "nouvelle annonce" sans
  paramètres de valorisation (signature type `sendListingAlert(listing, keyword,
  countryCode)`), retirer `sendDealAlert`.

### Contrôleurs
- `ListingsController` : retirer les routes `/listings/opportunities` et
  `/listings/validated`.
- `ScraperController` : retirer `/scraper/backfill-mistral`.

## C. Schéma — nettoyage complet

### Migration `db/migrations/006_drop_valuation.sql` (destructive, `IF EXISTS`)
```sql
ALTER TABLE keywords        DROP COLUMN IF EXISTS target_margin;
ALTER TABLE keywords        DROP COLUMN IF EXISTS shipping_estimate;
ALTER TABLE keywords        DROP COLUMN IF EXISTS market_scan_pages;
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
- **Conservé** : `keyword_listings.seller_item_count`/`seller_checked_at`,
  `listings.seller_country`/`country_code`/`vinted_created_at`/`view_count`/
  `favourite_count`, table `price_history`, table `scraper_state`.

### `db/init.sql` (miroir, installs neuves)
- `keywords` : retirer `target_margin`, `shipping_estimate`.
- `keyword_listings` : retirer `deal_score`, `market_avg`, `potential_profit`.
- (Les autres colonnes/tables visées par la migration n'existent déjà pas dans
  `init.sql` — rien à y retirer.)

### Application
Pas de runner de migration et migration **destructive** → application **manuelle**
documentée, pas d'auto-exécution au démarrage. Commande (depuis la racine, conteneur
DB up) :
```bash
docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" < db/migrations/006_drop_valuation.sql
```

## D. Frontend

### `frontend/src/app/keywords/` (formulaire mot-clé)
- Retirer les champs **marge cible** (`target_margin`) et **frais de port**
  (`shipping_estimate`) de la création/édition et de tout affichage.

### `frontend/src/app/settings/page.tsx`
- Retirer le panneau de test Mistral (`testMistral`, état associé, bloc UI, import
  `Brain`).

### `frontend/src/app/listings/[id]/page.tsx` (détail)
- Retirer tout affichage de valorisation/analyse IA (deal_score, market_avg, profit,
  recommandation, scam_risk, raisonnement). Conserver titre, prix, photos, badges,
  historique de prix, lien Vinted.

### `frontend/src/lib/` (types & socket)
- `api.ts` : retirer `target_margin`/`shipping_estimate` de `Keyword` ; `validated_deals`
  de `Stats` ; alléger `KeywordListing` (retrait `deal_score`, `market_avg`,
  `potential_profit`, `recommendation`, `scam_risk`, `analysis_confidence`, et
  `reasoning` sur `Listing`) ; retirer `api.mistral`. Adapter `rowToKeywordListing` en
  conséquence.
- `useDealsSocket.ts` / page Live : s'assurer que le flux temps réel consomme
  `new-listing` (et non `new-deal` supprimé) ; adapter le type d'event si besoin.

## E. Vérification

- **Backend :** `npm run build` (0 erreur) ; `npm test` (adapter/retirer les specs qui
  testaient la valorisation : `listings.service.spec`, `mistral.service.spec`) ; le
  scraper démarre sans les modules Mistral.
- **Frontend :** `npx tsc --noEmit` ; `npm run build`.
- **Manuel :** après application de la migration sur une base de test, une nouvelle
  annonce ramenée par un mot-clé déclenche une alerte Telegram ; le flux `/listings`,
  le détail et Live s'affichent sans erreur.

## F. Risques & notes

- **Migration destructive** : perte définitive des colonnes/tables de valorisation.
  Recommander une sauvegarde (`pg_dump`) avant application. Réversibilité nulle côté
  données.
- **Charge Vinted** : sans bootstrap ni market scan, moins de requêtes — plutôt
  bénéfique (moins de risque de ban).
- **Telegram** : le volume d'alertes augmente potentiellement (1 par nouvelle annonce
  matchée vs. seulement les "deals"). Volume contrôlé par la précision des mots-clés ;
  un éventuel garde-fou (plafond/heure) pourra être ajouté plus tard si besoin.
- **SP2** dépendra de ce socle : le `maybeAlertNewListing` et l'ownership des mots-clés
  seront étendus par utilisateur.
