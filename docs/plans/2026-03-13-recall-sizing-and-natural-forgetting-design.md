# Recall Sizing And Natural Forgetting Design

## Summary

This design combines two related changes:

1. Normalize recall quantity parameters into a single internal sizing policy.
2. Let low-value memories fade out naturally through ranking decay and lifecycle transitions.

The goal is to make recall behavior easier to reason about while avoiding word-level filtering rules.

## Goals

- Keep `autoRecall.topK` as the only user-facing recall quantity input.
- Replace scattered hard-coded recall counts with one internal sizing policy.
- Preserve the current direct-to-`long-term` auto-capture behavior.
- Make low-value memories fade gradually before they are isolated from normal recall.
- Use lifecycle metrics and time, not token-level or keyword-level rules.

## Non-Goals

- Do not normalize ranking boost and penalty constants in this phase.
- Do not change query rewrite semantics in this phase.
- Do not add new user-facing config fields in this phase.
- Do not remove existing lifecycle states or rewrite the lifecycle model from scratch.

## Problem

Current recall quantity behavior is spread across multiple layers:

- `autoRecall.topK`
- `candidateTopK = max(topK * 2, 12)`
- primary hybrid fetch size `max(topK * 6, 24)`
- secondary FTS fetch size `max(topK * 4, 16)`
- query variant cap `3`

These values are related, but the relationship is implicit and distributed across files. That makes tuning difficult and makes it harder to reason about how much candidate slack the recall pipeline really has.

Separately, low-value memories already have partial decay support through lifecycle-aware ranking and worker-based lifecycle transitions, but the intended "natural fade-out" behavior is not yet expressed as a unified product model.

## Proposed Design

### 1. Internal Recall Sizing Policy

Introduce a single internal policy module that derives all recall quantities from `autoRecall.topK`.

Proposed derived values:

- `injectTopK = autoRecall.topK`
- `candidateTopK = max(injectTopK * 2, 12)`
- `primaryFetchK = max(candidateTopK * 6, 24)`
- `secondaryFetchK = max(candidateTopK * 4, 16)`
- `maxQueryVariants = 3`

This keeps external behavior stable while making the relationship explicit.

### 2. Natural Forgetting Model

Natural forgetting will happen in two layers.

#### A. Ranking-layer fading

Low-value memories remain recall-eligible at first, but they become less likely to rank near the top over time.

Signals used here:

- recency decay
- `strength`
- `utility_score`
- `stability`
- inhibition state / inhibition window

This is continuous degradation, not a hard cutoff.

#### B. Lifecycle-layer state transitions

If a memory stays weak for long enough, lifecycle workers move it through progressively more restrictive states:

- `active`
- `inhibited`
- `quarantined`
- `deleted`

For this phase, the product default should be conservative:

- ranking decay is active
- automatic lifecycle fading should primarily move toward `quarantined`
- `deleted` remains a later, stricter step

This gives the system a reversible buffer before final removal.

## Behavioral Model

### Recall quantities

The recall pipeline should behave like this:

1. Start with `injectTopK`.
2. Expand to `candidateTopK` before reranking.
3. Expand again to fetch enough raw rows for hybrid search and deduplication.
4. Merge, deduplicate, apply lifecycle-aware ranking, then rerank.
5. Inject at most `injectTopK`, still subject to the `maxChars` budget.

### Low-value memory fading

The intended progression is:

1. Memory is still `active`, but ranks lower as effective value decays.
2. If low value persists, lifecycle worker marks it `inhibited`.
3. If weakness persists further, lifecycle worker marks it `quarantined`.
4. Only after longer-lived evidence of low value should deletion be considered.

This means "forgetting" is gradual:

- first harder to surface
- then excluded from normal recall
- only later physically removed

## Why This Design

### Why normalize quantity parameters now

- It preserves existing behavior while removing hidden coupling between recall layers.
- It makes future tuning measurable and explainable.
- It gives a stable foundation for lifecycle-aware recall changes.

### Why use both ranking decay and lifecycle transitions

- Ranking decay makes fading feel gradual.
- Lifecycle transitions provide operational boundaries for hidden or retired memories.
- Using both avoids a brittle all-or-nothing system.

### Why stop automatic fading at `quarantined` by default

- It reduces the risk of premature deletion.
- It preserves recoverability.
- It matches the desired "natural fade-out" behavior better than immediate removal.

## Interaction With Reranking

Reranking is the final orderer, so pure pre-rerank decay is not enough to guarantee fade-out on its own.

This design therefore treats fading as a layered system:

- pre-rerank ranking reduces the chance that low-value memories remain strong candidates
- lifecycle transitions eventually remove weak memories from ordinary recall eligibility

This avoids direct conflict with rerankers while still making fade-out effective.

## Implementation Outline

### Phase 1: Recall sizing normalization

- Add a small internal module that computes sizing values from `autoRecall.topK`.
- Replace duplicated constants in `src/recall/auto.ts`, `src/hot/search.ts`, and query variant handling with calls to that policy.
- Keep observable behavior unchanged.

### Phase 2: Natural forgetting alignment

- Make ranking-layer lifecycle decay an explicit part of the recall design.
- Verify lifecycle worker thresholds and transitions match the intended fade-out model.
- Keep automatic progression conservative, with `quarantined` as the primary default destination for weak memories.

### Phase 3: Validation

- Add tests that prove sizing values are derived consistently.
- Add tests that prove weak memories rank below stronger peers over time.
- Add tests that prove weak memories can transition to `inhibited` and then `quarantined`.
- Keep deletion behavior under stricter tests and thresholds.

## Risks

- If sizing normalization accidentally changes effective fetch counts, recall quality may shift unexpectedly.
- If lifecycle decay is too aggressive, useful memories may disappear from normal recall too early.
- If lifecycle decay is too weak, long-term storage may retain too much low-value clutter.

## Mitigations

- Keep phase 1 behavior-preserving and test exact derived quantities.
- Prefer conservative lifecycle transitions.
- Treat `quarantined` as the default automatic buffer before deletion.

## Open Questions

- Whether later phases should expose sizing policy knobs for operator tuning.
- Whether post-rerank lifecycle blending is needed in addition to pre-rerank decay.
- How to measure long-term recall quality improvements after fade-out changes land.
