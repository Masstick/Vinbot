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
