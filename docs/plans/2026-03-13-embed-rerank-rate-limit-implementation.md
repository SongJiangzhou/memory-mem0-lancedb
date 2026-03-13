# Embed/Rerank Rate Limit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a shared call-governance layer that reduces duplicate embedding and rerank requests, limits provider concurrency, and backs off after rate limits across migration and search/recall paths.

**Architecture:** Introduce provider-neutral `EmbeddingClient` and `RerankClient` components that own request deduplication, short-lived caching, concurrency limits, and retry/cooldown behavior. Then route `hot/search`, `migration-worker`, and remote recall reranking through those clients without changing higher-level product behavior.

**Tech Stack:** TypeScript, Node.js test runner, in-memory caches/maps, existing fetch-based provider integrations, LanceDB hot search, migration worker, Voyage reranker

---

### Task 1: Add an embedding client contract with dedupe-oriented tests

**Files:**
- Create: `src/runtime/embedding-client.ts`
- Create: `tests/runtime/embedding-client.test.ts`
- Test: `tests/runtime/embedding-client.test.ts`

**Step 1: Write the failing test**

Add tests for:

- identical concurrent `embed()` requests share a single underlying provider call
- cached requests within TTL do not issue a second provider call
- `embedMany()` preserves input ordering

Use a small fake provider function with explicit call counters and controllable promise resolution.

**Step 2: Run test to verify it fails**

Run:

```bash
npm run build
node dist/tests/runtime/embedding-client.test.js
```

Expected: FAIL because `EmbeddingClient` does not exist yet.

**Step 3: Write minimal implementation**

Create `src/runtime/embedding-client.ts` with:

- a constructor accepting execution hooks and config
- in-flight map keyed by normalized request key
- short TTL cache map
- `embed()`
- `embedMany()` initially implemented via controlled repeated `embed()`

Do not add provider-specific logic yet.

**Step 4: Run test to verify it passes**

Run:

```bash
npm run build
node dist/tests/runtime/embedding-client.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/runtime/embedding-client.ts tests/runtime/embedding-client.test.ts
git commit -m "feat(runtime): add embedding client dedupe layer"
```

### Task 2: Add concurrency limiting and retry/cooldown tests to the embedding client

**Files:**
- Modify: `src/runtime/embedding-client.ts`
- Modify: `tests/runtime/embedding-client.test.ts`
- Test: `tests/runtime/embedding-client.test.ts`

**Step 1: Write the failing test**

Add tests for:

- max concurrent provider calls are capped
- `429` response triggers retry with backoff
- cooldown delays subsequent requests after a `429`

Use a fake clock or injectable `sleep`/`now` hooks so tests stay deterministic.

**Step 2: Run test to verify it fails**

Run:

```bash
npm run build
node dist/tests/runtime/embedding-client.test.js
```

Expected: FAIL because concurrency and cooldown behavior are not implemented yet.

**Step 3: Write minimal implementation**

Extend `EmbeddingClient` with:

- provider-keyed semaphore or equivalent permit logic
- retry loop for retryable failures
- exponential backoff + jitter hook (inject jitter in tests)
- cooldown timestamp tracking per provider key

Keep config internal and conservative.

**Step 4: Run test to verify it passes**

Run:

```bash
npm run build
node dist/tests/runtime/embedding-client.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/runtime/embedding-client.ts tests/runtime/embedding-client.test.ts
git commit -m "feat(runtime): add embedding backoff and concurrency limits"
```

### Task 3: Add a rerank client with equivalent traffic shaping tests

**Files:**
- Create: `src/runtime/rerank-client.ts`
- Create: `tests/runtime/rerank-client.test.ts`
- Test: `tests/runtime/rerank-client.test.ts`

**Step 1: Write the failing test**

Add tests for:

- identical concurrent rerank requests share one underlying remote call
- rerank cache suppresses repeated identical calls within TTL
- rerank client retries `429` and enters cooldown

Represent documents as simple strings in the test harness, then map to request keys by query + document content.

**Step 2: Run test to verify it fails**

Run:

```bash
npm run build
node dist/tests/runtime/rerank-client.test.js
```

Expected: FAIL because `RerankClient` does not exist yet.

**Step 3: Write minimal implementation**

Create `src/runtime/rerank-client.ts` with the same control pattern as the embedding client:

- request key normalization
- in-flight dedupe
- TTL cache
- bounded concurrency
- retry/cooldown logic

Return ranked indices or another minimal stable representation suitable for the reranker adapter.

**Step 4: Run test to verify it passes**

Run:

```bash
npm run build
node dist/tests/runtime/rerank-client.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/runtime/rerank-client.ts tests/runtime/rerank-client.test.ts
git commit -m "feat(runtime): add rerank client governor"
```

### Task 4: Route hot search through the shared embedding client

**Files:**
- Modify: `src/hot/search.ts`
- Modify: `tests/hot/search.test.ts`
- Test: `tests/hot/search.test.ts`

**Step 1: Write the failing test**

Add or extend a hot search test asserting repeated query-embedding usage for the same query path is served by the shared client instead of issuing duplicate provider calls.

Prefer a focused test with an instrumented fake embedding executor over broad integration noise.

