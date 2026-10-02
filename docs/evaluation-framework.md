# Evaluation framework

The harness runs versioned interaction scenarios against deterministic offline targets and the deployed development Lambda. The current gate policy, current suite inventory, measured results and acceptance limits are defined in [Testing and validation](testing.md). This guide describes operation and case format; it does not authorize paid live execution.

## Components

| Component | Responsibility |
| --- | --- |
| `src/evals/case-schema.ts` | Typed case, expectation, scorer, turn and report contracts. |
| `src/evals/loader.ts` | Catalog loading, templates, imports and variable interpolation. |
| `src/evals/runner.ts` | Selected execution, private evidence snapshots, hard checks and reports. |
| `src/evals/targets/offline.ts` | Deterministic runtime and gateway fixtures. |
| `src/evals/targets/live-lambda.ts` | Development Lambda invocation and run-isolated physical conversation identities. |
| `src/evals/live-behavior-cli.ts` | Required explicit case selection, prerequisites, pricing and final gate summary. |
| `src/evals/run-manifest.ts` | Source, evaluator, case, prompt and deployment identities. |
| `src/evals/reporting.ts`, `pricing.ts` | Reports and priced OpenAI, judge and Lambda cost accounting. |
| `evals/live-behavior-coverage.yaml` | Active and explicitly retired behavior-change coverage. |

The general harness still supports semantic research scorers, internal trajectory checks and model matrices. Their existence does not make them live behavior acceptance requirements. Mandatory live cases contain objective hard assertions and no semantic judges.

## Targets and identity

The offline target uses deterministic doubles to exercise contracts without paying for model calls. A double's reply does not establish live response quality. Do not manufacture token usage for an offline fixture.

The live target invokes the deployed development Function URL with CLI diagnostics. It captures the returned message and permitted trace/performance evidence; it does not expose developer diagnostics in the customer channel. Run/config/case identities map logical users, sessions and message IDs to fresh physical conversations. Business phones, guest/event IDs and expected facts remain part of the fixture world rather than being silently remapped.

Fixture-backed execution uses the deployed runtime while isolating test effects. A successful fixture case proves the behavior in that declared world; it does not verify the live marketplace's customer records or the external WhatsApp adapter. Real external-effect cases need their declared isolation and cleanup hooks. An aborted request does not prove Lambda stopped; uncertain mutation execution requires completion evidence before restoration or replay.

## Case format

Cases live under `evals/cases/`, with reusable templates and worlds under `evals/templates/` and `evals/fixtures/`. A case includes:

- Identity: `id`, `suite`, `version`, description and tags.
- Scope: `targetModes`, configuration overrides, turn budget and optional isolation hooks.
- Interaction: ordered `inputs`, seed plan, backend fixture, imports and variables.
- Verification: `expectations`, severity and scorers.
- Provenance: notes recording the interaction and any reviewed contract change.

An interaction-derived regression reconstructs history and relevant stored state, not an isolated phrase. Set a logical `sessionId` across its turns. Pin expectations to the intended `turnIndex`; do not accidentally grade a later answer or use future evidence.

Templates provide shared defaults. Imports load reusable structured fragments before the case body, which remains the final override. Variables interpolate declared fixture values, for example `{{event_type}}`; authorization is still enforced by the runtime.

## Expectations and verdicts

Use hard assertions for authorization, independent effects, backend facts, real failure outcomes and public API/trace/receipt contracts. Choose the existing schema family that expresses the obligation:

- `plan_field_equals` and `plan_field_subset` for domain state and outcomes.
- `fixture_effect_count` for attempted, successful and replayed fixture effects.
- `tool_usage` for effect/auth boundaries and prohibited calls; avoid mandatory read-tool implementation pins.
- `trace_field_equals`, `trace_field_subset` and `trace_field_number` for observable contract evidence.
- Delivered-text value checks for established numeric facts or contractual URLs; avoid exact conversational phrasing.
- Provider-result and trajectory checks only when they express a product obligation rather than internal routing.

