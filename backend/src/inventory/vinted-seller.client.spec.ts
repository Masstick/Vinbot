// Mock HTTP-related deps that are ESM-only and irrelevant to mappers
jest.mock('axios-cookiejar-support', () => ({ wrapper: (c: any) => c }));
jest.mock('tough-cookie', () => ({ CookieJar: class {}, Cookie: class {} }));
jest.mock('axios', () => ({ create: () => ({}) }));

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
