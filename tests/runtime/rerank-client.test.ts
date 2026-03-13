import assert from 'node:assert/strict';
import test from 'node:test';

import type { RecallRerankerConfig } from '../../src/types';
import { RerankClient } from '../../src/runtime/rerank-client';

const CFG: RecallRerankerConfig = {
  provider: 'voyage',
  baseUrl: 'https://api.voyageai.com/v1',
  apiKey: 'test-key',
  model: 'rerank-2.5-lite',
};

test('rerank client coalesces identical concurrent requests', async () => {
  let calls = 0;
  let resolveCall: ((value: number[]) => void) | null = null;
  const client = new RerankClient({
    ttlMs: 1_000,
    now: () => 0,
    execute: async () => {
      calls += 1;
      return await new Promise<number[]>((resolve) => {
        resolveCall = resolve;
      });
    },
  });

  const first = client.rerank('drink query', ['tea', 'coffee'], CFG);
  const second = client.rerank('drink query', ['tea', 'coffee'], CFG);

  await Promise.resolve();
  assert.equal(calls, 1);
  if (!resolveCall) {
    throw new Error('executor did not expose a resolver');
  }
  const release: (value: number[]) => void = resolveCall;
  release([1, 0]);

  assert.deepEqual(await first, [1, 0]);
  assert.deepEqual(await second, [1, 0]);
});

test('rerank client returns cached results within ttl', async () => {
  let calls = 0;
  let now = 100;
  const client = new RerankClient({
    ttlMs: 1_000,
    now: () => now,
    execute: async () => {
      calls += 1;
      return [0, 1];
    },
  });

  const first = await client.rerank('food query', ['burger', 'salad'], CFG);
  now += 500;
  const second = await client.rerank('food query', ['burger', 'salad'], CFG);

  assert.deepEqual(first, [0, 1]);
  assert.deepEqual(second, [0, 1]);
  assert.equal(calls, 1);
});

test('rerank client retries 429 failures with backoff', async () => {
  let calls = 0;
  const delays: number[] = [];
  const client = new RerankClient({
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
        throw new Error('Voyage rerank request failed with status 429');
      }
      return [1, 0];
    },
  });

  const value = await client.rerank('drink query', ['tea', 'coffee'], CFG);

  assert.deepEqual(value, [1, 0]);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [100]);
});
