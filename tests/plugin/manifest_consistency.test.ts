import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { resolveConfig } from '../../src/index';

const MANIFEST_PATH = resolve(process.cwd(), 'openclaw.plugin.json');
const INSTALLER_PATH = resolve(process.cwd(), 'scripts/install.mjs');

function readManifest(): any {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

test('plugin manifest omits removed public config fields', () => {
  const manifest = readManifest();
  const properties = manifest?.configSchema?.properties || {};

  assert.equal('auditStorePath' in properties, false);
  assert.equal('embeddingMigration' in properties, false);
  assert.equal('memoryConsolidation' in properties, false);
  assert.equal('logDir' in (properties.debug?.properties || {}), false);
  assert.equal('scope' in (properties.autoCapture?.properties || {}), false);
});

test('plugin manifest defaults match runtime defaults for the public surface', () => {
  const manifest = readManifest();
  const properties = manifest?.configSchema?.properties || {};
  const runtime = resolveConfig();

  assert.equal(properties.lancedbPath?.default, runtime.lancedbPath);
  assert.equal(properties.outboxDbPath?.default, runtime.outboxDbPath);
  assert.equal(properties.debug?.properties?.mode?.default, runtime.debug?.mode);
  assert.equal(properties.autoRecall?.properties?.enabled?.default, runtime.autoRecall.enabled);
  assert.equal(properties.autoRecall?.properties?.topK?.default, runtime.autoRecall.topK);
  assert.equal(properties.autoRecall?.properties?.maxChars?.default, runtime.autoRecall.maxChars);
  assert.equal(properties.autoRecall?.properties?.scope?.default, runtime.autoRecall.scope);
  assert.equal(properties.autoCapture?.properties?.enabled?.default, runtime.autoCapture.enabled);
  assert.equal(
    properties.autoCapture?.properties?.requireAssistantReply?.default,
    runtime.autoCapture.requireAssistantReply,
  );
  assert.equal(
    properties.autoCapture?.properties?.maxCharsPerMessage?.default,
    runtime.autoCapture.maxCharsPerMessage,
  );
});

test('installer defaults match the intended published plugin surface', async () => {
  const installer = await import(INSTALLER_PATH);
  const config = installer.buildDefaultPluginConfig();

  assert.equal('auditStorePath' in config, false);
  assert.equal('embeddingMigration' in config, false);
  assert.equal('memoryConsolidation' in config, false);
  assert.equal('logDir' in (config.debug || {}), false);
  assert.equal('scope' in (config.autoCapture || {}), false);
  assert.equal(config.autoRecall.scope, 'all');
  assert.equal(config.debug.mode, 'off');
});
