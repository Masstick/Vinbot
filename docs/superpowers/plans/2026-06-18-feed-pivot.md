# Pivot vers un flux filtré — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer Vinbot en flux d'annonces brutes filtrées en retirant côté frontend les pages Opportunités / Deals validés et tous les indicateurs dérivés (score, profit, prix moyen), sans toucher au backend.

**Architecture:** Changements 100 % frontend (Next.js 16). On nettoie le composant partagé `DealCard`, on simplifie la navigation et le dashboard, on supprime deux routes et les méthodes API associées. Le backend (scraper, valorisation, Mistral, Telegram) reste strictement inchangé.

**Tech Stack:** Next.js 16 (App Router), React, TypeScript, Tailwind, lucide-react.

## Global Constraints

- **Frontend uniquement** — ne modifier aucun fichier sous `backend/` ni `db/`.
- Pas de runner de test frontend : la vérification de chaque tâche = `npx tsc --noEmit` (depuis `frontend/`) + contrôle décrit ; build final via `npm run build`.
- Ne pas "corriger" les erreurs de lint préexistantes (apostrophes non échappées, `any`) hors des lignes touchées.
- Conserver le style Tailwind et les conventions existantes (classes, structure des cartes).
- Spec de référence : `docs/superpowers/specs/2026-06-18-feed-pivot-design.md`.
- Toutes les commandes s'exécutent depuis `frontend/` sauf `git` (racine du repo).

---

### Task 1: Nettoyer le composant partagé `DealCard`

Retire les indicateurs dérivés de la carte d'annonce. Première tâche car `DealCard` est utilisée par le flux et par Live ; les nettoyer ici suffit pour ces deux pages.

**Files:**
- Modify (remplacement complet) : `frontend/src/components/DealCard.tsx`

**Interfaces:**
- Consumes : type `KeywordListing` depuis `@/lib/api` (inchangé).
- Produces : `export function DealCard({ kl }: { kl: KeywordListing })` — signature inchangée ; n'affiche plus que des faits bruts.

- [ ] **Step 1: Remplacer entièrement le contenu de `frontend/src/components/DealCard.tsx`**

