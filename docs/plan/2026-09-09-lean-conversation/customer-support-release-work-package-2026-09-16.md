# Customer support release work package — 2026-09-16

## 0. Final user amendment: one live run, complete profile, subtractive implementation

This is the final execution contract. The user can afford **exactly one live evaluation invocation**, not a diagnostic panel followed by a gate. No baseline run, standalone live probe, model-generation smoke test, semantic retry, or second paid evaluation is authorized. Offline tests use mocks and may run as needed before that invocation. Stored-request inspection is read-only; prefer artifacts already retrieved. Do not promise a green result from one stochastic run.

Finish the implementation and offline verification before spending that single invocation. Run the complete mandatory suite once against frozen development bytes. Accept planning-only quality failures under F5. If a shared correctness blocker remains, report it with the existing evidence and stop spending; do not launch another test or silently waive the blocker.

The profile requirement is now **all available, authorized customer information in one canonical context**, not a small subset selected by the current route. Reduce instructions, duplicates and control machinery rather than deleting customer facts. The latest user instruction supersedes earlier minimum-context rules wherever those would conceal authorized customer facts from customer assistance. Keep authorization, identity boundaries, credential exclusion and explicit disclosure restrictions intact.

## 0. Execute this package

Finish the customer-support implementation, validate the actual deployed artifact, and promote that artifact when the release conditions below are met. The user authorizes architectural simplification and accepts a red aggregate gate caused by planning-only quality or documented evaluator/style failures. Do not request the same authorization again. Do not interpret that authorization as permission to misreport test results or ship known duplicate effects, unauthorized reads, wrong-person/event actions, or false action confirmations.

Use two implementation owners at most: Runtime (A–D) and Evaluation (E). One coordinator owns commits, deployment, execution, release adjudication, and promotion (F). If using workers, assign disjoint files; tell them they share the repository and must preserve others' edits. No worker may deploy, modify another owner's files, change the model, or run live evaluations. A coordinator may do all work serially to conserve credits.

Implement the decisions here. Do not solicit new architecture choices from the user. Do not add a fourth agent, another classifier, a repair model, keyword routing, canned replies, post-generation rewriting, an exception catalog, or a second customer profile. Preserve the existing three owners: planning, FAQ, customer assistance. RSVP is a customer-assistance capability, not another conversational owner.

Read AGENTS.md, this file, the current acceptance contract, and the actual diff before editing. This package supersedes the previous bounded-rescue stop condition for the work authorized in the current conversation. Preserve historical plans and verdicts.

## 1. Starting point and unfinished work

Start at HEAD `1c15bce7`, following `4e46dcaa` and `a6394c99`. Verify HEAD and status; if another implementer has advanced the tree, reconcile their changes against these requirements rather than reverting them.

The current working tree contains UNCOMMITTED, PARTIALLY TESTED changes made during this audit. They are not deployed and are not release-ready. Continue them; do not claim they were completed by the previous rescue. Keep the pre-existing `.gitignore`, `.ignore`, and untracked `final-support-rescue-2026-09-16.md` changes outside implementation commits.

Audit changes currently touch:

- `src/runtime/agent-service.ts`: information-read precedence over incidental RSVP references; remove persisted RSVP state as a standalone work trigger; neutral role clarification; combine RSVP and information requests; host-withdrawal handoff deduplication; matched fresh RSVP read projection; remove duplicate write-echo projection.
- `src/runtime/openai-agent-runtime.ts`: omit initial provider category appendix without established planning; project scoped not-found facts without prewritten escalation prose; suppress redundant image operational notes; allow reply evidence to resolve extractor ambiguity.
- `src/runtime/customer-context.ts`: candidate amounts and separate creation/event dates; preserve event alternatives. Finish the relevance correction in B before landing.
- `src/runtime/information-orchestrator.ts`: bounded detail reads for unresolved authorized event alternatives.
- `src/runtime/close-flow-schemas.ts`, `src/runtime/extraction-schemas.ts`: separate model-wire close-action validation from strict executable domain validation.
- `prompts/extractors/planning.txt`, `prompts/shared/base_system.txt`, `prompts/nodes/responder_invitacion/system.txt`.
- Three revised live case YAMLs: accountless guest event, owner customer payment relevance, Diana host withdrawal.
- Tests: information flow, close void action, information orchestrator, s17 image turn.

Most recent local checks in this audit:

- TypeScript passed after the above implementation edits.
- Focused eight-file test batch: 251 passed, 8 failed, 2 skipped. Five failures are old assertions for the deleted duplicate RSVP backend-result field. Three failures are profile/hydration expectations affected by B. Reconcile them against the final complete-profile contract; old assertions requiring hidden known facts no longer define correct behavior.
- `tests/s17-image-turn.test.ts` is now green after correcting its contradictory no-read/receipt-boundary expectation. This is an oracle correction, not a runtime fix or proof of payment approval.
- Additional newly affected suites, complete offline tests, coverage registry, real SDK boundary, byte measurements, deployment, and live evaluation remain outstanding.
- No deployment, commit, promotion, or billable model-generation run was performed in this audit. Stored OpenAI request retrievals were read-only.

