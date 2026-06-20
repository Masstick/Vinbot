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

  it('requires ALL tokens from a multi-word search (logique ET)', () => {
    const items = [
      { title: 'Processeur Intel i7-8700K' }, // a "i7" mais pas "processeur"… si, contient les deux
      { title: 'Core 2 Duo E8400' },
      { title: 'Processeur AMD Ryzen 5' }, // "processeur" mais pas "i7"
    ];
    const filtered = (client as any).filterByTitle(items, 'processeur i7');
    // Seul le titre contenant À LA FOIS "processeur" et "i7" passe
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('Processeur Intel i7-8700K');
  });

  it('rejects DDR3/4Go listings for a "Ddr4 3200 8gb" search', () => {
    const items = [
      { title: 'RAM DDR4 3200MHz 8 Go Corsair Vengeance' }, // match exact
      { title: 'Barrette DDR3 1600 MHz 4 Go' }, // mauvais type + mauvaise taille
      { title: 'Kit DDR4 2666 8GB' }, // bonne taille mais mauvaise fréquence
      { title: 'DDR4 3200 4GB' }, // bon type/fréquence mais mauvaise taille
    ];
    const filtered = (client as any).filterByTitle(items, 'Ddr4 3200 8gb');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('RAM DDR4 3200MHz 8 Go Corsair Vengeance');
  });

  it('normalise les unités mémoire (8gb = 8 Go = 8 GB) et la fréquence', () => {
    const items = [
      { title: 'DDR4 3200 MHz 8GB' },
      { title: 'DDR4 3200mhz 8 go' },
      { title: 'DDR4 3200 8 GB' },
    ];
    const filtered = (client as any).filterByTitle(items, 'ddr4 3200 8gb');
    expect(filtered).toHaveLength(3);
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

  it('folds accents (mémoire ↔ memoire)', () => {
    const items = [{ title: 'Mémoire DDR4 3200 8 Go' }];
    const filtered = (client as any).filterByTitle(items, 'memoire ddr4 3200 8gb');
    expect(filtered).toHaveLength(1);
  });

  it('normalise les To/TB (2 To = 2tb)', () => {
    const items = [{ title: 'Disque SSD 2 To Samsung' }];
    const filtered = (client as any).filterByTitle(items, 'ssd 2tb');
    expect(filtered).toHaveLength(1);
  });

  it('tolère UN mot descriptif manquant dès 3 mots (sans chiffre)', () => {
    const items = [
      { title: 'Veste en cuir noir Zara' }, // "homme" absent mais 3/4 mots → gardé
      { title: 'Robe en lin beige' }, // ni cuir ni noir → rejeté
    ];
    const filtered = (client as any).filterByTitle(items, 'veste cuir noir homme');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('Veste en cuir noir Zara');
  });

  it('garde les tokens à chiffre OBLIGATOIRES même avec tolérance sur les mots', () => {
    // 4 tokens dont 1 spec (i7) : la spec reste obligatoire, la tolérance ne joue
    // que sur les mots. Un titre sans "i7" est rejeté même s'il a tous les mots.
    const items = [{ title: 'Processeur ordinateur portable gamer Ryzen' }];
    const filtered = (client as any).filterByTitle(items, 'processeur ordinateur portable i7');
    expect(filtered).toHaveLength(0);
  });
});

describe('VintedClient.getSellerProfile', () => {
  function clientWithGet(get: jest.Mock) {
    const client = new VintedClient('fr');
    (client as any).sessionReady = true;
    (client as any).lastSessionInit = Date.now();
    (client as any).client = { get };
    return client;
  }

  it('extracts the lowercased ISO country and item count from the profile', async () => {
    const get = jest.fn().mockResolvedValue({
      data: { user: { country_iso_code: 'ES', item_count: 7, total_items_count: 9 } },
    });
    const client = clientWithGet(get);
    const profile = await client.getSellerProfile(42);
    expect(profile).toEqual({ countryIso: 'es', itemCount: 7 });
  });

  it('falls back to total_items_count and null country when fields are missing', async () => {
    const get = jest.fn().mockResolvedValue({ data: { user: { total_items_count: 3 } } });
    const client = clientWithGet(get);
    const profile = await client.getSellerProfile(42);
    expect(profile).toEqual({ countryIso: null, itemCount: 3 });
  });

  it('returns null on HTTP error (so the cache is not poisoned)', async () => {
    const get = jest.fn().mockRejectedValue(new Error('network'));
    const client = clientWithGet(get);
    expect(await client.getSellerProfile(42)).toBeNull();
  });

  it('throws BANNED on 403', async () => {
    const get = jest.fn().mockRejectedValue({ response: { status: 403 }, message: 'forbidden' });
    const client = clientWithGet(get);
    await expect(client.getSellerProfile(42)).rejects.toThrow('BANNED');
  });
});

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
      created_at_ts: 1716900000,
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

  it('handles created_at_ts = 0 as a valid date (epoch)', () => {
    const raw = {
      id: 789,
      title: 'Epoch',
      price: { amount: '1.00' },
      user: { login: 'x', id: 1 },
      created_at_ts: 0,
    };
    const item = (client as any).parseItem(raw);
    expect(item.vinted_created_at).toBeInstanceOf(Date);
    expect(item.vinted_created_at.getTime()).toBe(0);
  });
});
