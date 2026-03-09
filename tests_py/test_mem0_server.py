import json
import os
import tempfile
import unittest
from pathlib import Path

from scripts import mem0_server


class Mem0ServerConfigTests(unittest.TestCase):
    def test_build_mem0_config_uses_openclaw_memory_search_gemini_settings(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            home = Path(tmpdir)
            config_dir = home / ".openclaw"
            config_dir.mkdir(parents=True, exist_ok=True)
            (config_dir / "openclaw.json").write_text(
                json.dumps(
                    {
                        "agents": {
                            "defaults": {
                                "memorySearch": {
                                    "enabled": True,
                                    "provider": "gemini",
                                    "remote": {
                                        "apiKey": "gemini-key",
                                    },
                                }
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            previous_home = os.environ.get("HOME")
            os.environ["HOME"] = str(home)
            try:
                config = mem0_server.build_mem0_config()
            finally:
                if previous_home is None:
                    os.environ.pop("HOME", None)
                else:
                    os.environ["HOME"] = previous_home

        self.assertEqual(config["embedder"]["provider"], "gemini")
        self.assertEqual(config["embedder"]["config"]["api_key"], "gemini-key")
        self.assertEqual(config["embedder"]["config"]["model"], "models/gemini-embedding-001")
        self.assertEqual(config["embedder"]["config"]["embedding_dims"], 3072)
        self.assertEqual(config["llm"]["provider"], "gemini")
        self.assertEqual(config["llm"]["config"]["api_key"], "gemini-key")
        self.assertEqual(config["llm"]["config"]["model"], "gemini-2.0-flash")
        self.assertEqual(config["vector_store"]["provider"], "qdrant")
        self.assertEqual(config["vector_store"]["config"]["embedding_model_dims"], 3072)
        self.assertTrue(config["history_db_path"].endswith(".mem0_runtime/history.db"))

    def test_build_mem0_config_allows_environment_overrides(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            home = Path(tmpdir)
            config_dir = home / ".openclaw"
            config_dir.mkdir(parents=True, exist_ok=True)
            (config_dir / "openclaw.json").write_text(
                json.dumps(
                    {
                        "agents": {
                            "defaults": {
                                "memorySearch": {
                                    "enabled": True,
                                    "provider": "gemini",
                                    "remote": {
                                        "apiKey": "gemini-key",
                                    },
                                }
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            previous = {
                "HOME": os.environ.get("HOME"),
                "MEM0_EMBEDDING_PROVIDER": os.environ.get("MEM0_EMBEDDING_PROVIDER"),
                "MEM0_EMBEDDING_API_KEY": os.environ.get("MEM0_EMBEDDING_API_KEY"),
                "MEM0_EMBEDDING_MODEL": os.environ.get("MEM0_EMBEDDING_MODEL"),
                "MEM0_EMBEDDING_BASE_URL": os.environ.get("MEM0_EMBEDDING_BASE_URL"),
                "MEM0_LLM_MODEL": os.environ.get("MEM0_LLM_MODEL"),
                "MEM0_VECTOR_DB_PATH": os.environ.get("MEM0_VECTOR_DB_PATH"),
            }
            os.environ["HOME"] = str(home)
            os.environ["MEM0_EMBEDDING_PROVIDER"] = "ollama"
            os.environ["MEM0_EMBEDDING_API_KEY"] = "override-key"
            os.environ["MEM0_EMBEDDING_MODEL"] = "nomic-embed-text"
            os.environ["MEM0_EMBEDDING_BASE_URL"] = "http://127.0.0.1:11434"
            os.environ["MEM0_LLM_MODEL"] = "llama3.2"
            os.environ["MEM0_VECTOR_DB_PATH"] = "/tmp/mem0-test-db"
            try:
                config = mem0_server.build_mem0_config()
            finally:
                for key, value in previous.items():
                    if value is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = value

        self.assertEqual(config["embedder"]["provider"], "ollama")
        self.assertEqual(config["embedder"]["config"]["api_key"], "override-key")
        self.assertEqual(config["embedder"]["config"]["model"], "nomic-embed-text")
        self.assertEqual(config["embedder"]["config"]["ollama_base_url"], "http://127.0.0.1:11434")
        self.assertEqual(config["llm"]["config"]["model"], "llama3.2")
        self.assertEqual(config["vector_store"]["config"]["path"], "/tmp/mem0-test-db")
        self.assertEqual(config["vector_store"]["config"]["embedding_model_dims"], 768)

    def test_build_mem0_config_rejects_fake_provider(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            home = Path(tmpdir)
            config_dir = home / ".openclaw"
            config_dir.mkdir(parents=True, exist_ok=True)
            (config_dir / "openclaw.json").write_text(
                json.dumps(
                    {
                        "agents": {
                            "defaults": {
                                "memorySearch": {
                                    "enabled": True,
                                    "provider": "fake",
                                }
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            previous_home = os.environ.get("HOME")
            os.environ["HOME"] = str(home)
            try:
                with self.assertRaisesRegex(ValueError, "fake embedding is not supported for local mem0 server"):
                    mem0_server.build_mem0_config()
            finally:
                if previous_home is None:
                    os.environ.pop("HOME", None)
                else:
                    os.environ["HOME"] = previous_home

    def test_mem0_dir_defaults_to_project_local_runtime_directory(self) -> None:
        self.assertTrue(mem0_server.DEFAULT_MEM0_RUNTIME_DIR.endswith(".mem0_runtime"))
        self.assertEqual(os.environ.get("MEM0_DIR"), mem0_server.DEFAULT_MEM0_RUNTIME_DIR)

    def test_list_memories_uses_mem0_get_all_and_returns_results(self) -> None:
        original_memory = mem0_server.memory

        class FakeMemory:
            def get_all(self, **kwargs):
                self.kwargs = kwargs
                return {"results": [{"id": "m1", "memory": "User prefers Coke"}]}

        fake_memory = FakeMemory()
        mem0_server.memory = fake_memory
        try:
            result = mem0_server.list_memories(user_id="default", limit=5)
        finally:
            mem0_server.memory = original_memory

        self.assertEqual(result, {"results": [{"id": "m1", "memory": "User prefers Coke"}]})
        self.assertEqual(fake_memory.kwargs["user_id"], "default")
        self.assertEqual(fake_memory.kwargs["limit"], 5)

    def test_store_memory_does_not_pass_filters_to_mem0_add(self) -> None:
        original_memory = mem0_server.memory

        class FakeMemory:
            def add(self, **kwargs):
                self.kwargs = kwargs
                return {"results": [{"id": "m1", "memory": "User prefers Coke"}]}

        fake_memory = FakeMemory()
        mem0_server.memory = fake_memory
        try:
            request = mem0_server.MemoryStoreRequest(
                messages=[{"role": "user", "content": "I prefer Coke"}],
                user_id="default",
                metadata={"scope": "long-term"},
                filters={"scope": "long-term"},
            )
            result = mem0_server.store_memory(request)
        finally:
            mem0_server.memory = original_memory

        self.assertEqual(result, {"results": [{"id": "m1", "memory": "User prefers Coke"}]})
        self.assertEqual(fake_memory.kwargs["user_id"], "default")
        self.assertEqual(fake_memory.kwargs["metadata"], {"scope": "long-term"})
        self.assertNotIn("filters", fake_memory.kwargs)

    def test_store_memory_retries_after_readonly_database_error(self) -> None:
        original_memory = mem0_server.memory
        original_initialize_memory = mem0_server.initialize_memory

        class ReadonlyMemory:
            def __init__(self) -> None:
                self.calls = 0

            def add(self, **kwargs):
                self.calls += 1
                raise Exception("attempt to write a readonly database")

        class FreshMemory:
            def __init__(self) -> None:
                self.kwargs = None

            def add(self, **kwargs):
                self.kwargs = kwargs
                return {"results": [{"id": "m2", "memory": "Recovered memory"}]}

        readonly_memory = ReadonlyMemory()
        fresh_memory = FreshMemory()
        mem0_server.memory = readonly_memory
        mem0_server.initialize_memory = lambda: fresh_memory
        try:
            request = mem0_server.MemoryStoreRequest(
                messages=[{"role": "user", "content": "Recovered memory"}],
                user_id="default",
                metadata={"scope": "long-term"},
            )
            result = mem0_server.store_memory(request)
            self.assertEqual(result, {"results": [{"id": "m2", "memory": "Recovered memory"}]})
            self.assertEqual(readonly_memory.calls, 1)
            self.assertEqual(fresh_memory.kwargs["user_id"], "default")
            self.assertEqual(mem0_server.memory, fresh_memory)
        finally:
            mem0_server.memory = original_memory
            mem0_server.initialize_memory = original_initialize_memory

if __name__ == "__main__":
    unittest.main()
