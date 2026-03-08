import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAutoCapturePayload } from '../../src/capture/auto';
import type { AutoCaptureConfig } from '../../src/types';

function buildConfig(overrides?: Partial<AutoCaptureConfig>): AutoCaptureConfig {
  return {
    enabled: true,
    scope: 'long-term',
    requireAssistantReply: true,
    maxCharsPerMessage: 32,
    ...overrides,
  };
}

test('auto capture builds payload from latest user and assistant messages', () => {
  const payload = buildAutoCapturePayload({
    userId: 'user-1',
    latestUserMessage: 'Please reply in English from now on',
    latestAssistantMessage: 'Understood. I will reply in English from now on.',
    config: buildConfig(),
  });

  assert.ok(payload);
  assert.equal(payload?.messages.length, 2);
  assert.equal(payload?.messages[0]?.role, 'user');
  assert.equal(payload?.messages[1]?.role, 'assistant');
});

test('auto capture returns null when assistant reply is required but missing', () => {
  const payload = buildAutoCapturePayload({
    userId: 'user-1',
    latestUserMessage: 'Please reply in English from now on',
    latestAssistantMessage: '',
    config: buildConfig({ requireAssistantReply: true }),
  });

  assert.equal(payload, null);
});

test('auto capture produces stable idempotency key for identical turn content', () => {
  const first = buildAutoCapturePayload({
    userId: 'user-1',
    latestUserMessage: 'Please reply in English from now on',
    latestAssistantMessage: 'Understood. I will reply in English from now on.',
    config: buildConfig(),
  });
  const second = buildAutoCapturePayload({
    userId: 'user-1',
    latestUserMessage: 'Please reply in English from now on',
    latestAssistantMessage: 'Understood. I will reply in English from now on.',
    config: buildConfig(),
  });

  assert.equal(first?.idempotencyKey, second?.idempotencyKey);
});

test('auto capture truncates oversized messages', () => {
  const payload = buildAutoCapturePayload({
    userId: 'user-1',
    latestUserMessage: 'a'.repeat(128),
    latestAssistantMessage: 'b'.repeat(128),
    config: buildConfig({ maxCharsPerMessage: 16 }),
  });

  assert.ok(payload);
  assert.equal(payload?.messages[0]?.content.length, 16);
  assert.equal(payload?.messages[1]?.content.length, 16);
});

test('auto capture strips host reply markers and drops acknowledgement-only assistant replies', () => {
  const payload = buildAutoCapturePayload({
    userId: 'user-1',
    latestUserMessage: 'I work at a technology company in office zone A',
    latestAssistantMessage: '[[reply_to_current]] Noted.\n\nYou work at a technology company in office zone A.',
    config: buildConfig({ maxCharsPerMessage: 2000 }),
  });

  assert.ok(payload);
  assert.deepEqual(payload?.messages, [
    { role: 'user', content: 'I work at a technology company in office zone A' },
  ]);
});

test('auto capture strips injected capture blocks from the next user turn', () => {
  const payload = buildAutoCapturePayload({
    userId: 'user-1',
    latestUserMessage:
      '<capture via="mem0" count="1" synced="lancedb">\n- User enjoys a certain food.\n</capture>\n\nI enjoy another food.',
    latestAssistantMessage: 'Noted. You enjoy another food.',
    config: buildConfig({ maxCharsPerMessage: 2000 }),
  });

  assert.ok(payload);
  assert.deepEqual(payload?.messages, [
    { role: 'user', content: 'I enjoy another food.' },
    { role: 'assistant', content: 'Noted. You enjoy another food.' },
  ]);
});