```tsx
'use client';
import Link from 'next/link';
import { KeywordListing } from '@/lib/api';
import { ExternalLink, ArrowUpRight, Clock } from 'lucide-react';

// ─── Freshness ────────────────────────────────────────────────────────────────

function getFreshnessHours(listing: KeywordListing['listing']): number {
  if (listing.freshness_hours !== undefined) return listing.freshness_hours;
  const ref = listing.vinted_created_at ?? listing.first_seen_at;
  return (Date.now() - new Date(ref).getTime()) / 3_600_000;
}

function FreshnessBadge({ hours }: { hours: number }) {
  if (hours < 1) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
        <Clock size={10} />
        &lt; 1h
      </span>
    );
  }
  if (hours < 6) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30">
        <Clock size={10} />
        &lt; 6h
      </span>
    );
  }
  if (hours < 24) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg bg-sky-500/15 text-sky-400 border border-sky-500/30">
        <Clock size={10} />
        &lt; 24h
      </span>
    );
  }
  return null;
}

// ─── Condition badge ──────────────────────────────────────────────────────────

function ConditionBadge({ label }: { label: string }) {
  const normalized = label.toLowerCase();
  if (normalized.includes('neuf')) {
    return (
      <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[10px] font-semibold">
        {label}
      </span>
    );
  }
  if (normalized.includes('très bon') || normalized.includes('bon état')) {
    return (
      <span className="bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2 py-0.5 rounded text-[10px] font-semibold">
        {label}
      </span>
    );
  }
  if (normalized.includes('satisf')) {
    return (
      <span className="bg-zinc-700/60 text-zinc-400 border border-zinc-600/30 px-2 py-0.5 rounded text-[10px] font-semibold">
        {label}
      </span>
    );
  }
  return (
    <span className="bg-zinc-800/40 text-zinc-500 border border-zinc-800/50 px-2 py-0.5 rounded text-[10px] font-medium">
      {label}
    </span>
  );
}

// ─── Country flag ─────────────────────────────────────────────────────────────

const FLAGS: Record<string, string> = {
  be: '🇧🇪',
  es: '🇪🇸',
  pl: '🇵🇱',
  de: '🇩🇪',
  nl: '🇳🇱',
  it: '🇮🇹',
  pt: '🇵🇹',
  se: '🇸🇪',
  gb: '🇬🇧',
  at: '🇦🇹',
  ch: '🇨🇭',
};

function countryFlag(code: string): string | null {
  const c = code.toLowerCase();
  if (c === 'fr') return null;
  return FLAGS[c] ?? null;
}

// ─── Main card ────────────────────────────────────────────────────────────────

interface Props {
  kl: KeywordListing;
}

export function DealCard({ kl }: Props) {
  const { listing, keyword } = kl;
  const price = listing.price ? parseFloat(String(listing.price)) : null;

  const freshnessHours = getFreshnessHours(listing);
  const flagCode = listing.seller_country ?? listing.country_code;
  const flag = flagCode ? countryFlag(flagCode) : null;

  return (
    <div className="group bg-zinc-900/60 border border-zinc-800/80 rounded-2xl overflow-hidden hover:border-zinc-700/80 hover:shadow-xl transition-all duration-300 hover:scale-[1.01] flex flex-col h-full">
      {/* Product Image */}
      <div className="relative aspect-[3/2] bg-zinc-950 overflow-hidden w-full shrink-0">
        <Link href={`/listings/${listing.id}`}>
          {listing.photo_url ? (
            <img
              src={listing.photo_url}
              alt={listing.title ?? ''}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              onError={e => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">
              Aucune image
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent opacity-60" />
        </Link>

        {/* Freshness badge (top left) */}
        <span className="absolute top-2.5 left-2.5 backdrop-blur-md">
          <FreshnessBadge hours={freshnessHours} />
        </span>

        {/* Keyword label overlay (bottom left) */}
        <span className="absolute bottom-2 left-2 text-[10px] font-medium tracking-wide uppercase px-2 py-0.5 rounded bg-zinc-950/80 text-zinc-400 border border-zinc-800/80 backdrop-blur-md">
          {keyword.label}
        </span>
      </div>

      {/* Product Details */}
      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
        <div className="space-y-2">
          {/* Brand / Size / Condition badges */}
          <div className="flex flex-wrap gap-1">
            {listing.brand && (
              <span className="bg-zinc-800/60 text-zinc-300 px-2 py-0.5 rounded text-[10px] font-medium border border-zinc-700/30">
                {listing.brand}
              </span>
            )}
            {listing.size_label && (
              <span className="bg-zinc-800/60 text-zinc-300 px-2 py-0.5 rounded text-[10px] font-medium border border-zinc-700/30">
                Taille : {listing.size_label}
              </span>
            )}
            {listing.condition_label && (
              <ConditionBadge label={listing.condition_label} />
            )}
          </div>

          {/* Title + optional country flag */}
          <Link
            href={`/listings/${listing.id}`}
            className="flex items-center gap-1 text-sm font-semibold text-zinc-100 hover:text-indigo-400 transition-colors line-clamp-1 mt-1"
          >
            {flag && <span className="shrink-0 text-base leading-none">{flag}</span>}
            <span className="line-clamp-1">{listing.title ?? 'Sans titre'}</span>
          </Link>

          {/* Pricing */}
          <div className="flex items-baseline pt-1">
            <span className="text-xl font-black text-white">{price?.toFixed(1)}€</span>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2 pt-2 border-t border-zinc-800/50">
          {listing.url && (
            <a
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 bg-indigo-700 hover:bg-indigo-600 text-white text-xs font-bold py-2.5 rounded-xl transition-all shadow-md"
            >
              Voir sur Vinted
              <ExternalLink size={13} />
            </a>
          )}
          <Link
            href={`/listings/${listing.id}`}
            className="flex items-center justify-center gap-1 w-full text-center bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs py-2 rounded-xl transition-colors font-medium border border-zinc-700/30 group-hover:border-zinc-600"
          >
            Détails
            <ArrowUpRight size={13} />
          </Link>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Vérifier le typecheck**

Run (depuis `frontend/`) : `npx tsc --noEmit`
Expected : exit 0, aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/DealCard.tsx
git commit -m "refactor(frontend): strip derived indicators from DealCard (feed pivot)"
```

