# Fondation (Auth compte Vinted) + Bloc A (Stock & commandes) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à Vinbot de se connecter au compte Vinted de l'utilisateur (bouton « Connecter Vinted » via navigateur streamé noVNC) et de rapatrier son stock (annonces actives + stats, ventes/commandes) avec prix d'achat manuel et filtres.

**Architecture:** Trois nouveaux modules NestJS — `accounts` (compte + session chiffrée + refresh), `vinted-connect` (orchestration du login via un Chromium streamé en sidecar Docker, capture de session par CDP), `inventory` (synchro HTTP authentifiée + stockage produits/annonces/ventes). Le login interactif passe par un navigateur réel (sidecar `connect-browser` = Chromium + Xvfb + x11vnc + noVNC) ; **toutes les lectures de stock se font en HTTP** avec les cookies capturés (réutilisation du pattern `axios-cookiejar-support` existant). Frontend Next.js 16 : page Compte (bouton + modale noVNC), page Inventaire (DataTable + filtres), page Ventes.

**Tech Stack:** NestJS 11 + TypeORM 0.3 + PostgreSQL 16 (schéma manuel dans `db/init.sql`, `synchronize: false`), `@nestjs/schedule` (déjà installé, pour les `@Cron`), `axios` + `axios-cookiejar-support` + `tough-cookie` (déjà installés), `playwright-core` (nouveau, client CDP léger côté API — pas de téléchargement de navigateur), Node `crypto` (chiffrement AES-256-GCM), conteneur sidecar Chromium/Xvfb/x11vnc/noVNC, Next.js 16 + Tailwind + lucide-react (déjà en place).

## Global Constraints

- **`synchronize: false`** — le schéma est géré exclusivement dans `db/init.sql`. Jamais activer synchronize. ([[schema-no-migration-runner]])
- **Pas de recréation de volume Postgres** pour appliquer le schéma : la base de prod contient des données et `init.sql` ne rejoue pas sur un volume existant. Les nouvelles tables s'appliquent **par exécution manuelle du SQL** sur la base en place (voir Task 1). Recréer le volume casserait l'app.
- **Backend** : tests unitaires Jest (`npm run test`), `testRegex: .*\.spec\.ts$`, `rootDir: src`. Chaque tâche backend suit TDD.
- **Frontend** : **aucun runner de test** (pas de Jest). Les tâches frontend sont « build + vérification manuelle dans l'app ». Next.js **16** : lire `node_modules/next/dist/docs/` avant de toucher routing/config (cf. `frontend/AGENTS.md`).
- **Préfixe API** : toutes les routes backend sont servies sous `/api` (`app.setGlobalPrefix('api')`). Le front appelle via `frontend/src/lib/api.ts` (helper `req`, base `NEXT_PUBLIC_API_URL`).
- **Module `listings` actuel = sourcing** : ne pas le modifier. Le stock vendeur vit dans le nouveau module `inventory`.
- **Cadence Vinted prudente** : intervalles + jitter sur toute synchro, même en lecture. Ne jamais boucler agressivement sur un 403.
- **Risque ban assumé**, mais aucune écriture Vinted dans ce cycle (lecture seule + login interactif humain).
- **Langue** : code/commentaires en français comme l'existant. Messages de commit en français, style Conventional Commits (`feat(scope):`, `fix(scope):`...).

---

## Phase 0 — Schéma & dépendances

### Task 1 : Schéma SQL des tables vendeur

