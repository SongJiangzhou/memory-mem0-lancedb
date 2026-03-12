# Debug File Logging Return Design

## Goal

Restore file-based debug logging for `debug` mode without reintroducing a user-configurable `debug.logDir`.

## Decision

- Keep `debug.mode` as `off | debug`
- When `debug.mode === "debug"`, continue sending structured logs to the host logger / console
- Additionally append the same JSON log line to:
  - `~/.openclaw/workspace/logs/openclaw-mem0-lancedb/YYYY-MM-DD.log`
- Do not add `debug.logDir` back to config, installer prompts, or public types

## Rationale

- Matches the user's current operational expectation and existing log directory layout
- Restores low-friction debugging without expanding config surface again
- Keeps behavior simple and deterministic

## Testing

- `debug` mode writes a dated log file in the fixed directory
- `off` mode still suppresses debug output
- Existing structured sink logging remains unchanged
