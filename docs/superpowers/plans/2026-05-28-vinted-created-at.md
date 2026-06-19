# Vinted Created-At Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stocker et afficher la vraie date de publication d'une annonce Vinted (`created_at_ts` de l'API) pour permettre un tri "plus récent en premier" fiable — les bonnes affaires sont souvent les plus récentes.

**Architecture:** Quatre changements indépendants en couches : (1) migration DB + init.sql, (2) extraction dans `VintedClient.parseItem()` + interface `VintedItem`, (3) persistance dans `upsertListing()` + entité TypeORM, (4) tri et affichage dans le frontend.

**Tech Stack:** NestJS, TypeORM, PostgreSQL, Next.js 16, TypeScript

---

## Fichiers concernés

| Fichier | Action |
|---|---|
| `db/init.sql` | Modifier — ajouter colonne `vinted_created_at` |
| `db/migrations/002_add_vinted_created_at.sql` | Créer — migration pour instances existantes |
| `backend/src/listings/listing.entity.ts` | Modifier — ajouter `@Column vinted_created_at` |
| `backend/src/listings/listings.service.ts` | Modifier — ajouter champ à `VintedItem`, persister dans `upsertListing()` |
| `backend/src/scraper/vinted.client.ts` | Modifier — extraire `created_at_ts` dans `parseItem()` |
| `backend/src/scraper/vinted.client.spec.ts` | Modifier — ajouter test `parseItem` |
| `frontend/src/lib/api.ts` | Modifier — ajouter `vinted_created_at` à `Listing` |
| `frontend/src/components/DealCard.tsx` | Modifier — préférer `vinted_created_at` dans `getFreshnessHours()` |
| `frontend/src/app/opportunities/page.tsx` | Modifier — tri `date-desc` sur `vinted_created_at` |
| `frontend/src/app/validated/page.tsx` | Modifier — tri `fresh-asc` sur `vinted_created_at` |

---

## Task 1 : Migration DB

**Files:**
- Create: `db/migrations/002_add_vinted_created_at.sql`
- Modify: `db/init.sql`

- [ ] **Step 1 : Créer le fichier de migration**

Créer `db/migrations/002_add_vinted_created_at.sql` :

```sql
-- Migration 002: add Vinted publication date to listings
ALTER TABLE listings ADD COLUMN IF NOT EXISTS vinted_created_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_listings_vinted_created_at ON listings(vinted_created_at DESC);
```

- [ ] **Step 2 : Mettre à jour `db/init.sql` pour les nouvelles installations**

Dans `db/init.sql`, dans le bloc `CREATE TABLE listings`, ajouter après `last_seen_at` (ligne 34) :

```sql
-- Avant (ligne 34) :
  last_seen_at    TIMESTAMPTZ DEFAULT NOW()

-- Après :
  last_seen_at    TIMESTAMPTZ DEFAULT NOW(),
  vinted_created_at TIMESTAMPTZ
```

Et après les CREATE INDEX existants (après ligne 65), ajouter :

```sql
CREATE INDEX IF NOT EXISTS idx_listings_vinted_created_at ON listings(vinted_created_at DESC);
```

- [ ] **Step 3 : Appliquer la migration sur le serveur**

Sur la machine de déploiement (Freebox, `ssh -p 50022 freebox@88.165.36.69`) :

```bash
cd ~/vinbot
docker compose exec db psql -U postgres -d vinbot -f /dev/stdin < db/migrations/002_add_vinted_created_at.sql
```

Si le fichier n'est pas encore sur le serveur, copier d'abord via git push + pull.

- [ ] **Step 4 : Commit**

```bash
git add db/init.sql db/migrations/002_add_vinted_created_at.sql
git commit -m "feat(db): add vinted_created_at column to listings"
```

---

## Task 2 : Extraction dans VintedClient

