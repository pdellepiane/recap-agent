# l2-clarification-media-auth: L2 clarification, image, and auth refusal migration

## Superseding decision — base64 image continuity (2026-09-11)

Read [persistent-image-context.md](../persistent-image-context.md) first. Backend URLs are optional. Base64 images will be uploaded to OpenAI Files, retained as plan references for 30 days, and used by the established owner across turns. Earlier directions to preserve base64 description behavior are superseded. Implementation remains pending.

## Binding URL migration scope

Read [../url-image-context.md](../url-image-context.md). Implement the new URL variant and integrated attachment behavior as specified there; preserve existing base64 behavior and nonpersistent bytes. This supersedes conflicting blanket image-policy migration directions below. Coordinate plan schema, handler and customer-context edits with the sole runtime writer. Current owner label is Customer operations.

Status at preparation: pending. Required predecessors: l2-rsvp. Source of task state: ../plan.yaml (revision 3).

## Dispatch context

Repository: /Users/leonardocandio/Work/thesis/recap-agent. Work from this checkout unless the coordinator assigns an isolated checkout. You are not alone in the codebase: preserve existing edits, do not reset or revert others, and adapt to predecessor changes. This is an implementation packet, not authorization to start before dependencies are complete.

The LLM owns semantic interpretation and all ordinary conversational language. Runtime code validates typed evidence, access, effects, state and transport. No keyword routing, exact reply templates, post-generation prose replacement, or extra supervisor model. Code/docs/tests are English; conversational prompts are Spanish text files under prompts/. TypeScript strict; no explicit any. Keep event-plan-first multi-provider support, one plan store, channel-agnostic core, no streaming or compatibility shims.

Current known release: artifact e829975950e99ebf7680c17f7e6ace3e5a01a625279a238e3003c0f0c7903616; dev/prod code digest 6CmXWVDpnr92gMF/fmrOPloBpiUnmiOOMAPA8MeQNhY=. Last verified dev 2026-09-10T12:32:51Z and prod 12:42:13Z. This is historical by dispatch time: verify the current predecessor's hashes. Targeted 57a9e47d=2/3 and 729a314b=0/1 remain failed, with no full gate on those bytes. Promotion was an owner exception for that artifact only; do not promote or roll back production.

Before editing: read root AGENTS.md; inspect git status and HEAD; compare predecessor diff/manifest. Existing dirty runtime, S11 case/test and fixture work must not be lost. Acquire exclusive coordinator ownership of the packet's runtime/evaluator files and the shared dev deployment. Read-only review may overlap, but no other writer or live gate may share a changing dev artifact. If another writer exists, return a dependency wait rather than overwriting work. Do not create autonomous child agents.

Approved owner model: exactly three persistent owners — Planning (`planning`), General information/FAQ (`faq`), and Customer assistance (`customer_assistance`). Customer assistance includes purchase, RSVP, auth and support as scoped capabilities, not child agents. Initial selection is transient; established turns do not pass through an extra router. An owner may read public policy needed for its current task without transferring.

## Ownership and scope

- src/runtime/agent-service.ts
- src/runtime/openai-agent-runtime.ts
- src/runtime/reply-evidence-projector.ts
- src/runtime/message-renderer.ts
- src/runtime/structured-message.ts
- prompts

Entry symbols (resolve current lines rather than trusting historical line numbers):

- agent-service.ts: enforceFaqAmbiguityReply, enforceMissingFieldReply, enforceAmbiguousProviderConfirmationReply, sanitizeAssistantOutput
- image failure and terminal authentication response branches

Out of scope: No streaming; WhatsApp behavior remains represented by the terminal adapter.

## Work sequence

1. Map remaining fixed clarification, auth refusal and media failure paths; scope prompts to the actual node/outcome rather than all possible branches.

2. Supply unresolved alternatives, required fields, image availability and terminal access result as evidence. Let the model choose useful wording; retain the typed reason for not executing.

3. Delete appended questions, semantic cleanup and punctuation surgery; declare mechanical rendering transformations and verify model conversational spans survive.

4. Pair ambiguous selection with resolved selection, unavailable image with usable caption, and denied private access with public information still answerable.

5. Audit that no migrated branch silently re-enters a canned fallback when generation fails.

## Acceptance

- No inserted questions after generation; terminal outcomes stay truthful

Required negative control: An appended question, erased caption fact, or universal refusal must fail independently of fluent wording.

Read ../acceptance-contract.md sections E04, E06, E07, R01, R02, R09. These are enforced in tests/review, not injected as a global runtime prompt. Do not rewrite frozen expectations to match a candidate.

## Commands and evidence

Validation protocol:

1. Run the focused tests listed below, npm run typecheck, npm run lint, and tests/live-behavior-coverage.test.ts. Tests must prove behavior/evidence, not reproduce a canned answer. Register each behavior change separately in evals/live-behavior-coverage.yaml; preserve complete interactions, hard structural assertions and hard text_semantic with requireJudge: true.
2. For runtime/prompt/dependency/Lambda-fixture changes, verify AWS with aws sts get-caller-identity --profile se-dev --region us-east-1. Account must be 684516060775. Use only se-dev/us-east-1; refresh login only through aws login --profile se-signin if needed. Mutating deployment scripts already fail closed on identity.
3. With exclusive dev ownership, run AWS_PROFILE=se-dev AWS_REGION=us-east-1 DEPLOYMENT_ENV=development npm run deploy. Pin artifact SHA-256, source/contract hashes and Lambda CodeSha256. Verify Active/Successful.
4. Run AWS_PROFILE=se-dev AWS_REGION=us-east-1 DEV_STACK_NAME=recap-agent-runtime-dev npm run eval:behavior-live with NO --case filter for acceptance. Diagnostics may use the listed cases but cannot substitute for the full run. Capture start/end deployment digest; a changed digest invalidates the run as exact-candidate acceptance.
5. Require all mandatory cases executed, zero failed/error/skipped hard gates, required semantic judges and independent effects. Preserve the original 83 and added close case as separate subsets; include any later additive cases without dropping old ones. Keep all failed runs. Missing key, receipt or telemetry is missing evidence, never a pass. Test-only/doc-only changes do not need deployment unless Lambda-packaged files changed.
6. Run the relevant full offline suite before final handoff. Append docs/implementation-log.md and evaluation-manifest.md with commands, run paths, exact hashes, measurements and limits. Do not claim full-plan acceptance from a family pass.

Focused command:

`npx vitest run tests/f3-ambiguous-confirmation.test.ts tests/message-renderer.test.ts tests/model-output-origin.test.ts tests/s10-model-projection.test.ts tests/live-behavior-coverage.test.ts`

Diagnostic live case IDs (full suite still required):

- live_behavior.ambiguous_confirmation_adversarial_selection
- live_behavior.image_unavailable_captioned
- live_behavior.image_readable_captionless
- live_behavior.authentication_refusal_closes_protected_query

## Handoff to coordinator/reviewer

Return task ID, status (completed / needs changes / waiting on dependency), base and candidate hashes, files changed, old caller removed and replacement production caller, model-origin and negative-control evidence, request-byte measurements, focused/full test results, deployment digest before/after, every run ID, exact failures and remaining limitations. Name the next dependency ready to start. Update plan.yaml only with evidence-backed status; release the write/deployment lock. Reviewer must inspect actual diff and harness artifacts, not accept this summary as proof. If no independent reviewer is available, say so; same-workspace checks are not tamper-proof or independent holdouts.
