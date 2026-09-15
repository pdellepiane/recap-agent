# l4-ownership: L4 persistent specialist ownership

Status at preparation: pending. Required predecessors: l2-clarification-media-auth, l3-semantic. Source of task state: ../plan.yaml (revision 3).

## Dispatch context

Repository: /Users/leonardocandio/Work/thesis/recap-agent. Work from this checkout unless the coordinator assigns an isolated checkout. You are not alone in the codebase: preserve existing edits, do not reset or revert others, and adapt to predecessor changes. This is an implementation packet, not authorization to start before dependencies are complete.

The LLM owns semantic interpretation and all ordinary conversational language. Runtime code validates typed evidence, access, effects, state and transport. No keyword routing, exact reply templates, post-generation prose replacement, or extra supervisor model. Code/docs/tests are English; conversational prompts are Spanish text files under prompts/. TypeScript strict; no explicit any. Keep event-plan-first multi-provider support, one plan store, channel-agnostic core, no streaming or compatibility shims.

Current known release: artifact e829975950e99ebf7680c17f7e6ace3e5a01a625279a238e3003c0f0c7903616; dev/prod code digest 6CmXWVDpnr92gMF/fmrOPloBpiUnmiOOMAPA8MeQNhY=. Last verified dev 2026-09-10T12:32:51Z and prod 12:42:13Z. This is historical by dispatch time: verify the current predecessor's hashes. Targeted 57a9e47d=2/3 and 729a314b=0/1 remain failed, with no full gate on those bytes. Promotion was an owner exception for that artifact only; do not promote or roll back production.

Before editing: read root AGENTS.md; inspect git status and HEAD; compare predecessor diff/manifest. Existing dirty runtime, S11 case/test and fixture work must not be lost. Acquire exclusive coordinator ownership of the packet's runtime/evaluator files and the shared dev deployment. Read-only review may overlap, but no other writer or live gate may share a changing dev artifact. If another writer exists, return a dependency wait rather than overwriting work. Do not create autonomous child agents.

Approved owner model: exactly three persistent owners — Planning (`planning`), General information/FAQ (`faq`), and Customer assistance (`customer_assistance`). Customer assistance includes purchase, RSVP, auth and support as scoped capabilities, not child agents. Initial selection is transient; established turns do not pass through an extra router. An owner may read public policy needed for its current task without transferring.

## Ownership and scope

- src/core/plan.ts
- src/runtime/agent-service.ts
- src/runtime/openai-agent-runtime.ts
- src/runtime/contracts.ts
- src/runtime/prompt-manifest.ts
- src/runtime/prompt-loader.ts
- prompts

Entry symbols (resolve current lines rather than trusting historical line numbers):

- PersistedPlan schema and resume/dispatch path
- domain extraction and reply construction at their production callers

Out of scope: No new agent per minor operation, visible routing narration, compatibility shim or second memory system.

## Work sequence

1. Add a persisted owner discriminator with exactly planning, faq and customer_assistance on the existing plan store. Initial selection is transient and does not add entry/support as extra owners. Reuse existing domain state; no second state store.

2. Expose only current-owner and current-capability context/tools. Within customer_assistance, purchase, invitation/RSVP, identity/auth and support are projected capability slices, not agents or persistent subowners. Public FAQ is its own owner only when general information is the primary task.

3. Transfer a compact typed packet of current task, grounded facts/references, pending questions and relevant receipts. Persist the new owner; no user-visible handoff announcement by default.

4. Enforce at most one transfer per turn; source stops and recipient alone replies/acts. If still unresolved, recipient asks a model-written clarification. Public policy needed for a current task is a bounded knowledge read, not a transfer. Resume a paused owner on a later turn without losing its pending task.

5. Retire the old global extractor from migrated established-owner turns. Verify one actual model request for no-tool continuations and count all calls on tool/transfer turns.

6. Test explicit domain switch, mixed need, interruption/resume, failed transfer and ownership after reload. Add mandatory full sequences if no existing scenario covers transfer; report expanded denominators without dropping the original 84.

## Acceptance

