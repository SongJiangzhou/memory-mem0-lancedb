import json
import os
from pathlib import Path
from typing import Any, Dict

import httpx
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel

app = FastAPI(title="Mem0 Local Server")

DEFAULT_LOCAL_DB_PATH = "./.mem0_local_db"
DEFAULT_MEM0_RUNTIME_DIR = str(Path("./.mem0_runtime").resolve())
DEFAULT_OPENCLAW_CONFIG_PATH = os.path.join("~", ".openclaw", "openclaw.json")

os.environ.setdefault("MEM0_DIR", DEFAULT_MEM0_RUNTIME_DIR)

from mem0 import Memory
from mem0.configs.embeddings.base import BaseEmbedderConfig
from mem0.embeddings.base import EmbeddingBase
from mem0.embeddings.openai import OpenAIEmbedding as Mem0OpenAIEmbedding
from mem0.utils.factory import EmbedderFactory


class OpenAICompatibleEmbedding(EmbeddingBase):
    def __init__(self, config: BaseEmbedderConfig | None = None):
        super().__init__(config)
        self.base_url = self.config.openai_base_url or "https://api.openai.com/v1"
        self.api_key = self.config.api_key or ""
        self.is_voyage = "voyageai.com" in self.base_url or str(self.config.model or "").startswith("voyage-")
        if self.is_voyage:
            self.config.model = self.config.model or "voyage-3.5-lite"
            self.config.embedding_dims = self.config.embedding_dims or 1024
            self.delegate = None
        else:
            self.delegate = Mem0OpenAIEmbedding(self.config)

    def _embed_voyage(self, text):
        normalized = str(text).replace("\n", " ").strip()
        response = httpx.post(
            f"{self.base_url.rstrip('/')}/embeddings",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.config.model,
                "input": [normalized],
                "output_dimension": self.config.embedding_dims,
            },
            timeout=30.0,
        )
        response.raise_for_status()
        data = response.json()
        return data["data"][0]["embedding"]

    def embed(self, text, memory_action=None):
        if self.is_voyage:
            return self._embed_voyage(text)
        return self.delegate.embed(text, memory_action)


EmbedderFactory.provider_to_class["openai"] = "scripts.mem0_server.OpenAICompatibleEmbedding"


def load_openclaw_config() -> Dict[str, Any]:
    config_path = Path(os.path.expanduser(DEFAULT_OPENCLAW_CONFIG_PATH))
    if not config_path.exists():
        return {}

    try:
        return json.loads(config_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"Warning: Failed to read OpenClaw config at {config_path}. Error: {e}")
        return {}


def get_env_override(name: str, fallback: str = "") -> str:
    value = os.environ.get(name)
    if value is None or value == "":
        return fallback
    return value


def get_plugin_mem0_config(openclaw_config: Dict[str, Any]) -> Dict[str, Any]:
    return (
        openclaw_config.get("plugins", {})
        .get("entries", {})
        .get("openclaw-mem0-lancedb", {})
        .get("config", {})
        .get("mem0", {})
        or {}
    )