---

### Task 2: Simplifier la navigation (Sidebar)

**Files:**
- Modify : `frontend/src/components/Sidebar.tsx:5-15`

**Interfaces:**
- Aucune interface exportée modifiée.

- [ ] **Step 1: Retirer les deux liens et les icônes orphelines**

Dans `frontend/src/components/Sidebar.tsx`, remplacer l'import d'icônes (ligne 5) :

```tsx
import { LayoutDashboard, TrendingUp, Tags, Settings, Menu, X, Bot, ShieldCheck, Newspaper, Radio } from 'lucide-react';
```

par :

```tsx
import { LayoutDashboard, Tags, Settings, Menu, X, Bot, Newspaper, Radio } from 'lucide-react';
```

Puis remplacer le tableau `navLinks` (lignes 7-15) :

```tsx
const navLinks = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/listings', label: 'Dernières annonces', icon: Newspaper },
  { href: '/opportunities', label: 'Opportunités', icon: TrendingUp },
  { href: '/validated', label: 'Deals validés', icon: ShieldCheck },
  { href: '/live', label: 'Live', icon: Radio },
  { href: '/keywords', label: 'Mots-clés', icon: Tags },
  { href: '/settings', label: 'Réglages', icon: Settings },
];
```

par :

```tsx
const navLinks = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/listings', label: 'Dernières annonces', icon: Newspaper },
  { href: '/live', label: 'Live', icon: Radio },
  { href: '/keywords', label: 'Mots-clés', icon: Tags },
  { href: '/settings', label: 'Réglages', icon: Settings },
];
```

- [ ] **Step 2: Vérifier le typecheck**

Run (depuis `frontend/`) : `npx tsc --noEmit`
Expected : exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Sidebar.tsx
git commit -m "refactor(frontend): remove Opportunités/Deals validés from nav"
```

---

### Task 3: Alléger le Dashboard

Retire la section "Top 10 opportunités", la carte stat "Deals validés IA", et l'appel API `opportunities()` (ce qui retire un des deux appelants de la méthode supprimée en Task 5).

**Files:**
- Modify (remplacement complet) : `frontend/src/app/page.tsx`

**Interfaces:**
- Consumes : `api.listings.stats()`, `api.scraper.status()`, `useKeywordChanged`, type `Stats`.
- Produces : composant `Dashboard` par défaut (route `/`).

- [ ] **Step 1: Remplacer entièrement le contenu de `frontend/src/app/page.tsx`**

```tsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import { api, Stats } from '@/lib/api';
import { useKeywordChanged } from '@/lib/useKeywordChanged';
import { RefreshCw, Database, Hash, Bell, Bot, Calendar, Sparkles } from 'lucide-react';

