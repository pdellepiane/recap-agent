# R05 frozen evaluation contract (L0, pre-candidate)

Frozen 2026-09-09 before any L1–L5 candidate change. Any later alteration to cases, thresholds, rubrics, selected turns, redaction, judge model/config, or denominators requires a separate reviewed change with both baseline and candidate rerun on the revised contract (contract §R05). Old and revised results are both preserved.

## Code and deployment baseline

- Git HEAD: `29ed763e` (L1 coverage entry; 5 commits past `40d3bd79`: `a8e443ab`, `436600e3`, `04500c10`, `1305f973`, `29ed763e`; recorded in the W0-01 implementation-log entry). Runtime is no longer identical to `40d3bd79`: L1 changed runtime, prompts, and `case-schema.ts` (see L1 deploy placeholder below).
- Working tree vs HEAD (triaged 2026-09-09, W0-01): `M prompts/extractors/information.txt` preserved uncommitted (pre-existing edit, not authored by this plan; reverting would destroy another worker's in-progress work). `probe-s12.tmp.ts` retained as untracked scratch (S12 debug probe, not mine to delete; excluded from the contract). Stabilization scratch (`docs/plan/2026-09-05-stabilization/debug-*.md`, `debugging-*`, `status-*.md`, `testing-handoff-*.md`, `plan.yaml`) plus `docs/reporte-tests-comportamiento.md`, `analysis/agent-complexity-handoffs/`, and `docs/plan/2026-09-09-nine-failures-fix/plan.yaml` left untracked (owned by superseded work, out of scope for this plan). Stash `pre-D-save` untouched (not mine). `plan.md:3` inspection note (`40d3bd79`) kept byte-identical as historical fact; the re-pin lives here and in the log, not by rewriting plan history.
- Evaluator-contract digest: prior `8b9363aaf9c9d7f945fd5661afcbd183faf1cd80ddb848a9c3e0817f39c2bb37` has no documented computation method, so it is unverifiable and is NOT carried forward as proof (fail closed per R11). Recomputed with a documented method: `sha256` over sorted `"<git-hash-object>  <path>"` lines for the tracked set `prompts/**`, `evals/cases/**`, `evals/live-behavior-coverage.yaml`, `src/evals/case-schema.ts`, `src/evals/scorers/semantic-judge.ts`, `src/evals/runner.ts` (246 files). HEAD-content digest: `4227c0bdf5a77bd52606d48962798187a945e038802f949be34ada53f2243884`. Worktree digest: `894eced27aa09a79279ae5e86f5953ca6c91c9c4026c8af0280793ef851287d1` (differs only by the preserved `information.txt` edit). Recompute: `git ls-files <set> | <sort-by-path> | git hash-object per path | sha256 of lines`. L1 commits touched `case-schema.ts`, `live-behavior-coverage.yaml`, and `prompts/prompts/support_continuity.txt`, so any pre-L1 digest is stale regardless.
- Dev deployment: `recap-agent-runtime-dev`, CodeSha256 `2q9MtDjNsnBBVdVMqDIP3fYXZBwG4srZfNrxM3ll7FY=` (2026-09-09T22:53:34Z), account `684516060775`, `us-east-1`, profile `se-dev`.
- L1 GATE DEPLOY PLACEHOLDER (pending): L1 commits `1305f973`/`29ed763e` (2026-09-09 18:24 -0500 = 23:24Z) postdate the deploy above (22:53:34Z), so the Lambda still runs pre-L1 bytes. Do NOT run `npm run eval:behavior-live` as the L1 gate until development is redeployed (CloudFormation, `se-dev`, `us-east-1`, STS `684516060775`); record the new CodeSha256, deploy time, and run ID here when done.
- Candidate model defaults: judge/candidate text model `DEFAULT_GPT_TEXT_MODEL = 'gpt-5.6-luna'` (`src/runtime/openai-model-defaults.ts:3`).

## Case universe and gate rule

- Universe: all `evals/cases/*.yaml` (129 files) run via `npm run eval:behavior-live` (suite `live_behavior_regression`, target `live_lambda`); no `--case` filtering for the full gate. A selected replay is diagnostic only.
- Gate: `live-behavior-cli.ts` exits 1 unless `passedCases === totalCases` with zero failed/errored/skipped. Missing judge key, skip, evaluator error, or failed hard expectation blocks the package (plan §Validation).
- Semantic thresholds (frozen per-case `minScore`): default `0.9`; image cases `0.8`; token-close cases `0.85`; `spanish-only` `0.95`; `faq-kb-sources-official-and-atc` `0.75`. Full per-case values live in the YAML files under the digest above.
- Judge: `src/evals/scorers/semantic-judge.ts` (`runSemanticJudge`, `evaluateSemanticJudgeOutcome`); skip ⇒ pass only when `requireJudge` is false. Judge packets today do NOT separate candidate-visible evidence from fixture truth (E12 gap — recorded, not silently fixed).

## Baseline run

- In-flight full gate `eval-2026-09-09T22-54-06-714Z-1674f810` (started pre-freeze on the same runtime bytes; AGENTS.md-only delta since deploy) is adopted as the numeric baseline once complete. Its result will be appended here with pass/fail counts; it is not re-scored or filtered afterward (R11: retain every run).
- BASELINE RESULT (completed 2026-09-09): **79/83 passed, 4 failed, 0 errored, 0 skipped.** Failures: `live_behavior.purchase_delia_status_by_phone` (0.952), `live_behavior.s01_frozen_kiara_pending_replay` (0.952), `live_behavior.spanish_only_mixed_language_request` (0.48), `live_behavior.wrong_account_handoff_once` (0.2). All 83 artifacts retained in the run dir; no re-scoring.
- Failure classification (structural vs semantic, from run artifacts; scores kept as-is, not rescored):
  - `purchase_delia_status_by_phone` 0.952: semantic-only. Hard structural expectations pass (`node_transition` contacto_inicial->resolver_consultas_informativas, `tool_usage` order-summary-only); only hard `text_semantic` fails (0.82: reply confirms approval correctly but adds an amount whose disclosure authorization is not established).
  - `s01_frozen_kiara_pending_replay` 0.952: semantic-only. Same pattern (structural pass; `text_semantic` 0.82: pending status correct, adds amount/method/72h detail not grounded by context).
  - `spanish_only_mixed_language_request` 0.48: mixed semantic + telemetry. `text_semantic` 0.05 (generic question, request not advanced) plus hard `token_usage_present` fail ("missing reply tokens") — an E10 telemetry gap, and missing tokens are not product proof.
  - `wrong_account_handoff_once` 0.2: structural/behavioral. Route missed (`entrevista` observed vs `solicitar_agente_humano` expected); hard `tool_usage` (no `request_human_takeover`), `node_transition`, and `fixture_effect_count` (0 attempts) all fail; the semantic fail is downstream of the route miss.
- Judge-packet gap note (E12, recorded not fixed): packets carry `requestHash`/`rubricDigest`/`evidenceDigest` but do not separate candidate-visible evidence from fixture truth, so the disclosure-minimality verdicts above (delia, s01) cannot distinguish invented facts from candidate-visible-but-unprojected facts. Per R05/R11 these stay failures with no rescore; E12 packet repair plus rerun of both baseline and candidate belongs to a later wave.
- Prior reference points (diagnostic, not baseline): `eval-2026-09-09T18-23-59-665Z-b67635c8` = 75/83; `eval-2026-09-09T13-05-03-835Z-f8bf0fc1` = 67/76.

## Baseline request accounting (R03, honest partial)

- STATIC (existing prompt audit, not runtime proof): base extractor bundle ≤ 10,300 bytes; auth-control guidance absent without protected state and ≤ 800 bytes when present (`tests/prompt-audit.test.ts`).
- RUNTIME (per-turn traces in run artifacts): `timing_ms` (extract/compose/reply latency), `tools_called` counts, `token_usage` where the provider returns it (often null at top level — gap). Serialized instruction/input/schema/tool bytes, retry/tool-loop requests, and per-request IDs are NOT captured today (E10 gap). No byte-reduction claim may be made until E10 capture exists and both sides report identical denominators over matched scenarios.
- Telemetry known gaps (must close before any size comparison): hidden second model calls are not detectable from `tokenUsage.reply`/`openAiCall` (last-response-ID only); judge packets omit candidate-visible purchase facts (E12).

## Revision log

| Date | Change | Rerun baseline | Rerun candidate |
| --- | --- | --- | --- |
| 2026-09-09 | Initial freeze (this file) | — | — |
| 2026-09-09 | W0-01 re-pin: HEAD `a8e443ab`→`29ed763e`, digest recomputed with documented method (prior `8b9363aa…` unverifiable, not carried forward), L1 deploy placeholder added, 4 baseline failures classified, dirty tree triaged, `plan.yaml` created | — (same 79/83, no rescore) | — (Lambda still pre-L1 bytes) |