- No-tool continuation uses one model call; one transfer maximum per turn
- Full cross-owner sequences pass with exact effect counts
- Exactly three persistent owner values; no entry fourth owner, hidden subowner agents, or mandatory router call on established-owner turns.
- Customer assistance switches purchase/RSVP/support capabilities without transfer churn or disclosure of unrelated task context.
- Planning to FAQ to planning preserves selections; FAQ to person-specific assistance requires grounded identity/access before protected facts or effects.

Required negative control: Second same-turn transfer, simultaneous old/new execution or inactive-owner evidence must fail. A real supported switch must still succeed.

Read ../acceptance-contract.md sections E09, R01, R03, R04, R06, R08, R09.

## Commands and evidence

Validation protocol:

1. Run the focused tests listed below, npm run typecheck, npm run lint, and tests/live-behavior-coverage.test.ts. Tests must prove behavior/evidence, not reproduce a canned answer. Register each behavior change separately in evals/live-behavior-coverage.yaml; preserve complete interactions, hard structural assertions and hard text_semantic with requireJudge: true.
2. For runtime/prompt/dependency/Lambda-fixture changes, verify AWS with aws sts get-caller-identity --profile se-dev --region us-east-1. Account must be 684516060775. Use only se-dev/us-east-1; refresh login only through aws login --profile se-signin if needed. Mutating deployment scripts already fail closed on identity.
3. With exclusive dev ownership, run AWS_PROFILE=se-dev AWS_REGION=us-east-1 DEPLOYMENT_ENV=development npm run deploy. Pin artifact SHA-256, source/contract hashes and Lambda CodeSha256. Verify Active/Successful.
4. Run AWS_PROFILE=se-dev AWS_REGION=us-east-1 DEV_STACK_NAME=recap-agent-runtime-dev npm run eval:behavior-live with NO --case filter for acceptance. Diagnostics may use the listed cases but cannot substitute for the full run. Capture start/end deployment digest; a changed digest invalidates the run as exact-candidate acceptance.
5. Require all mandatory cases executed, zero failed/error/skipped hard gates, required semantic judges and independent effects. Preserve the original 83 and added close case as separate subsets; include any later additive cases without dropping old ones. Keep all failed runs. Missing key, receipt or telemetry is missing evidence, never a pass. Test-only/doc-only changes do not need deployment unless Lambda-packaged files changed.
6. Run the relevant full offline suite before final handoff. Append docs/implementation-log.md and evaluation-manifest.md with commands, run paths, exact hashes, measurements and limits. Do not claim full-plan acceptance from a family pass.

Focused command:

`npx vitest run tests/model-output-origin.test.ts tests/request-observability.test.ts tests/agent-service.test.ts tests/openai-agent-runtime-token-usage.test.ts tests/live-behavior-coverage.test.ts`

Diagnostic live case IDs (full suite still required):

- live_behavior.host_support_allows_explicit_rsvp_switch
- live_feedback.token_fresh_multifront_stays_multi_need
- live_behavior.concurrent_support_turns_preserve_context

## Handoff to coordinator/reviewer

Return task ID, status (completed / needs changes / waiting on dependency), base and candidate hashes, files changed, old caller removed and replacement production caller, model-origin and negative-control evidence, request-byte measurements, focused/full test results, deployment digest before/after, every run ID, exact failures and remaining limitations. Name the next dependency ready to start. Update plan.yaml only with evidence-backed status; release the write/deployment lock. Reviewer must inspect actual diff and harness artifacts, not accept this summary as proof. If no independent reviewer is available, say so; same-workspace checks are not tamper-proof or independent holdouts.

## Customer snapshot design amendment — 2026-09-10

Read ../customer-context.md before implementation. The owner-facing label is now Customer operations; the planned internal ID remains customer_assistance. Implement its bounded, parallel, authorized snapshot assembly using the existing orchestrator, then expose common references plus the question-relevant view to the model. Do not add a profile-writing model, load all customer data into the prompt, assume customer-address support, or rely on fire-and-forget Lambda work. Its acceptance scenarios and measurements are additional requirements for this task.
