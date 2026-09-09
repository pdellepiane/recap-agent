# R05 frozen evaluation contract (L0, pre-candidate)

Frozen 2026-09-09 before any L1–L5 candidate change. Any later alteration to cases, thresholds, rubrics, selected turns, redaction, judge model/config, or denominators requires a separate reviewed change with both baseline and candidate rerun on the revised contract (contract §R05). Old and revised results are both preserved.

## Code and deployment baseline

- Git HEAD: `a8e443ab` (L0 invariant commit; runtime identical to `40d3bd79`).
- Working tree vs HEAD: one pre-existing uncommitted prompt edit, `prompts/extractors/information.txt` (`af8a0963…`, drops the contact-data `supportAct` sentence); preserved, not authored by this plan. Untracked planning/analysis docs only. Stash `pre-D-save` untouched (not mine).
- Evaluator-contract digest (prompts + cases + coverage + case-schema + semantic-judge + runner): `8b9363aaf9c9d7f945fd5661afcbd183faf1cd80ddb848a9c3e0817f39c2bb37`.
- Dev deployment: `recap-agent-runtime-dev`, CodeSha256 `2q9MtDjNsnBBVdVMqDIP3fYXZBwG4srZfNrxM3ll7FY=` (2026-09-09T22:53:34Z), account `684516060775`, `us-east-1`, profile `se-dev`.
- Candidate model defaults: judge/candidate text model `DEFAULT_GPT_TEXT_MODEL = 'gpt-5.6-luna'` (`src/runtime/openai-model-defaults.ts:3`).

## Case universe and gate rule

- Universe: all `evals/cases/*.yaml` (129 files) run via `npm run eval:behavior-live` (suite `live_behavior_regression`, target `live_lambda`); no `--case` filtering for the full gate. A selected replay is diagnostic only.
- Gate: `live-behavior-cli.ts` exits 1 unless `passedCases === totalCases` with zero failed/errored/skipped. Missing judge key, skip, evaluator error, or failed hard expectation blocks the package (plan §Validation).
- Semantic thresholds (frozen per-case `minScore`): default `0.9`; image cases `0.8`; token-close cases `0.85`; `spanish-only` `0.95`; `faq-kb-sources-official-and-atc` `0.75`. Full per-case values live in the YAML files under the digest above.
- Judge: `src/evals/scorers/semantic-judge.ts` (`runSemanticJudge`, `evaluateSemanticJudgeOutcome`); skip ⇒ pass only when `requireJudge` is false. Judge packets today do NOT separate candidate-visible evidence from fixture truth (E12 gap — recorded, not silently fixed).

## Baseline run

- In-flight full gate `eval-2026-09-09T22-54-06-714Z-1674f810` (started pre-freeze on the same runtime bytes; AGENTS.md-only delta since deploy) is adopted as the numeric baseline once complete. Its result will be appended here with pass/fail counts; it is not re-scored or filtered afterward (R11: retain every run).
- BASELINE RESULT (completed 2026-09-09): **79/83 passed, 4 failed, 0 errored, 0 skipped.** Failures: `live_behavior.purchase_delia_status_by_phone` (0.952), `live_behavior.s01_frozen_kiara_pending_replay` (0.952), `live_behavior.spanish_only_mixed_language_request` (0.48), `live_behavior.wrong_account_handoff_once` (0.2). All 83 artifacts retained in the run dir; no re-scoring.
- Prior reference points (diagnostic, not baseline): `eval-2026-09-09T18-23-59-665Z-b67635c8` = 75/83; `eval-2026-09-09T13-05-03-835Z-f8bf0fc1` = 67/76.

## Baseline request accounting (R03, honest partial)

- STATIC (existing prompt audit, not runtime proof): base extractor bundle ≤ 10,300 bytes; auth-control guidance absent without protected state and ≤ 800 bytes when present (`tests/prompt-audit.test.ts`).
- RUNTIME (per-turn traces in run artifacts): `timing_ms` (extract/compose/reply latency), `tools_called` counts, `token_usage` where the provider returns it (often null at top level — gap). Serialized instruction/input/schema/tool bytes, retry/tool-loop requests, and per-request IDs are NOT captured today (E10 gap). No byte-reduction claim may be made until E10 capture exists and both sides report identical denominators over matched scenarios.
- Telemetry known gaps (must close before any size comparison): hidden second model calls are not detectable from `tokenUsage.reply`/`openAiCall` (last-response-ID only); judge packets omit candidate-visible purchase facts (E12).

## Revision log

| Date | Change | Rerun baseline | Rerun candidate |
| --- | --- | --- | --- |
| 2026-09-09 | Initial freeze (this file) | — | — |
