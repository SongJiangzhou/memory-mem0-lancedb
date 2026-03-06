import { buildMemoryUid } from './uid';
import type { MemoryAdapter } from './adapter';
import type { FileOutbox } from './outbox';
import type { MemorySyncPayload, MemorySyncResult } from '../types';

export class MemorySyncEngine {
  private readonly outbox: FileOutbox;
  private readonly adapter: MemoryAdapter;

  constructor(outbox: FileOutbox, adapter: MemoryAdapter) {
    this.outbox = outbox;
    this.adapter = adapter;
  }

  async processEvent(eventId: string, memory: MemorySyncPayload): Promise<MemorySyncResult> {
    const category = (memory.categories || ['general'])[0];
    const memoryUid = buildMemoryUid(
      memory.user_id,
      memory.scope,
      memory.text,
      this.tsBucket(memory.ts_event),
      category,
    );
    const idempotencyKey = `${eventId}:${memoryUid}`;
    const payload = JSON.stringify({ event_id: eventId, memory_uid: memoryUid, memory });
    const inserted = await this.outbox.enqueue(idempotencyKey, payload);

    if (!inserted) {
      return { status: 'duplicate', memory_uid: memoryUid };
    }

    const item = await this.outbox.claimNext();
    if (!item) {
      return { status: 'no_pending', memory_uid: memoryUid };
    }

    await this.adapter.upsertMemory({ memory_uid: memoryUid, memory });

    if (!(await this.adapter.exists(memoryUid))) {
      await this.outbox.markFailed(item.id);
      return { status: 'failed_visibility', memory_uid: memoryUid };
    }

    await this.outbox.markDone(item.id);
    return { status: 'done', memory_uid: memoryUid };
  }

  private tsBucket(tsEvent: string): string {
    return new Date(tsEvent).toISOString().slice(0, 13);
  }
}
