import { ListingsService } from './listings.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Listing } from './listing.entity';
import { KeywordListing } from './keyword-listing.entity';
import { PriceHistory } from './price-history.entity';
import { DataSource } from 'typeorm';

function mockRepo<T>(overrides: Partial<any> = {}): T {
  return {
    findOneBy: jest.fn(), save: jest.fn(), upsert: jest.fn(), update: jest.fn(),
    find: jest.fn(), count: jest.fn(), create: jest.fn(),
    ...overrides,
  } as unknown as T;
}

async function buildService(queryMock: jest.Mock, listingRepoOverrides: Partial<Record<string, jest.Mock>> = {}) {
  const module = await Test.createTestingModule({
    providers: [
      ListingsService,
      { provide: getRepositoryToken(Listing), useValue: { ...mockRepo(), ...listingRepoOverrides } },
      { provide: getRepositoryToken(KeywordListing), useValue: mockRepo() },
      { provide: getRepositoryToken(PriceHistory), useValue: mockRepo() },
      { provide: DataSource, useValue: { query: queryMock } },
    ],
  }).compile();
  return module.get(ListingsService);
}

describe('ListingsService.getListings', () => {
  it('includes solo_seller filter when soloSeller=true', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const svc = await buildService(queryMock);
    await svc.getListings({ keywordId: 3, soloSeller: true });
    const sql: string = queryMock.mock.calls[0][0];
    expect(sql).toContain('kl.seller_item_count IS NOT NULL');
    expect(sql).toContain('kl.seller_item_count <= 1');
  });

  it('omits solo_seller filter when soloSeller=false', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const svc = await buildService(queryMock);
    await svc.getListings({ keywordId: 3, soloSeller: false });
    const sql: string = queryMock.mock.calls[0][0];
    expect(sql).not.toContain('seller_item_count IS NOT NULL');
  });

  it('getListings adds a user_id filter to the WHERE clause when userId is provided', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const service = await buildService(queryMock);
    await service.getListings({ userId: 7 });
    expect(queryMock.mock.calls[0][0]).toContain('k.user_id = $');
  });

  it('excludes listings marked unavailable (sold/deleted)', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const service = await buildService(queryMock);
    await service.getListings({});
    expect(queryMock.mock.calls[0][0]).toContain('l.unavailable_at IS NULL');
  });

  it('filters listings by the keyword current min/max price bounds', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const service = await buildService(queryMock);
    await service.getListings({});
    const sql: string = queryMock.mock.calls[0][0];
    expect(sql).toContain('k.min_price IS NULL OR l.price >= k.min_price');
    expect(sql).toContain('k.max_price IS NULL OR l.price <= k.max_price');
  });

  it('joint product_type_stats et expose avg_price/deal_score/is_deal', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const svc = await buildService(queryMock);
    await svc.getListings({});
    const sql: string = queryMock.mock.calls[0][0];
    expect(sql).toContain('LEFT JOIN product_type_stats pts');
    expect(sql).toContain('pts.item_count >= 5 THEN pts.avg_price');
    expect(sql).toContain('kl.deal_score >= 20');
  });

  it('ajoute le filtre onlyDeals quand demandé', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const svc = await buildService(queryMock);
    await svc.getListings({ onlyDeals: true });
    const sql: string = queryMock.mock.calls[0][0];
    const whereClause = sql.slice(sql.indexOf('WHERE'));
    expect(whereClause).toContain('kl.deal_score IS NOT NULL AND kl.deal_score >= 20');
  });

  it("n'ajoute pas le filtre onlyDeals par défaut", async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const svc = await buildService(queryMock);
    await svc.getListings({});
    const sql: string = queryMock.mock.calls[0][0];
    // Pas de clause WHERE dynamique par défaut (seulement les filtres toujours actifs :
    // unavailable_at/min_price/max_price), donc pas de "kl.deal_score IS NOT NULL" dans le WHERE.
    const whereClause = sql.slice(sql.indexOf('WHERE'));
    expect(whereClause).not.toContain('kl.deal_score IS NOT NULL');
  });

  it('getStats scopes active_keywords/alerts_24h/listings_24h by userId but keeps total_listings global', async () => {
    const queryMock = jest
      .fn()
      .mockResolvedValueOnce([{ count: '2' }]) // active_keywords
      .mockResolvedValueOnce([{ count: '1' }]) // alerts_24h
      .mockResolvedValueOnce([{ count: '3' }]); // listings_24h
    const service = await buildService(queryMock, { count: jest.fn().mockResolvedValue(999) });
    const stats = await service.getStats(7);
    expect(stats.total_listings).toBe(999);
    expect(queryMock.mock.calls[0][0]).toContain('k.user_id');
  });
});

describe('ListingsService — classification', () => {
  it('setProductTypeKey met à jour la colonne product_type_key', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const svc = await buildService(queryMock);
    await svc.setProductTypeKey(42, 'RAM DDR4 8GB');
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE listings SET product_type_key'),
      [42, 'RAM DDR4 8GB'],
    );
  });

  it('setDealScore met à jour keyword_listings pour la paire (keyword_id, listing_id)', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const svc = await buildService(queryMock);
    await svc.setDealScore(7, 42, 25.5);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE keyword_listings SET deal_score'),
      [7, 42, 25.5],
    );
  });

  it('getUnclassifiedListings ne sélectionne que les mots-clés catégorie-seule sous 3 tentatives', async () => {
    const queryMock = jest.fn().mockResolvedValue([{ id: 1, title: 'x', price: '10.00', keyword_id: 7 }]);
    const svc = await buildService(queryMock);
    const rows = await svc.getUnclassifiedListings(20);
    expect(queryMock.mock.calls[0][0]).toContain("k.search_text = ''");
    expect(queryMock.mock.calls[0][0]).toContain('product_type_attempts < 3');
    expect(rows).toEqual([{ id: 1, title: 'x', price: 10, keywordId: 7 }]);
  });

  it('incrementClassificationAttempts bascule sur unclassified à la 3e tentative', async () => {
    const queryMock = jest.fn().mockResolvedValue([]);
    const svc = await buildService(queryMock);
    await svc.incrementClassificationAttempts(42);
    expect(queryMock.mock.calls[0][0]).toContain("'unclassified'");
    expect(queryMock.mock.calls[0][1]).toEqual([42]);
  });
});
