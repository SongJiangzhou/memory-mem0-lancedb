import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LanceDbMemoryAdapter } from '../../src/bridge/adapter';

test('LanceDbMemoryAdapter finds duplicates by mem0 hash without scanning unrelated rows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'adapter-dup-'));

  try {
    const adapter = new LanceDbMemoryAdapter(dir, {
      provider: 'fake',
      baseUrl: '',
      apiKey: '',
      model: '',
      dimension: 16,
    });

    await adapter.upsertMemory({
      memory_uid: 'dup-1',
      memory: {
        user_id: 'user-1',
        run_id: '',
        scope: 'long-term',
        text: 'User prefers grilled chicken burgers',
        categories: ['preference'],
        tags: [],
        memory_type: 'preference',
        domains: ['food'],
        source_kind: 'user_explicit',
        confidence: 0.9,
        ts_event: '2026-03-11T00:00:00.000Z',
        source: 'openclaw',
        status: 'active',
        sensitivity: 'internal',
        openclaw_refs: {},
        mem0: {
          mem0_id: null,
          event_id: null,
          hash: 'mem0-dup-hash',
        },
      },
    });

    const duplicate = await adapter.findDuplicateMemoryUid({
      user_id: 'user-1',
      run_id: '',
      scope: 'long-term',
      text: 'Different wording, same Mem0 fact',
      categories: ['preference'],
      tags: [],
      memory_type: 'preference',
      domains: ['food'],
      source_kind: 'assistant_inferred',
      confidence: 0.8,
      ts_event: '2026-03-11T00:05:00.000Z',
      source: 'openclaw',
      status: 'active',
      sensitivity: 'internal',
      openclaw_refs: {},
      mem0: {
        mem0_id: null,
        event_id: null,
        hash: 'mem0-dup-hash',
      },
    });

    assert.equal(duplicate, 'dup-1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