Last deployed candidate reported by the rescue: artifact `7dffc9116dffaff1688efd274a9aa0d9b6262402a25fcea0cb80ec26468d3b3a`, dev CodeSha `ff/JEW3/r/Fojv0nSpqg2bYmJAKiX86gy4DsJkaNOzo=`. Verify this freshly before deployment. Production was reported as `6CmXWVDpnr92gMF/fmrOPloBpiUnmiOOMAPA8MeQNhY=`. Do not claim fresh cloud verification from these historical values.

## 2. Binding behavioral decisions

1. Current structured model interpretation determines tasks. A persisted node, pending RSVP, old campaign, or incomplete planning form does not create a new task or suppress a current question.
2. Preserve persistent state for entity references, unresolved choices, authorization, deduplication, and action receipts. Do not use it as a competing script for the conversation.
3. Read authorized information before asking the customer. Customer assistance receives all available authorized customer records and details once in a canonical profile. The current question selects what to answer, not which known facts the model is allowed to see. Supply useful related facts in the answer, preserving explicit brevity requests; do not dump unrelated records.
4. Keep event, guest, purchase, and cart identities separate. Recency/campaign/context are inference evidence for the model; they are not permission for a write. An explicit old target wins. Never discard records by age.
5. A current-state observation is not a new mutation. An unknown paid amount is not zero. A pending user question is not a pending team review. An acknowledged write is not independently read-back-verified when the read API lacks that field.
6. Every delivered sentence comes from the current reply model. Runtime code supplies facts and effect outcomes, not prose to recite.
7. Never request images, URLs, resends, or a transcription of an unavailable image. Backend URLs remain supported. Preserve native file/URL context with the existing retention and chat-lock mechanisms. No additional OCR/extractor pass, object-storage system, debounce protocol, or backend package contract.
8. Handle text→image, text+image, and image→text using existing inbound messages and retained context. Do not promise exactly one response across separately delivered turns after an earlier response has already been sent. The upstream batching window is invisible to Lambda.
9. Do not implement the undocumented campaign parameter. Use campaign history already supplied with provenance. Document a missing fixture campaign separately from a runtime defect.
10. Do not change model/version/sampling during this work. Do not retry semantic failures until one happens to pass.

## 3. Evidence to reproduce; do not repeat the earlier misdiagnosis

Use `.eval-runs/eval-2026-09-16T05-47-17-504Z-14ace607/results.jsonl` and the earlier full run `.eval-runs/eval-2026-09-16T04-43-33-918Z-a5f25bd5/results.jsonl`. The six-case rescue is later than the full run. Never label an earlier failure as a confirmed current regression without checking changed code/oracles.

Stored request audits under `.openai-audits/` provide the decisive boundary evidence:

| Audit suffix on 2026-09-16 | Proven finding | Required disposition |
|---|---|---|
| `13-34-42-957Z` | Accountless extractor requested `event.detail.read` plus `associated_event`; also emitted an RSVP event reference, without an RSVP action. | Fix runtime preemption; do not blame extraction for missing the venue question. |
| `13-34-42-801Z` | Reply received current attendance but no information results or venue. | Ensure actual reply receives authorized venue facts. Existing attending state makes “attendance is registered” potentially truthful; do not automatically call it a fabricated new write. |
| `13-34-42-717Z` / `13-34-42-905Z` | Diana role correction was turned into planning, with provider categories and tools in the actual request. | Remove planning assumptions at extraction and reply construction, not by banning provider words after generation. |
| `13-34-43-069Z` | Image failure supplied a prewritten “team help needed” lookup message and operational “no payment effect” prose with null handoff outcome. | Project scoped lookup facts and real effect status; omit redundant operational prose. |
| `13-40-22-192Z` | Martha's two candidate totals were absent from the actual profile; full detail was empty. | Preserve selection facts before asking. |
| `13-40-22-406Z` | Mixed event/payment reply had empty invitation details and only purchase detail. A generic “reception” hint failed the name matcher. | Enrich bounded authorized alternatives and preserve both tasks in the projection. |
| `13-40-22-371Z` | Native image was attached, but an unconditional clarification instruction forced old campaign alternatives. | Treat extraction alternatives as provisional; reply may resolve them from supplied evidence. |
| `13-40-22-309Z` / `13-40-22-444Z` | Companion result mixed write echo, fresh-read attendance, old pending state, and forced review/retry guidance. | One scoped result with explicit provenance; no contradictory attendance or invented follow-up. |

The rescue payment reply correctly said total 227.76, pending/Yape, paid amount unknown, and balance not calculable. Accept that meaning. Conversely the earlier `pending_balance_validation_luis` answer explicitly said 227.76 remained due: that is a real factual failure. Do not merge these two diagnoses.

Diana's rescue turn 2 invoked `request_human_takeover` again. `handleHostWithdrawalInformation` bypassed `decideHumanHelpAttempt`; its source confirms a repeated-effect path. A repeated read-only policy lookup is an efficiency issue, not an unauthorized mutation.

