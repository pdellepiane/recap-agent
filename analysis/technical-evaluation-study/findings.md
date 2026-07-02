# Findings

## Current evidence

- Iteration 3 executed 150/150 conversations without runtime error or timeout.
- Known location mismatch was 0%; category and budget satisfaction were 100%.
- Event-service evidence among decoration appearances was 57.35%.
- All scenario classifications repeated identically across three repetitions.
- Only 39/150 conversations passed every frozen hard assertion.

## Interpretation

The strict completion result is not a valid general task-success estimate:
several expected-need labels are noncanonical and some paths are too narrow.
Benchmark contamination is not a blanket explanation, because clarification,
multi-need, pause/resume, no-results, and recovery had no strict completions.
The iteration-3 primary and independent grounding reviews are complete.
Provider-existence judgments agreed 20/20. Agreement was 16/20 for attribute
faithfulness, 17/20 for rationale support, and 17/20 for hard-constraint
consistency. The independent reviewer passed only 1/10 recommendation turns on
all applicable dimensions. This is stronger evidence of historical rationale
and constraint-grounding weakness than the primary review alone.

Missing requested needs are evaluated separately as need-coverage failures.
They do not automatically make the attributes of a displayed provider false.
Conversely, missing catalog evidence for capacity, event suitability, or a
service cannot support a positive recommendation rationale.

The clean provider index contains one completed 182-document batch with full
localized ficha notes. Its final 13-case targeted run passed every safety gate,
with one harness miss caused by a null birthday event type. This is evidence
for measuring extraction repeatability in the untouched study, not for
post-hoc prompt tuning.

## Publication assessment

The evidence is not ready for a high-performing recommender or efficacy claim.
It can support an honest engineering/evaluation case study centered on
instrumentation, reproducibility, grounding, and discovered failure modes.

Before an empirical performance submission:

1. Version a corrected manifest without modifying historical runs.
2. Separate expected-need extraction recall from retrieval coverage.
3. Fix genuine missing-location and route-family failures.
4. Report both grounding reviewers and the adjudication policy.
5. Run one untouched confirmatory 50×3 study.
6. Add a baseline or ablation for any improvement/superiority claim.
