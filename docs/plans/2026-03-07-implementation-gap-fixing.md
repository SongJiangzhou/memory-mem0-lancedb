# Implementation Gap Fixing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the current prototype into a robust, low-latency, and secure system by fully leveraging LanceDB's native APIs, resolving MMR/Time decay, and implementing Mem0 synchronization.

**Architecture:** We are replacing slow in-memory filtering/scoring with LanceDB's native fast operations (`IVF-PQ`, scalar indices, `search()`, `mergeInsert`). We are also introducing a polling sync-engine for Mem0 state and a security middleware for all inbound memory records.

**Tech Stack:** TypeScript, `@lancedb/lancedb` (0.26.2), Node.js native test runner

---

### Task 1: LanceDB Native Schema & Vector/Scalar Indexing

**Files:**
- Modify: `src/db/table.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/bridge/adapter.ts`
- Test: `src/db/table.test.ts` (Create/Modify)

**Step 1: Write the failing test**

***REMOVED***typescript
// src/db/table.test.ts
import test from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import { openMemoryTable, ensureFtsIndex } from './table';

test('openMemoryTable creates scalar and vector indices', async () => {
  const tmpDir = path.join(os.tmpdir(), `lancedb-test-${Date.now()}`);
  const tbl = await openMemoryTable(tmpDir);
  
  // This might not have a direct assertable getter without throwing, 
  // but we can test if querying via index works or just rely on 
  // execution not throwing errors.
  const indices = await tbl.listIndices();
  assert.ok(indices.some(idx => idx.columns.includes('user_id')));
  assert.ok(indices.some(idx => idx.columns.includes('vector')));
});
***REMOVED***

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL due to missing indices on `user_id` and `vector` (or `listIndices` mismatch).

**Step 3: Write minimal implementation**

Update `src/db/table.ts` `openMemoryTable` function:
***REMOVED***typescript
  // after creating the table and deleting the placeholder:
  try {
    await tbl.createIndex('vector'); // Default IVF-PQ for vector column
    await tbl.createIndex('user_id'); // Scalar index
    await tbl.createIndex('status'); // Scalar index
    await tbl.createIndex('scope'); // Scalar index
  } catch (err) {
    console.warn('Index creation failed or already exists', err);
  }
***REMOVED***