def build_mem0_config() -> Dict[str, Any]:
    openclaw_config = load_openclaw_config()
    memory_search = openclaw_config.get("agents", {}).get("defaults", {}).get("memorySearch", {})
    plugin_mem0 = get_plugin_mem0_config(openclaw_config)
    explicit_llm = plugin_mem0.get("llm", {}) or {}

    provider = get_env_override("MEM0_EMBEDDING_PROVIDER", memory_search.get("provider") or "openai")
    if provider == "fake":
        raise ValueError("fake embedding is not supported for local mem0 server")
    if provider not in {"openai", "gemini", "ollama", "voyage"}:
        raise ValueError(f"unsupported local mem0 embedding provider: {provider}")
    remote = memory_search.get("remote", {}) or {}
    api_key = get_env_override("MEM0_EMBEDDING_API_KEY", remote.get("apiKey") or "")
    model = get_env_override("MEM0_EMBEDDING_MODEL", memory_search.get("model") or "")
    dimension = 1536
    local_db_path = get_env_override("MEM0_VECTOR_DB_PATH", DEFAULT_LOCAL_DB_PATH)
    runtime_dir = get_env_override("MEM0_RUNTIME_DIR", DEFAULT_MEM0_RUNTIME_DIR)
    Path(local_db_path).mkdir(parents=True, exist_ok=True)
    Path(runtime_dir).mkdir(parents=True, exist_ok=True)

    embedder_config: Dict[str, Any] = {
        "api_key": api_key,
    }
    default_llm_provider = explicit_llm.get("provider") or ("deepseek" if provider == "voyage" else provider)
    llm_provider = get_env_override("MEM0_LLM_PROVIDER", default_llm_provider)
    llm_base_url = get_env_override("MEM0_LLM_BASE_URL", explicit_llm.get("baseUrl") or "")
    llm_api_key = get_env_override("MEM0_LLM_API_KEY", explicit_llm.get("apiKey") or api_key)
    llm_model = get_env_override("MEM0_LLM_MODEL", explicit_llm.get("model") or "")

    llm_config: Dict[str, Any] = {
        "api_key": llm_api_key,
    }

    if provider == "gemini":
        embedder_config["model"] = model or "models/gemini-embedding-001"
        embedder_config["embedding_dims"] = 3072
        dimension = 3072
    elif provider == "ollama":
        base_url = get_env_override("MEM0_EMBEDDING_BASE_URL", remote.get("baseUrl") or "http://127.0.0.1:11434")
        embedder_config["model"] = model or "nomic-embed-text"
        embedder_config["ollama_base_url"] = base_url
        dimension = 768
    elif provider == "voyage":
        base_url = get_env_override("MEM0_EMBEDDING_BASE_URL", remote.get("baseUrl") or "https://api.voyageai.com/v1")
        embedder_config["model"] = model or "voyage-3.5-lite"
        embedder_config["embedding_dims"] = 1024
        embedder_config["openai_base_url"] = base_url
        dimension = 1024
    else:
        base_url = get_env_override("MEM0_EMBEDDING_BASE_URL", remote.get("baseUrl") or "https://api.openai.com/v1")
        embedder_config["model"] = model or "text-embedding-3-small"
        embedder_config["openai_base_url"] = base_url
        dimension = 1536

    if llm_provider == "gemini":
        llm_config["model"] = llm_model or "gemini-2.0-flash"
    elif llm_provider == "ollama":
        llm_config["model"] = llm_model or "llama3.1:70b"
        llm_config["ollama_base_url"] = llm_base_url or get_env_override("MEM0_EMBEDDING_BASE_URL", remote.get("baseUrl") or "http://127.0.0.1:11434")
        llm_config["api_key"] = llm_api_key or "ollama"
    elif llm_provider == "deepseek":
        llm_config["model"] = llm_model or "deepseek-chat"
        llm_config["deepseek_base_url"] = llm_base_url or "https://api.deepseek.com"
    else:
        llm_provider = "openai"
        llm_config["model"] = llm_model or "gpt-4.1-nano-2025-04-14"
        llm_config["openai_base_url"] = llm_base_url or "https://api.openai.com/v1"

    return {
        "history_db_path": str(Path(runtime_dir) / "history.db"),
        "vector_store": {
            "provider": "qdrant",
            "config": {
                "path": local_db_path,
                "collection_name": "mem0",
                "embedding_model_dims": dimension,
            },
        },
        "embedder": {
            "provider": "openai" if provider == "voyage" else provider,
            "config": embedder_config,
        },
        "llm": {
            "provider": llm_provider,
            "config": llm_config,
        },
    }


def initialize_memory():
    try:
        return Memory.from_config(build_mem0_config())
    except Exception as e:
        print(f"Warning: Failed to initialize Mem0. Error: {e}")
        return None


def reset_memory():
    global memory
    memory = initialize_memory()
    return memory


def is_readonly_database_error(error: Exception) -> bool:
    return "readonly database" in str(error).lower()


memory = initialize_memory()

class MemoryStoreRequest(BaseModel):
    messages: list[Dict[str, Any]]
    user_id: str | None = None
    agent_id: str | None = None
    run_id: str | None = None
    metadata: Dict[str, Any] | None = None
    filters: Dict[str, Any] | None = None

class MemorySearchRequest(BaseModel):
    query: str
    user_id: str | None = None
    agent_id: str | None = None
    run_id: str | None = None
    limit: int = 100
    filters: Dict[str, Any] | None = None

@app.get("/v1/health")
def health_check():
    if memory is None:
        raise HTTPException(status_code=500, detail="Mem0 initialization failed")
    return {"status": "ok"}


@app.get("/v1/memories/")
def list_memories(
    user_id: str | None = Query(default=None),
    agent_id: str | None = Query(default=None),
    run_id: str | None = Query(default=None),
    limit: int = Query(default=100),
):
    if memory is None:
        raise HTTPException(status_code=500, detail="Mem0 initialization failed")
    try:
        return memory.get_all(
            user_id=user_id,
            agent_id=agent_id,
            run_id=run_id,
            limit=limit,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/memories/")
def store_memory(request: MemoryStoreRequest):
    if memory is None:
        raise HTTPException(status_code=500, detail="Mem0 initialization failed")
    try:
        result = memory.add(
            messages=request.messages,
            user_id=request.user_id,
            agent_id=request.agent_id,
            run_id=request.run_id,
            metadata=request.metadata,
        )
        return result
    except Exception as e:
        if is_readonly_database_error(e):
            refreshed_memory = reset_memory()
            if refreshed_memory is None:
                raise HTTPException(status_code=500, detail="Mem0 reinitialization failed")
            try:
                return refreshed_memory.add(
                    messages=request.messages,
                    user_id=request.user_id,
                    agent_id=request.agent_id,
                    run_id=request.run_id,
                    metadata=request.metadata,
                )
            except Exception as retry_error:
                raise HTTPException(status_code=500, detail=str(retry_error))
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/memories/search/")
def search_memories(request: MemorySearchRequest):
    if memory is None:
        raise HTTPException(status_code=500, detail="Mem0 initialization failed")
    try:
        result = memory.search(
            query=request.query,
            user_id=request.user_id,
            agent_id=request.agent_id,
            run_id=request.run_id,
            limit=request.limit,
            filters=request.filters,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
