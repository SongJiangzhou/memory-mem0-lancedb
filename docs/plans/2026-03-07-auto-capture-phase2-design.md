# Auto Capture Phase 2 Design

**Date:** 2026-03-07

**Goal:** 在 `auto-capture` 已能提交最新一轮对话到 Mem0 的基础上，增加“事件确认后拉取抽取结果，并回接本地三平面”的 Phase 2 能力。

## Scope

本阶段只覆盖：

- 事件确认后拉取 Mem0 抽取结果
- 将抽取结果映射为 canonical `MemoryRecord`
- 回写本地：
  - audit plane
  - LanceDB hot plane
- 依赖 `memory_uid` 做本地幂等收敛

本阶段不做：

- 历史 memory 的更新/删除同步
- `superseded` 关系维护
- 多轮 capture 合并
- 全量 Mem0 回灌

## Architectural Decision

采用“Mem0 负责抽取，插件负责回接本地三平面”。

也就是说：

- capture 提交后，Mem0 产出抽取结果
- 插件在事件确认后主动取回这些结果
- 再由插件把结果转换为本地统一记忆记录并落盘

## Data Flow

1. `agent_end` 触发 auto-capture
2. 插件把最新一轮 `user + assistant` 提交给 Mem0
3. `waitForEvent()` 确认该事件已完成
4. 插件调用新的 Mem0 client 接口取回抽取结果
5. 对每条抽取结果执行本地映射：
   - `user_id`
   - `scope`
   - `source='openclaw'`
   - `status='active'`
   - `mem0.mem0_id`
   - `mem0.event_id`
   - `mem0.hash`
   - `openclaw_refs.file_path='AUTO_CAPTURE'` 或等价标记
6. 逐条落地到：
   - audit plane
   - LanceDB
7. 通过 `memory_uid` 幂等收敛重复结果

## Fetch Strategy

插件需要新增“获取抽取结果”的控制面接口。

第一版可以接受两种策略之一：

- 按 `event_id` 获取事件产物
- 按 `user_id` + 最近窗口查询刚刚抽取出的 memories

无论底层选哪种实现，插件侧接口应统一成：

- `fetchCapturedMemories(...) -> CapturedMemory[]`

## Local Mapping

抽取结果转成本地 `MemoryRecord` 时：

- `memory_uid`
  - 继续使用现有本地规则生成
- `text`
  - 使用 Mem0 返回的抽取文本
- `categories`
  - 尽可能从 Mem0 返回值映射
- `scope`
  - 默认使用 `autoCapture.scope`
- `openclaw_refs`
  - 标记来源为 auto-capture，而不是某个真实文件

## Idempotency

分两层去重：

### Capture request dedupe

- 继续使用 `idempotency_key`
- 防止同一轮重复提交

### Local extracted-memory dedupe

- 通过 `memory_uid`
- 防止 Mem0 返回重复或相似抽取结果重复落地

## Module Changes

建议新增：

- `src/capture/sync.ts`
  - 把 Mem0 抽取结果映射到本地 `MemoryRecord`
  - 调用 audit plane + LanceDB 进行本地落地

扩展：

- `src/control/mem0.ts`
  - 新增获取抽取结果接口
- `src/index.ts`
  - 在 auto-capture hook 里串起：
    - submit
    - confirm
    - fetch extracted memories
    - local sync

## Testing Strategy

### `src/control/mem0.test.ts`

- 事件确认后能返回抽取结果
- 无结果时返回空数组

### `src/capture/sync.test.ts`

- 抽取结果能映射成 canonical `MemoryRecord`
- 重复结果通过 `memory_uid` 收敛
- audit plane 和 LanceDB 均收到写入

### `src/index.test.ts`

- 开启 `autoCapture` 且 hook 存在时，完成整条链路
- 不产生回环

## Acceptance Criteria

- auto-capture 不再只停留在“提交成功”
- Mem0 抽取结果会回接到本地三平面
- 本地幂等成立
- 构建和测试可离线通过
