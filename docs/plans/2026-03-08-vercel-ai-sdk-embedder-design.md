# Design: Replace Hand-Written Embedder with Vercel AI SDK

Date: 2026-03-08

## Problem

`src/hot/embedder.ts` contains hand-written HTTP implementations for each embedding provider. This caused a production bug: the Gemini URL was hard-coded to `/v1beta/` but `text-embedding-004` only works with `/v1/`, silently breaking all LanceDB writes when Gemini was configured.

## Goal

Replace the three hand-written `fetch*Embedding` functions with Vercel AI SDK provider adapters. Public interface (`embedText` signature and `EmbeddingConfig` type) remains unchanged.

## Scope

**Changed:** `src/hot/embedder.ts` only.

**Unchanged:** `src/types.ts`, `src/hot/search.ts`, `src/bridge/adapter.ts`, all tests, `openclaw.plugin.json`, config schema.

## Dependencies

***REMOVED***
ai               # embed() unified interface
@ai-sdk/google   # Gemini provider
@ai-sdk/openai   # OpenAI + Ollama compatible
***REMOVED***

## Provider Mapping (Option C)

| `EmbeddingConfig.provider` | SDK call |
|---|---|
| `gemini` | `createGoogleGenerativeAI({ apiKey, baseURL })` |
| `openai` | `createOpenAI({ apiKey, baseURL })` |
| `ollama` | `createOpenAI({ apiKey: 'ollama', baseURL: cfg.baseUrl + '/v1' })` |
| `fake` | retained as-is (char-code bucketing, no network) |

Ollama exposes an OpenAI-compatible endpoint at `/v1/embeddings` since v0.1.24. Using `@ai-sdk/openai` with a custom baseURL covers it without a separate Ollama package.

## Data Flow

***REMOVED***
embedText(text, cfg)
  └─ provider === 'fake' → fakeEmbedText()          (no change)
  └─ provider === 'gemini' → createGoogleGenerativeAI → embed()
  └─ provider === 'openai' → createOpenAI            → embed()
  └─ provider === 'ollama' → createOpenAI (baseURL+'/v1') → embed()
***REMOVED***

`embed()` returns `{ embedding: number[] }`. Dimension is determined by the model; callers already rely on `EmbeddingConfig.dimension` for table schema, not on runtime vector length validation.

## Error Handling

SDK throws on HTTP errors with structured messages. Existing `try/catch` in `embedText` re-throws, which propagates to `upsertMemory` → logged as `[memoryStore] Failed`. No change needed.

## Testing

Existing tests use `provider: 'fake'` exclusively and remain unaffected. No integration tests for live API calls (these are E2E concerns). The embedder unit tests (`embedText is stable`, `embedText returns fixed-dimension vectors`, etc.) continue to pass against the fake path.

## Why Not Change EmbeddingConfig

The config schema is exposed in `openclaw.plugin.json` and consumed by the host (OpenClaw). Changing it would break existing user configurations. The Ollama case is handled transparently inside the implementation.