The close failure names `closeAction.reason`. The model-wire extraction schema includes this field; reply schemas do not. SDK output validation runs before `normalizeExtraction`, so normalizing afterward alone cannot fix the failure. Do not propagate the unsupported “reply-side 500” diagnosis without a different stack trace.

## A. One customer turn; RSVP contributes work and evidence

Owner: Runtime. Files: `src/runtime/agent-service.ts`, `src/runtime/contracts.ts` if a typed internal result is required, `src/runtime/model-request-projector.ts`, `src/runtime/openai-agent-runtime.ts`, relevant prompt modules, service tests.

A1. Finish `hasRsvpWork` and routing precedence:

- A factual `informationRequests` entry with no explicit RSVP mutation/party decision must execute its read even if `actionIntent=responder_invitacion`, an event reference exists, or the previous node is RSVP.
- Preserve explicit `requestedOperation=rsvp.state.read`; it reads invitation status without a write.
- Remove `plan.rsvp_state.status !== none` as a sufficient trigger by itself. Pending selection is only resumed by current structured continuation evidence.
- Do not infer a mutation from the existence of an event reference, an attending state, or a thank-you.
- Validate structured party decisions, not merely a non-null `rsvpParty` object. Neutral party fields do not preempt information work.
- Preserve the existing verified RSVP executor, lock/lease, identity matching, read-back, and intent deduplication.

A2. Finish mixed-task composition:

- The in-progress `completedRsvp` path forwards extracted information work to `handleInformationFlow` before one reply. Retain this composition behavior.
- Replace its string-only outcome carrier with a typed internal completed-work result: invitation evidence, verified action outcome or observed current state, unresolved selection if any. Do not add a new persisted conversation state or public API.
- Carry the completed result into every terminal information outcome, including auth failure, unsupported read, and handoff; a later early return must not lose an already completed RSVP action or imply it was undone.
- Exclude already executed RSVP effects from `hasActionConflict`. Never re-run them during information execution or image-access retry.
- Keep reads for another explicitly named event separate from the RSVP target. Only the executor's same guest/event receipt can authorize a write claim.
- Keep existing helper names if renaming adds churn. Completion is measured by one task interpretation and one combined reply, not by deleting every historical node name.

A3. Remove empty-task planning takeover:

- Keep the removal of initial category priorities when `hasPlanningDetail=false`.
- Keep the extractor rule that a role correction updates `reportedEventRole` without inventing planning work.
- Use existing contextual clarification for role-only turns without provider tools/categories. Preserve actual provider selection clarification when a shortlist is unresolved.
- Current task facts outrank node defaults. Remove contradictory “node dictates the answer” requirements in modules actually sent; do not bulk-edit unused historical files.

A4. Resolve provisional ambiguity from evidence:

- Keep the replacement of the unconditional ambiguity appendix with evidence-based resolution.
- Apply the same contract to `prompts/nodes/aclarar_pedir_faltante/response_contract.txt` when loaded: ask only if materially different interpretations remain after seeing available facts/native images.
- Do not deterministically erase extractor ambiguity based on a keyword or force a candidate. Keep alternatives visible; the reply model resolves read-only references. Mutation ambiguity still requires an unambiguous authorized target.

Pass/fail:

- Venue question with an incidental RSVP reference performs no RSVP write and supplies the venue to the reply.
- Pending RSVP plus current payment/venue question does not replay attendance or force an attendance question.
- Explicit attendance plus event time produces at most one write, fresh same-ID read, both result and requested time, one reply.
- Explicit old-event target, same-name different guest, explicit event switch, and rejected phone identity preserve their existing protections.
- Role correction supplies no provider category appendix/tools. A real planning request still works.
- Available receipt plus unrelated campaign history can answer the receipt question without asking which campaign.

A5. Subtractive architecture and prompt acceptance:

- Remove the exclusive RSVP-versus-information decision, not just its known venue symptom. One customer-turn execution path collects requested reads, optional authorized RSVP effects, and handoff outcomes before one reply. Existing auth/effect executors remain helpers, not independent conversation owners.
- Replace the temporary `completedRsvp` bridge once the common path is established; do not ship two composition paths with duplicated auth, profile and outcome construction. Preserve tested specialized execution internals where extraction would add risk; eliminate competing response ownership first.
- Delete unused request builders and module loads left by consolidation. Do not add a compatibility flag or retain an old/new runtime switch.
- Shared prompt content must contain only response language, grounding, privacy and outcome-truth invariants. Remove node obedience, planning-by-default, obligatory no-write recitals, unrelated OTP/payment disclosures, and exhaustive case instructions from customer turns.
- Domain tools supply typed facts/outcomes. Do not encode entire branching protocols in prose or repeat the same rule in extractor, shared prompt, node prompt and operational note.
- Keep stable instructions/tools serialized first, dynamic history/profile afterward. Preserve adopted cache-key behavior; never put timestamps, customer IDs or run IDs into a prompt identity. Do not cache model answers or stale mutation state.
- Acceptance: actual customer-support instructions for role, venue, payment, image and mixed RSVP/read cases are no larger than the starting committed version, with no irrelevant planning module/tools. Show measured before/after bytes and removed modules/files. Additional profile facts are measured separately. A fix that only appends rules while preserving the conflicting path is incomplete.

