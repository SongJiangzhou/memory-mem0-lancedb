import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MemoryStoreTool } from '../../src/tools/store';
import { HotMemorySearch } from '../../src/hot/search';
import { openMemoryTable } from '../../src/db/table';

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
  embedding: { provider: "fake" as const, baseUrl: "", apiKey: "", model: "", dimension: 16 },
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
  embedding: { provider: "fake" as const, baseUrl: "", apiKey: "", model: "", dimension: 16 },
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

test('hot plane exact token query ranks exact substring hit first', async () => {
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
      embedding: { provider: 'fake' as const, baseUrl: '', apiKey: '', model: '', dimension: 16 },
    };
    const store = new MemoryStoreTool(cfg);
    const hot = new HotMemorySearch(cfg);

    await store.execute({
      text: 'Session note: previous mem0 local test used token mem0-local-e2e-20260308-1156-ZP4M',
      userId: 'user-1',
      scope: 'long-term',
      categories: ['token'],
    });
    await store.execute({
      text: 'Session summary: mem0 local test completed successfully with various follow-up checks',
      userId: 'user-1',
      scope: 'long-term',
      categories: ['summary'],
    });
    await store.execute({
      text: 'Context: discussed local mem0 integration and semantic retrieval tuning',
      userId: 'user-1',
      scope: 'long-term',
      categories: ['context'],
    });

    const result = await hot.search({
      query: 'mem0-local-e2e-20260308-1156-ZP4M',
      userId: 'user-1',
      topK: 5,
      filters: { scope: 'long-term' },
    });

    assert.ok(result.memories.length >= 1);
    assert.match(result.memories[0]?.text || '', /mem0-local-e2e-20260308-1156-ZP4M/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hot plane search deduplicates rows with identical text but different memory ids', async () => {
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
      embedding: { provider: 'fake' as const, baseUrl: '', apiKey: '', model: '', dimension: 16 },
    };
    const tbl = await openMemoryTable(dir, 16);
    await tbl.add([
      {
        memory_uid: 'dup-1',
        user_id: 'user-1',
        run_id: '',
        scope: 'long-term',
        text: 'User prefers Coke over Pepsi',
        categories: ['preference'],
        tags: [],
        memory_type: 'preference',
        domains: ['food'],
        source_kind: 'assistant_inferred',
        confidence: 0.9,
        ts_event: '2026-03-09T18:00:00.000Z',
        source: 'openclaw',
        status: 'active',
        sensitivity: 'internal',
        openclaw_refs: '{}',
        mem0_id: 'mem0-1',
        mem0_event_id: '',
        mem0_hash: 'hash-coke',
        lancedb_row_key: 'dup-1',
        vector: new Array(16).fill(0.2),
      },
      {
        memory_uid: 'dup-2',
        user_id: 'user-1',
        run_id: '',
        scope: 'long-term',
        text: 'User prefers Coke over Pepsi',
        categories: ['preference'],
        tags: [],
        memory_type: 'preference',
        domains: ['food'],
        source_kind: 'assistant_inferred',
        confidence: 0.8,
        ts_event: '2026-03-09T18:05:00.000Z',
        source: 'openclaw',
        status: 'active',
        sensitivity: 'internal',
        openclaw_refs: '{}',
        mem0_id: 'mem0-2',
        mem0_event_id: '',
        mem0_hash: 'hash-coke',
        lancedb_row_key: 'dup-2',
        vector: new Array(16).fill(0.2),
      },
    ]);
    const hot = new HotMemorySearch(cfg);

    const result = await hot.search({
      query: 'Which soda do I prefer?',
      userId: 'user-1',
      topK: 5,
      filters: { scope: 'long-term' },
    });

    const cokeHits = result.memories.filter((memory) => memory.text === 'User prefers Coke over Pepsi');
    assert.equal(cokeHits.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hot plane password-style question prefers the memory containing the exact token', async () => {
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
      embedding: { provider: 'fake' as const, baseUrl: '', apiKey: '', model: '', dimension: 16 },
    };
    const store = new MemoryStoreTool(cfg);
    const hot = new HotMemorySearch(cfg);

    await store.execute({
      text: 'The test passcode set during the local mem0 E2E run at 11:56 was mem0-local-e2e-20260308-1156-ZP4M.',
      userId: 'user-1',
      scope: 'long-term',
      categories: ['token'],
    });
    await store.execute({
      text: 'At 11:56, the local mem0 E2E run verified auto-capture and auto-recall, but did not record the final passcode.',
      userId: 'user-1',
      scope: 'long-term',
      categories: ['summary'],
    });
    await store.execute({
      text: 'Local mem0 E2E retrospective: the main issue was ranking and fusion strategy, not the write path.',
      userId: 'user-1',
      scope: 'long-term',
      categories: ['analysis'],
    });

    const result = await hot.search({
      query: 'What passcode was set during the local mem0 E2E run at 11:56?',
      userId: 'user-1',
      topK: 5,
      filters: { scope: 'long-term' },
    });

    assert.ok(result.memories.length >= 1);
    assert.match(result.memories[0]?.text || '', /mem0-local-e2e-20260308-1156-ZP4M/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hot plane ranking penalizes metadata and test-token noise for non-credential preference queries', () => {
  const cfg = {
    lancedbPath: '',
    mem0BaseUrl: '',
    mem0ApiKey: '',
    outboxDbPath: '',
    auditStorePath: '',
    autoRecall: { enabled: false, topK: 5, maxChars: 800, scope: 'all' as const },
    autoCapture: { enabled: false, scope: 'long-term' as const, requireAssistantReply: true, maxCharsPerMessage: 2000 },
    embedding: { provider: 'fake' as const, baseUrl: '', apiKey: '', model: '', dimension: 16 },
  };
  const hot = new HotMemorySearch(cfg as any);
  const now = new Date().toISOString();

  const ranked = (hot as any).applyRankingAdjustments(
    [
      {
        memory_uid: 'noise-metadata',
        text: "Client metadata payload: label 'generic-client', id 'generic-client', username 'generic-client'.",
        categories: ['metadata'],
        ts_event: now,
        __rrf_score: 1.2,
      },
      {
        memory_uid: 'noise-token',
        text: 'Integration test token for the local check is alpha-beta-gamma.',
        categories: ['token'],
        ts_event: now,
        __rrf_score: 1.1,
      },
      {
        memory_uid: 'user-preference',
        text: 'User likes strategy games and puzzle titles.',
        categories: ['preference', 'game'],
        ts_event: now,
        __rrf_score: 0.45,
      },
    ],
    'What kind of games do I like?',
  );

  assert.equal(ranked[0]?.memory_uid, 'user-preference');
  assert.equal(ranked.some((row: any) => row.memory_uid === 'noise-metadata'), false);
  assert.equal(ranked.some((row: any) => row.memory_uid === 'noise-token'), false);
});

