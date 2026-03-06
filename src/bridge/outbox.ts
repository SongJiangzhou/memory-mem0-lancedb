import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type { OutboxItem, OutboxStatus } from '../types';

type OutboxState = {
  nextId: number;
  items: OutboxItem[];
};

const EMPTY_STATE: OutboxState = {
  nextId: 1,
  items: [],
};

export class FileOutbox {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async enqueue(idempotencyKey: string, payload: string): Promise<boolean> {
    const state = await this.readState();
    if (state.items.some((item) => item.idempotencyKey === idempotencyKey)) {
      return false;
    }

    state.items.push({
      id: state.nextId,
      idempotencyKey,
      payload,
      status: 'pending',
    });
    state.nextId += 1;

    await this.writeState(state);
    return true;
  }

  async claimNext(): Promise<OutboxItem | null> {
    const state = await this.readState();
    const next = state.items.find((item) => item.status === 'pending');
    if (!next) {
      return null;
    }

    next.status = 'processing';
    await this.writeState(state);
    return { ...next };
  }

  async markDone(id: number): Promise<void> {
    await this.updateStatus(id, 'done');
  }

  async markFailed(id: number): Promise<void> {
    await this.updateStatus(id, 'failed');
  }

  async getStatus(id: number): Promise<OutboxStatus | null> {
    const state = await this.readState();
    const item = state.items.find((candidate) => candidate.id === id);
    return item?.status || null;
  }

  private async updateStatus(id: number, status: OutboxStatus): Promise<void> {
    const state = await this.readState();
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item) {
      return;
    }

    item.status = status;
    await this.writeState(state);
  }

  private async readState(): Promise<OutboxState> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<OutboxState>;

      return {
        nextId: Number(parsed.nextId || 1),
        items: Array.isArray(parsed.items) ? parsed.items : [],
      };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ...EMPTY_STATE, items: [] };
      }
      throw error;
    }
  }

  private async writeState(state: OutboxState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), 'utf-8');
  }
}
