# Debug File Logging Return Implementation Plan

1. Update `src/debug/logger.ts`
   - Resolve the fixed log directory under `$HOME/.openclaw/workspace/logs/openclaw-mem0-lancedb`
   - Append one JSON line per emitted debug record when mode is `debug`
   - Never let file logging failures break callers

2. Update `tests/debug/logger.test.ts`
   - Replace the old "does not write files" expectation
   - Verify `debug` mode writes `YYYY-MM-DD.log` under the fixed directory

3. Verify
   - `npm run build`
   - `node dist/tests/debug/logger.test.js`