**Files:**
- Modify: `backend/src/scraper/vinted.client.ts`
- Modify: `backend/src/scraper/vinted.client.spec.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Dans `backend/src/scraper/vinted.client.spec.ts`, ajouter après le `describe('VintedClient.filterByTitle')` existant (ligne 46) :

```typescript
describe('VintedClient.parseItem', () => {
  const client = new VintedClient('fr');

  it('maps created_at_ts (unix seconds) to vinted_created_at Date', () => {
    const raw = {
      id: 123,
      title: 'Test',
      price: { amount: '10.00' },
      url: 'https://www.vinted.fr/items/123',
      photo: { url: 'https://example.com/photo.jpg' },
      brand_title: 'Nike',
      size_title: 'M',
      status: 'Très bon état',
      user: { login: 'seller', id: 42 },
      catalog_id: 1,
      created_at_ts: 1716900000, // 2024-05-28 ~14:00 UTC
    };
    const item = (client as any).parseItem(raw);
    expect(item.vinted_created_at).toBeInstanceOf(Date);
    expect(item.vinted_created_at.getTime()).toBe(1716900000 * 1000);
  });

  it('sets vinted_created_at to null when created_at_ts is absent', () => {
    const raw = {
      id: 456,
      title: 'No date',
      price: { amount: '5.00' },
      user: { login: 'x', id: 1 },
    };
    const item = (client as any).parseItem(raw);
    expect(item.vinted_created_at).toBeNull();
  });
});
```

- [ ] **Step 2 : Vérifier que les tests échouent**

```bash
cd backend
npm run test -- --testPathPattern=vinted.client.spec
```

Attendu : FAIL — `item.vinted_created_at` is `undefined`, not a Date.

- [ ] **Step 3 : Modifier `parseItem()` dans `vinted.client.ts`**

Dans `backend/src/scraper/vinted.client.ts`, remplacer la méthode `parseItem` (lignes 150-164) :

```typescript
private parseItem(item: any): VintedItem {
  return {
    vinted_id: item.id,
    title: item.title ?? '',
    price: parseFloat(item.price?.amount ?? '0'),
    url: item.url ?? `${this.baseUrl}/items/${item.id}`,
    photo_url: item.photo?.url ?? item.photos?.[0]?.url ?? '',
    brand: item.brand_title ?? '',
    size_label: item.size_title ?? '',
    condition_label: item.status ?? '',
    seller_name: item.user?.login ?? '',
    seller_id: item.user?.id ?? 0,
    catalog_id: item.catalog_id ?? null,
    vinted_created_at: item.created_at_ts ? new Date(item.created_at_ts * 1000) : null,
  };
}
```

- [ ] **Step 4 : Vérifier que les tests passent**

```bash
cd backend
npm run test -- --testPathPattern=vinted.client.spec
```

Attendu : PASS (7 tests : 5 filterByTitle + 2 parseItem)

- [ ] **Step 5 : Commit**

```bash
git add backend/src/scraper/vinted.client.ts backend/src/scraper/vinted.client.spec.ts
git commit -m "feat(scraper): extract vinted_created_at from API created_at_ts in parseItem"
```

---

## Task 3 : Persistance backend (VintedItem + entity + upsertListing)

**Files:**
- Modify: `backend/src/listings/listings.service.ts`
- Modify: `backend/src/listings/listing.entity.ts`

- [ ] **Step 1 : Ajouter `vinted_created_at` à l'interface `VintedItem`**

Dans `backend/src/listings/listings.service.ts`, modifier l'interface `VintedItem` (lignes 11-16) :

```typescript
export interface VintedItem {
  vinted_id: number; title: string; price: number; url: string;
  photo_url: string; brand: string; size_label: string;
  condition_label: string; seller_name: string; seller_id: number;
  catalog_id: number | null;
  vinted_created_at: Date | null;
}
```

- [ ] **Step 2 : Ajouter la colonne à l'entité TypeORM**

Dans `backend/src/listings/listing.entity.ts`, ajouter après `last_seen_at` (ligne 57) :

```typescript
  @Column({ type: 'timestamptz', nullable: true })
  vinted_created_at: Date | null;
```

- [ ] **Step 3 : Persister dans `upsertListing()`**

Dans `backend/src/listings/listings.service.ts`, dans `upsertListing()`, modifier la création du listing (lignes ~134-140) pour inclure `vinted_created_at` :

```typescript
// Avant :
listing = this.listingRepo.create({
  vinted_id: item.vinted_id, title: item.title, price: item.price, url: item.url,
  photo_url: item.photo_url, brand: item.brand, size_label: item.size_label,
  condition_label: item.condition_label, seller_name: item.seller_name,
  seller_id: item.seller_id, country_code: countryCode ?? 'fr', last_seen_at: new Date(),
});

// Après :
listing = this.listingRepo.create({
  vinted_id: item.vinted_id, title: item.title, price: item.price, url: item.url,
  photo_url: item.photo_url, brand: item.brand, size_label: item.size_label,
  condition_label: item.condition_label, seller_name: item.seller_name,
  seller_id: item.seller_id, country_code: countryCode ?? 'fr', last_seen_at: new Date(),
  vinted_created_at: item.vinted_created_at ?? null,
});
```

- [ ] **Step 4 : Vérifier que le build compile sans erreur**

```bash
cd backend
npm run build
```

Attendu : compilation TypeScript sans erreur.

- [ ] **Step 5 : Lancer la suite de tests complète**

```bash
cd backend
npm run test
```

Attendu : tous les tests PASS.

- [ ] **Step 6 : Commit**

```bash
git add backend/src/listings/listings.service.ts backend/src/listings/listing.entity.ts
git commit -m "feat(listings): persist vinted_created_at from Vinted API in upsertListing"
```

---

## Task 4 : Affichage et tri dans le frontend

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/DealCard.tsx`
- Modify: `frontend/src/app/opportunities/page.tsx`
- Modify: `frontend/src/app/validated/page.tsx`

