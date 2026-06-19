# SP2 — Multi-User Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user profiles to Vinbot so 2-5 manually-created users each have their own keywords, filtered feed, and Telegram alert destination, with no authentication.

**Architecture:** New `users` table + `keywords.user_id` FK column (backfilled from a default "Principal" user seeded from `TELEGRAM_CHAT_ID`). Backend threads an optional `userId`/`user_id` param through `KeywordsService`, `ListingsService`, and `TelegramService`; the scraper loop stays global but routes each Telegram alert through the matched keyword's owner. Frontend adds a `CurrentUserProvider` React context (backed by `localStorage`) that every page reads to scope its API calls, plus a `UserPicker` in the sidebar and a "Utilisateurs" CRUD panel in Réglages.

**Tech Stack:** NestJS + TypeORM (`synchronize: false`, schema lives in `db/init.sql` + ad-hoc files in `db/migrations/`, no migration runner — must be applied manually), PostgreSQL 16, Next.js 16 + React context, Jest for backend tests.

## Global Constraints

- No authentication — the profile selector is purely a UI convenience.
- Telegram bot token stays global (`TELEGRAM_BOT_TOKEN`); only the destination `chat_id` becomes per-user.
- `findActive()` (used by the scraper loop) stays **unfiltered** by user — it must see every active keyword across all users.
- `total_listings` in `/listings/stats` stays a **global** count even when `userId` is provided — it represents total DB size, not a per-user metric.
- `user_id` is propagated as an explicit query param (GET) or body field (POST/PUT) — never an HTTP header.
- Frontend localStorage key for the active profile: `vinbot_active_user_id`.
- Default seeded user is named `Principal` with `telegram_chat_id` = the `TELEGRAM_CHAT_ID` env var at migration time (empty string if unset).
- `db/init.sql` is the source of truth for fresh installs — it must be kept in sync with the migration so a brand-new DB ends up in the same end state.
- No migration runner exists — `007_add_users.sql` must be designed to be applied manually via `psql`, and verified against a disposable Postgres container before being considered done.

---

## File Structure

**Backend — new files:**
- `db/migrations/007_add_users.sql` — creates `users`, adds `keywords.user_id`, backfills, sets `NOT NULL`.
- `backend/src/users/user.entity.ts` — `User` TypeORM entity.
- `backend/src/users/dto/create-user.dto.ts` — validation DTO for create/update.
- `backend/src/users/users.service.ts` — CRUD service.
- `backend/src/users/users.service.spec.ts` — unit tests.
- `backend/src/users/users.controller.ts` — `GET/POST/PUT/DELETE /users`.
- `backend/src/users/users.module.ts` — Nest module wiring.
- `backend/src/keywords/keywords.service.spec.ts` — new tests for `userId` scoping.
- `backend/src/notifications/telegram.service.spec.ts` — new tests for per-user routing.

**Backend — modified files:**
- `db/init.sql` — add `users` table, `keywords.user_id` column + FK, `idx_keywords_user_id` index.
- `backend/src/keywords/keyword.entity.ts` — add `user_id` column + `user` relation.
- `backend/src/keywords/dto/create-keyword.dto.ts` — add required `user_id`.
- `backend/src/keywords/keywords.service.ts` — `findAll(userId?)`, `findActive()` loads `user` relation.
- `backend/src/keywords/keywords.controller.ts` — thread `user_id` query param.
- `backend/src/listings/listings.service.ts` — `getListings`/`getStats` gain `userId` filtering.
- `backend/src/listings/listings.controller.ts` — thread `user_id` query param.
- `backend/src/listings/listings.service.spec.ts` — extend for `userId` filtering.
- `backend/src/notifications/telegram.service.ts` — per-user `chat_id` resolution, `sendTest(chatId)`.
- `backend/src/notifications/telegram.controller.ts` — read `chat_id` from body.
- `backend/src/notifications/deals.gateway.ts` — `ListingEvent.userId` required field.
- `backend/src/scraper/scraper.service.ts` — populate `userId` in `emitNewListing` payload.
- `backend/src/app.module.ts` — register `User` entity + `UsersModule`.

**Frontend — new files:**
- `frontend/src/lib/CurrentUserContext.tsx` — `CurrentUserProvider` + `useCurrentUser()`.
- `frontend/src/components/UserPicker.tsx` — sidebar dropdown.
- `frontend/src/components/UsersPanel.tsx` — Réglages CRUD panel.
- `frontend/src/components/ProfileGate.tsx` — first-run redirect gate.

**Frontend — modified files:**
- `frontend/src/lib/api.ts` — `Keyword.user_id`, `User` interface, `LatestListingsParams.userId`, `api.keywords.list(userId?)`, `api.listings.stats(userId?)`, `api.telegram.test(chatId)`, `api.users` namespace.
- `frontend/src/lib/listingEvent.ts` — add `userId`.
- `frontend/src/app/layout.tsx` — mount `CurrentUserProvider` + `ProfileGate`.
- `frontend/src/components/Sidebar.tsx` — render `UserPicker`.
- `frontend/src/components/KeywordForm.tsx` — auto-attach `user_id`.
- `frontend/src/app/keywords/page.tsx` — scope to `activeUserId`.
- `frontend/src/app/page.tsx` — scope stats to `activeUserId`.
- `frontend/src/app/listings/page.tsx` — scope to `activeUserId`.
- `frontend/src/app/live/page.tsx` — filter WS events by `activeUserId`.
- `frontend/src/app/settings/page.tsx` — render `UsersPanel`, rewrite `testTelegram()`.

---

### Task 1: Database migration — `users` table + `keywords.user_id`

**Files:**
- Create: `db/migrations/007_add_users.sql`
- Modify: `db/init.sql`

**Interfaces:**
- Produces: table `users(id, name, telegram_chat_id, created_at)`; `keywords.user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`; index `idx_keywords_user_id`.

- [ ] **Step 1: Write the migration file**

```sql
-- 007_add_users.sql
-- Comptes multi-utilisateurs (SP2) : table users + appartenance des keywords.
-- Usage : psql -v chat_id="'<valeur de TELEGRAM_CHAT_ID>'" -f 007_add_users.sql vinbot
-- Si -v chat_id n'est pas fourni, le user par défaut est créé avec un chat_id vide.

\if :{?chat_id}
\else
  \set chat_id ''''''
\endif

CREATE TABLE IF NOT EXISTS users (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(100) NOT NULL,
  telegram_chat_id  VARCHAR(50) NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO users (name, telegram_chat_id)
SELECT 'Principal', :chat_id
WHERE NOT EXISTS (SELECT 1 FROM users WHERE name = 'Principal');

ALTER TABLE keywords ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

UPDATE keywords SET user_id = (SELECT id FROM users WHERE name = 'Principal' LIMIT 1)
WHERE user_id IS NULL;

ALTER TABLE keywords ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_keywords_user_id ON keywords(user_id);
```