## B. Preserve the facts needed for model inference

Owner: Runtime. Files: `src/runtime/customer-context.ts`, `src/runtime/information-orchestrator.ts`, `src/runtime/agent-service.ts`, `src/runtime/purchase-reply-projector.ts`, `src/runtime/openai-agent-runtime.ts`.

B0. Build one complete authorized customer profile:

- Use `assembleCustomerContext`, its existing merge path, and `projectCustomerContext`. Do not create a second profile builder, another LLM call, a new profile service, or a persistent profile cache.
- On customer-assistance entry, acquire independent allowed customer read roots together through existing gateways: guest event associations and applicable order/gift purchase roots. Include invitation/attendance facts available through those roots. Do not require an account or OTP for phone-authorized facts. Never turn profile building into an authentication request or a write.
- Include all records already returned or retained within the valid access scope: purchases, gifts, carts, associated events, invitations, venue/moment details, payment/shipping/dedication/thanks facts, customer-provided context, and action receipts. Keep past records; no age cutoff. Keep explicit disclosure restrictions, secrets/OTP/token exclusion, raw internal payload exclusion, and transaction-reference authorization.
- Enrich linked details through existing bounded reads, keyed by resource ID and access scope. Reuse results within the turn and existing persisted context; never perform the same read twice merely because two tasks need it. Do not re-read the whole profile on thanks, image-only persistence, or a pure public FAQ turn. Re-read the affected record for freshness when answering a new operational question and always after a mutation.
- Preserve available details for every authorized candidate rather than waiting for a runtime-selected target. Keep the current relationship-depth/read/deadline safeguards. If a bound, pagination or failure prevents completeness, record that section as partial and preserve known facts. Do not claim all records are loaded or no others exist.
- Model-visible profile shape: one customer identity/access-scope header; section coverage and freshness; entities keyed by stable ID with typed record kind; references connecting purchases/events/invitations; user-provided assertions with provenance; actual action receipts. Implement this by simplifying existing types/projection, not by creating a parallel schema and compatibility layer.
- Give each fact one home. Replace repeated candidate/full-detail/plan summaries with references to the canonical entities. A compact selection index may reference entities but must not repeat conflicting amounts or dates. Keep creation date, event date and payment time as distinct fields.
- The model may infer the conversational referent from this profile, campaign provenance and history. Runtime authorization still validates IDs and effect preconditions. Full profile access does not authorize disclosure of every fact in the answer or mutation of a guessed record.

B1. Complete purchase selection evidence:

- Include grounded public label, event date, separate creation date, payment state, recorded total and recorded currency for unresolved purchase alternatives. Use `amountDisclosure.total` before a legacy total; null never becomes zero.
- Do not put creation dates under `eventDate`. Keep missing dates absent.
- When an explicit purchase is resolved, retain other authorized records in the canonical profile; mark the requested record through a reference instead of hiding alternatives. Update the former unrelated-history byte-equality test: changing an available customer fact must change only that entity's evidence, not instructions, tools, route, selected target, or other records. Add a separate invariant proving no duplicate serialization.
- Remove focus-based data filtering from the customer profile. Keep a target reference for response relevance and mutations, without a second filtered copy or an amount-specific prompt exception.
- Preserve transaction-reference authorization. Keep carts as distinct records in context; exclude them from a payment-only answer unless relevant to the request. Do not equate a cart with an order or pending payment.

B2. Complete bounded event detail enrichment:

- When an event hint resolves uniquely, read that event.
- When the hint is absent, generic, or unmatched, read the already authorized alternatives within the existing four-read/depth/deadline bounds. Reading alternatives does not select a mutation target or declare an unmatched named event found.
- Never turn a failed string match into “venue unavailable.” Pass known alternatives with IDs and sourced details for model resolution.
- Keep identity mismatch checks and access-scope cache keys. Failed reads preserve summaries and explicit coverage, not fabricated absence.
- Retain all authorized event alternatives and available details in the canonical profile. A known relevant event ID is a focus reference, not a reason to erase other records.
- Mixed event/payment requests must use both relevant sections; purchase focus must not hide event details.
- Update obsolete tests that require zero detail reads for unresolved authorized candidates. Keep bounds, identity separation, unknown-target mutation prohibition, and explicit-old-target tests unchanged.

B3. Consolidate purchase facts:

- Trace `pending_balance_validation_luis` through fixture → normalized purchase → profile → actual request. The model must receive total as total, unknown paid amount as unknown, and unknown remaining balance as unknown in one canonical place.
- Remove duplicate summary fields that conflict with `amountDisclosure`, and irrelevant operational-note instructions when typed evidence already supplies the outcome. Do not repair output text afterward.
- Do not change a truthful missing-paid-amount explanation into a fixed preferred phrase. Do not require 72-hour language for an unrelated hour-only or simple amount question; include it when answering a sourced validation-window question.

Pass/fail:

