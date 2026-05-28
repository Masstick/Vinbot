// Mock HTTP-related deps that are ESM-only and irrelevant to filterByTitle
jest.mock('axios-cookiejar-support', () => ({ wrapper: (c: any) => c }));
jest.mock('tough-cookie', () => ({ CookieJar: class {} }));
jest.mock('axios', () => ({ create: () => ({}) }));

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
