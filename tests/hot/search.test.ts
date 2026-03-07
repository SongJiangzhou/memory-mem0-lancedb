import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MemoryStoreTool } from '../../src/tools/store';
import { HotMemorySearch } from '../../src/hot/search';

test('hot plane search returns canonical memory rows with filters', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hot-search-'));

  try {
    const cfg = {
      lancedbPath: dir,
      mem0BaseUrl: '',
      mem0ApiKey: '',
      outboxDbPath: join(dir, 'outbox.json'),
      auditStorePath: join(dir, 'audit', 'memory_records.jsonl'),
      autoRecall: { enabled: false, topK: 5, maxChars: 800, scope: 'all' as const },
      autoCapture: { enabled: false, scope: 'long-term' as const, requireAssistantReply: true, maxCharsPerMessage: 2000 },
    };
    const store = new MemoryStoreTool(cfg);
    const hot = new HotMemorySearch(cfg);

    await store.execute({
      text: 'User preference: reply in English',
      userId: 'user-1',
      scope: 'long-term',
      categories: ['preference'],
    });
    await store.execute({
      text: 'User wants all answers explained in English',
      userId: 'user-1',
      scope: 'long-term',
      categories: ['preference'],
    });

    const result = await hot.search({
      query: 'English',
      userId: 'user-1',
      topK: 5,
      filters: { scope: 'long-term' },
    });

    assert.equal(result.source, 'lancedb');
    assert.ok(result.memories.length >= 2);
    assert.equal(result.memories[0]?.user_id, 'user-1');
    assert.equal(result.memories[0]?.scope, 'long-term');
    assert.match(result.memories.map((row) => row.text).join('\n'), /reply in English/);
    assert.match(result.memories.map((row) => row.text).join('\n'), /explained in English/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hot plane hybrid search includes vector-only candidates through explicit fusion', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hot-search-'));

  try {
    const cfg = {
      lancedbPath: dir,
      mem0BaseUrl: '',
      mem0ApiKey: '',
      outboxDbPath: join(dir, 'outbox.json'),
      auditStorePath: join(dir, 'audit', 'memory_records.jsonl'),
      autoRecall: { enabled: false, topK: 5, maxChars: 800, scope: 'all' as const },
      autoCapture: { enabled: false, scope: 'long-term' as const, requireAssistantReply: true, maxCharsPerMessage: 2000 },
    };
    const store = new MemoryStoreTool(cfg);
    const hot = new HotMemorySearch(cfg);

    await store.execute({
      text: 'apple apple apple',
      userId: 'user-1',
      scope: 'long-term',
      categories: ['keyword'],
    });
    await store.execute({
      text: 'banana banana banana',
      userId: 'user-1',
      scope: 'long-term',
      categories: ['vector'],
    });

    const result = await hot.search({
      query: 'apple',
      userId: 'user-1',
      topK: 5,
      filters: { scope: 'long-term' },
    });

    assert.ok(result.memories.length >= 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
