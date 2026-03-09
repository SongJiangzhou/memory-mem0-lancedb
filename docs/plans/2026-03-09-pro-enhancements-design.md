# 架构设计：OpenClaw 记忆插件 Pro 级增强演进

## 背景
基于 `win4r/memory-lancedb-pro` 的经验，本项目在继承 Mem0 的控制平面与 LanceDB 的热点缓存优势的基础上，需进一步补齐工程化与智能化短板，实现全方位的 Pro 级增强。

## 目标
1. 拦截无效读写请求（Phase 1: 噪声过滤与自适应检索）
2. 提升极限检索准确率（Phase 2: 引入跨编码器重排）
3. 严格的数据租户隔离（Phase 3: 多作用域沙盒）
4. 提供可维护的数据工具（Phase 4: 记忆管理 CLI）

## 架构拆解

### Phase 1: 流量守门员 (Gatekeeper)
**目标：** 在系统边缘拦截无效的 I/O。
*   **读取端 (Adaptive Retrieval):** 修改 `src/tools/search.ts`。在执行 `HotMemorySearch.search` 前，对 `query` 进行正则及词法判断。
    *   *规则:* 长度 < 2，或纯特殊符号，或高频无意词（如 "ok", "hi", "好的"）。
    *   *动作:* 直接返回 `{ memories: [], source: 'skipped' }`。
*   **写入端 (Ingestion Noise Filtering):** 修改 `src/capture/auto.ts`。在提交流水线前进行内容审查。
    *   *规则:* 拦截纯语气词、AI 典型拒绝回复（"As an AI..."）、系统报错日志。
    *   *动作:* 终止后续的 Mem0 网络请求及 LanceDB 本地写入，抛出 `skipped` 审计日志。

### Phase 2: 检索狙击手 (Cross-Encoder Reranking)
**目标：** 对 RRF 召回的粗筛结果进行精确的语义重排序。
*   **组件设计:** 在 `src/hot/` 下新增 `reranker.ts` 模块。
*   **数据流:**
    1.  `search.ts` 通过 RRF 和 MMR 获取 Top-20 候选者。
    2.  如果配置中开启了 `reranker`，将 `[query, document]` 文本对发送给 Reranker (通过 HTTP 请求外部 API 如 Jina，或本地推理)。
    3.  使用 Reranker 的打分替代/融合原有的综合得分。
    4.  截取最终的 Top-K (如 Top-5) 返回。
*   **挑战:** 网络延迟。设计必须包含超时自动降级（Fallback to RRF）机制。

### Phase 3: 沙盒隔离 (Multi-Scope Isolation)
**目标：** 解决数据越权访问问题。
*   **数据模型:** 强化 `memory_record.schema.json` 中的 `scope` 和 `metadata.agent_id`/`project_id` 约束。
*   **查询重写:** 在 `src/hot/search.ts` 中的 `buildWhereClause` 方法内，强制加上环境上下文的隔离条件（无法通过客户端传参绕过）。
*   **表级隔离（可选）:** 当特定 Agent 数据量极大时，可探索基于 `namespace` 的动态表名生成（`memory_table_<dimension>_<namespace>`）。当前阶段建议优先采用 Row-level Security (Where 条件过滤)。

### Phase 4: 运维指挥官 (Management CLI)
**目标：** 脱离框架运行时的离线数据管理。
*   **入口:** 新增 `src/cli/index.ts`，配置 `package.json` 的 `bin` 字段。
*   **核心指令:**
    *   `list <userId>`: 表格化展示用户的记忆摘要（使用 `console.table`）。
    *   `export <userId> [path]`: 将特定用户的 LanceDB 记录导出为 JSONL 或 Markdown 备份。
    *   `re-embed`: 强制重新运行 Embedding（当更换了模型时使用）。
    *   `wipe <userId>`: 物理删除并清理垃圾。
*   **实现细节:** 直接调用 `src/db/table.ts` 中的底层 LanceDB 接口，绕过所有的上层鉴权和状态机。

## 演进策略
按 Phase 1 -> 4 顺序实施，每个阶段保持 API 兼容，通过 `openclaw.json` 的 feature flags 渐进式放开。