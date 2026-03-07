import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMemoryUid, normalizeText } from '../../src/bridge/uid';

test('normalizeText trims lowercases and collapses whitespace', () => {
  assert.equal(normalizeText('  Hello   WORLD  '), 'hello world');
});

test('buildMemoryUid is stable for equivalent normalized text', () => {
  const first = buildMemoryUid('u1', 'long-term', 'Hello   world', '2026-03-07T10', 'general');
  const second = buildMemoryUid('u1', 'long-term', ' hello world ', '2026-03-07T10', 'general');

  assert.equal(first, second);
});
