# Embedding Migration Worker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a lightweight background worker that periodically re-embeds records from old-dimension LanceDB tables into the currently configured embedding-dimension table, deleting the source row only after the destination upsert succeeds.

**Architecture:** Introduce a standalone `EmbeddingMigrationWorker` started from plugin registration. Reuse shared memory-table discovery, process a small batch on a timer, and keep the workflow idempotent through destination upsert plus post-success source deletion. Search behavior stays unchanged and continues to read old tables until migration converges.

**Tech Stack:** Node.js, TypeScript, LanceDB, existing `embedText()` helper, Node test runner

---

### Task 1: Add failing tests for background migration

**Files:**
- Create: `tests/hot/migration-worker.test.ts`
- Reference: `tests/hot/search.test.ts`
- Reference: `src/db/table.ts`

**Step 1: Write the first failing test for successful migration**

Create `tests/hot/migration-worker.test.ts` with a test that:

- creates a temporary LanceDB directory
- opens an old-dimension table such as `memory_records_d768`
- inserts one valid row with `memory_uid`, `text`, and `status = 'active'`
- configures the worker with current dimension `16` and `provider: 'fake'`
- calls `runOnce()`
- asserts the row now exists in the current table
- asserts the old table no longer contains the row

Use a fixture row shaped like:

***REMOVED***ts
const row = {
  memory_uid: 'memory-1',
  user_id: 'user-1',
  run_id: '',
  scope: 'long-term',
  text: 'User prefers concise answers',
  categories: ['preference'],
  tags: [],
  ts_event: new Date().toISOString(),
  source: 'openclaw',
  status: 'active',
  sensitivity: 'internal',
  openclaw_refs: '{}',
  mem0_id: '',
  mem0_event_id: '',
  mem0_hash: '',
  lancedb_row_key: 'memory-1',
  vector: new Array<number>(768).fill(0),
};
***REMOVED***

**Step 2: Add a failing test for write failure retention**

In the same file, add a test that monkey-patches the destination table write path or the worker's destination upsert helper to throw. Assert that after `runOnce()`:

- the old row still exists
- the current table does not contain a migrated copy

**Step 3: Add two smaller edge-case tests**

Add tests that verify:

- worker exits without error when only the current-dimension table exists
- rows with `status = 'deleted'` or empty `text` are skipped and remain untouched

**Step 4: Run the test file to verify failure**

Run: `npm run build && node --test dist/tests/hot/migration-worker.test.js`

Expected: FAIL because the worker and shared discovery helper do not exist yet.

**Step 5: Commit**

***REMOVED***bash
git add tests/hot/migration-worker.test.ts
git commit -m "test: add failing coverage for background embedding migration"
***REMOVED***

### Task 2: Extract shared memory-table discovery

**Files:**
- Create: `src/hot/table-discovery.ts`
- Modify: `src/hot/search.ts`
- Test: `tests/hot/search.test.ts`

**Step 1: Create a shared discovery helper**

Add `src/hot/table-discovery.ts`:

***REMOVED***ts
import * as lancedb from '@lancedb/lancedb';
import * as os from 'os';
import * as path from 'path';

export interface MemoryTableInfo {
  dimension: number;
  name: string;
}

export async function discoverMemoryTables(dbPath: string, currentDim?: number): Promise<MemoryTableInfo[]> {
  const resolvedPath = dbPath.startsWith('~/')
    ? path.join(os.homedir(), dbPath.slice(2))
    : dbPath;

  const db = await lancedb.connect(resolvedPath);
  const tableNames = await db.tableNames();
  const tables: MemoryTableInfo[] = [];

  for (const name of tableNames) {
    if (name === 'memory_records') {
      tables.push({ dimension: 16, name });
      continue;
    }

    const match = name.match(/^memory_records_d(\d+)$/);
    if (match) {
      tables.push({ dimension: parseInt(match[1], 10), name });
    }
  }

  if (typeof currentDim === 'number') {
    tables.sort((a, b) => {
      if (a.dimension === currentDim) return -1;
      if (b.dimension === currentDim) return 1;
      return b.dimension - a.dimension;
    });
  }

  return tables;
}
***REMOVED***

**Step 2: Update `HotMemorySearch` to use the helper**

Replace the inline `discoverTables()` logic in `src/hot/search.ts` with a call to `discoverMemoryTables(this.config.lancedbPath, currentDim)`.

**Step 3: Build and run hot search tests**

Run: `npm run build && node --test dist/tests/hot/search.test.js`

Expected: PASS, proving the extraction did not change behavior.

**Step 4: Commit**

***REMOVED***bash
git add src/hot/table-discovery.ts src/hot/search.ts
git commit -m "refactor: share LanceDB memory table discovery"
***REMOVED***

### Task 3: Add migration config defaults

**Files:**
- Modify: `src/types.ts`
- Modify: `src/index.ts`
- Test: `tests/index.test.ts`

**Step 1: Extend plugin config types**

Add to `src/types.ts`:

***REMOVED***ts
export interface EmbeddingMigrationConfig {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
}
***REMOVED***

and include:

