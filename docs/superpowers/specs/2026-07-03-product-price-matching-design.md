# Prix moyen par type de produit (catégories hétérogènes)

**Date :** 2026-07-03
**Statut :** Design validé, en attente de relecture

## Contexte & objectif

Le mot-clé "Piece info" (recherche par catégorie seule, `search_text` vide) mélange des
produits totalement hétérogènes : RAM, CPU, cartes mères, ventilateurs, disques durs,
voire des objets hors-sujet capturés par la catégorie Vinted. Une moyenne de marché
n'a de sens qu'au niveau du **type de produit précis** (ex. "RAM DDR4 8GB"), pas au
niveau du mot-clé entier.

À l'inverse, un mot-clé comme "Pokemon" mélange des lots de cartes différentes — hors
périmètre ici, ce chantier ne s'applique qu'aux mots-clés catégorie-seule.

**Constat de contexte important :** le CLAUDE.md du projet décrit un système
`computeMarketAvg`/`deal_score`/`potential_profit` qui n'existe plus dans le code — il a
été retiré par SP1 (`2026-06-18-sp1-remove-valuation-design.md`, commit `56884d0`) en
même temps que le pipeline Mistral. La table `model_market_avg` (ancien système,
groupé par titre quasi-exact) est restée orpheline dans la base de production —
`db/migrations/006_drop_valuation.sql` existe mais n'a jamais été appliqué en prod.
Ce chantier reconstruit un calcul de prix moyen, mais à la bonne granularité
(type de produit, pas titre exact ni mot-clé entier) et avec une approche hybride
algorithmique + IA en fallback plutôt que 100% IA.

Aujourd'hui, un mot-clé catégorie-seule alerte sur Telegram à **chaque** nouvelle
annonce qui matche les bornes de prix (comportement SP1). Ce chantier remplace ce
déclencheur, pour ces mots-clés précis, par un filtre basé sur le prix moyen du type de
produit.

## Périmètre

- **Inclus :** classification algorithmique + fallback Mistral des annonces des
  mots-clés catégorie-seule (`search_text` vide), calcul et stockage du prix moyen par
  type de produit, alerte Telegram et mise en avant visuelle conditionnées à ce calcul,
  affichage du prix moyen sur toute annonce classée.
- **Hors périmètre :** mots-clés avec texte de recherche (comportement SP1 inchangé —
  alerte sur tout match), valorisation du stock personnel (`products`/inventaire,
  restera un chantier séparé si abordé plus tard), nettoyage des tables orphelines
  `model_market_avg`/`deal_analyses` (à faire séparément, cf. Risques).

## A. Classification des annonces

### Clé de regroupement
Le "type de produit" est une clé texte normalisée, **caractéristiques techniques
uniquement, sans marque** (ex. `"RAM DDR4 8GB"`, `"CPU i5-2450M"`). Exclure la marque
maximise le volume par groupe et atteint plus vite le seuil de fiabilité (voir plus
bas), quitte à mélanger des marques de gammes différentes.

