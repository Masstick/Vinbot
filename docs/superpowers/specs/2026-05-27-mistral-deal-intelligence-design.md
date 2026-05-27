# Vinbot — Mistral Deal Intelligence

**Date:** 2026-05-27  
**Status:** Approved  
**Scope:** Backend pipeline intelligence + scanning optimisé + dashboard "Deals validés"

---

## Objectif

Remplacer le scoring brut (prix vs moyenne keyword) par une chaîne intelligente :
1. Extraction du modèle exact via Mistral (i7-12700K ≠ i7-920)
2. Moyenne de marché calculée **par modèle** au lieu de par keyword
3. Analyse de légitimité par IA sur les vrais candidats
4. Dashboard `/validated` ne montrant que les deals confirmés

---

## 1. Architecture de scanning (deux tiers)

Deux `@Interval` indépendants dans `ScraperService` :

| Tier | Intervalle | Pages | Comportement |
|---|---|---|---|
| **Fast scan** | 30s | Page 1 seulement | Nouveaux items → pipeline complet (extraction + scoring + analyse si deal) |
| **Market scan** | 10 min | Pages 2 à `market_scan_pages` | Extraction modèle uniquement, alimente `model_market_avg`, pas d'alertes |

- `market_scan_pages` est un champ par keyword (défaut: 5)
- Le fast scan remplace le tick actuel (actuellement 15s, une seule page)
- Le market scan est silencieux : pas de WebSocket, pas de Telegram

---

## 2. Pipeline Mistral 2 passes

### Pass 1 — Extraction modèle (tous les nouveaux items)

**Déclencheur :** chaque item avec `is_new = true` lors du fast scan  
**Modèle Mistral :** `mistral-small-latest`  
**Coût estimé :** ~0.001€/call  
**Latence :** ~300ms

**Prompt :**
```
Extrait le modèle exact de cet article Vinted en quelques mots normalisés.
Titre: "{title}"
Prix: {price}€

Réponds uniquement en JSON:
{"model_label": "modèle normalisé (ex: Intel Core i7-12700K, RTX 3080 10GB)", "confidence": 0.0-1.0}
Si le titre est trop vague pour identifier un modèle précis, renvoie {"model_label": null, "confidence": 0.0}
```

**Résultat stocké :** `listings.model_label`, `listings.model_confidence`

### Pass 2 — Analyse deal (candidats seulement)

**Déclencheur :** `potential_profit >= target_margin` ET `model_market_avg` calculable  
**Modèle Mistral :** `mistral-small-latest`  
**Coût estimé :** ~0.002€/call  
**Latence :** ~500ms

**Prompt :**
```
Analyse cette annonce Vinted pour un acheteur-revendeur.
Titre: "{title}"
Modèle identifié: {model_label}
Prix demandé: {price}€
État: {condition_label}
Vendeur: {seller_name}
Moyenne marché pour "{model_label}": {market_avg}€ (sur {item_count} annonces)
Profit potentiel estimé: {potential_profit}€

Réponds uniquement en JSON:
{
  "legitimate": true/false,
  "scam_risk": "low|medium|high",
  "confidence": 0.0-1.0,
  "recommendation": "buy|watch|skip",
  "reasoning": "2-3 phrases en français expliquant le verdict"
}
```

**Résultat stocké :** table `deal_analyses`

### Queue async (in-memory)

Classe générique `AsyncQueue<T>` :
- `modelQueue` : concurrence 3, rate limit global 5 calls Mistral/sec
- `analysisQueue` : concurrence 1 (séquentiel pour les deals)
- Pas de persistance (les items sont retraités au prochain cycle de 30s si le process redémarre)
- Méthode `getStats()` pour le monitoring (taille queue, calls/min, erreurs)

### Fallback market_avg

Si `model_label` est null OU `item_count < 3` pour ce modèle → fallback sur le `market_avg` par keyword classique (comportement actuel).

---

## 3. Schéma base de données

### Nouvelles colonnes sur tables existantes

```sql
-- listings
ALTER TABLE listings ADD COLUMN model_label VARCHAR(200);
ALTER TABLE listings ADD COLUMN model_confidence DECIMAL(3,2);

-- keywords
ALTER TABLE keywords ADD COLUMN market_scan_pages INTEGER DEFAULT 5;

-- keyword_listings
ALTER TABLE keyword_listings ADD COLUMN model_market_avg DECIMAL(10,2);
ALTER TABLE keyword_listings ADD COLUMN analysis_id INTEGER REFERENCES deal_analyses(id);
```

### Nouvelle table `model_market_avg`

```sql
CREATE TABLE model_market_avg (
  keyword_id   INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  model_label  VARCHAR(200) NOT NULL,
  avg_price    DECIMAL(10,2),
  item_count   INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (keyword_id, model_label)
);

CREATE INDEX idx_mma_keyword ON model_market_avg(keyword_id);
```

