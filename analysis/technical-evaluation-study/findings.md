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
The iteration-3 manual grounding sample has not been judged.

## Publication assessment

The evidence is not ready for a high-performing recommender or efficacy claim.
It can support an honest engineering/evaluation case study centered on
instrumentation, reproducibility, grounding, and discovered failure modes.

Before an empirical performance submission:

1. Version a corrected manifest without modifying historical runs.
2. Separate expected-need extraction recall from retrieval coverage.
3. Fix genuine missing-location and route-family failures.
4. Complete a blinded or dual-review manual grounding audit.
5. Run one untouched confirmatory 50×3 study.
6. Add a baseline or ablation for any improvement/superiority claim.
