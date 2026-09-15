# dev-followup: Fix false repeat-submission claim and run full 84-case dev gate

Status at preparation: pending. Required predecessors: debug-close-effects, promote-frozen-subset. Source of task state: ../plan.yaml (revision 3).

## Dispatch context

Repository: /Users/leonardocandio/Work/thesis/recap-agent. Work from this checkout unless the coordinator assigns an isolated checkout. You are not alone in the codebase: preserve existing edits, do not reset or revert others, and adapt to predecessor changes. This is an implementation packet, not authorization to start before dependencies are complete.

The LLM owns semantic interpretation and all ordinary conversational language. Runtime code validates typed evidence, access, effects, state and transport. No keyword routing, exact reply templates, post-generation prose replacement, or extra supervisor model. Code/docs/tests are English; conversational prompts are Spanish text files under prompts/. TypeScript strict; no explicit any. Keep event-plan-first multi-provider support, one plan store, channel-agnostic core, no streaming or compatibility shims.

Current known release: artifact e829975950e99ebf7680c17f7e6ace3e5a01a625279a238e3003c0f0c7903616; dev/prod code digest 6CmXWVDpnr92gMF/fmrOPloBpiUnmiOOMAPA8MeQNhY=. Last verified dev 2026-09-10T12:32:51Z and prod 12:42:13Z. This is historical by dispatch time: verify the current predecessor's hashes. Targeted 57a9e47d=2/3 and 729a314b=0/1 remain failed, with no full gate on those bytes. Promotion was an owner exception for that artifact only; do not promote or roll back production.

Before editing: read root AGENTS.md; inspect git status and HEAD; compare predecessor diff/manifest. Existing dirty runtime, S11 case/test and fixture work must not be lost. Acquire exclusive coordinator ownership of the packet's runtime/evaluator files and the shared dev deployment. Read-only review may overlap, but no other writer or live gate may share a changing dev artifact. If another writer exists, return a dependency wait rather than overwriting work. Do not create autonomous child agents.

Approved owner model: exactly three persistent owners — Planning (`planning`), General information/FAQ (`faq`), and Customer assistance (`customer_assistance`). Customer assistance includes purchase, RSVP, auth and support as scoped capabilities, not child agents. Initial selection is transient; established turns do not pass through an extra router. An owner may read public policy needed for its current task without transferring.

## Ownership and scope

- src/runtime/openai-agent-runtime.ts
- src/runtime/agent-service.ts
- prompts/nodes/necesidad_cubierta
- tests/close-proceed-confirmed.test.ts
- tests/lean-close-footer.test.ts
- evals/cases/live-close-date-provenance-completed-retry.yaml

Entry symbols (resolve current lines rather than trusting historical line numbers):

- agent-service.ts: finished-plan branch in handleTurn and renderOutbound
- openai-agent-runtime.ts: buildReplyTurnEvidence, composeReply, finish_plan tool
- prompts/nodes/necesidad_cubierta: current completion instructions

Out of scope: Do not migrate the entire close family, repair unrelated RSVP worlds, or change production.

## Work sequence

1. Open the complete six-turn artifacts from 57a9e47d and 729a314b; compare turn 4 successful submission and turn 5 acknowledgement. Retrieve the referenced stored model response if raw candidate text is absent; never infer origin from token presence.

2. Trace lifecycle and selected-provider/date evidence into the actual request. Distinguish existing completed outcome from this-turn action; attach existing receipt details only when actually persisted/retrieved. A finished flag alone must not invent a date or receipt ID.

3. Remove only the proven conflicting instruction, evidence, or replacement. Keep the current model free to compose. No phrase match, word ban, canned text, or new model supervisor.

4. Add a two-sentinel output-origin test and paired existing-completion/new-authorized-receipt evidence test. Preserve the original six-turn live scenario and all hard expectations.

5. Register this behavior fix separately, capture wire bytes, deploy dev and run the complete suite. Retain failures; do not keep retrying until one result passes.

## Acceptance

