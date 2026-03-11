<div align="center">
  <h1>OpenClaw Memory Plugin</h1>
  <p><strong>🧠 Supercharge your AI Agents with Persistent, Smart Memory 🧠</strong></p>
  <p>
    <a href="./README.zh-CN.md">中文说明 (Chinese)</a>
  </p>
</div>

---

**OpenClaw-Mem0-LanceDB** is an advanced memory plugin that gives your OpenClaw agents long-term recall and continuous learning capabilities. It seamlessly combines **[Mem0](https://github.com/mem0ai/mem0)** as the intelligent control plane for memory extraction/management and **[LanceDB](https://github.com/lancedb/lancedb)** as the ultra-fast retrieval hot plane using vector and full-text search.

Whether you are a beginner looking to give your agent a persistent identity, or a senior engineer building scalable multi-agent systems, this plugin scales with your needs.

---

## 🏗️ Architecture Overview

The plugin employs a **Tri-Plane Embedded Architecture** designed for reliability, fast retrieval, and ultimate auditability.

```mermaid
graph TD
    classDef plane fill:#2d3748,stroke:#4a5568,stroke-width:2px,color:#fff;
    classDef component fill:#4299e1,stroke:#2b6cb0,stroke-width:2px,color:#fff;
    classDef db fill:#48bb78,stroke:#2f855a,stroke-width:2px,color:#fff;

    subgraph AgentSpace [OpenClaw Agent]
        A(User Input)
        B(Agent Tools)
        Hooks(Lifecycle Hooks)
    end
    
    subgraph Plugin [OpenClaw Memory Plugin]
        direction TB
        
        subgraph HotPlane [🔥 Hot Plane - LanceDB]
            class HotPlane plane
            LDB[Hybrid RRF Retrieval]:::db
            VIdx[Vector Index]
            FTS[Full Text Search]
            LDB --- VIdx
            LDB --- FTS
        end
        
        subgraph ControlPlane [🧠 Control Plane - Mem0]
            class ControlPlane plane
            MClient[Mem0 Gateway]:::component
            PWorker[Sync Poller]
            MClient --- AutoCapture
        end
        
        subgraph AuditPlane [📝 Audit Plane - File System]
            class AuditPlane plane
            ALog[(JSONL Audit Log)]:::db
            Outbox(Sync Outbox)
        end
    end

    A --> Hooks
    B -- memoryStore --> AuditPlane
    B -- memorySearch --> HotPlane
    
    Hooks -- Auto Capture --> ControlPlane
    Hooks -- Auto Recall --> HotPlane
    
    AuditPlane -. Async Sync .-> ControlPlane
    ControlPlane -. Extract & Sync .-> HotPlane
    HotPlane -. Fallback .-> ControlPlane
```

### The Three Planes
1. **📝 Audit Plane (Source of Truth)**: A file-first, append-only JSONL log (`auditStorePath`). It ensures no memory is lost and provides a human-readable tracing mechanism.
2. **🔥 Hot Plane (Retrieval Layer)**: Powered by LanceDB, it provides blazing fast Hybrid Search (Vector + Full-Text Search + Reciprocal Rank Fusion) for immediate context recall.
3. **🧠 Control Plane (Intelligence Layer)**: Uses Mem0 (Local or Remote) to intelligently extract entities, preferences, and facts from conversations, and handles cross-device synchronization.

---

## 🚀 Quick Start (For Beginners)

Get your agent remembering in seconds!

### 1. Installation

Run the installation script in your OpenClaw workspace:

```bash
cd plugins/openclaw-mem0-lancedb
bash scripts/install.sh
```

### 2. Configuration

Add the plugin to your `openclaw.json` config file. Here is the minimal recommended setup using a local Mem0 server:

```json
{
  "plugins": {
    "slots": {
      "memory": "openclaw-mem0-lancedb"
    },
    "entries": {
      "openclaw-mem0-lancedb": {
        "enabled": true,
        "config": {
          "mem0": {
            "mode": "local",
            "baseUrl": "http://127.0.0.1:8000",
            "apiKey": ""
          },
          "lancedbPath": "~/.openclaw/workspace/data/memory/lancedb",
          "outboxDbPath": "~/.openclaw/workspace/data/memory/outbox.json",
          "auditStorePath": "~/.openclaw/workspace/data/memory/audit/memory_records.jsonl",
          "autoRecall": {
            "enabled": true,
            "topK": 5
          },
          "autoCapture": {
            "enabled": true
          }
        }
      }
    }
  }
}
```

*Tip: Enable `autoCapture` and `autoRecall` to run the plugin in its normal hook-first mode. The agent can save and recall memories without explicit tool calls.*

### Recommended: Voyage AI (Best for RAG)

For production use cases requiring highly accurate semantic retrieval, we strongly recommend using [Voyage AI](https://www.voyageai.com/) for both embeddings and reranking.

---

## 🤖 Hook-First Runtime

This plugin is designed as a **hook-first memory sidecar** for OpenClaw. In normal operation, hooks are the primary interface and tools are optional operator utilities.

If your OpenClaw host supports standard hooks (`before_prompt_build`, `agent_end`), the plugin operates autonomously:

### 📥 Auto Capture (Primary Write Path)
At the end of a turn (`agent_end`), if enabled, the plugin submits the `User + Assistant` conversation to Mem0. Mem0 extracts facts, preferences, and profile changes. The result is then synced into the local audit log and LanceDB hot plane.

### 📤 Auto Recall (Primary Read Path)
Before the agent replies (`before_prompt_build`), the plugin searches the hot plane using the latest user query. Relevant memories are injected into the prompt context automatically, so the model does not need to remember to call a search tool.

### 🔁 Async Convergence: Poller And Workers
Hooks own the dialogue-time path. Background components own eventual consistency:

- `Mem0Poller` reconciles delayed Mem0 events and pulls confirmed captured memories back into local state.
- `EmbeddingMigrationWorker` upgrades or fills vector data for legacy rows.
- `MemoryConsolidationWorker` merges and cleans memory state to improve recall quality.
- `MemoryLifecycleWorker` maintains lifecycle transitions and long-term search hygiene.

This split is intentional:

- hooks keep the user-facing path fast and deterministic
- poller/worker processes repair and converge asynchronous state in the background

---

## 🛠️ Admin/Debug Tools (For Operators And Developers)

### 🔍 `memory_search` & `memorySearch`
Manual operator/debug retrieval tools. They query the LanceDB Hot Plane using Hybrid Search (Vector + BM25 FTS) and can fall back to Mem0 if results are scarce.

```json
{
  "query": "user's dietary preferences",
  "userId": "user_123",
  "topK": 5,
  "filters": {
    "scope": "long-term",
    "categories": ["preference"]
  }
}
```

### 💾 `memoryStore`
Manual admin write path for repair, import, and controlled testing. The write path still preserves the normal safety chain:
`Operator -> Audit Plane -> Local Outbox -> Mem0 Control Plane -> LanceDB Hot Plane`

```json
{
  "text": "The user allergic to peanuts.",
  "userId": "user_123",
  "scope": "long-term",
  "categories": ["preference", "health"]
}
```

### 📖 `memory_get`
Reads raw JSONL snippets directly from the Audit Plane for diagnostics or deep chronological analysis.

---

## 🔧 Local Development & Testing

Debugging remote memory services can be tedious. We bundle a Local Mem0 API server to make hacking easy.

1. **Prerequisites**: Install `uv` (`pip install uv` or via homebrew).
2. **Setup**: Run `npm run mem0:setup` to spawn an isolated virtual environment and install dependencies (including `google-genai` for local Gemini embedding fallback).
3. **Start**: Run `npm run mem0:start` (listens on `127.0.0.1:8000`).

The local server seamlessly reads your `~/.openclaw/openclaw.json` to reuse your existing LLM defaults (`agents.defaults.memorySearch`) for embeddings.

### Developer Commands
```bash
npm install      # Install JS dependencies
npm run dev      # Compile TS on the fly
npm run build    # Build output bundle
npm test         # Run unit test suite
```
