# Live GPT-5.6 Luna validation — 2026-08-05

## Outcome

The optimized Luna implementation passed the development `live_smoke` suite:

- 3/3 cases passed with no failures or errors.
- Average hard-gate score: 1.0.
- Routes covered: entry planning, the inclusive 100-guest boundary with
  provider recommendation, and provider selection from a persisted shortlist.
- Classifier, extractor, and reply used `gpt-5.6-luna` with
  `reasoning.effort: none`.

## Measured usage and cost

| Metric | Legacy average | Optimized Luna live average | Change |
|---|---:|---:|---:|
| Input tokens | 22,411 | 11,667.33 | -47.94% |
| Cached input tokens | 14,362 | 10,025.67 | — |
| Cache-write input tokens | not reported | 1,632.67 | separately priced |
| Output tokens | 374 | 561.67 | +50.18% |
| OpenAI cost / successful full turn | $0.00457957 | $0.00128448 | -71.95% |
| Luna model-only ceiling | $0.00234584 | $0.00128448 | -45.24% |

The cost calculation uses the project-effective rates dated 2026-08-04:
`$0.20 / 1M` uncached input, `$0.02 / 1M` cached input, `$0.25 / 1M`
cache writes, and `$1.20 / 1M` output.

At 1,000 successful full turns, the measured average is approximately `$1.28`,
saving `$3.30` versus the legacy baseline and `$1.06` versus Luna at unchanged
legacy usage.

## Stored response retrieval

One post-deployment scoped turn persisted all three component references with
one attempt each. The classifier, extractor, and reply Responses were retrieved
through the GET-only audit path. Each retrieved object confirmed:

- `store: true`;
- model `gpt-5.6-luna`;
- `reasoning.effort: none`;
- implicit prompt caching with a 30-minute TTL;
- a structured output schema;
- only route-relevant tools (zero for classifier/extractor and three for the
  entry-planning reply);
- local audit files written with mode `0600`.

Raw response content remains ignored under `.openai-audits/` and is not checked
into Git.

## Cache caveat

Cost promotion uses the usage captured on the original Responses and persisted
in DynamoDB, because that telemetry includes cache-write tokens. A later GET of
the stored Response can report cache-write detail differently; retrieval is used
to audit payload content, while original turn telemetry is the billing-shape
source for this baseline.

## Promoted baseline

The machine-readable monotonic baseline is
`evals/baselines/openai-luna-optimized-2026-08-05.json`. Future promotion must
retain a 100% hard-gate pass rate while staying at or below 11,667.33 average
input tokens and `$0.00128448` average OpenAI cost per successful full turn on a
comparable representative suite.
