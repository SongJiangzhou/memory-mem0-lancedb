import { embedText } from './embedder';
import { openMemoryTable } from '../db/table';
import { getMemoryTableName } from '../db/schema';
import type { PluginConfig, SearchParams, SearchResult } from '../types';

const RRF_K = 60;
const MMR_LAMBDA = 0.5;
const SIMILARITY_THRESHOLD = 0.85;

export class HotMemorySearch {
  private readonly config: PluginConfig;

  constructor(config: PluginConfig) {
    this.config = config;
  }

  async search(params: SearchParams): Promise<SearchResult> {
    const { query, userId, topK = 5, filters } = params;
    const dim = this.config.embedding?.dimension || 16;
    const tbl = await openMemoryTable(this.config.lancedbPath, dim);
    const whereClause = this.buildWhereClause(userId, filters);
    
    // We fetch more for MMR pool
    const fetchK = topK * 3;
    const ftsRows = await this.searchFts(tbl, query, whereClause, fetchK);
    const vectorRows = await this.searchVector(tbl, query, whereClause, fetchK);
    
    let rows = this.mergeRrf(ftsRows, vectorRows, fetchK);

    if (rows.length === 0) {
      const fallbackRows = await tbl.query().where(whereClause).limit(fetchK).toArray();
      const needle = query.toLowerCase();
      rows = fallbackRows.filter((row: any) => String(row.text || '').toLowerCase().includes(needle));
    }

    if (rows.length > 0) {
      const queryVector = await embedText(query, this.config.embedding);
      const ranked = this.applyTimeDecay(rows);
      const deduplicated = this.applyMmr(ranked, queryVector, topK);
      return {
        memories: deduplicated.map((row) => this.toMemoryRecord(row, dim)),
        source: 'lancedb',
      };
    }

    return {
      memories: [],
      source: 'lancedb',
    };
  }

  private buildWhereClause(userId: string, filters?: SearchParams['filters']): string {
    let whereClause = `user_id = '${userId}' AND status = 'active'`;
    if (filters?.scope) {
      whereClause += ` AND scope = '${filters.scope}'`;
    }
    if (filters?.status) {
      whereClause = `user_id = '${userId}' AND status = '${filters.status}'`;
    }
    return whereClause;
  }

  private async searchFts(tbl: Awaited<ReturnType<typeof openMemoryTable>>, query: string, whereClause: string, topK: number): Promise<any[]> {
    try {
      return await (tbl as any)
        .search(query, 'fts', 'text')
        .where(whereClause)
        .limit(topK)
        .toArray();
    } catch {
      return [];
    }
  }

  private async searchVector(tbl: Awaited<ReturnType<typeof openMemoryTable>>, query: string, whereClause: string, topK: number): Promise<any[]> {
    try {
      const queryVector = await embedText(query, this.config.embedding);
      return await (tbl as any)
        .search(queryVector)
        .where(whereClause)
        .limit(topK)
        .toArray();
    } catch {
      return [];
    }
  }

  private mergeRrf(ftsRows: any[], vectorRows: any[], topK: number): any[] {
    const scored = new Map<string, { row: any; score: number }>();

    this.addRrfScores(scored, ftsRows);
    this.addRrfScores(scored, vectorRows);

    return Array.from(scored.values())
      .map((entry) => ({ ...entry.row, __rrf_score: entry.score }))
      .sort((left, right) => right.__rrf_score - left.__rrf_score)
      .slice(0, topK);
  }

  private addRrfScores(scored: Map<string, { row: any; score: number }>, rows: any[]): void {
    rows.forEach((row, index) => {
      const key = row.memory_uid;
      const rank = index + 1;
      const rrf = 1 / (RRF_K + rank);
      const existing = scored.get(key);

      if (existing) {
        existing.score += rrf;
      } else {
        scored.set(key, { row, score: rrf });
      }
    });
  }

  private applyTimeDecay(rows: any[]): any[] {
    const now = Date.now();
    return rows.map((r) => {
      let ageMs = now - new Date(r.ts_event).getTime();
      if (isNaN(ageMs) || ageMs < 0) ageMs = 0;
      const decay = Math.exp(-ageMs / (1000 * 60 * 60 * 24 * 30)); // 30-day half-life roughly
      const baseScore = r.__rrf_score || 1;
      return {
        ...r,
        __final_score: baseScore * (0.8 + 0.2 * decay),
      };
    }).sort((a, b) => b.__final_score - a.__final_score);
  }

  private applyMmr(rows: any[], queryVector: number[], topK: number): any[] {
    if (rows.length === 0) return [];
    
    const selected: any[] = [];
    const candidates = [...rows];

    while (selected.length < topK && candidates.length > 0) {
      let bestIdx = -1;
      let bestScore = -Infinity;

      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        
        // relevance to query
        const rel = candidate.__final_score; 
        
        let maxSim = 0;
        for (const sel of selected) {
          const sim = this.cosineSimilarity(candidate.vector || [], sel.vector || []);
          if (sim > maxSim) maxSim = sim;
        }

        const mmrScore = MMR_LAMBDA * rel - (1 - MMR_LAMBDA) * maxSim;

        if (mmrScore > bestScore) {
          bestScore = mmrScore;
          bestIdx = i;
        }
      }

      if (bestIdx !== -1) {
        const chosen = candidates.splice(bestIdx, 1)[0];
        // simple deduplication cutoff
        let isTooSimilar = false;
        for (const sel of selected) {
          if (this.cosineSimilarity(chosen.vector || [], sel.vector || []) > SIMILARITY_THRESHOLD) {
            isTooSimilar = true;
            break;
          }
        }
        
        if (!isTooSimilar) {
          selected.push(chosen);
        }
      } else {
        break;
      }
    }

    return selected;
  }

  private cosineSimilarity(left: number[], right: number[]): number {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0) {
      return 0;
    }

    const length = Math.min(left.length, right.length);
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;

    for (let index = 0; index < length; index += 1) {
      const l = Number(left[index] || 0);
      const r = Number(right[index] || 0);
      dot += l * r;
      leftNorm += l * l;
      rightNorm += r * r;
    }

    if (leftNorm === 0 || rightNorm === 0) {
      return 0;
    }

    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  }

  private toMemoryRecord(row: any, dim: number) {
    return {
      memory_uid: row.memory_uid,
      user_id: row.user_id,
      run_id: row.run_id || null,
      scope: row.scope,
      text: row.text,
      categories: Array.isArray(row.categories) ? row.categories : [],
      tags: Array.isArray(row.tags) ? row.tags : [],
      ts_event: row.ts_event,
      source: 'openclaw' as const,
      status: row.status,
      sensitivity: row.sensitivity,
      openclaw_refs: this.parseJsonObj(row.openclaw_refs),
      mem0: {
        mem0_id: row.mem0_id || null,
        event_id: row.mem0_event_id || null,
        hash: row.mem0_hash || null,
      },
      lancedb: {
        table: getMemoryTableName(dim),
        row_key: row.lancedb_row_key || row.memory_uid,
        vector_dim: Array.isArray(row.vector) ? row.vector.length : null,
        index_version: 'rrf-v1',
      },
    };
  }

  private parseJsonObj(value: string): Record<string, any> {
    try {
      return JSON.parse(value || '{}');
    } catch {
      return {};
    }
  }
}
