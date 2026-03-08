# Recall Ranking Noise Penalty Design

## Context

The current recall path already uses hybrid retrieval:

- FTS text search
- dense vector search
- reciprocal rank fusion
- lightweight lexical/time adjustments
- MMR diversity

The main failure mode in recent debugging is not missing storage. User preference memories are being written successfully, but recall top-5 results are dominated by low-value memories such as:

- client metadata
- test tokens / passwords
- system or integration traces

This causes semantically relevant memories to be pushed out of the final injected recall block.

## Longer-Term Plan

The longer-term retrieval roadmap is:

1. hybrid retrieval with larger candidate pools
2. query-intent aware reranking
3. noise-category penalties
4. memory typing
5. typed/domain-aware ranking

That remains the target design, but it is too large for a single safe iteration.

## Immediate Change

Implement only the highest-leverage, lowest-risk step now:

- add explicit noise penalties during ranking

This keeps the current retrieval architecture intact and only adjusts the final ranking score for obvious low-value memories.

## Noise Heuristics

Apply penalties to rows matching one or more of these patterns:

- metadata-like content
  - client label/id/username payloads
  - sender metadata traces
  - explicit metadata categories
- credential/test-artifact content
  - test token/password/passcode/check code style content
  - structured token patterns in clearly test-oriented text
  - token/credential categories when the query is not a credential lookup
- system-trace content
  - integration/debug/poller/capture/recall trace summaries
  - explicit system/debug categories

## Query Sensitivity

Penalties should not be applied uniformly.

- For credential-style queries, credential memories should not be penalized.
- For non-credential preference/profile queries, credential-test artifacts should be strongly penalized.

## Expected Outcome

After this change:

- preference memories should outrank metadata/test noise more often
- exact credential retrieval should keep working
- existing hybrid retrieval behavior remains intact

## Deferred Work

Not included in this iteration:

- schema-level `memory_type`
- schema-level `domains`
- intent-specific scoring weights
- larger candidate pools
- learned or model-based reranking
