# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
npm run build          # Compile TypeScript (src/ → dist/)
npm run dev            # Watch mode
npm test               # Run all tests: node --test dist/**/*.test.js
node --test dist/path/to/file.test.js  # Run a single test
npm run install-plugin # Install plugin locally via scripts/install.sh
```

Tests require building first (`npm run build` before `npm test`). Uses native Node.js test runner with `node:assert/strict` — no Jest or Vitest.

## Architecture

OpenClaw memory plugin using Mem0 (control plane) + LanceDB (hot plane). Three-plane design:

- **Audit Plane** (`src/audit/`): File-first JSONL append-only log. Source of truth for compliance.
- **Control Plane** (`src/control/`): Mem0 HTTP API client. Optional — works in local-only mode without API key.
- **Hot Plane** (`src/hot/`, `src/db/`): Embedded LanceDB for FTS, vector search, and hybrid RRF retrieval.

### Data Flow

**Write:** Tool call → `src/capture/security.ts` sanitization → `FileAuditStore` append → `FileOutbox` enqueue → `MemorySyncEngine` processes to LanceDB + optionally Mem0.

**Read:** Tool call → `HotMemorySearch` (FTS + vector + RRF merge with time decay & MMR dedup) → falls back to Mem0 API if LanceDB fails.

**Auto-recall** (`src/recall/`): Hook on `agent_start` injects relevant memories as `<relevant_memories>` XML block. Enabled by default.

**Auto-capture** (`src/capture/`): Hook on `agent_end` extracts memories from conversation turns via Mem0. Disabled by default.

### Entry Point

`src/index.ts` exports `register(api: OpenClawApi)` which registers three tools (`memory_search`, `memory_get`, `memoryStore`) and optional hooks. Configuration merges defaults from `openclaw.plugin.json` with host-provided config.

### Bridge Layer (`src/bridge/`)

- `sync-engine.ts` — Orchestrates dual-write to audit + LanceDB + Mem0
- `outbox.ts` — File-based transactional outbox with idempotency keys
- `poller.ts` — Background polling of Mem0 events (updates/deletions)
- `uid.ts` — Deterministic memory UID via SHA256

## Code Conventions

- **Imports:** Node built-ins use `node:` prefix (`import * as crypto from 'node:crypto'`). External packages use namespace import. Local modules use relative paths.
- **Naming:** Classes/Types PascalCase, functions/variables camelCase, DB fields snake_case, constants UPPER_SNAKE_CASE.
- **DB row fields** are strings (arrays/objects JSON-serialized).
- **Tool classes** follow constructor-injection pattern: `constructor(config: PluginConfig)` with `async execute(params): Promise<Result>`.
- **Embedder** (`src/hot/embedder.ts`): Deterministic 16-dimensional char-code bucketing — placeholder, not semantically meaningful.
- **Schema** defined in `src/db/schema.ts` with canonical JSON schema at `src/schema/memory_record.schema.json`.

## Configuration

Key config fields (via `openclaw.plugin.json` `configSchema`):
- `lancedbPath`, `outboxDbPath`, `auditStorePath` — data file locations
- `mem0ApiKey` — optional; omit for local-only mode
- `autoRecall.enabled` (default: true), `autoCapture.enabled` (default: false)

## Design Docs

`docs/` contains architecture rationale and phase plans. `docs/implementation_gap_analysis.md` tracks known gaps between design and implementation.
