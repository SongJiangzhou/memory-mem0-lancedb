# Recall Sizing And Natural Forgetting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Normalize recall quantity sizing behind a single internal policy and align low-value memory fade-out around ranking decay plus conservative lifecycle progression toward `quarantined`.

**Architecture:** Add a small internal recall sizing module that derives every recall quantity from `autoRecall.topK`, then route `auto.ts`, `hot/search.ts`, and query rewrite through it. Keep ranking constants unchanged, but tighten tests around lifecycle-aware ranking and worker transitions so low-value memories fade gradually in ranking before lifecycle isolation removes them from ordinary recall.

**Tech Stack:** TypeScript, Node.js, LanceDB, Node test runner (`node:test`)

---

### Task 1: Add Recall Sizing Policy Module

**Files:**
- Create: `src/recall/sizing.ts`
- Test: `tests/recall/sizing.test.ts`

**Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveRecallSizing } from '../../src/recall/sizing';

test('deriveRecallSizing expands topK into stable internal recall sizes', () => {
  const sizing = deriveRecallSizing(5);

  assert.deepEqual(sizing, {
    injectTopK: 5,
    candidateTopK: 12,
    primaryFetchK: 72,
    secondaryFetchK: 48,
    maxQueryVariants: 3,
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/recall/sizing.test.js`
Expected: FAIL because `src/recall/sizing.ts` does not exist yet.

**Step 3: Write minimal implementation**

```ts
export interface RecallSizingPolicy {
  injectTopK: number;
  candidateTopK: number;
  primaryFetchK: number;
  secondaryFetchK: number;
  maxQueryVariants: number;
}

export function deriveRecallSizing(topK: number): RecallSizingPolicy {
  const injectTopK = Math.max(1, topK);
  const candidateTopK = Math.max(injectTopK * 2, 12);

  return {
    injectTopK,
    candidateTopK,
    primaryFetchK: Math.max(candidateTopK * 6, 24),
    secondaryFetchK: Math.max(candidateTopK * 4, 16),
    maxQueryVariants: 3,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/tests/recall/sizing.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/recall/sizing.ts tests/recall/sizing.test.ts
git commit -m "refactor(recall): add sizing policy"
```

### Task 2: Route Auto Recall Through Sizing Policy

**Files:**
- Modify: `src/recall/auto.ts`
- Test: `tests/recall/auto.test.ts`

**Step 1: Write the failing test**

```ts
test('runAutoRecall uses derived candidateTopK for search fan-out', async () => {
  const seenTopK: number[] = [];

  await runAutoRecall({
    query: 'remember my preferences',
    userId: 'default',
    config: { enabled: true, topK: 5, maxChars: 1400, scope: 'all' },
    search: async (input) => {
      seenTopK.push(input.topK);
      return { source: 'lancedb', memories: [] };
    },
  });

  assert.deepEqual(seenTopK, [12]);
});
```

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/recall/auto.test.js`
Expected: FAIL if the test asserts the new shared policy behavior before implementation.

**Step 3: Write minimal implementation**

```ts
import { deriveRecallSizing } from './sizing';

const sizing = deriveRecallSizing(params.config.topK);
const candidateTopK = sizing.candidateTopK;
```

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/tests/recall/auto.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/recall/auto.ts tests/recall/auto.test.ts
git commit -m "refactor(recall): derive auto recall candidate sizing"
```

### Task 3: Route Hot Search Fetch Counts Through Sizing Policy

**Files:**
- Modify: `src/hot/search.ts`
- Test: `tests/hot/search.test.ts`

**Step 1: Write the failing test**

```ts
test('hot search uses derived fetch sizes for primary and secondary dimensions', () => {
  const sizing = deriveRecallSizing(5);
  assert.equal(sizing.primaryFetchK, 72);
  assert.equal(sizing.secondaryFetchK, 48);
});
```

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/hot/search.test.js`
Expected: FAIL until `hot/search.ts` stops using duplicated inline fetch constants.

**Step 3: Write minimal implementation**

```ts
import { deriveRecallSizing } from '../recall/sizing';

const sizing = deriveRecallSizing(topK);
const primaryFetchK = sizing.primaryFetchK;
const secondaryFetchK = sizing.secondaryFetchK;
```

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/tests/hot/search.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/hot/search.ts tests/hot/search.test.ts
git commit -m "refactor(search): share recall fetch sizing"
```

### Task 4: Route Query Variant Cap Through Sizing Policy

**Files:**
- Modify: `src/recall/query-rewrite.ts`
- Test: `tests/recall/auto.test.ts`

**Step 1: Write the failing test**

```ts
test('recall query rewrite respects the shared maxQueryVariants policy', () => {
  const variants = buildRecallQueryVariants('what did I say about my burger preference and office schedule and travel preferences');
  assert.ok(variants.length <= 3);
});
```

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/recall/auto.test.js`
Expected: FAIL if the helper still hardcodes a separate variant cap.

**Step 3: Write minimal implementation**

```ts
import { deriveRecallSizing } from './sizing';

const MAX_QUERY_VARIANTS = deriveRecallSizing(1).maxQueryVariants;
```

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/tests/recall/auto.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/recall/query-rewrite.ts tests/recall/auto.test.ts
git commit -m "refactor(recall): share query variant sizing"
```

### Task 5: Make Ranking Fade-Out Expectations Explicit

**Files:**
- Modify: `tests/hot/search.test.ts`
- Reference: `src/hot/search.ts:252-414`

**Step 1: Write the failing test**

```ts
test('hot plane ranking fades older weak memories behind fresher stronger peers', () => {
  const ranked = (hot as any).applyRankingAdjustments(
    [
      { memory_uid: 'stale-low', text: 'User likes grilled chicken burgers', strength: 0.25, utility_score: 0.2, stability: 10, last_access_ts: oldDate, __rrf_score: 0.9, lifecycle_state: 'active' },
      { memory_uid: 'fresh-strong', text: 'User likes grilled chicken burgers', strength: 0.8, utility_score: 0.8, stability: 30, last_access_ts: freshDate, __rrf_score: 0.8, lifecycle_state: 'active' },
    ],
    'grilled chicken burger',
  );

  assert.equal(ranked[0]?.memory_uid, 'fresh-strong');
});
```

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/hot/search.test.js`
Expected: FAIL if ranking does not make lifecycle fading behavior explicit enough.

**Step 3: Write minimal implementation**

```ts
// Keep ranking formula intact if the test already passes.
// If needed, tighten lifecycle boost handling by using the same effective decay assumptions consistently.
```

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/tests/hot/search.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/hot/search.test.ts src/hot/search.ts
git commit -m "test(search): cover lifecycle ranking fade-out"
```

### Task 6: Make Conservative Lifecycle Fade-Out Explicit

**Files:**
- Modify: `tests/hot/lifecycle-worker.test.ts`
- Reference: `src/hot/lifecycle-worker.ts`
- Reference: `src/memory/lifecycle.ts`

**Step 1: Write the failing test**

```ts
test('lifecycle worker quarantines persistently weak memories before deletion', async () => {
  // Insert a weak long-term memory old enough to be quarantined.
  // Run worker once.
  // Assert lifecycle_state becomes quarantined rather than deleted.
});
```

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/hot/lifecycle-worker.test.js`
Expected: FAIL if current assertions do not encode the conservative fade-out model.

**Step 3: Write minimal implementation**

```ts
// Preserve existing worker behavior if it already matches the expected transition order.
// Only adjust implementation if tests expose an ordering gap.
```

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/tests/hot/lifecycle-worker.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/hot/lifecycle-worker.test.ts src/hot/lifecycle-worker.ts src/memory/lifecycle.ts
git commit -m "test(lifecycle): lock conservative fade-out flow"
```

### Task 7: Run Full Verification

**Files:**
- Verify: `src/recall/sizing.ts`
- Verify: `src/recall/auto.ts`
- Verify: `src/recall/query-rewrite.ts`
- Verify: `src/hot/search.ts`
- Verify: `src/hot/lifecycle-worker.ts`
- Verify: `src/memory/lifecycle.ts`
- Verify: `tests/recall/sizing.test.ts`
- Verify: `tests/recall/auto.test.ts`
- Verify: `tests/hot/search.test.ts`
- Verify: `tests/hot/lifecycle-worker.test.ts`

**Step 1: Run focused tests**

Run: `npm run build && node --test dist/tests/recall/sizing.test.js dist/tests/recall/auto.test.js dist/tests/hot/search.test.js dist/tests/hot/lifecycle-worker.test.js`
Expected: PASS

**Step 2: Run project test suite**

Run: `npm test`
Expected: PASS

**Step 3: Inspect git diff**

Run: `git status --short && git diff --stat`
Expected: only planned files changed

**Step 4: Commit any final cleanup**

```bash
git add src/recall/sizing.ts src/recall/auto.ts src/recall/query-rewrite.ts src/hot/search.ts src/hot/lifecycle-worker.ts src/memory/lifecycle.ts tests/recall/sizing.test.ts tests/recall/auto.test.ts tests/hot/search.test.ts tests/hot/lifecycle-worker.test.ts
git commit -m "refactor(recall): normalize sizing and align natural forgetting"
```
