# Design: Background Embedding Migration Worker

Date: 2026-03-08

## Problem

The plugin now supports multiple LanceDB memory tables partitioned by embedding dimension. New writes always target the table for the currently configured embedding dimension, while search can still read older tables as text-only fallback.

This means older records remain searchable, but they do not participate in current-dimension vector retrieval. When the embedding model or dimension changes, historical records should be gradually re-embedded into the current table without blocking normal search or write paths.

## Goal

Add a lightweight background migration worker that periodically scans old-dimension LanceDB tables, re-embeds records with the current embedding configuration, writes them into the current-dimension table, and deletes the source record only after the destination write succeeds.

## Scope

**Changed:**
- add a dedicated migration worker
- start the worker from plugin registration
- add migration configuration
- add tests for migration success and failure behavior

**Unchanged:**
- `memoryStore` request semantics
- `HotMemorySearch` ranking behavior
- Mem0 polling protocol
- LanceDB table naming convention

## Recommended Approach

Use a standalone `EmbeddingMigrationWorker` driven by a low-frequency timer. Do not attach migration to `Mem0Poller`, and do not trigger it from search requests.

This keeps the concern local to LanceDB maintenance:

- Mem0 sync remains responsible for remote-to-local data movement.
- Search remains responsible for retrieval only.
- Migration remains responsible for background index convergence after embedding dimension changes.

## Why This Approach

### Option A: Standalone background worker

This is the recommended option.

Pros:
- clear separation of concerns
- low risk to existing search and write paths
- easy to throttle with interval and batch size
- easy to observe with dedicated logs

Cons:
- adds one more timer-managed component

### Option B: Extend `Mem0Poller`

Pros:
- one less class to start and stop

Cons:
- mixes remote sync with local re-indexing
- harder to reason about failures
- harder to evolve independently later

### Option C: Opportunistic migration from search hits

Pros:
- migrates hot data first

Cons:
- not sufficient for eventual full convergence
- adds complexity to the search path
- migration progress becomes workload-dependent

## Architecture

Add a new worker, preferably in `src/hot/migration-worker.ts`, with:

- `start(intervalMs?: number): void`
- `stop(): void`
- `runOnce(): Promise<void>`

The worker uses the existing LanceDB table naming scheme to discover all memory tables, identifies tables whose dimension differs from `config.embedding.dimension`, and processes a small number of rows per run.

The plugin entrypoint creates and starts the worker alongside the existing poller.

## Shared Table Discovery

`src/hot/search.ts` already contains table discovery logic. That logic should be extracted into a shared helper so both search and migration rely on the same table resolution rules.

Recommended helper:

- `src/hot/table-discovery.ts`

Suggested API:

***REMOVED***ts
export interface MemoryTableInfo {
  dimension: number;
  name: string;
}

export async function discoverMemoryTables(dbPath: string, currentDim?: number): Promise<MemoryTableInfo[]>
***REMOVED***

Sorting should continue to prioritize the current dimension for search. The migration worker can reuse the same helper and filter out the current table.

## Data Flow

Each `runOnce()` should follow this sequence:

1. Resolve `currentDim` from `config.embedding.dimension`
2. Discover all memory tables
3. Filter to source tables where `dimension !== currentDim`
4. Read a small batch of candidate rows from one or more old tables
5. For each row:
   - validate `memory_uid`
   - validate non-empty `text`
   - compute a new vector using the current embedding config
   - upsert into the current-dimension table using `mergeInsert('memory_uid')`
   - delete the source row only after the destination upsert succeeds

This produces eventual convergence while preserving data safety.

## Batch Strategy

The worker should be intentionally conservative.

Recommended defaults:

- `enabled: true`
- `intervalMs: 15 * 60 * 1000`
- `batchSize: 20`

Each run should process at most `batchSize` rows total. It should not attempt a full-database sweep in one interval.

This approximates "idle migration" without relying on OS-level idle detection, which is not a good fit for the current plugin runtime.

## Config

Extend `PluginConfig` with:

***REMOVED***ts
embeddingMigration: {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
}
***REMOVED***

Add defaults in `src/index.ts` during config resolution.

## Record Selection

The first version should only migrate records with meaningful search value.

Recommended behavior:

- include `status = 'active'`
- include `status = 'superseded'`
- skip `status = 'deleted'`
- skip rows with empty or missing `text`

Skipping deleted rows keeps the worker focused on records that should participate in retrieval.

## Consistency and Idempotency

No separate migration checkpoint table is required in the first version.

Idempotency is achieved through:

- destination write by `memory_uid`
- source delete only after successful destination upsert
- periodic retry if a record remains in an old table

Failure cases behave acceptably:

- if embedding fails, the old row stays in place
- if destination write fails, the old row stays in place
- if the process exits after destination write but before source delete, a temporary duplicate may exist across dimensions, and the next run can safely remove the old copy

This is a good tradeoff for a lightweight first version.

## Concurrency Control

The worker should guard against overlapping runs with an internal `running` flag.

If the timer fires while a previous run is still active, the new run should be skipped. This avoids duplicate work and reduces provider pressure.

The first version should remain single-threaded within a run. Do not add parallel embedding jobs yet.

## Search Behavior During Migration

No search behavior change is required.

Before migration:
- current-dimension table participates in hybrid retrieval
- old-dimension tables participate in FTS fallback

After migration of a record:
- the record exists only in the current-dimension table
- it naturally enters the current hybrid path

This means migration improves retrieval quality over time without requiring a search rewrite.

## Error Handling and Logging

The worker should log:

- startup and shutdown
- number of old tables discovered
- number of rows processed in a run
- number of successes and failures
- row-level failure details including `memory_uid`, source dimension, and target dimension

Failures should never stop future scheduled runs.

## Testing

Add integration-oriented tests covering:

1. record from an old-dimension table is re-embedded into the current-dimension table
2. source row is deleted only after successful destination write
3. source row is retained if destination write fails
4. worker exits quietly when there are no old-dimension tables

Tests should use temporary LanceDB directories, following the style already used by the hot search tests.

## Non-Goals

The first version does not include:

- OS-level idle detection
- migration progress UI
- a dedicated migration checkpoint table
- concurrent embedding workers
- special handling for deleted-record cleanup
- migration triggered by search or write requests

## Summary

The best first implementation is a low-frequency standalone migration worker that converges old records into the current embedding dimension table in small batches. It is minimally invasive, operationally simple, and safe because it only deletes source rows after successful destination writes.