**Files:**
- Modify: `db/init.sql` (append en fin de fichier, avant rien — c'est la source de vérité pour une install neuve)
- Create: `db/seller-tables.sql` (script idempotent à exécuter à la main sur une base existante)

**Interfaces:**
- Produces: tables `vinted_accounts`, `products`, `seller_listings`, `sales` + index. Ces noms/colonnes sont consommés par toutes les entités TypeORM des tâches suivantes.

- [ ] **Step 1 : Écrire le SQL des tables dans un script idempotent réutilisable**

Create `db/seller-tables.sql` :

```sql
-- Tables côté VENTE (fondation auth + bloc A stock). Idempotent : exécutable
-- aussi bien sur une base neuve (via init.sql qui l'inclut) que sur une base
-- existante (exécution manuelle, voir CLAUDE.md — NE PAS recréer le volume).

CREATE TABLE IF NOT EXISTS vinted_accounts (
  id              SERIAL PRIMARY KEY,
  label           VARCHAR(100) NOT NULL,
  vinted_user_id  BIGINT,
  session_data    TEXT,                 -- JSON chiffré (AES-256-GCM) : cookies + storageState
  status          VARCHAR(20) NOT NULL DEFAULT 'disconnected', -- connected|expired|disconnected
  connected_at    TIMESTAMPTZ,
  last_refresh_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id              SERIAL PRIMARY KEY,
  account_id      INTEGER NOT NULL REFERENCES vinted_accounts(id) ON DELETE CASCADE,
  title           VARCHAR(500),
  brand           VARCHAR(255),
  size_label      VARCHAR(100),
  category        VARCHAR(100),
  condition_label VARCHAR(100),
  purchase_price  DECIMAL(10,2),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

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

> Note : `session_data` est `TEXT` (et non `JSONB`) car on y stocke un **blob chiffré**, pas du JSON requêtable.

- [ ] **Step 2 : Inclure ces tables dans `init.sql`** (pour les installations neuves)

Append le **contenu intégral** des `CREATE TABLE`/`CREATE INDEX` ci-dessus à la fin de `db/init.sql` (copier les mêmes instructions ; elles sont `IF NOT EXISTS` donc sans risque). Ajouter en tête de section un commentaire :

```sql
-- ============================================================
-- Tables côté VENTE (fondation auth + bloc A stock & commandes)
-- Voir db/seller-tables.sql pour le script d'application manuelle.
-- ============================================================
```

- [ ] **Step 3 : Appliquer le SQL sur la base en cours (sans recréer le volume)**

Run (depuis la racine, conteneur `db` up) :

```bash
docker compose exec -T db psql -U "${DB_USER:-postgres}" -d "${DB_NAME:-vinbot}" < db/seller-tables.sql
```

Expected: aucune erreur (`CREATE TABLE` / `CREATE INDEX`, ou `NOTICE ... already exists, skipping`).

- [ ] **Step 4 : Vérifier la présence des tables**

Run :

```bash
docker compose exec -T db psql -U "${DB_USER:-postgres}" -d "${DB_NAME:-vinbot}" -c "\dt vinted_accounts products seller_listings sales"
```

Expected: les 4 tables listées.

- [ ] **Step 5 : Commit**

```bash
git add db/init.sql db/seller-tables.sql
git commit -m "feat(db): tables vendeur (vinted_accounts, products, seller_listings, sales)"
```

---

### Task 2 : Dépendance `playwright-core` (client CDP léger)

**Files:**
- Modify: `backend/package.json`

**Interfaces:**
- Produces: `playwright-core` disponible pour `chromium.connectOverCDP(...)` dans Task 7. Pas de navigateur téléchargé côté API (le navigateur vit dans le sidecar).

- [ ] **Step 1 : Installer playwright-core**

Run :

```bash
cd backend && npm install playwright-core@^1.49.0
```

- [ ] **Step 2 : Vérifier l'installation**

Run :

```bash
cd backend && node -e "require('playwright-core'); console.log('playwright-core OK')"
```

Expected: `playwright-core OK` (aucune erreur de module manquant).

- [ ] **Step 3 : Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore(deps): playwright-core pour le client CDP du flux de connexion"
```

---

## Phase 1 — Fondation : compte & session chiffrée

### Task 3 : Utilitaire de chiffrement de session

**Files:**
- Create: `backend/src/accounts/session-crypto.ts`
- Test: `backend/src/accounts/session-crypto.spec.ts`

**Interfaces:**
- Produces:
  - `encryptSession(plaintext: string, key: string): string` — renvoie une chaîne `iv:authTag:ciphertext` en base64, séparés par `.`
  - `decryptSession(payload: string, key: string): string` — renvoie le plaintext, lève `Error` si la clé est mauvaise ou le payload corrompu.
  - La clé brute (hex/utf8) est dérivée en 32 octets via `crypto.createHash('sha256')`.

- [ ] **Step 1 : Écrire le test qui échoue**

```typescript
// backend/src/accounts/session-crypto.spec.ts
import { encryptSession, decryptSession } from './session-crypto';

describe('session-crypto', () => {
  const key = 'clef-de-test-quelconque';

  it('chiffre puis déchiffre et retrouve le plaintext', () => {
    const plain = JSON.stringify({ cookies: [{ name: 'a', value: 'b' }] });
    const enc = encryptSession(plain, key);
    expect(enc).not.toContain('cookies'); // le ciphertext ne fuit pas le contenu
    expect(decryptSession(enc, key)).toBe(plain);
  });

  it('produit un ciphertext différent à chaque appel (IV aléatoire)', () => {
    expect(encryptSession('x', key)).not.toBe(encryptSession('x', key));
  });

  it('lève une erreur si la clé est mauvaise', () => {
    const enc = encryptSession('secret', key);
    expect(() => decryptSession(enc, 'mauvaise-clef')).toThrow();
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd backend && npm run test -- --testPathPattern=session-crypto`
Expected: FAIL (`Cannot find module './session-crypto'`).

- [ ] **Step 3 : Écrire l'implémentation minimale**

```typescript
// backend/src/accounts/session-crypto.ts
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';

function deriveKey(key: string): Buffer {
  return createHash('sha256').update(key, 'utf8').digest(); // 32 octets
}

/** Chiffre un plaintext en `iv.authTag.ciphertext` (chaque segment en base64). */
export function encryptSession(plaintext: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, deriveKey(key), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

/** Déchiffre un payload produit par encryptSession. Lève si clé/payload invalides. */
export function decryptSession(payload: string, key: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Payload de session invalide');
  const decipher = createDecipheriv(ALGO, deriveKey(key), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `cd backend && npm run test -- --testPathPattern=session-crypto`
Expected: PASS (3 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/accounts/session-crypto.ts backend/src/accounts/session-crypto.spec.ts
git commit -m "feat(accounts): chiffrement AES-256-GCM des sessions Vinted"
```

---

### Task 4 : Entité `VintedAccount` + module `accounts`

**Files:**
- Create: `backend/src/accounts/vinted-account.entity.ts`
- Create: `backend/src/accounts/accounts.module.ts`
- Modify: `backend/src/app.module.ts` (enregistrer l'entité + le module)

**Interfaces:**
- Produces:
  - Entité `VintedAccount` avec champs : `id, label, vinted_user_id, session_data, status, connected_at, last_refresh_at, created_at, updated_at`.
  - Type `AccountStatus = 'connected' | 'expired' | 'disconnected'`.
  - `AccountsModule` exporte `AccountsService` (créé Task 5).

- [ ] **Step 1 : Écrire l'entité**

```typescript
// backend/src/accounts/vinted-account.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type AccountStatus = 'connected' | 'expired' | 'disconnected';

@Entity('vinted_accounts')
export class VintedAccount {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  label: string;

  @Column({ type: 'bigint', nullable: true, transformer: { to: (v) => v, from: (v) => (v == null ? null : Number(v)) } })
  vinted_user_id: number | null;

  @Column({ type: 'text', nullable: true })
  session_data: string | null;

  @Column({ type: 'varchar', length: 20, default: 'disconnected' })
  status: AccountStatus;

  @Column({ type: 'timestamptz', nullable: true })
  connected_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_refresh_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
```

> Le `transformer` sur `vinted_user_id` : `pg` renvoie les `bigint` en `string` ; on reconvertit en `number` (les IDs Vinted tiennent dans un `number` JS).

- [ ] **Step 2 : Écrire le module (provider/controller ajoutés Task 5-7)**

```typescript
// backend/src/accounts/accounts.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VintedAccount } from './vinted-account.entity';

@Module({
  imports: [TypeOrmModule.forFeature([VintedAccount])],
  providers: [],
  controllers: [],
  exports: [],
})
export class AccountsModule {}
```

- [ ] **Step 3 : Enregistrer l'entité + le module dans `app.module.ts`**

Dans `backend/src/app.module.ts` :
- ajouter l'import : `import { AccountsModule } from './accounts/accounts.module';`
- ajouter l'import d'entité : `import { VintedAccount } from './accounts/vinted-account.entity';`
- ajouter `VintedAccount` au tableau `entities: [...]`
- ajouter `AccountsModule` au tableau `imports: [...]`

- [ ] **Step 4 : Vérifier la compilation**

Run: `cd backend && npm run build`
Expected: build OK, aucune erreur TypeScript.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/accounts/vinted-account.entity.ts backend/src/accounts/accounts.module.ts backend/src/app.module.ts
git commit -m "feat(accounts): entité VintedAccount + module"
```

---

### Task 5 : `AccountsService` (persistance + chiffrement)

**Files:**
- Create: `backend/src/accounts/accounts.service.ts`
- Test: `backend/src/accounts/accounts.service.spec.ts`
- Modify: `backend/src/accounts/accounts.module.ts` (déclarer le provider)

**Interfaces:**
- Consumes: `VintedAccount` entity, `encryptSession`/`decryptSession` (Task 3), `ConfigService` (clé `SESSION_ENCRYPTION_KEY`).
- Produces (méthodes publiques) :
  - `getAccount(): Promise<VintedAccount | null>` — l'unique compte (outil mono-compte ; renvoie le 1er par id).
  - `saveSession(input: { vintedUserId: number; sessionJson: string; label?: string }): Promise<VintedAccount>` — crée ou met à jour le compte, chiffre `sessionJson`, passe `status='connected'`, renseigne `connected_at`/`last_refresh_at`.
  - `getDecryptedSession(): Promise<string | null>` — déchiffre `session_data`, ou `null` si pas de compte/connexion.
  - `setStatus(status: AccountStatus): Promise<void>`.
  - `touchRefreshed(sessionJson: string): Promise<void>` — met à jour le blob chiffré + `last_refresh_at` (utilisé par le refresh).

- [ ] **Step 1 : Écrire les tests qui échouent**

```typescript
// backend/src/accounts/accounts.service.spec.ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AccountsService } from './accounts.service';
import { VintedAccount } from './vinted-account.entity';

function repoMock() {
  const store: VintedAccount[] = [];
  return {
    store,
    find: jest.fn(async () => store.slice().sort((a, b) => a.id - b.id)),
    create: jest.fn((d: Partial<VintedAccount>) => ({ ...d }) as VintedAccount),
    save: jest.fn(async (a: VintedAccount) => {
      if (!a.id) { a.id = store.length + 1; store.push(a); }
      else { const i = store.findIndex(x => x.id === a.id); if (i >= 0) store[i] = a; }
      return a;
    }),
    update: jest.fn(async (id: number, patch: Partial<VintedAccount>) => {
      const a = store.find(x => x.id === id); if (a) Object.assign(a, patch);
      return { affected: a ? 1 : 0 };
    }),
  };
}

async function build(repo: ReturnType<typeof repoMock>) {
  const mod = await Test.createTestingModule({
    providers: [
      AccountsService,
      { provide: getRepositoryToken(VintedAccount), useValue: repo },
      { provide: ConfigService, useValue: { get: (_k: string, d?: string) => 'cle-test' ?? d } },
    ],
  }).compile();
  return mod.get(AccountsService);
}

describe('AccountsService', () => {
  it('saveSession crée le compte, chiffre la session et le marque connected', async () => {
    const repo = repoMock();
    const svc = await build(repo);
    const acc = await svc.saveSession({ vintedUserId: 42, sessionJson: '{"cookies":[]}', label: 'Moi' });
    expect(acc.status).toBe('connected');
    expect(acc.vinted_user_id).toBe(42);
    expect(acc.session_data).not.toContain('cookies'); // chiffré
    expect(acc.connected_at).toBeInstanceOf(Date);
  });

  it('getDecryptedSession retrouve le JSON en clair', async () => {
    const repo = repoMock();
    const svc = await build(repo);
    await svc.saveSession({ vintedUserId: 1, sessionJson: '{"cookies":[1]}' });
    expect(await svc.getDecryptedSession()).toBe('{"cookies":[1]}');
  });

  it('saveSession met à jour le compte existant sans en créer un second', async () => {
    const repo = repoMock();
    const svc = await build(repo);
    await svc.saveSession({ vintedUserId: 1, sessionJson: 'a' });
    await svc.saveSession({ vintedUserId: 2, sessionJson: 'b' });
    expect(repo.store.length).toBe(1);
    expect((await svc.getAccount())!.vinted_user_id).toBe(2);
  });

  it('setStatus passe le compte à expired', async () => {
    const repo = repoMock();
    const svc = await build(repo);
    await svc.saveSession({ vintedUserId: 1, sessionJson: 'a' });
    await svc.setStatus('expired');
    expect((await svc.getAccount())!.status).toBe('expired');
  });
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `cd backend && npm run test -- --testPathPattern=accounts.service`
Expected: FAIL (`Cannot find module './accounts.service'`).

- [ ] **Step 3 : Écrire l'implémentation**

```typescript
// backend/src/accounts/accounts.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VintedAccount, AccountStatus } from './vinted-account.entity';
import { encryptSession, decryptSession } from './session-crypto';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(VintedAccount)
    private readonly repo: Repository<VintedAccount>,
    private readonly config: ConfigService,
  ) {}

  private key(): string {
    return this.config.get<string>('SESSION_ENCRYPTION_KEY', 'vinbot-dev-key');
  }

  async getAccount(): Promise<VintedAccount | null> {
    const all = await this.repo.find();
    if (!all.length) return null;
    return all.sort((a, b) => a.id - b.id)[0];
  }

  async saveSession(input: { vintedUserId: number; sessionJson: string; label?: string }): Promise<VintedAccount> {
    const now = new Date();
    const enc = encryptSession(input.sessionJson, this.key());
    let acc = await this.getAccount();
    if (!acc) {
      acc = this.repo.create({ label: input.label ?? 'Mon compte Vinted' });
    } else if (input.label) {
      acc.label = input.label;
    }
    acc.vinted_user_id = input.vintedUserId;
    acc.session_data = enc;
    acc.status = 'connected';
    acc.connected_at = now;
    acc.last_refresh_at = now;
    return this.repo.save(acc);
  }

  async getDecryptedSession(): Promise<string | null> {
    const acc = await this.getAccount();
    if (!acc?.session_data) return null;
    return decryptSession(acc.session_data, this.key());
  }

  async setStatus(status: AccountStatus): Promise<void> {
    const acc = await this.getAccount();
    if (!acc) return;
    await this.repo.update(acc.id, { status, updated_at: new Date() });
  }

  async touchRefreshed(sessionJson: string): Promise<void> {
    const acc = await this.getAccount();
    if (!acc) return;
    await this.repo.update(acc.id, {
      session_data: encryptSession(sessionJson, this.key()),
      last_refresh_at: new Date(),
      status: 'connected',
      updated_at: new Date(),
    });
  }
}
```

- [ ] **Step 4 : Déclarer le provider dans le module**

Dans `backend/src/accounts/accounts.module.ts` : importer `AccountsService`, l'ajouter à `providers` **et** `exports`.

- [ ] **Step 5 : Lancer les tests pour vérifier qu'ils passent**

Run: `cd backend && npm run test -- --testPathPattern=accounts.service`
Expected: PASS (4 tests).

- [ ] **Step 6 : Commit**

```bash
git add backend/src/accounts/accounts.service.ts backend/src/accounts/accounts.service.spec.ts backend/src/accounts/accounts.module.ts
git commit -m "feat(accounts): AccountsService (persistance + chiffrement de session)"
```

---

## Phase 2 — Le navigateur de connexion (sidecar) & capture de session

### Task 6 : Sidecar Docker `connect-browser` (Chromium + Xvfb + x11vnc + noVNC)

**Files:**
- Create: `connect-browser/Dockerfile`
- Create: `connect-browser/start.sh`
- Modify: `docker-compose.yml` (nouveau service `connect-browser`)
- Modify: `.env.example` (variables noVNC / CDP)

**Interfaces:**
- Produces:
  - Un conteneur exposant **CDP** sur `9222` (Chromium `--remote-debugging-port`) accessible depuis l'API via le réseau Docker (`http://connect-browser:9222`).
  - Un endpoint **noVNC** sur `6080` (websockify → x11vnc → Xvfb) accessible depuis le navigateur de l'utilisateur (`http://<host>:6080/vnc.html`).
  - Variables d'env consommées par Task 7 : `CDP_URL=http://connect-browser:9222`, et côté front `NEXT_PUBLIC_NOVNC_URL`.

- [ ] **Step 1 : Écrire le script de démarrage**

```bash
# connect-browser/start.sh
#!/usr/bin/env bash
set -e

# Affichage virtuel
Xvfb :0 -screen 0 1280x900x24 -ac +extension RANDR &
export DISPLAY=:0
sleep 1

# Serveur VNC sur l'affichage virtuel (pas de mot de passe : réseau local seulement)
x11vnc -display :0 -nopw -forever -shared -rfbport 5900 -bg

# Pont websocket noVNC -> VNC, sert l'UI noVNC sur 6080
websockify --web=/usr/share/novnc 6080 localhost:5900 &

# Chromium headful avec CDP exposé sur toutes les interfaces du conteneur
exec chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port=9222 \
  --start-maximized \
  --window-size=1280,900 \
  "https://www.vinted.fr"
```

> `--no-sandbox` est nécessaire en conteneur. CDP est exposé sur le réseau Docker (jamais publié sur l'hôte) ; seul `6080` (noVNC) est publié.

- [ ] **Step 2 : Écrire le Dockerfile**

```dockerfile
# connect-browser/Dockerfile
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium xvfb x11vnc novnc websockify ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

# Certaines images Debian nomment le binaire "chromium" ; on s'assure qu'il est dans le PATH.
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 6080 9222
CMD ["/start.sh"]
```

- [ ] **Step 3 : Ajouter le service au `docker-compose.yml`**

Ajouter sous `services:` :

```yaml
  connect-browser:
    build:
      context: ./connect-browser
      dockerfile: Dockerfile
    restart: unless-stopped
    shm_size: "1gb"
    ports:
      - "6080:6080"   # noVNC (UI accessible depuis ton navigateur)
    # 9222 (CDP) volontairement NON publié : accessible seulement via le réseau Docker.
```

Et ajouter au service `api`, dans `environment:` :

```yaml
      CDP_URL: http://connect-browser:9222
      SESSION_ENCRYPTION_KEY: ${SESSION_ENCRYPTION_KEY:-vinbot-dev-key}
```

Et au service `frontend`, dans `args:` (build-time) :

```yaml
        NEXT_PUBLIC_NOVNC_URL: http://192.168.0.40:6080/vnc.html?autoconnect=1&resize=scale
```

> Adapter `192.168.0.40` à l'IP réelle de la VM (même IP que `NEXT_PUBLIC_API_URL`).

- [ ] **Step 4 : Documenter les variables**

Ajouter à `.env.example` :

```
# Clé de chiffrement au repos des sessions Vinted (changer en prod)
SESSION_ENCRYPTION_KEY=change-moi
```

- [ ] **Step 5 : Builder et démarrer le sidecar, vérifier noVNC et CDP**

Run :

```bash
docker compose up -d --build connect-browser
sleep 8
curl -sf http://localhost:9222/json/version >/dev/null && echo "CDP OK"
curl -sf http://localhost:6080/vnc.html >/dev/null || curl -sf http://localhost:6080/ >/dev/null && echo "noVNC OK"
```

Expected: `CDP OK` puis `noVNC OK`. (Le port 9222 n'est pas publié en prod ; ici on teste depuis l'hôte uniquement si on l'expose temporairement, sinon tester depuis le conteneur api — voir note.)

> Note : comme `9222` n'est pas publié, pour le test depuis l'hôte tu peux soit l'exposer temporairement, soit tester depuis un autre conteneur : `docker compose exec api wget -qO- http://connect-browser:9222/json/version`. La vérif noVNC (6080) se fait depuis l'hôte.

- [ ] **Step 6 : Vérification manuelle visuelle**

Ouvrir `http://<ip-vm>:6080/vnc.html` dans un navigateur → tu dois voir Chromium affichant la page d'accueil Vinted.

- [ ] **Step 7 : Commit**

```bash
git add connect-browser/ docker-compose.yml .env.example
git commit -m "feat(connect): sidecar Chromium + noVNC + CDP pour la connexion Vinted"
```

---

### Task 7 : `VintedConnectService` — capture de session par CDP

**Files:**
- Create: `backend/src/accounts/vinted-connect.service.ts`
- Test: `backend/src/accounts/vinted-connect.spec.ts`
- Modify: `backend/src/accounts/accounts.module.ts` (déclarer le provider + `ScheduleModule` non requis ici)

**Interfaces:**
- Consumes: `playwright-core` (`chromium.connectOverCDP`), `AccountsService.saveSession`, `ConfigService` (`CDP_URL`).
- Produces:
  - `startConnect(): Promise<{ novncReady: true }>` — (re)charge la page de login Vinted dans le Chromium du sidecar via CDP (navigation seule ; l'utilisateur agit ensuite dans noVNC).
  - `detectAndCapture(): Promise<{ connected: boolean; vintedUserId?: number }>` — inspecte le contexte du sidecar : si l'utilisateur est loggé (cookie `access_token_web` présent ET endpoint `/api/v2/users/current` répond 200), capture `cookies + localStorage` (storageState) en JSON, appelle `AccountsService.saveSession`, renvoie `connected:true`. Sinon `connected:false`.
  - Helper pur testable : `isLoggedIn(cookies: {name:string}[]): boolean` (présence d'un cookie d'auth Vinted parmi `access_token_web` / `_vinted_fr_session`).
  - Helper pur testable : `buildSessionJson(cookies: any[], origins: any[]): string`.

- [ ] **Step 1 : Écrire les tests des helpers purs (échouent)**

```typescript
// backend/src/accounts/vinted-connect.spec.ts
import { isLoggedIn, buildSessionJson } from './vinted-connect.service';

describe('vinted-connect helpers', () => {
  it('isLoggedIn vrai si cookie access_token_web présent', () => {
    expect(isLoggedIn([{ name: 'access_token_web' }, { name: 'other' }])).toBe(true);
  });
  it('isLoggedIn vrai si cookie _vinted_fr_session présent', () => {
    expect(isLoggedIn([{ name: '_vinted_fr_session' }])).toBe(true);
  });
  it('isLoggedIn faux sans cookie d auth', () => {
    expect(isLoggedIn([{ name: 'cf_clearance' }])).toBe(false);
  });
  it('buildSessionJson produit un JSON parseable {cookies, origins}', () => {
    const json = buildSessionJson([{ name: 'a', value: 'b' }], [{ origin: 'https://www.vinted.fr', localStorage: [] }]);
    const parsed = JSON.parse(json);
    expect(parsed.cookies).toHaveLength(1);
    expect(parsed.origins[0].origin).toBe('https://www.vinted.fr');
  });
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `cd backend && npm run test -- --testPathPattern=vinted-connect`
Expected: FAIL (module introuvable).

- [ ] **Step 3 : Écrire le service + helpers**

```typescript
// backend/src/accounts/vinted-connect.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, Browser } from 'playwright-core';
import { AccountsService } from './accounts.service';

const AUTH_COOKIES = ['access_token_web', '_vinted_fr_session'];

/** Helper pur : l'utilisateur est-il loggé d'après ses cookies ? */
export function isLoggedIn(cookies: { name: string }[]): boolean {
  return cookies.some((c) => AUTH_COOKIES.includes(c.name));
}

/** Helper pur : sérialise un storageState minimal { cookies, origins }. */
export function buildSessionJson(cookies: any[], origins: any[]): string {
  return JSON.stringify({ cookies, origins });
}

@Injectable()
export class VintedConnectService {
  private readonly logger = new Logger(VintedConnectService.name);

  constructor(
    private readonly accounts: AccountsService,
    private readonly config: ConfigService,
  ) {}

  private cdpUrl(): string {
    return this.config.get<string>('CDP_URL', 'http://localhost:9222');
  }

  private async withBrowser<T>(fn: (b: Browser) => Promise<T>): Promise<T> {
    const browser = await chromium.connectOverCDP(this.cdpUrl());
    try {
      return await fn(browser);
    } finally {
      // connectOverCDP : close() détache le client CDP sans tuer le Chromium du sidecar.
      await browser.close();
    }
  }

  /** Recharge la page de login Vinted dans le Chromium streamé. */
  async startConnect(): Promise<{ novncReady: true }> {
    await this.withBrowser(async (browser) => {
      const ctx = browser.contexts()[0] ?? (await browser.newContext());
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto('https://www.vinted.fr/member/signup/select_type?ref_url=%2F', { waitUntil: 'domcontentloaded' }).catch(() => {});
    });
    return { novncReady: true };
  }

  /** Détecte le login et capture la session si présent. */
  async detectAndCapture(): Promise<{ connected: boolean; vintedUserId?: number }> {
    return this.withBrowser(async (browser) => {
      const ctx = browser.contexts()[0];
      if (!ctx) return { connected: false };
      const cookies = await ctx.cookies();
      if (!isLoggedIn(cookies)) return { connected: false };

      // Confirme via l'endpoint user courant, et récupère l'id.
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      const resp = await page.request.get('https://www.vinted.fr/api/v2/users/current').catch(() => null);
      if (!resp || !resp.ok()) return { connected: false };
      const body = await resp.json().catch(() => ({} as any));
      const vintedUserId = Number(body?.user?.id ?? body?.id ?? 0) || 0;
      if (!vintedUserId) return { connected: false };

      const state = await ctx.storageState();
      const sessionJson = buildSessionJson(state.cookies, state.origins);
      await this.accounts.saveSession({ vintedUserId, sessionJson });
      this.logger.log(`Session Vinted capturée (user ${vintedUserId})`);
      return { connected: true, vintedUserId };
    });
  }
}
```

- [ ] **Step 4 : Déclarer le provider**

Dans `accounts.module.ts` : ajouter `VintedConnectService` à `providers` et `exports`. Ajouter `ConfigModule` aux imports si nécessaire (il est global via `ConfigModule.forRoot({ isGlobal: true })` dans `app.module.ts`, donc `ConfigService` est déjà injectable — pas d'import à ajouter).

- [ ] **Step 5 : Lancer les tests pour vérifier qu'ils passent**

Run: `cd backend && npm run test -- --testPathPattern=vinted-connect`
Expected: PASS (4 tests).

- [ ] **Step 6 : Commit**

```bash
git add backend/src/accounts/vinted-connect.service.ts backend/src/accounts/vinted-connect.spec.ts backend/src/accounts/accounts.module.ts
git commit -m "feat(connect): capture de session Vinted via CDP (VintedConnectService)"
```

---

### Task 8 : `AccountsController` — endpoints de connexion & statut

**Files:**
- Create: `backend/src/accounts/accounts.controller.ts`
- Modify: `backend/src/accounts/accounts.module.ts` (déclarer le controller)

**Interfaces:**
- Consumes: `AccountsService`, `VintedConnectService`.
- Produces (routes, préfixe `/api`) :
  - `GET /accounts/status` → `{ connected: boolean; status: AccountStatus | 'none'; label?: string; vinted_user_id?: number; connected_at?: string }`
  - `POST /accounts/connect/start` → `{ novncReady: true }` (charge la page login dans le sidecar)
  - `POST /accounts/connect/poll` → `{ connected: boolean; vintedUserId?: number }` (le front poll après que l'utilisateur s'est loggé dans noVNC)

- [ ] **Step 1 : Écrire le controller**

```typescript
// backend/src/accounts/accounts.controller.ts
import { Controller, Get, Post } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { VintedConnectService } from './vinted-connect.service';

@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly connect: VintedConnectService,
  ) {}

  @Get('status')
  async status() {
    const acc = await this.accounts.getAccount();
    if (!acc) return { connected: false, status: 'none' as const };
    return {
      connected: acc.status === 'connected',
      status: acc.status,
      label: acc.label,
      vinted_user_id: acc.vinted_user_id ?? undefined,
      connected_at: acc.connected_at ?? undefined,
    };
  }

  @Post('connect/start')
  start() {
    return this.connect.startConnect();
  }

  @Post('connect/poll')
  poll() {
    return this.connect.detectAndCapture();
  }
}
```

- [ ] **Step 2 : Déclarer le controller dans le module**

Dans `accounts.module.ts` : ajouter `AccountsController` à `controllers`.

- [ ] **Step 3 : Vérifier la compilation et le démarrage**

Run: `cd backend && npm run build`
Expected: build OK.

- [ ] **Step 4 : Vérification manuelle de bout en bout (le flux « Connecter Vinted »)**

```bash
docker compose up -d --build api connect-browser
curl -s -X POST http://localhost:3003/api/accounts/connect/start
# → {"novncReady":true}
```
Puis ouvrir `http://<ip-vm>:6080/vnc.html`, se connecter à Vinted à la main, puis :
```bash
curl -s -X POST http://localhost:3003/api/accounts/connect/poll
# → {"connected":true,"vintedUserId":<ton id>}
curl -s http://localhost:3003/api/accounts/status
# → {"connected":true,"status":"connected",...}
```
Expected: `connected:true` après login.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/accounts/accounts.controller.ts backend/src/accounts/accounts.module.ts
git commit -m "feat(accounts): endpoints status + connect (start/poll)"
```

---

## Phase 3 — Client HTTP authentifié & refresh

### Task 9 : `VintedSellerClient` — requêtes authentifiées + mapping

**Files:**
- Create: `backend/src/inventory/vinted-seller.client.ts`
- Test: `backend/src/inventory/vinted-seller.client.spec.ts`

**Interfaces:**
- Consumes: `axios` + `axios-cookiejar-support` + `tough-cookie` (pattern identique à `VintedClient`), un `sessionJson` (storageState) fourni par l'appelant.
- Produces:
  - `class VintedSellerClient { constructor(sessionJson: string) }`
  - `async getMemberItems(userId: number, page?: number): Promise<SellerItem[]>`
  - `async getSales(): Promise<SaleRecord[]>`
  - `async keepAlive(): Promise<string>` — refait une requête légère et **renvoie le storageState JSON à jour** (cookies rotés). Lève `Error('SESSION_EXPIRED')` si 401/403.
  - Helpers purs testables (exportés) :
    - `mapMemberItem(raw: any): SellerItem`
    - `mapSale(raw: any): SaleRecord`
  - Types exportés :
    - `SellerItem = { vinted_id: number; title: string; price: number; url: string; photo_url: string; brand: string; size_label: string; condition_label: string; status: 'ONLINE'|'RESERVED'|'SOLD'|'DELETED'; view_count: number; favourite_count: number; vinted_created_at: Date | null }`
    - `SaleRecord = { vinted_order_id: number; buyer_name: string; sale_price: number; shipping_status: string; sold_at: Date | null; vinted_item_id: number | null }`

> Endpoints Vinted retenus (confirmer la forme exacte au 1er run réel ; le mapping est isolé et testé sur fixtures, donc ajustable sans toucher au reste) :
> - articles du membre : `GET /api/v2/users/{id}/items?per_page=96&page=N` → `{ items: [...] }`
> - ventes : `GET /api/v2/my_orders?type=sold&page=1&per_page=50` → `{ my_orders: [...] }`
> Si une forme diffère, seul le mapper + l'URL changent.

- [ ] **Step 1 : Écrire les tests des mappers (échouent)**

```typescript
// backend/src/inventory/vinted-seller.client.spec.ts
import { mapMemberItem, mapSale } from './vinted-seller.client';

describe('mapMemberItem', () => {
  it('mappe un article actif avec stats', () => {
    const raw = {
      id: 123, title: 'Jean Levis 501', price: { amount: '25.00' },
      url: 'https://www.vinted.fr/items/123', photo: { url: 'http://img/1.jpg' },
      brand_title: 'Levis', size_title: 'W32', status: 'Très bon état',
      view_count: 10, favourite_count: 3, is_closed: false, is_reserved: false,
      created_at_ts: 1700000000,
    };
    const m = mapMemberItem(raw);
    expect(m.vinted_id).toBe(123);
    expect(m.price).toBe(25);
    expect(m.status).toBe('ONLINE');
    expect(m.view_count).toBe(10);
    expect(m.favourite_count).toBe(3);
    expect(m.brand).toBe('Levis');
    expect(m.vinted_created_at).toBeInstanceOf(Date);
  });

  it('mappe un article réservé', () => {
    expect(mapMemberItem({ id: 1, price: { amount: '5' }, is_reserved: true }).status).toBe('RESERVED');
  });

  it('mappe un article vendu', () => {
    expect(mapMemberItem({ id: 1, price: { amount: '5' }, is_closed: true }).status).toBe('SOLD');
  });
});

describe('mapSale', () => {
  it('mappe une vente', () => {
    const raw = {
      id: 555, buyer: { login: 'acheteur1' }, price: { amount: '30.00' },
      status: 'shipped', item_id: 123, updated_at: '2026-01-02T10:00:00Z',
    };
    const s = mapSale(raw);
    expect(s.vinted_order_id).toBe(555);
    expect(s.buyer_name).toBe('acheteur1');
    expect(s.sale_price).toBe(30);
    expect(s.shipping_status).toBe('shipped');
    expect(s.vinted_item_id).toBe(123);
    expect(s.sold_at).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `cd backend && npm run test -- --testPathPattern=vinted-seller.client`
Expected: FAIL (module introuvable).

- [ ] **Step 3 : Écrire le client + mappers**

```typescript
// backend/src/inventory/vinted-seller.client.ts
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { Cookie, CookieJar } from 'tough-cookie';
import { Logger } from '@nestjs/common';

const BASE = 'https://www.vinted.fr';

export type SellerStatus = 'ONLINE' | 'RESERVED' | 'SOLD' | 'DELETED';

export interface SellerItem {
  vinted_id: number;
  title: string;
  price: number;
  url: string;
  photo_url: string;
  brand: string;
  size_label: string;
  condition_label: string;
  status: SellerStatus;
  view_count: number;
  favourite_count: number;
  vinted_created_at: Date | null;
}

export interface SaleRecord {
  vinted_order_id: number;
  buyer_name: string;
  sale_price: number;
  shipping_status: string;
  sold_at: Date | null;
  vinted_item_id: number | null;
}

/** Helper pur : article Vinted brut → SellerItem. */
export function mapMemberItem(raw: any): SellerItem {
  let status: SellerStatus = 'ONLINE';
  if (raw.is_closed) status = 'SOLD';
  else if (raw.is_reserved) status = 'RESERVED';
  return {
    vinted_id: Number(raw.id),
    title: raw.title ?? '',
    price: parseFloat(raw.price?.amount ?? raw.price ?? '0') || 0,
    url: raw.url ?? `${BASE}/items/${raw.id}`,
    photo_url: raw.photo?.url ?? raw.photos?.[0]?.url ?? '',
    brand: raw.brand_title ?? '',
    size_label: raw.size_title ?? '',
    condition_label: raw.status ?? '',
    status,
    view_count: Number(raw.view_count ?? 0) || 0,
    favourite_count: Number(raw.favourite_count ?? 0) || 0,
    vinted_created_at: raw.created_at_ts != null ? new Date(Number(raw.created_at_ts) * 1000) : null,
  };
}

/** Helper pur : commande Vinted brute → SaleRecord. */
export function mapSale(raw: any): SaleRecord {
  return {
    vinted_order_id: Number(raw.id),
    buyer_name: raw.buyer?.login ?? raw.user?.login ?? '',
    sale_price: parseFloat(raw.price?.amount ?? raw.price ?? '0') || 0,
    shipping_status: raw.status ?? '',
    vinted_item_id: raw.item_id != null ? Number(raw.item_id) : null,
    sold_at: raw.updated_at ? new Date(raw.updated_at) : raw.created_at ? new Date(raw.created_at) : null,
  };
}

export class VintedSellerClient {
  private readonly logger = new Logger(VintedSellerClient.name);
  private readonly jar = new CookieJar();
  private readonly client = wrapper(
    axios.create({
      jar: this.jar,
      withCredentials: true,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
    } as any),
  );

  constructor(sessionJson: string) {
    this.seedJar(sessionJson);
  }

  /** Réinjecte les cookies du storageState dans le jar tough-cookie. */
  private seedJar(sessionJson: string): void {
    const state = JSON.parse(sessionJson);
    for (const c of state.cookies ?? []) {
      const cookie = new Cookie({
        key: c.name,
        value: c.value,
        domain: (c.domain ?? '.vinted.fr').replace(/^\./, ''),
        path: c.path ?? '/',
        secure: c.secure ?? true,
        httpOnly: c.httpOnly ?? false,
      });
      try {
        this.jar.setCookieSync(cookie.toString(), BASE);
      } catch {
        /* cookie hors-domaine ignoré */
      }
    }
  }

  /** Exporte l'état courant du jar au format storageState JSON (cookies à jour). */
  private exportSessionJson(): string {
    const cookies = this.jar.getCookiesSync(BASE).map((c) => ({
      name: c.key, value: c.value, domain: c.domain ? `.${c.domain}` : '.vinted.fr',
      path: c.path ?? '/', secure: true, httpOnly: !!c.httpOnly,
    }));
    return JSON.stringify({ cookies, origins: [] });
  }

  private throwIfUnauthorized(status?: number): void {
    if (status === 401 || status === 403) {
      throw new Error('SESSION_EXPIRED');
    }
  }

  async getMemberItems(userId: number, page = 1): Promise<SellerItem[]> {
    try {
      const resp = await this.client.get(`${BASE}/api/v2/users/${userId}/items`, {
        params: { per_page: 96, page },
        headers: { Referer: `${BASE}/member/${userId}` },
        timeout: 20000,
      });
      const items: any[] = resp.data?.items ?? [];
      return items.map(mapMemberItem);
    } catch (err: any) {
      this.throwIfUnauthorized(err.response?.status);
      this.logger.warn(`getMemberItems échec: ${err.message}`);
      return [];
    }
  }

  async getSales(): Promise<SaleRecord[]> {
    try {
      const resp = await this.client.get(`${BASE}/api/v2/my_orders`, {
        params: { type: 'sold', page: 1, per_page: 50 },
        headers: { Referer: `${BASE}/member/items/sold` },
        timeout: 20000,
      });
      const orders: any[] = resp.data?.my_orders ?? resp.data?.orders ?? [];
      return orders.map(mapSale);
    } catch (err: any) {
      this.throwIfUnauthorized(err.response?.status);
      this.logger.warn(`getSales échec: ${err.message}`);
      return [];
    }
  }

  /** Keep-alive : touche le site, renvoie le storageState à jour (cookies rotés). */
  async keepAlive(): Promise<string> {
    try {
      await this.client.get(`${BASE}/api/v2/users/current`, { timeout: 15000 });
      return this.exportSessionJson();
    } catch (err: any) {
      this.throwIfUnauthorized(err.response?.status);
      throw err;
    }
  }
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `cd backend && npm run test -- --testPathPattern=vinted-seller.client`
Expected: PASS (5 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/inventory/vinted-seller.client.ts backend/src/inventory/vinted-seller.client.spec.ts
git commit -m "feat(inventory): client HTTP authentifié Vinted (articles, ventes, keep-alive)"
```

---

## Phase 4 — Inventaire : entités, service, synchro

### Task 10 : Entités `Product`, `SellerListing`, `Sale` + module `inventory`

**Files:**
- Create: `backend/src/inventory/product.entity.ts`
- Create: `backend/src/inventory/seller-listing.entity.ts`
- Create: `backend/src/inventory/sale.entity.ts`
- Create: `backend/src/inventory/inventory.module.ts`
- Modify: `backend/src/app.module.ts` (entités + module)

**Interfaces:**
- Produces: entités mappant les tables de Task 1. `InventoryModule` importe `AccountsModule` (pour `AccountsService`) et expose `InventoryService` (Task 11).

- [ ] **Step 1 : Écrire `product.entity.ts`**

```typescript
// backend/src/inventory/product.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'int' }) account_id: number;
  @Column({ type: 'varchar', length: 500, nullable: true }) title: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) brand: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) size_label: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) category: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) condition_label: string | null;
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true }) purchase_price: number | null;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
```

- [ ] **Step 2 : Écrire `seller-listing.entity.ts`**

```typescript
// backend/src/inventory/seller-listing.entity.ts
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { SellerStatus } from './vinted-seller.client';

@Entity('seller_listings')
export class SellerListing {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'int', nullable: true }) product_id: number | null;
  @Column({ type: 'int' }) account_id: number;
  @Column({ type: 'bigint', transformer: { to: (v) => v, from: (v) => (v == null ? null : Number(v)) } }) vinted_id: number;
  @Column({ type: 'text', nullable: true }) url: string | null;
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true }) price: number | null;
  @Column({ type: 'varchar', length: 20, default: 'ONLINE' }) status: SellerStatus;
  @Column({ type: 'int', nullable: true }) view_count: number | null;
  @Column({ type: 'int', nullable: true }) favourite_count: number | null;
  @Column({ type: 'text', nullable: true }) photo_url: string | null;
  @Column({ type: 'timestamptz', nullable: true }) vinted_created_at: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) last_synced_at: Date | null;
}
```

- [ ] **Step 3 : Écrire `sale.entity.ts`**

```typescript
// backend/src/inventory/sale.entity.ts
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('sales')
export class Sale {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'int' }) account_id: number;
  @Column({ type: 'int', nullable: true }) seller_listing_id: number | null;
  @Column({ type: 'bigint', nullable: true, transformer: { to: (v) => v, from: (v) => (v == null ? null : Number(v)) } }) vinted_order_id: number | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) buyer_name: string | null;
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true }) sale_price: number | null;
  @Column({ type: 'varchar', length: 50, nullable: true }) shipping_status: string | null;
  @Column({ type: 'timestamptz', nullable: true }) sold_at: Date | null;
}
```

- [ ] **Step 4 : Écrire le module**

```typescript
// backend/src/inventory/inventory.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './product.entity';
import { SellerListing } from './seller-listing.entity';
import { Sale } from './sale.entity';
import { AccountsModule } from '../accounts/accounts.module';

@Module({
  imports: [TypeOrmModule.forFeature([Product, SellerListing, Sale]), AccountsModule],
  providers: [],
  controllers: [],
  exports: [],
})
export class InventoryModule {}
```

- [ ] **Step 5 : Enregistrer dans `app.module.ts`**

Importer `Product`, `SellerListing`, `Sale` et `InventoryModule` ; ajouter les 3 entités au tableau `entities`, et `InventoryModule` aux `imports`.

- [ ] **Step 6 : Vérifier la compilation**

Run: `cd backend && npm run build`
Expected: build OK.

- [ ] **Step 7 : Commit**

```bash
git add backend/src/inventory/product.entity.ts backend/src/inventory/seller-listing.entity.ts backend/src/inventory/sale.entity.ts backend/src/inventory/inventory.module.ts backend/src/app.module.ts
git commit -m "feat(inventory): entités Product/SellerListing/Sale + module"
```

---

### Task 11 : `InventoryService` — upsert, lien produit, marge, lecture filtrée

**Files:**
- Create: `backend/src/inventory/inventory.service.ts`
- Test: `backend/src/inventory/inventory.service.spec.ts`
- Modify: `backend/src/inventory/inventory.module.ts` (provider)

**Interfaces:**
- Consumes: repos `Product`, `SellerListing`, `Sale`, types `SellerItem`/`SaleRecord` (Task 9).
- Produces:
  - `computeMargin(salePrice: number | null, purchasePrice: number | null): number | null` — `salePrice - purchasePrice`, ou `null` si une donnée manque. (helper pur exporté)
  - `async upsertListing(accountId: number, item: SellerItem): Promise<SellerListing>` — upsert sur `vinted_id` ; si aucune ligne, crée un `Product` auto (titre/marque/taille/catégorie hérités) et lie `product_id` ; met à jour prix/stats/statut/`last_synced_at`.
  - `async upsertSale(accountId: number, rec: SaleRecord): Promise<Sale>` — upsert sur `vinted_order_id` ; lie `seller_listing_id` si l'item correspond à un `seller_listings.vinted_id`.
  - `async listInventory(filters: InventoryFilters): Promise<InventoryRow[]>` — jointure listing+product, filtres `brand|size|category|priceMin|priceMax`, calcule `margin`.
  - `async listSales(): Promise<Sale[]>`
  - `async setPurchasePrice(productId: number, price: number | null): Promise<void>`
  - Types : `InventoryFilters = { brand?: string; size?: string; category?: string; priceMin?: number; priceMax?: number }`, `InventoryRow = SellerListing & { brand: string|null; size_label: string|null; category: string|null; purchase_price: number|null; margin: number|null }`.

- [ ] **Step 1 : Écrire les tests (échouent)**

```typescript
// backend/src/inventory/inventory.service.spec.ts
import { computeMargin } from './inventory.service';

describe('computeMargin', () => {
  it('renvoie la marge quand les deux prix existent', () => {
    expect(computeMargin(30, 10)).toBe(20);
  });
  it('renvoie null si prix d achat manquant', () => {
    expect(computeMargin(30, null)).toBeNull();
  });
  it('renvoie null si prix de vente manquant', () => {
    expect(computeMargin(null, 10)).toBeNull();
  });
  it('gère les décimales', () => {
    expect(computeMargin(25.5, 5.25)).toBeCloseTo(20.25, 2);
  });
});
```

> Les méthodes d'upsert sont couvertes par le test d'intégration manuel de Task 13 (elles dépendent du QueryBuilder TypeORM, peu utile à mocker finement ici). Le helper pur `computeMargin` est le point critique testé en unitaire.

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd backend && npm run test -- --testPathPattern=inventory.service`
Expected: FAIL (module introuvable).

- [ ] **Step 3 : Écrire le service**

```typescript
// backend/src/inventory/inventory.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './product.entity';
import { SellerListing } from './seller-listing.entity';
import { Sale } from './sale.entity';
import { SellerItem, SaleRecord } from './vinted-seller.client';

export interface InventoryFilters {
  brand?: string; size?: string; category?: string; priceMin?: number; priceMax?: number;
}
export type InventoryRow = SellerListing & {
  brand: string | null; size_label: string | null; category: string | null;
  purchase_price: number | null; margin: number | null;
};

/** Helper pur : marge = prix de vente - prix d'achat, ou null si incomplet. */
export function computeMargin(salePrice: number | null, purchasePrice: number | null): number | null {
  if (salePrice == null || purchasePrice == null) return null;
  return Number((salePrice - purchasePrice).toFixed(2));
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(SellerListing) private readonly listings: Repository<SellerListing>,
    @InjectRepository(Sale) private readonly sales: Repository<Sale>,
  ) {}

  async upsertListing(accountId: number, item: SellerItem): Promise<SellerListing> {
    let row = await this.listings.findOne({ where: { vinted_id: item.vinted_id } });
    if (!row) {
      const product = await this.products.save(
        this.products.create({
          account_id: accountId, title: item.title, brand: item.brand,
          size_label: item.size_label, condition_label: item.condition_label,
        }),
      );
      row = this.listings.create({ account_id: accountId, vinted_id: item.vinted_id, product_id: product.id });
    }
    row.url = item.url;
    row.price = item.price;
    row.status = item.status;
    row.view_count = item.view_count;
    row.favourite_count = item.favourite_count;
    row.photo_url = item.photo_url;
    row.vinted_created_at = item.vinted_created_at;
    row.last_synced_at = new Date();
    return this.listings.save(row);
  }

  async upsertSale(accountId: number, rec: SaleRecord): Promise<Sale> {
    let row = rec.vinted_order_id != null
      ? await this.sales.findOne({ where: { vinted_order_id: rec.vinted_order_id } })
      : null;
    if (!row) row = this.sales.create({ account_id: accountId, vinted_order_id: rec.vinted_order_id });
    row.buyer_name = rec.buyer_name;
    row.sale_price = rec.sale_price;
    row.shipping_status = rec.shipping_status;
    row.sold_at = rec.sold_at;
    if (rec.vinted_item_id != null) {
      const listing = await this.listings.findOne({ where: { vinted_id: rec.vinted_item_id } });
      if (listing) row.seller_listing_id = listing.id;
    }
    return this.sales.save(row);
  }

  async listInventory(filters: InventoryFilters): Promise<InventoryRow[]> {
    const qb = this.listings.createQueryBuilder('l')
      .leftJoin(Product, 'p', 'p.id = l.product_id')
      .select('l.*')
      .addSelect('p.brand', 'brand')
      .addSelect('p.size_label', 'size_label')
      .addSelect('p.category', 'category')
      .addSelect('p.purchase_price', 'purchase_price')
      .orderBy('l.last_synced_at', 'DESC');

    if (filters.brand) qb.andWhere('p.brand ILIKE :brand', { brand: `%${filters.brand}%` });
    if (filters.size) qb.andWhere('p.size_label ILIKE :size', { size: `%${filters.size}%` });
    if (filters.category) qb.andWhere('p.category ILIKE :cat', { cat: `%${filters.category}%` });
    if (filters.priceMin != null) qb.andWhere('l.price >= :pmin', { pmin: filters.priceMin });
    if (filters.priceMax != null) qb.andWhere('l.price <= :pmax', { pmax: filters.priceMax });

    const rows = await qb.getRawMany();
    return rows.map((r) => ({
      ...r,
      price: r.price != null ? Number(r.price) : null,
      purchase_price: r.purchase_price != null ? Number(r.purchase_price) : null,
      margin: computeMargin(r.price != null ? Number(r.price) : null, r.purchase_price != null ? Number(r.purchase_price) : null),
    })) as InventoryRow[];
  }

  listSales(): Promise<Sale[]> {
    return this.sales.find({ order: { sold_at: 'DESC' } });
  }

  async setPurchasePrice(productId: number, price: number | null): Promise<void> {
    await this.products.update(productId, { purchase_price: price, updated_at: new Date() });
  }
}
```

- [ ] **Step 4 : Déclarer le provider**

Dans `inventory.module.ts` : ajouter `InventoryService` à `providers` et `exports`.

- [ ] **Step 5 : Lancer le test pour vérifier qu'il passe**

Run: `cd backend && npm run test -- --testPathPattern=inventory.service`
Expected: PASS (4 tests).

- [ ] **Step 6 : Commit**

```bash
git add backend/src/inventory/inventory.service.ts backend/src/inventory/inventory.service.spec.ts backend/src/inventory/inventory.module.ts
git commit -m "feat(inventory): InventoryService (upsert, marge, lecture filtrée)"
```

---

### Task 12 : `InventorySyncService` — synchro planifiée + refresh de session

**Files:**
- Create: `backend/src/inventory/inventory-sync.service.ts`
- Test: `backend/src/inventory/inventory-sync.service.spec.ts`
- Modify: `backend/src/inventory/inventory.module.ts` (provider + `ScheduleModule.forRoot()` si pas déjà global)
- Modify: `backend/src/app.module.ts` (ajouter `ScheduleModule.forRoot()` aux imports s'il n'y est pas)

**Interfaces:**
- Consumes: `AccountsService` (session déchiffrée, statut, `touchRefreshed`), `InventoryService` (upserts), `VintedSellerClient`.
- Produces:
  - `async syncNow(): Promise<{ items: number; sales: number } | { skipped: string }>` — si pas de compte connecté → `{ skipped }`. Sinon : keep-alive (persiste cookies rotés), récupère articles + ventes, upserts. Sur `SESSION_EXPIRED` → `AccountsService.setStatus('expired')` et `{ skipped: 'expired' }`.
  - `@Cron` planifié (toutes les 10 min) qui appelle `syncNow()` avec un jitter.

- [ ] **Step 1 : Écrire le test (échoue)**

```typescript
// backend/src/inventory/inventory-sync.service.spec.ts
import { InventorySyncService } from './inventory-sync.service';

describe('InventorySyncService.syncNow', () => {
  function deps(over: any = {}) {
    return {
      accounts: {
        getAccount: jest.fn(async () => over.account ?? null),
        getDecryptedSession: jest.fn(async () => over.session ?? null),
        setStatus: jest.fn(async () => {}),
        touchRefreshed: jest.fn(async () => {}),
      },
      inventory: {
        upsertListing: jest.fn(async () => ({})),
        upsertSale: jest.fn(async () => ({})),
      },
    };
  }

  it('skip si aucun compte connecté', async () => {
    const d = deps();
    const svc = new InventorySyncService(d.accounts as any, d.inventory as any);
    const res = await svc.syncNow();
    expect(res).toEqual({ skipped: 'no-account' });
  });

  it('marque expired si la session est invalide', async () => {
    const d = deps({ account: { id: 1, status: 'connected', vinted_user_id: 7 }, session: '{"cookies":[]}' });
    const svc = new InventorySyncService(d.accounts as any, d.inventory as any);
    // Force le client à lever SESSION_EXPIRED
    (svc as any).makeClient = () => ({
      keepAlive: async () => { throw new Error('SESSION_EXPIRED'); },
    });
    const res = await svc.syncNow();
    expect(d.accounts.setStatus).toHaveBeenCalledWith('expired');
    expect(res).toEqual({ skipped: 'expired' });
  });

  it('synchronise articles et ventes', async () => {
    const d = deps({ account: { id: 1, status: 'connected', vinted_user_id: 7 }, session: '{"cookies":[]}' });
    const svc = new InventorySyncService(d.accounts as any, d.inventory as any);
    (svc as any).makeClient = () => ({
      keepAlive: async () => '{"cookies":[1]}',
      getMemberItems: async () => [{ vinted_id: 1 }, { vinted_id: 2 }],
      getSales: async () => [{ vinted_order_id: 9 }],
    });
    const res = await svc.syncNow();
    expect(res).toEqual({ items: 2, sales: 1 });
    expect(d.accounts.touchRefreshed).toHaveBeenCalledWith('{"cookies":[1]}');
    expect(d.inventory.upsertListing).toHaveBeenCalledTimes(2);
    expect(d.inventory.upsertSale).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd backend && npm run test -- --testPathPattern=inventory-sync`
Expected: FAIL (module introuvable).

- [ ] **Step 3 : Écrire le service**

```typescript
// backend/src/inventory/inventory-sync.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AccountsService } from '../accounts/accounts.service';
import { InventoryService } from './inventory.service';
import { VintedSellerClient } from './vinted-seller.client';

@Injectable()
export class InventorySyncService {
  private readonly logger = new Logger(InventorySyncService.name);
  private running = false;

  constructor(
    private readonly accounts: AccountsService,
    private readonly inventory: InventoryService,
  ) {}

  /** Fabrique le client (overridable en test). */
  protected makeClient(sessionJson: string): VintedSellerClient {
    return new VintedSellerClient(sessionJson);
  }

  async syncNow(): Promise<{ items: number; sales: number } | { skipped: string }> {
    const acc = await this.accounts.getAccount();
    if (!acc || acc.status !== 'connected' || !acc.vinted_user_id) {
      return { skipped: 'no-account' };
    }
    const session = await this.accounts.getDecryptedSession();
    if (!session) return { skipped: 'no-account' };

    const client = this.makeClient(session);
    try {
      const fresh = await client.keepAlive();
      await this.accounts.touchRefreshed(fresh);

      const items = await client.getMemberItems(acc.vinted_user_id);
      for (const it of items) await this.inventory.upsertListing(acc.id, it);

      const sales = await client.getSales();
      for (const s of sales) await this.inventory.upsertSale(acc.id, s);

      this.logger.log(`Synchro stock : ${items.length} articles, ${sales.length} ventes`);
      return { items: items.length, sales: sales.length };
    } catch (err: any) {
      if (err.message === 'SESSION_EXPIRED') {
        await this.accounts.setStatus('expired');
        this.logger.warn('Session Vinted expirée — reconnexion requise');
        return { skipped: 'expired' };
      }
      this.logger.error(`Synchro stock échouée: ${err.message}`);
      return { skipped: 'error' };
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async scheduled(): Promise<void> {
    if (this.running) return;
    this.running = true;
    // jitter 0-20s pour ne pas taper Vinted à un horaire trop régulier
    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 20000)));
    try {
      await this.syncNow();
    } finally {
      this.running = false;
    }
  }
}
```

- [ ] **Step 4 : Câbler le planificateur**

- Dans `app.module.ts` : si `ScheduleModule` n'est pas déjà importé, ajouter `import { ScheduleModule } from '@nestjs/schedule';` et `ScheduleModule.forRoot()` dans `imports`. (Vérifier d'abord : `grep -r ScheduleModule backend/src` — le scraper utilise peut-être déjà un tick maison plutôt que `@nestjs/schedule`. Si absent, l'ajouter.)
- Dans `inventory.module.ts` : ajouter `InventorySyncService` à `providers` et `exports`.

- [ ] **Step 5 : Lancer le test pour vérifier qu'il passe**

Run: `cd backend && npm run test -- --testPathPattern=inventory-sync`
Expected: PASS (3 tests).

- [ ] **Step 6 : Commit**

```bash
git add backend/src/inventory/inventory-sync.service.ts backend/src/inventory/inventory-sync.service.spec.ts backend/src/inventory/inventory.module.ts backend/src/app.module.ts
git commit -m "feat(inventory): synchro planifiée + refresh de session (InventorySyncService)"
```

---

### Task 13 : `InventoryController` — endpoints stock, ventes, prix d'achat, refresh

**Files:**
- Create: `backend/src/inventory/inventory.controller.ts`
- Create: `backend/src/inventory/dto/set-purchase-price.dto.ts`
- Modify: `backend/src/inventory/inventory.module.ts` (controller)

**Interfaces:**
- Consumes: `InventoryService`, `InventorySyncService`.
- Produces (routes, préfixe `/api`) :
  - `GET /inventory?brand=&size=&category=&price_min=&price_max=` → `InventoryRow[]`
  - `GET /inventory/sales` → `Sale[]`
  - `PATCH /inventory/products/:id/purchase-price` body `{ purchase_price: number | null }` → `204`
  - `POST /inventory/sync` → `{ items, sales } | { skipped }` (refresh manuel)

- [ ] **Step 1 : Écrire le DTO**

```typescript
// backend/src/inventory/dto/set-purchase-price.dto.ts
import { IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SetPurchasePriceDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  purchase_price: number | null;
}
```

- [ ] **Step 2 : Écrire le controller**

```typescript
// backend/src/inventory/inventory.controller.ts
import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, HttpCode, ValidationPipe } from '@nestjs/common';
import { InventoryService, InventoryFilters } from './inventory.service';
import { InventorySyncService } from './inventory-sync.service';
import { SetPurchasePriceDto } from './dto/set-purchase-price.dto';

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly sync: InventorySyncService,
  ) {}

  @Get()
  list(
    @Query('brand') brand?: string,
    @Query('size') size?: string,
    @Query('category') category?: string,
    @Query('price_min') priceMin?: string,
    @Query('price_max') priceMax?: string,
  ) {
    const filters: InventoryFilters = {
      brand: brand || undefined,
      size: size || undefined,
      category: category || undefined,
      priceMin: priceMin ? Number(priceMin) : undefined,
      priceMax: priceMax ? Number(priceMax) : undefined,
    };
    return this.inventory.listInventory(filters);
  }

  @Get('sales')
  sales() {
    return this.inventory.listSales();
  }

  @Patch('products/:id/purchase-price')
  @HttpCode(204)
  async setPurchasePrice(
    @Param('id', ParseIntPipe) id: number,
    @Body(ValidationPipe) dto: SetPurchasePriceDto,
  ) {
    await this.inventory.setPurchasePrice(id, dto.purchase_price ?? null);
  }

  @Post('sync')
  syncNow() {
    return this.sync.syncNow();
  }
}
```

- [ ] **Step 3 : Déclarer le controller**

Dans `inventory.module.ts` : ajouter `InventoryController` à `controllers`.

- [ ] **Step 4 : Vérification manuelle d'intégration (avec compte connecté)**

```bash
docker compose up -d --build api
curl -s -X POST http://localhost:3003/api/inventory/sync     # → {"items":N,"sales":M}
curl -s "http://localhost:3003/api/inventory" | head -c 400  # → tableau d'annonces
curl -s "http://localhost:3003/api/inventory/sales" | head -c 400
# Régler un prix d'achat (remplacer 1 par un product_id réel issu de /inventory)
curl -s -X PATCH http://localhost:3003/api/inventory/products/1/purchase-price \
  -H 'Content-Type: application/json' -d '{"purchase_price": 8.5}' -w '%{http_code}'  # → 204
```
Expected: la synchro renvoie des compteurs > 0 (si ton compte a des annonces), l'inventaire et les ventes se peuplent, le PATCH renvoie 204, et un nouvel appel `/inventory` montre `margin` calculée pour la ligne mise à jour.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/inventory/inventory.controller.ts backend/src/inventory/dto/set-purchase-price.dto.ts backend/src/inventory/inventory.module.ts
git commit -m "feat(inventory): endpoints stock, ventes, prix d'achat, sync manuel"
```

---

## Phase 5 — Frontend (Next.js 16, build + vérif manuelle)

> Rappel : pas de runner de test frontend. Vérifications via `npm run build` + dogfooding dans l'app. Avant de toucher au routing/config, consulter `node_modules/next/dist/docs/` (cf. `frontend/AGENTS.md`).

### Task 14 : Couche API frontend (types + endpoints)

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Produces dans `api` :
  - `accounts: { status, connectStart, connectPoll }`
  - `inventory: { list(filters), sales, setPurchasePrice(productId, price), sync }`
  - Types `AccountStatus`, `InventoryRow`, `SaleRow`.

- [ ] **Step 1 : Ajouter les types + endpoints**

Ajouter à `frontend/src/lib/api.ts` (avant la const `api`, les interfaces ; dans l'objet `api`, les sous-objets) :

```typescript
export interface AccountStatusResp {
  connected: boolean;
  status: 'connected' | 'expired' | 'disconnected' | 'none';
  label?: string;
  vinted_user_id?: number;
  connected_at?: string;
}

export interface InventoryRow {
  id: number;
  product_id: number | null;
  vinted_id: number;
  url: string | null;
  price: number | null;
  status: 'ONLINE' | 'RESERVED' | 'SOLD' | 'DELETED';
  view_count: number | null;
  favourite_count: number | null;
  photo_url: string | null;
  vinted_created_at: string | null;
  last_synced_at: string | null;
  brand: string | null;
  size_label: string | null;
  category: string | null;
  purchase_price: number | null;
  margin: number | null;
}

export interface SaleRow {
  id: number;
  account_id: number;
  seller_listing_id: number | null;
  vinted_order_id: number | null;
  buyer_name: string | null;
  sale_price: number | null;
  shipping_status: string | null;
  sold_at: string | null;
}

export interface InventoryFilterParams {
  brand?: string; size?: string; category?: string; priceMin?: number; priceMax?: number;
}

function inventoryQuery(p: InventoryFilterParams): string {
  const qs = new URLSearchParams();
  if (p.brand) qs.set('brand', p.brand);
  if (p.size) qs.set('size', p.size);
  if (p.category) qs.set('category', p.category);
  if (p.priceMin != null) qs.set('price_min', String(p.priceMin));
  if (p.priceMax != null) qs.set('price_max', String(p.priceMax));
  const s = qs.toString();
  return s ? `?${s}` : '';
}
```

Et dans l'objet `api`, ajouter :

```typescript
  accounts: {
    status: () => req<AccountStatusResp>('/accounts/status'),
    connectStart: () => req<{ novncReady: boolean }>('/accounts/connect/start', { method: 'POST' }),
    connectPoll: () => req<{ connected: boolean; vintedUserId?: number }>('/accounts/connect/poll', { method: 'POST' }),
  },
  inventory: {
    list: (filters: InventoryFilterParams = {}) => req<InventoryRow[]>(`/inventory${inventoryQuery(filters)}`),
    sales: () => req<SaleRow[]>('/inventory/sales'),
    setPurchasePrice: (productId: number, price: number | null) =>
      req<void>(`/inventory/products/${productId}/purchase-price`, { method: 'PATCH', body: JSON.stringify({ purchase_price: price }) }),
    sync: () => req<{ items?: number; sales?: number; skipped?: string }>('/inventory/sync', { method: 'POST' }),
  },
```

> Note : `setPurchasePrice` renvoie 204 (pas de corps). Le helper `req` fait `res.json()` qui échouera sur un corps vide. **Correctif** : dans `req`, gérer le 204 — ajouter en tête du `return` : `if (res.status === 204) return undefined as T;`.

- [ ] **Step 2 : Appliquer le correctif 204 dans `req`**

Dans `frontend/src/lib/api.ts`, modifier la fonction `req` pour renvoyer `undefined` sur 204 :

```typescript
async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}
```

- [ ] **Step 3 : Vérifier le build**

Run: `cd frontend && npm run build`
Expected: build OK (compilation TypeScript des nouveaux types).

- [ ] **Step 4 : Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(front): couche API comptes + inventaire"
```

---

### Task 15 : Page Compte + bouton « Connecter Vinted » (modale noVNC)

**Files:**
- Create: `frontend/src/app/compte/page.tsx`
- Create: `frontend/src/components/ConnectVintedModal.tsx`
- Modify: `frontend/src/components/Sidebar.tsx` (lien nav « Compte »)

**Interfaces:**
- Consumes: `api.accounts.*`, `NEXT_PUBLIC_NOVNC_URL`.
- Produces: une page `/compte` montrant le statut + bouton qui ouvre la modale noVNC, lance `connectStart`, affiche le navigateur streamé, puis poll `connectPoll` jusqu'à `connected:true`.

- [ ] **Step 1 : Écrire la modale noVNC**

```tsx
// frontend/src/components/ConnectVintedModal.tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../lib/api';

const NOVNC_URL = process.env.NEXT_PUBLIC_NOVNC_URL ?? '';

export function ConnectVintedModal({ onClose, onConnected }: { onClose: () => void; onConnected: () => void }) {
  const [phase, setPhase] = useState<'loading' | 'waiting' | 'connected' | 'error'>('loading');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.accounts.connectStart()
      .then(() => { if (!cancelled) setPhase('waiting'); })
      .catch(() => { if (!cancelled) setPhase('error'); });

    pollRef.current = setInterval(async () => {
      try {
        const r = await api.accounts.connectPoll();
        if (r.connected) {
          if (pollRef.current) clearInterval(pollRef.current);
          setPhase('connected');
          onConnected();
        }
      } catch { /* on continue de poller */ }
    }, 4000);

    return () => { cancelled = true; if (pollRef.current) clearInterval(pollRef.current); };
  }, [onConnected]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-4xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="font-semibold text-zinc-100">Connecter Vinted</h2>
          <button onClick={onClose} aria-label="Fermer" className="text-zinc-400 hover:text-white"><X size={20} /></button>
        </div>
        <div className="p-3">
          <p className="text-sm text-zinc-400 mb-2">
            {phase === 'connected'
              ? '✅ Compte connecté !'
              : 'Connecte-toi à Vinted dans la fenêtre ci-dessous (identifiants + 2FA). La connexion est détectée automatiquement.'}
          </p>
          <div className="aspect-[16/10] w-full bg-black rounded-lg overflow-hidden">
            {NOVNC_URL
              ? <iframe src={NOVNC_URL} className="w-full h-full border-0" title="Navigateur Vinted" />
              : <div className="text-zinc-500 text-sm p-4">NEXT_PUBLIC_NOVNC_URL non configurée.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : Écrire la page Compte**

```tsx
// frontend/src/app/compte/page.tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { Plug, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api, AccountStatusResp } from '../../lib/api';
import { ConnectVintedModal } from '../../components/ConnectVintedModal';

export default function ComptePage() {
  const [status, setStatus] = useState<AccountStatusResp | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => { api.accounts.status().then(setStatus).catch(() => {}); }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const connected = status?.connected;
  const expired = status?.status === 'expired';

  return (
    <div className="p-4 lg:p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-zinc-100 mb-6">Compte Vinted</h1>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {connected ? <CheckCircle2 className="text-emerald-400" /> : expired ? <AlertTriangle className="text-amber-400" /> : <Plug className="text-zinc-500" />}
          <div>
            <p className="text-zinc-100 font-medium">
              {connected ? (status?.label ?? 'Compte connecté') : expired ? 'Session expirée' : 'Aucun compte connecté'}
            </p>
            <p className="text-xs text-zinc-500">
              {connected && status?.connected_at ? `Connecté le ${new Date(status.connected_at).toLocaleString('fr-FR')}` : 'Clique pour lier ton compte Vinted'}
            </p>
          </div>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium"
        >
          {connected ? 'Reconnecter' : 'Connecter Vinted'}
        </button>
      </div>

      {open && (
        <ConnectVintedModal
          onClose={() => { setOpen(false); refresh(); }}
          onConnected={() => { refresh(); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3 : Ajouter le lien nav dans la Sidebar**

Dans `frontend/src/components/Sidebar.tsx` : importer une icône (`Plug`) depuis `lucide-react`, et ajouter au tableau `navLinks` (après `/listings`) :

```tsx
  { href: '/compte', label: 'Compte', icon: Plug },
```

- [ ] **Step 4 : Vérifier le build**

Run: `cd frontend && npm run build`
Expected: build OK.

- [ ] **Step 5 : Vérification manuelle**

`docker compose up -d --build frontend api connect-browser`, ouvrir `http://<ip-vm>:3002/compte` → cliquer « Connecter Vinted » → la modale affiche le navigateur streamé → se connecter → la modale passe à « ✅ Compte connecté » et le statut de la page repasse à connecté.

- [ ] **Step 6 : Commit**

```bash
git add frontend/src/app/compte/page.tsx frontend/src/components/ConnectVintedModal.tsx frontend/src/components/Sidebar.tsx
git commit -m "feat(front): page Compte + bouton Connecter Vinted (noVNC)"
```

---

### Task 16 : Page Inventaire (DataTable + filtres + prix d'achat inline)

**Files:**
- Create: `frontend/src/app/inventaire/page.tsx`
- Modify: `frontend/src/components/Sidebar.tsx` (lien nav « Inventaire »)

**Interfaces:**
- Consumes: `api.inventory.list`, `api.inventory.setPurchasePrice`, `api.inventory.sync`.
- Produces: tableau filtrable du stock avec édition inline du prix d'achat et bouton « Rafraîchir » (sync manuel).

- [ ] **Step 1 : Écrire la page**

```tsx
// frontend/src/app/inventaire/page.tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, InventoryRow } from '../../lib/api';

const STATUS_LABEL: Record<string, string> = { ONLINE: 'En ligne', RESERVED: 'Réservé', SOLD: 'Vendu', DELETED: 'Supprimé' };

export default function InventairePage() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [brand, setBrand] = useState('');
  const [size, setSize] = useState('');
  const [category, setCategory] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    api.inventory.list({
      brand: brand || undefined,
      size: size || undefined,
      category: category || undefined,
      priceMin: priceMin ? Number(priceMin) : undefined,
      priceMax: priceMax ? Number(priceMax) : undefined,
    }).then(setRows).catch(() => {});
  }, [brand, size, category, priceMin, priceMax]);
  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setLoading(true);
    try { await api.inventory.sync(); load(); } finally { setLoading(false); }
  };

  const savePurchase = async (row: InventoryRow, value: string) => {
    if (row.product_id == null) return;
    const price = value === '' ? null : Number(value);
    await api.inventory.setPurchasePrice(row.product_id, price);
    load();
  };

  return (
    <div className="p-4 lg:p-8">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-zinc-100">Inventaire</h1>
        <button onClick={sync} disabled={loading}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium flex items-center gap-2">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Rafraîchir
        </button>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Marque"
          className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-100" />
        <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="Taille"
          className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-100" />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Catégorie"
          className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-100" />
        <input value={priceMin} onChange={(e) => setPriceMin(e.target.value)} placeholder="Prix min" type="number"
          className="w-24 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-100" />
        <input value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder="Prix max" type="number"
          className="w-24 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-100" />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              <th className="text-left p-3">Article</th>
              <th className="text-left p-3">Marque</th>
              <th className="text-left p-3">Taille</th>
              <th className="text-right p-3">Prix</th>
              <th className="text-right p-3">Vues</th>
              <th className="text-right p-3">Favoris</th>
              <th className="text-right p-3">Prix d'achat</th>
              <th className="text-right p-3">Marge</th>
              <th className="text-left p-3">Statut</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-800/60 text-zinc-200">
                <td className="p-3 max-w-[260px] truncate">
                  {r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="hover:text-indigo-400">{r.vinted_id}</a> : r.vinted_id}
                </td>
                <td className="p-3">{r.brand ?? '—'}</td>
                <td className="p-3">{r.size_label ?? '—'}</td>
                <td className="p-3 text-right">{r.price != null ? `${r.price} €` : '—'}</td>
                <td className="p-3 text-right">{r.view_count ?? 0}</td>
                <td className="p-3 text-right">{r.favourite_count ?? 0}</td>
                <td className="p-3 text-right">
                  <input
                    type="number" step="0.01" defaultValue={r.purchase_price ?? ''}
                    onBlur={(e) => savePurchase(r, e.target.value)}
                    className="w-20 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-right text-zinc-100"
                  />
                </td>
                <td className={`p-3 text-right ${r.margin != null && r.margin >= 0 ? 'text-emerald-400' : r.margin != null ? 'text-red-400' : 'text-zinc-500'}`}>
                  {r.margin != null ? `${r.margin} €` : '—'}
                </td>
                <td className="p-3">{STATUS_LABEL[r.status] ?? r.status}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="p-8 text-center text-zinc-500">Aucun article. Connecte ton compte puis clique « Rafraîchir ».</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : Ajouter le lien nav**

Dans `Sidebar.tsx` : importer `Package` (lucide-react) et ajouter à `navLinks` :

```tsx
  { href: '/inventaire', label: 'Inventaire', icon: Package },
```

- [ ] **Step 3 : Vérifier le build**

Run: `cd frontend && npm run build`
Expected: build OK.

- [ ] **Step 4 : Vérification manuelle**

Ouvrir `/inventaire` → « Rafraîchir » → les annonces apparaissent → saisir un prix d'achat dans une ligne, sortir du champ (blur) → la marge se met à jour après rechargement. Filtrer par marque/taille → la liste se réduit.

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/app/inventaire/page.tsx frontend/src/components/Sidebar.tsx
git commit -m "feat(front): page Inventaire (table, filtres, prix d'achat inline, sync)"
```

---

### Task 17 : Page Ventes

**Files:**
- Create: `frontend/src/app/ventes/page.tsx`
- Modify: `frontend/src/components/Sidebar.tsx` (lien nav « Ventes »)

**Interfaces:**
- Consumes: `api.inventory.sales`.
- Produces: tableau des ventes (acheteur, prix, statut d'expédition, date).

- [ ] **Step 1 : Écrire la page**

```tsx
// frontend/src/app/ventes/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { api, SaleRow } from '../../lib/api';

export default function VentesPage() {
  const [rows, setRows] = useState<SaleRow[]>([]);
  useEffect(() => { api.inventory.sales().then(setRows).catch(() => {}); }, []);

  return (
    <div className="p-4 lg:p-8">
      <h1 className="text-2xl font-bold text-zinc-100 mb-6">Ventes</h1>
      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              <th className="text-left p-3">Acheteur</th>
              <th className="text-right p-3">Prix de vente</th>
              <th className="text-left p-3">Expédition</th>
              <th className="text-left p-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-zinc-800/60 text-zinc-200">
                <td className="p-3">{s.buyer_name ?? '—'}</td>
                <td className="p-3 text-right">{s.sale_price != null ? `${s.sale_price} €` : '—'}</td>
                <td className="p-3">{s.shipping_status ?? '—'}</td>
                <td className="p-3">{s.sold_at ? new Date(s.sold_at).toLocaleDateString('fr-FR') : '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="p-8 text-center text-zinc-500">Aucune vente synchronisée.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : Ajouter le lien nav**

Dans `Sidebar.tsx` : importer `Receipt` (lucide-react) et ajouter à `navLinks` :

```tsx
  { href: '/ventes', label: 'Ventes', icon: Receipt },
```

- [ ] **Step 3 : Vérifier le build**

Run: `cd frontend && npm run build`
Expected: build OK.

- [ ] **Step 4 : Vérification manuelle**

Ouvrir `/ventes` → les ventes synchronisées s'affichent (après un `POST /inventory/sync` ayant remonté des ventes).

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/app/ventes/page.tsx frontend/src/components/Sidebar.tsx
git commit -m "feat(front): page Ventes"
```

---

## Phase 6 — Documentation

### Task 18 : Mettre à jour CLAUDE.md & .env.example

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.env.example`

- [ ] **Step 1 : Documenter les nouveaux modules dans CLAUDE.md**

Dans le tableau « Backend NestJS modules », ajouter :

```
| `accounts` | Compte Vinted connecté : session chiffrée, statut, refresh, flux de connexion noVNC (via le sidecar connect-browser) |
| `inventory` | Stock vendeur : synchro HTTP authentifiée (articles + ventes), produits/annonces/ventes, calcul de marge |
```

Et ajouter une note sous « Project Structure » :

```
connect-browser/  Sidecar Docker (Chromium + Xvfb + x11vnc + noVNC) — navigateur streamé pour la connexion au compte Vinted
```

Et dans « Environment Variables », ajouter `SESSION_ENCRYPTION_KEY`, `CDP_URL`, `NEXT_PUBLIC_NOVNC_URL`.

- [ ] **Step 2 : Vérifier que `.env.example` contient bien `SESSION_ENCRYPTION_KEY`** (ajouté en Task 6). Ajouter un commentaire pour `NEXT_PUBLIC_NOVNC_URL` si pertinent.

- [ ] **Step 3 : Commit**

```bash
git add CLAUDE.md .env.example
git commit -m "docs: modules accounts/inventory + sidecar connect-browser + nouvelles env vars"
```

---

## Récapitulatif des tâches

| # | Tâche | Type |
|---|---|---|
| 1 | Schéma SQL tables vendeur | SQL + manuel |
| 2 | Dépendance playwright-core | deps |
| 3 | Chiffrement de session | TDD |
| 4 | Entité VintedAccount + module | build |
| 5 | AccountsService | TDD |
| 6 | Sidecar connect-browser (noVNC) | infra + manuel |
| 7 | VintedConnectService (capture CDP) | TDD partiel + manuel |
| 8 | AccountsController | manuel e2e |
| 9 | VintedSellerClient + mappers | TDD |
| 10 | Entités Product/SellerListing/Sale | build |
| 11 | InventoryService | TDD |
| 12 | InventorySyncService | TDD |
| 13 | InventoryController | manuel e2e |
| 14 | Couche API frontend | build |
| 15 | Page Compte + modale noVNC | build + manuel |
| 16 | Page Inventaire | build + manuel |
| 17 | Page Ventes | build + manuel |
| 18 | Documentation | docs |

## Points à confirmer au 1er run réel (mapping isolé & testé, donc ajustable sans risque)

- Forme exacte des réponses `GET /api/v2/users/{id}/items` et `GET /api/v2/my_orders` (champs `is_closed`/`is_reserved`, `my_orders` vs `orders`, `buyer.login`). Si différent → ajuster `mapMemberItem`/`mapSale` + l'URL dans `VintedSellerClient` uniquement.
- Nom exact des cookies d'auth Vinted (`access_token_web`, `_vinted_fr_session`) → ajuster `AUTH_COOKIES` dans `vinted-connect.service.ts`.
- Comportement du keep-alive vis-à-vis de la rotation du `access_token_web` (Vinted peut exiger un appel à un endpoint de refresh dédié plutôt qu'un simple GET) → ajuster `keepAlive()`.
