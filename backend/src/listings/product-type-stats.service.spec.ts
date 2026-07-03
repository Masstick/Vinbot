import { ProductTypeStatsService } from './product-type-stats.service';

describe('ProductTypeStatsService', () => {
  it('recompute lit les prix du groupe, calcule la moyenne tronquée et upsert product_type_stats', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ price: '20.00' }, { price: '22.00' }, { price: '18.00' }]) // SELECT prices
      .mockResolvedValueOnce([]); // INSERT ... ON CONFLICT
    const svc = new ProductTypeStatsService({ query } as any);

    const result = await svc.recompute(7, 'RAM DDR4 8GB');

    expect(result.itemCount).toBe(3);
    expect(result.avgPrice).toBeCloseTo(20);
    expect(query.mock.calls[0][0]).toContain('FROM listings l');
    expect(query.mock.calls[0][1]).toEqual([7, 'RAM DDR4 8GB']);
    expect(query.mock.calls[1][0]).toContain('ON CONFLICT (keyword_id, product_type_key)');
    expect(query.mock.calls[1][1]).toEqual([7, 'RAM DDR4 8GB', result.avgPrice, 3]);
  });
});
