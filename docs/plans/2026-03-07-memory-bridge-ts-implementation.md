# Memory Bridge TS Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 `memory_bridge/` 的 Python 能力迁移到 `src/bridge/`，并让 `memoryStore` 使用统一的 TypeScript sync engine、outbox 和 LanceDB adapter。

**Architecture:** 保留插件对外接口不变，在 `src/bridge/` 下重建 `uid`、`outbox`、`adapter`、`sync-engine` 四个模块。工具层只做参数组装与结果映射，bridge 层负责幂等、状态机、写入和可见性检查。

**Tech Stack:** TypeScript, Node.js, node:test, LanceDB Node SDK, OpenClaw plugin API, file-backed local persistence

---

### Task 1: 建立 `uid` 模块并迁移 `memory_uid.py`

**Files:**
- Create: `src/bridge/uid.ts`
- Create: `src/bridge/uid.test.ts`

**Step 1: Write the failing test**

***REMOVED***typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMemoryUid, normalizeText } from './uid';

test('normalizeText trims lowercases and collapses whitespace', () => {
  assert.equal(normalizeText('  Hello   WORLD  '), 'hello world');
});

test('buildMemoryUid is stable for equivalent normalized text', () => {
  const a = buildMemoryUid('u1', 'long-term', 'Hello   world', '2026-03-07T10', 'general');
  const b = buildMemoryUid('u1', 'long-term', ' hello world ', '2026-03-07T10', 'general');
  assert.equal(a, b);
});
***REMOVED***

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/bridge/uid.test.js`
Expected: FAIL because `uid.ts` does not exist yet.

**Step 3: Write minimal implementation**

***REMOVED***typescript
export function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}
***REMOVED***

Implement `buildMemoryUid()` with `sha256(userId|scope|normalizedText|tsBucket|category)`.

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/bridge/uid.test.js`
Expected: PASS.

**Step 5: Commit**

***REMOVED***bash
git add src/bridge/uid.ts src/bridge/uid.test.ts
git commit -m "feat: migrate memory uid builder to typescript"
***REMOVED***

### Task 2: 建立文件型 outbox，并复刻最小状态机

**Files:**
- Create: `src/bridge/outbox.ts`
- Create: `src/bridge/outbox.test.ts`
- Modify: `src/types.ts`

**Step 1: Write the failing test**

***REMOVED***typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileOutbox } from './outbox';

test('outbox enqueues once for duplicate idempotency key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'outbox-'));
  try {
    const box = new FileOutbox(join(dir, 'outbox.json'));
    const first = await box.enqueue('k1', '{"x":1}');
    const second = await box.enqueue('k1', '{"x":1}');
    assert.equal(first, true);
    assert.equal(second, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
***REMOVED***

Add tests for `claimNext()`, `markDone()`, and `markFailed()`.

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/bridge/outbox.test.js`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement a JSON-file-backed outbox with:

- `enqueue(idempotencyKey, payload)`
- `claimNext()`
- `markDone(id)`
- `markFailed(id)`
- `getStatus(id)`

Store `pending`, `processing`, `done`, `failed` explicitly.

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/bridge/outbox.test.js`
Expected: PASS.

**Step 5: Commit**

***REMOVED***bash
git add src/bridge/outbox.ts src/bridge/outbox.test.ts src/types.ts
git commit -m "feat: add file backed memory outbox"
***REMOVED***

### Task 3: 建立 LanceDB adapter 与 sync engine

**Files:**
- Create: `src/bridge/adapter.ts`
- Create: `src/bridge/sync-engine.ts`
- Create: `src/bridge/sync-engine.test.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/db/table.ts`

**Step 1: Write the failing test**

***REMOVED***typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemorySyncEngine } from './sync-engine';
import { InMemoryAdapter } from './adapter';
import { FileOutbox } from './outbox';

test('sync engine marks duplicate when idempotency key already exists', async () => {
  // setup omitted
  assert.equal(result.status, 'duplicate');
});
***REMOVED***

Add a second test where adapter visibility check fails and result is `failed_visibility`.

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/bridge/sync-engine.test.js`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement:

- adapter contract with `upsertMemory()` and `exists()`
- a fake/in-memory adapter for tests
- a LanceDB-backed adapter for production
- `MemorySyncEngine.processEvent(eventId, memory)`

`processEvent()` should:

1. derive `memory_uid`
2. enqueue by `event_id:memory_uid`
3. claim next item
4. upsert row
5. verify visibility
6. mark `done` or `failed`

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/bridge/sync-engine.test.js`
Expected: PASS.

**Step 5: Commit**

***REMOVED***bash
git add src/bridge/adapter.ts src/bridge/sync-engine.ts src/bridge/sync-engine.test.ts src/db/schema.ts src/db/table.ts
git commit -m "feat: add memory sync engine and adapter layer"
***REMOVED***

### Task 4: 切换 `store` 到新的 TS bridge

**Files:**
- Modify: `src/tools/store.ts`
- Modify: `src/tools/store_lancedb.test.ts`
- Modify: `src/types.ts`

**Step 1: Write the failing test**

Add/modify a test that stores the same logical memory twice and asserts:

- the first call succeeds
- the second call reports success without creating a duplicate row
- the resulting row is visible in LanceDB

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tools/store_lancedb.test.js`
Expected: FAIL until `store.ts` is switched to `MemorySyncEngine`.

**Step 3: Write minimal implementation**

Refactor `MemoryStoreTool.execute()` to:

- create an event id
- create a `FileOutbox`
- create a LanceDB adapter
- invoke `MemorySyncEngine.processEvent()`
- map `done` and `duplicate` to the current `StoreResult`

Keep Mem0 submission behavior only where still needed, but remove duplicated `memory_uid` logic from the tool.

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/tools/store_lancedb.test.js`
Expected: PASS.

**Step 5: Commit**

***REMOVED***bash
git add src/tools/store.ts src/tools/store_lancedb.test.ts src/types.ts
git commit -m "feat: route memory store through ts bridge sync engine"
***REMOVED***

### Task 5: 清理残留 Python bridge，并做回归验证

**Files:**
- Delete: `memory_bridge/sync_engine.py`
- Delete: `memory_bridge/lancedb_adapter.py`
- Delete: `memory_bridge/outbox.py`
- Delete: `memory_bridge/memory_uid.py`
- Modify: `memory_bridge/README.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Step 1: Write the failing test**

No new code test here. The verification target is repository-level:

- build still passes
- all tests still pass
- no runtime path depends on Python bridge modules

**Step 2: Run verification before deletion**

Run: `rg -n "memory_bridge|sync_engine|lancedb_adapter|outbox.py|memory_uid.py" src README.md README.zh-CN.md`
Expected: only documentation references remain.

**Step 3: Write minimal implementation**

Delete Python files, rewrite the bridge README to explain the TS migration, and update top-level docs if they mention Python runtime behavior.

**Step 4: Run full verification**

Run: `npm run build && npm test`
Expected: PASS.

**Step 5: Commit**

***REMOVED***bash
git add src memory_bridge README.md README.zh-CN.md
git commit -m "refactor: remove python memory bridge implementation"
***REMOVED***
