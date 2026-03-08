# Debug Mode for End-to-End Memory Diagnostics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a configurable debug mode that prints richer end-to-end memory pipeline diagnostics to the host logger and optionally mirrors them to local JSONL log files for OpenClaw troubleshooting.

**Architecture:** Introduce a shared `PluginDebugLogger` with `off/basic/verbose` levels and optional `debug.logDir` output. Resolve debug config once in `src/index.ts`, then thread the logger into the major lifecycle boundaries: plugin registration, `memoryStore`, auto-capture, auto-recall, Mem0 HTTP calls, poller, and embedding migration. Redact API keys and truncate text previews centrally.

**Tech Stack:** Node.js, TypeScript, Node filesystem APIs, existing plugin registration flow, Node test runner

---

### Task 1: Add failing tests for debug config and logger behavior

**Files:**
- Create: `tests/debug/logger.test.ts`
- Modify: `tests/index.test.ts`

**Step 1: Write failing logger unit tests**

Create `tests/debug/logger.test.ts` with tests that expect:

- `mode = 'off'` emits no debug events
- `mode = 'basic'` emits `basic` events but not `verbose`
- `mode = 'verbose'` emits both
- API keys are redacted
- long text previews are truncated

Use an in-memory sink:

***REMOVED***ts
const messages: string[] = [];
const sink = {
  info: (msg: string) => messages.push(msg),
  warn: (msg: string) => messages.push(msg),
  error: (msg: string) => messages.push(msg),
};
***REMOVED***

**Step 2: Add failing config test**

In `tests/index.test.ts`, add assertions that `resolveConfig()` returns:

- `debug.mode = 'off'` by default
- `debug.logDir` unset by default
- explicit overrides are preserved

**Step 3: Run tests to verify failure**

Run: `npm run build && node --test dist/tests/debug/logger.test.js dist/tests/index.test.js`

Expected: FAIL because debug config and logger do not exist yet.

**Step 4: Commit**

***REMOVED***bash
git add tests/debug/logger.test.ts tests/index.test.ts
git commit -m "test: add failing coverage for debug mode logging"
***REMOVED***

### Task 2: Add debug config types and config resolution

**Files:**
- Modify: `src/types.ts`
- Modify: `src/index.ts`
- Modify: `openclaw.plugin.json`

**Step 1: Add debug types**

Extend `src/types.ts`:

***REMOVED***ts
export type DebugMode = 'off' | 'basic' | 'verbose';

export interface DebugConfig {
  mode: DebugMode;
  logDir?: string;
}
***REMOVED***

Add `debug?: DebugConfig` to `PluginConfig`.

**Step 2: Resolve debug config in `resolveConfig()`**

In `src/index.ts`, add:

***REMOVED***ts
debug: {
  mode: raw?.debug?.mode || 'off',
  logDir: raw?.debug?.logDir || undefined,
},
***REMOVED***

**Step 3: Add schema entries**

In `openclaw.plugin.json`, add:

***REMOVED***
"debug": {
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": ["off", "basic", "verbose"],
      "default": "off"
    },
    "logDir": {
      "type": "string"
    }
  }
}
***REMOVED***

**Step 4: Run the config tests**

Run: `npm run build && node --test dist/tests/index.test.js`

Expected: PASS for new debug config assertions, logger tests still failing.

**Step 5: Commit**

***REMOVED***bash
git add src/types.ts src/index.ts openclaw.plugin.json tests/index.test.ts
git commit -m "feat: add debug config schema and defaults"
***REMOVED***

### Task 3: Implement the shared debug logger

**Files:**
- Create: `src/debug/logger.ts`
- Test: `tests/debug/logger.test.ts`

**Step 1: Implement the logger**

Create `src/debug/logger.ts` with:

- `PluginDebugLogger`
- support for `off/basic/verbose`
- sink fallback to `console`
- JSONL file append when `logDir` exists
- centralized redaction / truncation helpers

Recommended helpers:

***REMOVED***ts
function redactFields(fields: Record<string, unknown>): Record<string, unknown>
function summarizeText(value: unknown, maxChars: number = 200): unknown
***REMOVED***

**Step 2: Use JSONL output**

Each written line should contain:

- `ts`
- `level`
- `event`
- `fields`

**Step 3: Keep logging failure-safe**

Wrap file writes in `try/catch` and never throw into the business path.

**Step 4: Run logger tests**

Run: `npm run build && node --test dist/tests/debug/logger.test.js`

Expected: PASS

**Step 5: Commit**

***REMOVED***bash
git add src/debug/logger.ts tests/debug/logger.test.ts
git commit -m "feat: add shared debug logger with file output"
***REMOVED***

### Task 4: Instrument plugin registration and startup components

**Files:**
- Modify: `src/index.ts`
- Modify: `src/bridge/poller.ts`
- Modify: `src/hot/migration-worker.ts`