Example of a read-only turn following an earlier successful RSVP:

```yaml
expectations:
  - id: recall-makes-no-new-write
    type: fixture_effect_count
    operation: rsvp.write
    turnIndex: 1
    expectedAttempts: 0
    expectedSuccesses: 0
    expectedReplays: 0
    severity: hard
```

A turn-indexed count is a delta. The original action turn must independently require its write; the recall check is not evidence that the first action succeeded. Preserve identity/polarity checks and include negative controls where a duplicate or wrong-target mutation could otherwise pass.

`hardGatePassed` requires the hard expectations to pass. A weighted score cannot cancel a hard failure, missing case or infrastructure error. `expectation_pass_rate` remains useful for diagnosis. Style, judge, token-count, prompt-budget and internal node-transition assertions are excluded from the mandatory live panel. General harness schemas may retain them for historical or separately selected research use.

## Coverage and contract maintenance

Register each behavior-changing fix separately, even when it reuses a case. `tests/live-behavior-coverage.test.ts` checks active registry references, suite membership, live target, hard objective expectations, unique change IDs and absence of semantic judges. Retired entries require an explicit reason; historical coverage is not replaced by an unrelated passing case.

Before changing an oracle, identify a concrete contradiction with the declared contract and independent evidence. Keep the original run. Record corrected versions and negative controls. The six no-new-write corrections are documented in the [current testing record](testing.md#effect-counts-and-negative-controls). A user-authorized retirement is a contract/scope change and must remain visible, not a hidden score improvement.

## Artifacts and costs

Each execution writes `.eval-runs/<run-id>/`:

- `manifest.json`: selected cases, model/configuration and source/evaluator identities, prerequisites and deployment checks before/after.
- `progress.json`: partial lifecycle and cost progress; not an acceptance verdict.
- `results.jsonl`: one normalized result per case/config/target.
- `report.json` and `report.md`: final case and assertion totals, completion, timing and costs.
- `artifacts/<config>/<case>.snapshot.json`: immutable, redacted execution evidence captured before cleanup.
- `artifacts/<config>/<case>.json`: normalized case result and assertion messages.

Private fixture-effect evidence is attached internally; a redacted snapshot does not necessarily contain every private field. Missing evidence must not be interpreted as zero effects. Diagnose through the recorded expectation evidence and permitted backend/trace investigation.

The live CLI selects the latest checked-in dated pricing file and requires priced reporting. Reports separate OpenAI, judge and Lambda costs, including explicit unpriced items. Dry-run estimates are forecasts, not billed totals. A run without verified final deployment identity is invalid even if individual executions succeeded. The progress label `ok` reports execution status, not assertion success.

## Commands

```bash
npm run eval:list
npm run eval -- --suite smoke --target offline
npm run eval -- --case selection.choose_edo_from_shortlist --target offline
npm run eval -- --suite benchmark_full --matrix evals/matrices/models.yaml --dry-run
npm run eval:report -- --input .eval-runs/<run-id>
```

For authorized live validation, deploy development first and supply every selected ID:

```bash
AWS_PROFILE=se-dev AWS_REGION=us-east-1 npm run eval:behavior-live -- \
  --case <selected-case-id> --label <evidence-label>
```

Freeze the selected list and paid-run budget before dispatch. The CLI requires case selectors; broad matrices and unfiltered live runs are not the current workflow. The one authorized 46-case baseline is historical evidence, not standing authorization to repeat it. `npm run check` runs local type checking, lint and Vitest; it does not execute the live panel.

## Handoff

Report selected versus executed cases, hard assertion results, errors/skips, costs, run IDs, exact artifact identity and unresolved limitations. Preserve interrupted and failing runs. Keep results tied to their tested artifact; never combine a historical broad run and a new subset into a fictitious full-green result. See [Testing and validation](testing.md) for the frozen 46-case inventory and the valid seven-case recovery result.
