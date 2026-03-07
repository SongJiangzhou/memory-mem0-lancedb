import { EmbeddingConfig } from '../types';

export const FAKE_EMBEDDING_DIM = 16;

export async function embedText(text: string, cfg?: EmbeddingConfig): Promise<number[]> {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return new Array<number>(cfg?.dimension || FAKE_EMBEDDING_DIM).fill(0);
  }

  if (!cfg || cfg.provider === 'fake') {
    return fakeEmbedText(normalized);
  }

  try {
    if (cfg.provider === 'openai') {
      return await fetchOpenAiEmbedding(normalized, cfg);
    } else if (cfg.provider === 'gemini') {
      return await fetchGeminiEmbedding(normalized, cfg);
    } else if (cfg.provider === 'ollama') {
      return await fetchOllamaEmbedding(normalized, cfg);
    }
  } catch (err) {
    console.error(`[embedder] Failed to fetch ${cfg.provider} embedding:`, err);
    throw err;
  }
  
  return fakeEmbedText(normalized);
}

function fakeEmbedText(normalized: string): number[] {
  const normLower = normalized.toLowerCase();
  const vector = new Array<number>(FAKE_EMBEDDING_DIM).fill(0);

  for (let index = 0; index < normLower.length; index += 1) {
    const code = normLower.charCodeAt(index);
    vector[index % FAKE_EMBEDDING_DIM] += code;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return vector;
  }

  return vector.map((value) => value / norm);
}

async function fetchOpenAiEmbedding(text: string, cfg: EmbeddingConfig): Promise<number[]> {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/v1/embeddings`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`
    },
    body: JSON.stringify({
      model: cfg.model || 'text-embedding-3-small',
      input: text
    })
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json() as any;
  return data.data[0].embedding;
}

async function fetchGeminiEmbedding(text: string, cfg: EmbeddingConfig): Promise<number[]> {
  const model = cfg.model || 'models/text-embedding-004';
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/v1beta/${model}:embedContent?key=${cfg.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model,
      content: { parts: [{ text }] }
    })
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json() as any;
  return data.embedding.values;
}

async function fetchOllamaEmbedding(text: string, cfg: EmbeddingConfig): Promise<number[]> {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/api/embeddings`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model || 'nomic-embed-text',
      prompt: text
    })
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json() as any;
  return data.embedding;
}
