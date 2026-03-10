import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const INSTALLER_PATH = resolve(process.cwd(), 'scripts/install.mjs');

function serialTest(name: string, fn: (t: unknown) => void | Promise<void>): void {
  test(name, { concurrency: 1 }, fn);
}

function createStubCommand(binDir: string, name: string): void {
  const path = join(binDir, name);
  writeFileSync(
    path,
    `#!/bin/bash
set -e
echo "${name} $*" >> "$STUB_LOG"
`,
  );
  chmodSync(path, 0o755);
}

serialTest('install.mjs --yes writes defaults into openclaw.json', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'install-mjs-yes-'));
  const binDir = join(tempRoot, 'bin');
  const homeDir = join(tempRoot, 'home');
  const logPath = join(tempRoot, 'stub.log');

  mkdirSync(binDir, { recursive: true });
  mkdirSync(join(homeDir, '.openclaw'), { recursive: true });
  writeFileSync(
    join(homeDir, '.openclaw', 'openclaw.json'),
    JSON.stringify({ plugins: { entries: {}, allow: [], load: { paths: [] }, slots: {} } }, null, 2),
  );

  createStubCommand(binDir, 'npm');
  createStubCommand(binDir, 'mkdir');
  createStubCommand(binDir, 'rm');
  createStubCommand(binDir, 'ln');

  const result = spawnSync('node', [INSTALLER_PATH, '--lang', 'en', '--yes'], {
    cwd: resolve(process.cwd()),
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ''}`,
      HOME: homeDir,
      STUB_LOG: logPath,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const config = JSON.parse(readFileSync(join(homeDir, '.openclaw', 'openclaw.json'), 'utf8'));
  const pluginConfig = config.plugins.entries['openclaw-mem0-lancedb']?.config;

  assert.equal(pluginConfig?.mem0?.mode, 'local');
  assert.equal(pluginConfig?.mem0?.baseUrl, 'http://127.0.0.1:8000');
  assert.equal(pluginConfig?.lancedbPath, join(homeDir, '.openclaw', 'workspace', 'data', 'memory', 'lancedb'));
  assert.equal(pluginConfig?.outboxDbPath, join(homeDir, '.openclaw', 'workspace', 'data', 'memory', 'outbox.json'));
  assert.equal(pluginConfig?.auditStorePath, join(homeDir, '.openclaw', 'workspace', 'data', 'memory', 'audit', 'memory_records.jsonl'));
  assert.equal(pluginConfig?.debug?.mode, 'basic');
  assert.equal(pluginConfig?.autoRecall?.enabled, true);
  assert.equal(pluginConfig?.autoRecall?.topK, 8);
  assert.equal(pluginConfig?.autoRecall?.maxChars, 1400);
  assert.equal(pluginConfig?.autoRecall?.reranker?.provider, 'local');
  assert.equal(pluginConfig?.autoRecall?.reranker?.baseUrl, 'https://api.voyageai.com/v1');
  assert.equal(pluginConfig?.autoRecall?.reranker?.apiKey, '');
  assert.equal(pluginConfig?.autoRecall?.reranker?.model, 'rerank-2.5-lite');
});

serialTest('install.mjs --skip-config leaves openclaw.json unchanged', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'install-mjs-skip-'));
  const binDir = join(tempRoot, 'bin');
  const homeDir = join(tempRoot, 'home');
  const logPath = join(tempRoot, 'stub.log');

  mkdirSync(binDir, { recursive: true });
  mkdirSync(join(homeDir, '.openclaw'), { recursive: true });
  const originalConfig = { plugins: { entries: {}, allow: [], load: { paths: [] }, slots: {} } };
  writeFileSync(join(homeDir, '.openclaw', 'openclaw.json'), JSON.stringify(originalConfig, null, 2));

  createStubCommand(binDir, 'npm');
  createStubCommand(binDir, 'mkdir');
  createStubCommand(binDir, 'rm');
  createStubCommand(binDir, 'ln');

  const result = spawnSync('node', [INSTALLER_PATH, '--lang', 'zh', '--yes', '--skip-config'], {
    cwd: resolve(process.cwd()),
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ''}`,
      HOME: homeDir,
      STUB_LOG: logPath,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const config = JSON.parse(readFileSync(join(homeDir, '.openclaw', 'openclaw.json'), 'utf8'));
  assert.deepEqual(config, originalConfig);
});

