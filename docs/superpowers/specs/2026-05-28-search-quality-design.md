---
name: search-quality
description: Amélioration de la qualité des résultats de recherche Vinted et du calcul de prix moyen par modèle
metadata:
  type: project
---

# Design — Qualité de recherche et prix moyen par modèle

## Contexte

Deux problèmes constatés en production :
1. Les résultats Vinted contiennent des annonces hors-sujet (ex : recherche "I7" → retourne "Core 2 Duo" sans "i7" dans le titre), car l'API Vinted fait une recherche sémantique floue sans filtre côté backend.
2. Les prix moyens (`market_avg`) sont tous au même niveau, rendant l'analyse impossible. Cause : `computeMarketAvg()` calcule une seule moyenne sur tous les listings d'un keyword, et utilise le `model_market_avg` dès 1 seul point de données (avg = prix de cette seule annonce).

## Changements

### ① Filtre titre — `backend/src/scraper/vinted.client.ts`

Dans la méthode `search()`, après réception des items Vinted et avant le `return`, on filtre les items dont le titre ne contient aucun mot significatif du `search_text`.

**Logique :**
- Tokeniser `search_text` : split par espace, garder les tokens de longueur >= 2
- Pour chaque item : garder si le titre (en minuscules) contient au moins un token (en minuscules)
- Item sans titre → rejeté

**Exemple :** `search_text = "processeur i7"` → tokens `["processeur", "i7"]`. Un titre "Intel Core i7-9700K" contient "i7" → gardé. "Core 2 Duo" ne contient ni "processeur" ni "i7" → filtré.

**Où :** juste avant le `return items.map(...).filter(i => i.price > 0)` existant — on chaîne un `.filter()` supplémentaire sur les items bruts (avant `parseItem`), ou sur les items parsés.

### ② Contexte de recherche dans l'extraction Mistral — `backend/src/analysis/mistral.service.ts`

**Signature :** `extractModel(title: string, price: number, searchContext?: string): Promise<ModelExtraction>`

**Prompt amélioré :**
```
Extrait le modèle exact de cet article Vinted.
Contexte de recherche: "${searchContext}"
Titre: "${title}"
Prix: ${price}€

Sois très précis sur la génération/version (ex: distinguer "Core i7-8700K" de "Core i7-12700K").
Si le titre ne correspond pas au contexte de recherche, renvoie {"model_label": null, "confidence": 0.0}.
Réponds uniquement en JSON:
{"model_label": "modèle précis normalisé", "confidence": 0.0-1.0}
```

**Propagation :** `scraper.service.ts::processModelExtraction()` passe `item.keyword.search_text` comme `searchContext`.

### ③ Seuil minimum pour `model_market_avg` — `backend/src/listings/listings.service.ts`

Dans `computeMarketAvg()`, ligne ~39 :

**Avant :**
```typescript
if (mma && mma.avg_price) {
```

**Après :**
```typescript
if (mma && mma.avg_price && mma.item_count >= 3) {
```

En dessous de 3 points, on retombe sur la moyenne keyword-wide (trimmed mean P15-P85), qui sera désormais propre grâce au filtre ①.

## Impact attendu

- Fini les annonces "Core 2 Duo" dans un keyword "I7"
- La moyenne keyword-wide reflète uniquement des annonces pertinentes
- La moyenne par modèle (`model_market_avg`) n'est utilisée que quand elle a assez de données pour être fiable
- Mistral distingue "i7-8700K" de "i7-12700K" grâce au contexte de recherche

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `backend/src/scraper/vinted.client.ts` | Ajout filtre titre post-API |
| `backend/src/analysis/mistral.service.ts` | Ajout param `searchContext`, prompt amélioré |
| `backend/src/scraper/scraper.service.ts` | Passage de `keyword.search_text` à `extractModel()` |
| `backend/src/listings/listings.service.ts` | Seuil `item_count >= 3` pour model avg |

## Non concerné

- Schéma DB : aucun changement
- Frontend : aucun changement
- Autres modules (notifications, keywords CRUD) : aucun changement
