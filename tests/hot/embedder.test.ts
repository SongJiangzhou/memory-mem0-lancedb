import assert from 'node:assert/strict';
import test from 'node:test';

import { FAKE_EMBEDDING_DIM, embedText } from '../../src/hot/embedder';

test('embedText is stable for identical input', async () => {
  const first = await embedText('User preference: English replies');
  const second = await embedText('User preference: English replies');

  assert.deepEqual(first, second);
});

test('embedText returns fixed-dimension vectors', async () => {
  const vector = await embedText('User preference: English replies');

  assert.equal(vector.length, FAKE_EMBEDDING_DIM);
});

test('embedText does not collapse all inputs to the same vector', async () => {
  const first = await embedText('User preference: English replies');
  const second = await embedText('User likes sci-fi movies');

  assert.notDeepEqual(first, second);
});

test('embedText throws for unknown provider', async () => {
  const cfg = {
    provider: 'unknown' as any,
    baseUrl: '',
    apiKey: '',
    model: '',
    dimension: 16,
  };

  await assert.rejects(
    () => embedText('hello', cfg),
    /Unknown embedding provider/,
  );
});

test('embedText throws for ollama with empty baseUrl', async () => {
  const cfg = {
    provider: 'ollama' as const,
    baseUrl: '',
    apiKey: '',
    model: '',
    dimension: 768,
  };

  await assert.rejects(
    () => embedText('hello', cfg),
    /ollama provider requires a non-empty baseUrl/,
  );
});
