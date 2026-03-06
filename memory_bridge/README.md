# Memory Bridge Migration Note

`memory_bridge/` 的 Python 原型已经迁移到 TypeScript 正式实现，运行时代码现在位于：

- `src/bridge/uid.ts`
- `src/bridge/outbox.ts`
- `src/bridge/adapter.ts`
- `src/bridge/sync-engine.ts`

本目录仅保留 schema 参考文件；插件运行时不再依赖 Python bridge。