function ScraperStatusBar({ status }: { status: any }) {
  const [tick, setTick] = useState(0);

  // Countdown local en JS — rafraîchi toutes les secondes
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => {
      clearInterval(t);
      setTick(0);
    };
  }, [status]); // Reset tick when status changes

  if (!status) return null;

  const isRunning = status.isFastRunning || status.isMarketRunning;
  const keywords: { id: number; label: string; lastRunAt: string | null; countryCodes?: string[] }[] =
    status.keywords ?? [];

  // tick force le re-render chaque seconde pour rafraîchir les durées affichées
  void tick;

  return (
    <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-5 glow-indigo backdrop-blur-md">
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex h-3 w-3">
          {isRunning ? (
            <>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </>
          ) : (
            <>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
            </>
          )}
        </div>
        <span className="text-sm font-semibold text-zinc-200">
          {status.bootstrappingKeyword
            ? `Construction de l'historique pour « ${status.bootstrappingKeyword} »…`
            : isRunning
            ? 'Scraper en cours de recherche…'
            : 'Scraper en veille (prochain scan < 35s)'}
        </span>
        {status.lastScrapeTime && (
          <span className="text-xs text-zinc-500 ml-auto flex items-center gap-1">
            <Calendar size={12} />
            Dernier cycle : {new Date(status.lastScrapeTime).toLocaleTimeString('fr-FR')}
          </span>
        )}
      </div>

      {keywords.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {keywords.map(kw => {
            const elapsed = kw.lastRunAt
              ? Math.max(0, Math.round((Date.now() - new Date(kw.lastRunAt).getTime()) / 1000))
              : null;

            return (
              <div key={kw.id} className="bg-zinc-950/40 border border-zinc-900 rounded-xl p-3 flex flex-col justify-center gap-1">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-zinc-300 truncate max-w-[150px]">{kw.label}</span>
                  <span className="text-zinc-500 font-mono">
                    {elapsed === null
                      ? 'en attente du 1er scan'
                      : elapsed < 60
                      ? `scanné il y a ${elapsed}s`
                      : `scanné il y a ${Math.floor(elapsed / 60)}min`}
                  </span>
                </div>
                {kw.countryCodes && kw.countryCodes.length > 0 && (
                  <span className="text-[10px] text-zinc-600 uppercase tracking-wide font-mono">
                    {kw.countryCodes.join(' · ')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-zinc-500">Aucun mot-clé actif pour le scraper.</p>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [scraperStatus, setScraperStatus] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback((showIndicator = false) => {
    if (showIndicator) setRefreshing(true);
    Promise.all([
      api.listings.stats().catch(() => null),
      api.scraper.status().catch(() => null),
    ]).then(([s, sc]) => {
      setStats(s);
      setScraperStatus(sc);
      setRefreshing(false);
    });
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData(false), 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  useKeywordChanged(() => loadData(false));

  return (
    <div className="space-y-8">
      {/* Header section */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-2">
            <Bot className="text-indigo-400" size={28} />
            Tableau de bord
          </h1>
          <p className="text-sm text-zinc-400 mt-1">Surveillance du scraper et des annonces collectées.</p>
        </div>
        <button
          onClick={() => loadData(true)}
          disabled={refreshing}
          className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Actualisation...' : 'Actualiser'}
        </button>
      </div>

      {/* Scraper Status */}
      <ScraperStatusBar status={scraperStatus} />

      {/* Stats Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: 'Annonces analysées',
            value: stats?.total_listings ?? '—',
            icon: Database,
            color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20 glow-indigo',
          },
          {
            label: 'Nouvelles (24h)',
            value: stats?.listings_24h ?? '—',
            icon: Sparkles,
            color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
          },
          {
            label: 'Mots-clés surveillés',
            value: stats?.active_keywords ?? '—',
            icon: Hash,
            color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20 glow-cyan',
          },
          {
            label: 'Alertes (24h)',
            value: stats?.alerts_24h ?? '—',
            icon: Bell,
            color: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
          },
        ].map((s, idx) => {
          const Icon = s.icon;
          return (
            <div
              key={idx}
              className={`bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-6 flex items-center justify-between hover:border-zinc-700/60 transition-all duration-300`}
            >
              <div className="space-y-1">
                <div className="text-3xl font-black text-white tracking-tight">{s.value}</div>
                <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{s.label}</div>
              </div>
              <div className={`p-3 rounded-xl border ${s.color}`}>
                <Icon size={22} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Vérifier le typecheck**

Run (depuis `frontend/`) : `npx tsc --noEmit`
Expected : exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/page.tsx
git commit -m "refactor(frontend): slim dashboard, drop opportunities section + validated stat"
```

---

### Task 4: Supprimer les pages Opportunités et Deals validés

Retire les deux derniers appelants des méthodes API supprimées en Task 5.

**Files:**
- Delete : `frontend/src/app/opportunities/page.tsx` (et le dossier `opportunities/`)
- Delete : `frontend/src/app/validated/page.tsx` (et le dossier `validated/`)

- [ ] **Step 1: Supprimer les fichiers et dossiers**

```bash
git rm frontend/src/app/opportunities/page.tsx frontend/src/app/validated/page.tsx
```

(Les dossiers `opportunities/` et `validated/` doivent être vides ensuite ; si d'autres fichiers y subsistent, ne pas les supprimer sans vérifier.)

- [ ] **Step 2: Vérifier le typecheck**

Run (depuis `frontend/`) : `npx tsc --noEmit`
Expected : exit 0.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(frontend): remove opportunities and validated pages"
```

---

### Task 5: Retirer les méthodes API désormais inutilisées

À ce stade, plus aucun fichier n'appelle `api.listings.opportunities()` ni `api.listings.validated()`.

**Files:**
- Modify : `frontend/src/lib/api.ts` (objet `api.listings`, ~lignes 156-164)

**Interfaces:**
- Produces : `api.listings` sans `opportunities` ni `validated` ; conserve `latest`, `get`, `history`, `stats`.

- [ ] **Step 1: Retirer les deux méthodes**

Dans `frontend/src/lib/api.ts`, supprimer la ligne `opportunities:` et le bloc `validated:` de l'objet `listings`. Après modification, l'objet doit ressembler à :

```ts
  listings: {
    latest: (params: LatestListingsParams = {}) =>
      req<any[]>(`/listings${latestQuery(params)}`).then(rows => rows.map(rowToKeywordListing)),
    get: (id: number) => req<any>(`/listings/${id}`),
    history: (id: number) => req<PricePoint[]>(`/listings/${id}/history`),
    stats: () => req<Stats>('/listings/stats'),
  },
```

Ne pas toucher à `KeywordListing`, `rowToKeywordListing`, `latestQuery`, ni à l'interface `Stats` (toujours utilisés ailleurs).

- [ ] **Step 2: Vérifier le typecheck**

Run (depuis `frontend/`) : `npx tsc --noEmit`
Expected : exit 0 (si une erreur "opportunities/validated is not a function" apparaît, c'est qu'un appelant a été oublié en Task 3/4 — le corriger avant de continuer).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "refactor(frontend): drop unused opportunities/validated API methods"
```

---

### Task 6: Vérification finale

**Files:** aucune modification (sauf correctifs éventuels).

- [ ] **Step 1: Lint des fichiers touchés**

Run (depuis `frontend/`) : `npx eslint src/components/DealCard.tsx src/components/Sidebar.tsx src/app/page.tsx src/lib/api.ts`
Expected : aucune **nouvelle** erreur sur les lignes modifiées (les warnings/`any` préexistants ailleurs sont tolérés). Corriger toute nouvelle erreur introduite (ex. import inutilisé).

- [ ] **Step 2: Build de production**

Run (depuis `frontend/`) : `npm run build`
Expected : build réussi.

- [ ] **Step 3: Contrôles visuels (manuel)**

Lancer le frontend (`npm run dev` avec `NEXT_PUBLIC_API_URL` pointant sur l'API, ou via Docker) et vérifier :
- la sidebar n'affiche que 5 liens (Dashboard, Dernières annonces, Live, Mots-clés, Réglages) ;
- `/opportunities` et `/validated` renvoient 404 ;
- sur `/listings`, les cartes n'affichent ni score, ni profit, ni prix moyen barré — seulement photo, titre, marque/taille/état, prix, fraîcheur, drapeau, liens ;
- `/` affiche le dashboard allégé (statut scraper + 4 cartes stats), sans cartes d'annonces ;
- `/live` affiche les nouvelles annonces avec la carte nettoyée.

- [ ] **Step 4: Commit éventuel des correctifs**

Si des correctifs de lint ont été nécessaires :

```bash
git add -A
git commit -m "chore(frontend): lint fixups for feed pivot"
```

---

## Notes d'exécution

- Ordre des tâches imposé : Task 3 et 4 retirent les appelants **avant** que Task 5 ne supprime les méthodes API, pour ne jamais casser le typecheck/build.
- Backend, base de données et alertes Telegram : **ne pas y toucher** (hors périmètre).