- Preserve all six turns; hard effect count stays attempts=1 successes=1 replays=0; no finish_plan on phone-only or completed-repeat turns; lifecycle remains finished.
- Hard requireJudge semantic expectation rejects any unsupported claim of a fresh submission, regardless of wording. Do not blacklist nuevamente, prescribe an exact answer, replace generated prose, or loosen the existing judge.
- Verify model-authored output survives delivery and contrast an already-confirmed receipt with a genuinely new authorized successful receipt; correct behavior follows evidence, not phrase matching.
- Register the behavior change separately; add offline evidence/output-origin coverage and measure serialized instruction/input/tool bytes with irrelevant content absent.
- After se-dev/us-east-1 account 684516060775 validation and dev deployment, execute all 84 mandatory cases in one fresh run; require zero errors/skips/duplicates and all hard structural plus required semantic expectations passing for strict acceptance.
- Report original 83 subset and additive case separately; preserve earlier reports and pin start/end Lambda digests. Any remaining failure stays explicit; no further production change without applicable authorization.

Required negative control: Unsupported new-send claim must fail even when phrased without nuevamente; duplicated effect must fail even with perfect prose.

Read ../acceptance-contract.md sections E04, E05, R01, R02, R05, R06, R07, R09, R11. These are enforced in tests/review, not injected as a global runtime prompt. Do not rewrite frozen expectations to match a candidate.

## Commands and evidence

Validation protocol:

1. Run the focused tests listed below, npm run typecheck, npm run lint, and tests/live-behavior-coverage.test.ts. Tests must prove behavior/evidence, not reproduce a canned answer. Register each behavior change separately in evals/live-behavior-coverage.yaml; preserve complete interactions, hard structural assertions and hard text_semantic with requireJudge: true.
2. For runtime/prompt/dependency/Lambda-fixture changes, verify AWS with aws sts get-caller-identity --profile se-dev --region us-east-1. Account must be 684516060775. Use only se-dev/us-east-1; refresh login only through aws login --profile se-signin if needed. Mutating deployment scripts already fail closed on identity.
3. With exclusive dev ownership, run AWS_PROFILE=se-dev AWS_REGION=us-east-1 DEPLOYMENT_ENV=development npm run deploy. Pin artifact SHA-256, source/contract hashes and Lambda CodeSha256. Verify Active/Successful.
4. Run AWS_PROFILE=se-dev AWS_REGION=us-east-1 DEV_STACK_NAME=recap-agent-runtime-dev npm run eval:behavior-live with NO --case filter for acceptance. Diagnostics may use the listed cases but cannot substitute for the full run. Capture start/end deployment digest; a changed digest invalidates the run as exact-candidate acceptance.
5. Require all mandatory cases executed, zero failed/error/skipped hard gates, required semantic judges and independent effects. Preserve the original 83 and added close case as separate subsets; include any later additive cases without dropping old ones. Keep all failed runs. Missing key, receipt or telemetry is missing evidence, never a pass. Test-only/doc-only changes do not need deployment unless Lambda-packaged files changed.
6. Run the relevant full offline suite before final handoff. Append docs/implementation-log.md and evaluation-manifest.md with commands, run paths, exact hashes, measurements and limits. Do not claim full-plan acceptance from a family pass.

Focused command:

`npx vitest run tests/close-proceed-confirmed.test.ts tests/lean-close-footer.test.ts tests/f4-explicit-event-date.test.ts tests/model-output-origin.test.ts tests/live-behavior-coverage.test.ts`

Diagnostic live case IDs (full suite still required):

- live_behavior.close_date_provenance_and_completed_retry
- live_feedback.token_seeded_close_flow
- live_feedback.token_seeded_selection_defer_close

## Handoff to coordinator/reviewer

Return task ID, status (completed / needs changes / waiting on dependency), base and candidate hashes, files changed, old caller removed and replacement production caller, model-origin and negative-control evidence, request-byte measurements, focused/full test results, deployment digest before/after, every run ID, exact failures and remaining limitations. Name the next dependency ready to start. Update plan.yaml only with evidence-backed status; release the write/deployment lock. Reviewer must inspect actual diff and harness artifacts, not accept this summary as proof. If no independent reviewer is available, say so; same-workspace checks are not tamper-proof or independent holdouts.
