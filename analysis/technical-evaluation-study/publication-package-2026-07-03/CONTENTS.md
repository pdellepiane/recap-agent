# Package Contents and Provenance

## Included evidence

The distributable archive includes:

- this package's `README.md`, `METRICS-RESULTS.md`, and
  `metrics-summary.csv`;
- final immutable `summary.json`;
- conversation-level `conversations.csv`;
- turn-level `turn-telemetry.csv`;
- deterministic grounding population `grounding.csv`;
- `node-visits.csv` and `routes.csv`;
- completion, event-group, route, latency, token, tool, cache, cost, grounding,
  and workflow SVG charts;
- the frozen V4 overlay and immutable V3 base manifest;
- dated pricing configuration;
- grounding audit rubric and independent-review summary;
- methodology and rerun instructions.

## Authoritative hierarchy

1. Raw per-run reports and case JSON files are the authoritative execution
   evidence and remain in the repository's final study directory.
2. `summary.json` and CSV/SVG files are reproducible derivatives.
3. `METRICS-RESULTS.md` is the human interpretation layer.

The archive intentionally includes the compact results and principal evidence,
not all 67 MB of duplicate raw case/report JSON. The complete raw artifacts
remain at:

`analysis/technical-evaluation-study/artifacts/technical-study-2026-07-03T00-36-35-880Z/`

## Reproduction command

```bash
AWS_PROFILE=se-dev AWS_REGION=us-east-1 npm run eval:study
```

Re-running performs a new live study; it does not reproduce identical model or
marketplace outputs. To regenerate tables and charts exactly, use the committed
raw reports, V4 manifest, and dated pricing file.