**Step 1: Create the logger in `register()`**

Build one logger from resolved config and host sink:

***REMOVED***ts
const debug = new PluginDebugLogger(cfg.debug, api.logger);
***REMOVED***

Log:

- plugin registered
- config summary
- poller started
- migration worker started

**Step 2: Instrument `Mem0Poller`**

Add constructor injection for the logger and log:

- poll start
- response count
- synced count
- failures

**Step 3: Instrument `EmbeddingMigrationWorker`**

Add constructor injection for the logger and log:

- run start
- source table count
- migrated count
- per-record verbose entries
- failures

**Step 4: Run targeted tests**

Run: `npm run build && node --test dist/tests/bridge/poller.test.js dist/tests/hot/migration-worker.test.js dist/tests/index.test.js`

Expected: PASS

**Step 5: Commit**

***REMOVED***bash
git add src/index.ts src/bridge/poller.ts src/hot/migration-worker.ts
git commit -m "feat: add startup and background debug instrumentation"
***REMOVED***

### Task 5: Instrument Mem0 HTTP flows

**Files:**
- Modify: `src/control/mem0.ts`
- Test: `tests/control/mem0.test.ts`

**Step 1: Inject the logger into `HttpMem0Client`**

Add an optional logger parameter and emit debug events for:

- request start
- request URL
- mode
- response status
- unavailable catch path
- fetched item count

**Step 2: Add verbose summaries**

Emit summarized previews for:

- store/capture body content
- extracted memory previews

Do not print API keys.

**Step 3: Extend tests**

In `tests/control/mem0.test.ts`, add a sink-backed logger and assert that representative success and failure paths emit expected events.

**Step 4: Run the tests**

Run: `npm run build && node --test dist/tests/control/mem0.test.js`

Expected: PASS

**Step 5: Commit**

***REMOVED***bash
git add src/control/mem0.ts tests/control/mem0.test.ts
git commit -m "feat: add debug logging for mem0 client flows"
***REMOVED***

### Task 6: Instrument store, recall, and capture orchestration

**Files:**
- Modify: `src/tools/store.ts`
- Modify: `src/recall/auto.ts`
- Modify: `src/capture/sync.ts`
- Modify: `src/index.ts`
- Test: `tests/index.test.ts`
- Test: `tests/recall/auto.test.ts`
- Test: `tests/capture/sync.test.ts`

**Step 1: Add store-path logs**

Log:

- invocation summary
- success/failure
- `memoryUid`
- `syncStatus`

**Step 2: Add recall-path logs**

Log:

- recall hook trigger
- query summary
- hit count
- injected chars
- verbose hit previews

**Step 3: Add capture sync logs**

Log:

- extracted memory count
- synced count
- duplicate count
- verbose memory previews / UIDs

**Step 4: Extend tests**

Add assertions that representative orchestration flows emit expected debug events.

**Step 5: Run targeted tests**

Run: `npm run build && node --test dist/tests/index.test.js dist/tests/recall/auto.test.js dist/tests/capture/sync.test.js`

Expected: PASS

**Step 6: Commit**

***REMOVED***bash
git add src/tools/store.ts src/recall/auto.ts src/capture/sync.ts src/index.ts tests/index.test.ts tests/recall/auto.test.ts tests/capture/sync.test.ts
git commit -m "feat: add end-to-end debug logs for capture and recall"
***REMOVED***

### Task 7: Update installer and docs

**Files:**
- Modify: `scripts/install.sh`
- Modify: `scripts/install_zh.sh`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Step 1: Add installer prompts**

Add prompts for:

- debug mode
- optional log directory

Write them into plugin config as:

***REMOVED***
"debug": {
  "mode": "verbose",
  "logDir": "~/.openclaw/workspace/logs/openclaw-mem0-lancedb"
}
***REMOVED***

**Step 2: Update docs**

Document:

- the three debug levels
- default log destination behavior
- optional file log directory
- what kinds of intermediate results verbose mode prints

**Step 3: Run installer and doc-adjacent tests if any**

Run: `npm run build && node --test dist/tests/scripts/install.test.js`

Expected: PASS

**Step 4: Commit**

***REMOVED***bash
git add scripts/install.sh scripts/install_zh.sh README.md README.zh-CN.md
git commit -m "docs: describe debug mode and optional file logging"
***REMOVED***

### Task 8: Verify the full suite

**Step 1: Run build**

Run: `npm run build`

Expected: PASS

**Step 2: Run full test suite**

Run: `npm test`

Expected: all existing and new debug-related tests pass

**Step 3: Optionally spot-check file logging**

Run a small targeted script or unit test and verify a JSONL file appears under the configured `debug.logDir`.

**Step 4: Commit final verification state**

***REMOVED***bash
git add .
git commit -m "test: verify debug mode end-to-end diagnostics"
***REMOVED***