- Martha and transaction-reference alternatives contain usable labels and totals; event/creation dates are not exchanged.
- Mixed venue/payment actual request contains venue name/street/city and payment evidence for the correct records.
- Selected payment answers stay on the requested order even with other orders/carts present in context; unauthorized transaction references remain excluded from model input.
- Unknown paid amount cannot yield a claimed exact remaining amount.
- Captured-request tests exercise the actual `buildExtractionRequestSpec`/`buildReplyRequestSpec` and installed SDK serialization, not manually assembled profiles alone.

## C. One truthful outcome for effects and unavailable images

Owner: Runtime. Files: `src/runtime/agent-service.ts`, `src/runtime/human-help-policy.ts` only if necessary, `src/runtime/openai-agent-runtime.ts`, RSVP prompts/tests.

C1. Finish host-withdrawal reuse of the existing handoff policy:

- Keep `decideHumanHelpAttempt` + `applyHandoffResult`, using the same `protected_request` scope as existing customer handoffs.
- Persist unknown intent before dispatch, final receipt before reply. Success never dispatches again. Unknown never auto-retries. A definitively failed handoff retries only on a new inbound explicit retry.
- Preserve the original receipt time on a reused success; do not invent a new requested-at time.
- Keep missing-phone, unavailable capability, skipped call, failure, and unknown distinct. Do not label every skipped call unknown or successful.
- A detail-only follow-up updates the pending support reference without a second handoff. A read-only policy re-fetch is allowed for this release; do not add persistent KB caching just to satisfy an obsolete tool pin.
- Exercise the handler with a persisted receipt and a fresh structured follow-up. A test that only suppresses the follow-up before extraction does not prove handler deduplication.

C2. Keep image evidence factual:

- A scoped not-found result projects status, scope, retryability and failure kind without the prewritten “team needs to review” sentence.
- Do not send image transport diagnostic prose as conversation guidance when typed image evidence already exists.
- A null/absent handoff outcome never means a team review was requested. A saved pending question only preserves conversation work.
- Image access failure can reuse non-image evidence with the existing bounded retry. It must not repeat uploads, reads, writes, or handoffs.
- Keep native image retention, no image/URL request policy, and silence for image-only turns without a pending task. Do not add a describer or backend batching dependency.

C3. Finish RSVP outcome normalization:

- Keep one verification receipt, not a second contradictory reconstructed backend-success object.
- Project fresh same-event/same-guest attendance observations even for companion-only work whose overall action status is `observed_state`. Keep replay/fresh-read and identity checks.
- Name requested-change verification separately from observed attendance. `false` for “requested attendance change verified” must never mean “guest is not attending.”
- If the companion write says `saved=false`, report rejection and its scoped reason; do not claim either companion or guest registration succeeded from that result.
- If it says `saved=true` but the read API has no companion field, allow reporting what the service acknowledged while distinguishing unavailable independent verification. Do not claim a fresh read verified the companion, and do not reopen verified guest attendance as pending.
- Remove forced human-review/retry instructions derived solely from that read-schema limitation. Offer an available next step when needed; claim an actual handoff only from its receipt.
- Do not relax same-ID checks or require `hasResponded=true` when the host-controlled `willAttend` state is authoritative.

Pass/fail:

- Diana's three-turn thread has one successful handoff total; its detail turn has zero new handoff attempts.
- Success, definitive failure, unknown timeout, skipped capability and missing-phone twins project distinct outcomes and correct retry behavior.
- Unavailable/non-receipt images do not generate a team-review promise without a receipt or a payment approval claim.
- Companion success/rejection/read-unavailable cases contain no internally contradictory attendance claims.

## D. Fix the close schema boundary, not a fallback

Owner: Runtime. Files: `src/runtime/close-flow-schemas.ts`, `src/runtime/extraction-schemas.ts`, `src/runtime/openai-agent-runtime.ts`, `tests/close-void-action-repair.test.ts`, SDK-boundary tests.

- Keep the strict executable `closeActionSchema`.
- The model-wire schema must accept nullable category/reason fields so an incomplete non-effect reaches normalization. The existing post-SDK normalization maps void `clarify` and `defer_need` without category to no executable action.
- Prove this through `createDynamicExtractionSchema` and the installed Agents SDK parser. A direct test of `repairVoidCloseAction` alone is insufficient.
- Preserve fully specified actions unchanged; malformed enums/types still fail. No generated fallback sentence, automatic close, inferred contact, or extra model pass.
- Verify token-seeded close end to end: contact gathering does not submit; explicit final authorization submits once and read/receipt evidence precedes its claim.

## E. Repair evaluation contracts without rewarding bad behavior

Owner: Evaluation. Files: `src/evals/runner.ts`, `src/evals/evaluation-state.ts`, existing typed judge projection, `evals/cases/*.yaml`, `evals/live-behavior-coverage.yaml`, `evals/suites/live_behavior_regression.yaml`, evaluation tests. Do not modify runtime files.

E1. Finish the three in-progress oracle revisions:

- Accountless venue: replace internal-node pin with zero RSVP mutation, preserve mandatory actual venue facts and no OTP.
- Owner payment: accept natural equivalents of “cannot determine/calculate/confirm remaining balance” and brief factual explanations of missing paid amount/currency. Keep no invented balance/currency, no approval, no unrelated cart.
- Diana: permit a repeated read-only policy lookup; forbid repeated takeover using authoritative per-turn effects and whole-thread sum. Do not count a reused receipt as a new effect.
- Add R05 version notes explaining old versus new acceptance; keep old artifacts unchanged. Do not reduce thresholds merely to get green.

