# Baseline and Ablation Protocol

Date: 2026-07-02

## Purpose

The confirmatory study needs a comparator without rerunning or rewriting the
historical system. This protocol defines a pre-intervention baseline and
component-level ablations using immutable artifacts and rollback commits.

## Configurations

### Historical baseline

- Runtime snapshot: commit `5317d79`.
- Raw study:
  `artifacts/technical-study-2026-07-02T00-51-03-191Z/`.
- Manifest: frozen v1.
- Use only recommendation, architecture, grounding, and reliability fields
  whose definitions are unchanged. Do not use v1 strict completion as a
  comparative success measure.

### Pre-confirmatory baseline

- Runtime snapshot: commit `a37103f`.
- Raw study:
  `artifacts/technical-study-2026-07-02T06-40-49-761Z/`.
- Inputs are identical to v2; its raw typed plans and traces may be evaluated
  against v2 canonical expected needs as a retrospective pre-intervention
  baseline.
- Preserve original v1 grading. Any v2 regrading must be a separate derivative
  artifact and must never overwrite the historical summary.
- Derived typed-state baseline:
  `pre-confirmatory-baseline-v2.json`.

The retrospective V2 baseline contains 165 expected need instances:

- extraction recall: 158/165 (95.76%);
- retrieval coverage given extraction: 144/158 (91.14%);
- end-to-end expected-need coverage: 144/165 (87.27%);
- unexpected extracted needs: 50;
- missing-location requests that searched: 15/15;
- missing-location requests that clarified: 0/15;
- corporate-auditorium `Locales` extraction: 0/3.

### Confirmatory system

- Runtime snapshot starts at commit `2559335` plus later reviewed fixes.
- Manifest: `technical-evaluation-50-v3`.
- This is the only configuration eligible for the fourth 50×3 live run.

## Component ablations

The following comparisons isolate individual good-faith mechanisms:

| Component | Disabled snapshot | Enabled snapshot | Primary outcomes |
| --- | --- | --- | --- |
| Location/category filtering | `5317d79` | `f371f99` | Location mismatch, category satisfaction, shortlist size |
| Semantic event-service evidence | `f371f99` | `68badde` | Event-service applicability, unsupported decoration recommendations |
| Evidence-ranked coverage | `68badde` | `ed0458e` | Expected-need extraction, retrieval given extraction, unique providers |
| Global sufficiency gate | `ed0458e` | `2559335` | Missing-location search rate and clarification-route pass |

These are observational ablations over versioned snapshots, not randomized
online experiments. Report them as engineering ablations and do not claim
causal superiority beyond the changed component and directly measured outcome.

## Confirmatory decision gates

Before spending the fourth run:

1. Full local typecheck, lint, and tests pass.
2. V2 dry-run validates 50 scenarios × 3 repetitions.
3. Five missing-location live gates perform zero provider searches.
4. Corporate auditorium extracts `corporativo` + `Locales`.
5. Corporate audiovisual extracts `Fotografía y video`, never the general
   store under `Otros`.
6. Multi-need output contains no cross-category provider rows.
7. Pause/resume, no-results, recovery, selection, and closure targeted cases
   reach a V2-allowed terminal state.

The full run is confirmatory: no tuning may occur after inspecting its results.
If a gate fails, fix it before the run and preserve another rollback commit.

## Reporting

Report:

- expected-need extraction recall;
- retrieval coverage conditional on extraction;
- end-to-end expected-need coverage;
- unexpected extracted needs;
- constraint satisfaction and unknown-location rate;
- manual primary and independent-review judgments;
- latency, tokens, tools, cost, errors, timeouts, and repeatability.

Do not collapse extraction and retrieval into the historical final-plan
coverage rate.
