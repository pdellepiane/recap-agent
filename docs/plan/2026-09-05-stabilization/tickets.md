# Delegable implementation packages — revision 2

Canonical specification: [plan.md](plan.md). Current contract validation and optional upstream proposals: [contract-validation.md](contract-validation.md). Historical evidence: [evidence.md](evidence.md).

All product/architecture decisions are fixed in plan.md. Roles identify implementation ownership. No calendar or effort estimates apply. S03 is approval-only and excluded from every local dependency; all other packages implement within this repository. Only the integrator edits shared wiring while domain work proceeds.

## S01 — Establish a continuously growing regression test suite

Owner: Evaluation engineer. Stage: 0. Track: local.
Dependencies: none.

**Objective:** Freeze all incident regression worlds and classify the 59-case baseline before tuning. Separate behavior replay from mutable backend contract probes.

**Owned scope:** evals/cases, evals/fixtures, src/evals/runner.ts, report artifacts.

**Acceptance:**

- Preserve all mandatory cases and hard gates; freeze Kiara/Martha and every static factual expectation currently backed by mutable data.
- Record artifact/model/fixture/as-of-time identity; reproduce 16 failures by boundary with raw-wire vs canonical evidence where available.
- Add full-context specifications from evidence.md as implemented live cases in the owning fixes; report every trial and calibrate a held-out support review set.
- Freeze the current no-metadata API shape and test local fallback release behavior independently of optional U01/U02 proposals.

**Fixed context:** Existing suite ticket remains in progress. The 43/59 baseline is historical; no new release is validated.

