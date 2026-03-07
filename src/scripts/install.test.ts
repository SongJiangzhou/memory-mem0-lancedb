import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const SCRIPT_PATH = resolve(process.cwd(), 'scripts/install.sh');

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

test('install script prompts before running and aborts cleanly when declined', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'install-script-test-'));
  const binDir = join(tempRoot, 'bin');
  const homeDir = join(tempRoot, 'home');
  const logPath = join(tempRoot, 'stub.log');

  mkdirSync(binDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });

  createStubCommand(binDir, 'npm');
  createStubCommand(binDir, 'mkdir');
  createStubCommand(binDir, 'rm');
  createStubCommand(binDir, 'ln');

  const result = spawnSync('bash', [SCRIPT_PATH], {
    cwd: resolve(process.cwd()),
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ''}`,
      HOME: homeDir,
      STUB_LOG: logPath,
    },
    input: 'n\n',
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /continue|install/i);
  const stubLog = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim() : '';
  assert.equal(stubLog, '');
});

test('install script skips prompts when --yes is provided', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'install-script-yes-test-'));
  const binDir = join(tempRoot, 'bin');
  const homeDir = join(tempRoot, 'home');
  const logPath = join(tempRoot, 'stub.log');

  mkdirSync(binDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });

  createStubCommand(binDir, 'npm');
  createStubCommand(binDir, 'mkdir');
  createStubCommand(binDir, 'rm');
  createStubCommand(binDir, 'ln');

  const result = spawnSync('bash', [SCRIPT_PATH, '--yes'], {
    cwd: resolve(process.cwd()),
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ''}`,
      HOME: homeDir,
      STUB_LOG: logPath,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /\[y\/N\]/i);

  const stubLog = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  assert.match(stubLog, /npm install/);
  assert.match(stubLog, /npm run build/);
  assert.match(stubLog, /mkdir -p/);
  assert.match(stubLog, /ln -sf/);
});
