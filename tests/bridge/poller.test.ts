import test from 'node:test';
import assert from 'node:assert/strict';
import { Mem0Poller } from '../../src/bridge/poller';
import type { PluginConfig } from '../../src/types';

test('Mem0Poller starts and stops without error', () => {
  const cfg: PluginConfig = {
    lancedbPath: '/tmp/test',
    mem0BaseUrl: 'http://localhost',
    mem0ApiKey: 'test',
    outboxDbPath: '/tmp/test/outbox.json',
    auditStorePath: '/tmp/test/audit.jsonl',
    autoRecall: { enabled: false, topK: 5, maxChars: 800, scope: 'all' },
    autoCapture: { enabled: false, scope: 'long-term', requireAssistantReply: true, maxCharsPerMessage: 2000 },
  embedding: { provider: "fake" as const, baseUrl: "", apiKey: "", model: "", dimension: 16 },
  };

  const poller = new Mem0Poller(cfg);
  poller.start(100);
  poller.stop();
  assert.ok(true);
});