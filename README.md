# Mem0 + LanceDB OpenClaw Memory Plugin

[中文说明](./README.zh-CN.md)

An OpenClaw memory plugin that uses Mem0 as the control plane and LanceDB as the retrieval layer.

## Installation

```bash
cd plugins/memory-mem0-lancedb
bash scripts/install.sh
```

## Configuration

Add the plugin entry to `openclaw.json`:

```json
{
  "plugins": {
    "slots": {
      "memory": "memory-mem0-lancedb"
    },
    "entries": {
      "memory-mem0-lancedb": {
        "enabled": true,
        "config": {
          "mem0ApiKey": "your-mem0-api-key (optional; leave empty for local-only mode)",
          "mem0BaseUrl": "https://api.mem0.ai",
          "lancedbPath": "~/.openclaw/workspace/data/memory_lancedb",
          "outboxDbPath": "~/.openclaw/workspace/data/outbox.json"
        }
      }
    }
  }
}
```

## Tools

### `memory_search`

Primary memory-slot search tool backed by LanceDB, with optional Mem0 fallback.

```json
{
  "query": "diet preference",
  "userId": "user_123",
  "topK": 5,
  "filters": {
    "scope": "long-term",
    "categories": ["preference"]
  }
}
```

### `memory_get`

Reads a snippet from a workspace-relative memory source path.

```json
{
  "path": "MEMORY.md",
  "from": 1,
  "lines": 20
}
```

### `memorySearch`

Custom hybrid search API exposed by the plugin.

```json
{
  "query": "diet preference",
  "userId": "user_123",
  "topK": 5,
  "filters": {
    "scope": "long-term",
    "categories": ["preference"]
  }
}
```

### `memoryStore`

Stores a memory record and syncs it to LanceDB, optionally via Mem0.

```json
{
  "text": "The user likes science fiction movies.",
  "userId": "user_123",
  "scope": "long-term",
  "categories": ["preference", "entertainment"]
}
```

## Architecture

1. Write path: Agent -> `memoryStore` -> TypeScript bridge (`uid` + `outbox` + `sync-engine`) -> LanceDB, with optional Mem0 event creation first
2. Read path: Agent -> `memory_search` / `memorySearch` -> LanceDB first -> Mem0 fallback

## Development

```bash
npm install
npm run dev
npm run build
npm test
```
