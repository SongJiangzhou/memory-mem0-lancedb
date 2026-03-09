# Schema Migration & Compatible Write Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement compatible write protection for old LanceDB schemas and a background migration mechanism to upgrade those schemas seamlessly.

**Architecture:** Add schema probe and record sanitizer utilities in `src/db/table.ts`. Hook them up in `src/bridge/adapter.ts` and `src/hot/migration-worker.ts` to allow writing to outdated tables without errors. Extend `EmbeddingMigrationWorker` to detect outdated schemas on the active table, rename the table to a `_legacy_` suffix (triggering a fresh creation on the next write), and process it as a normal migration.

**Tech Stack:** TypeScript, Node.js Test Runner, LanceDB.

---

### Task 1: Add Schema Probe and Sanitizer Utilities

**Files:**
- Modify: `src/db/table.ts`
- Modify: `tests/db/table.test.ts`

**Step 1: Write the failing tests**

***REMOVED***typescript
import test from 'node:test';
import * as assert from 'node:assert';
import { getTableSchemaFields, sanitizeRecordsForSchema } from '../../src/db/table';

test('sanitizeRecordsForSchema strips out unknown fields', () => {
  const records = [{ a: 1, b: 2, c: 3 }, { a: 4, d: 5 }];
  const allowed = new Set(['a', 'c']);
  
  const result = sanitizeRecordsForSchema(records, allowed);
  assert.deepEqual(result, [{ a: 1, c: 3 }, { a: 4 }]);
});
***REMOVED***

**Step 2: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL with "sanitizeRecordsForSchema is not defined"

**Step 3: Write minimal implementation**

In `src/db/table.ts`, export the two utilities:

***REMOVED***typescript
export async function getTableSchemaFields(tbl: any): Promise<Set<string>> {
  const schema = await tbl.schema();
  return new Set(schema.fields.map((f: any) => f.name));
}

export function sanitizeRecordsForSchema(records: Record<string, unknown>[], allowedFields: Set<string>): Record<string, unknown>[] {
  return records.map(r => {
    const safe: Record<string, unknown> = {};
    for (const key of Object.keys(r)) {
      if (allowedFields.has(key)) {
        safe[key] = r[key];
      }
    }
    return safe;
  });
}
***REMOVED***

**Step 4: Run test to verify it passes**

Run: `npm run test`
Expected: PASS

**Step 5: Commit**

***REMOVED***bash
git add src/db/table.ts tests/db/table.test.ts
git commit -m "feat(db): add schema probe and sanitizer utilities"
***REMOVED***

---

### Task 2: Implement Compatible Write in LanceDbMemoryAdapter

**Files:**
- Modify: `src/bridge/adapter.ts`

**Step 1: Write the implementation**

In `src/bridge/adapter.ts`, import the new utilities from `../db/table`. Update `LanceDbMemoryAdapter.upsertMemory` to use them:

***REMOVED***typescript
import { openMemoryTable, getTableSchemaFields, sanitizeRecordsForSchema } from '../db/table';

// ...
  async upsertMemory(record: MemoryAdapterRecord): Promise<void> {
    const dim = this.config?.dimension || 16;
    const table = await openMemoryTable(this.lancedbPath, dim);
    const row = await toLanceRow(record, this.config);
    
    const allowedFields = await getTableSchemaFields(table);
    const safeRows = sanitizeRecordsForSchema([row as unknown as Record<string, unknown>], allowedFields);
    
    await table.mergeInsert('memory_uid')
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(safeRows);
  }
***REMOVED***

**Step 2: Verify tests still pass**

Run: `npm run test`
Expected: All existing tests should pass, as the new table mock or lancedb table will return all fields in `schema()`.

**Step 3: Commit**

***REMOVED***bash
git add src/bridge/adapter.ts
git commit -m "fix(bridge): use schema sanitizer for compatible writes in adapter"
***REMOVED***

---

### Task 3: Implement Compatible Write in Migration Worker

**Files:**
- Modify: `src/hot/migration-worker.ts`

**Step 1: Write the implementation**

In `src/hot/migration-worker.ts`, update `upsertCurrentRow` to use the sanitizer.