- [ ] **Step 2: Verify the migration against a disposable Postgres container seeded with the pre-SP2 `db/init.sql`**

Run (from repo root, before editing `db/init.sql`):
```bash
docker run --rm -d --name vinbot-mig-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=vinbot -p 55432:5432 postgres:16
sleep 3
PGPASSWORD=test psql -h localhost -p 55432 -U postgres -d vinbot -f db/init.sql
PGPASSWORD=test psql -h localhost -p 55432 -U postgres -d vinbot -v chat_id="'-100123'" -f db/migrations/007_add_users.sql
PGPASSWORD=test psql -h localhost -p 55432 -U postgres -d vinbot -c "\d keywords" -c "SELECT * FROM users;"
docker stop vinbot-mig-test
```
Expected: `users` table has one row (`Principal`, `-100123`); `\d keywords` shows `user_id` as `integer not null` with a `keywords_user_id_fkey` constraint.

- [ ] **Step 3: Update `db/init.sql` to match the post-migration end state**

In `db/init.sql`, insert this block immediately **before** the `CREATE TABLE keywords` definition:

```sql
CREATE TABLE IF NOT EXISTS users (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(100) NOT NULL,
  telegram_chat_id  VARCHAR(50) NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
```

In the `keywords` table's column list, add (after `id SERIAL PRIMARY KEY,` or wherever the existing column order naturally fits — keep alongside other FK-like columns):

```sql
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
```

Note: a fresh install has no existing keywords, so `NOT NULL` can be set directly here (no backfill needed) — unlike the migration file which must handle existing data.

In the index block at the bottom of `db/init.sql`, add:

```sql
CREATE INDEX IF NOT EXISTS idx_keywords_user_id ON keywords(user_id);
```

- [ ] **Step 4: Verify the updated `db/init.sql` produces an equivalent schema on a fresh install**

Run:
```bash
docker run --rm -d --name vinbot-fresh-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=vinbot -p 55432:5432 postgres:16
sleep 3
PGPASSWORD=test psql -h localhost -p 55432 -U postgres -d vinbot -f db/init.sql
PGPASSWORD=test psql -h localhost -p 55432 -U postgres -d vinbot -c "\d keywords" -c "\d users"
docker stop vinbot-fresh-test
```
Expected: `users` table exists; `keywords.user_id` is `integer not null` with the FK constraint; no errors.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/007_add_users.sql db/init.sql
git commit -m "feat(db): add users table and keywords.user_id for multi-user accounts"
```

---

### Task 2: `User` entity + `UsersModule` (full CRUD)

**Files:**
- Create: `backend/src/users/user.entity.ts`
- Create: `backend/src/users/dto/create-user.dto.ts`
- Create: `backend/src/users/users.service.ts`
- Create: `backend/src/users/users.service.spec.ts`
- Create: `backend/src/users/users.controller.ts`
- Create: `backend/src/users/users.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Produces: `User` entity (`id, name, telegram_chat_id, created_at`); `UsersService.findAll()/findOne(id)/create(dto)/update(id, dto)/remove(id)`; routes `GET/POST/PUT/DELETE /users[/:id]`.

- [ ] **Step 1: Create the entity**

```typescript
// backend/src/users/user.entity.ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string;

  @Column({ name: 'telegram_chat_id', length: 50 })
  telegram_chat_id: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;
}
```

- [ ] **Step 2: Create the DTO**

```typescript
// backend/src/users/dto/create-user.dto.ts
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(50)
  telegram_chat_id: string;
}
```

- [ ] **Step 3: Write the failing test for `UsersService`**

```typescript
// backend/src/users/users.service.spec.ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';

function mockRepo<T>(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOneBy: jest.fn().mockResolvedValue(null),
    create: jest.fn((dto: any) => dto),
    save: jest.fn((entity: any) => Promise.resolve({ id: 1, ...entity })),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    ...overrides,
  };
}

async function buildService(repoOverrides: Partial<Record<string, jest.Mock>> = {}) {
  const repo = mockRepo(repoOverrides);
  const moduleRef = await Test.createTestingModule({
    providers: [UsersService, { provide: getRepositoryToken(User), useValue: repo }],
  }).compile();
  return { service: moduleRef.get(UsersService), repo };
}

describe('UsersService', () => {
  it('findAll returns all users', async () => {
    const users = [{ id: 1, name: 'Principal', telegram_chat_id: '-100', created_at: new Date() }];
    const { service } = await buildService({ find: jest.fn().mockResolvedValue(users) });
    await expect(service.findAll()).resolves.toEqual(users);
  });

  it('create persists a new user', async () => {
    const { service, repo } = await buildService();
    const result = await service.create({ name: 'Alice', telegram_chat_id: '-200' } as any);
    expect(repo.save).toHaveBeenCalled();
    expect(result).toMatchObject({ name: 'Alice', telegram_chat_id: '-200' });
  });

  it('remove deletes a user by id', async () => {
    const { service, repo } = await buildService();
    await service.remove(5);
    expect(repo.delete).toHaveBeenCalledWith(5);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && npm run test -- --testPathPattern=users.service`
Expected: FAIL — `Cannot find module './users.service'`

- [ ] **Step 5: Write the service**

```typescript
// backend/src/users/users.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly userRepo: Repository<User>) {}

  findAll(): Promise<User[]> {
    return this.userRepo.find({ order: { id: 'ASC' } });
  }

  findOne(id: number): Promise<User | null> {
    return this.userRepo.findOneBy({ id });
  }

  create(dto: CreateUserDto): Promise<User> {
    const user = this.userRepo.create(dto);
    return this.userRepo.save(user);
  }

  async update(id: number, dto: CreateUserDto): Promise<User | null> {
    await this.userRepo.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    await this.userRepo.delete(id);
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npm run test -- --testPathPattern=users.service`
Expected: PASS (3/3)

- [ ] **Step 7: Write the controller**

```typescript
// backend/src/users/users.controller.ts
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, ValidationPipe } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Post()
  create(@Body(new ValidationPipe()) dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body(new ValidationPipe()) dto: CreateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.remove(id);
  }
}
```