***REMOVED***ts
embeddingMigration: EmbeddingMigrationConfig;
***REMOVED***

inside `PluginConfig`.

**Step 2: Add config defaults in `resolveConfig()`**

In `src/index.ts`, add:

***REMOVED***ts
embeddingMigration: {
  enabled: raw?.embeddingMigration?.enabled ?? true,
  intervalMs: raw?.embeddingMigration?.intervalMs || 15 * 60 * 1000,
  batchSize: raw?.embeddingMigration?.batchSize || 20,
},
***REMOVED***

**Step 3: Update config tests**

Adjust `tests/index.test.ts` fixtures and assertions to include `embeddingMigration`.

Add assertions for:

- default enabled state
- default interval
- default batch size
- override support from plugin config

**Step 4: Run the config tests**

Run: `npm run build && node --test dist/tests/index.test.js`

Expected: PASS

**Step 5: Commit**

***REMOVED***bash
git add src/types.ts src/index.ts tests/index.test.ts
git commit -m "feat: add embedding migration config defaults"
***REMOVED***

### Task 4: Implement `EmbeddingMigrationWorker`

**Files:**
- Create: `src/hot/migration-worker.ts`
- Reference: `src/hot/embedder.ts`
- Reference: `src/db/table.ts`
- Reference: `src/hot/table-discovery.ts`

**Step 1: Add the worker class**

Create `src/hot/migration-worker.ts` with:

***REMOVED***ts
import { openMemoryTable } from '../db/table';
import { embedText } from './embedder';
import { discoverMemoryTables } from './table-discovery';
import type { PluginConfig } from '../types';

export class EmbeddingMigrationWorker {
  private readonly config: PluginConfig;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(config: PluginConfig) {
    this.config = config;
  }

  start(intervalMs: number = this.config.embeddingMigration.intervalMs): void {
    if (this.timer || !this.config.embeddingMigration.enabled) {
      return;
    }

    this.timer = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      await this.migrateBatch();
    } finally {
      this.running = false;
    }
  }

  private async migrateBatch(): Promise<void> {
    // implementation added in the next steps
  }
}
***REMOVED***

**Step 2: Implement source-table filtering and batch selection**

Inside `migrateBatch()`:

- read `currentDim`
- call `discoverMemoryTables()`
- filter `dimension !== currentDim`
- iterate old tables in stable order
- read rows with a query shaped like:

***REMOVED***ts
const rows = await sourceTable
  .query()
  .where("status != 'deleted'")
  .limit(remaining)
  .toArray();
***REMOVED***

Also skip rows whose `text` is empty after trimming.

**Step 3: Implement per-row migration**

For each candidate row:

- compute `vector = await embedText(row.text, this.config.embedding)`
- open the current-dimension table
- upsert a copy of the row with the new vector
- delete the source row only after upsert succeeds:

***REMOVED***ts
await sourceTable.delete(`memory_uid = '${row.memory_uid}'`);
***REMOVED***

Reuse the original metadata fields. Keep the same `memory_uid` and `lancedb_row_key`.

**Step 4: Add row-level error isolation**

Wrap each row migration in `try/catch` so one failure does not abort the whole batch.

Log:

- `memory_uid`
- source dimension
- target dimension
- error

**Step 5: Build and run the migration worker tests**

Run: `npm run build && node --test dist/tests/hot/migration-worker.test.js`

Expected: PASS

**Step 6: Commit**

***REMOVED***bash
git add src/hot/migration-worker.ts
git commit -m "feat: add background embedding migration worker"
***REMOVED***

### Task 5: Start the worker from plugin registration

**Files:**
- Modify: `src/index.ts`
- Test: `tests/index.test.ts`

**Step 1: Wire the worker into plugin startup**

Import and instantiate the worker in `register()`:

***REMOVED***ts
const migrationWorker = new EmbeddingMigrationWorker(cfg);
migrationWorker.start();
***REMOVED***

Place it near the existing `Mem0Poller` startup so lifecycle behavior is obvious.

**Step 2: Add a registration-level test if practical**

If `tests/index.test.ts` already stubs register behavior, add an assertion that startup does not throw when migration config is enabled. If direct timer assertions are awkward, keep the test minimal and rely on unit coverage in `migration-worker.test.ts`.

**Step 3: Run the related tests**

Run: `npm run build && node --test dist/tests/index.test.js dist/tests/hot/migration-worker.test.js`

Expected: PASS

**Step 4: Commit**

***REMOVED***bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: start embedding migration worker during plugin registration"
***REMOVED***

### Task 6: Verify the full suite

**Step 1: Run the build**

Run: `npm run build`

Expected: PASS

**Step 2: Run the full test suite**

Run: `npm test`

Expected: all existing tests plus new migration-worker coverage pass

**Step 3: Spot-check the new worker logs or behavior if needed**

Optionally run a small local script or targeted test again to confirm that:

- old-dimension rows move into the current table
- old copies are deleted only after successful writes

**Step 4: Commit final verification state**

***REMOVED***bash
git add .
git commit -m "test: verify background embedding migration end-to-end"
***REMOVED***
