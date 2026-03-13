import type { RecallRerankerConfig } from '../types';

type RerankExecutor = (query: string, documents: string[], cfg: RecallRerankerConfig) => Promise<number[]>;
type SleepFn = (delayMs: number) => Promise<void>;

type RerankClientOptions = {
  ttlMs: number;
  now?: () => number;
  maxConcurrent?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  sleep?: SleepFn;
  execute: RerankExecutor;
};

type CacheEntry = {
  value: number[];
  expiresAt: number;
};

export class RerankClient {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly maxConcurrent: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly sleep: SleepFn;
  private readonly execute: RerankExecutor;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<number[]>>();
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(options: RerankClientOptions) {
    this.ttlMs = options.ttlMs;
    this.now = options.now || Date.now;
    this.maxConcurrent = options.maxConcurrent ?? Number.POSITIVE_INFINITY;
    this.maxRetries = options.maxRetries ?? 0;
    this.baseBackoffMs = options.baseBackoffMs ?? 1_000;
    this.sleep = options.sleep || defaultSleep;
    this.execute = options.execute;
  }

  async rerank(query: string, documents: string[], cfg: RecallRerankerConfig): Promise<number[]> {
    const key = buildRerankKey(query, documents, cfg);
    const cached = this.cache.get(key);
    const now = this.now();

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    const request = this.runWithRetry(query, documents, cfg)
      .then((value) => {
        if (this.ttlMs > 0) {
          this.cache.set(key, {
            value,
            expiresAt: this.now() + this.ttlMs,
          });
        }
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, request);
    return request;
  }

  private async runWithRetry(query: string, documents: string[], cfg: RecallRerankerConfig): Promise<number[]> {
    let attempt = 0;
    while (true) {
      await this.acquire();
      try {
        return await this.execute(query, documents, cfg);
      } catch (error) {
        if (!isRetryableRateLimitError(error) || attempt >= this.maxRetries) {
          throw error;
        }
        const delayMs = this.baseBackoffMs * (2 ** attempt);
        attempt += 1;
        await this.sleep(delayMs);
      } finally {
        this.release();
      }
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active = Math.max(this.active - 1, 0);
    const next = this.waiters.shift();
    next?.();
  }
}

function buildRerankKey(query: string, documents: string[], cfg: RecallRerankerConfig): string {
  return [
    cfg.provider,
    cfg.baseUrl || '',
    cfg.model || '',
    String(query || '').trim(),
    ...documents.map((value) => String(value || '').trim()),
  ].join('::');
}

function isRetryableRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b/.test(message) || /rate.?limit/i.test(message);
}

async function defaultSleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