- [ ] **Step 8: Write the module**

```typescript
// backend/src/users/users.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 9: Register in `app.module.ts`**

Read `backend/src/app.module.ts` first. Add `import { User } from './users/user.entity';` and `import { UsersModule } from './users/users.module';` to the imports section. Add `User` to the `entities: [...]` array passed to `TypeOrmModule.forRootAsync`. Add `UsersModule` to the `imports: [...]` array of `AppModule`.

- [ ] **Step 10: Build to verify wiring**

Run: `cd backend && npm run build`
Expected: compiles with no errors.

- [ ] **Step 11: Commit**

```bash
git add backend/src/users backend/src/app.module.ts
git commit -m "feat(backend): add UsersModule with full CRUD"
```

---

### Task 3: `Keyword` entity + DTO + service/controller scoping by `user_id`

**Files:**
- Modify: `backend/src/keywords/keyword.entity.ts`
- Modify: `backend/src/keywords/dto/create-keyword.dto.ts`
- Modify: `backend/src/keywords/keywords.service.ts`
- Modify: `backend/src/keywords/keywords.controller.ts`
- Create: `backend/src/keywords/keywords.service.spec.ts`

**Interfaces:**
- Consumes: `User` entity from Task 2 (`backend/src/users/user.entity.ts`).
- Produces: `KeywordsService.findAll(userId?: number)`, `KeywordsService.findActive()` now loads `relations: ['user']`.

- [ ] **Step 1: Modify `keyword.entity.ts`**

Add imports `ManyToOne, JoinColumn` from `typeorm` and `import { User } from '../users/user.entity';`. Add to the class body:

```typescript
  @Column({ type: 'int' })
  user_id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
```

- [ ] **Step 2: Modify `create-keyword.dto.ts`**

Add (with the existing `@Type(() => Number)` numeric fields, alongside imports already present — `IsNumber`, `Min`, `Type`):

```typescript
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  user_id: number;
```

This field has no `@IsOptional()` — every keyword must have an owner.

- [ ] **Step 3: Write the failing test for `KeywordsService` scoping**

```typescript
// backend/src/keywords/keywords.service.spec.ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Keyword } from './keyword.entity';
import { KeywordsService } from './keywords.service';

function mockRepo(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOneBy: jest.fn().mockResolvedValue(null),
    create: jest.fn((dto: any) => dto),
    save: jest.fn((entity: any) => Promise.resolve({ id: 1, ...entity })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    ...overrides,
  };
}

async function buildService(repoOverrides: Partial<Record<string, jest.Mock>> = {}) {
  const repo = mockRepo(repoOverrides);
  const moduleRef = await Test.createTestingModule({
    providers: [KeywordsService, { provide: getRepositoryToken(Keyword), useValue: repo }],
  }).compile();
  return { service: moduleRef.get(KeywordsService), repo };
}

describe('KeywordsService', () => {
  it('findAll with no userId fetches all keywords', async () => {
    const { service, repo } = await buildService();
    await service.findAll();
    expect(repo.find).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('findAll with userId filters by owner', async () => {
    const { service, repo } = await buildService();
    await service.findAll(3);
    expect(repo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { user_id: 3 } }));
  });

  it('findActive loads the user relation and stays unfiltered', async () => {
    const { service, repo } = await buildService();
    await service.findActive();
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true }, relations: ['user'] }),
    );
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && npm run test -- --testPathPattern=keywords.service`
Expected: FAIL — `findAll`/`findActive` assertions don't match current implementation (no `where`/`relations` args, or wrong shape).

- [ ] **Step 5: Modify `keywords.service.ts`**

Read the file first, then change `findAll()` and `findActive()`:

```typescript
  findAll(userId?: number) {
    return this.keywordRepo.find({
      where: userId ? { user_id: userId } : {},
      order: { created_at: 'DESC' },
    });
  }

  findActive() {
    return this.keywordRepo.find({
      where: { active: true },
      relations: ['user'],
      order: { id: 'ASC' },
    });
  }
```

Keep the rest of the file (`findOne`, `create`, `update`, `remove`) unchanged.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npm run test -- --testPathPattern=keywords.service`
Expected: PASS (3/3)

- [ ] **Step 7: Modify `keywords.controller.ts`**

Read the file first. Add `@Query('user_id') userId?: string` to `findAll`, parse to number, and pass through:

```typescript
  @Get()
  findAll(@Query('user_id') userId?: string) {
    return this.keywordsService.findAll(userId ? Number(userId) : undefined);
  }
```

Ensure `Query` is imported from `@nestjs/common` (add to the existing import line if missing).

- [ ] **Step 8: Build to verify**

Run: `cd backend && npm run build`
Expected: compiles with no errors.

- [ ] **Step 9: Commit**

```bash
git add backend/src/keywords
git commit -m "feat(backend): scope keywords by user_id, load user relation for scraper"
```

---

### Task 4: `ListingsService`/`ListingsController` scoping by `user_id`

**Files:**
- Modify: `backend/src/listings/listings.service.ts`
- Modify: `backend/src/listings/listings.controller.ts`
- Modify: `backend/src/listings/listings.service.spec.ts`

**Interfaces:**
- Produces: `ListingsService.getListings(opts: { ...existing, userId?: number })`, `ListingsService.getStats(userId?: number)`.

- [ ] **Step 1: Read current `listings.service.ts` and `listings.service.spec.ts` in full before editing** (exact current SQL-builder and test pattern must be preserved).

- [ ] **Step 2: Write the failing tests**

Append to `backend/src/listings/listings.service.spec.ts` (extend the existing `buildService` helper to accept an optional Listing-repo override for `count`, per the existing pattern in the file):

```typescript
  it('getListings adds a user_id filter to the WHERE clause when userId is provided', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const service = buildService(queryMock);
    await service.getListings({ userId: 7 });
    expect(queryMock.mock.calls[0][0]).toContain('k.user_id = $');
  });

  it('getStats scopes active_keywords/alerts_24h/listings_24h by userId but keeps total_listings global', async () => {
    const queryMock = jest
      .fn()
      .mockResolvedValueOnce([{ count: '2' }]) // active_keywords
      .mockResolvedValueOnce([{ count: '1' }]) // alerts_24h
      .mockResolvedValueOnce([{ count: '3' }]); // listings_24h
    const service = buildService(queryMock, { count: jest.fn().mockResolvedValue(999) });
    const stats = await service.getStats(7);
    expect(stats.total_listings).toBe(999);
    expect(queryMock.mock.calls[0][0]).toContain('k.user_id');
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npm run test -- --testPathPattern=listings.service`
Expected: FAIL — `userId` not yet supported, `buildService` doesn't accept a second arg.

