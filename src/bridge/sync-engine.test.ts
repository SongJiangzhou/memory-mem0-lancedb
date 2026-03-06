import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FileOutbox } from './outbox';
import { InMemoryMemoryAdapter } from './adapter';
import { MemorySyncEngine } from './sync-engine';

function createMemory() {
  return {
    user_id: 'railgun',
    scope: 'long-term' as const,
    text: '用户偏好：回复必须使用中文',
    categories: ['preference'],
    tags: ['lang'],
    ts_event: '2026-03-07T10:15:00.000Z',
    source: 'openclaw' as const,
    status: 'active' as const,
    sensitivity: 'internal' as const,
    openclaw_refs: { file_path: 'MEMORY.md' },
  };
}

test('sync engine stores memory and marks outbox item done', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-engine-'));

  try {
    const adapter = new InMemoryMemoryAdapter();
    const outbox = new FileOutbox(join(dir, 'outbox.json'));
    const engine = new MemorySyncEngine(outbox, adapter);

    const result = await engine.processEvent('evt-1', createMemory());

    assert.equal(result.status, 'done');
    assert.ok(result.memory_uid);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sync engine returns duplicate when the same event is replayed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-engine-'));

  try {
    const adapter = new InMemoryMemoryAdapter();
    const outbox = new FileOutbox(join(dir, 'outbox.json'));
    const engine = new MemorySyncEngine(outbox, adapter);
    const memory = createMemory();

    const first = await engine.processEvent('evt-dup', memory);
    const second = await engine.processEvent('evt-dup', memory);

    assert.equal(first.status, 'done');
    assert.equal(second.status, 'duplicate');
    assert.equal(first.memory_uid, second.memory_uid);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sync engine marks failed when adapter write is not visible', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-engine-'));

  try {
    const adapter = new InMemoryMemoryAdapter({ visible: false });
    const outbox = new FileOutbox(join(dir, 'outbox.json'));
    const engine = new MemorySyncEngine(outbox, adapter);

    const result = await engine.processEvent('evt-fail', createMemory());

    assert.equal(result.status, 'failed_visibility');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
