import type { EmbeddingConfig } from '../types';

type EmbeddingExecutor = (text: string, cfg: EmbeddingConfig) => Promise<number[]>;
type SleepFn = (delayMs: number) => Promise<void>;

type EmbeddingClientOptions = {
  ttlMs: number;
  now?: () => number;
  maxConcurrent?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  sleep?: SleepFn;
  execute: EmbeddingExecutor;
};

type CacheEntry = {
  value: number[];
  expiresAt: number;
};

export class EmbeddingClient {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly maxConcurrent: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly sleep: SleepFn;
  private readonly execute: EmbeddingExecutor;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<number[]>>();
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(options: EmbeddingClientOptions) {
    this.ttlMs = options.ttlMs;
    this.now = options.now || Date.now;
    this.maxConcurrent = options.maxConcurrent ?? Number.POSITIVE_INFINITY;
    this.maxRetries = options.maxRetries ?? 0;
    this.baseBackoffMs = options.baseBackoffMs ?? 1_000;
    this.sleep = options.sleep || defaultSleep;
    this.execute = options.execute;
  }

  async embed(text: string, cfg: EmbeddingConfig): Promise<number[]> {
    const key = buildEmbeddingKey(text, cfg);
    const cached = this.cache.get(key);
    const now = this.now();

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    const request = this.runWithRetry(text, cfg)
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

  async embedMany(texts: string[], cfg: EmbeddingConfig): Promise<number[][]> {
    const values: number[][] = [];
    for (const text of texts) {
      values.push(await this.embed(text, cfg));
    }
    return values;
  }

  private async runWithRetry(text: string, cfg: EmbeddingConfig): Promise<number[]> {
    let attempt = 0;
    while (true) {
      await this.acquire();
      try {
        return await this.execute(text, cfg);
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

function buildEmbeddingKey(text: string, cfg: EmbeddingConfig): string {
  return [
    cfg.provider,
    cfg.baseUrl || '',
    cfg.model || '',
    String(cfg.dimension || ''),
    String(text || '').trim(),
  ].join('::');
}

function isRetryableRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b/.test(message) || /rate.?limit/i.test(message);
}

async function defaultSleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