Notion: [Establish a continuously growing regression test suite](https://www.notion.so/3b1d5d1094a681da9f30fdb3bb375554).

## S02 — Make evaluation effects fully simulated and fail closed

Owner: Evaluation/platform engineer. Stage: 0. Track: local.
Dependencies: none.

**Objective:** Extend the existing fixture gateway for stateful OTP, RSVP, takeover and provider effects. Replace legacy RSVP setup/teardown that assumes prior decline.

**Owned scope:** src/runtime/eval-fixture-gateway.ts, src/evals/rsvp-isolation.ts, isolated fixture provider gateway, fixture tests; integrator owns handler wiring.

**Acceptance:**

- Every effect in fixture mode resolves to a simulated implementation or a hard failure; no provider write forwards to HTTP. Network-denial tests prove this.
- Production rejects fixture markers; ordinary dev retains the real-customer write block; capability manifest distinguishes simulation explicitly.
- Synthetic run/case identities and operation receipts work across Lambda invocations; assert arguments/count/state/replay and unknown scenarios. Move four write-world mismatches onto declared scenarios.
- Use evaluation-scoped DynamoDB namespace keyed by run/case/operation with TTL for cross-invocation fixture state; expose no real effect fallthrough. Include one-shot OTP/handoff outcomes.

**Fixed context:** Existing simulation already supports OTP/RSVP outcomes. Do not create another fake backend or enable customer writes.

Notion: [Make evaluation effects fully simulated and fail closed](https://app.notion.com/p/3d2d5d1094a681c28e75f05fe80c36b7?pvs=204).

## S03 — Propose minimal upstream name and lookup corrections for approval

Owner: Integrator preparing upstream proposals. Stage: optional. Track: optional_upstream_proposal.
Dependencies: none.

**Objective:** Prepare U01 sender-name correction and U02 existing lookup coverage repair using the validated current shape. Neither proposal blocks local implementation.

**Owned scope:** Local contract-validation.md; proposal only, no upstream repository or API changes.

**Acceptance:**

- Document message keys verified by current read-only probes and inspected schema; distinguish missing sampled fields from undocumented server possibilities.
- U01 changes only sender name selection using existing data or neutral greeting; U02 restores lookup agreement through existing event/detail fields. Request no new endpoint or metadata field.
- Include exact acceptance examples and current local fallback; submit no upstream changes without separate approval. Local release excludes U01/U02 acceptance.

**Fixed context:** Numeric greetings already sent by upstream cannot be fixed by Lambda. Agent-authored greetings use neutral wording when no verified name is present. This ticket is proposal-only.

Notion: [Propose minimal upstream name and lookup corrections for approval](https://app.notion.com/p/3d2d5d1094a681d8adc1e070550c338a?pvs=204).

## S04 — Handle reminder and invitation mismatches with existing API fields

Owner: Runtime policy engineer. Stage: 1. Track: local.
Dependencies: [S01](#s01--establish-a-continuously-growing-regression-test-suite), [S02](#s02--make-evaluation-effects-fully-simulated-and-fail-closed), [S16](#s16--ground-every-capability-claim-and-reuse-truthful-human-escalation).

**Objective:** Use current source/body/timestamps for narrative reminder context and existing authorized event/detail APIs for actionable identity; escalate unresolved mismatch without upstream changes.

**Owned scope:** turn-message-context.ts, adapter source normalization and RSVP evidence policy; integrator owns service wiring.

**Acceptance:**

- Recognize frontend_followup/admin_campaign and relevant manual context through adapter metadata plus structured extraction; no new message fields, keyword routes or second memory.
- Current reminder title/link has outbound-message provenance, never mutation authority. Action uses only a unique valid candidate returned by existing trusted lookups.
- Roberto empty/404 mismatch triggers one human request and truthful result, zero RSVP writes or false denial. A verified unique companion case writes once.
- Maria Paz confusion explains the current reminder, preserves literal event title, lists no unnamed records and performs no RSVP mutation. Explicit historical switches remain supported.

**Fixed context:** No upstream dependency. Exact historical backend root cause is an evidence limitation; mismatch and handoff behavior are fixed by plan revision 2.

Notion: [Handle reminder and invitation mismatches with existing API fields](https://app.notion.com/p/3d2d5d1094a681538720e968fccbb0bc?pvs=204).

## S05 — Prevent repeated generic welcome after contextual acknowledgements

Owner: Conversation policy engineer. Stage: 1. Track: local.
Dependencies: [S01](#s01--establish-a-continuously-growing-regression-test-suite), [S02](#s02--make-evaluation-effects-fully-simulated-and-fail-closed), [S16](#s16--ground-every-capability-claim-and-reuse-truthful-human-escalation).

**Objective:** Handle campaign greetings, deferrals and post-RSVP remarks without reopening the provider interview.

**Owned scope:** New pure continuity policy, turn-message-context.ts, message-response-classifier.ts, focused tests; integrator owns service changes.

**Acceptance:**

- Replay Jose with available history and classifier respond plus acknowledgement_only; no provider interview/tools or repeated welcome.
- Suppress typed pure closure; acknowledge a substantive relationship comment once without a question. Explicit requests and eligible credential/RSVP decisions pass through; empty delta never starts onboarding.
- Tito relationship comment preserves attending state and does not grant access or change party size; Maria Paz confusion is not RSVP consent.
- Cover missing history, current frontend_followup, old admin_campaign, manual followup and explicit topic switch without keyword routing or a second memory store.

**Fixed context:** Current dev continuity guards must be characterized; no assumption that the older production welcome still reproduces verbatim.

Notion: [Prevent repeated generic welcome after contextual acknowledgements](https://www.notion.so/3bcd5d1094a681669a00e0c31e954899).

## S06 — Prefer human help and limit OTP to one challenge

Owner: Authentication policy engineer. Stage: 1. Track: local.
Dependencies: [S01](#s01--establish-a-continuously-growing-regression-test-suite), [S02](#s02--make-evaluation-effects-fully-simulated-and-fail-closed), [S16](#s16--ground-every-capability-claim-and-reuse-truthful-human-escalation).

**Objective:** Implement the exact human-first authentication table in plan revision 2: one send and at most one verification, no resend or email repair loop.

**Owned scope:** New InformationAuthStateMachine module and focused auth tests; integrator owns agent-service.ts:4036/:5370.

**Acceptance:**

- Phone-scoped/public reads and valid/phone authentication take precedence; unresolved protected requests attempt human help by default.
- OTP requires explicit user choice, existing trusted account/email evidence, compatible protected read and enabled capability, unused recovery budget, and no active takeover. Unknown eligibility goes to human help.
- Consume send and verification before dispatch, disable their transport retries, and persist budget across session/plan resets. First non-delivery, resend/email-change request or any failure terminates OTP and invokes the common human policy.
- Number-word code may be verified once. Success resumes only the original request; subsequent codes after failure never verify. Normalize existing challenge/failure state conservatively.
- Version old resend/two-failure regression expectations to the user-approved one-shot policy; keep incident IDs, hard structure, mandatory semantic judge and separate behavior registry entries.

**Fixed context:** No OTP eligibility endpoint is added. Failed human escalation never reopens OTP; no automatic episode restart after failure.

Notion: [Prefer human help and limit OTP to one challenge](https://www.notion.so/3bcd5d1094a681aa88f3e3e807176ec3).

## S07 — Make RSVP status offers and mutation decisions explicit

Owner: RSVP policy engineer. Stage: 2. Track: local.
Dependencies: [S02](#s02--make-evaluation-effects-fully-simulated-and-fail-closed), [S04](#s04--handle-reminder-and-invitation-mismatches-with-existing-api-fields).

**Objective:** Separate attendance facts, selection, offer disposition and mutation authorization.

**Owned scope:** New RsvpDecisionPolicy, src/core/rsvp.ts and focused tests; integrator owns service wiring.

**Acceptance:**

- Read-only declined status offers one optional attendance change per event/state version, with no mutation; repeated query and explicit no-change do not loop.
- Current attending state and repeated identical decisions avoid unnecessary writes; explicit reversal still requires validated subject/action.
- Pending, declined, attending, unknown, ambiguous and unavailable cases use distinct outcomes; missing labels never become eight selectable placeholders.
- Full structural and hard semantic live tests verify offer/no-offer, reversal and incomplete identity.

**Fixed context:** The declined-status one-off offer is fixed product policy; not a remaining decision. Unsupported/currently blocked writes use S16 human fallback.

Notion: [Make RSVP status offers and mutation decisions explicit](https://app.notion.com/p/3d2d5d1094a6819498e5dec8328cde46?pvs=204).

## S08 — Reconcile phone-scoped order partitions and carts with minimum disclosure

Owner: Purchase domain engineer. Stage: 1. Track: local.
Dependencies: [S01](#s01--establish-a-continuously-growing-regression-test-suite), [S02](#s02--make-evaluation-effects-fully-simulated-and-fail-closed), [S16](#s16--ground-every-capability-claim-and-reuse-truthful-human-escalation).

**Objective:** Establish record identity and per-field provenance before interpreting status, current subject or unsupported mutation requests.

**Owned scope:** src/runtime/information-orchestrator.ts and pure reconciliation module, gateway contract tests.

**Acceptance:**

- Frozen wire fixtures distinguish pending/completed orders and carts; conflicts/freshness do not silently become a confident preferred status.
- Freeze separate pending and approved Kiara worlds; output follows verified world data. A source conflict produces explicit conflict, never a prompt-forced pending status. Historical exact cause is non-blocking.
- Martha selection and event associations are tested from actual trusted order mappings, not inferred from absence of a guest relationship.
- A separately requested authorized safe gift read can precede the unsupported dedication mutation handoff; apply the common S16 effect/claim rules.

**Fixed context:** Supersedes older ticket statements that only legacy orders are parsed and that offset-less dates should be converted. Current code supports partitions; preserve server-local timestamps.

Notion: [Reconcile phone-scoped order partitions and carts with minimum disclosure](https://www.notion.so/3ced5d1094a681c395a3e4a1503a1eb2).

## S09 — Project purchase replies from typed selection and provenance outcomes

Owner: Purchase presentation engineer. Stage: 2. Track: local.
Dependencies: [S08](#s08--reconcile-phone-scoped-order-partitions-and-carts-with-minimum-disclosure).

**Objective:** Resolve Alex, Maria Jose, Delia, Martha and transfer-continuity failures by constraining model-visible facts.

**Owned scope:** PurchaseReplyProjector and outcome-specific prompts/tests; integrator owns service/composer integration.

**Acceptance:**

- Cart has its own record type; order amount/status cannot attach to it. Disputed/reported amounts never become settled total or balance.
- Unique trusted record is stated directly; multiple records require selection; unavailable customer-reference metadata does not create false uncertainty.
- Only trusted event associations and requested fields enter input; no generic payment-method advice or unsolicited currency caveats.
- Time/currency corrections remain user-reported when unverifiable; retain server-provided local time without conversions. Each behavior gets a distinct coverage entry and live case.

**Fixed context:** Do not expand global payment prompts; preserve minimum disclosure and existing public payment-policy boundaries.

Notion: [Project purchase replies from typed selection and provenance outcomes](https://app.notion.com/p/3d2d5d1094a681acbcf8ddec94877a8b?pvs=204).

## S10 — Unify model-call projections and remove discarded reply calls

Owner: Runtime projection engineer. Stage: 2. Track: local.
Dependencies: [S01](#s01--establish-a-continuously-growing-regression-test-suite), [S05](#s05--prevent-repeated-generic-welcome-after-contextual-acknowledgements), [S16](#s16--ground-every-capability-claim-and-reuse-truthful-human-escalation).

**Objective:** Give one builder ownership of actual instructions/schema/tools/input and use deterministic replies for complete outcomes.

**Owned scope:** ExtractionProjection, ReplyEvidenceProjector, prompt-loader.ts and prompt audits; integrator owns openai-agent-runtime.ts.

**Acceptance:**

- Same capability projection feeds schema and textual allowed actions; inactive lane state and tools are omitted.
- Clarification excludes providers before generation; acknowledgement has no provider tools; complete deterministic outcomes invoke no reply model.
- Actual bundle identity and instruction/input/schema/tool bytes are recorded once. Unaffected outcomes do not grow; changed request deltas are reported.
- Move remaining conversational instructions to exact-node Spanish prompt files, eliminating prose rules replaced by typed outcomes rather than merely relocating them.
- Capability, auth, RSVP effect and handoff outcomes are deterministic. Narrative reply action claims reference allowed typed operation/result evidence; invalid structure falls back to the deterministic renderer with no corrective model call.

**Fixed context:** No model/framework change in this ticket. Preserve explicit topic-switch interpretation.

Notion: [Unify model-call projections and remove discarded reply calls](https://app.notion.com/p/3d2d5d1094a681d09d7efec9ebd22f25?pvs=204).

## S11 — Persist RSVP effect outcomes before reply generation

Owner: Runtime execution engineer. Stage: 2. Track: local.
Dependencies: [S02](#s02--make-evaluation-effects-fully-simulated-and-fail-closed), [S07](#s07--make-rsvp-status-offers-and-mutation-decisions-explicit).

**Objective:** Close the observed source-level window between external RSVP success and later plan persistence.

**Owned scope:** Typed RSVP effect executor/receipt and persistence seam; integrator owns agent-service.ts ordering.

**Acceptance:**

- Persist operation intent/identity, execute once under supported backend contract, and persist confirmed outcome before model composition/delivery.
- Fault injection covers write-success/reply-failure, timeout-unknown, retry, save failure and delivery failure; no unsupported success claim.
- Assume no backend idempotency contract. Disable automatic write retries; on ambiguous RSVP write outcome use one authorized state read, report observed state without attributing it to this write, otherwise human help. Persist local receipts.
- Both deterministic and live simulated effect receipts prove final attendance and attempted effect count.

**Fixed context:** This is an architectural risk verified in source, not the proven cause of Roberto's no-match incident.

Notion: [Persist RSVP effect outcomes before reply generation](https://app.notion.com/p/3d2d5d1094a681b7b6ffd76bc85aac5b?pvs=204).

## S12 — Track per-provider quote completion and truthful event dates

Owner: Provider workflow engineer. Stage: 3. Track: local.
Dependencies: [S02](#s02--make-evaluation-effects-fully-simulated-and-fail-closed), [S10](#s10--unify-model-call-projections-and-remove-discarded-reply-calls).

**Objective:** Keep failed provider requests actionable after partial completion and stop sending today as the event date.

**Owned scope:** src/runtime/finish-plan-tool.ts, new PlanCompletionExecutor and provider tests; integrator owns reducer/schema wiring.

**Acceptance:**

- Require an explicitly captured valid event date before quote submission because eventDate is required in the current client; do not send today or null.
- Persist per-provider effect outcomes; retry only unresolved providers; partial success never silently finishes all needs.
- Reply generation cannot mutate plan via Object.assign or choose unauthorized completion effects.
- Fault tests cover two-provider partial success, duplicate retry, missing date and unknown effect; preserve multi-need event-plan behavior.

**Fixed context:** Separate from RSVP implementation despite shared effect principles; atomic commit and separate behavior registration.

Notion: [Track per-provider quote completion and truthful event dates](https://app.notion.com/p/3d2d5d1094a681eeae98da38e380bf23?pvs=204).

## S13 — Align trace and semantic judging with verified outcomes

Owner: Evaluation engineer with product reviewer. Stage: 2. Track: local.
Dependencies: [S01](#s01--establish-a-continuously-growing-regression-test-suite), [S02](#s02--make-evaluation-effects-fully-simulated-and-fail-closed).

**Objective:** Fix misleading grading and trace contracts without weakening correct product expectations.

**Owned scope:** src/evals/runner.ts, semantic judge context, trace construction, reference disclosure tests.

**Acceptance:**

- OTP attempt and selected-provider facts are graded structurally; judge cannot override a verified call with no-attempt speculation.
- Effective per-turn fixture history is subject-scoped; notes carry provenance and cannot overrule the frozen world's current facts.
- Implement the fixed customer-reference policy: only existing explicitly customer-visible authorized fields may be shown; absent fields are omitted and judges do not demand echoing redacted codes.
- Calibrate complete Spanish replies against independent human labels, including Joaquin language and Delia numeric redaction artifacts; keep requireJudge and hard gates.
- Version and document the one-shot OTP policy; historical resend expectations are superseded, not silently weakened. Judge fallback text separately for successful, failed and unknown human handoff.

**Fixed context:** Trace-only provider selection gap is not a reason to change successful selection behavior.

Notion: [Align trace and semantic judging with verified outcomes](https://app.notion.com/p/3d2d5d1094a6811aa885fe7c71c7a724?pvs=204).

## S14 — Diagnose and harden WhatsApp conversation continuity and duplicate processing

Owner: Adapter/storage engineer. Stage: 0. Track: local.
Dependencies: none.

**Objective:** Implement local lease fencing and available-ID deduplication using existing coordination state; retain missing historical evidence without a release dependency.

**Owned scope:** Channel message identity, existing turn coordinator and plan-store tests; upstream Tito correlation.

**Acceptance:**

- Use current native/record IDs. With absent coalesced constituent IDs, preserve ambiguity rather than deleting distinct identical-body records; no new upstream field required.
- Fence plan persistence against the active lease owner using a conditional transaction on the existing coordination record. An expired/superseded owner cannot save.
- Fault tests cover duplicate input, overlapping turns, lease expiry, save failure and delivery retry; replay persisted outcomes without repeating effects. No second lock store or cross-system exactly-once promise.
- Retain Tito historical correlation as optional evidence enrichment; release acceptance uses the full sanitized screenshot scenario. Jose remains classified history-present misrouting.

**Fixed context:** Local storage/adapter implementation only. Missing upstream trace or batch metadata is not a blocker.

Notion: [Diagnose and harden WhatsApp conversation continuity and duplicate processing](https://www.notion.so/3ced5d1094a68152afd9c5a5e1799876).

## S15 — Validate and prepare the stabilization release artifact

Owner: Integrator/release engineer. Stage: 3. Track: local.
Dependencies: [S01](#s01--establish-a-continuously-growing-regression-test-suite), [S02](#s02--make-evaluation-effects-fully-simulated-and-fail-closed), [S04](#s04--handle-reminder-and-invitation-mismatches-with-existing-api-fields), [S05](#s05--prevent-repeated-generic-welcome-after-contextual-acknowledgements), [S06](#s06--prefer-human-help-and-limit-otp-to-one-challenge), [S07](#s07--make-rsvp-status-offers-and-mutation-decisions-explicit), [S08](#s08--reconcile-phone-scoped-order-partitions-and-carts-with-minimum-disclosure), [S09](#s09--project-purchase-replies-from-typed-selection-and-provenance-outcomes), [S10](#s10--unify-model-call-projections-and-remove-discarded-reply-calls), [S11](#s11--persist-rsvp-effect-outcomes-before-reply-generation), [S12](#s12--track-per-provider-quote-completion-and-truthful-event-dates), [S13](#s13--align-trace-and-semantic-judging-with-verified-outcomes), [S14](#s14--diagnose-and-harden-whatsapp-conversation-continuity-and-duplicate-processing), [S16](#s16--ground-every-capability-claim-and-reuse-truthful-human-escalation).

**Objective:** Integrate atomic work and prepare an evidence-backed exact-artifact production promotion.

**Owned scope:** Coverage registry, docs/implementation-log.md, development CloudFormation deployment and release evidence.

**Acceptance:**

- Each behavior change has a separate registry entry, offline twin where possible, and full-context mandatory live case with hard structure/semantic judge.
- Focused tests, typecheck/lint, prompt audits and coverage audit pass; current dev deployment and full eval:behavior-live have zero skips/errors/hard failures.
- Affected high-risk families pass three recorded trials on identical worlds; support reviewer validates complete interactions and adjudicates disagreements.
- Record exact artifact/SHA, rollback identity and read-only smoke plan. Production promotion requires a separate explicit user action; keep webhook/secrets/tables intact.
- No upstream proposal or unknown historical cause blocks release. Verify no-metadata local fallbacks, one-shot OTP and all dynamic capability/handoff variants.

**Fixed context:** Do not mark complete based on the old 43/59 report or a focused-only pass. Do not run legacy real RSVP setup hooks.

Notion: [Validate and prepare the stabilization release artifact](https://app.notion.com/p/3d2d5d1094a681b1b756ee5a68b22671?pvs=204).

## S16 — Ground every capability claim and reuse truthful human escalation

Owner: Runtime capability engineer. Stage: 0. Track: local.
Dependencies: [S02](#s02--make-evaluation-effects-fully-simulated-and-fail-closed).

**Objective:** Extend the existing manifest into one per-turn authority for operation availability, execution, tool/schema projection and truthful action/handoff claims.

**Owned scope:** capability-manifest.ts, pure TurnCapabilityPolicy and HumanHelpPolicy, capability renderer/prompts and focused tests; integrator owns service/model wiring.

**Acceptance:**

- Compute executable/needs_input/unsupported/unavailable/blocked/already_completed from implementation, flags, gateway, environment, trusted identity, resource state, authorization and attempt budget; recompute after results. No stale persisted can-do claims.
- Map every tool/effect exhaustively: finish_plan requires quote write; favorites/reviews/phone updates have explicit write capability; OTP calls are counted effects. Planning/read availability never authorizes mutation.
- Only relevant operation distinctions reach extraction; only selected outcome and allowed next steps reach reply. Broad capability questions use a bounded deterministic list. No whole catalog on normal turns.
- Unsupported document delivery, payment-proof verification, refunds, purchase edits and unsupported media produce no promise; provide an authorized requested safe read then attempt existing request-human once. No future notification/SLA promises.
- Persist handoff intent/result with local deduplication. Only confirmed success sets requested and soft-pauses. Blocked/failed/unknown handoff stays truthful and preserves safe public help; it never retries automatically or enters OTP.
- Deterministic Spanish outcome renderers and structural claim references enforce success only with matching receipts. Test unavailable preflight, later gateway failure, cross-turn capability change, missing identity, exhausted OTP, and successful/failed/unknown/duplicate handoff.

**Fixed context:** Use the existing request-human endpoint; no upstream changes. Failed handoff never invents a queue, ticket, recipient notification or timing. See the exact plan.md truth table.

Notion: [Ground every capability claim and reuse truthful human escalation](https://app.notion.com/p/3d2d5d1094a681ffbff2f4f577892847?pvs=204).
