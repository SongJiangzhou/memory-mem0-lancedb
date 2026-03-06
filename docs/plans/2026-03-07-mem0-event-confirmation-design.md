# Mem0 Event Confirmation Design

**Date:** 2026-03-07

**Goal:** 在当前嵌入式三平面插件中，通过同进程短轮询确认 Mem0 异步事件，把 `syncStatus` 从近似语义收敛为基于确认结果的真实语义。

## Scope

本阶段只覆盖：

- `Mem0Client.storeMemory()`
- `Mem0Client.waitForEvent()` / `confirmEvent()`
- `sync engine` 中的短轮询确认
- `syncStatus` 的真实状态映射

本阶段不做：

- webhook 回调
- 后台补偿重扫
- 启动时 outbox 修复
- 复杂退避和长期重试
- auto-capture / auto-recall

## Architectural Decision

采用“同进程轮询确认”。

原因：

- 当前插件仍是单进程嵌入式形态
- 不需要新增独立服务或外部回调面
- 能在现有 `control plane` 和 `sync engine` 基础上最小扩展

## Status Semantics

这轮状态语义收敛为：

- `synced`
  - audit plane 成功
  - LanceDB 可见
  - Mem0 事件确认成功
- `partial`
  - audit plane 成功
  - LanceDB 可见
  - Mem0 unavailable / timeout / unconfirmed
- `failed`
  - audit plane 失败或 LanceDB 主路径失败
- `duplicate`
  - 同一 `event_id:memory_uid` 重放

`accepted` 仍保留在类型里，但本轮主路径不优先产生该状态。

## Data Flow

写入流程：

1. 工具层生成 canonical `MemoryRecord`
2. audit plane 先写入
3. `sync engine` 调 `Mem0Client.storeMemory(record)`
4. 若 Mem0 不可用：
   - 不阻塞本地路径
   - 继续写 LanceDB
   - 最终状态至多为 `partial`
5. 若 Mem0 返回 `event_id`
   - `sync engine` 进入短轮询确认
   - 尝试 `waitForEvent(eventId)`
6. 再写 LanceDB 并做可见性确认
7. 汇总 Mem0 与 LanceDB 结果得到最终 `syncStatus`

## Mem0 Client API

建议新增两个接口：

- `storeMemory(record)`
  - 负责提交 memory 到 Mem0
  - 返回：
    - `unavailable`
    - `submitted` with `event_id`
- `waitForEvent(eventId, options?)`
  - 在短窗口内轮询确认
  - 返回：
    - `confirmed`
    - `timeout`
    - `unavailable`

## Polling Strategy

为控制复杂度，本轮只使用短轮询：

- 次数固定，例如 `2-3` 次
- 间隔固定，保持较短
- 超时即视为 `timeout`

不做：

- 指数退避
- 无限等待
- 后台补偿

## Testing Strategy

### `src/control/mem0.test.ts`

- 缺少 `mem0ApiKey` -> `unavailable`
- `storeMemory()` 返回 `event_id` 且 `waitForEvent()` 确认 -> `confirmed`
- `storeMemory()` 返回 `event_id` 但超时 -> `timeout`

### `src/bridge/sync-engine.test.ts`

- Mem0 confirmed + LanceDB visible -> `synced`
- Mem0 unavailable/timeout + LanceDB visible -> `partial`
- LanceDB 不可见 -> `failed`
- replay -> `duplicate`

### Regression

- `src/tools/store_lancedb.test.ts`
- `src/tools/local_fallback.test.ts`

## Acceptance Criteria

- Mem0 不可用时，本地路径仍工作，状态为 `partial`
- Mem0 可确认且 LanceDB 可见时，状态为 `synced`
- Mem0 超时但 LanceDB 成功时，状态为 `partial`
- LanceDB 主路径失败时，状态为 `failed`
- 构建与测试可离线通过
