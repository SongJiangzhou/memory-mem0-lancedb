# Mem0 Event Confirmation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `memory-mem0-lancedb` 插件增加 Mem0 事件提交与短轮询确认，使 `syncStatus` 反映真实确认结果。

**Architecture:** 保持当前 file-first 三平面架构不变，仅增强 `control plane` 和 `sync engine`。写入时先落 audit，再提交 Mem0 并短轮询确认，最后结合 LanceDB 可见性返回 `synced` / `partial` / `failed` / `duplicate`。

**Tech Stack:** TypeScript, Node.js, node:test, Mem0 HTTP API, local file persistence, LanceDB Node SDK

---

### Task 1: 扩展 Mem0 client 为提交 + 事件确认接口

**Files:**
- Modify: `src/control/mem0.ts`
- Modify: `src/control/mem0.test.ts`

**Step 1: Write the failing test**

Add tests that verify:

- `storeMemory()` returns `unavailable` when API key is missing
- `storeMemory()` returns `submitted` with `event_id` on success
- `waitForEvent()` returns `confirmed` when the event is done
- `waitForEvent()` returns `timeout` when confirmation does not arrive in time

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/control/mem0.test.js`
Expected: FAIL because the current client only returns a simplified sync result.

**Step 3: Write minimal implementation**

- Split Mem0 behavior into:
  - `storeMemory(record)`
  - `waitForEvent(eventId, options?)`
- Keep local `unavailable` fallback behavior
- Use a short polling window only

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/control/mem0.test.js`
Expected: PASS.

**Step 5: Commit**

***REMOVED***bash
git add src/control/mem0.ts src/control/mem0.test.ts
git commit -m "feat: add mem0 event confirmation client"
***REMOVED***

### Task 2: 将 sync engine 状态映射到真实确认结果

**Files:**
- Modify: `src/bridge/sync-engine.ts`
- Modify: `src/bridge/sync-engine.test.ts`
- Modify: `src/types.ts`

**Step 1: Write the failing test**

Extend sync-engine tests to verify:

- Mem0 confirmed + LanceDB visible -> `synced`
- Mem0 timeout + LanceDB visible -> `partial`
- Mem0 unavailable + LanceDB visible -> `partial`
- LanceDB invisible -> `failed`
- duplicate replay -> `duplicate`

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/bridge/sync-engine.test.js`
Expected: FAIL because current sync-engine does not confirm Mem0 events.

**Step 3: Write minimal implementation**

- Call `storeMemory()`
- If submitted, call `waitForEvent()`
- Map final state using both Mem0 confirmation and LanceDB visibility

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/bridge/sync-engine.test.js`
Expected: PASS.

**Step 5: Commit**

***REMOVED***bash
git add src/bridge/sync-engine.ts src/bridge/sync-engine.test.ts src/types.ts
git commit -m "feat: confirm mem0 events in sync engine"
***REMOVED***

### Task 3: 回归工具层状态与离线行为

**Files:**
- Modify: `src/tools/store.ts`
- Modify: `src/tools/store_lancedb.test.ts`
- Modify: `src/tools/local_fallback.test.ts`

**Step 1: Write the failing test**

Update regression tests so they verify:

- no Mem0 key -> local success with `partial`
- confirmed Mem0 path still maps to successful store results
- failures do not regress local LanceDB persistence

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tools/store_lancedb.test.js && node --test dist/tools/local_fallback.test.js`
Expected: FAIL if tool-layer status mapping no longer matches sync-engine behavior.

**Step 3: Write minimal implementation**

- Keep tool inputs unchanged
- Update only the output mapping and client wiring

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/tools/store_lancedb.test.js && node --test dist/tools/local_fallback.test.js`
Expected: PASS.

**Step 5: Commit**

***REMOVED***bash
git add src/tools/store.ts src/tools/store_lancedb.test.ts src/tools/local_fallback.test.ts
git commit -m "refactor: align store status with mem0 event confirmation"
***REMOVED***

### Task 4: Full verification and docs touch-up

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Step 1: Write the failing test**

No new code test here. The verification target is that the full suite still passes and docs reflect confirmed sync semantics.

**Step 2: Run test to verify it fails**

Run: `npm run build && npm test`
Expected: FAIL if any behavior regresses after the confirmation flow changes.

**Step 3: Write minimal implementation**

- Update README wording from approximate sync semantics to confirmed semantics
- Fix any regression from the full suite

**Step 4: Run full verification**

Run: `npm run build && npm test`
Expected: PASS.

**Step 5: Commit**

***REMOVED***bash
git add README.md README.zh-CN.md src
git commit -m "docs: describe mem0 event confirmation semantics"
***REMOVED***
