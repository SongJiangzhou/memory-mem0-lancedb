# Auto Recall Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `memory-mem0-lancedb` 插件增加“配置开启时自动注入”的 auto-recall 能力，复用当前 `hot plane` 检索结果生成上下文注入块。

**Architecture:** 保持现有工具和三平面结构不变，新增 `src/recall/auto.ts` 作为 recall pipeline 和 formatter。插件注册时探测可用的生命周期 hook，若配置开启则接入自动 recall，否则保持静默。

**Tech Stack:** TypeScript, Node.js, node:test, current HotMemorySearch retrieval pipeline, OpenClaw plugin API compatibility layer

---

### Task 1: 新增 auto-recall formatter 与 pipeline

**Files:**
- Create: `src/recall/auto.ts`
- Create: `src/recall/auto.test.ts`
- Modify: `src/types.ts`

**Step 1: Write the failing test**

Create tests that verify:

- recall results are formatted into a stable `<relevant_memories>` block
- topK limits are honored
- `maxChars` truncation is applied
- empty result sets produce no injected text

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/recall/auto.test.js`
Expected: FAIL because `src/recall/auto.ts` does not exist yet.

**Step 3: Write minimal implementation**

- Add `AutoRecallConfig` to `src/types.ts`
- Implement the recall formatter and helper pipeline in `src/recall/auto.ts`
- Keep the first version pure and testable

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/recall/auto.test.js`
Expected: PASS.

**Step 5: Commit**

***REMOVED***bash
git add src/recall/auto.ts src/recall/auto.test.ts src/types.ts
git commit -m "feat: add configurable auto recall formatter"
***REMOVED***

### Task 2: 扩展插件配置与注册层

**Files:**
- Modify: `src/index.ts`
- Modify: `openclaw.plugin.json`
- Test: `src/index.test.ts`

**Step 1: Write the failing test**

Add tests that verify:

- config accepts `autoRecall`
- plugin registers auto-recall only when enabled
- missing hook registration APIs do not throw

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/index.test.js`
Expected: FAIL because the plugin currently has no auto-recall config or hook handling.

**Step 3: Write minimal implementation**

- Add `autoRecall` config defaults
- Detect a lifecycle/hook registration capability if available
- Register auto-recall only when `enabled=true`

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/index.test.js`
Expected: PASS.

**Step 5: Commit**

***REMOVED***bash
git add src/index.ts src/index.test.ts openclaw.plugin.json
git commit -m "feat: add optional auto recall plugin integration"
***REMOVED***

### Task 3: 连接 hot plane 并做回归验证

**Files:**
- Modify: `src/tools/search.ts`
- Modify: `src/hot/search.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Step 1: Write the failing test**

Add regression tests that verify:

- auto-recall uses current hot-plane search results
- explicit search tools still behave the same
- when auto-recall is disabled, there is no behavior change

**Step 2: Run test to verify it fails**

Run: `npm run build && npm test`
Expected: FAIL if the new integration breaks tool behavior or config handling.

**Step 3: Write minimal implementation**

- Wire the auto-recall pipeline to `HotMemorySearch`
- Keep explicit tool behavior unchanged
- Document the new config

**Step 4: Run full verification**

Run: `npm run build && npm test`
Expected: PASS.

**Step 5: Commit**

***REMOVED***bash
git add README.md README.zh-CN.md src
git commit -m "docs: describe configurable auto recall"
***REMOVED***