**Step 2: Run test to verify it fails**

Run:

```bash
npm run build
node dist/tests/hot/search.test.js
```

Expected: FAIL because search still calls `embedText()` directly.

**Step 3: Write minimal implementation**

Refactor `src/hot/search.ts` so query embeddings are requested through the new `EmbeddingClient`.

Preserve existing failure fallback behavior.

**Step 4: Run test to verify it passes**

Run:

```bash
npm run build
node dist/tests/hot/search.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/hot/search.ts tests/hot/search.test.ts
git commit -m "refactor(search): use shared embedding client"
```

### Task 5: Route migration worker through the shared embedding client

**Files:**
- Modify: `src/hot/migration-worker.ts`
- Modify: `tests/hot/migration-worker.test.ts`
- Test: `tests/hot/migration-worker.test.ts`

**Step 1: Write the failing test**

Add a focused test asserting migration embedding requests are mediated through the shared client and do not double-apply conflicting retry behavior.

Also add a test that multiple same-text rows in one batch do not trigger duplicate provider calls.

**Step 2: Run test to verify it fails**

Run:

```bash
npm run build
node dist/tests/hot/migration-worker.test.js
```

Expected: FAIL because migration still uses worker-local embedding execution.

**Step 3: Write minimal implementation**

Modify `src/hot/migration-worker.ts` to:

- request embeddings through `EmbeddingClient`
- simplify local retry logic so the shared client is the main owner of `429` policy
- keep current migration batch boundaries

Do not add advanced provider-specific batch behavior yet unless it is required to satisfy tests.

**Step 4: Run test to verify it passes**

Run:

```bash
npm run build
node dist/tests/hot/migration-worker.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/hot/migration-worker.ts tests/hot/migration-worker.test.ts
git commit -m "refactor(migration): use shared embedding client"
```

### Task 6: Route remote recall reranking through the shared rerank client

**Files:**
- Modify: `src/recall/reranker.ts`
- Modify: `tests/recall/reranker.test.ts`
- Test: `tests/recall/reranker.test.ts`

**Step 1: Write the failing test**

Extend reranker tests to assert:

- identical concurrent remote rerank requests are deduped
- retry/cooldown behavior happens in the shared client
- local fallback still occurs after final remote failure

**Step 2: Run test to verify it fails**

Run:

```bash
npm run build
node dist/tests/recall/reranker.test.js
```

Expected: FAIL because reranker still calls fetch directly.

**Step 3: Write minimal implementation**

Refactor the Voyage rerank path in `src/recall/reranker.ts` to use `RerankClient`.

Keep the existing local fallback behavior unchanged.

**Step 4: Run test to verify it passes**

Run:

```bash
npm run build
node dist/tests/recall/reranker.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/recall/reranker.ts tests/recall/reranker.test.ts
git commit -m "refactor(recall): use shared rerank client"
```

### Task 7: Add shared runtime wiring and regression coverage

**Files:**
- Modify: `src/index.ts`
- Modify: `src/types.ts`
- Modify: any new runtime helper exports as needed
- Test: `tests/index.test.ts`
- Test: targeted runtime tests if constructor wiring needs coverage

**Step 1: Write the failing test**

Add tests proving runtime wiring creates or reuses the shared clients consistently instead of constructing ad hoc per-call request controllers.

**Step 2: Run test to verify it fails**

Run:

```bash
npm run build
node dist/tests/index.test.js
```

Expected: FAIL because runtime wiring still uses direct helper paths.

**Step 3: Write minimal implementation**

Wire the new shared clients into the places that need them without exposing premature public configuration.

Keep defaults internal and conservative.

**Step 4: Run test to verify it passes**

Run:

```bash
npm run build
node dist/tests/index.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/index.ts src/types.ts tests/index.test.ts
git commit -m "feat(runtime): wire shared rate limit clients"
```

### Task 8: Run targeted and full verification

**Files:**
- Modify: none
- Test: `tests/runtime/embedding-client.test.ts`
- Test: `tests/runtime/rerank-client.test.ts`
- Test: `tests/hot/search.test.ts`
- Test: `tests/hot/migration-worker.test.ts`
- Test: `tests/recall/reranker.test.ts`
- Test: `tests/index.test.ts`

**Step 1: Run targeted tests**

Run:

```bash
npm run build
node dist/tests/runtime/embedding-client.test.js
node dist/tests/runtime/rerank-client.test.js
node dist/tests/hot/search.test.js
node dist/tests/hot/migration-worker.test.js
node dist/tests/recall/reranker.test.js
node dist/tests/index.test.js
```

Expected: PASS

**Step 2: Run full suite**

Run:

```bash
npm test
```

Expected: PASS with no regressions.

**Step 3: Review diff**

Run:

```bash
git diff --stat
```

Expected: only the intended runtime client, integration, and test changes.

**Step 4: Commit**

```bash
git add src/runtime src/hot/search.ts src/hot/migration-worker.ts src/recall/reranker.ts src/index.ts src/types.ts tests/runtime tests/hot/search.test.ts tests/hot/migration-worker.test.ts tests/recall/reranker.test.ts tests/index.test.ts
git commit -m "feat: govern embed and rerank request traffic"
```