E2. Apply the following dispositions to other failures:

| Cases/groups | Required treatment |
|---|---|
| `accountless_event_answer_precedes_remaining_private_auth`, accountless guest | Runtime missing detail/task preemption (A/B); no route-name requirements. |
| `purchase_martha_accountless_selection`, `customer_transaction_reference_unavailable_multiple` | Runtime missing candidate facts (B). |
| `pending_balance_validation_luis`, `image_url_receipt_payment_thread` first turn | Real false remaining-balance risk; validate B, do not soften it. |
| `image_distractor_history_preserves_current_question` | Actual native image plus forced ambiguity (A/C). |
| `image_url_unavailable_evidence`, `image_non_receipt_payment_claim`, `continuity_voucher_then_thanks`, `native_image_long_thread` | Fail invented team action/payment approval. Do not require a repeated philosophical disclaimer when the answer already makes the factual limitation clear. |
| `continuity_text_image_same_turn` | Verify judge receives fixture image truth bound to the actual attached source. Do not infer hallucination from judge-blind pixels. |
| `continuity_question_needs_image`, `image_too_large_fallback`, `image_unavailable_captioned`, `image_expired_reference_resubmit` | Remove any remaining requirement to request images/URLs/transcription. Evaluate current task/evidence and useful truthful limitation; no mandatory greeting, phrase order, or needless question. |
| `rsvp_confirmed_state_is_reported`, `rsvp_jose_campaign_invitation_not_reported_missing` | Existing attending-state answer passes without explicit “I did not write” recital or optional date. Wrong polarity/date and false new-write claims fail. Existing v7 revisions must remain. |
| `rsvp_declined_state_offers_one_change` | Correctly answering declined status passes without mandatory question-form upsell to change it. An actual new decision still requires verified execution. |
| `rsvp_host_set_declining_consistent` | Two real same-name guests may require distinction; expose grounded alternatives and existing states. Do not collapse identity to force one answer. |
| `rsvp_ambiguous_event_requires_grounded_selection`, `rsvp_missing_action_requires_explicit_decision` | Remove node pins and contradictory pending-state fixtures. Preserve no unauthorized writes, correct candidate identity, and current backend polarity. |
| `rsvp_cinthya_campaign_invitation_not_reported_missing`, `rsvp_cristian_phone_enriched_confirmation` | Verify outbound campaign/history fixture exists. No fixture-supplied background may be assumed visible if never sent. Preserve truthful existing state; no forced planning restart. |
| `rsvp_plus_one_uses_phone_scoped_mutation`, `rsvp_plus_one_not_eligible_no_false_success` | Align with C3: acknowledged companion save versus fresh read scope, rejection remains hard. Do not demand independent verification of a field absent from the read API. |
| `roberto_reminder_invitation_disagreement` | Campaign proves a reminder, not a located backend invitation. A confirmed handoff allows “requested,” never an invented guaranteed future registration. |
| `purchase_explicit_time_alternatives` | Correct registered 21:31 without conversion passes with harmless additional recorded date; unknown timezone must not become a claimed local timezone. No exact wording or unnecessary disclaimer requirement. |
| `active_cart_checkout_continuity_alex` | A correction acknowledgment need not repeat every previously stated checkout fact. Wrong order/cart identity or invented payment requirement still fails. |
| `customer_transaction_reference_matched` | Check the actual scoped data before judging absent delivery information. Omission of irrelevant delivery detail passes. Do not license unsupported absence claims. |
| `otp_nondelivery_auto_resends_once`, `otp_terminal_handoff_failed`, `phone_confirmation_unclear_requires_yes_or_no` | Reconcile user-provided pending question and actual tool facts with judge evidence before calling them hallucinated. User text is provenance, not proof of backend state. |
| `otp_not_received_requires_response`, `otp_terminal_handoff_unavailable`, `otp_sent_explains_image_limitation` | True pending auth/handoff outcomes must survive; do not ask an already resolved question, promise unavailable handoff, or globally claim image incapability. Prefer outcome/module correction over more global rules. |
| `owner_planning_to_faq_single_transfer`, `host_withdrawal_pending_event_followup` | Judge must see the same sourced policy facts as the reply. Policy numbers absent from all authorized evidence remain a real defect. |
| `maria_paz_current_reminder_explanation` | Preserve relative-time meaning from campaign provenance. A past/future reversal is factual, not stylistic. |
| `ambiguous_confirmation_adversarial_selection` | Multiple unresolved providers must not be silently selected; this shared authorization invariant remains mandatory even with planning-quality waiver. |
| `s4-injected-renderer-prose-fails`, `token_fresh_multifront_stays_multi_need` | Distinguish harmless card preference from actual output-origin mismatch or blank required delivery. Never waive unexplained modified/blank output as planning style. |
| `provider_reference_cheaper_option`, `reset_plan_discards_stored_context`, `wedding_planner_location_completes_search` | Planning quality is diagnostic. Still review their evidence for cross-customer disclosure, unauthorized action, false effect or shared delivery failure. |
| `token_seeded_close_flow` | D; shared transport/effect integrity remains mandatory. |

