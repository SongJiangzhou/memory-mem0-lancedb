import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileAuditStore } from '../../src/audit/store';
import { InMemoryMemoryAdapter } from '../../src/bridge/adapter';
import { MemoryPromotionWorker } from '../../src/hot/promotion-worker';

test('promotion worker copies eligible session memory into long-term scope', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'promotion-worker-eligible-'));
  try {
    const auditStore = new FileAuditStore(join(dir, 'audit.jsonl'));
    const adapter = new InMemoryMemoryAdapter();
    const worker = new MemoryPromotionWorker({
      auditStore,
      adapter,
      intervalMs: 60_000,
      batchSize: 10,
    });

    await auditStore.append({
      memory_uid: 'session-1',
      user_id: 'default',
      session_id: 'session-a',
      agent_id: 'main',
      run_id: null,
      scope: 'session',
      text: 'Prefers sparkling water over soda.',
      categories: ['preference'],
      tags: [],
      memory_type: 'preference',
      domains: ['food'],
      source_kind: 'user_explicit',
      confidence: 0.9,
      ts_event: '2026-03-12T00:00:00.000Z',
      source: 'openclaw',
      status: 'active',
      lifecycle_state: 'reinforced',
      strength: 0.8,
      stability: 2,
      last_access_ts: '2026-03-12T01:00:00.000Z',
      next_review_ts: '2026-03-13T00:00:00.000Z',
      access_count: 3,
      inhibition_weight: 0,
      inhibition_until: '',
      utility_score: 0.8,
      risk_score: 0.2,
      retention_deadline: '2026-03-19T00:00:00.000Z',
      sensitivity: 'internal',
      openclaw_refs: {},
      mem0: {},
    });

    const result = await worker.runOnce('2026-03-12T02:00:00.000Z');

    assert.equal(result.promoted, 1);

    const rows = await auditStore.readAll();
    const promoted = rows.find((row) => row.scope === 'long-term' && row.text === 'Prefers sparkling water over soda.');
    assert.ok(promoted);
    assert.equal(promoted?.user_id, 'default');
    assert.equal(promoted?.session_id || '', '');
    assert.equal(promoted?.agent_id || '', '');
    assert.equal(promoted?.status, 'active');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('promotion worker skips ineligible session memory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'promotion-worker-skip-'));
  try {
    const auditStore = new FileAuditStore(join(dir, 'audit.jsonl'));
    const adapter = new InMemoryMemoryAdapter();
    const worker = new MemoryPromotionWorker({
      auditStore,
      adapter,
      intervalMs: 60_000,
      batchSize: 10,
    });

    await auditStore.append({
      memory_uid: 'session-low-value',
      user_id: 'default',
      session_id: 'session-a',
      agent_id: 'main',
      run_id: null,
      scope: 'session',
      text: 'Temporary script path note.',
      categories: ['generic'],
      tags: [],
      memory_type: 'task_context',
      domains: ['tooling'],
      source_kind: 'system_generated',
      confidence: 0.5,
      ts_event: '2026-03-12T00:00:00.000Z',
      source: 'openclaw',
      status: 'active',
      lifecycle_state: 'active',
      strength: 0.4,
      stability: 1,
      last_access_ts: '2026-03-12T00:00:00.000Z',
      next_review_ts: '2026-03-13T00:00:00.000Z',
      access_count: 1,
      inhibition_weight: 0,
      inhibition_until: '',
      utility_score: 0.3,
      risk_score: 0.2,
      retention_deadline: '2026-03-19T00:00:00.000Z',
      sensitivity: 'internal',
      openclaw_refs: {},
      mem0: {},
    });

    const result = await worker.runOnce('2026-03-12T02:00:00.000Z');

    assert.equal(result.promoted, 0);

    const rows = await auditStore.readAll();
    assert.equal(rows.filter((row) => row.scope === 'long-term').length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
