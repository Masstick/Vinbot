import { AsyncQueue } from './async-queue';

describe('AsyncQueue', () => {
  it('processes all items', async () => {
    const results: number[] = [];
    const q = new AsyncQueue<number>(async (n) => { results.push(n); }, 2, 100);
    await Promise.all([q.push(1), q.push(2), q.push(3)]);
    expect(results.sort()).toEqual([1, 2, 3]);
  });

  it('respects concurrency limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const q = new AsyncQueue<number>(async (_n) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(r => setTimeout(r, 20));
      concurrent--;
    }, 2, 100);
    await Promise.all([q.push(1), q.push(2), q.push(3), q.push(4)]);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('getStats returns correct counts', async () => {
    const q = new AsyncQueue<number>(async (_n) => {}, 1, 100);
    await q.push(1);
    await q.push(2);
    const stats = q.getStats();
    expect(stats.completed).toBe(2);
    expect(stats.pending).toBe(0);
    expect(stats.errors).toBe(0);
  });

  it('counts errors without throwing', async () => {
    const q = new AsyncQueue<number>(async (_n) => { throw new Error('fail'); }, 1, 100);
    await expect(q.push(1)).rejects.toThrow('fail');
    expect(q.getStats().errors).toBe(1);
  });
});
