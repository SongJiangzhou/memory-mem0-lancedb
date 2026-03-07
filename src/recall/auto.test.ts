import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAutoRecallBlock, runAutoRecall } from './auto';
import type { AutoRecallConfig, MemoryRecord } from '../types';

function buildMemory(text: string, scope: 'long-term' | 'session' = 'long-term'): MemoryRecord {
  return {
    memory_uid: `m-${text}`,
    user_id: 'user-1',
    run_id: null,
    scope,
    text,
    categories: ['preference'],
    tags: [],
    ts_event: '2026-03-07T12:00:00.000Z',
    source: 'openclaw',
    status: 'active',
    sensitivity: 'internal',
    openclaw_refs: { file_path: 'MEMORY.md' },
    mem0: {},
    lancedb: {},
  };
}

function buildConfig(overrides?: Partial<AutoRecallConfig>): AutoRecallConfig {
  return {
    enabled: true,
    topK: 2,
    maxChars: 200,
    scope: 'all',
    ...overrides,
  };
}

test('buildAutoRecallBlock formats stable relevant_memories block', () => {
  const block = buildAutoRecallBlock(
    [buildMemory('User preference: reply in English'), buildMemory('User likes sci-fi movies')],
    buildConfig(),
  );

  assert.match(block, /<relevant_memories>/);
  assert.match(block, /reply in English/);
  assert.match(block, /User likes sci-fi movies/);
  assert.match(block, /<\/relevant_memories>/);
});

test('runAutoRecall applies topK and maxChars constraints', async () => {
  const result = await runAutoRecall({
    query: 'English',
    userId: 'user-1',
    config: buildConfig({ topK: 1, maxChars: 60 }),
    search: async () => ({
      memories: [
        buildMemory('User preference: reply in English'),
        buildMemory('User likes sci-fi movies'),
      ],
      source: 'lancedb',
    }),
  });

  assert.ok(result);
  assert.match(result || '', /User preference/);
  assert.doesNotMatch(result || '', /User likes sci-fi movies/);
  assert.ok((result || '').length <= 60);
});

test('runAutoRecall returns empty string when search result is empty', async () => {
  const result = await runAutoRecall({
    query: 'English',
    userId: 'user-1',
    config: buildConfig(),
    search: async () => ({ memories: [], source: 'none' }),
  });

  assert.equal(result, '');
});
