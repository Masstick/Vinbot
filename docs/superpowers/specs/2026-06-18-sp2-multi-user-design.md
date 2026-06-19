# SP2 — Comptes multi-utilisateurs — Design

## Contexte

Vinbot tourne aujourd'hui comme une appli mono-utilisateur : un seul jeu de mots-clés, une seule destination Telegram (`TELEGRAM_CHAT_ID` global), un seul feed. L'objectif de SP2 est de permettre à plusieurs personnes (2 à 5, nombre fixe, comptes créés manuellement) d'avoir chacune leurs propres mots-clés/règles et de recevoir leurs alertes sur leur propre chat Telegram — sans authentification.

C'est le 2e sous-projet de la décomposition validée plus tôt dans la session (après SP1 — suppression de la valorisation — déjà livré et déployé). SP3 (persistance des filtres) et SP4 (PWA) restent en file après SP2.

## Décisions actées avec l'utilisateur

- **Pas d'authentification.** Un simple sélecteur de profil côté frontend — n'importe qui avec accès au dashboard peut changer de profil.
- **Un `chat_id` Telegram par utilisateur.** Le bot Telegram reste unique (`TELEGRAM_BOT_TOKEN` global, inchangé) ; seule la destination des messages devient propre à chaque utilisateur.
- **Petit nombre fixe d'utilisateurs (2-5), créés manuellement** par l'utilisateur via un petit écran dédié dans Réglages (pas d'inscription self-service).
- **Le feed est filtré par profil sélectionné** : Dashboard, Live, Dernières annonces et Mots-clés ne montrent que les données liées aux mots-clés du profil actif.
- **Le scraper continue de tourner sur tous les mots-clés actifs**, tous utilisateurs confondus, en une seule boucle de scan comme aujourd'hui. Seul le routage de l'alerte Telegram change : elle part uniquement vers le `chat_id` du propriétaire du mot-clé matché (pas de double-envoi vers un `chat_id` global — `TELEGRAM_CHAT_ID` n'est plus utilisé pour le routage des alertes, seulement pour la valeur de backfill du user `Principal`).

## Architecture

### Modèle de données

Nouvelle table `users` :

```sql
CREATE TABLE IF NOT EXISTS users (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(100) NOT NULL,
  telegram_chat_id  VARCHAR(50) NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
```

`keywords` gagne une colonne d'appartenance :

```sql
ALTER TABLE keywords ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
```

Les `listings` ne changent pas de schéma : leur appartenance est dérivée via `keyword_listings.keyword_id → keywords.user_id`. Une même annonce peut matcher les mots-clés de plusieurs utilisateurs ; elle apparaîtra dans le feed de chacun d'eux séparément (le filtre se fait sur le mot-clé matché, pas sur l'annonce elle-même).

### Migration et backfill

Comme les mots-clés existants n'ont pas de propriétaire, la migration :
1. Crée un utilisateur par défaut, nommé `Principal`, avec `telegram_chat_id` = valeur actuelle de l'env var `TELEGRAM_CHAT_ID` (pour que la configuration existante continue de fonctionner sans intervention).
2. Affecte tous les mots-clés existants à cet utilisateur (`UPDATE keywords SET user_id = <id> WHERE user_id IS NULL`).
3. Une fois le backfill fait, `user_id` passe `NOT NULL`.

Si `TELEGRAM_CHAT_ID` n'est pas défini au moment de la migration, l'utilisateur par défaut est créé avec un `telegram_chat_id` vide — les alertes pour ses mots-clés seront simplement ignorées (comportement déjà existant de `TelegramService` quand non configuré) jusqu'à ce que l'utilisateur édite son profil dans Réglages.

### Propagation du profil actif (frontend → backend)

Le profil actif est propagé en **paramètre explicite `user_id`** sur chaque appel API concerné (`/keywords`, `/listings`, `/listings/stats`), plutôt qu'un header dédié — l'appli n'a pas de couche d'auth à laquelle accrocher un header, donc un header n'apporterait pas d'isolation réelle, juste de l'indirection. `api.ts` passe `user_id` comme query param sur les GET et comme champ du body sur les POST/PUT, en suivant le pattern existant de `LatestListingsParams`.

Le frontend garde le profil actif dans `localStorage` (clé `vinbot_active_user_id`) et l'expose via un contexte React (`CurrentUserProvider`), monté dans `layout.tsx` au-dessus de `Sidebar` et de toutes les pages.

### Backend

- `User` entity + `UsersModule` (CRUD complet : `GET/POST/PUT/DELETE /users`).
- `Keyword` entity : ajoute `user_id: number` + relation `ManyToOne(() => User)`.
- `KeywordsService.findAll/findActive/create/update` : acceptent et filtrent par `userId` (sauf `findActive`, appelée par le scraper, qui reste non filtrée — elle doit voir tous les utilisateurs).
- `ListingsService.getListings(opts)` : nouvel `opts.userId`, ajoute `k.user_id = $N` au `WHERE` de la requête SQL existante quand fourni.
- `ListingsService.getStats(userId?)` : si `userId` fourni, les 4 compteurs (`active_keywords`, `alerts_24h`, `listings_24h`, et `total_listings` resté global car il représente la base entière) sont recalculés avec un filtre sur les mots-clés de cet utilisateur. `total_listings` reste un total global (c'est une info sur la taille de la base, pas par utilisateur) — affiché tel quel sur le dashboard, sans ambiguïté car déjà présenté comme "Annonces en base" et non comme une métrique personnelle.
- `ScraperService.runFastScan` : `keywordsService.findActive()` doit désormais charger la relation `user` (`relations: ['user']` ou jointure SQL) pour que `maybeAlertNewListing` puisse lire `keyword.user.telegram_chat_id`.
- `TelegramService.sendListingAlert(listing, keyword, countryCode)` : résout le `chat_id` depuis `keyword.user.telegram_chat_id` au lieu de l'env var `TELEGRAM_CHAT_ID`. Si ce chat_id est vide/absent, l'alerte est ignorée pour ce mot-clé (log warning), sans bloquer les autres utilisateurs.
- `TelegramService.sendTest(chatId)` : prend désormais le `chat_id` à tester en paramètre (celui du profil actif côté Settings), au lieu de l'unique chat_id global.

### Frontend

- `UserPicker` : dropdown dans le header de la `Sidebar`, liste les utilisateurs (`GET /users`), change le profil actif au clic.
- Nouveau panneau "Utilisateurs" dans `/settings` : liste + formulaire ajout/édition/suppression (`name`, `telegram_chat_id`), pas d'authentification.
- `KeywordForm` : envoie `user_id` = profil actif lors de la création (pas de champ visible, c'est automatique).
- Dashboard / Live / Listings / Keywords : toutes les requêtes passent `user_id` = profil actif.
- **Cas premier démarrage / aucun profil sélectionné** : si `localStorage` ne contient pas de profil valide (ou si la liste d'utilisateurs ne contient pas cet id), l'app redirige vers `/settings` avec le panneau Utilisateurs ouvert, et bloque l'accès aux autres pages tant qu'aucun profil n'est sélectionné (message "Sélectionnez ou créez un profil pour continuer").
- Panneau "Test Telegram" dans Réglages : teste désormais le `chat_id` du profil actif, pas un chat_id global.

## Hors scope (pour rester focalisé)

- Pas de notion de mot-clé partagé entre utilisateurs — chaque mot-clé appartient à un seul utilisateur.
- Pas de rôle admin/permissions — tous les profils sont égaux, n'importe qui peut éditer n'importe quel profil depuis le panneau Utilisateurs (cohérent avec "pas d'authentification").
- Pas de suppression en cascade testée pour un utilisateur ayant encore des mots-clés actifs au-delà du `ON DELETE CASCADE` SQL standard — supprimer un utilisateur supprime ses mots-clés et leurs `keyword_listings` associés (les `listings` eux-mêmes restent, partagés).
