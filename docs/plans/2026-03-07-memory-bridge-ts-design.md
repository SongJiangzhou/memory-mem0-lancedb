# Memory Bridge TS Migration Design

**Date:** 2026-03-07

**Goal:** 将 `memory_bridge/` 中现有 Python 实现迁移到 TypeScript，并并入插件主运行时，消除跨语言运行依赖，同时保留清晰的 bridge 分层。

## Current State

- 插件主入口和工具实现已经在 `src/` 下运行。
- `memory_bridge/` 中仍保留独立的 Python 版本 `memory_uid`、`outbox`、`lancedb_adapter`、`sync_engine`。
- 现有 TypeScript 代码只部分复用了 `memory_uid` 的思路，尚未吸收 outbox 去重状态机和 sync engine。
- 仓库当前不存在 Python 与 TS 的统一类型和统一测试入口，维护成本偏高。

## Decision

不保留 `memory_bridge` 作为独立 Python 子系统，但保留 bridge 作为领域边界。

迁移后使用 `src/bridge/` 作为新的 TypeScript 领域层，承接原 Python 内核逻辑：

- `src/bridge/uid.ts`
- `src/bridge/outbox.ts`
- `src/bridge/adapter.ts`
- `src/bridge/sync-engine.ts`

现有对外工具接口保持不变：

- `src/tools/store.ts`
- `src/tools/search.ts`
- `src/tools/get.ts`
- `src/index.ts`

## Architecture

### Layering

- `src/index.ts`
  - 继续负责插件注册和配置解析。
- `src/tools/*.ts`
  - 作为工具编排层，解析输入并调用 bridge / db 层。
- `src/bridge/*.ts`
  - 承载迁移后的领域逻辑：幂等主键、outbox 状态机、LanceDB 适配器、同步引擎。
- `src/db/*.ts`
  - 继续负责 LanceDB 表打开和 schema。

### Write Flow

`memoryStore` 的写入路径调整为：

1. 接收工具参数并组装统一 memory payload。
2. 调用 `MemorySyncEngine.processEvent(eventId, memory)`。
3. `sync-engine` 内部执行：
   - 计算 `memory_uid`
   - 生成 `idempotency_key = event_id:memory_uid`
   - 调用 outbox 去重并 claim 待处理项
   - 通过 adapter 执行 LanceDB upsert
   - 通过 adapter 执行写后可见性检查
   - 记录 `done` / `failed`
4. `store.ts` 将内部状态映射回现有 `StoreResult`

### Search / Get Flow

- `search.ts` 继续承担查询逻辑，但与 bridge/db 共享统一的数据解码和 LanceDB 访问能力。
- `get.ts` 继续按 `openclaw_refs.file_path` 读取最近一条记录，不直接感知 outbox 状态机。

## Persistence Choice

第一阶段不继续复刻 Python 的 SQLite outbox。

原因：

- 当前插件 Node 侧没有现成 SQLite 依赖。
- 为了一次迁移引入新本地原生依赖，会扩大安装和兼容性成本。
- 当前最关键的是保留行为语义，而不是保留 Python 技术选型。

因此 first pass 使用 TypeScript 文件型 outbox 持久化，但接口设计保持可替换：

- `enqueue`
- `claimNext`
- `markDone`
- `markFailed`
- `getStatus`

如果未来需要切回 SQLite，只替换 outbox 实现，不变更工具和 sync engine 调用方式。

## State Machine

沿用 Python 版最小状态集合：

- `pending`
- `processing`
- `done`
- `failed`

`MemorySyncEngine.processEvent()` 至少返回：

- `done`
- `duplicate`
- `no_pending`
- `failed_visibility`

## Testing Strategy

按 TDD 拆分为 4 组新增测试：

- `src/bridge/uid.test.ts`
  - 文本归一化和稳定 `memory_uid`
- `src/bridge/outbox.test.ts`
  - 去重、claim 顺序、状态迁移
- `src/bridge/sync-engine.test.ts`
  - `duplicate`、`done`、`failed_visibility`
- 现有 `src/tools/store_lancedb.test.ts`
  - 验证工具层改为通过 sync engine 写入

同时保持现有 `search/get/table` 测试可运行。

## Migration Plan

1. 在 `src/bridge/` 中重建 Python 的 4 个核心模块。
2. 让 `src/tools/store.ts` 切到新的 `sync-engine`。
3. 统一 `types.ts` 与 adapter 的数据结构。
4. 视需要让 `search/get` 复用统一解析逻辑。
5. 删除 `memory_bridge/*.py` 和相关说明。

## Acceptance Criteria

- 插件主流程不再依赖 Python 运行时。
- `memoryStore` 通过 TypeScript sync engine 完成去重和落库。
- Bridge 相关测试覆盖幂等、状态机和可见性检查。
- 现有构建与测试仍能通过。
- 删除 Python 实现后，仓库结构保持清晰。