- [ ] **Step 4: Extend `buildService` in the spec file**

Modify the existing `buildService(queryMock)` helper signature to `buildService(queryMock: jest.Mock, listingRepoOverrides: Partial<Record<string, jest.Mock>> = {})`, and pass `{ ...mockRepo(), ...listingRepoOverrides }` as the `Listing` repo provider (mirroring the existing `mockRepo()` usage for `KeywordListing`/`PriceHistory`). Update existing call sites (`buildService(queryMock)`) — they still work unchanged since the new param is optional.

- [ ] **Step 5: Modify `getListings` in `listings.service.ts`**

Find the dynamic `WHERE` array construction (where `keywordId` is pushed as a condition). Add, alongside that block:

```typescript
    if (opts.userId) {
      conditions.push(`k.user_id = $${params.length + 1}`);
      params.push(opts.userId);
    }
```

(Match this to the actual variable names found in Step 1's read — e.g. if the array is named `where`/`conditions` and the params array is `params`, use those exact names. Insert this before the `params.push(limit, offset)` line, consistent with how `keywordId` is currently handled.)

Add `userId?: number;` to the `getListings(opts: {...})` parameter type.

- [ ] **Step 6: Modify `getStats` in `listings.service.ts`**

Change the signature to `getStats(userId?: number)`. For the three queries currently scoped to `active_keywords`, `alerts_24h`, `listings_24h`, add a `JOIN keywords k ON ... WHERE k.user_id = $1` clause (mirroring the existing join pattern in each query) only when `userId` is provided — otherwise keep the existing unfiltered SQL. Leave the `total_listings` line (`this.listingRepo.count()`) completely unchanged — it must stay global per spec.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && npm run test -- --testPathPattern=listings.service`
Expected: PASS (all tests, old and new)

- [ ] **Step 8: Modify `listings.controller.ts`**

Read the file first. Add `@Query('user_id') userId?: string` to both `findAll` and `getStats`, parsing to number and passing through to `getListings({..., userId: userId ? Number(userId) : undefined})` and `getStats(userId ? Number(userId) : undefined)`.

- [ ] **Step 9: Build to verify**

Run: `cd backend && npm run build`
Expected: compiles with no errors.

- [ ] **Step 10: Commit**

```bash
git add backend/src/listings
git commit -m "feat(backend): scope listings and stats by user_id, keep total_listings global"
```

---

### Task 5: `TelegramService` per-user routing

**Files:**
- Modify: `backend/src/notifications/telegram.service.ts`
- Modify: `backend/src/notifications/telegram.controller.ts`
- Create: `backend/src/notifications/telegram.service.spec.ts`

**Interfaces:**
- Consumes: `Keyword.user.telegram_chat_id` (Task 3).
- Produces: `TelegramService.sendListingAlert(listing, keyword, countryCode)` (signature unchanged, behavior changed), `TelegramService.sendTest(chatId: string)`.

- [ ] **Step 1: Read `telegram.service.ts` in full before editing.**

- [ ] **Step 2: Write the failing tests**

```typescript
// backend/src/notifications/telegram.service.spec.ts
jest.mock('axios', () => ({ post: jest.fn().mockResolvedValue({ data: {} }) }));
import axios from 'axios';
import { TelegramService } from './telegram.service';

describe('TelegramService', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv, TELEGRAM_BOT_TOKEN: 'test-token' };
    (axios.post as jest.Mock).mockClear();
  });
  afterAll(() => {
    process.env = originalEnv;
  });

  it('sendListingAlert routes to keyword.user.telegram_chat_id', async () => {
    const service = new TelegramService();
    const keyword = { label: 'k', user: { telegram_chat_id: '-555' } } as any;
    const listing = { title: 't', price: 10, url: 'http://x', vinted_id: 1 } as any;
    await service.sendListingAlert(listing, keyword, 'fr');
    expect(axios.post).toHaveBeenCalled();
    const url = (axios.post as jest.Mock).mock.calls[0][0];
    const body = (axios.post as jest.Mock).mock.calls[0][1];
    expect(url).toContain('test-token');
    expect(body.chat_id).toBe('-555');
  });

  it('sendListingAlert skips silently when the keyword owner has no chat_id', async () => {
    const service = new TelegramService();
    const keyword = { label: 'k', user: { telegram_chat_id: '' } } as any;
    const listing = { title: 't', price: 10, url: 'http://x', vinted_id: 1 } as any;
    await service.sendListingAlert(listing, keyword, 'fr');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('sendTest sends to the chat_id passed as a parameter', async () => {
    const service = new TelegramService();
    await service.sendTest('-999');
    const body = (axios.post as jest.Mock).mock.calls[0][1];
    expect(body.chat_id).toBe('-999');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npm run test -- --testPathPattern=telegram.service`
Expected: FAIL — current `sendListingAlert` uses `this.chatId` (global env var), `sendTest` takes no params.

- [ ] **Step 4: Modify `telegram.service.ts`**

Keep the constructor reading `TELEGRAM_BOT_TOKEN` into `this.token` (drop the `TELEGRAM_CHAT_ID`/`this.chatId` read — chat_id is now always per-call). Rename the `configured` getter to check only `this.token`. Update `sendListingAlert`:

```typescript
  async sendListingAlert(listing: Listing, keyword: Keyword, countryCode: string): Promise<void> {
    const chatId = keyword.user?.telegram_chat_id;
    if (!this.configured) return;
    if (!chatId) {
      this.logger.warn(`Skipping Telegram alert for keyword "${keyword.label}": owner has no telegram_chat_id`);
      return;
    }
    // ...existing message-building logic unchanged, but send to `chatId` instead of `this.chatId`
  }
```

(Adapt to the exact existing method body found in Step 1's read — only the chat_id source and the early-return guard change; the message formatting/`escape()` logic stays untouched.)

Update `sendTest`:

```typescript
  async sendTest(chatId: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.configured) {
      return { ok: false, error: 'TELEGRAM_BOT_TOKEN manquant' };
    }
    if (!chatId) {
      return { ok: false, error: 'Aucun chat_id fourni' };
    }
    // ...existing send logic unchanged, but POST to `chatId` instead of `this.chatId`
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npm run test -- --testPathPattern=telegram.service`
Expected: PASS (3/3)

- [ ] **Step 6: Modify `telegram.controller.ts`**

```typescript
// backend/src/notifications/telegram.controller.ts
import { Body, Controller, Post } from '@nestjs/common';
import { TelegramService } from './telegram.service';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  @Post('test')
  test(@Body('chat_id') chatId: string) {
    return this.telegramService.sendTest(chatId);
  }
}
```

(Match the existing decorator/class style found in Step 1's read of the original 13-line file.)

- [ ] **Step 7: Build to verify**

Run: `cd backend && npm run build`
Expected: compiles with no errors.

- [ ] **Step 8: Commit**

```bash
git add backend/src/notifications/telegram.service.ts backend/src/notifications/telegram.controller.ts backend/src/notifications/telegram.service.spec.ts
git commit -m "feat(backend): route Telegram alerts per keyword owner, sendTest takes chat_id param"
```

---

### Task 6: `DealsGateway`/`ScraperService` — `userId` on the WebSocket event

**Files:**
- Modify: `backend/src/notifications/deals.gateway.ts`
- Modify: `backend/src/scraper/scraper.service.ts`

**Interfaces:**
- Produces: `ListingEvent` gains required `userId: number`.

- [ ] **Step 1: Modify `deals.gateway.ts`**

Read the file first. Add `userId: number;` to the `ListingEvent` interface (alongside `listingId, title, price, photoUrl, url, keywordLabel, vintedCreatedAt`).

- [ ] **Step 2: Build to confirm the type error (red)**

Run: `cd backend && npm run build`
Expected: FAIL — TS2741 "Property 'userId' is missing" at the `emitNewListing(...)` call site in `scraper.service.ts` (around line 179-187).

- [ ] **Step 3: Modify `scraper.service.ts`**

In the `emitNewListing({...})` call (lines ~179-187), add `userId: keyword.user_id,` to the payload object.

- [ ] **Step 4: Build to confirm the fix (green)**

Run: `cd backend && npm run build`
Expected: compiles with no errors.

- [ ] **Step 5: Run the full backend test suite to confirm no regressions**

Run: `cd backend && npm run test`
Expected: all existing suites still PASS (this task has no new Jest tests — verified via TS-compile red/green instead, since `runFastScan` is private and the file's axios/cookiejar mocks make it impractical to exercise end-to-end here).

- [ ] **Step 6: Commit**

```bash
git add backend/src/notifications/deals.gateway.ts backend/src/scraper/scraper.service.ts
git commit -m "feat(backend): include userId on new-listing WebSocket events"
```

---

### Task 7: Frontend `api.ts` — types and new endpoints

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Produces: `Keyword.user_id: number`, `User` interface, `LatestListingsParams.userId?: number`, `api.keywords.list(userId?: number)`, `api.listings.stats(userId?: number)`, `api.telegram.test(chatId: string)`, `api.users.{list,get,create,update,delete}`.

- [ ] **Step 1: Add `user_id` to the `Keyword` interface**

```typescript
export interface Keyword {
  id: number;
  label: string;
  search_text: string;
  min_price: number | null;
  max_price: number | null;
  category: string | null;
  catalog_id: number | null;
  scan_interval_seconds: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  country_codes?: string[];
  user_id: number;
}
```

- [ ] **Step 2: Add a `User` interface**

```typescript
export interface User {
  id: number;
  name: string;
  telegram_chat_id: string;
  created_at: string;
}
```

- [ ] **Step 3: Add `userId` to `LatestListingsParams` and to `latestQuery()`**

```typescript
export interface LatestListingsParams {
  keywordId?: number;
  limit?: number;
  offset?: number;
  country?: string;
  q?: string;
  maxAgeHours?: number;
  soloSeller?: boolean;
  userId?: number;
}
```

In `latestQuery()`, add: `if (p.userId) qs.set('user_id', String(p.userId));`

- [ ] **Step 4: Update the `api` object**

```typescript
export const api = {
  keywords: {
    list: (userId?: number) => req<Keyword[]>(`/keywords${userId ? `?user_id=${userId}` : ''}`),
    get: (id: number) => req<Keyword>(`/keywords/${id}`),
    create: (data: Partial<Keyword>) => req<Keyword>('/keywords', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Keyword>) => req<Keyword>(`/keywords/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => req<void>(`/keywords/${id}`, { method: 'DELETE' }),
  },
  listings: {
    latest: (params: LatestListingsParams = {}) =>
      req<any[]>(`/listings${latestQuery(params)}`).then(rows => rows.map(rowToKeywordListing)),
    get: (id: number) => req<any>(`/listings/${id}`),
    history: (id: number) => req<PricePoint[]>(`/listings/${id}/history`),
    stats: (userId?: number) => req<Stats>(`/listings/stats${userId ? `?user_id=${userId}` : ''}`),
  },
  telegram: {
    test: (chatId: string) => req<{ ok: boolean; error?: string }>('/telegram/test', { method: 'POST', body: JSON.stringify({ chat_id: chatId }) }),
  },
  scraper: {
    status: () => req<any>('/scraper/status'),
    pause: () => req<{ paused: boolean }>('/scraper/pause', { method: 'POST' }),
    resume: () => req<{ paused: boolean }>('/scraper/resume', { method: 'POST' }),
  },
  users: {
    list: () => req<User[]>('/users'),
    get: (id: number) => req<User>(`/users/${id}`),
    create: (data: Partial<User>) => req<User>('/users', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<User>) => req<User>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => req<void>(`/users/${id}`, { method: 'DELETE' }),
  },
};
```

- [ ] **Step 5: Type-check the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors from `api.ts` itself (existing call sites that haven't been updated yet, e.g. `api.telegram.test()` with no args, will now show errors — that's expected and resolved in Task 10).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(frontend): add user_id support to api client and User type"
```

---

### Task 8: `CurrentUserContext` + mount in `layout.tsx`

**Files:**
- Create: `frontend/src/lib/CurrentUserContext.tsx`
- Modify: `frontend/src/app/layout.tsx`

**Interfaces:**
- Consumes: `api.users.list()` (Task 7).
- Produces: `CurrentUserProvider`, `useCurrentUser(): { users: User[], activeUserId: number | null, activeUser: User | null, setActiveUserId: (id: number) => void, loading: boolean, refresh: () => Promise<void> }`.

- [ ] **Step 1: Check `node_modules/next/dist/docs/` for any client-context/provider conventions specific to this Next.js version before writing the provider** (per `frontend/AGENTS.md`: "This is NOT the Next.js you know").

Run: `cd frontend && ls node_modules/next/dist/docs/ 2>/dev/null || echo "no docs dir"` — if relevant docs exist on client context patterns, skim them; otherwise proceed with standard React Context (no Next.js-specific API is needed for a client-side context provider).

- [ ] **Step 2: Write `CurrentUserContext.tsx`**

```typescript
// frontend/src/lib/CurrentUserContext.tsx
'use client';
import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api, User } from './api';

const STORAGE_KEY = 'vinbot_active_user_id';

interface CurrentUserState {
  users: User[];
  activeUserId: number | null;
  activeUser: User | null;
  setActiveUserId: (id: number) => void;
  loading: boolean;
  refresh: () => Promise<void>;
}

const CurrentUserContext = createContext<CurrentUserState | null>(null);

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [activeUserId, setActiveUserIdState] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.users.list();
      setUsers(list);
      const stored = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      const storedId = stored ? Number(stored) : null;
      const validStored = storedId != null && list.some(u => u.id === storedId);
      setActiveUserIdState(validStored ? storedId : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setActiveUserId = useCallback((id: number) => {
    setActiveUserIdState(id);
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, String(id));
  }, []);

  const activeUser = users.find(u => u.id === activeUserId) ?? null;

  return (
    <CurrentUserContext.Provider value={{ users, activeUserId, activeUser, setActiveUserId, loading, refresh }}>
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser(): CurrentUserState {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) throw new Error('useCurrentUser must be used within a CurrentUserProvider');
  return ctx;
}
```

- [ ] **Step 3: Mount the provider in `layout.tsx`**

Read the file first. Wrap the existing `<Sidebar />` + `<main>{children}</main>` block with `<CurrentUserProvider>`:

```tsx
import { CurrentUserProvider } from '@/lib/CurrentUserContext';
// ...inside the body, wrap the existing Sidebar + main block:
<CurrentUserProvider>
  <Sidebar />
  <main>{children}</main>
</CurrentUserProvider>
```

(Match exactly to the existing JSX structure found in the 26-line file — only add the wrapping provider, don't otherwise restructure. `ProfileGate` is added separately in Task 12, wrapping just `{children}`.)

- [ ] **Step 4: Manually verify in the browser**

Run: `cd frontend && NEXT_PUBLIC_API_URL=http://localhost:3001 npm run dev`, open `http://localhost:3000`, open devtools console — confirm no context errors thrown and the app still renders (UserPicker doesn't exist yet, so no visible change expected this task).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/CurrentUserContext.tsx frontend/src/app/layout.tsx
git commit -m "feat(frontend): add CurrentUserProvider context for active profile"
```

---

### Task 9: `UserPicker` dropdown in `Sidebar`

**Files:**
- Create: `frontend/src/components/UserPicker.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `useCurrentUser()` (Task 8).

- [ ] **Step 1: Write `UserPicker.tsx`**

```tsx
// frontend/src/components/UserPicker.tsx
'use client';
import { useState } from 'react';
import { ChevronDown, User as UserIcon } from 'lucide-react';
import { useCurrentUser } from '@/lib/CurrentUserContext';

export default function UserPicker() {
  const { users, activeUser, setActiveUserId, loading } = useCurrentUser();
  const [open, setOpen] = useState(false);

  if (loading) {
    return <div className="text-xs text-zinc-500 px-3 py-2">Chargement…</div>;
  }

  return (
    <div className="relative px-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 bg-zinc-900/60 border border-zinc-800/80 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-200 hover:border-zinc-700 transition-colors"
      >
        <span className="flex items-center gap-2 truncate">
          <UserIcon size={14} className="text-indigo-400 shrink-0" />
          <span className="truncate">{activeUser ? activeUser.name : 'Aucun profil'}</span>
        </span>
        <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-3 right-3 mt-1 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-50 overflow-hidden">
          {users.length === 0 && (
            <div className="px-3 py-2 text-xs text-zinc-500">Aucun utilisateur — créez-en un dans Réglages.</div>
          )}
          {users.map(u => (
            <button
              key={u.id}
              onClick={() => {
                setActiveUserId(u.id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-800 transition-colors ${
                u.id === activeUser?.id ? 'text-indigo-400 font-semibold' : 'text-zinc-300'
              }`}
            >
              {u.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount in `Sidebar.tsx`**

Read the file first. Import `UserPicker` and place `<UserPicker />` immediately after the brand logo block (Bot icon + "Vinbot" text + version tag), before the `navLinks` rendering.

- [ ] **Step 3: Manually verify in the browser**

With the dev server running (Task 8 Step 4), confirm the picker renders in the sidebar, shows "Aucun profil" (no users created yet), and the dropdown opens/closes on click without errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/UserPicker.tsx frontend/src/components/Sidebar.tsx
git commit -m "feat(frontend): add UserPicker dropdown to sidebar"
```

---

### Task 10: `UsersPanel` in Réglages + `testTelegram()` rewrite

**Files:**
- Create: `frontend/src/components/UsersPanel.tsx`
- Modify: `frontend/src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `api.users.*` (Task 7), `useCurrentUser()` (Task 8).

- [ ] **Step 1: Write `UsersPanel.tsx`**

```tsx
// frontend/src/components/UsersPanel.tsx
'use client';
import { useState } from 'react';
import { Users, Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { api, User } from '@/lib/api';
import { useCurrentUser } from '@/lib/CurrentUserContext';

export default function UsersPanel() {
  const { users, refresh, activeUserId, setActiveUserId } = useCurrentUser();
  const [name, setName] = useState('');
  const [chatId, setChatId] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editChatId, setEditChatId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function createUser() {
    if (!name.trim()) {
      setError('Le nom est requis.');
      return;
    }
    setError(null);
    const created = await api.users.create({ name: name.trim(), telegram_chat_id: chatId.trim() });
    setName('');
    setChatId('');
    await refresh();
    if (activeUserId == null) setActiveUserId(created.id);
  }

  function startEdit(u: User) {
    setEditingId(u.id);
    setEditName(u.name);
    setEditChatId(u.telegram_chat_id);
  }

  async function saveEdit(id: number) {
    await api.users.update(id, { name: editName.trim(), telegram_chat_id: editChatId.trim() });
    setEditingId(null);
    await refresh();
  }

  async function deleteUser(id: number) {
    await api.users.delete(id);
    await refresh();
  }

  return (
    <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-6 space-y-5 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="bg-violet-500/10 text-violet-400 p-2 rounded-xl border border-violet-500/20">
          <Users size={18} />
        </div>
        <div>
          <h2 className="font-bold text-white text-base">Utilisateurs</h2>
          <p className="text-xs text-zinc-500">Créez un profil par personne ; chacun reçoit ses alertes sur son propre chat Telegram.</p>
        </div>
      </div>

      <div className="space-y-2">
        {users.map(u => (
          <div key={u.id} className="flex items-center gap-2 bg-zinc-950/40 border border-zinc-850 rounded-xl px-3 py-2">
            {editingId === u.id ? (
              <>
                <input value={editName} onChange={e => setEditName(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-white flex-1" />
                <input value={editChatId} onChange={e => setEditChatId(e.target.value)} placeholder="chat_id" className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-white flex-1" />
                <button onClick={() => saveEdit(u.id)} className="text-emerald-400 hover:text-emerald-300"><Check size={16} /></button>
                <button onClick={() => setEditingId(null)} className="text-zinc-500 hover:text-zinc-300"><X size={16} /></button>
              </>
            ) : (
              <>
                <span className={`text-sm flex-1 ${u.id === activeUserId ? 'text-indigo-400 font-semibold' : 'text-zinc-200'}`}>{u.name}</span>
                <span className="text-[11px] text-zinc-500 font-mono">{u.telegram_chat_id || '—'}</span>
                <button onClick={() => startEdit(u)} className="text-zinc-500 hover:text-zinc-300"><Pencil size={14} /></button>
                <button onClick={() => deleteUser(u.id)} className="text-rose-500 hover:text-rose-400"><Trash2 size={14} /></button>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-zinc-850">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Nom" className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-white flex-1" />
        <input value={chatId} onChange={e => setChatId(e.target.value)} placeholder="chat_id Telegram" className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-white flex-1" />
        <button onClick={createUser} className="bg-indigo-600 hover:bg-indigo-500 text-white p-1.5 rounded-lg"><Plus size={14} /></button>
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Modify `settings/page.tsx`**

Read the file first. Import `UsersPanel` and `useCurrentUser`. Rewrite `testTelegram()`:

```typescript
import UsersPanel from '@/components/UsersPanel';
import { useCurrentUser } from '@/lib/CurrentUserContext';
// ...
export default function SettingsPage() {
  const { activeUser } = useCurrentUser();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  async function testTelegram() {
    if (!activeUser) {
      setTestResult({ ok: false, error: 'Sélectionnez un profil avant de tester.' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.telegram.test(activeUser.telegram_chat_id);
      setTestResult(res);
    } catch {
      setTestResult({ ok: false, error: 'Impossible de joindre l\'API' });
    } finally {
      setTesting(false);
    }
  }
  // ...rest unchanged
```

Add `<UsersPanel />` as the first item in the `grid grid-cols-1 gap-6` div (before the Telegram Notifications panel).

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors related to `settings/page.tsx` or `UsersPanel.tsx`.

- [ ] **Step 4: Manually verify in the browser**

With dev server running: navigate to `/settings`, create a user via the new panel, confirm it appears in the list and in the `UserPicker` dropdown (Task 9), select it as active, then click "Envoyer un message de test" and confirm it either succeeds or shows a clear error (depending on whether `TELEGRAM_BOT_TOKEN` is configured locally).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/UsersPanel.tsx frontend/src/app/settings/page.tsx
git commit -m "feat(frontend): add Utilisateurs panel to Réglages, test Telegram per active profile"
```

---

### Task 11: `KeywordForm` auto-attaches `user_id`

**Files:**
- Modify: `frontend/src/components/KeywordForm.tsx`

**Interfaces:**
- Consumes: `useCurrentUser()` (Task 8).

- [ ] **Step 1: Read `KeywordForm.tsx` in full before editing** (271 lines, local `form` state + `submit()`).

- [ ] **Step 2: Import the hook and guard `submit()`**

Add `import { useCurrentUser } from '@/lib/CurrentUserContext';` and, inside the component, `const { activeUserId } = useCurrentUser();`. At the top of `submit()`, before building `payload`:

```typescript
    if (activeUserId == null) {
      setError('Sélectionnez un profil avant de créer un mot-clé.');
      return;
    }
```

(Use the existing error-state setter found in the file — likely `setError`, confirm exact name from the read in Step 1.)

- [ ] **Step 3: Add `user_id` to the payload**

In the `payload` object built before `api.keywords.create(payload)` / `.update(initial.id, payload)`, add: `user_id: activeUserId,`. Not exposed as a visible form field.

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors in `KeywordForm.tsx`.

- [ ] **Step 5: Manually verify in the browser**

With a profile selected (Task 10), open the keyword creation form on `/keywords`, submit a new keyword, confirm it's created successfully (check via Réglages or by reloading `/keywords`). Then deselect the profile (clear `localStorage` key `vinbot_active_user_id` via devtools and reload) and confirm the form blocks submission with the new error message.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/KeywordForm.tsx
git commit -m "feat(frontend): auto-attach active profile as keyword owner"
```

---

### Task 12: Scope remaining pages to the active profile + first-run `ProfileGate`

**Files:**
- Modify: `frontend/src/lib/listingEvent.ts`
- Modify: `frontend/src/app/keywords/page.tsx`
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/app/listings/page.tsx`
- Modify: `frontend/src/app/live/page.tsx`
- Create: `frontend/src/components/ProfileGate.tsx`
- Modify: `frontend/src/app/layout.tsx`

**Interfaces:**
- Consumes: `useCurrentUser()` (Task 8), `api.keywords.list(userId?)` / `api.listings.stats(userId?)` (Task 7).

- [ ] **Step 1: `listingEvent.ts`** — add `userId: number;` to the interface, mirroring `backend/src/notifications/deals.gateway.ts`'s `ListingEvent` from Task 6.

- [ ] **Step 2: `keywords/page.tsx`**

Read the file first. Import `useCurrentUser`. Convert `load` to `useCallback`:

```typescript
const { activeUserId } = useCurrentUser();
const load = useCallback(() => {
  if (activeUserId == null) {
    setKeywords([]);
    return Promise.resolve();
  }
  return api.keywords.list(activeUserId).then(setKeywords);
}, [activeUserId]);

useEffect(() => {
  load();
}, [load]);
```

(Match exact existing variable names — `setKeywords`, the `useEffect` — from the file's current 206-line content; only the data-fetching logic changes.)

- [ ] **Step 3: `page.tsx` (Dashboard)**

Read the file first. Import `useCurrentUser`. In the existing `loadData` `useCallback`, change `api.listings.stats()` to `api.listings.stats(activeUserId ?? undefined)` and add `activeUserId` to the dependency array.

- [ ] **Step 4: `listings/page.tsx`**

Read the file first. Import `useCurrentUser`. The keywords-loading `useEffect` (currently `api.keywords.list().then(setKeywords)` with no deps) becomes:

```typescript
useEffect(() => {
  if (activeUserId == null) {
    setKeywords([]);
    return;
  }
  api.keywords.list(activeUserId).then(setKeywords);
}, [activeUserId]);
```

In the existing `baseParams` `useCallback`, add `userId: activeUserId ?? undefined` to the returned params object and add `activeUserId` to its dependency array.

- [ ] **Step 5: `live/page.tsx`**

Read the file first. Import `useCurrentUser`. In `handleListing` (currently a `useCallback` with an empty dependency array), add the filter and the dependency:

```typescript
const { activeUserId } = useCurrentUser();
const handleListing = useCallback((listing: ListingEvent) => {
  if (activeUserId != null && listing.userId !== activeUserId) return;
  // ...existing body unchanged
}, [activeUserId]);
```

- [ ] **Step 6: Write `ProfileGate.tsx`**

```tsx
// frontend/src/components/ProfileGate.tsx
'use client';
import { ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useCurrentUser } from '@/lib/CurrentUserContext';
import { AlertCircle } from 'lucide-react';

export default function ProfileGate({ children }: { children: ReactNode }) {
  const { activeUserId, loading } = useCurrentUser();
  const pathname = usePathname();

  if (loading) return null;

  if (activeUserId == null && pathname !== '/settings') {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 text-center gap-3">
        <AlertCircle size={28} className="text-amber-400" />
        <p className="text-sm text-zinc-300 font-semibold">Sélectionnez ou créez un profil pour continuer</p>
        <p className="text-xs text-zinc-500">Rendez-vous dans Réglages pour créer votre premier profil.</p>
      </div>
    );
  }

  return <>{children}</>;
}
```

Note: this renders an inline message rather than a `router.push` redirect, since `Sidebar`/`UserPicker` must stay visible (per spec) so the user can navigate to `/settings` themselves — `useRouter` is imported for potential future use but the gate intentionally does not auto-redirect, avoiding a redirect loop with the sidebar nav. Remove the unused `useRouter` import to keep the build clean:

```tsx
import { usePathname } from 'next/navigation';
```

(Drop `useRouter` from the import — it's not used in this implementation.)

- [ ] **Step 7: Mount `ProfileGate` in `layout.tsx`**

Read the file first (it was modified in Task 8 to add `CurrentUserProvider`). Wrap just `{children}` inside `<main>`:

```tsx
import ProfileGate from '@/components/ProfileGate';
// ...
<CurrentUserProvider>
  <Sidebar />
  <main>
    <ProfileGate>{children}</ProfileGate>
  </main>
</CurrentUserProvider>
```

- [ ] **Step 8: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Manually verify in the browser — full golden path**

With dev server running:
1. Clear `localStorage` key `vinbot_active_user_id`, reload — confirm every page except `/settings` shows the "Sélectionnez ou créez un profil" message, while the sidebar (including `UserPicker`) remains visible and usable.
2. Go to `/settings`, create a user via `UsersPanel`, select it via `UserPicker`.
3. Navigate to `/keywords` — confirm the gate clears and the page loads (empty list expected for a new user).
4. Create a keyword via `KeywordForm` (Task 11) — confirm it appears in the list.
5. Navigate to `/` (Dashboard) — confirm stats load without error.
6. Navigate to `/live` — confirm the page loads and the WebSocket connects (no errors in console even with zero events).
7. Navigate to `/listings` — confirm it loads and the keyword filter dropdown shows the new keyword.
8. Create a second user, switch the active profile via `UserPicker`, and confirm `/keywords` now shows an empty list (data correctly scoped per profile).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/listingEvent.ts frontend/src/app/keywords/page.tsx frontend/src/app/page.tsx frontend/src/app/listings/page.tsx frontend/src/app/live/page.tsx frontend/src/components/ProfileGate.tsx frontend/src/app/layout.tsx
git commit -m "feat(frontend): scope all pages to active profile, add first-run ProfileGate"
```

---

## Self-Review

**Spec coverage** — every item in `2026-06-18-sp2-multi-user-design.md` maps to a task:
- `users` table + backfill from `TELEGRAM_CHAT_ID` → Task 1
- `keywords.user_id` FK + migration → Task 1
- `user_id` as explicit query/body param, never a header → Tasks 3, 4, 7 (all use query/body params)
- `User` entity + `UsersModule` CRUD → Task 2
- `KeywordsService.findAll` filtered, `findActive` unfiltered + loads `user` relation → Task 3
- `ListingsService.getListings`/`getStats` scoped, `total_listings` stays global → Task 4
- `TelegramService.sendListingAlert` routes via `keyword.user.telegram_chat_id`, skips silently if empty → Task 5
- `TelegramService.sendTest(chatId)` → Task 5
- Scraper's `findActive()` loads `user` relation for the alert path → Task 3 (service) + Task 6 (gateway/scraper wiring)
- `UserPicker` in `Sidebar` → Task 9
- "Utilisateurs" panel in Réglages → Task 10
- `KeywordForm` auto-attaches `user_id` → Task 11
- Dashboard/Live/Listings/Keywords scoped to active profile → Task 12
- First-run redirect/gate when no valid profile → Task 12 (`ProfileGate`)
- `localStorage` key `vinbot_active_user_id` + React context → Task 8
- Hors scope items (keyword sharing, roles/permissions, special cascade-delete testing) — correctly not implemented anywhere in this plan.

**Placeholder scan** — no "TBD"/"TODO"/"add appropriate handling" found; all code blocks are complete; Task 3/4/5's references to "match the existing variable names found in the read" are explicit instructions to preserve already-confirmed file content (not vague placeholders — the exact current content of every referenced file was confirmed via `Read` during planning).

**Type consistency** — `userId` (camelCase) used consistently in TypeScript signatures (`ListingEvent.userId`, `getListings({userId})`, `getStats(userId)`, `useCurrentUser().activeUserId`); `user_id` (snake_case) used consistently for HTTP query/body params and DB/entity columns, matching the existing codebase convention (e.g. `keyword_id` vs `keywordId` in `LatestListingsParams`). `User` type is identical between `backend/src/users/user.entity.ts` and `frontend/src/lib/api.ts`'s `User` interface (`id, name, telegram_chat_id, created_at`).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-18-sp2-multi-user.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
