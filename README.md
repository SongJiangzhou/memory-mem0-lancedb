# Mem0 + LanceDB OpenClaw Memory Plugin

OpenClaw 记忆插件，使用 Mem0 作为治理层、LanceDB 作为检索层。

## 安装

```bash
cd plugins/memory-mem0-lancedb
bash scripts/install.sh
```

## 配置

在 `openclaw.json` 中添加：

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
          "mem0ApiKey": "your-mem0-api-key (可选，留空则仅本地占位)",
          "mem0BaseUrl": "https://api.mem0.ai",
          "lancedbPath": "~/.openclaw/workspace/data/memory_lancedb",
          "outboxDbPath": "~/.openclaw/workspace/data/outbox.db"
        }
      }
    }
  }
}
```

## 提供的工具

### memorySearch

```json
{
  "query": "用户的饮食偏好",
  "userId": "user_123",
  "topK": 5,
  "filters": {
    "scope": "long-term",
    "categories": ["preference"]
  }
}
```

### memoryStore

```json
{
  "text": "用户喜欢科幻电影",
  "userId": "user_123",
  "scope": "long-term",
  "categories": ["preference", "entertainment"]
}
```

## 架构

1. **写入流程**: Agent → memoryStore → Mem0 API → Outbox → LanceDB (async)
2. **读取流程**: Agent → memorySearch → LanceDB (优先) → Mem0 (fallback)

## 开发

```bash
npm install
npm run dev    # Watch mode
npm run build  # Production build
```
