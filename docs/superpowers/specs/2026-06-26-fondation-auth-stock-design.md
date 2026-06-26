# Spec — Fondation (Auth compte Vinted) + Bloc A (Stock & commandes)

> Date : 2026-06-26
> Statut : design validé, prêt pour plan d'implémentation
> Périmètre : premier cycle de la transformation de Vinbot en outil de gestion vendeur (façon ControlResell, usage **personnel**, 1 compte Vinted)

## Contexte

Vinbot est aujourd'hui un bot de **sourcing** (achat) : il scrape Vinted.fr en lecture
anonyme, calcule des prix de marché et notifie les bonnes affaires. L'objectif global est
d'y greffer les outils côté **vente** (gestion vendeur), inspirés de ControlResell, pour un
usage perso sur **un seul compte Vinted**.

La transformation est découpée en blocs indépendants, chacun avec son propre cycle
spec → plan → code :

- **Fondation** : session authentifiée du compte + dialogue avec l'API vendeur Vinted
- **A. Stock & commandes** ← *ce document*
- B. Cycle de Vie (relist auto + baisse de prix auto)
- C. Création d'annonce IA (photos → annonce)
- D. Messagerie + offre auto aux favoris + négo IA
- E. Bordereaux en masse
- F. Analytics CA / bénéfices
- *(le sourcing actuel reste tel quel)*

Décisions de cadrage déjà prises avec l'utilisateur :

- **Outil perso**, pas un SaaS multi-clients → pas de multi-tenant, pas d'abonnements, pas
  de leaderboard/clan.
- **1 seul compte Vinted** → pas de messagerie multicompte, pas de cross-listing.
- **Risque de ban assumé** : l'automatisation d'écriture viole les ToS Vinted ; le risque
  de ban du compte est accepté en connaissance de cause.
- **Hébergement** : VM Linux sur la box de l'utilisateur, allumée 24/7, déjà sous Docker.
  C'est le « VPS maison ». Tout est conçu pour cette VM.
- **Stack conservée** : NestJS + TypeORM + PostgreSQL (`db/init.sql` source de vérité,
  `synchronize: false`) + Next.js 16. Pas de migration vers Prisma : les concepts du schéma
  Prisma proposé deviennent du SQL dans `init.sql`, même style que l'existant.

## Périmètre de ce cycle

### Inclus

**Fondation**
- Bouton « Connecter Vinted » dans le dashboard, façon ControlResell, via **navigateur
  streamé (noVNC)**.
- Capture et stockage chiffré de la session (cookies + storageState) du compte.
- Client HTTP authentifié (extension du `VintedClient` existant) pour parler à l'API Vinted
  avec la session du compte.
- Cycle de vie de la session : refresh automatique du token, détection d'expiration,
  basculement de statut + reconnexion guidée.

