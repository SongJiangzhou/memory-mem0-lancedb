# Auto Recall Design

**Date:** 2026-03-07

**Goal:** 在 `memory-mem0-lancedb` 插件中增加“配置开启时自动注入”形式的 auto-recall，基于当前稳定的 `hot plane` 检索结果在会话开始前向模型上下文注入相关记忆。

## Scope

本阶段只覆盖：

- 配置开启时自动 recall
- 以当前 `hot plane` 为主的 recall pipeline
- recall 结果的裁剪与格式化
- 对生命周期 hook 缺失的兼容处理

本阶段不做：

- 默认强制开启自动注入
- auto-capture
- query rewrite
- 复杂 recall ranking 策略
- 记忆写回

## Architectural Decision

采用“配置开启时自动注入”的方式。

原因：

- 当前数据面、检索面、同步面刚稳定
- 自动注入需要保留安全开关
- 可以先验证误召回、注入长度和上下文影响

## Trigger Model

推荐触发方式：

- 插件注册时探测可用的生命周期 hook
- 若存在 hook 注册能力，且 `autoRecall.enabled=true`，则挂接 recall 逻辑
- 若不存在 hook 注册能力，则静默跳过，不影响插件加载和工具使用

## Query Source

第一版 recall query 直接来自“最新用户消息文本”。

不做：

- 历史上下文重写
- 复杂查询扩展
- 模型生成 recall query

## Retrieval Pipeline

1. 取最新用户消息文本
2. 调用 `HotMemorySearch.search()`
3. 约束：
   - `status=active`
   - `userId`
   - 默认 `topK`
   - 可选 `scope`
4. 对 recall 结果做后处理：
   - 去重
   - 条数限制
   - 字符数限制
5. 格式化成稳定的注入文本块
6. 注入到模型上下文

## Injection Format

不直接注入 JSON。

推荐格式：

```text
<relevant_memories>
- [long-term] 用户偏好：回复必须使用中文
- [long-term] 用户喜欢科幻电影
</relevant_memories>
```

可选附带：

- `categories`
- `openclaw_refs.file_path`

但默认应保持短小。

## Config Shape

推荐新增：

- `autoRecall.enabled: boolean`
- `autoRecall.topK: number`
- `autoRecall.maxChars: number`
- `autoRecall.scope: 'long-term' | 'all'`

默认建议：

- `enabled: false`
- `topK: 5`
- `maxChars: 800`
- `scope: 'all'`

## Testing Strategy

### `src/recall/auto.test.ts`

- recall 结果条数限制
- `maxChars` 截断
- 输出格式稳定
- 空结果时不注入

### `src/index` or registration tests

- 若插件 API 暴露 hook 注册能力，则注册 auto-recall
- 若没有 hook，插件仍能正常初始化

## Acceptance Criteria

- 配置开启时可自动 recall
- 配置关闭时完全不影响现有行为
- recall 注入基于当前 `hot plane`
- hook 不存在时不会导致插件加载失败
- 构建和测试可离线通过
