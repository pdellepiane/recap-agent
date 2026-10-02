# Failure-only production landing — 2026-09-17

## Binding objective

Land the smallest changes that repair observed customer-support failures, verify only the affected failed cases plus the unresolved errored case, and promote the exact tested artifact if the release conditions below pass. This is a user-requested targeted-release amendment: do not run another full suite or broad live panel. Do not call this a full-suite green release.

Baseline: source dc433da1 (log), tested implementation/evaluator c51fce83, run eval-2026-09-17T15-44-32-210Z-d92b78c3, 81 pass/38 fail/1 error. Confirm current HEAD and preserve newer work before editing. The source review found errors below; stored model-payload parity still needs the listed offline checks. Do not treat inferred causes as proven by a passing mock.

Preserve unrelated .gitignore/.ignore and untracked work-package documents. Read AGENTS.md and the existing release contract; this document supersedes only the old no-rerun/full-suite requirements for this targeted landing. Keep authorization, identity, no duplicates, truthful effects, and model-authored prose binding.

## Scope decisions — fixed before implementation

- No model change, SDK upgrade, reasoning change, retrieval redesign, new state machine, persistent cache, new global prompt rule, response postprocessor, or canned wording.
- Keep current low reasoning. This run does not establish that changing reasoning caused the failures.
- Prefer restoring facts and execution to adding directions on how to speak.
- Customer wording is free. Test whether the answer is true, useful and attributable to real effects. Never require a particular verb, sentence, question syntax, token, or repeated policy recital.
- Every selected live case failed or errored in the baseline. No previously green live cases are added. Use existing offline boundary tests and new deterministic reproductions for the changed paths; these are necessary even if existing offline tests were green.
- Do not tune runtime to flip planning-quality cases. Do not wave away factual defects because a case happens to involve planning.

## Priority and implementation ownership

Coordinator may delegate three bounded lanes. Workers share the tree, must not revert others, and must not deploy/run paid tests independently. The coordinator integrates shared agent-service.ts edits sequentially.

### A — Payment fact preservation: high gain, low implementation risk

Own src/runtime/purchase-reply-projector.ts, src/runtime/customer-context.ts, and the purchase-profile projection in src/runtime/openai-agent-runtime.ts. Tests: tests/runtime-actual-request.test.ts and existing purchase-projection tests.

Observed failure: both Luis and owner-payment describe 227.76 as amount due although paid amount is unknown. The typed purchase outcome represents remaining=null and remainingVerifiable=false, but projectInformationResultForReplyWithProfile discards outcome when a profile exists. The profile retains raw totals without that same explicit balance distinction.

Required change:
1. Reproduce the final serialized input on the profile-present path, not the standalone projector.
2. Give the canonical purchase record explicit sourced total, paid value/availability, remaining value/availability and currency availability using the existing purchase projection. The unknown remaining balance must survive deduplication. Do not infer paid=0 from missing data or an empty payment list.
3. Preserve the profile reference optimization only when the referenced record contains the required facts. Do not reintroduce the entire purchase payload twice; use a compact typed limitation if canonical integration needs more change than retaining the evidence.
4. Keep raw totals available for legitimate total questions. Do not hide financial information to prevent the model using it.
5. No arithmetic is authorized without validated source fields and the existing domain contract. No invented currency. User-reported amounts remain user-reported.

Offline proof: serialize profile-present unknown-paid, explicit-zero-paid, and user-reported-payment examples. Verify exact numeric meanings and provenance, not response sentences. Existing paid/total fields must not collide. The live answer can explain unknown balance in any natural wording.

### B — Resume the pending task and preserve the support topic: high gain, bounded medium risk

Own the pending-request/support-acknowledgment section of src/runtime/agent-service.ts, tests/support-continuity.test.ts and the existing authentication continuation tests. Coordinate with lane C before touching shared composition code.

Observed OTP failure: extraction recognizes contactEmail and the unresolved event-time question, but information_request_count=0/supportAct=provide_detail falls through the acknowledgment path. hasNewResolvingContext recognizes event/person/role references but not credential input. Card-support continuations also ask for the problem already supplied.

