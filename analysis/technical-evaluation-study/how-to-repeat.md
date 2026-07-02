# How to Repeat

```bash
npm run typecheck
npm run lint
npm test
npm run eval:study -- --dry-run
npm run deploy
npm run eval:study
```

The live command writes a new timestamped folder under `artifacts/`. Never edit
raw run reports after execution. Re-run the generator from the same immutable
reports if presentation artifacts need to change.

Before comparing two study dates, record the deployed Lambda version, model
aliases, prompt bundle, provider index, marketplace snapshot time, AWS region,
and price-file version. Model aliases and live marketplace data can change, so
two dates are not automatically controlled replications.

To recompute independent-review agreement, join the primary and independent
CSV files by `scenario`, then compare the four rubric columns. Keep need
coverage separate from provider-level faithfulness, and treat absent catalog
evidence as unknown rather than positive support.
