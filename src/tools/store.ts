import * as crypto from 'node:crypto';

import { LanceDbMemoryAdapter } from '../bridge/adapter';
import { FileOutbox } from '../bridge/outbox';
import { MemorySyncEngine } from '../bridge/sync-engine';
import type { MemorySyncPayload, PluginConfig, StoreParams, StoreResult } from '../types';

export class MemoryStoreTool {
  private config: PluginConfig;

  constructor(config: PluginConfig) {
    this.config = config;
  }

  async execute(params: StoreParams): Promise<StoreResult> {
    const { text, userId, scope = 'long-term', metadata = {}, categories = [] } = params;

    try {
      const mem0EventId = await this.storeToMem0IfConfigured({
        text,
        userId,
        scope,
        metadata,
        categories,
      });
      const eventId = mem0EventId || `local-${crypto.randomUUID()}`;
      const outbox = new FileOutbox(this.config.outboxDbPath);
      const adapter = new LanceDbMemoryAdapter(this.config.lancedbPath);
      const engine = new MemorySyncEngine(outbox, adapter);
      const payload = this.buildPayload({
        text,
        userId,
        scope,
        metadata,
        categories,
        eventId,
      });
      const result = await engine.processEvent(eventId, payload);

      if (result.status === 'done' || result.status === 'duplicate') {
        return { success: true, memoryUid: result.memory_uid, eventId };
      }

      return { success: false, memoryUid: result.memory_uid, eventId, error: result.status };
    } catch (err: any) {
      console.error('[memoryStore] Failed:', err);
      return { success: false, error: err.message || 'Unknown error' };
    }
  }

  private buildPayload(params: {
    text: string;
    userId: string;
    scope: 'long-term' | 'session';
    metadata: Record<string, any>;
    categories: string[];
    eventId: string;
  }): MemorySyncPayload {
    return {
      user_id: params.userId,
      run_id: params.metadata.run_id || '',
      scope: params.scope,
      text: params.text,
      categories: params.categories,
      tags: Array.isArray(params.metadata.tags) ? params.metadata.tags : [],
      ts_event: new Date().toISOString(),
      source: 'openclaw',
      status: 'active',
      sensitivity: params.metadata.sensitivity || 'internal',
      openclaw_refs: params.metadata.openclaw_refs || {},
      mem0: {
        event_id: params.eventId,
        hash: params.metadata.mem0_hash || null,
        mem0_id: params.metadata.mem0_id || null,
      },
    };
  }

  private async storeToMem0IfConfigured(params: {
    text: string;
    userId: string;
    scope: string;
    metadata: Record<string, any>;
    categories: string[];
  }): Promise<string | null> {
    if (!this.config.mem0ApiKey) {
      return null;
    }

    const url = `${this.config.mem0BaseUrl}/v1/memories/`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${this.config.mem0ApiKey}`,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: params.text }],
        user_id: params.userId,
        metadata: {
          ...params.metadata,
          scope: params.scope,
          categories: params.categories,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Mem0 store failed: ${response.status}`);
    }

    const data: any = await response.json();
    return data.id || data.event_id || null;
  }
}
