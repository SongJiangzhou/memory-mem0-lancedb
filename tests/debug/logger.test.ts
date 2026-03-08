import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PluginDebugLogger } from '../../src/debug/logger';

test('debug logger suppresses debug output when mode is off', async () => {
  const messages: string[] = [];
  const logger = new PluginDebugLogger(
    { mode: 'off' },
    {
      info: (msg: string) => messages.push(msg),
      warn: (msg: string) => messages.push(msg),
      error: (msg: string) => messages.push(msg),
    },
  );

  logger.basic('memory_store.start', { userId: 'user-1' });
  logger.verbose('memory_store.payload', { text: 'secret text' });

  assert.equal(messages.length, 0);
});

test('debug logger emits basic events but suppresses verbose details in basic mode', async () => {
  const messages: string[] = [];
  const logger = new PluginDebugLogger(
    { mode: 'basic' },
    {
      info: (msg: string) => messages.push(msg),
      warn: (msg: string) => messages.push(msg),
      error: (msg: string) => messages.push(msg),
    },
  );

  logger.basic('memory_store.start', { userId: 'user-1' });
  logger.verbose('memory_store.payload', { text: 'secret text' });

  assert.equal(messages.length, 1);
  assert.match(messages[0] || '', /memory_store\.start/);
});

test('debug logger emits verbose events, redacts api keys, and truncates text previews', async () => {
  const messages: string[] = [];
  const logger = new PluginDebugLogger(
    { mode: 'verbose' },
    {
      info: (msg: string) => messages.push(msg),
      warn: (msg: string) => messages.push(msg),
      error: (msg: string) => messages.push(msg),
    },
  );

  logger.verbose('mem0.capture.payload', {
    mem0ApiKey: 'super-secret-key',
    text: 'x'.repeat(260),
  });

  assert.equal(messages.length, 1);
  assert.doesNotMatch(messages[0] || '', /super-secret-key/);
  assert.match(messages[0] || '', /\[redacted\]/);
  assert.match(messages[0] || '', /text_preview/);
});

test('debug logger mirrors structured events to a JSONL file when logDir is configured', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'debug-logger-'));

  try {
    const logger = new PluginDebugLogger({ mode: 'basic', logDir: dir });
    logger.basic('auto_capture.submitted', { eventId: 'evt-1', userId: 'user-1' });

    const date = new Date().toISOString().slice(0, 10);
    const content = readFileSync(join(dir, `${date}.log`), 'utf-8');

    assert.match(content, /auto_capture\.submitted/);
    assert.match(content, /evt-1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