### Nouvelle table `deal_analyses`

```sql
CREATE TABLE deal_analyses (
  id             SERIAL PRIMARY KEY,
  listing_id     INTEGER REFERENCES listings(id) ON DELETE CASCADE,
  keyword_id     INTEGER REFERENCES keywords(id) ON DELETE SET NULL,
  scam_risk      VARCHAR(10) NOT NULL,   -- 'low' | 'medium' | 'high'
  confidence     DECIMAL(3,2),
  recommendation VARCHAR(10) NOT NULL,   -- 'buy' | 'watch' | 'skip'
  reasoning      TEXT,
  analyzed_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_da_listing ON deal_analyses(listing_id);
CREATE INDEX idx_da_recommendation ON deal_analyses(recommendation, scam_risk);
```

---

## 4. Modules backend

### Nouveau module `backend/src/analysis/`

| Fichier | Responsabilité |
|---|---|
| `mistral.service.ts` | Client Mistral — `extractModel(title, price): Promise<{model_label, confidence}>` et `analyzeDeal(listing, keyword, marketAvg, itemCount): Promise<DealAnalysis>` |
| `async-queue.ts` | `AsyncQueue<T>` générique — concurrence, rate limit, stats |
| `deal-analysis.entity.ts` | Entité TypeORM pour `deal_analyses` |
| `analysis.module.ts` | Module NestJS, exporte `MistralService` |

### Module `listings/` modifié

- `ModelMarketAvg` entity (nouveau)
- `computeMarketAvg(keywordId, modelLabel?)` → essaie `model_market_avg` si `modelLabel` fourni et `item_count >= 3`, sinon fallback keyword avg
- `updateModelMarketAvg(keywordId, modelLabel, price)` → upsert sur `model_market_avg`

### Module `scraper/` modifié

- `fastTick()` : `@Interval(30_000)` — page 1, pipeline complet
- `marketTick()` : `@Interval(600_000)` — pages 2-N, extraction modèle + updateModelMarketAvg uniquement
- Après upsert avec `isNew = true` → `modelQueue.push()`
- Après calcul avec `potentialProfit >= targetMargin` → `analysisQueue.push()`

### Variable d'environnement ajoutée

```
MISTRAL_API_KEY=<clé>
```

Ajoutée dans `.env.example` et `docker-compose.yml`.

---

## 5. Dashboard frontend

### Nouvelle page `/validated`

Route : `frontend/src/app/validated/page.tsx`

Affiche uniquement les `keyword_listings` avec `deal_analyses.recommendation IN ('buy', 'watch')` et `scam_risk != 'high'`.

Endpoint backend nécessaire : `GET /api/listings/validated?limit=50`

Tri par défaut : `confidence DESC, potential_profit DESC`

### DealCard — évolutions

- Affiche `model_label` en sous-titre si disponible (ex: "Intel Core i7-12700K")
- Badge 🆕 si `first_seen_at < 5 min`
- Badge "IA XX%" sur le score de confiance Mistral
- Prix comparé à `model_market_avg` (libellé "moy. modèle") plutôt que keyword avg si disponible
- Indicateur scam risk : discret, seulement si `medium` (orange) ou `high` (rouge, ne devrait pas apparaître sur `/validated`)

### Page listing detail — évolutions

Nouveau bloc "Analyse IA" (affiché seulement si `deal_analyses` existe) :
- Recommandation (icône + couleur)
- Score de confiance
- Niveau de risque scam
- `reasoning` (texte Mistral)
- Date de l'analyse

### Sidebar

Ajout de l'entrée "Deals validés" (`/validated`) avec icône Sparkles ou ShieldCheck.

### Settings

Champ `MISTRAL_API_KEY` : input password masqué, bouton "Tester la connexion" qui appelle `POST /api/mistral/test`.

---

## 6. Gestion d'erreurs

- Si Mistral est en timeout (>3s) : skip silencieux, item traité sans `model_label` → fallback keyword avg
- Si rate limit Mistral (429) : pause 10s dans la queue, retry x1
- Si `MISTRAL_API_KEY` absent : `MistralService` en mode no-op (log warning au démarrage), pipeline fonctionne sans analyse IA
- Les erreurs Mistral n'interrompent jamais le cycle de scraping

---

## 7. Non-inclus dans ce scope

- Persistance de la queue (BullMQ, Redis) — ajout futur si nécessaire
- Analyse des photos (vision Mistral) — itération suivante
- Notifications Telegram enrichies avec le reasoning — itération suivante
- Historique des analyses par listing — table `deal_analyses` garde la dernière seulement
