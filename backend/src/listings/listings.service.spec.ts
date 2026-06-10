import { ListingsService } from './listings.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Listing } from './listing.entity';
import { KeywordListing } from './keyword-listing.entity';
import { PriceHistory } from './price-history.entity';
import { ModelMarketAvg } from '../analysis/model-market-avg.entity';
import { DealAnalysis } from '../analysis/deal-analysis.entity';
import { DataSource } from 'typeorm';

function makeQueryBuilder(getRawMany: jest.Mock) {
  return {
    innerJoin: jest.fn().mockReturnThis(), innerJoinAndSelect: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(), addOrderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawMany,
    getMany: jest.fn().mockResolvedValue([]),
  };
}

function mockRepo<T>(overrides: Partial<any> = {}): T {
  return {
    findOneBy: jest.fn(), save: jest.fn(), upsert: jest.fn(), update: jest.fn(),
    find: jest.fn(), count: jest.fn(), create: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder(jest.fn().mockResolvedValue([]))),
    ...overrides,
  } as unknown as T;
}

const prices = (...values: number[]) => values.map(v => ({ price: String(v) }));

async function buildService(getRawMany: jest.Mock = jest.fn().mockResolvedValue([])) {
  const listingRepo = mockRepo<any>({
    createQueryBuilder: jest.fn(() => makeQueryBuilder(getRawMany)),
  });
  const modelAvgRepo = mockRepo<any>();
  const module = await Test.createTestingModule({
    providers: [
      ListingsService,
      { provide: getRepositoryToken(Listing), useValue: listingRepo },
      { provide: getRepositoryToken(KeywordListing), useValue: mockRepo() },
      { provide: getRepositoryToken(PriceHistory), useValue: mockRepo() },
      { provide: getRepositoryToken(ModelMarketAvg), useValue: modelAvgRepo },
      { provide: getRepositoryToken(DealAnalysis), useValue: mockRepo() },
      { provide: DataSource, useValue: { query: jest.fn() } },
    ],
  }).compile();
  return { svc: module.get(ListingsService), modelAvgRepo, listingRepo };
}

describe('ListingsService', () => {
  describe('computeMarketAvg', () => {
    it('uses model median when at least 3 comparable items exist', async () => {
      const getRawMany = jest.fn().mockResolvedValueOnce(prices(10, 20, 90));
      const { svc } = await buildService(getRawMany);
      const result = await svc.computeMarketAvg(1, 'SK Hynix 8GB DDR4-3200');
      expect(result.source).toBe('model');
      expect(result.avg).toBeCloseTo(20, 1); // médiane, pas moyenne
      expect(result.itemCount).toBe(3);
    });

    it('computes median of an even-sized list', async () => {
      const getRawMany = jest.fn().mockResolvedValueOnce(prices(10, 20, 30, 40));
      const { svc } = await buildService(getRawMany);
      const result = await svc.computeMarketAvg(1, 'Samsung 8GB DDR4');
      expect(result.avg).toBeCloseTo(25, 1);
    });

    it('falls back to keyword median when model has fewer than 3 items', async () => {
      const getRawMany = jest.fn()
        .mockResolvedValueOnce(prices(15, 18)) // model: 2 items seulement
        .mockResolvedValueOnce(prices(10, 15, 20, 25, 30)); // keyword
      const { svc } = await buildService(getRawMany);
      const result = await svc.computeMarketAvg(1, 'Crucial 8GB DDR4');
      expect(result.source).toBe('keyword');
      expect(result.avg).toBeCloseTo(20, 1);
    });

    it('falls back to keyword median when model_label is null', async () => {
      const getRawMany = jest.fn().mockResolvedValueOnce(prices(10, 15, 20, 25, 30));
      const { svc } = await buildService(getRawMany);
      const result = await svc.computeMarketAvg(1, null);
      expect(result.source).toBe('keyword');
      expect(result.avg).toBeCloseTo(20, 1);
    });

    it('returns null avg when keyword has fewer than 5 items', async () => {
      const getRawMany = jest.fn().mockResolvedValueOnce(prices(10, 20));
      const { svc } = await buildService(getRawMany);
      const result = await svc.computeMarketAvg(1, null);
      expect(result.avg).toBeNull();
      expect(result.itemCount).toBe(2);
    });

    it('excludes the scored listing from its own market average', async () => {
      const getRawMany = jest.fn().mockResolvedValueOnce(prices(10, 15, 20, 25, 30));
      const { svc, listingRepo } = await buildService(getRawMany);
      await svc.computeMarketAvg(1, null, 42);
      const qb = (listingRepo.createQueryBuilder as jest.Mock).mock.results[0].value;
      expect(qb.andWhere).toHaveBeenCalledWith('l.id != :ex', { ex: 42 });
    });
  });

  describe('updateModelMarketAvg', () => {
    it('recomputes the median from listings and caches it', async () => {
      const getRawMany = jest.fn().mockResolvedValueOnce(prices(10, 20, 90));
      const { svc, modelAvgRepo } = await buildService(getRawMany);
      await svc.updateModelMarketAvg(1, 'SK Hynix 8GB DDR4-3200');
      expect(modelAvgRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ keyword_id: 1, model_label: 'SK Hynix 8GB DDR4-3200', avg_price: 20, item_count: 3 }),
      );
    });

    it('saves nothing when no priced listing exists for the model', async () => {
      const { svc, modelAvgRepo } = await buildService();
      await svc.updateModelMarketAvg(1, 'Modèle inconnu');
      expect(modelAvgRepo.save).not.toHaveBeenCalled();
    });
  });
});
