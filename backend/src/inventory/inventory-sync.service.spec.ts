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
        markUnseenAsDeleted: jest.fn(async () => 0),
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
      getCatalogMap: async () => new Map(),
      getMemberItems: async (_userId: number, page: number) => (page === 1 ? [{ vinted_id: 1 }, { vinted_id: 2 }] : []),
      getSales: async (page: number) => (page === 1 ? [{ vinted_order_id: 9 }] : []),
    });
    const res = await svc.syncNow();
    expect(res).toEqual({ items: 2, sales: 1 });
    expect(d.accounts.touchRefreshed).toHaveBeenCalledWith('{"cookies":[1]}');
    expect(d.inventory.upsertListing).toHaveBeenCalledTimes(2);
    expect(d.inventory.upsertSale).toHaveBeenCalledTimes(1);
    expect(d.inventory.markUnseenAsDeleted).toHaveBeenCalled();
  });
});