**Bloc A — Stock & commandes**
- Rapatriement des **annonces actives** avec leurs stats (prix, vues, favoris, statut).
- Rapatriement des **ventes / commandes** (acheteur, prix de vente, date, statut
  d'expédition).
- **Prix d'achat** saisi manuellement par article (base de calcul de marge).
- **Filtres** marque / taille / prix / catégorie sur la vue stock.

### Hors périmètre (blocs suivants)

- Écriture Playwright (relist, baisse de prix, publication) → **bloc B**.
- IA d'analyse photo / création d'annonce → **bloc C**.
- **Redis / BullMQ** : pas nécessaire pour de la synchro en lecture. Le scheduler NestJS
  existant suffit. BullMQ sera introduit au **bloc B** pour les jobs différés (« attendre
  5 jours », étalement des publications).

> **Précision archi importante** : Playwright/Chromium **est** introduit dès la fondation,
> mais **uniquement pour le login interactif** (navigateur streamé noVNC). Toutes les
> **lectures** de stock se font en **HTTP** avec les cookies capturés — pas via le navigateur.
> Playwright pour l'écriture viendra au bloc B.

## Architecture

### Nouveaux modules backend (NestJS, même style que l'existant)

| Module | Responsabilité |
|---|---|
| `accounts` | Le compte Vinted + sa session (cookies/storageState), statut de connexion, refresh du token |
| `vinted-connect` | Orchestration du flux noVNC : lance Chromium, sert le stream, capture la session à la fin du login |
| `inventory` | Synchro + stockage des produits / annonces vendeur / ventes. **Séparé** du module `listings` actuel (qui reste dédié au sourcing) |

### Nouveau service Docker

- Conteneur **`connect-browser`** = Chromium + Xvfb + serveur VNC + noVNC (websockify).
- Le frontend embarque le viewer noVNC dans une modale (bouton « Connecter Vinted »).

### Réutilisé

- La logique cookie-jar / HTTP du `VintedClient` existant, **étendue** pour injecter la
  session authentifiée du compte (en plus du mode anonyme actuel utilisé par le sourcing).

## Modèle de données (nouvelles tables dans `db/init.sql`)

> Rappel : `synchronize: false`. Toute table est écrite à la main dans `init.sql`, dans le
> style des tables existantes. Le module mémoire signale que `init.sql` peut être incomplet
> vis-à-vis du schéma réel — vérifier l'état réel de la base avant de recréer le volume.

```sql
-- Compte Vinted connecté + session
CREATE TABLE IF NOT EXISTS vinted_accounts (
  id              SERIAL PRIMARY KEY,
  label           VARCHAR(100) NOT NULL,
  vinted_user_id  BIGINT,
  session_data    JSONB,                 -- cookies + storageState, chiffré au repos
  status          VARCHAR(20) NOT NULL DEFAULT 'disconnected', -- connected|expired|disconnected
  connected_at    TIMESTAMPTZ,
  last_refresh_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Fiche inventaire enrichie (ce que Vinted ne connaît pas : prix d'achat, notes)
CREATE TABLE IF NOT EXISTS products (
  id              SERIAL PRIMARY KEY,
  account_id      INTEGER NOT NULL REFERENCES vinted_accounts(id) ON DELETE CASCADE,
  title           VARCHAR(500),
  brand           VARCHAR(255),
  size_label      VARCHAR(100),
  category        VARCHAR(100),
  condition_label VARCHAR(100),
  purchase_price  DECIMAL(10,2),         -- saisie manuelle
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Miroir des annonces Vinted du compte
CREATE TABLE IF NOT EXISTS seller_listings (
  id                SERIAL PRIMARY KEY,
  product_id        INTEGER REFERENCES products(id) ON DELETE SET NULL,
  account_id        INTEGER NOT NULL REFERENCES vinted_accounts(id) ON DELETE CASCADE,
  vinted_id         BIGINT UNIQUE NOT NULL,
  url               TEXT,
  price             DECIMAL(10,2),
  status            VARCHAR(20) NOT NULL DEFAULT 'ONLINE', -- ONLINE|RESERVED|SOLD|DELETED
  view_count        INTEGER,
  favourite_count   INTEGER,
  photo_url         TEXT,
  vinted_created_at TIMESTAMPTZ,
  last_synced_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Ventes / commandes
CREATE TABLE IF NOT EXISTS sales (
  id                SERIAL PRIMARY KEY,
  account_id        INTEGER NOT NULL REFERENCES vinted_accounts(id) ON DELETE CASCADE,
  seller_listing_id INTEGER REFERENCES seller_listings(id) ON DELETE SET NULL,
  vinted_order_id   BIGINT UNIQUE,
  buyer_name        VARCHAR(255),
  sale_price        DECIMAL(10,2),
  shipping_status   VARCHAR(50),
  sold_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_seller_listings_account ON seller_listings(account_id);
CREATE INDEX IF NOT EXISTS idx_seller_listings_status  ON seller_listings(status);
CREATE INDEX IF NOT EXISTS idx_seller_listings_product ON seller_listings(product_id);
CREATE INDEX IF NOT EXISTS idx_products_account        ON products(account_id);
CREATE INDEX IF NOT EXISTS idx_sales_account           ON sales(account_id);
```

À la synchro, chaque annonce Vinted sans `product` lié crée automatiquement un `product`
(héritant titre/marque/taille/catégorie) → l'utilisateur a immédiatement des lignes où
renseigner le prix d'achat.

## Flux de connexion (le bouton « Connecter Vinted »)

1. Clic « Connecter Vinted » → le backend lance Chromium dans le conteneur `connect-browser`
   sur `vinted.fr` → stream noVNC affiché dans une modale du dashboard.
2. L'utilisateur se connecte **à la main** (identifiants, 2FA, captcha Cloudflare inclus).
   Aucun mot de passe n'est stocké ni saisi automatiquement.
3. Détection du login réussi (présence des cookies d'auth / endpoint user qui répond) →
   capture des cookies + `storageState` → chiffrés au repos en base → `status = connected`,
   `connected_at` renseigné, `vinted_user_id` résolu.
4. Ensuite tout passe en **HTTP** : un job planifié (scheduler NestJS existant) rafraîchit le
   token et resynchronise le stock. Si le refresh échoue → `status = expired` + bannière
   « Reconnecte ton compte » dans le dashboard.

## Synchronisation du stock

- Job planifié (scheduler NestJS, pas BullMQ à ce stade) + bouton « Rafraîchir » manuel.
- Endpoints Vinted authentifiés à confirmer pendant l'implémentation (ex. items du membre,
  transactions/commandes). Le mapping JSON Vinted → entités sera isolé dans un service
  testable.
- Cadence **« humaine »** : on ne martèle pas Vinted (intervalle raisonnable, jitter).
- Upsert sur `vinted_id` pour les annonces ; upsert sur `vinted_order_id` pour les ventes.
- Statuts dérivés de l'état Vinted (en ligne / réservé / vendu / supprimé).

## Frontend (Next.js 16)

> Next.js **16** : APIs et conventions différentes de v14/v15. Vérifier
> `node_modules/next/dist/docs/` avant de toucher au routing ou à la config.

- **Page Compte / Réglages** : bouton « Connecter Vinted », statut de connexion, infos
  compte, action de reconnexion. Modale noVNC.
- **Page Inventaire** : DataTable (statut, prix, vues, favoris, **prix d'achat éditable
  inline**, marge estimée) + filtres marque / taille / prix / catégorie.
- **Page Ventes** : articles vendus (acheteur, prix de vente, statut d'expédition, date).

Communication front ↔ back : REST via `frontend/src/lib/api.ts` (préfixe `/api`), même
convention que l'existant.

## Gestion d'erreurs

- **Session expirée** : `status = expired`, bannière de reconnexion, le bouton relance le
  flux noVNC.
- **Rate limiting / blocage Vinted** : synchro bornée, intervalle + jitter ; en cas de 403,
  ne pas boucler agressivement.
- **Échecs de synchro** : logués proprement (préfigure la future page Logs/Tâches du bloc B).
- **Chiffrement de session** : `session_data` chiffré au repos via une clé d'environnement
  (ex. `SESSION_ENCRYPTION_KEY`).

## Tests

- **Unitaires** :
  - Logique de refresh / détection d'expiration de session.
  - Mapping JSON Vinted → entités (`seller_listings`, `sales`, `products`).
  - Calcul de marge estimée (prix de vente / prix d'achat).
- Réponses Vinted **mockées** (pas d'appel réseau réel en test).
- Le flux noVNC (interactif, navigateur réel) est validé manuellement, pas en test auto.

## Variables d'environnement (ajouts)

| Var | Notes |
|---|---|
| `SESSION_ENCRYPTION_KEY` | Clé de chiffrement au repos de `session_data` |
| (config noVNC / port du conteneur `connect-browser`) | À préciser dans le plan |

## Risques & points ouverts

- **Endpoints vendeur Vinted** : non documentés publiquement, à découvrir/confirmer pendant
  l'implémentation (items du membre, transactions). Risque de changement côté Vinted.
- **Ban du compte** : assumé, mais la cadence de synchro doit rester prudente même en
  lecture.
- **noVNC dans Docker headless** : Chromium + Xvfb + VNC + websockify à orchestrer
  proprement dans un conteneur ; détails (ports, sécurité d'accès au stream) à verrouiller
  dans le plan.
- **Détection de login réussi** : heuristique à définir (présence cookie d'auth vs endpoint
  user qui répond 200).
