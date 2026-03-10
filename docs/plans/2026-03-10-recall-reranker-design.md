# Recall Reranker Design

## Goal

Improve automatic recall quality for local memory retrieval without introducing:

- a new model deployment
- a new cloud reranker API
- language-specific word lists or stopword stripping rules

The immediate target is to make brand/entity-constrained queries such as `What foods do I like at McDonalds?` rank the correct memory ahead of other food-related memories, while preserving low operational complexity.

## Problem

The current auto-recall path can retrieve enough candidates but still inject the wrong memories into OpenClaw:

- the candidate pool contains semantically related but entity-mismatched memories
- broad food preference memories can outrank the specific McDonald's preference
- query echoes and noisy operational memories can appear in the recall set
- previous heuristic attempts based on word-level rules do not generalize well, especially for English

Examples of problematic rule shapes:

- hand-maintained English stopword removal
- Chinese question-word stripping
- simple token-match boosts

These approaches are fragile, difficult to maintain, and make future reranker replacement harder.

## Non-Goals

- add cross-encoder reranking
- add a new external reranker API
- add a local ML service
- solve all ranking quality issues in one iteration

## Design Principles

1. Do not use word-level rules.
2. Keep reranking pluggable.
3. Separate candidate retrieval from final prompt injection.
4. Optimize for fewer, higher-confidence injected memories.
5. Prefer language-agnostic similarity heuristics over language-specific token lists.

## Proposed Architecture

### 1. Widen recall candidate retrieval

Auto recall should request a wider internal candidate pool than the final injected top-K.

Recommended behavior:

- final injected `topK` remains user-configured
- internal candidate fetch uses `max(topK * 4, 12)`

This creates room for reranking without increasing the amount of context injected into the model.

### 2. Introduce a pluggable `RecallReranker`

Define a recall-specific reranker abstraction:

***REMOVED***ts
export interface RecallReranker {
  rerank(memories: SearchResult['memories'], query: string): SearchResult['memories'];
}
***REMOVED***

`runAutoRecall()` should accept an optional `reranker` dependency and use a local default implementation when none is provided.

This keeps future migration paths open:

- stronger local heuristic reranker
- embedding-aware reranker
- cloud reranker
- cross-encoder service

without rewriting the recall pipeline.

### 3. Use a local heuristic reranker without word lists

The default local reranker should not depend on English or Chinese stopword lists.

Instead, it should combine lightweight language-agnostic signals:

- normalized full-string containment
- longest common substring overlap
- character bigram overlap
- original retrieval order as a weak tie-breaker

Normalization should stay minimal:

- lowercase
- whitespace collapse or removal
- punctuation/symbol removal

This is intentionally weaker than a true semantic reranker, but it is more robust than language-specific token filters and keeps the project dependency-free.

### 4. Budget-aware injection remains the final gate

After reranking:

- keep only the top results
- inject entries one by one under the configured `maxChars`
- never hard-truncate the entire `<recall>` block
- if only the first entry overflows, truncate that entry only

This is supported by long-context evidence: more retrieved content should not automatically mean more injected content.

## Why No Word-Level Rules

Word-level rules are explicitly rejected for this design.

Reasons:

- poor English generalization across phrasing variants
- high maintenance burden as vocabulary keeps growing
- increased false positives and false negatives
- harder migration to a real reranker later

Examples that should not reappear:

- `replace(/\b(what|which|like|prefer|favorite)\b/g, ' ')`
- Chinese question-word stripping for ranking
- direct boosts from individual token matches

Phrase/span-level similarity is acceptable. Word-list heuristics are not.

## Data Flow

1. `before_prompt_build` triggers auto recall.
2. Recall requests a widened candidate pool from memory search.
3. The reranker reorders candidates.
4. The recall block builder injects only the highest-value entries within budget.
5. OpenClaw receives a short system-context recall block.

## Expected Effects

Positive:

- better handling of entity-specific questions
- fewer irrelevant memories injected
- lower prompt waste
- easier future replacement with stronger rerankers

Trade-offs:

- local heuristic reranking is still approximate
- character/substring similarity can miss some semantic matches
- some noisy memories may still survive until further ranking signals are added

## Verification Strategy

Add and keep tests for:

- widened candidate retrieval vs final injection count
- entity-specific reranking for representative multilingual queries
- lowercase English phrasing without stopword stripping
- custom reranker injection
- budget-aware block generation

Operational verification:

- inspect `auto_recall.done`
- inspect `auto_recall.memory`
- verify the correct memory appears near the front of injected recall for entity-constrained questions

## Future Extensions

The design intentionally leaves space for stronger rerankers:

- embedding-aware reranker using existing vectors
- metadata-aware reranker
- cross-encoder or cloud reranker via the same interface

These should replace the local heuristic implementation behind `RecallReranker`, not add another parallel ranking path.