Required change:
1. Use the existing pending request and existing auth/input requirements to resume work when a supplied typed field satisfies the required next input. Include provided email/code through existing validated extraction fields. Do not create a separate OTP flow or infer authorization from a role statement.
2. Remove the requirement that a user restate a pending question when supplying a missing field. Do not resume a terminal refused/completed task merely because it remains in historical context.
3. Preserve the known support topic through the existing conversation/pending-question projection when guest/event details arrive. Acknowledgment should not erase the card problem or ask the user to explain it again.
4. Do not manufacture a structured pending operation from support_query_open alone. Bare role corrections and thanks remain lightweight.
5. For the card answer, inspect the actual serialized KB evidence. If relevant card-rejection facts were dropped, preserve them through the existing FAQ projection; if present, remove contradictory topic/acknowledgment constraints. Do not add new search calls, change ranking globally, or invent payment-provider troubleshooting advice. If the KB lacks the answer, state that scoped limitation without reciting unrelated articles.

Offline proof: pending event question + email reaches request_user_login_code once and preserves code_requested; actual OTP input reaches existing verification path; refusal remains terminal; card topic survives two metadata turns; bare role correction triggers no invented lookup/action. Check model input and execution counts, not synthetic generated phrasing.

### C — Composition recovery and effect attribution: high impact, small isolated edits

Own image recovery and RSVP reply-evidence sections in src/runtime/agent-service.ts/src/runtime/openai-agent-runtime.ts and their existing offline tests. Coordinate shared edits with B.

Image failure: typed provider-download errors already recover in the information path, but handleSupportAcknowledgment catches the same error and returns an empty failure delivery.

Required change:
1. Reuse the existing typed image-access recovery for the acknowledgment composition path. Prefer extracting the already-used composition operation rather than copying a second error classifier. Avoid migrating unrelated reply branches in this round.
2. On a recognized inaccessible attachment only, compose once more without that attachment, carrying explicit unavailable-media evidence, original user text, existing facts, and completed effect receipts.
3. Do not repeat extraction, upload, read/write effects, authentication, or takeover. No URL/image resend request. Generic auth/model/schema/timeout failures retain their real classification; do not disguise them as unavailable images.
4. The failure reply remains model-authored. If fallback itself fails, record an explicit delivery failure; never claim successful silence.

RSVP failure: Cinthya already has confirmed attendance. The reply sounds like a newly registered confirmation although this turn performed no mutation. This is incorrect action attribution, not invented attendance.

Required change:
5. Preserve existing-state versus this-turn-effect evidence independently of operational-note suppression. Use existing receipt/action outcome types: current state, whether this turn attempted/applied a mutation, and verification provenance. If no mutation occurred, do not fabricate a completed effect receipt.
6. Do not force the word 'ya', prohibit 'quedó', or add a canned success sentence. The semantic requirement is that an existing state not be presented as an action performed now. A natural statement of confirmed attendance can pass without explaining internal mechanics.

Offline proof: mocked provider image404 at the real acknowledgment compose boundary produces a second request without the attachment and retains facts; no doubled effects. Generic error does not enter this branch. Serialize existing attendance/no-write and fresh verified write as distinct evidence.

## Evaluator changes — only selected failing cases

Coordinator owns oracle edits; freeze them BEFORE the rerun. Preserve previous artifacts and R05 versions. No lower thresholds, keyword bans, required response verbs or hidden best-of retries.

- Luis: retain hard unknown-balance/no-approval/no-currency-invention requirements; repeating72h on each turn is optional. The initial response must address balance, not merely recite pending status.
- Owner-payment: silence on thanks remains valid; unknown paid is not zero. No mandatory Yape recital unless relevant to the question.
- Cinthya: distinguish false claim of a new action from truthful existing attendance. Do not fail confirmed-state wording solely because of tense. Judge the whole answer against action evidence. An explicit claim of a newly submitted/changed RSVP without an effect fails.
- OTP: receipt-backed sending and continuing the credential step are required. Remove the arbitrary ban on the ordinary word 'texto'; any understandable request to supply the code is allowed. Sending cannot be inferred from prose.
- Image unavailable: no required legacy tool-name pin; require a delivered grounded limitation, no invented pixels/payment approval, and no media/URL request. Unknown image facts are not an invitation to fabricate an answer.
- Support/concurrent: maintaining the known card topic is substantive. Repeating identifying details is optional; asking what the already-known problem is is a usability defect. Do not require technical knowledge absent from the fixture.

## Exact rerun: eight baseline failures/errors only

1. live_behavior.owner_customer_payment_relevance
2. live_behavior.pending_balance_validation_luis
3. live_behavior.otp_sent_explains_image_limitation
4. live_behavior.image_url_unavailable_evidence
5. live_behavior.rsvp_cinthya_campaign_invitation_not_reported_missing
6. live_behavior.support_detail_continuity
7. live_behavior.concurrent_support_turns_preserve_context
8. live_behavior.provider_reference_cheaper_option

