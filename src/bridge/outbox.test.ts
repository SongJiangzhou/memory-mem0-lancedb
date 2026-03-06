import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FileOutbox } from './outbox';

test('outbox enqueues once for duplicate idempotency key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'outbox-'));

  try {
    const outbox = new FileOutbox(join(dir, 'outbox.json'));

    const first = await outbox.enqueue('dup-key', '{"x":1}');
    const second = await outbox.enqueue('dup-key', '{"x":1}');

    assert.equal(first, true);
    assert.equal(second, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('outbox claims pending items in insertion order', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'outbox-'));

  try {
    const outbox = new FileOutbox(join(dir, 'outbox.json'));
    await outbox.enqueue('k1', '{"i":1}');
    await outbox.enqueue('k2', '{"i":2}');

    const first = await outbox.claimNext();
    const second = await outbox.claimNext();

    assert.equal(first?.idempotencyKey, 'k1');
    assert.equal(first?.status, 'processing');
    assert.equal(second?.idempotencyKey, 'k2');
    assert.equal(second?.status, 'processing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('outbox transitions claimed items to done and failed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'outbox-'));

  try {
    const outbox = new FileOutbox(join(dir, 'outbox.json'));
    await outbox.enqueue('k1', '{"i":1}');
    await outbox.enqueue('k2', '{"i":2}');

    const first = await outbox.claimNext();
    const second = await outbox.claimNext();

    assert.ok(first);
    assert.ok(second);

    await outbox.markDone(first.id);
    await outbox.markFailed(second.id);

    assert.equal(await outbox.getStatus(first.id), 'done');
    assert.equal(await outbox.getStatus(second.id), 'failed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
