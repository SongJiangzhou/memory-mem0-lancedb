# Auto Capture Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `auto-capture` 的基础上，事件确认后拉取 Mem0 抽取结果，并将其回接到本地 audit plane 与 LanceDB。

**Architecture:** 保持现有三平面架构不变，新增 `src/capture/sync.ts` 作为 Mem0 抽取结果到本地 `MemoryRecord` 的映射和落地层。auto-capture hook 在确认事件后，调用控制面拉取抽取结果并同步回本地。

**Tech Stack:** TypeScript, Node.js, node:test, current Mem0 control client, audit store, LanceDB adapter

---

### Task 1: 扩展 Mem0 client 为“拉取抽取结果”接口

**Files:**
- Modify: `src/control/mem0.ts`
- Modify: `src/control/mem0.test.ts`

**Step 1: Write the failing test**

Add tests that verify:

- after event confirmation, captured memories can be fetched
- empty result sets return an empty array
- fetched items expose the fields needed to map into local `MemoryRecord`

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/control/mem0.test.js`
Expected: FAIL because the client currently cannot fetch extracted memories.

**Step 3: Write minimal implementation**

- Add a control-plane method like `fetchCapturedMemories(...)`
- Keep local/offline-safe fallback behavior
- Use the smallest response shape needed by the mapper

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/control/mem0.test.js`
Expected: PASS.

**Step 5: Commit**

***REMOVED***bash
git add src/control/mem0.ts src/control/mem0.test.ts
git commit -m "feat: fetch captured memories from mem0"
***REMOVED***

### Task 2: 新增 capture sync mapper

**Files:**
- Create: `src/capture/sync.ts`
- Create: `src/capture/sync.test.ts`
- Modify: `src/types.ts`

**Step 1: Write the failing test**

Create tests that verify:

- fetched capture results map into canonical `MemoryRecord`
- duplicate extracted results collapse under the current `memory_uid` rules
- mapped records carry auto-capture source markers

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/capture/sync.test.js`
Expected: FAIL because `src/capture/sync.ts` does not exist yet.

**Step 3: Write minimal implementation**

- Define the fetched-memory input type
- Map each fetched item to canonical `MemoryRecord`
- Reuse existing `buildMemoryUid` rules where appropriate

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/capture/sync.test.js`
Expected: PASS.

**Step 5: Commit**

***REMOVED***bash
git add src/capture/sync.ts src/capture/sync.test.ts src/types.ts
git commit -m "feat: map captured mem0 results into local memory records"
***REMOVED***

### Task 3: 将抽取结果落地到 audit plane 与 LanceDB

**Files:**
- Modify: `src/index.ts`
- Modify: `src/index.test.ts`
- Modify: `src/bridge/adapter.ts`
- Modify: `src/audit/store.ts`

**Step 1: Write the failing test**

Add tests that verify:

- auto-capture hook confirms event
- fetched extracted memories are written to audit plane
- fetched extracted memories are written to LanceDB
- duplicate extracted items do not create duplicate local rows

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/index.test.js`
Expected: FAIL because the hook currently stops after submission/confirmation.

**Step 3: Write minimal implementation**

- In the hook:
  - submit capture
  - confirm event
  - fetch extracted memories
  - map them
  - append to audit plane
  - upsert into LanceDB
- Prevent recursive capture loops

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/index.test.js`
Expected: PASS.

**Step 5: Commit**

***REMOVED***bash
git add src/index.ts src/index.test.ts src/bridge/adapter.ts src/audit/store.ts
git commit -m "feat: sync auto capture results into local memory planes"
***REMOVED***

### Task 4: Full verification and docs update

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Step 1: Write the failing test**

No new code test here. The full suite is the regression target.

**Step 2: Run test to verify it fails**

Run: `npm run build && npm test`
Expected: FAIL if the new phase 2 sync path breaks current behavior.

**Step 3: Write minimal implementation**

- Update docs to explain that auto-capture now syncs extracted results back into local memory
- Fix any regression surfaced by the suite

**Step 4: Run full verification**

Run: `npm run build && npm test`
Expected: PASS.

**Step 5: Commit**

***REMOVED***bash
git add README.md README.zh-CN.md src
git commit -m "docs: describe auto capture phase 2 local sync"
***REMOVED***