### Méthode hybride
1. **Règles (synchrone, à l'ingestion)** : `ProductClassifierService.classifyByRules
   (title, catalogId)` — dictionnaire de familles de produits (RAM, CPU, GPU, stockage,
   alimentation, ventilation…) détectées par mots-clés dans le titre, puis extraction
   par regex des attributs pertinents à la famille (capacité "8GB/16GB", génération
   "DDR3/DDR4/DDR5" pour la RAM ; référence type "i5-2450K" pour un CPU). Retourne
   `null` si aucune famille reconnue. Pas d'appel réseau, ne ralentit jamais le scan.
2. **Fallback Mistral (asynchrone, différé)** : pour les titres non reconnus par les
   règles, un tick périodique dédié (~60s, par lots de ~20, même mécanique que le tick
   `availability` existant dans `ScraperService`) appelle l'API Mistral pour extraire
   un type de produit. Pas de file BullMQ/Redis (repoussé au bloc B du pivot
   ControlResell, cf. mémoire `controlresell-pivot`) — une simple boucle de scan
   suffit vu le volume.
3. **Échec définitif** : après 3 tentatives Mistral infructueuses (erreur API, ou
   réponse vide/non exploitable), `listings.product_type_key` passe à la valeur
   sentinelle `'unclassified'` pour arrêter les tentatives. L'annonce reste affichée
   normalement, simplement jamais éligible à une alerte/mise en avant.

### Priorité entre règles ambiguës
Si un titre matche plusieurs règles, la première de la liste (ordre de déclaration)
l'emporte — pas de logique de scoring, garde l'implémentation simple et déterministe.

## B. Modèle de données

### Nouvelle table `product_type_stats`
```sql
CREATE TABLE product_type_stats (
  keyword_id     INT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  product_type_key VARCHAR(200) NOT NULL,
  avg_price      DECIMAL(10,2),
  item_count     INT NOT NULL DEFAULT 0,
  last_updated   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (keyword_id, product_type_key)
);
```
`avg_price` = moyenne tronquée (retire les 10% de prix les plus hauts et les plus bas)
ou médiane sur les prix connus du groupe — **pas une moyenne simple** — pour absorber
les annonces "pour pièces"/cassées à prix cassé et les erreurs de classification
isolées. Recalculée à l'insertion de chaque nouvelle annonce du groupe (volume par
groupe = dizaines/centaines, coût négligeable).

Scope par `keyword_id` : deux mots-clés catégorie-seule différents ne peuvent jamais
partager un groupe, même avec une clé de type de produit proche.

### Nouvelles colonnes
- `listings.product_type_key VARCHAR(200)` nullable — `NULL` = pas encore classé,
  `'unclassified'` = classification abandonnée après échecs Mistral.
- `keyword_listings.deal_score DECIMAL(5,2)` nullable — `(avg_price - prix) / avg_price
  * 100`, calculé **une seule fois** à la classification (snapshot, pas recalculé
  rétroactivement quand la moyenne du groupe évolue ensuite).

### Application du schéma
Comme le reste du projet (pas de runner de migration, cf. mémoire
`schema-no-migration-runner`) : création idempotente (`CREATE TABLE/COLUMN IF NOT
EXISTS`) au démarrage du service concerné (même pattern que `scraper_state` et les
colonnes `availability_*` dans `ScraperService.ensureListingSchema`), **et** miroir
dans `db/init.sql` + nouvelle migration `db/migrations/009_add_product_type_matching.sql`
pour les installs neuves et la cohérence documentaire.

### Config
- `MISTRAL_API_KEY` ajouté à `.env.example` (retiré par SP1, réintroduit ici — usage
  différent : fallback de classification, pas d'analyse de deal complète).
- Seuil "intéressant" : `deal_score >= 20` (20% sous le prix moyen du groupe) par
  défaut, constante `DEAL_SCORE_THRESHOLD` dans `ScraperService`. Seuil de fiabilité :
  `item_count >= 5`, constante `MIN_RELIABLE_ITEM_COUNT`. Pas de config par mot-clé
  (cohérent avec l'activation automatique sur `search_text` vide) ; ajustables au
  besoin sans migration puisque ce sont de simples constantes de code.

## C. Pipeline (scraper)

Dans `ScraperService.scanKeywordCountry`, juste après `upsertListing`, si
`keyword.search_text` est vide et l'annonce est nouvelle :

1. `classifier.classifyByRules(title, catalog_id)`.
   - Reconnu → écrit `listings.product_type_key`, upsert `product_type_stats`
     (recalcule moyenne tronquée + `item_count + 1`).
   - Non reconnu → `product_type_key` reste `NULL`, repris par le sweep Mistral.
2. Si classifié et `item_count >= 5` : calcule `deal_score`, l'écrit sur
   `keyword_listings.deal_score`.
3. Décision d'émission/alerte (remplace `maybeAlertNewListing` inconditionnel pour ces
   mots-clés uniquement) :
   - Pas classifié, ou classifié mais `item_count < 5` → pas d'alerte Telegram, pas de
     mise en avant. L'event WS `new-listing` part quand même, `avgPrice`/`dealScore`/
     `isDeal` à `null`/`false`.
   - Classifié, fiable, `deal_score >= seuil` → `isDeal: true`, alerte Telegram (dédup
     `notifications_log` inchangée), event WS avec `avgPrice` et `dealScore` renseignés.
   - Classifié, fiable, `deal_score < seuil` → pas d'alerte, mais `avgPrice` est quand
     même renseigné dans l'event WS (affiché sur la carte même sans highlight).

### Sweep Mistral (nouveau tick)
Nouvelle méthode `scheduleClassificationTick` dans `ScraperService`, même schéma que
`scheduleAvailabilityTick` : toutes les ~60s, sélectionne jusqu'à ~20 `listings` avec
`product_type_key IS NULL` sur un mot-clé catégorie-seule, appelle Mistral, met à jour
`product_type_key` + `product_type_stats`. Si la classification différée rend une
annonce déjà affichée fiable et intéressante :
- déclenche l'alerte Telegram à ce moment (toujours dédupliquée par
  `notifications_log`) ;
- émet un nouvel event WS `deal-updated` (`listingId`, `avgPrice`, `dealScore`,
  `isDeal`) pour que le frontend mette à jour la carte déjà affichée sans recharger.

Cette boucle est indépendante du tick de scan principal (Vinted) — comme
`availability` aujourd'hui, elle ne bloque jamais le scan.

## D. Backend — API

`ListingsService.getListings` (utilisé par la page "Dernières annonces" au chargement,
pas seulement en live) : `LEFT JOIN product_type_stats` via `l.product_type_key =
pts.product_type_key AND kl.keyword_id = pts.keyword_id` pour renvoyer `avg_price` et
`kl.deal_score` dans chaque ligne, plus un booléen `is_deal` calculé côté SQL
(`deal_score >= seuil`). Nouveau paramètre optionnel `onlyDeals` sur `getListings` (et
la route `/listings`) pour filtrer côté serveur — cohérent avec les filtres existants
(`soloSeller`, `maxAgeHours`…) qui sont déjà des paramètres serveur.

## E. Frontend

- `frontend/src/lib/listingEvent.ts` (`ListingEvent`) : ajoute `avgPrice: number | null`,
  `dealScore: number | null`, `isDeal: boolean`.
- `frontend/src/lib/api.ts` (`Listing`/`KeywordListing`) : mêmes champs, alimentés
  depuis la réponse REST de `getListings`.
- Nouvel event WS `deal-updated` consommé par `useListingsSocket` (ou un hook dédié) :
  met à jour in-place l'item existant dans la grille (`items` state de
  `listings/page.tsx`) sans le déplacer.
- `DealCard` : affiche le prix moyen (`avgPrice`) dès qu'il est disponible, quelle que
  soit la valeur de `isDeal` ; applique un style de mise en avant (bordure/pulse) quand
  `isDeal === true`.
- `listings/page.tsx` : nouveau toggle "Bonnes affaires uniquement" à côté de "Vendeur
  unique", ajoute `onlyDeals` à `baseParams()` (filtre serveur, cohérent avec les
  autres filtres) et à `matchesFilters` pour le live WS (n'injecte en tête que les
  events avec `isDeal: true` quand le toggle est actif).

## F. Gestion d'erreurs

- Mistral indisponible/erreur/quota → le sweep retente au tick suivant ; après 3
  échecs consécutifs, `product_type_key = 'unclassified'`, plus jamais retenté,
  annonce toujours visible normalement.
- Règles ambiguës → priorité déterministe à l'ordre de déclaration des règles.
- Le sweep Mistral échoue à joindre l'API → log + skip du lot, ne bloque pas le tick
  de scan principal ni les autres sweeps (availability, seller check).

## G. Tests

- `ProductClassifierService` (règles) : titres RAM/CPU représentatifs de l'échantillon
  réel (`"16GB DDR3 Corsair xms..."`, `"Intel Core i7 4790K"`) → bonne clé ; titre hors
  périmètre (`"Lampadario a ventilatore"`) → `null`.
- Calcul de moyenne tronquée dans `product_type_stats` : jeu de prix incluant un
  outlier bas type "pour pièces" → vérifie qu'il est exclu du résultat.
- `ScraperService.scanKeywordCountry` : annonce classifiée fiable + `deal_score >=
  seuil` → `emitNewListing` avec `isDeal: true` et `TelegramService.sendListingAlert`
  appelé ; sous le seuil → pas d'appel Telegram ; `item_count < 5` → pas d'alerte du
  tout malgré un `deal_score` potentiellement élevé.
- Sweep Mistral : mock d'échecs répétés → passe à `'unclassified'` après 3 tentatives
  et n'est plus resélectionné par la requête du sweep suivant.

## H. Vérification

- **Backend :** `npm run build` ; `npm test` (nouveaux specs + `scraper.service.spec`
  et `listings.service.spec` mis à jour).
- **Frontend :** `npx tsc --noEmit` ; `npm run build`.
- **Manuel :** sur la VM (`ssh -p 50022 freebox@88.165.36.69`), après application de la
  migration, vérifier qu'une nouvelle annonce "Piece info" reconnue par les règles
  affiche son prix moyen sur la carte, que le toggle "Bonnes affaires uniquement"
  filtre bien, et qu'une alerte Telegram part uniquement au-dessus du seuil une fois le
  groupe fiable (≥5 annonces).

## I. Risques & notes

- **Volume Telegram réduit pour "Piece info"** : les tout premiers exemplaires d'un
  type de produit rare (< 5 annonces vues) ne déclenchent jamais rien tant que le
  seuil de fiabilité n'est pas atteint — accepté explicitement (cf. cadrage).
- **Coût/latence Mistral** : limité à la traîne des titres non reconnus par les règles
  grâce au sweep différé ; le dictionnaire de règles doit être étoffé au fil de
  l'usage pour réduire cette traîne dans le temps.
- **Reliquat `model_market_avg`/`deal_analyses`** : toujours présents en base de prod
  (migration 006 jamais appliquée), non réutilisés par ce chantier (nouvelle table
  `product_type_stats` distincte). Un nettoyage séparé reste à faire.
- **Qualité du dictionnaire de règles** : au lancement, seules les familles RAM/CPU
  sont couvertes en priorité (dominantes dans l'échantillon observé) ; GPU, stockage,
  alimentation, ventilation à ajouter progressivement.