test('hot plane preference intent reranking boosts preference memories for game-like queries', () => {
  const cfg = {
    lancedbPath: '',
    mem0BaseUrl: '',
    mem0ApiKey: '',
    outboxDbPath: '',
    auditStorePath: '',
    autoRecall: { enabled: false, topK: 5, maxChars: 800, scope: 'all' as const },
    autoCapture: { enabled: false, scope: 'long-term' as const, requireAssistantReply: true, maxCharsPerMessage: 2000 },
    embedding: { provider: 'fake' as const, baseUrl: '', apiKey: '', model: '', dimension: 16 },
  };
  const hot = new HotMemorySearch(cfg as any);
  const now = new Date().toISOString();

  const ranked = (hot as any).applyRankingAdjustments(
    [
      {
        memory_uid: 'profile-work',
        text: 'User works at a technology company and uses C++ and Python.',
        categories: ['profile', 'work'],
        ts_event: now,
        __rrf_score: 1.0,
      },
      {
        memory_uid: 'game-preference',
        text: 'User likes strategy games, including city-builders and turn-based tactics.',
        categories: ['preference', 'game'],
        ts_event: now,
        __rrf_score: 0.4,
      },
    ],
    'What kind of games do I like?',
  );

  assert.equal(ranked[0]?.memory_uid, 'game-preference');
});

test('hot plane ranking prefers concise preference memories over long summaries', () => {
  const cfg = {
    lancedbPath: '',
    mem0BaseUrl: '',
    mem0ApiKey: '',
    outboxDbPath: '',
    auditStorePath: '',
    autoRecall: { enabled: false, topK: 5, maxChars: 800, scope: 'all' as const },
    autoCapture: { enabled: false, scope: 'long-term' as const, requireAssistantReply: true, maxCharsPerMessage: 2000 },
    embedding: { provider: 'fake' as const, baseUrl: '', apiKey: '', model: '', dimension: 16 },
  };
  const hot = new HotMemorySearch(cfg as any);
  const now = new Date().toISOString();

  const ranked = (hot as any).applyRankingAdjustments(
    [
      {
        memory_uid: 'long-summary',
        text: 'The user talked at length about fast food preferences, comparing several restaurants, discussing texture, sauce balance, and meal combinations before eventually mentioning that McDonald\'s grilled chicken leg burger was one item among several possibilities.',
        categories: ['preference', 'food'],
        memory_type: 'preference',
        source_kind: 'assistant_inferred',
        confidence: 0.75,
        ts_event: now,
        __rrf_score: 0.9,
      },
      {
        memory_uid: 'concise-preference',
        text: 'User likes McDonald\'s grilled chicken leg burger.',
        categories: ['preference', 'food'],
        memory_type: 'preference',
        source_kind: 'user_explicit',
        confidence: 0.95,
        ts_event: now,
        __rrf_score: 0.8,
      },
    ],
    'What do I like to eat at McDonald\'s?',
  );

  assert.equal(ranked[0]?.memory_uid, 'concise-preference');
});

test('hot plane ranking prefers higher-confidence explicit memories over inferred ones', () => {
  const cfg = {
    lancedbPath: '',
    mem0BaseUrl: '',
    mem0ApiKey: '',
    outboxDbPath: '',
    auditStorePath: '',
    autoRecall: { enabled: false, topK: 5, maxChars: 800, scope: 'all' as const },
    autoCapture: { enabled: false, scope: 'long-term' as const, requireAssistantReply: true, maxCharsPerMessage: 2000 },
    embedding: { provider: 'fake' as const, baseUrl: '', apiKey: '', model: '', dimension: 16 },
  };
  const hot = new HotMemorySearch(cfg as any);
  const now = new Date().toISOString();

  const ranked = (hot as any).applyRankingAdjustments(
    [
      {
        memory_uid: 'assistant-inferred',
        text: 'User likes McDonald\'s grilled chicken leg burger.',
        categories: ['preference', 'food'],
        memory_type: 'preference',
        source_kind: 'assistant_inferred',
        confidence: 0.6,
        ts_event: now,
        __rrf_score: 0.8,
      },
      {
        memory_uid: 'user-explicit',
        text: 'User likes McDonald\'s grilled chicken leg burger.',
        categories: ['preference', 'food'],
        memory_type: 'preference',
        source_kind: 'user_explicit',
        confidence: 0.95,
        ts_event: now,
        __rrf_score: 0.8,
      },
    ],
    'What do I like to eat at McDonald\'s?',
  );

  assert.equal(ranked[0]?.memory_uid, 'user-explicit');
});
