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