serialTest('buildDefaultPluginConfig preserves an existing remote mem0 api key', async () => {
  const installer = await import(INSTALLER_PATH);
  const memoryRoot = join(process.env.HOME || '', '.openclaw', 'workspace', 'data', 'memory');
  const config = installer.buildDefaultPluginConfig({
    mem0: {
      mode: 'remote',
      baseUrl: 'https://api.mem0.ai',
      apiKey: 'existing-test-key',
    },
    autoRecall: {
      enabled: true,
      topK: 5,
      maxChars: 800,
      scope: 'all',
      reranker: {
        provider: 'voyage',
        baseUrl: 'https://custom.voyage.test/v1',
        apiKey: 'existing-rerank-key',
        model: 'rerank-2.5',
      },
    },
  });

  assert.equal(config.mem0.mode, 'remote');
  assert.equal(config.mem0.baseUrl, 'https://api.mem0.ai');
  assert.equal(config.mem0.apiKey, 'existing-test-key');
  assert.equal(config.lancedbPath, join(memoryRoot, 'lancedb'));
  assert.equal(config.outboxDbPath, join(memoryRoot, 'outbox.json'));
  assert.equal(config.auditStorePath, join(memoryRoot, 'audit', 'memory_records.jsonl'));
  assert.equal(config.autoRecall.topK, 5);
  assert.equal(config.autoRecall.maxChars, 800);
  assert.equal(config.autoRecall.scope, 'all');
  assert.equal(config.autoRecall.reranker.provider, 'voyage');
  assert.equal(config.autoRecall.reranker.baseUrl, 'https://custom.voyage.test/v1');
  assert.equal(config.autoRecall.reranker.apiKey, 'existing-rerank-key');
  assert.equal(config.autoRecall.reranker.model, 'rerank-2.5');
});

serialTest('buildDefaultPluginConfig preserves an existing reranker api key even when provider is not voyage', async () => {
  const installer = await import(INSTALLER_PATH);
  const config = installer.buildDefaultPluginConfig({
    autoRecall: {
      enabled: true,
      topK: 5,
      maxChars: 800,
      scope: 'all',
      reranker: {
        provider: 'local',
        baseUrl: 'https://api.voyageai.com/v1',
        apiKey: 'existing-rerank-key',
        model: 'rerank-2.5-lite',
      },
    },
  });

  assert.equal(config.autoRecall.reranker.provider, 'local');
  assert.equal(config.autoRecall.reranker.apiKey, 'existing-rerank-key');
});

serialTest('withDefaultHint appends a default label only when there is no existing value', async () => {
  const installer = await import(INSTALLER_PATH);
  const english = installer.withDefaultHint('Max memories to inject (topK)', '8', false, { intro: 'installer' });
  const chinese = installer.withDefaultHint('最大注入记忆条数 (topK)', '8', false, { intro: '安装器' });
  const existing = installer.withDefaultHint('Max memories to inject (topK)', '8', true, { intro: 'installer' });

  assert.match(english, /default: 8/);
  assert.match(chinese, /默认: 8/);
  assert.equal(existing, 'Max memories to inject (topK)');
});

serialTest('install.mjs --yes keeps an existing remote mem0 api key', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'install-mjs-keep-key-'));
  const binDir = join(tempRoot, 'bin');
  const homeDir = join(tempRoot, 'home');
  const logPath = join(tempRoot, 'stub.log');

  mkdirSync(binDir, { recursive: true });
  mkdirSync(join(homeDir, '.openclaw'), { recursive: true });
  writeFileSync(
    join(homeDir, '.openclaw', 'openclaw.json'),
    JSON.stringify(
      {
        plugins: {
          entries: {
            'openclaw-mem0-lancedb': {
              enabled: true,
              config: {
                mem0: {
                  mode: 'remote',
                  baseUrl: 'https://api.mem0.ai',
                  apiKey: 'existing-test-key',
                },
              },
            },
          },
          allow: [],
          load: { paths: [] },
          slots: {},
        },
      },
      null,
      2,
    ),
  );

  createStubCommand(binDir, 'npm');
  createStubCommand(binDir, 'mkdir');
  createStubCommand(binDir, 'rm');
  createStubCommand(binDir, 'ln');

  const result = spawnSync('node', [INSTALLER_PATH, '--lang', 'en', '--yes'], {
    cwd: resolve(process.cwd()),
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ''}`,
      HOME: homeDir,
      STUB_LOG: logPath,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const config = JSON.parse(readFileSync(join(homeDir, '.openclaw', 'openclaw.json'), 'utf8'));
  const pluginConfig = config.plugins.entries['openclaw-mem0-lancedb']?.config;
  assert.equal(pluginConfig?.mem0?.mode, 'remote');
  assert.equal(pluginConfig?.mem0?.baseUrl, 'https://api.mem0.ai');
  assert.equal(pluginConfig?.mem0?.apiKey, 'existing-test-key');
  assert.equal(pluginConfig?.autoRecall?.topK, 8);
  assert.equal(pluginConfig?.autoRecall?.maxChars, 1400);
  assert.equal(pluginConfig?.autoRecall?.reranker?.provider, 'local');
});