The first seven cover12 conversational turns in the baseline. Load input count for the errored planning case from its YAML; its old0turn result is not its intended test length. Run each complete thread once, not just the previously failing turn. Keep source fixtures, identity isolation and concurrency semantics. The planning case establishes execution/delivery and shared integrity; provider recommendation quality remains diagnostic under the user's planning allowance.

No another full suite, no broad panel, no separate semantic reruns to improve scores. Use one existing bounded invocation. Transport retries only under the frozen existing policy, logged separately. Do not launch duplicate foreground/background invocations. One coordinator owns the evaluator process and watches its completion; a timeout is not permission to start a second copy.

## Offline preflight and observation

1. Run typecheck, only affected offline suites, coverage registry and deterministic counterexamples described above. Do not rerun all offline suites merely to pad counts.
2. Verify all eight selected fixtures, schemas and mandatory judges load. Record exact case/evaluator/fixture hashes, model IDs, actual reasoning settings, and runtime artifact hash. No unrelated evaluator repair mixed into the rerun.
3. Inspect the remaining failed-case artifacts read-only. This is adjudication, not rerunning or expanding the implementation. Separate factual error, unusable continuation, unsupported expectation, acceptable planning quality and presentation preference. The prior blanket '25 wording waivers' is insufficient. Specifically review host-set declining, missing-event identity, card-support, and provider-grounding allegations. Any independently confirmed unresolved customer-safety or factual blocker must be reported; do not declare a release safe because eight selected cases pass.
4. Build and deploy dev exact frozen bytes with se-dev/us-east-1 and STS account684516060775. Capture deployment before/after; no production mutation before the checks below.
5. Run the exact eight cases once, under this user's failure-only verification authorization. Observe each substantive turn's delivered answer, tools, receipt identity, current task, final state and delivery disposition. No paid calls outside this invocation except the already-defined bounded image-access recovery within a turn.
6. Preserve complete raw results and a separate evidence-backed interpretation. Do not rewrite original scores or call this a new full-gate pass. Log retry counts, model calls, latency and actual cost.

## Production decision — conditional, no further blanket approval question

The user asks to land production after targeted verification. Promote the identical tested artifact when all of these hold:
- All eight execute without missing turns, skips, transport errors or unexplained blank required replies.
- Both money cases never turn unknown paid into amount due; useful balance limitation delivered.
- OTP sends once through a confirmed effect and advances the correct pending task.
- The unavailable image gets a truthful response; no duplicate effects or media request.
- Cinthya communicates a true existing state without fabricating a new action.
- Both support threads preserve the known issue and provide the available relevant help/limitation without asking the user to start over.
- Zero unauthorized access/write, wrong entity, duplicate effect or false action/payment confirmation across the targeted run.
- Remaining old reds have explicit dispositions; no known unresolved critical factual/effect/delivery issue is silently waived. Planning quality/presentation-only issues may remain accepted as documented. A judge rejection attributable only to a demonstrably incorrect wording requirement must be reported with evidence, not solved by editing the rubric after the run; do not misreport its formal gate status.

If any condition fails, stop promotion and report the exact blocker and tested artifact. Do not repeat the run, introduce another runtime patch or spend again without a new decision. Do not phrase 'offline-fixable' as evidence the fix actually works live.

For promotion: use existing CloudFormation/deployment workflow, same artifact bytes and compatible configuration; record actual production before identity and rollback artifact first. Verify IAM/config parity required by this candidate. Do not rebuild the ZIP for production. Perform existing non-model health/config checks only; if unhealthy, restore the recorded previous artifact/config using the existing rollback procedure. Do not invent a monitoring automation or claim ongoing observation after finishing.

## Final handoff evidence

Return atomic implementation/evaluator commits, exact artifact/runtime/model identities, targeted8 outcome table, per-blocker evidence, affected offline checks, disposition of remaining reds, production before/after identity if promoted, and rollback identity. State clearly: targeted release validation, not a green120-case gate.

Resume capsule: repair missing facts and pending-task execution, not Spanish wording. Seven failed support cases plus one errored planning case; no green live reruns. Low reasoning/model unchanged. Existing support acknowledgment bypass causes OTP/image failure; canonical profile dedup drops balance constraints. Existing attendance is not a new write. No another architecture project. Exact tested artifact only to production, conditional on truthful answers/effects and successful delivery.
