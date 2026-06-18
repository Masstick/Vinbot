# Pivot vers un flux filtré — retrait Opportunités / Deals validés

**Date :** 2026-06-18
**Statut :** Design validé, en attente de relecture

## Contexte & problème

Le cœur "détection de deals" de Vinbot repose sur un **prix moyen de marché** calculé
à partir des prix *demandés* des annonces Vinted (médiane par mot-clé, ou par
`model_label` quand Mistral l'identifie). Ce prix moyen est jugé peu fiable par
l'utilisateur, pour des raisons structurelles :

1. **Prix demandés ≠ prix vendus** : les annonces surévaluées restent en ligne et
   gonflent la médiane → des "deals" illusoires.
2. **Hétérogénéité** : un même mot-clé mélange variantes, marques, lots, états.
3. **Auto-référence** : le "marché" se limite aux ~200 dernières annonces scrapées.

Conséquence : les pages **Opportunités** et **Deals validés**, ainsi que les
indicateurs dérivés (score de deal, profit estimé, prix moyen), n'ont plus de valeur
pour l'utilisateur.

## Décision

**Pivot produit** : Vinbot devient un **flux d'annonces brutes filtrées**. Le bot
remonte les annonces neuves correspondant à des critères précis (recherche ET déjà
en place + filtres mot-clé / pays / fraîcheur / vendeur unique), et **l'humain juge**.
On retire toute la présentation "deal calculé".

### Périmètre

- **Changements frontend uniquement.**
- **Backend inchangé** : le scraper, le calcul de prix moyen (`computeMarketAvg`),
  le pipeline Mistral et les alertes Telegram continuent de tourner tels quels.
  Raison : les alertes Telegram dépendent encore du calcul `potential_profit >=
  target_margin`, et l'utilisateur souhaite **garder Telegram tel quel pour
  l'instant**. On débranche la valorisation côté *produit*, pas côté *moteur*.

### Hors périmètre (explicite)

- Aucune modification du scraper, de la valorisation ou de Telegram.
- Pas de suppression des endpoints backend `/listings/opportunities` et
  `/listings/validated` (laissés en place, simplement plus appelés — inoffensifs).
- Pas de purge des données déjà stockées en base.
- Pas de refonte des alertes (décision reportée).

## Changements détaillés

### 1. Navigation — `frontend/src/components/Sidebar.tsx`
Retirer les liens `/opportunities` (Opportunités) et `/validated` (Deals validés).
Nav finale : **Dashboard · Dernières annonces · Live · Mots-clés · Réglages**.
Nettoyer les imports d'icônes devenus inutilisés (`TrendingUp`, `ShieldCheck`).

### 2. Carte d'annonce — `frontend/src/components/DealCard.tsx`
Retirer tous les indicateurs dérivés :
- badge "score de deal" (coin haut-droit de l'image),
- barre de score (`ScoreBar`),
- profit estimé (`+X€`),
- prix moyen barré (`Moy. X€`),
- snippet de raisonnement IA (`ReasoningSnippet`).

Conserver les faits bruts : photo, titre, marque / taille / état, **prix**, badge de
fraîcheur, drapeau pays, bouton "Voir sur Vinted", lien "Détails".

Supprimer le code mort résultant : composants `ScoreBar` et `ReasoningSnippet`, et la
déstructuration des champs `deal_score` / `market_avg` / `potential_profit`.
Conserver `getFreshnessHours`, `FreshnessBadge`, `ConditionBadge`, `countryFlag`/`FLAGS`.
La carte reçoit toujours un `KeywordListing` (inchangé) ; elle cesse simplement
d'afficher les champs calculés.

### 3. Pages supprimées
Supprimer les fichiers et dossiers :
- `frontend/src/app/opportunities/page.tsx`
- `frontend/src/app/validated/page.tsx`

### 4. API client — `frontend/src/lib/api.ts`
- Retirer `api.listings.opportunities()` et `api.listings.validated()` (plus aucun
  appelant après suppression des pages et de la section dashboard).
- Conserver `KeywordListing`, `rowToKeywordListing`, `api.listings.latest()`
  (toujours utilisés par le flux et Live).
- Conserver l'interface `Stats` telle quelle (le backend renvoie toujours
  `validated_deals` ; le champ devient juste non affiché).

### 5. Dashboard — `frontend/src/app/page.tsx`
- Retirer entièrement la section "Top 10 opportunités de revente".
- Retirer la carte stat "Deals validés IA".
- Retirer l'état `opportunities`, l'appel `api.listings.opportunities()`, et les
  imports devenus inutiles (`DealCard`, `Link`, `SkeletonCard`, icônes orphelines).
- Conserver : `ScraperStatusBar`, le bouton Actualiser, `useKeywordChanged`, et les
  4 cartes stats restantes — **Annonces analysées**, **Nouvelles (24h)**,
  **Mots-clés surveillés**, **Alertes (24h)**.

### 6. Pages inchangées
- `frontend/src/app/listings/page.tsx` (le flux) : **aucune modification** — déjà un
  flux filtré par récence, sans tri/filtre basé sur un indicateur dérivé.
- `frontend/src/app/live/page.tsx` (Live, push WebSocket) : **conservée** ; bénéficie
  automatiquement de la carte nettoyée.
- `keywords`, `settings` : inchangées.

## Vérification

Pas de nouvelle logique métier → vérification statique + visuelle :
- `npx tsc --noEmit` (frontend) : 0 erreur.
- `npx eslint` sur les fichiers modifiés : pas de nouvelle erreur (warnings
  préexistants tolérés).
- `npm run build` (frontend) : build OK.
- Contrôles manuels :
  - la sidebar n'affiche plus que 5 liens ;
  - `/opportunities` et `/validated` renvoient 404 ;
  - les cartes du flux n'affichent que des faits bruts (ni score, ni profit, ni
    prix moyen) ;
  - `/` affiche le dashboard allégé (statut scraper + 4 stats), sans cartes
    d'annonces ;
  - Live continue d'afficher les nouvelles annonces avec la carte nettoyée.

## Risques & notes

- **Aucun impact backend** : risque de régression limité au frontend.
- Le calcul de prix moyen continue de tourner et d'alimenter Telegram — comportement
  inchangé et assumé pour l'instant. Une refonte des alertes (ou le débranchement de
  la valorisation) pourra faire l'objet d'un futur chantier.
- Les annonces hors-sujet déjà en base resteront visibles dans le flux jusqu'à
  vieillissement naturel (`last_seen_at`), comme convenu (pas de purge).