***REMOVED***typescript
import { openMemoryTable, getTableSchemaFields, sanitizeRecordsForSchema } from '../db/table';

// ...
  protected async upsertCurrentRow(row: Record<string, unknown>): Promise<void> {
    const currentDim = this.config.embedding?.dimension || 16;
    const targetTable = await openMemoryTable(this.config.lancedbPath, currentDim);

    const allowedFields = await getTableSchemaFields(targetTable);
    const safeRows = sanitizeRecordsForSchema([row], allowedFields);

    await targetTable.mergeInsert('memory_uid')
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(safeRows);
  }
***REMOVED***

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: PASS

**Step 3: Commit**

***REMOVED***bash
git add src/hot/migration-worker.ts
git commit -m "fix(hot): use schema sanitizer for compatible writes in migration worker"
***REMOVED***

---

### Task 4: Extend Table Discovery to Find Legacy Schema Tables

**Files:**
- Modify: `src/hot/table-discovery.ts`

**Step 1: Write the implementation**

Update the regex in `discoverMemoryTables` to match tables suffixed with `_legacy_\d+`. Since legacy tables are meant to be migrated into the current dimension, we should assign them a pseudo-dimension of `0` so they are treated as legacy (different from `currentDim`) by the worker.

***REMOVED***typescript
// inside discoverMemoryTables:
  for (const name of tableNames) {
    if (name === 'memory_records') {
      tables.push({ dimension: 16, name });
      continue;
    }

    const legacyMatch = name.match(/_legacy_\d+$/);
    if (legacyMatch) {
      tables.push({ dimension: 0, name }); // 0 ensures it's always treated as legacy
      continue;
    }

    const dimMatch = name.match(/^memory_records_d(\d+)$/);
    if (dimMatch) {
      tables.push({ dimension: parseInt(dimMatch[1], 10), name });
    }
  }
***REMOVED***

**Step 2: Verify tests**

Run: `npm run test`
Expected: PASS

**Step 3: Commit**

***REMOVED***bash
git add src/hot/table-discovery.ts
git commit -m "feat(hot): discover tables with legacy suffixes for migration"
***REMOVED***

---

### Task 5: Implement Automatic Background Schema Migration

**Files:**
- Modify: `src/hot/migration-worker.ts`

**Step 1: Write the implementation**

In `src/hot/migration-worker.ts`, add a check at the beginning of `migrateBatch()` to see if the current dimension's table lacks the `memory_type` field. If so, rename it.

***REMOVED***typescript
import { existsSync, renameSync, rmSync } from 'node:fs';

// ... inside migrateBatch(), right after resolving currentDim and BEFORE discoverMemoryTables:

    const currentDim = this.config.embedding?.dimension || 16;
    
    // Check active schema and rename if outdated
    try {
      const activeTable = await openMemoryTable(this.config.lancedbPath, currentDim);
      const activeFields = await getTableSchemaFields(activeTable);
      if (!activeFields.has('memory_type')) {
        activeTable.close?.(); // Attempt to close if lancedb supports it, but node api often doesn't need it or it's a no-op
        const tableName = currentDim === 16 ? 'memory_records' : `memory_records_d${currentDim}`;
        const dbPath = resolveLanceDbPath(this.config.lancedbPath);
        const lancePath = path.join(dbPath, `${tableName}.lance`);
        const legacyPath = path.join(dbPath, `${tableName}_legacy_${Date.now()}.lance`);
        
        if (existsSync(lancePath)) {
          renameSync(lancePath, legacyPath);
          this.debug?.basic('embedding_migration.schema_upgrade', { tableName, legacyPath });
        }
      }
    } catch (e) {
      // ignore if table doesn't exist yet
    }

    const batchSize = this.getMigrationConfig().batchSize;
    const tables = await discoverMemoryTables(this.config.lancedbPath, currentDim);
    // ... rest of migrateBatch
***REMOVED***

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: PASS

**Step 3: Commit**

***REMOVED***bash
git add src/hot/migration-worker.ts
git commit -m "feat(hot): auto-rename outdated current dimension tables for background schema migration"
***REMOVED***
