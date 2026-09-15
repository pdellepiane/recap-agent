# acceptance-evidence: Complete request, output-origin, and judge evidence controls

Status at preparation: pending. Required predecessors: dev-followup. Source of task state: ../plan.yaml (revision 3).

## Dispatch context

Repository: /Users/leonardocandio/Work/thesis/recap-agent. Work from this checkout unless the coordinator assigns an isolated checkout. You are not alone in the codebase: preserve existing edits, do not reset or revert others, and adapt to predecessor changes. This is an implementation packet, not authorization to start before dependencies are complete.

The LLM owns semantic interpretation and all ordinary conversational language. Runtime code validates typed evidence, access, effects, state and transport. No keyword routing, exact reply templates, post-generation prose replacement, or extra supervisor model. Code/docs/tests are English; conversational prompts are Spanish text files under prompts/. TypeScript strict; no explicit any. Keep event-plan-first multi-provider support, one plan store, channel-agnostic core, no streaming or compatibility shims.

Current known release: artifact e829975950e99ebf7680c17f7e6ace3e5a01a625279a238e3003c0f0c7903616; dev/prod code digest 6CmXWVDpnr92gMF/fmrOPloBpiUnmiOOMAPA8MeQNhY=. Last verified dev 2026-09-10T12:32:51Z and prod 12:42:13Z. This is historical by dispatch time: verify the current predecessor's hashes. Targeted 57a9e47d=2/3 and 729a314b=0/1 remain failed, with no full gate on those bytes. Promotion was an owner exception for that artifact only; do not promote or roll back production.

Before editing: read root AGENTS.md; inspect git status and HEAD; compare predecessor diff/manifest. Existing dirty runtime, S11 case/test and fixture work must not be lost. Acquire exclusive coordinator ownership of the packet's runtime/evaluator files and the shared dev deployment. Read-only review may overlap, but no other writer or live gate may share a changing dev artifact. If another writer exists, return a dependency wait rather than overwriting work. Do not create autonomous child agents.

Approved owner model: exactly three persistent owners — Planning (`planning`), General information/FAQ (`faq`), and Customer assistance (`customer_assistance`). Customer assistance includes purchase, RSVP, auth and support as scoped capabilities, not child agents. Initial selection is transient; established turns do not pass through an extra router. An owner may read public policy needed for its current task without transferring.

## Ownership and scope

- src/runtime/openai-agent-runtime.ts
- src/runtime/contracts.ts
- src/audit
- src/evals/targets/live-lambda.ts
- src/evals/case-schema.ts
- src/evals/runner.ts
- src/evals/reporting.ts
- src/evals/scorers/semantic-judge.ts
- tests/request-observability.test.ts
- tests/model-output-origin.test.ts
- tests/eval-runner-judge-context.test.ts
- tests/semantic-judge.test.ts

Entry symbols (resolve current lines rather than trusting historical line numbers):

- openai-agent-runtime.ts: buildRequestMetrics and extractOpenAiCallRef
- runner.ts: buildSemanticJudgeContext and expectation evaluation
- live-lambda.ts: runTurn and delivered output capture

Out of scope: Do not rewrite conversation policy, add a new runtime evaluator model, or claim complete independence for same-workspace tests.

## Work sequence

1. Freeze case/fixture/judge/model configuration and deployed baseline before editing. Inventory current telemetry and judge tests; extend them instead of creating a second harness.

2. Capture every serialized request at the real transport boundary, including extraction/classifier/reply calls, tool loops, retry attempts and failed calls. Count UTF-8 instructions, input, tools, output schema, total payload and request/response identifiers; do not replace missing observations with zero.

3. Capture candidate text and actual delivered output with a declared transformation version. Independently test two sentinel outputs and detect replacement, append, discarded generation and scoring an internal draft. Keep private raw content out of public logs.

4. Check judge packets separate candidate-visible knowledge, independent effect truth, and expectations, with no future turns. Add incorrect/correct paraphrase pairs and candidate injection attempts. A missing receipt must remain unknown rather than zero effects.

