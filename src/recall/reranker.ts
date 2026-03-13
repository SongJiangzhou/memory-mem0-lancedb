import type { RecallRerankerConfig, SearchResult } from '../types';
import { stripPunctuation, longestCommonSubstringLength } from '../memory/text-utils';
import { RerankClient } from '../runtime/rerank-client';

const BASE_RANK_SCALE = 1;
const SUBSTRING_MATCH_BOOST = 1.5;
const LCS_SCALE = 2.5;
const BIGRAM_SCALE = 1.5;
const QUERY_ECHO_PENALTY = 3;
const OPERATIONAL_NOISE_PENALTY = 2.5;
const RERANK_TTL_MS = 10_000;
const RERANK_MAX_CONCURRENT = 2;
const RERANK_MAX_RETRIES = 2;
const RERANK_BACKOFF_MS = 500;
const sharedRerankClients = new WeakMap<typeof fetch, Map<string, RerankClient>>();

export interface RecallReranker {
  rerank(memories: SearchResult['memories'], query: string): Promise<SearchResult['memories']>;
}

export function createLocalRecallReranker(): RecallReranker {
  return {
    async rerank(memories, query) {
      const normalizedQuery = stripPunctuation(query);

      return [...memories]
        .map((memory, index) => ({
          memory,
          score: computeRecallScore(memory.text, normalizedQuery, index, memories.length),
        }))
        .sort((left, right) => right.score - left.score)
        .map((entry) => entry.memory);
    },
  };
}

export function createRecallReranker(
  config?: RecallRerankerConfig,
  fetchFn: typeof fetch = fetch,
): RecallReranker {
  if (!config || config.provider === 'local') {
    return createLocalRecallReranker();
  }

  if (config.provider === 'none') {
    return {
      async rerank(memories) {
        return memories;
      },
    };
  }

  if (config.provider !== 'voyage') {
    return createLocalRecallReranker();
  }

  const localFallback = createLocalRecallReranker();
  const client = getSharedRerankClient(config, fetchFn);
  return {
    async rerank(memories, query) {
      try {
        const rankedIndexes = await client.rerank(query, memories.map((memory) => memory.text), config);
        const ranked = applyRankedIndexes(memories, rankedIndexes);
        return ranked;
      } catch (error) {
        console.warn('[recall] Voyage reranker failed, falling back to local reranker:', error);
        return localFallback.rerank(memories, query);
      }
    },
  };
}

function getSharedRerankClient(config: RecallRerankerConfig, fetchFn: typeof fetch): RerankClient {
  const key = [
    config.provider,
    config.baseUrl || '',
    config.model || '',
  ].join('::');
  let clientsForFetch = sharedRerankClients.get(fetchFn);
  if (!clientsForFetch) {
    clientsForFetch = new Map<string, RerankClient>();
    sharedRerankClients.set(fetchFn, clientsForFetch);
  }

  const existing = clientsForFetch.get(key);
  if (existing) {
    return existing;
  }

  const client = new RerankClient({
    ttlMs: RERANK_TTL_MS,
    maxConcurrent: RERANK_MAX_CONCURRENT,
    maxRetries: RERANK_MAX_RETRIES,
    baseBackoffMs: RERANK_BACKOFF_MS,
    execute: (query, documents, runtimeConfig) => rerankWithVoyage(query, documents, runtimeConfig, fetchFn),
  });
  clientsForFetch.set(key, client);
  return client;
}

async function rerankWithVoyage(
  query: string,
  documents: string[],
  config: RecallRerankerConfig,
  fetchFn: typeof fetch,
): Promise<number[]> {
  if (documents.length <= 1) {
    return documents.map((_value, index) => index);
  }

  const baseUrl = (config.baseUrl || 'https://api.voyageai.com/v1').replace(/\/$/, '');
  const response = await fetchFn(`${baseUrl}/rerank`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || 'rerank-2.5-lite',
      query,
      documents,
    }),
  });

  if (!response.ok) {
    throw new Error(`Voyage rerank request failed with status ${response.status}`);
  }

  const body = await response.json() as { data?: Array<{ index?: number; relevance_score?: number }> };
  const scored = body.data ?? [];
  const rankedIndexes = new Set<number>();
  const orderedIndexes: number[] = [];

  scored
    .sort((left, right) => (right.relevance_score ?? 0) - (left.relevance_score ?? 0))
    .forEach((entry) => {
      const index = entry.index;
      if (typeof index !== 'number' || index < 0 || index >= documents.length || rankedIndexes.has(index)) {
        return;
      }
      rankedIndexes.add(index);
      orderedIndexes.push(index);
    });

  documents.forEach((_memory, index) => {
    if (!rankedIndexes.has(index)) {
      orderedIndexes.push(index);
    }
  });

  return orderedIndexes;
}

function applyRankedIndexes(memories: SearchResult['memories'], rankedIndexes: number[]): SearchResult['memories'] {
  const seen = new Set<number>();
  const ranked: SearchResult['memories'] = [];

  for (const index of rankedIndexes) {
    if (index < 0 || index >= memories.length || seen.has(index)) {
      continue;
    }
    seen.add(index);
    ranked.push(memories[index]!);
  }

  memories.forEach((memory, index) => {
    if (!seen.has(index)) {
      ranked.push(memory);
    }
  });

  return ranked;
}

function computeRecallScore(text: string, normalizedQuery: string, index: number, total: number): number {
  const normalizedText = stripPunctuation(text);
  let score = (Math.max(total - index, 1) / Math.max(total, 1)) * BASE_RANK_SCALE;

  if (!normalizedQuery || !normalizedText) {
    return score;
  }

  if (normalizedText === normalizedQuery) {
    return score - QUERY_ECHO_PENALTY;
  }

  if (looksOperationalNoise(text)) {
    score -= OPERATIONAL_NOISE_PENALTY;
  }

  if (normalizedText.includes(normalizedQuery) || normalizedQuery.includes(normalizedText)) {
    score += SUBSTRING_MATCH_BOOST;
  }

  const lcsLength = longestCommonSubstringLength(normalizedQuery, normalizedText);
  score += (lcsLength / Math.max(normalizedQuery.length, 1)) * LCS_SCALE;

  const queryBigrams = buildBigrams(normalizedQuery);
  const textBigrams = buildBigrams(normalizedText);
  const overlap = jaccardSimilarity(queryBigrams, textBigrams);
  score += overlap * BIGRAM_SCALE;

  return score;
}

function buildBigrams(text: string): Set<string> {
  const values = new Set<string>();
  if (text.length < 2) {
    if (text) {
      values.add(text);
    }
    return values;
  }

  for (let i = 0; i < text.length - 1; i++) {
    values.add(text.slice(i, i + 2));
  }
  return values;
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;
  left.forEach((value) => {
    if (right.has(value)) {
      intersection += 1;
    }
  });

  const union = left.size + right.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function looksOperationalNoise(text: string): boolean {
  return /\/|\\|\.jsonl\b|written to|saved to|data written|workspace|scripts\//i.test(String(text || ''));
}