For every changed oracle, record the actual answer, available evidence, old defect, new acceptance and a failing counterexample. Do not bulk-rewrite all semantic rubrics. Do not make a runtime bug pass by deleting its required fact.

E3. Add exactly one new permanent multi-turn integration case:

File `evals/cases/live-behavior-customer-event-task-continuity.yaml`; ID `live_behavior.customer_event_task_continuity`; fixture `rsvp-plus-one-multiple-pending`; trusted phone `+51941438999`; one session across all turns.

1. Ask when Boda Ana y Luis is. Expect its 2026-09-20 18:00 facts, zero writes.
2. “Confirmo mi asistencia al Cumpleaños Marta. ¿A qué hora es?” Expect only Marta's RSVP write, one success, same guest/event fresh read, and 2026-09-21 19:00; one combined reply, no forced choose-first question.
3. “¿Y a qué hora era la Boda Ana y Luis?” Expect Ana's 18:00, zero new writes, no Marta facts attributed to Ana.
4. “Gracias.” Expect silence or a brief natural closing, zero reads/writes that restart the resolved task.

Add hard per-turn effect/identity assertions and `text_semantic` with `requireJudge: true`. Use an offline service twin with gateway capture to prove exact guest/event IDs; semantic judge alone is insufficient. Register in the mandatory suite and coverage registry. Update support manifest: expected total 119, support 111, planning-only diagnostic 8 if the catalog has not changed. Compute and assert actual counts rather than hardcoding a stale count into reports.

E4. Keep the s17 correction narrowly scoped:

The model can state that a receipt alone does not prove approval without reading a purchase. The twin must also prove this does not synthesize a completed purchase, approve payment, or mark a record read as performed. A stored image reference is not proof of pixels being available.

E5. Harness execution requirements:

- All backend operations in live cases are fixture-owned. Live Lambda/OpenAI are intentionally real; external customer systems are not.
- Verify all selected cases have complete fixtures and isolated identities before any model call. Fail preflight on missing fixtures; never silently fall through to real backend data.
- Set the existing coordinator host requirement for the entire invocation. Do not delete coordination or run many independent case commands.
- Preserve authoritative effect receipts across identity remapping and trace cloning. Judge evidence includes policy, purchase, event, image truth and delivery outcomes without creating facts.
- Keep the bounded 4-case / 1 external lane / 2-judge scheduler. One invocation, no semantic retry, current transient transport retry policy only.

## F. Validate, freeze, run once, release

Owner: Coordinator. No new architecture or oracle work after freezing a candidate for a gate.

F1. Close offline gaps before spending:

- Update stale RSVP tests to assert `verification.gateway_status` and the single authoritative outcome, not the deleted duplicate `backend_result.status` or ambiguous `attendance_confirmed` field name.
- Preserve fresh-read identity/replay tests while allowing observed attendance to update on matched companion-only reads.
- Finish B0/B1: complete canonical authorized profile, no duplicated facts, and stable instruction/tool selection when other customer records change. Update obsolete hidden-fact expectations explicitly.
- Add focused tests for A2 mixed read/action, A3 role-only neutral request, C1 repeated handler entry/unknown/failed receipt, C2 not-found actual request, D SDK parsing, and candidate dates/totals.
- Run typecheck, changed-line lint, touched suites, coverage registry, then complete offline suite once. Diagnose remaining failures from their actual assertions. Do not call them pre-existing without a clean-reference reproduction.
- Measure instructions, input, tools, schema and total serialized bytes separately on actual extraction/reply construction for: initial role correction, venue-only, payment-only, mixed event/payment, RSVP+time, unavailable image, and resolved purchase with unrelated-history variation. Store before/after numbers. Additional authorized profile fact bytes are expected; unrelated instructions, duplicated entities/outcomes and category appendices are not. Report profile bytes separately so instruction savings are not concealed by richer evidence.
- Commit runtime changes atomically by responsibility, then tests/evaluator revisions and coverage using actual implementation SHAs. Log the reasoning and validation in `docs/implementation-log.md`. No HEAD placeholders or fabricated hashes.

F2. Deploy development exact bytes:

- Use only `se-dev`, `us-east-1`. Check STS account `684516060775`; refresh only through `aws login --profile se-signin` if needed. No fallback profile.
- Capture current dev and production CodeSha, function/stack status, source SHA, clean tracked status, fixture/evaluator/model identities.
- Deploy via the repository CloudFormation workflow with `DEPLOYMENT_ENV=development`.
- Hash and retain the exact deployment ZIP; capture resulting CodeSha and stack completion. URL 401 is only a reachability check.
- Do not regenerate production ATC vectors. If factual KB parsing works against the current index, index regeneration is not a prerequisite. Any actual KB data change requires a separately versioned candidate and evidence.

F3. Preflight offline; no live diagnostic panel:

