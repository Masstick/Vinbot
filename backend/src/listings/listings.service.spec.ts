import { ListingsService } from './listings.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Listing } from './listing.entity';
import { KeywordListing } from './keyword-listing.entity';
import { PriceHistory } from './price-history.entity';
import { ModelMarketAvg } from '../analysis/model-market-avg.entity';
import { DealAnalysis } from '../analysis/deal-analysis.entity';
import { DataSource } from 'typeorm';

function mockRepo<T>(overrides: Partial<any> = {}): T {
  return {
    findOneBy: jest.fn(), save: jest.fn(), upsert: jest.fn(), update: jest.fn(),
    find: jest.fn(), count: jest.fn(), create: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue({
      innerJoin: jest.fn().mockReturnThis(), innerJoinAndSelect: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(), addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
      getMany: jest.fn().mockResolvedValue([]),
    }),
    ...overrides,
  } as unknown as T;
}

async function buildService(modelAvgOverrides: Partial<any> = {}) {
  const modelAvgRepo = mockRepo<any>(modelAvgOverrides);
  const module = await Test.createTestingModule({
    providers: [
      ListingsService,
      { provide: getRepositoryToken(Listing), useValue: mockRepo() },
      { provide: getRepositoryToken(KeywordListing), useValue: mockRepo() },
      { provide: getRepositoryToken(PriceHistory), useValue: mockRepo() },
      { provide: getRepositoryToken(ModelMarketAvg), useValue: modelAvgRepo },
      { provide: getRepositoryToken(DealAnalysis), useValue: mockRepo() },
      { provide: DataSource, useValue: { query: jest.fn() } },
    ],
  }).compile();
  return { svc: module.get(ListingsService), modelAvgRepo };
}

describe('ListingsService', () => {
  describe('updateModelMarketAvg', () => {
    it('creates a new record when none exists', async () => {
      const { svc, modelAvgRepo } = await buildService({
        findOneBy: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockResolvedValue({}),
      });
      await svc.updateModelMarketAvg(1, 'Intel Core i7-12700K', 150);
      expect(modelAvgRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ keyword_id: 1, model_label: 'Intel Core i7-12700K', avg_price: 150, item_count: 1 })
      );
    });

    it('computes incremental moving average on update', async () => {
      const { svc, modelAvgRepo } = await buildService({
        findOneBy: jest.fn().mockResolvedValue({ avg_price: '100.00', item_count: 2 }),
        save: jest.fn().mockResolvedValue({}),
      });
      await svc.updateModelMarketAvg(1, 'Intel Core i7-12700K', 160);
      const saved = (modelAvgRepo.save as jest.Mock).mock.calls[0][0];
      expect(parseFloat(saved.avg_price)).toBeCloseTo(120, 1);
      expect(saved.item_count).toBe(3);
    });
  });

  describe('computeMarketAvg', () => {
    it('uses model_market_avg when item_count >= 3', async () => {
      const { svc } = await buildService({
        findOneBy: jest.fn().mockResolvedValue({ avg_price: '200.00', item_count: 5 }),
      });
      const result = await svc.computeMarketAvg(1, 'Intel Core i7-12700K');
      expect(result.avg).toBeCloseTo(200, 1);
      expect(result.source).toBe('model');
      expect(result.itemCount).toBe(5);
    });

    it('falls back to keyword avg when item_count < 3', async () => {
      const { svc } = await buildService({
        findOneBy: jest.fn().mockResolvedValue({ avg_price: '200.00', item_count: 2 }),
      });
      const result = await svc.computeMarketAvg(1, 'Intel Core i7-12700K');
      expect(result.source).toBe('keyword');
    });

    it('falls back when model_label is null', async () => {
      const { svc } = await buildService({ findOneBy: jest.fn().mockResolvedValue(null) });
      const result = await svc.computeMarketAvg(1, null);
      expect(result.source).toBe('keyword');
    });
  });
});
