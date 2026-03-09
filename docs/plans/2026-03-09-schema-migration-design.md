# Schema Migration & Compatible Write Design

**Date:** 2026-03-09
**Topic:** LanceDB Schema Mismatch & Auto-Migration

## Overview
Based on user reports (`Found field not in schema: memory_type at row 0`), the plugin fails to write to existing LanceDB tables if the code has been updated with new schema fields (`memory_type`, `domains`, etc.) but the physical `.lance` table on disk still uses the old schema. LanceDB does not support dynamic `ALTER TABLE ADD COLUMN` transparently without recreating the table.

This design document outlines a robust, idempotent approach to ensure the plugin never crashes on write while seamlessly migrating older schemas in the background.

## Approach: Compatible Write + Automatic Background Migration

### 1. Compatible Write Protection (Fail-safe layer)
We will implement schema detection and dynamic field clipping to allow writing to outdated tables without throwing an error.

*   **`src/db/table.ts` Modifications**:
    *   Introduce `getTableSchemaFields(table: lancedb.Table): Promise<Set<string>>` to interrogate the exact fields a table supports.
    *   Introduce `sanitizeRecordsForSchema(records: Record<string, unknown>[], allowedFields: Set<string>)` which drops any keys not present in `allowedFields`.
*   **Write paths (`src/bridge/adapter.ts`, `src/hot/migration-worker.ts`)**:
    *   Before `table.mergeInsert(key).execute(records)`, records will be passed through the sanitizer.
    *   *Result:* Immediate bug fix. Outdated tables remain fully operational for reading and writing, missing fields will simply fall back to their runtime defaults during retrieval.

### 2. Automatic Background Schema Migration
To eliminate the tech debt of outdated tables, we will reuse the existing `EmbeddingMigrationWorker` to handle schema migrations for tables of the *current* dimension.

*   **`src/hot/migration-worker.ts` Enhancements**:
    *   During `migrateBatch()`, inspect the currently active table (`memory_records_d${currentDim}`).
    *   If it lacks key fields (e.g., `memory_type`), we classify it as an "outdated schema table".
    *   The worker will **rename** its physical directory (`memory_records_d${currentDim}.lance` -> `memory_records_d${currentDim}_legacy_${timestamp}.lance`).
    *   *Crucial Detail:* Renaming the directory effectively hides it. The very next write or read by the plugin will trigger `openMemoryTable`, which, seeing no table, will cleanly `createTable` with the **new, complete schema**.
*   **`src/hot/table-discovery.ts` Enhancements**:
    *   Update `discoverMemoryTables` regex to match and return tables with `_legacy_` suffixes.
    *   The `EmbeddingMigrationWorker` natively processes these legacy tables just like tables of a different dimension: it reads the records, fills in the new default values (via `toMigratedRow`), and upserts them into the newly created active table.
    *   Once fully drained, the legacy table is renamed to `.bak` and cleaned up.

## Error Handling & Idempotency
*   **Atomic Rename:** Node's `fs.renameSync` guarantees that the table swap is immediate.
*   **Idempotency:** If the worker is interrupted, it just resumes reading from the `_legacy` table and `mergeInsert` handles deduping via `memory_uid`.
*   **Read Fallbacks:** `search.ts` already sets `memory_type: row.memory_type || 'generic'`, so querying the old/legacy tables mid-migration is fully supported.
