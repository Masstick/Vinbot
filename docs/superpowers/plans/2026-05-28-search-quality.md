# Search Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Éliminer les annonces hors-sujet retournées par Vinted et rendre le calcul de prix moyen fiable par modèle.

**Architecture:** Trois changements indépendants et ciblés : (1) filtre post-API sur le titre dans `VintedClient`, (2) enrichissement du prompt Mistral avec le contexte de recherche, (3) seuil minimum de 3 points avant d'utiliser un `model_market_avg`.

**Tech Stack:** NestJS, TypeORM, Jest, Mistral AI API

---

## Fichiers concernés

| Fichier | Action |
|---|---|
| `backend/src/scraper/vinted.client.ts` | Modifier — ajouter filtre titre dans `search()` |
| `backend/src/scraper/vinted.client.spec.ts` | Créer — tests du filtre titre |
| `backend/src/analysis/mistral.service.ts` | Modifier — ajouter param `searchContext` dans `extractModel()` |
| `backend/src/analysis/mistral.service.spec.ts` | Modifier — ajouter test searchContext |
| `backend/src/scraper/scraper.service.ts` | Modifier — passer `keyword.search_text` à `extractModel()` |
| `backend/src/listings/listings.service.ts` | Modifier — seuil `item_count >= 3` |

---

## Task 1 : Filtre titre dans VintedClient

**Files:**
- Modify: `backend/src/scraper/vinted.client.ts`
- Create: `backend/src/scraper/vinted.client.spec.ts`

- [ ] **Step 1 : Créer le fichier de test et écrire les tests qui échouent**

Créer `backend/src/scraper/vinted.client.spec.ts` :

```typescript
import { VintedClient } from './vinted.client';

describe('VintedClient.filterByTitle', () => {
  const client = new VintedClient('fr');

  it('keeps item whose title contains the search token', () => {
    const items = [{ title: 'Intel Core i7-9700K' }, { title: 'Core 2 Duo E8400' }];
    const filtered = (client as any).filterByTitle(items, 'i7');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('Intel Core i7-9700K');
  });

  it('keeps item matching any token from multi-word search', () => {
    const items = [
      { title: 'Processeur Intel i7-8700K' },
      { title: 'Core 2 Duo E8400' },
      { title: 'Processeur AMD Ryzen 5' },
    ];
    const filtered = (client as any).filterByTitle(items, 'processeur i7');
    // Contient "processeur" ou "i7" → les deux premiers passent
    expect(filtered).toHaveLength(2);
  });

  it('is case-insensitive', () => {
    const items = [{ title: 'PROCESSEUR I7-12700K' }];
    const filtered = (client as any).filterByTitle(items, 'i7');
    expect(filtered).toHaveLength(1);
  });

  it('rejects item with null title', () => {
    const items = [{ title: null }, { title: undefined }];
    const filtered = (client as any).filterByTitle(items, 'i7');
    expect(filtered).toHaveLength(0);
  });

  it('keeps all items when searchText is empty', () => {
    const items = [{ title: 'anything' }, { title: 'whatever' }];
    const filtered = (client as any).filterByTitle(items, '');
    expect(filtered).toHaveLength(2);
  });
});
```

- [ ] **Step 2 : Vérifier que les tests échouent**

```bash
cd backend
npm run test -- --testPathPattern=vinted.client.spec
```

Attendu : FAIL — `filterByTitle is not a function`

- [ ] **Step 3 : Implémenter `filterByTitle` et l'appeler dans `search()`**

Dans `backend/src/scraper/vinted.client.ts`, ajouter la méthode privée après `parseItem()` (ligne ~136) :

```typescript
private filterByTitle(items: any[], searchText: string): any[] {
  const tokens = searchText
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length >= 2);
  if (tokens.length === 0) return items;
  return items.filter(item => {
    const title = (item.title ?? '').toLowerCase();
    if (!title) return false;
    return tokens.some(token => title.includes(token));
  });
}
```

Puis dans `search()`, remplacer la ligne de return (ligne ~123) :

```typescript
// Avant :
const items: any[] = response.data?.items ?? [];
return items.map(item => this.parseItem(item)).filter(i => i.price > 0);

// Après :
const rawItems: any[] = response.data?.items ?? [];
const filtered = this.filterByTitle(rawItems, searchText);
return filtered.map(item => this.parseItem(item)).filter(i => i.price > 0);
```

- [ ] **Step 4 : Vérifier que les tests passent**

```bash
cd backend
npm run test -- --testPathPattern=vinted.client.spec
```

Attendu : PASS (5 tests)

- [ ] **Step 5 : Commit**

```bash
cd backend && git add src/scraper/vinted.client.ts src/scraper/vinted.client.spec.ts
git commit -m "feat(scraper): filter Vinted results by title tokens to remove irrelevant listings"
```

---

## Task 2 : Contexte de recherche dans `extractModel()`

**Files:**
- Modify: `backend/src/analysis/mistral.service.ts`
- Modify: `backend/src/analysis/mistral.service.spec.ts`

- [ ] **Step 1 : Ajouter les tests pour le nouveau param `searchContext`**

Dans `backend/src/analysis/mistral.service.spec.ts`, ajouter dans le bloc `describe('when API key is absent')` après le test `extractModel returns null model_label` existant :

```typescript
it('extractModel with searchContext returns null model_label when disabled', async () => {
  const svc = makeService(undefined);
  const result = await svc.extractModel('Intel Core i7-12700K', 150, 'processeur i7');
  expect(result).toEqual({ model_label: null, confidence: 0 });
});
```