- [ ] **Step 1 : Ajouter `vinted_created_at` à l'interface `Listing` dans `api.ts`**

Dans `frontend/src/lib/api.ts`, dans l'interface `Listing` (après `last_seen_at`, ligne 43) :

```typescript
// Avant :
  last_seen_at: string;
  /** Derived server-side or computed client-side from first_seen_at */
  freshness_hours?: number;

// Après :
  last_seen_at: string;
  /** Real Vinted publication date (from API created_at_ts). Null for listings scraped before this feature. */
  vinted_created_at?: string | null;
  /** Derived server-side or computed client-side from first_seen_at */
  freshness_hours?: number;
```

- [ ] **Step 2 : Mettre à jour `getFreshnessHours()` dans `DealCard.tsx`**

Dans `frontend/src/components/DealCard.tsx`, remplacer la fonction `getFreshnessHours` (lignes 9-13) :

```typescript
function getFreshnessHours(listing: KeywordListing['listing']): number {
  if (listing.freshness_hours !== undefined) return listing.freshness_hours;
  const ref = listing.vinted_created_at ?? listing.first_seen_at;
  return (Date.now() - new Date(ref).getTime()) / 3_600_000;
}
```

- [ ] **Step 3 : Mettre à jour le tri `date-desc` dans `opportunities/page.tsx`**

Dans `frontend/src/app/opportunities/page.tsx`, dans le bloc `if (sortBy === 'date-desc')` (lignes 64-68) :

```typescript
// Avant :
if (sortBy === 'date-desc') {
  const dateA = new Date(a.matched_at).getTime();
  const dateB = new Date(b.matched_at).getTime();
  return dateB - dateA;
}

// Après :
if (sortBy === 'date-desc') {
  const refA = a.listing.vinted_created_at ?? a.listing.first_seen_at;
  const refB = b.listing.vinted_created_at ?? b.listing.first_seen_at;
  return new Date(refB).getTime() - new Date(refA).getTime();
}
```

Et renommer le label de l'option dans le `<select>` (ligne 135) :

```tsx
// Avant :
<option value="date-desc">Détection la plus récente</option>

// Après :
<option value="date-desc">Mise en ligne la plus récente</option>
```

- [ ] **Step 4 : Mettre à jour le tri `fresh-asc` dans `validated/page.tsx`**

Dans `frontend/src/app/validated/page.tsx`, remplacer la fonction locale `getFreshnessHours` (lignes 7-9) et le bloc de tri `fresh-asc` :

```typescript
// Remplacer la fonction (lignes 7-9) :
function getFreshnessHours(listing: KeywordListing['listing']): number {
  const ref = listing.vinted_created_at ?? listing.first_seen_at;
  return (Date.now() - new Date(ref).getTime()) / 3_600_000;
}
```

Le bloc de tri `fresh-asc` (lignes 73-76) utilise déjà cette fonction — il n'a pas besoin de changer :

```typescript
if (sortBy === 'fresh-asc') {
  const fA = getFreshnessHours(a.listing);
  const fB = getFreshnessHours(b.listing);
  return fA - fB;
}
```

**Note:** La signature de `getFreshnessHours` dans `validated/page.tsx` prend `string` en argument aujourd'hui (ligne 7 : `function getFreshnessHours(firstSeenAt: string)`). Elle doit être mise à jour pour prendre `KeywordListing['listing']` comme dans `DealCard.tsx`.

- [ ] **Step 5 : Vérifier le build frontend**

```bash
cd frontend
npm run build
```

Attendu : compilation sans erreur TypeScript.

- [ ] **Step 6 : Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/DealCard.tsx frontend/src/app/opportunities/page.tsx frontend/src/app/validated/page.tsx
git commit -m "feat(frontend): use vinted_created_at for freshness display and date sorting"
```

---

## Vérification finale

- [ ] **Lancer tous les tests backend**

```bash
cd backend
npm run test
```

Attendu : tous les tests PASS.

- [ ] **Build complet backend + frontend**

```bash
cd backend && npm run build
cd ../frontend && npm run build
```

Attendu : les deux compilent sans erreur.

- [ ] **Déploiement sur le serveur**

Sur le serveur Freebox (`ssh -p 50022 freebox@88.165.36.69`) :

```bash
cd ~/vinbot
git pull
# Appliquer la migration DB si pas encore fait :
docker compose exec db psql -U postgres -d vinbot -c "ALTER TABLE listings ADD COLUMN IF NOT EXISTS vinted_created_at TIMESTAMPTZ; CREATE INDEX IF NOT EXISTS idx_listings_vinted_created_at ON listings(vinted_created_at DESC);"
# Rebuild et redémarrage :
docker compose build api frontend && docker compose up -d api frontend
```
