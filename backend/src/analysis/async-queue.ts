export interface QueueStats {
  pending: number;
  running: number;
  completed: number;
  errors: number;
  callsPerMinute: number;
}

export class AsyncQueue<T> {
  private queue: Array<{ item: T; resolve: () => void; reject: (e: Error) => void }> = [];
  private running = 0;
  private completed = 0;
  private errors = 0;
  private callTimestamps: number[] = [];

  constructor(
    private readonly handler: (item: T) => Promise<void>,
    private readonly concurrency: number = 1,
    private readonly ratePerSecond: number = 5,
  ) {}

  push(item: T): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ item, resolve, reject });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running >= this.concurrency || this.queue.length === 0) return;

    const now = Date.now();
    this.callTimestamps = this.callTimestamps.filter(t => now - t < 1000);
    if (this.callTimestamps.length >= this.ratePerSecond) {
      const waitMs = 1000 - (now - this.callTimestamps[0]) + 1;
      setTimeout(() => void this.drain(), waitMs);
      return;
    }

    const next = this.queue.shift();
    if (!next) return;

    this.running++;
    this.callTimestamps.push(Date.now());

    try {
      await this.handler(next.item);
      this.completed++;
      next.resolve();
    } catch (e: any) {
      this.errors++;
      next.reject(e);
    } finally {
      this.running--;
      void this.drain();
    }
  }

  getStats(): QueueStats {
    const now = Date.now();
    const callsPerMinute = this.callTimestamps.filter(t => now - t < 60_000).length;
    return {
      pending: this.queue.length,
      running: this.running,
      completed: this.completed,
      errors: this.errors,
      callsPerMinute,
    };
  }
}
