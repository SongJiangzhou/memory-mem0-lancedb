# Design: Debug Mode for End-to-End Memory Diagnostics

Date: 2026-03-08

## Problem

The plugin currently emits only sparse operational logs. Most errors are printed ad hoc through `console.warn` / `console.error`, and successful paths often produce little or no evidence. This makes it hard to verify whether the full memory pipeline actually works end to end inside OpenClaw:

- auto-capture hook trigger
- Mem0 submission
- event confirmation
- extracted memory fetch
- sync back into local audit/LanceDB
- auto-recall query and injection

When diagnosing failures, OpenClaw operators need to see more intermediate results and optionally persist those logs to disk.

## Goal

Add a configurable debug mode that can:

- emit richer stage-by-stage diagnostics to the host logger / stdout
- optionally mirror those diagnostics to a plugin-owned log directory
- expose enough intermediate state to determine whether the memory pipeline is functioning end to end

## Scope

**Changed:**
- add debug configuration
- add a shared debug logger utility
- instrument major memory pipeline stages
- optionally write structured logs to disk

**Unchanged:**
- core memory behavior
- LanceDB schema
- Mem0 API protocol
- search ranking logic

## Recommended Configuration

***REMOVED***
{
  "debug": {
    "mode": "verbose",
    "logDir": "~/.openclaw/workspace/logs/openclaw-mem0-lancedb"
  }
}
***REMOVED***

### Fields

- `mode`: `'off' | 'basic' | 'verbose'`
- `logDir`: optional string path for file output

### Semantics

- `off`: no extra debug logs
- `basic`: lifecycle boundaries, counts, IDs, status transitions
- `verbose`: `basic` plus summarized intermediate content

## Recommended Approach

Introduce a single lightweight `PluginDebugLogger` abstraction and pass it into the code paths that need diagnostics. Do not scatter new raw `console.log()` calls across the codebase.

This keeps the logging policy centralized:

- one place to gate log levels
- one place to write JSON lines to disk
- one place to redact or truncate sensitive content

## Logging Destinations

### Host Logger

Always prefer the host logger when available:

- `api.logger?.info`
- `api.logger?.warn`
- `api.logger?.error`

If the host logger is absent, fall back to `console.*`.

### File Output

When `debug.logDir` is configured, append the same event to a daily log file:

- `~/.openclaw/workspace/logs/openclaw-mem0-lancedb/YYYY-MM-DD.log`

Each line should be JSONL:

***REMOVED***
{"ts":"2026-03-08T12:34:56.789Z","level":"debug","event":"auto_capture.submitted","event_id":"evt-1","user_id":"user-1"}
***REMOVED***

This makes logs grep-friendly and script-friendly.

## Debug Logger API

Recommended utility file:

- `src/debug/logger.ts`

Suggested API:

***REMOVED***ts
export interface DebugConfig {
  mode: 'off' | 'basic' | 'verbose';
  logDir?: string;
}

export interface PluginLoggerSink {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
}

export class PluginDebugLogger {
  constructor(config: DebugConfig, sink?: PluginLoggerSink) {}

  basic(event: string, fields?: Record<string, unknown>): void
  verbose(event: string, fields?: Record<string, unknown>): void
  warn(event: string, fields?: Record<string, unknown>): void
  error(event: string, fields?: Record<string, unknown>): void
}
***REMOVED***

The logger should:

- suppress `basic` and `verbose` output when `mode = 'off'`
- suppress `verbose` output when `mode = 'basic'`
- always allow `warn` and `error`
- write both host logs and optional file logs

## What to Log

### Plugin Registration

`basic`:

- plugin registered
- active config summary:
  - `mem0.mode`
  - `mem0.baseUrl`
  - `autoRecall.enabled`
  - `autoCapture.enabled`
  - `embedding.dimension`
  - `embeddingMigration.enabled`
  - `debug.mode`
  - `debug.logDir`

- poller started or skipped
- migration worker started or skipped

### Memory Store Path

`basic`:

- `memoryStore` invoked
- `userId`, `scope`, text length, categories count
- final result:
  - `success`
  - `memoryUid`
  - `syncStatus`

`verbose`:

- summarized text preview

### Auto Capture Path

`basic`:

- hook triggered
- capture skipped reason, when applicable
- payload constructed
- Mem0 submit attempted
- submit result:
  - `mem0_id`
  - `event_id`
  - status
- event confirmation status
- extracted memories count
- local sync result count

`verbose`:

- summarized input messages
- idempotency key
- extracted memory text previews
- synced `memory_uid` list

### Auto Recall Path

`basic`:

- recall hook triggered
- query summary
- search source
- memory hit count
- final injected character count

`verbose`:

- memory text previews
- hit metadata:
  - `memory_uid`
  - `scope`
  - source dimension or source name

### Mem0 HTTP Client

`basic`:

- request phase:
  - `storeMemory`
  - `captureTurn`
  - `waitForEvent`
  - `fetchCapturedMemories`
- URL
- mem0 mode
- HTTP status

`verbose`:

- request body summary
- response item counts

### Poller

`basic`:

- poll started
- poll response count
- synced count
- skipped count
- poll finished

`verbose`:

- synced memory IDs
- skipped reasons

### Background Embedding Migration

`basic`:

- run started
- source table count
- migrated count
- failed count

`verbose`:

- per-record migration:
  - `memory_uid`
  - source dimension
  - target dimension

## Safety and Redaction

The user asked for intermediate results to be printed in debug mode. Even so, the logger should still enforce two redaction rules:

- never print `mem0.apiKey`
- never print full long text bodies by default

Instead, verbose logs should print truncated previews, for example first 200 characters, plus total length.

This preserves diagnostic value without turning the log file into a full content dump.

## Failure Behavior

Debug logging must never break the memory pipeline.

If host logging fails or file writing fails:

- swallow the logging error
- continue the main business flow
- optionally print one minimal fallback warning to `console.error`

## Testing

Add tests for:

1. `basic` mode emits stage logs but not verbose logs
2. `verbose` mode emits summarized intermediate content
3. `off` mode suppresses debug logs
4. file logging writes JSON lines into the configured directory
5. redaction strips API keys and truncates text previews

Integration-oriented tests should verify that a representative flow emits expected events:

- auto-capture success path
- auto-recall path
- Mem0 poll failure path

## Non-Goals

The first version does not include:

- log rotation beyond daily file naming
- remote log shipping
- structured metrics export
- correlation with external tracing systems
- UI surfaces for viewing logs

## Summary

The best first design is a centralized debug logger with `off/basic/verbose` levels and optional JSONL file output. It gives OpenClaw operators enough end-to-end visibility to verify whether the memory mechanism is truly working without changing core memory behavior.
