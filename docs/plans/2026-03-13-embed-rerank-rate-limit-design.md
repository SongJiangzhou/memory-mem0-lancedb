# Embed/Rerank Rate Limit Design

## Summary

This design introduces a shared call-governance layer for embedding and rerank requests so the plugin can reduce duplicate calls, smooth request bursts, and lower the probability of `429` responses across providers.

Phase 1 intentionally avoids product-behavior changes. It does not change which memories are stored or recalled. It only changes how remote embedding and rerank calls are scheduled, deduplicated, cached, and retried.

## Goals

- Reduce duplicate embedding requests for identical text within a short time window.
- Reduce duplicate rerank requests for identical query + document sets within a short time window.
- Bound concurrent outbound requests per provider.
- Back off automatically after `429` or transient `5xx` responses.
- Apply the same control model to both migration and search/recall paths.
- Preserve existing public configuration and default behavior unless rate limiting is actually encountered.

## Non-Goals

- Do not redesign recall query generation or memory filtering.
- Do not change memory admission or promotion semantics.
- Do not require every provider to support true batch APIs on day one.
- Do not add persistent disk caches in this phase.
- Do not introduce provider-specific behavior except where unavoidable inside adapters.

## Current Problems

### 1. Embedding calls are unmanaged at the shared-system level

`embedText()` is a direct helper used by both hot search and migration flows. Each caller is responsible for its own pacing, which means the system lacks:

- shared request deduplication
- shared in-flight coalescing
- shared provider concurrency limits
- shared cooldown state after rate limits

### 2. Migration and search can independently pressure the same provider

`EmbeddingMigrationWorker` already has some `429` retry behavior, but it acts locally inside the worker. Search and migration still do not coordinate. Two subsystems can therefore spike the same provider independently.

### 3. Rerank has fallback but no traffic shaping

Voyage rerank already falls back to local reranking on failure, but it still sends requests immediately with no shared concurrency or short-term cache. This means repeated identical recall queries can continue generating avoidable remote traffic.

### 4. Batch capability is not abstracted

The codebase does not currently expose a provider-neutral `embedMany()` abstraction. That leaves migration and future bulk flows without a clean place to apply batching when a provider supports it.

## Recommended Approach

Introduce two shared runtime clients:

- `EmbeddingClient`
- `RerankClient`

Each client wraps provider calls behind the same control stages:

1. normalize request key
2. return cached result if fresh
3. join identical in-flight request if present
4. acquire provider-specific concurrency slot
5. respect provider cooldown if active
6. execute request
7. on `429` / retryable failure, apply exponential backoff with jitter
8. cache successful result

This keeps provider-specific code narrow while making rate-limit behavior consistent across the system.

## Architecture

### 1. `EmbeddingClient`

Primary interface:

- `embed(text, cfg): Promise<number[]>`
- `embedMany(texts, cfg): Promise<number[][]>`

Phase 1 requirement:

- `embedMany()` exists as the shared abstraction even if some providers internally fall back to sequential or limited-concurrency single requests.

Control behavior:

- request key based on `provider + baseUrl + model + dimension + normalizedText`
- in-flight map keyed by the request key
- short TTL memory cache for repeated identical calls
- provider-level semaphore keyed by provider/baseUrl/model
- cooldown window after `429`

### 2. `RerankClient`

Primary interface:

- `rerank(query, documents, cfg): Promise<number[]>` or equivalent ranked ordering payload

Batching note:

Rerank is already structurally “one query, many documents,” so the main optimization target is not multi-query batching. The main gains come from:

- deduping identical rerank requests
- caching short-lived identical rerank results
- limiting outbound concurrency
- cooling down after `429`

### 3. Provider adapters

Keep provider-specific code thin:

- Voyage embedding adapter
- AI SDK backed embedding adapter for other providers
- Voyage rerank adapter

The shared clients own scheduling and retry policy. Adapters only translate one logical request into provider I/O.

### 4. Integration points

Phase 1 integrations:

- `src/hot/search.ts`
  - query embedding goes through `EmbeddingClient`
- `src/hot/migration-worker.ts`
  - migration embedding goes through `EmbeddingClient`
  - worker-local retry logic should shrink or defer to the shared client to avoid double policy layers
- `src/recall/reranker.ts`
  - remote rerank path goes through `RerankClient`

## Batch Strategy

### Embedding

Expose batch capability in the shared interface now.

Provider policy:

- if provider supports multi-input embedding efficiently, use it
- otherwise, degrade to controlled single-call execution through the same limiter

This gives migration an immediate place to batch without forcing all providers to implement it up front.

### Rerank

Do not add “batch rerank across multiple queries” in phase 1.

That adds complexity with limited gain compared with:

- eliminating duplicate rerank calls
- reducing concurrent rerank pressure
- caching repeated recall attempts

## Rate Limit Policy

Recommended phase 1 defaults:

- max concurrent remote embedding requests per provider key: low single digits
- max concurrent remote rerank requests per provider key: low single digits
- exponential backoff with jitter for `429` and retryable `5xx`
- short cooldown timestamp after a confirmed `429`

These values should be configurable internally first, and only exposed to user config later if there is clear demand.

## Caching Policy

### Embedding cache

- short TTL for query embeddings
- longer in-process reuse for migration text embeddings
- keyed strictly by provider/model/baseUrl/dimension/text

### Rerank cache

- short TTL only
- keyed by provider/model/baseUrl/query/document set

The cache is process-local and best-effort. It is an optimization, not a correctness dependency.

## Error Handling

- non-retryable failures should surface immediately to the current caller
- retryable failures should be retried inside the client
- repeated `429` should update cooldown state and slow subsequent requests
- rerank should preserve current fallback behavior when remote rerank ultimately fails
- search embedding failure should preserve current fallback behavior where possible

## Testing Strategy

### Unit tests

- identical concurrent embed requests share one provider call
- identical concurrent rerank requests share one provider call
- cache hits avoid second provider call within TTL
- concurrency limiter does not exceed configured max
- `429` triggers backoff/cooldown behavior
- `embedMany()` preserves input/output ordering

### Integration tests

- hot search uses the shared embedding client
- migration worker uses the shared embedding client
- recall reranker uses the shared rerank client
- local fallback behavior remains intact when remote rerank fails

## Worktree

Implementation should happen in:

- `.worktrees/feature-rate-limit-governor`

That keeps the new runtime coordination layer isolated from `main` while the design and tests evolve.