- [ ] **Step 2 : Vérifier que le test passe déjà (param optionnel)**

```bash
cd backend
npm run test -- --testPathPattern=mistral.service.spec
```

Attendu : PASS — le param est optionnel, le comportement no-op ne change pas.

- [ ] **Step 3 : Mettre à jour la signature et le prompt de `extractModel()`**

Dans `backend/src/analysis/mistral.service.ts`, remplacer la méthode `extractModel` (lignes ~44-69) :

```typescript
async extractModel(title: string, price: number, searchContext?: string): Promise<ModelExtraction> {
  if (!this.client) return { model_label: null, confidence: 0 };
  try {
    const contextLine = searchContext
      ? `Contexte de recherche: "${searchContext}"\n`
      : '';
    const prompt =
      `Extrait le modèle exact de cet article Vinted en quelques mots normalisés.\n` +
      contextLine +
      `Titre: "${title}"\nPrix: ${price}€\n\n` +
      `Sois très précis sur la génération/version (ex: distinguer "Core i7-8700K" de "Core i7-12700K").\n` +
      `Si le titre ne correspond pas au contexte de recherche ou est trop vague, renvoie {"model_label": null, "confidence": 0.0}.\n` +
      `Réponds uniquement en JSON:\n` +
      `{"model_label": "modèle précis normalisé (ex: Intel Core i7-12700K, RTX 3080 10GB)", "confidence": 0.0-1.0}`;
    const res = await this.client.post('/chat/completions', {
      model: 'mistral-small-latest',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 100,
    });
    return this.parseExtractResponse(res.data.choices[0].message.content);
  } catch (err: any) {
    if (err.response?.status === 429) {
      this.logger.warn('Mistral rate limit (429) sur extractModel — retry dans 15s');
      await new Promise(r => setTimeout(r, 15_000));
      return this.extractModel(title, price, searchContext);
    }
    this.logger.warn(`extractModel failed: ${err.message}`);
    return { model_label: null, confidence: 0 };
  }
}
```

- [ ] **Step 4 : Vérifier que tous les tests Mistral passent encore**

```bash
cd backend
npm run test -- --testPathPattern=mistral.service.spec
```

Attendu : PASS (tous les tests existants + le nouveau)

- [ ] **Step 5 : Commit**

```bash
cd backend && git add src/analysis/mistral.service.ts src/analysis/mistral.service.spec.ts
git commit -m "feat(analysis): add searchContext to extractModel prompt for precise model labeling"
```

---

## Task 3 : Passer `searchContext` depuis `ScraperService`

**Files:**
- Modify: `backend/src/scraper/scraper.service.ts`

- [ ] **Step 1 : Mettre à jour l'appel dans `processModelExtraction()`**

Dans `backend/src/scraper/scraper.service.ts`, dans la méthode `processModelExtraction()` (ligne ~194), remplacer :

```typescript
// Avant :
const extraction = await this.mistralService.extractModel(item.title, item.price);

// Après :
const extraction = await this.mistralService.extractModel(item.title, item.price, item.keyword.search_text);
```

- [ ] **Step 2 : Vérifier qu'il n'y a pas d'autres appels à `extractModel` dans le projet**

```bash
cd backend
grep -rn "extractModel" src/
```

Attendu : 2 occurrences uniquement — `mistral.service.ts` (définition) et `scraper.service.ts` (appel).

- [ ] **Step 3 : Vérifier que le build compile sans erreur**

```bash
cd backend
npm run build
```

Attendu : compilation sans erreur TypeScript.

- [ ] **Step 4 : Commit**

```bash
cd backend && git add src/scraper/scraper.service.ts
git commit -m "feat(scraper): pass keyword search_text as context to Mistral model extraction"
```

---

## Task 4 : Seuil minimum `item_count >= 3` dans `computeMarketAvg()`

**Files:**
- Modify: `backend/src/listings/listings.service.ts`

> Note : les tests couvrant ce comportement existent déjà dans `listings.service.spec.ts` (tests `computeMarketAvg`). Il suffit de corriger l'implémentation.

- [ ] **Step 1 : Vérifier que les tests existants échouent actuellement**

```bash
cd backend
npm run test -- --testPathPattern=listings.service.spec
```

Attendu : le test `falls back to keyword avg when item_count < 3` doit FAIL (l'implémentation actuelle n'a pas ce seuil).

- [ ] **Step 2 : Corriger `computeMarketAvg()` dans `listings.service.ts`**

Ligne ~39, remplacer :

```typescript
// Avant :
if (mma && mma.avg_price) {

// Après :
if (mma && mma.avg_price && mma.item_count >= 3) {
```

- [ ] **Step 3 : Vérifier que tous les tests listings passent**

```bash
cd backend
npm run test -- --testPathPattern=listings.service.spec
```

Attendu : PASS (tous les tests, y compris `uses model_market_avg when item_count >= 3` et `falls back to keyword avg when item_count < 3`)

- [ ] **Step 4 : Lancer la suite complète pour vérifier aucune régression**

```bash
cd backend
npm run test
```

Attendu : tous les tests PASS.

- [ ] **Step 5 : Commit**

```bash
cd backend && git add src/listings/listings.service.ts
git commit -m "fix(listings): require min 3 data points before using model_market_avg"
```

---

## Vérification finale

- [ ] **Vérifier le build complet**

```bash
cd backend
npm run build
```

Attendu : `dist/` généré sans erreur.

- [ ] **Vérifier le lint**

```bash
cd backend
npm run lint
```

Attendu : aucune erreur ESLint.