Update `src/db/schema.ts` to allow arrays for tags/categories (if easy to represent in JS payload, otherwise stick to JSON string for LanceDB schema simplicity but we prefer arrays if LanceDB infers it, wait, let's keep stringified for now to minimize schema migration breakage but add indexes).
Wait, design says: "Schema 优化：将 categories 和 tags... 转为 Arrow 原生嵌套结构".
Update `schema.ts`:
***REMOVED***typescript
  categories: string[];
  tags: string[];
  openclaw_refs: string; // Keep as string or Record<string, any>
***REMOVED***
Update `src/bridge/adapter.ts` and `src/hot/search.ts` to pass real arrays for `categories` and `tags` instead of `JSON.stringify()`.

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (or update tests fixing schema mismatches)

**Step 5: Commit**

***REMOVED***bash
git add src/db/table.ts src/db/schema.ts src/bridge/adapter.ts src/hot/search.ts src/db/table.test.ts
git commit -m "feat(db): add vector and scalar indices, native array schema"
***REMOVED***

---

### Task 2: Refactor Upsert to `mergeInsert`

**Files:**
- Modify: `src/bridge/adapter.ts`

**Step 1: Write the test/Verify existing tests**
Ensure existing `src/bridge/adapter.test.ts` exists. If not, we rely on the manual code inspection. `upsertMemory` should no longer use delete+add.

**Step 3: Write minimal implementation**
Update `LanceDbMemoryAdapter.upsertMemory`:
***REMOVED***typescript
  async upsertMemory(record: MemoryAdapterRecord): Promise<void> {
    const table = await openMemoryTable(this.lancedbPath);
    const row = toLanceRow(record);
    
    await table.mergeInsert('memory_uid')
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute([row as any]);
  }
***REMOVED***

**Step 4: Run tests**
Run: `npm test`
Expected: PASS

**Step 5: Commit**
***REMOVED***bash
git add src/bridge/adapter.ts
git commit -m "refactor(adapter): use mergeInsert for idempotency"
***REMOVED***

---

### Task 3: Hot Plane Native Vector Search & MMR / Time Decay

**Files:**
- Modify: `src/hot/search.ts`
- Modify: `src/hot/search.test.ts`

**Step 1: Write the failing test**
Update `search.test.ts` to mock or expect vector search to be called via `tbl.search(vector)`.

**Step 3: Write implementation**
In `src/hot/search.ts`:
- Delete `searchVector` that loops over `tbl.query()...toArray()`.
- Use LanceDB native: `const vectorRows = await tbl.search(queryVector).where(whereClause).limit(topK).toArray();`
- Add Time Decay logic to the final merged rows:
***REMOVED***typescript
// Example Time decay boost
const now = Date.now();
rows.forEach(r => {
  const ageMs = now - new Date(r.ts_event).getTime();
  const decay = Math.exp(-ageMs / (1000 * 60 * 60 * 24 * 30)); // 30 day half-life
  r.__score = (r.__score || 1) * (0.8 + 0.2 * decay); 
});
***REMOVED***
- Implement basic MMR deduplication in the final return to drop items with > 0.85 cosine similarity to each other.

**Step 4: Run tests**
Run: `npm test`
Expected: PASS

**Step 5: Commit**
***REMOVED***bash
git add src/hot/search.ts src/hot/search.test.ts
git commit -m "feat(search): native vector search API, time decay, and MMR"
***REMOVED***

---

### Task 4: Mem0 Polling Sync Engine

**Files:**
- Create: `src/bridge/poller.ts`
- Modify: `src/index.ts` (to start the poller if configured)

**Step 1: Write the failing test**
Create `src/bridge/poller.test.ts`.

**Step 3: Write implementation**
Implement `Mem0Poller` class that:
- Uses `setInterval`.
- Calls Mem0 API `GET /v1/memories/?updated_after=...`.
- Compares fetched memories.
- Calls `adapter.upsertMemory()` for updates.
- If status is deleted, updates LanceDB row to `status: 'deleted'`.

**Step 4: Run tests**
Run: `npm test`
Expected: PASS

**Step 5: Commit**
***REMOVED***bash
git add src/bridge/poller.ts src/bridge/poller.test.ts src/index.ts
git commit -m "feat(sync): background mem0 event polling for update/delete"
***REMOVED***

---

### Task 5: Security Interceptor Middleware

**Files:**
- Create: `src/capture/security.ts`
- Modify: `src/tools/store.ts`
- Modify: `src/capture/auto.ts`

**Step 1: Write the failing test**
Create `src/capture/security.test.ts` testing injections like "Ignore all previous instructions".

**Step 3: Write implementation**
***REMOVED***typescript
export function sanitizeMemoryText(text: string): { cleanText: string; isRestricted: boolean } {
  const restrictedPatterns = [/ignore all previous instructions/i, /system prompt/i, /api[-_]?key/i];
  let isRestricted = false;
  for (const p of restrictedPatterns) {
    if (p.test(text)) isRestricted = true;
  }
  return { cleanText: text, isRestricted };
}
***REMOVED***
Inject this into `MemoryStoreTool.execute` and `buildAutoCapturePayload`. If `isRestricted` is true, force `sensitivity = 'restricted'`.

**Step 4: Run tests**
Run: `npm test`
Expected: PASS

**Step 5: Commit**
***REMOVED***bash
git add src/capture/security.ts src/capture/security.test.ts src/tools/store.ts src/capture/auto.ts
git commit -m "feat(security): add memory poisoning interceptor"
***REMOVED***
