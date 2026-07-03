# Technical Evaluation Metrics Package

Date prepared: 2026-07-03  
System: Recap event-planning agent  
Final study: `technical-study-2026-07-03T00-36-35-880Z`  
Manifest: `technical-evaluation-50-v4`

This package consolidates the final technical evaluation into one
publication-oriented deliverable. It explains what every reported metric
means, what population it measures, how it was calculated, the observed
result, and the appropriate interpretation.

## Main result

The deployed system completed 133 of 150 live scenario conversations:
**88.67% technical completion** with a **95% Wilson confidence interval of
82.60%–92.80%**. All 150 conversations executed without runtime error or
timeout.

The system was especially strong at structured understanding and constraint
safety:

- expected-need extraction: 159/162 (98.15%);
- canonical category consistency: 704/704 displayed providers (100%);
- known location contradictions: 0/704;
- persistence assertion: 149/150 (99.33%);
- shortlist assertion: 48/48 applicable conversations (100%).

The principal limitation is recommendation coverage after extraction:

- retrieval coverage given extraction: 111/159 (69.81%);
- end-to-end expected-need coverage: 111/162 (68.52%).

This means the agent usually understood the requested provider needs, but it
did not always obtain a recommendation for every correctly extracted need.

## How to read the package

- `METRICS-RESULTS.md`: complete interpretation, definitions, formulas, and
  results.
- `metrics-summary.csv`: machine-readable metric inventory.
- `CONTENTS.md`: provenance and file index.
- `evidence/`: immutable study outputs, charts, scenario manifest, pricing,
  and audit material.

## Important grounding distinction

The final study's `180/180 grounded turns` means every turn requiring external
grounding had captured marketplace/tool provenance. It does **not** mean every
free-text rationale was semantically justified.

The separate independent historical audit found:

- provider existence: 20/20;
- attribute faithfulness: 15/20;
- rationale support: 1/10 applicable recommendation turns;
- hard-constraint consistency: 11/20.

That audit used iteration-3 responses and predates the final V4 fixes. It is
evidence of historical rationale weakness, not a manual score for the final
150-conversation run.

## Defensible publication claim

> Across 150 live conversations representing 50 event-planning scenarios, the
> system achieved 88.67% technical completion (95% CI: 82.60%–92.80%) without
> runtime errors or timeouts. Expected-need extraction reached 98.15%, while
> end-to-end recommendation coverage reached 68.52%, identifying retrieval as
> the primary remaining limitation.

