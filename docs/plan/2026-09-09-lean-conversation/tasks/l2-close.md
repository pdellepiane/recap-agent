# l2-close: L2 contact and quotation closure migration

Status at preparation: pending. Required predecessors: l2-purchase, dev-followup. Source of task state: ../plan.yaml (revision 3).

## Dispatch context

Repository: /Users/leonardocandio/Work/thesis/recap-agent. Work from this checkout unless the coordinator assigns an isolated checkout. You are not alone in the codebase: preserve existing edits, do not reset or revert others, and adapt to predecessor changes. This is an implementation packet, not authorization to start before dependencies are complete.

The LLM owns semantic interpretation and all ordinary conversational language. Runtime code validates typed evidence, access, effects, state and transport. No keyword routing, exact reply templates, post-generation prose replacement, or extra supervisor model. Code/docs/tests are English; conversational prompts are Spanish text files under prompts/. TypeScript strict; no explicit any. Keep event-plan-first multi-provider support, one plan store, channel-agnostic core, no streaming or compatibility shims.

Current known release: artifact e829975950e99ebf7680c17f7e6ace3e5a01a625279a238e3003c0f0c7903616; dev/prod code digest 6CmXWVDpnr92gMF/fmrOPloBpiUnmiOOMAPA8MeQNhY=. Last verified dev 2026-09-10T12:32:51Z and prod 12:42:13Z. This is historical by dispatch time: verify the current predecessor's hashes. Targeted 57a9e47d=2/3 and 729a314b=0/1 remain failed, with no full gate on those bytes. Promotion was an owner exception for that artifact only; do not promote or roll back production.

Before editing: read root AGENTS.md; inspect git status and HEAD; compare predecessor diff/manifest. Existing dirty runtime, S11 case/test and fixture work must not be lost. Acquire exclusive coordinator ownership of the packet's runtime/evaluator files and the shared dev deployment. Read-only review may overlap, but no other writer or live gate may share a changing dev artifact. If another writer exists, return a dependency wait rather than overwriting work. Do not create autonomous child agents.

Approved owner model: exactly three persistent owners — Planning (`planning`), General information/FAQ (`faq`), and Customer assistance (`customer_assistance`). Customer assistance includes purchase, RSVP, auth and support as scoped capabilities, not child agents. Initial selection is transient; established turns do not pass through an extra router. An owner may read public policy needed for its current task without transferring.

## Ownership and scope

- src/runtime/agent-service.ts
- src/runtime/close-submission-summary.ts
- src/runtime/openai-agent-runtime.ts
- src/runtime/message-renderer.ts
- src/runtime/structured-message.ts
- prompts/nodes/crear_lead_cerrar
- prompts/nodes/necesidad_cubierta

Entry symbols (resolve current lines rather than trusting historical line numbers):

- agent-service.ts: enforceContactRequestFields, completeContactConfirmation, renderOutbound
- close-submission-summary.ts: buildCloseSubmissionSummary, applyCloseSubmissionToText

Out of scope: Do not replace validation with prose or introduce a new universal effect ledger without a separate concrete design.

## Work sequence

1. Re-audit contact/close branches after dev-followup; retain its provenance/persistence guarantees and later footer fix. Do not redo already-removed paths.

2. Separate calendar validation/outcome parsing from sentence generation; project required contact fields, unresolved choices and actual per-provider receipts before the model call.

3. Remove confirmation questions, sent summaries and future-tense footers authored after generation. Structured layout may place model fields and disclosed data only.

4. Cover missing contact/date, ambiguous dates, authorization, confirmed/failed/unknown/partial outcomes and completed continuation. Never equate tool invocation with success.

5. Keep exact effect counts and no early/repeat tool calls; document crash/partial-effect limitations rather than claiming universal idempotency.

## Acceptance

- Five-turn close live case shows no early send, one authorized send, dated response
- f4 close suites pass with receipt-data assertions

Required negative control: Prompt-example date, unverified success, appended confirmation or duplicate quote must fail independently.

Read ../acceptance-contract.md sections E04, E05, E07, R01, R02, R06, R08. These are enforced in tests/review, not injected as a global runtime prompt. Do not rewrite frozen expectations to match a candidate.

## Commands and evidence

Validation protocol:

1. Run the focused tests listed below, npm run typecheck, npm run lint, and tests/live-behavior-coverage.test.ts. Tests must prove behavior/evidence, not reproduce a canned answer. Register each behavior change separately in evals/live-behavior-coverage.yaml; preserve complete interactions, hard structural assertions and hard text_semantic with requireJudge: true.
2. For runtime/prompt/dependency/Lambda-fixture changes, verify AWS with aws sts get-caller-identity --profile se-dev --region us-east-1. Account must be 684516060775. Use only se-dev/us-east-1; refresh login only through aws login --profile se-signin if needed. Mutating deployment scripts already fail closed on identity.
3. With exclusive dev ownership, run AWS_PROFILE=se-dev AWS_REGION=us-east-1 DEPLOYMENT_ENV=development npm run deploy. Pin artifact SHA-256, source/contract hashes and Lambda CodeSha256. Verify Active/Successful.
4. Run AWS_PROFILE=se-dev AWS_REGION=us-east-1 DEV_STACK_NAME=recap-agent-runtime-dev npm run eval:behavior-live with NO --case filter for acceptance. Diagnostics may use the listed cases but cannot substitute for the full run. Capture start/end deployment digest; a changed digest invalidates the run as exact-candidate acceptance.
5. Require all mandatory cases executed, zero failed/error/skipped hard gates, required semantic judges and independent effects. Preserve the original 83 and added close case as separate subsets; include any later additive cases without dropping old ones. Keep all failed runs. Missing key, receipt or telemetry is missing evidence, never a pass. Test-only/doc-only changes do not need deployment unless Lambda-packaged files changed.
6. Run the relevant full offline suite before final handoff. Append docs/implementation-log.md and evaluation-manifest.md with commands, run paths, exact hashes, measurements and limits. Do not claim full-plan acceptance from a family pass.

Focused command:

`npx vitest run tests/close-proceed-confirmed.test.ts tests/f4-explicit-event-date.test.ts tests/f4-close-submission-summary.test.ts tests/lean-close-footer.test.ts tests/f4-judge-close-evidence.test.ts tests/message-renderer.test.ts tests/live-behavior-coverage.test.ts`

Diagnostic live case IDs (full suite still required):

- live_feedback.token_seeded_close_flow
- live_feedback.token_seeded_contact_correction
- live_feedback.token_seeded_selection_defer_close
- live_behavior.close_date_provenance_and_completed_retry

## Handoff to coordinator/reviewer

Return task ID, status (completed / needs changes / waiting on dependency), base and candidate hashes, files changed, old caller removed and replacement production caller, model-origin and negative-control evidence, request-byte measurements, focused/full test results, deployment digest before/after, every run ID, exact failures and remaining limitations. Name the next dependency ready to start. Update plan.yaml only with evidence-backed status; release the write/deployment lock. Reviewer must inspect actual diff and harness artifacts, not accept this summary as proof. If no independent reviewer is available, say so; same-workspace checks are not tamper-proof or independent holdouts.
