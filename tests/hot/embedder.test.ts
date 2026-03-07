import assert from 'node:assert/strict';
import test from 'node:test';

import { EMBEDDING_DIM, embedText } from '../../src/hot/embedder';

test('embedText is stable for identical input', () => {
  const first = embedText('User preference: English replies');
  const second = embedText('User preference: English replies');

  assert.deepEqual(first, second);
});

test('embedText returns fixed-dimension vectors', () => {
  const vector = embedText('User preference: English replies');

  assert.equal(vector.length, EMBEDDING_DIM);
});

test('embedText does not collapse all inputs to the same vector', () => {
  const first = embedText('User preference: English replies');
  const second = embedText('User likes sci-fi movies');

  assert.notDeepEqual(first, second);
});
