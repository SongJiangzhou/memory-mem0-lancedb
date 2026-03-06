import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStoreTool } from './store';
import { openMemoryTable } from '../db/table';

test('store writes to LanceDB and is idempotent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ldb-store-'));
  try {
    const outboxDbPath = join(dir, 'outbox.json');
    const cfg = { lancedbPath: dir, mem0BaseUrl: '', mem0ApiKey: '', outboxDbPath };
    const store = new MemoryStoreTool(cfg);

    const r1 = await store.execute({ text: '用户偏好：中文回复', userId: 'railgun', scope: 'long-term', categories: ['preference'] });
    assert.equal(r1.success, true);

    // 幂等：同一条写两次，LanceDB 里只应有一条
    await store.execute({ text: '用户偏好：中文回复', userId: 'railgun', scope: 'long-term', categories: ['preference'] });

    const tbl = await openMemoryTable(dir);
    const rows = await tbl.query().where(`user_id = 'railgun'`).toArray();
    assert.equal(rows.length, 1, `expected 1 row, got ${rows.length}`);

    const outbox = JSON.parse(readFileSync(outboxDbPath, 'utf-8')) as {
      items: Array<{ status: string }>;
    };
    assert.ok(outbox.items.length >= 2);
    assert.equal(outbox.items[0]?.status, 'done');
    assert.equal(outbox.items[1]?.status, 'done');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
