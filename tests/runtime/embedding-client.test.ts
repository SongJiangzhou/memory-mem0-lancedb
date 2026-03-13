import assert from 'node:assert/strict';
import test from 'node:test';

import type { EmbeddingConfig } from '../../src/types';
import { EmbeddingClient } from '../../src/runtime/embedding-client';

const CFG: EmbeddingConfig = {
  provider: 'voyage',
  baseUrl: 'https://api.voyageai.com/v1',
  apiKey: 'test-key',
  model: 'voyage-3.5-lite',
  dimension: 3,
};

test('embedding client coalesces identical concurrent embed requests', async () => {
  let calls = 0;
  let resolveCall: ((value: number[]) => void) | null = null;
  const client = new EmbeddingClient({
    ttlMs: 1_000,
    now: () => 0,
    execute: async () => {
      calls += 1;
      return await new Promise<number[]>((resolve) => {
        resolveCall = resolve;
      });
    },
  });

  const first = client.embed('same text', CFG);
  const second = client.embed('same text', CFG);

  await Promise.resolve();
  assert.equal(calls, 1);
  if (!resolveCall) {
    throw new Error('executor did not expose a resolver');
  }
  const release: (value: number[]) => void = resolveCall;
  release([0.1, 0.2, 0.3]);

  assert.deepEqual(await first, [0.1, 0.2, 0.3]);
  assert.deepEqual(await second, [0.1, 0.2, 0.3]);
  assert.equal(calls, 1);
});

test('embedding client returns cached embeddings within ttl', async () => {
  let calls = 0;
  let now = 100;
  const client = new EmbeddingClient({
    ttlMs: 1_000,
    now: () => now,
    execute: async () => {
      calls += 1;
      return [0.4, 0.5, 0.6];
    },
  });

  const first = await client.embed('cache me', CFG);
  now += 500;
  const second = await client.embed('cache me', CFG);

  assert.deepEqual(first, [0.4, 0.5, 0.6]);
  assert.deepEqual(second, [0.4, 0.5, 0.6]);
  assert.equal(calls, 1);
});

test('embedding client embedMany preserves input ordering', async () => {
  const client = new EmbeddingClient({
    ttlMs: 1_000,
    now: () => 0,
    execute: async (text: string) => {
      if (text === 'first') {
        return [1, 0, 0];
      }
      if (text === 'second') {
        return [0, 1, 0];
      }
      return [0, 0, 1];
    },
  });

  const vectors = await client.embedMany(['first', 'second', 'third'], CFG);

  assert.deepEqual(vectors, [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]);
});

test('embedding client limits concurrent provider calls', async () => {
  let active = 0;
  let maxActive = 0;
  const resolvers: Array<() => void> = [];
  const client = new EmbeddingClient({
    ttlMs: 0,
    now: () => 0,
    maxConcurrent: 1,
    execute: async (text: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
      active -= 1;
      return text === 'first' ? [1, 0, 0] : [0, 1, 0];
    },
  });

  const first = client.embed('first', CFG);
  const second = client.embed('second', CFG);

  await Promise.resolve();
  assert.equal(maxActive, 1);
  assert.equal(resolvers.length, 1);
  resolvers.shift()?.();
  await first;
  assert.equal(resolvers.length, 1);
  resolvers.shift()?.();
  await second;
  assert.equal(maxActive, 1);
});

test('embedding client retries 429 failures with backoff', async () => {
  let calls = 0;
  const delays: number[] = [];
  const client = new EmbeddingClient({
    ttlMs: 0,
    now: () => 0,
    sleep: async (delayMs: number) => {
      delays.push(delayMs);
    },
    maxRetries: 2,
    baseBackoffMs: 100,
    execute: async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('Voyage embedding request failed with status 429');
      }
      return [0.7, 0.8, 0.9];
    },
  });

  const value = await client.embed('retry me', CFG);

  assert.deepEqual(value, [0.7, 0.8, 0.9]);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [100]);
});