5. Add test-only mutations for omitted schema bytes, dropped second call, missing origin, missing evidence, and missing mandatory case. Emit intended assertion plus observed failure for each; never deploy mutants.

6. If evaluator semantics change, record the contradiction and obtain separate review of that change; rerun retained baseline and candidate under the same revised contract. Keep original artifacts. Do not weaken the oracle to fit a candidate.

## Acceptance

- All serialized requests including loops/retries and schemas/tools are accounted for.
- Actual wire output is independently compared with model output; judge facts have provenance and no future leakage.
- Negative controls fail as intended; evaluator revisions preserve baseline and candidate evidence.

Required negative control: A hidden second request, absent schema bytes, replaced candidate, future-turn fact, or unknown receipt represented as zero must each fail the intended check.

Read ../acceptance-contract.md sections E07, E10, E11, E12, R01, R03, R05, R06, R07, R08, R10, R11. These are enforced in tests/review, not injected as a global runtime prompt. Do not rewrite frozen expectations to match a candidate.

## Commands and evidence

Validation protocol:

1. Run the focused tests listed below, npm run typecheck, npm run lint, and tests/live-behavior-coverage.test.ts. Tests must prove behavior/evidence, not reproduce a canned answer. Register each behavior change separately in evals/live-behavior-coverage.yaml; preserve complete interactions, hard structural assertions and hard text_semantic with requireJudge: true.
2. For runtime/prompt/dependency/Lambda-fixture changes, verify AWS with aws sts get-caller-identity --profile se-dev --region us-east-1. Account must be 684516060775. Use only se-dev/us-east-1; refresh login only through aws login --profile se-signin if needed. Mutating deployment scripts already fail closed on identity.
3. With exclusive dev ownership, run AWS_PROFILE=se-dev AWS_REGION=us-east-1 DEPLOYMENT_ENV=development npm run deploy. Pin artifact SHA-256, source/contract hashes and Lambda CodeSha256. Verify Active/Successful.
4. Run AWS_PROFILE=se-dev AWS_REGION=us-east-1 DEV_STACK_NAME=recap-agent-runtime-dev npm run eval:behavior-live with NO --case filter for acceptance. Diagnostics may use the listed cases but cannot substitute for the full run. Capture start/end deployment digest; a changed digest invalidates the run as exact-candidate acceptance.
5. Require all mandatory cases executed, zero failed/error/skipped hard gates, required semantic judges and independent effects. Preserve the original 83 and added close case as separate subsets; include any later additive cases without dropping old ones. Keep all failed runs. Missing key, receipt or telemetry is missing evidence, never a pass. Test-only/doc-only changes do not need deployment unless Lambda-packaged files changed.
6. Run the relevant full offline suite before final handoff. Append docs/implementation-log.md and evaluation-manifest.md with commands, run paths, exact hashes, measurements and limits. Do not claim full-plan acceptance from a family pass.

Focused command:

`npx vitest run tests/request-observability.test.ts tests/openai-agent-runtime-token-usage.test.ts tests/model-output-origin.test.ts tests/eval-live-target.test.ts tests/eval-runner-judge-context.test.ts tests/semantic-judge.test.ts tests/f4-judge-close-evidence.test.ts tests/live-behavior-coverage.test.ts`

Diagnostic live case IDs (full suite still required):

- live_behavior.close_date_provenance_and_completed_retry
- live_behavior.purchase_confirmation_carina_request_survives_normalization
- live_behavior.concurrent_support_turns_preserve_context

## Handoff to coordinator/reviewer

Return task ID, status (completed / needs changes / waiting on dependency), base and candidate hashes, files changed, old caller removed and replacement production caller, model-origin and negative-control evidence, request-byte measurements, focused/full test results, deployment digest before/after, every run ID, exact failures and remaining limitations. Name the next dependency ready to start. Update plan.yaml only with evidence-backed status; release the write/deployment lock. Reviewer must inspect actual diff and harness artifacts, not accept this summary as proof. If no independent reviewer is available, say so; same-workspace checks are not tamper-proof or independent holdouts.
