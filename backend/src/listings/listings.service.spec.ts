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

async function buildService(queryMock: jest.Mock) {
  const module = await Test.createTestingModule({
    providers: [
      ListingsService,
      { provide: getRepositoryToken(Listing), useValue: mockRepo() },
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
});
