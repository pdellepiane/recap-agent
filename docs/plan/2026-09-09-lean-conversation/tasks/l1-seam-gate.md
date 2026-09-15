# l1-seam-gate: L1 composition seam deploy and gate

Status at preparation: in_progress. Required predecessors: acceptance-evidence. Source of task state: ../plan.yaml (revision 3).

## Dispatch context

Repository: /Users/leonardocandio/Work/thesis/recap-agent. Work from this checkout unless the coordinator assigns an isolated checkout. You are not alone in the codebase: preserve existing edits, do not reset or revert others, and adapt to predecessor changes. This is an implementation packet, not authorization to start before dependencies are complete.

The LLM owns semantic interpretation and all ordinary conversational language. Runtime code validates typed evidence, access, effects, state and transport. No keyword routing, exact reply templates, post-generation prose replacement, or extra supervisor model. Code/docs/tests are English; conversational prompts are Spanish text files under prompts/. TypeScript strict; no explicit any. Keep event-plan-first multi-provider support, one plan store, channel-agnostic core, no streaming or compatibility shims.

Current known release: artifact e829975950e99ebf7680c17f7e6ace3e5a01a625279a238e3003c0f0c7903616; dev/prod code digest 6CmXWVDpnr92gMF/fmrOPloBpiUnmiOOMAPA8MeQNhY=. Last verified dev 2026-09-10T12:32:51Z and prod 12:42:13Z. This is historical by dispatch time: verify the current predecessor's hashes. Targeted 57a9e47d=2/3 and 729a314b=0/1 remain failed, with no full gate on those bytes. Promotion was an owner exception for that artifact only; do not promote or roll back production.

Before editing: read root AGENTS.md; inspect git status and HEAD; compare predecessor diff/manifest. Existing dirty runtime, S11 case/test and fixture work must not be lost. Acquire exclusive coordinator ownership of the packet's runtime/evaluator files and the shared dev deployment. Read-only review may overlap, but no other writer or live gate may share a changing dev artifact. If another writer exists, return a dependency wait rather than overwriting work. Do not create autonomous child agents.

Approved owner model: exactly three persistent owners — Planning (`planning`), General information/FAQ (`faq`), and Customer assistance (`customer_assistance`). Customer assistance includes purchase, RSVP, auth and support as scoped capabilities, not child agents. Initial selection is transient; established turns do not pass through an extra router. An owner may read public policy needed for its current task without transferring.

## Ownership and scope

- src/runtime/model-composition.ts
- tests/model-output-origin.test.ts
- docs/plan/2026-09-09-lean-conversation/evaluation-manifest.md
- docs/plan/2026-09-09-lean-conversation/outbound-inventory.md

Entry symbols (resolve current lines rather than trusting historical line numbers):

- model-composition.ts: ReplyDisposition and failure behavior
- agent-service.ts: actual migrated support composition caller

Out of scope: This is verification of shipped work, not a fresh L1 implementation or whole-plan signoff.

## Work sequence

1. Verify predecessor artifacts and current deployed hash; do not redeploy historical L1 bytes over later fixes.

2. Map actual migrated paths to production callers and independently captured output-origin tests. A seam existing in a file is insufficient.

3. Confirm failed generation cannot silently switch to a fixed answer, and legitimate suppression remains an explicit transport outcome.

4. Consume one complete passing mandatory run on the exact current candidate, or run one if missing/stale. Do not combine targeted passes from different candidates.

5. Mark this gate complete only for the documented seam and evidence controls; retain all unmigrated family tasks as open.

## Acceptance

- Sentinel model text survives the outbound pipeline on migrated paths
- Failure cannot quietly invoke canned prose
- Full live gate green on the deployed L1 bytes with artifacts recorded

Required negative control: A model call followed by a fixed fallback must fail origin checks despite non-null tokens.

Read ../acceptance-contract.md sections E01, E11, R01, R02, R11. These are enforced in tests/review, not injected as a global runtime prompt. Do not rewrite frozen expectations to match a candidate.

## Commands and evidence

Validation protocol:

1. Run the focused tests listed below, npm run typecheck, npm run lint, and tests/live-behavior-coverage.test.ts. Tests must prove behavior/evidence, not reproduce a canned answer. Register each behavior change separately in evals/live-behavior-coverage.yaml; preserve complete interactions, hard structural assertions and hard text_semantic with requireJudge: true.
2. For runtime/prompt/dependency/Lambda-fixture changes, verify AWS with aws sts get-caller-identity --profile se-dev --region us-east-1. Account must be 684516060775. Use only se-dev/us-east-1; refresh login only through aws login --profile se-signin if needed. Mutating deployment scripts already fail closed on identity.
3. With exclusive dev ownership, run AWS_PROFILE=se-dev AWS_REGION=us-east-1 DEPLOYMENT_ENV=development npm run deploy. Pin artifact SHA-256, source/contract hashes and Lambda CodeSha256. Verify Active/Successful.
4. Run AWS_PROFILE=se-dev AWS_REGION=us-east-1 DEV_STACK_NAME=recap-agent-runtime-dev npm run eval:behavior-live with NO --case filter for acceptance. Diagnostics may use the listed cases but cannot substitute for the full run. Capture start/end deployment digest; a changed digest invalidates the run as exact-candidate acceptance.
5. Require all mandatory cases executed, zero failed/error/skipped hard gates, required semantic judges and independent effects. Preserve the original 83 and added close case as separate subsets; include any later additive cases without dropping old ones. Keep all failed runs. Missing key, receipt or telemetry is missing evidence, never a pass. Test-only/doc-only changes do not need deployment unless Lambda-packaged files changed.
6. Run the relevant full offline suite before final handoff. Append docs/implementation-log.md and evaluation-manifest.md with commands, run paths, exact hashes, measurements and limits. Do not claim full-plan acceptance from a family pass.

Focused command:

`npx vitest run tests/model-output-origin.test.ts tests/s10-model-projection.test.ts tests/agent-service-information-flow.test.ts tests/live-behavior-coverage.test.ts`

Diagnostic live case IDs (full suite still required):

- live_behavior.mailbox_issue_deferral_and_clarification_preserve_support
- live_behavior.concurrent_support_turns_preserve_context

## Handoff to coordinator/reviewer

Return task ID, status (completed / needs changes / waiting on dependency), base and candidate hashes, files changed, old caller removed and replacement production caller, model-origin and negative-control evidence, request-byte measurements, focused/full test results, deployment digest before/after, every run ID, exact failures and remaining limitations. Name the next dependency ready to start. Update plan.yaml only with evidence-backed status; release the write/deployment lock. Reviewer must inspect actual diff and harness artifacts, not accept this summary as proof. If no independent reviewer is available, say so; same-workspace checks are not tamper-proof or independent holdouts.
