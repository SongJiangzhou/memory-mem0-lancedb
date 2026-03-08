import { openMemoryTable } from '../db/table';
import { embedText } from './embedder';
import { discoverMemoryTables } from './table-discovery';
import type { PluginConfig } from '../types';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 20;

export class EmbeddingMigrationWorker {
  private readonly config: PluginConfig;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(config: PluginConfig) {
    this.config = config;
  }

  start(intervalMs: number = this.getMigrationConfig().intervalMs): void {
    if (this.timer || !this.getMigrationConfig().enabled) {
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
    if (this.running || !this.getMigrationConfig().enabled) {
      return;
    }

    this.running = true;
    try {
      await this.migrateBatch();
    } finally {
      this.running = false;
    }
  }

  protected async upsertCurrentRow(row: Record<string, unknown>): Promise<void> {
    const currentDim = this.config.embedding?.dimension || 16;
    const targetTable = await openMemoryTable(this.config.lancedbPath, currentDim);

    await targetTable.mergeInsert('memory_uid')
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute([row]);
  }

  private async migrateBatch(): Promise<void> {
    const currentDim = this.config.embedding?.dimension || 16;
    const batchSize = this.getMigrationConfig().batchSize;
    const tables = await discoverMemoryTables(this.config.lancedbPath, currentDim);
    const legacyTables = tables.filter((table) => table.dimension !== currentDim);

    if (legacyTables.length === 0) {
      return;
    }

    let remaining = batchSize;
    for (const tableInfo of legacyTables) {
      if (remaining <= 0) {
        break;
      }

      const sourceTable = await openMemoryTable(this.config.lancedbPath, tableInfo.dimension);
      const rows = await sourceTable
        .query()
        .where("status != 'deleted'")
        .limit(remaining)
        .toArray();

      for (const row of rows) {
        if (remaining <= 0) {
          break;
        }

        if (!this.shouldMigrateRow(row)) {
          continue;
        }

        try {
          const migratedRow = this.toMigratedRow(
            row,
            await embedText(String(row.text || ''), this.config.embedding),
          );

          await this.upsertCurrentRow(migratedRow);
          await sourceTable.delete(`memory_uid = '${escapeSqlString(String(row.memory_uid || ''))}'`);
          remaining -= 1;
        } catch (err) {
          console.error(
            `[EmbeddingMigrationWorker] Failed to migrate memory_uid=${String(row.memory_uid || '')} `
            + `from d${tableInfo.dimension} to d${currentDim}:`,
            err,
          );
        }
      }
    }
  }

  private shouldMigrateRow(row: any): boolean {
    if (!row?.memory_uid) {
      return false;
    }

    if (row?.status === 'deleted') {
      return false;
    }

    const text = String(row?.text || '').trim();
    if (!text) {
      return false;
    }

    return true;
  }

  private toMigratedRow(row: any, vector: number[]): Record<string, unknown> {
    return {
      memory_uid: String(row.memory_uid || ''),
      user_id: String(row.user_id || ''),
      run_id: String(row.run_id || ''),
      scope: String(row.scope || 'long-term'),
      text: String(row.text || ''),
      categories: Array.isArray(row.categories) ? [...row.categories] : [],
      tags: Array.isArray(row.tags) ? [...row.tags] : [],
      ts_event: String(row.ts_event || new Date().toISOString()),
      source: String(row.source || 'openclaw'),
      status: String(row.status || 'active'),
      sensitivity: String(row.sensitivity || 'internal'),
      openclaw_refs: String(row.openclaw_refs || '{}'),
      mem0_id: String(row.mem0_id || ''),
      mem0_event_id: String(row.mem0_event_id || ''),
      mem0_hash: String(row.mem0_hash || ''),
      lancedb_row_key: String(row.lancedb_row_key || row.memory_uid || ''),
      vector,
    };
  }

  private getMigrationConfig() {
    return {
      enabled: this.config.embeddingMigration?.enabled ?? true,
      intervalMs: this.config.embeddingMigration?.intervalMs || DEFAULT_INTERVAL_MS,
      batchSize: this.config.embeddingMigration?.batchSize || DEFAULT_BATCH_SIZE,
    };
  }
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}