- Run fixture coverage/isolation, suite loading, exact case selection/count, judge-evidence projection, effect-ledger remapping, configuration and scheduler tests using mocks.
- Exercise the 16 high-risk scenarios listed below as offline service/request twins, not separate live probes: accountless venue, mixed event/payment, new four-turn customer continuity, Diana, owner payment, Luis unknown balance, Martha selection, unavailable transaction reference, unavailable image, image distractor, companion rejection, companion acknowledgment, host-set declining, unmatched event, failed OTP handoff and token-seeded close.
- Verify all of those live cases are included in the full suite before launch. Resolve AWS identity, model credentials/configuration, fixture completeness, current deployment identity and output artifact paths without generating a model response.
- Freeze source, evaluator, fixtures, model configuration and exact ZIP. No edits during the live run.

F4. Spend the single live invocation on the full mandatory suite:

Use the existing coordinator host and account guards. Run `npm run eval:behavior-live -- --label final-customer-support --case-concurrency 4 --judge-concurrency 2` once with `EVAL_COORDINATOR_HOST` set to the actual hostname, `AWS_PROFILE=se-dev`, and `AWS_REGION=us-east-1`. Do not pass a case subset. Execute the updated entire mandatory suite, including the new mixed-task case, on the frozen artifact. The expected count is 119 unless reconciled catalog changes prove otherwise.

Record support, planning-diagnostic, structural, semantic, error and delivery results separately. Inspect stored requests and effect/delivery evidence from this same run to adjudicate failures. Do not make further generation calls to investigate, rescore old runs, start another panel, or rerun the gate. Preserve the existing bounded transient transport retry policy inside this one invocation; no semantic retry is permitted.

If the invocation fails operationally, preserve its partial artifacts and stop. A replacement invocation requires a new explicit user budget authorization; do not spend it automatically.

A matched historical baseline is useful but not required for this explicitly risk-accepted release. Record it as NOT RUN and make no claim of comparative improvement. This amends the former baseline prerequisite only; it does not waive evidence of present correctness. Do not spend on baseline redeployment during this package.

F5. Release criteria:

- All selected cases executed, no skips, no unexplained transport or generation errors in customer/shared paths.
- Zero duplicate effects, unauthorized reads/writes, guest/event/customer identity mixing, false payment approvals, fabricated action confirmations, or unexplained required-delivery blanks.
- The new four-turn customer case and actual-request relevance/completeness checks pass, with any evaluator-only disagreement adjudicated from this run's actual facts and receipts.
- Remaining red cases are individually adjudicated as planning-only quality, a demonstrated evaluator-evidence defect, or harmless language/completeness preference. Missing requested actionable facts are not a style waiver.
- Each exception lists case ID, delivered answer, source facts, effects, reason and residual customer impact. Keep the full aggregate red if that is the recorded result.
- Current user authorization permits promotion under these criteria despite red aggregate status; do not ask for another general permission.

If criteria hold, promote the exact tested ZIP with its SHA using the existing production deployment path (`DEPLOYMENT_ENV=production`, `DEPLOY_ARTIFACT_PATH`, `DEPLOY_ARTIFACT_SHA256`). Preserve production credential bindings and verify any required plans-table IAM permissions through CloudFormation before invoking new RSVP receipt writes. Do not copy development secrets or fixture settings into production.

Capture production BEFORE/AFTER CodeSha and stack completion; require AFTER to match the tested artifact identity. Keep the Sept 10 ZIP/hash/config identity recoverable for rollback. Perform non-mutating production health/config checks; do not issue real customer writes as a smoke test. On deployment/config failure, restore the recorded prior production artifact/config through the same deployment mechanism and report it. Do not claim success from a health URL alone.

If criteria do not hold, stop paid runs, retain production, and deliver the exact failed invariant and evidence. Do not invent a claim of “100% complete” or begin an unbounded new architecture round.

## 4. Final deliverables

1. Atomic implementation commits and actual-SHA coverage entries.
2. Updated implementation log, this package annotated with completion/evidence, and the frozen 119-case manifest (or reconciled actual count).
3. Before/after actual-request byte and relevance measurements.
4. Offline results, the single full-suite run artifacts and per-case release adjudication; no live panel or baseline run.
5. Exact source/evaluator/fixture/model/ZIP/development/production identities.
6. Promotion evidence and rollback identity, or one precise unmet release invariant. No pending implementation choices for another agent.

## 5. Start instruction for the implementation agent

Read `docs/plan/2026-09-09-lean-conversation/customer-support-release-work-package-2026-09-16.md` and the actual working diff. Continue the existing partial changes; they are not deployed or complete. Execute A–F in dependency order, with runtime and evaluation ownership separated if delegating. Treat RSVP as customer work and evidence, not a competing conversation owner. Complete the offline regressions and actual SDK/request checks, freeze and deploy exact development bytes, run the full suite exactly once with no preliminary live panel, baseline run, or semantic retries, adjudicate remaining red cases honestly, and promote the identical artifact when F5 holds. The user authorizes that promotion despite planning/style-only red; do not ask again. Preserve production otherwise, never relax identity/effect truth, never retry semantics to obtain green, and never introduce fixed conversational replies. Report evidence and completed work, not another proposed plan.
