# 差距修复与全面重构设计文档 (Implementation Gap Fixing Design)

## 概述
基于 `docs/implementation_gap_analysis.md` 中识别出的差距，并对齐最初的设计文档 `docs/openclaw_use_mem0_and_lanceDB.md`，本设计阐述了将当前 `memory-mem0-lancedb` 插件改造为生产级、低延迟、高可用的存储与检索系统的技术路线。

## 1. Hot Plane 原生混合检索与索引重建 (LanceDB)
- **原生混合检索**：废弃 `src/hot/search.ts` 中的纯内存 JS 余弦相似度计算与手动 RRF 融合。改为直接调用 LanceDB Node.js SDK 的原生向量查询 `tbl.search(queryVector)`，并通过原生的 `limit(K)` 进行近似最近邻查询，充分利用底层 C++ 层的查询与融合性能。
- **索引建立**：在 `openMemoryTable` 时：
  - 为向量列创建 `IVF-PQ` 索引（或相关 ANN 加速索引）。
  - 为 `user_id`, `scope`, `status`, `sensitivity` 等高频过滤列建立 `Scalar` 索引。
  - 保留 `text` 的 `FTS` 全文索引。

## 2. Mem0 数据生命周期同步
- **混合模式 (Webhook优先 + Polling兜底)**：为确保由于网络环境（如运行在 NAT 或本地）导致 Webhook 无法到达时的一致性，系统采用双轨同步机制：
  - **Polling 兜底**：在插件启动时启动后台 Worker（如 `setInterval`，默认 5 分钟），定期调用 Mem0 接口拉取自上次同步以来的 `updated` / `deleted` 事件。
  - **Webhook**：如果环境支持并配置了 Webhook HTTP 端点，则实现实时事件接收。
- **状态流转**：获取事件后，在本地 LanceDB 中应用相应的 `update` 或根据 `status` 进行软删除，确保控制面（Mem0）与检索面（LanceDB）数据的一致性。

## 3. 召回质量优化：MMR 与 时序衰减
- **MMR (最大边际相关性去重)**：在获得 LanceDB 返回的 Top-N 结果后，引入 MMR 算法计算召回结果间的相似度，剔除高度相似或冗余的记忆片段，提高 Token 利用率。
- **时序衰减 (Time Decay)**：结合 `ts_event` 字段赋予近期发生的事件或变更更高的召回权重（Recency Boost）。处理具有相同类别或重叠语义的记忆时，优先保留时间戳最新的一条，从而解决偏好变更等场景下的逻辑冲突。

## 4. 双写幂等与 Schema 原生化
- **重构 Upsert**：优化 `LanceDbMemoryAdapter` 中的 `upsertMemory` 实现。废弃“先 delete 再 add”的非原子操作方式，改用 LanceDB 原生的 `mergeInsert`（若支持）或事务性更新，确保在并发或大批量写入时的高效幂等。
- **Schema 优化**：将 `categories` 和 `tags` 等复杂元数据字段定义从平铺的字符串 JSON 序列化转为 LanceDB 支持的 Arrow 原生嵌套结构（如 `List<String>`），减少读取时的解析开销并支持向量库层面的原生集合过滤。

## 5. 安全拦截策略中间件
- **写入前校验**：在 `memoryStore` 工具及 `AutoCapture` 的写入入口实现统一的拦截中间件。
- **指令与敏感词阻断**：利用正则或轻量级过滤策略，扫描文本中的系统级指令注入关键字（如 `Ignore all previous instructions`）、API Keys 或其他高度敏感信息。若触发规则，则拒绝写入或进行脱敏处理（强制标记 `sensitivity: 'restricted'`），防止长期记忆库被污染。
