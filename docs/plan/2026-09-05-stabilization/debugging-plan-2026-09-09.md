# Implementation plan: nine live-gate failures and fixture validity

Decision: repair the test worlds first, wire terminal authentication policy through every continuation path, then fix the two demonstrated conversational-routing defects. Preserve human-first recovery, one-shot OTP, development write isolation, and hard semantic gates. Do not increase score tolerances or rewrite product behavior to satisfy stale rubrics. No upstream change is required or proposed for this work.

This document is the implementation contract. It supersedes the nine-failure brief's hypotheses where evidence below contradicts them. Runtime/test edits, deployment and new live generations are not part of this audit; the implementation remains to be done.

## Evidence and limits

- Saved run: `.eval-runs/eval-2026-09-09T13-05-03-835Z-f8bf0fc1/`, report, results and all nine per-case artifacts inspected. Result: **67/76 passed, 9 failed, 0 errored, 0 skipped**.
- Candidate `538169a2` is recorded in the implementation log and supplied brief. The run used an uncommitted tree; this audit does not establish a full content digest or equate Git HEAD with that artifact. Current branch is `dev`, based on `452d8df7`, with other-session changes preserved.
- Read-only retrieval of stored OpenAI extraction responses confirmed the actual ambiguous-confirmation and mailbox outputs. Read-only retrieval of the transaction-code reply input confirmed `referenceResolution: unavailable`.
- Focused offline validation during this audit: **51 passed, zero failed/skipped**, across `f1-otp-terminal-handoff`, `f3-ambiguous-confirmation`, `s02-fixture-simulation`, `eval-fixture-gateway`, `semantic-judge`, `eval-live-target`, and `live-behavior-coverage`. Local report: `/tmp/recap-debug-plan-checks.json`; a durable summary accompanies this plan.
- An isolated in-memory fixture probe reproduced: configured `failed` returns `failed` then `success`; configured `unknown` returns `failed` then `success`. No backend/customer write occurred.
- Full plans are used in memory for assertions, but saved artifacts contain `plan_summary` and `auth_evidence`, not a recoverable full handoff receipt. `projectSafePlan` now nulls that receipt. The live target only reads DynamoDB when the response omits a plan; it does not unconditionally hydrate every response. Do not claim receipt inspection from these JSON artifacts.
- Saved trace fields do not establish every pre-dispatch reason. The conclusions below distinguish observed output/state from source-derived causes. Additional live runs are unnecessary to identify the demonstrated boundaries.

## Case-by-case disposition

All turn indices below are zero-based. Keep existing incident IDs for continuity; bump versions/descriptions and add companion IDs where specified.

| Case suffix | Fixture/contract validity | Observed cause | Binding decision |
|---|---|---|---|
| `phone_account_rejection_requests_email` | Invalid policy oracle; no fixture. The input resolves an environment phone, but development real writes are disabled. | Auth status cleared, pending question preserved, handoff not attempted. Email-demanding judge scores 0.02. | Version to human-first. Add an explicit successful isolated fixture and trusted inbound phone. Add a separate blocked-write world that expects truthful non-success. Never restore automatic email recovery. |
| `otp_not_received_requires_response` | Invalid success setup: no fixture, while requiring real handoff success. Environment-variable absence would throw, not silently send null; run had no errors and phone presence is true. | No takeover call; status `none`. The real-development manifest disables the write, so the success expectation is unsatisfiable on that configured path. | Freeze successful and unavailable handoff worlds separately. Preserve the legacy exhausted seed as an incident replay, not permission for two future sends. |
| `repeated_otp_failure_preserves_gift_query` | Fixture verify rejection/successful handoff is declared, but inputs omit `contactPhone`; a phone only in `seedPlan` is not trusted inbound identity. Also requires the handoff tool on turn 1 although policy requires it on turn 0. | Both first turns report failed handoff with attempted=false; turn 2 offers retry/resend. No second verification call occurs. | Add trusted phone to all three turns; require first-turn verify+handoff, forbid later dispatches. Independently fix terminal continuation after failed/unavailable/unknown handoff. The turn-2 conversational OTP loop is a real product defect even without another API call. |
| `otp_nondelivery_auto_resends_once` | Fixture is loaded and defaults to successful takeover. Structural assertions pass. | Judge 0.65 demands explicit completed transfer/team ownership beyond “support requested.” | Make fixture handoff success explicit. Rubric requires a confirmed request, not a guarantee that a human has joined. Keep no-resend/no-OTP rules and threshold 0.9. |
| `phone_purchase_missing_hands_off_once` | Executable fixture, but description says empty successful lookup while current gateway maps the empty collection to `not_found`. Handoff succeeds; next turn suppresses correctly. | Generic handoff response omits lookup limitation. Judge 0.35 follows a legitimate scoped-explanation requirement. | Keep that requirement. Add a route-specific, bounded “could not locate your purchase in this lookup” explanation before successful handoff text. Do not repeat the full pending question, deny existence globally, or restore authentication. |
| `mailbox_issue_deferral_and_clarification_preserve_support` | Valid support scenario; unrelated purchases exist as distractions. Missing hard prohibition on unsolicited takeover allows the mistake before semantic checks catch it. | Stored extraction has `supportAct={report_issue,mailbox_capacity,mailbox_full}` **and** `actionIntent=solicitar_humano`; no requested operation. Runtime takes explicit-human lane, then suppresses later turns. | Add explicit human-request evidence and deterministic arbitration. A mailbox report alone is support acknowledgement. Do not turn off human help for explicit requests. Also assert the untested initial greeting does not introduce a provider plan. |
| `ambiguous_confirmation_clarifies` | Seeded two-provider shortlist is sufficient; no backend operation is needed. Offline twin differs from live output. | Stored extraction is null intent, clear ambiguity, no deltas, **phoneConfirmation=unclear**. `hasNoConfirmationDelta` requires null, so guard fails. | Treat `unclear` as non-actionable phone evidence; route scoping must also remove phone-auth fields outside relevant auth/information states. Preserve the shortlist and ask the existing focused clarification. No keyword matcher. |
| `customer_transaction_code_by_phone` | Unfrozen real read and obsolete branch-conditional rubric. Stored model input confirms unavailable reference, trace shows one result. | Reply answers unique purchase status; judge demands code echo/selection despite unavailable-reference policy. | Freeze unavailable-unique, matched, and unavailable-multiple worlds. Unique unavailable world accepts grounded status without code echo or manufactured uncertainty. Matched world verifies match structurally; never force redacted identifiers into text. |
| `roberto_reminder_invitation_disagreement` | Fixture correctly supplies reminders and absent invitation; handoff succeeds. Rubric's “no RSVP vocabulary” is ambiguous versus literal acronym ban. | Judge 0.55 objects to “confirmar tu asistencia,” rather than registration. That phrase is in fixture history; the saved candidate quotes “Confirma aqui.” No attendance write occurred. | Define forbidden jargon as literal RSVP acronym and forbidden claim as attendance successfully registered. Ordinary Spanish attendance language and quoting a reminder are allowed. Add real-effect and persisted-state assertions; do not rewrite truthful product output for this judge error. |

## Fixed product contract

1. Trusted contact identity comes from the inbound channel adapter. A seed or model-extracted `plan.contact_phone` cannot authorize takeover. Fix defective fixture inputs, not this trust boundary.
2. First rejected verification, first non-delivery, resend request after an attempted send, or verification refusal ends that authentication episode. No automatic resend, new email prompt or second verification. OTP remains last resort for an explicitly chosen, eligible account/resource combination.
3. Terminal authentication and successful takeover are separate states. Terminal recovery stays terminal even if human help is unavailable, failed or uncertain. Do not soft-pause ordinary unrelated questions after a failed handoff; acknowledge protected-query continuations truthfully without reopening auth.
4. Only a confirmed gateway success sets requested/soft-paused and permits “support requested.” Uncertain effects remain uncertain and are not automatically retried. A definitively failed request may retry only after a new inbound message explicitly authorizes human-help retry; that never renews the OTP budget.
5. A mailbox issue does not itself request a person or any unsupported mutation. An explicit human request does. Dynamic capabilities may trigger help for a genuinely requested unsupported operation, never merely for a symptom/report.
6. An unavailable customer reference is not a code match. A unique phone-scoped purchase may still support a status answer. Multiple candidates require one grounded selection question. No latest-order heuristic, hidden IDs or invented currency.

## Work package A — fixture correctness and evidence, owner: evaluation implementer

Complete before product work is accepted. Files: `src/runtime/eval-fixture-gateway.ts`, `eval-fixture-state.ts`, `src/evals/targets/live-lambda.ts`, `runner.ts`, `case-schema.ts`, `evaluation-state.ts`, and corresponding fixture/runner tests.

### A1. Declare complete worlds

- Add `evals/fixtures/s06-identity-rejection-success.json` with explicit `handoff.status=success`. Point the existing phone-rejection case at it; replace environment contact with fixture-only `+51900000901` on every turn. Preserve the seeded invalid prior authorization and event question. Declare empty history/lookups where relevant.
- Add `s06-otp-exhausted-success.json` with explicit successful handoff and use `+51900000902` for the existing missing-code case. Keep seed sends=2/reports=1 only as already-consumed legacy state. New behavior must not produce these counts from an empty episode.
- In the existing repeated-failure case, set `channel: whatsapp` and `contactPhone: +51900000903` on **every** turn. Use the same phone in the seed for consistency, while proving it is the inbound value that authorizes the write. Keep the verification outcome rejected. Set `otp_send_attempts=1` explicitly.
- Add explicit `handoff.status=success` to the nondelivery fixture and pin that case's inbound phone to `+51900000904`.
- Keep existing subject phones for mailbox, missing purchase and Roberto, because their fixture dictionaries are keyed to those values. Make their handoff outcomes explicit. Mailbox must not call it despite success being available.
- Add `s06-otp-handoff-failed.json` and `s06-otp-handoff-unknown.json`: same rejected verification world, with the respective handoff outcome. For blocked/unavailable capabilities use an isolated fixture manifest with `human.takeover.write` disabled; add a typed fixture `disabledOperations` list and validate operation IDs. Never enable real development writes to make a test pass.
- Add a no-trusted-phone companion with no inbound phone and a phone in the seed. Expect no dispatch and `missing_identity`; no claim of help requested. This is the negative test for the repeated-OTP fixture mistake.
- Existing original IDs remain in `live_behavior_regression`; new companion cases also receive hard structural expectations and hard semantic judges. New cases use IDs ending `otp_terminal_handoff_failed`, `otp_terminal_handoff_unknown`, `otp_terminal_handoff_unavailable`, and `otp_terminal_missing_trusted_phone`.

### A2. Correct simulated effect replay

`requestHumanTakeover` currently checks the count before the configured result, then returns success on any replay. Return the stored outcome, not an invented successful outcome. Failed stays failed; unknown stays unknown; successful stays successful. A replay is recorded as a replay, not another successful dispatch. Also isolate cached state by run, case and operation; a new run starts with zero attempts.

Represent uncertain effect outcome as a typed discriminant end to end. Do not encode `unknown` only inside an error string or map it to definitive `failed`. Add `outcome: 'failed' | 'unknown'` on the failed gateway-result branch, populate it in fixture and real transport adapters, and make `applyHandoffResult` consume it. A timeout after dispatch is unknown; an explicit rejection is failed. All callers must exhaustively handle this field. Do not introduce retry behavior.

Mandatory offline truth table: first/replayed success → success/success; first/replayed rejection → failed/failed; first/replayed unknown → unknown/unknown; disabled → no dispatch. Assert independent effect counts and persisted receipt outcome. Block all unconfigured external effects in these focused fixture worlds with recording fakes; a fixture may not fall through to a real mutation.

### A3. Count effects, not narration

`tool_usage.mustCall` checks membership, not exact count or real dispatch. `retainTerminalOtpHandoff` currently adds fake takeover input/output for an already-requested effect. Remove that record. A retained decision belongs in diagnostics, not `tools_called`.

Add a hard `fixture_effect_count` expectation to eval schema/runner with `operation`, optional `turnIndex` (default final turn), `expectedAttempts`, `expectedSuccesses`, and `expectedReplays`. Capture cumulative per-turn fixture receipts using the existing run/case state store in the live target. Count non-replayed dispatches as attempts and confirmed non-replayed successes as successes. Missing receipt evidence fails the assertion; it is not zero. Keep receipt IDs, arguments and phone numbers out of artifacts and judge input. Counts and outcome enums suffice.

For the repeated-OTP success world: turn 0 has verify attempts=1 and handoff attempts=1/successes=1; turns 1–2 have unchanged cumulative counts, zero replays, and no verify/send/handoff tool records. Final OTP send count stays at the seeded consumed budget; no new send effect is allowed. Apply the same one-effect assertion to Roberto and missing purchase.

## Work package B — fixture-aligned oracles, owner: evaluation implementer

Do not lower `minScore: 0.9`, remove `requireJudge: true`, skip cases, or turn hard assertions soft. Move state requirements out of prose into structural checks and clarify what language is required. Use these replacement semantic contracts verbatim in English; product examples remain Spanish.

- **Identity rejection / success:** “The user rejects the previously associated account. In Spanish, acknowledge that access through that association will not continue and say human help has been requested. Do not ask for email or OTP, claim authorization succeeded, or disclose the protected event answer. The pending question is retained in state; it need not be repeated in the response.” Add hard token=null, auth_method=null, status=none, pending-query preservation and successful effect count. Assert the earlier token value is absent from every exported diagnostic.
- **OTP handoff / success:** “The authentication episode has ended and the handoff gateway confirmed the support request. In Spanish, say human help has been requested. Do not offer another code, resend, email change or authentication attempt, claim authentication succeeded, or answer the protected question. It is not necessary to say a person has already joined or to repeat the pending question; state assertions verify preservation.” Apply to nondelivery and repeated-failure **turn 0**, not turn 1. Later successful-handoff turns may be empty because the bot is paused; any emitted reply must not reopen verification.
- **OTP unavailable/failed/unknown companions:** Require the corresponding truthful lack of success/uncertainty, no claimed transfer, no verification invitation, no protected answer and no automatically repeated effect. Give each of all three follow-up turns its own hard semantic expectation; a structurally non-mutating but conversational resend invitation must fail.
- **Missing purchase:** “The scoped lookup could not locate this purchase. In Spanish, briefly explain that limitation and that human help was requested to continue this purchase query. Do not claim the purchase does not exist globally, assert payment status, ask for email or OTP, or guarantee response timing. The full pending question need not be repeated.” Add an explicit expected `not_found` execution outcome, matching the current fixture adapter, and a separate successful-empty-array adapter twin.
- **Roberto:** “In Spanish, acknowledge the supplied Cumple Marcelo reminder and explain that this lookup cannot verify the invitation now. Since the fixture confirms a successful human-help request, the response may say that support was requested. It must not say attendance was registered, deny the invitation exists, or use the literal technical acronym RSVP. Ordinary Spanish words about attendance or confirmation, and quoting the supplied reminder, are allowed. No assistance link is required; any link shown must be present in the trusted fixture. Judge the candidate's claims, not phrases appearing only in context.” Keep the literal acronym assertion and no-guest_rsvp assertion. Add pending attendance unchanged and handoff success/count assertions against actual owning state.
- **Mailbox:** Keep existing relevant semantic requirements. Add no-takeover, no OTP and no unrelated purchase/FAQ calls on turns 1–3; assert no requested handoff. Turn 2 suppression is allowed; turn 3 must acknowledge the clarified full mailbox because turn 1 acknowledgement leaves that issue active. Add turn 0: a brief context-appropriate greeting is allowed, provider-plan questions and unverified receipt/payment claims are not.
- **Ambiguous shortlist:** Keep existing rubric. Make the node hard `aclarar`, selected IDs empty, shortlist IDs unchanged, no provider search/detail/quote effects, no close. Add a hard semantic judge even to adversarial extracted-state companion cases.

## Work package C — terminal auth integration, owner: runtime implementer

Files: `src/runtime/agent-service.ts`, `information-auth-state-machine.ts`, `human-help-policy.ts`, `src/core/plan.ts`, relevant gateway adapters, and `tests/f1-otp-terminal-handoff.test.ts` / `s06-information-auth.test.ts` / service tests.

1. Use the existing `InformationAuthRecoveryState` and monotonic merge policy as authority. Persist a typed `auth_recovery` field on the plan: `sendAttempted`, `verificationAttempted`, `terminalReason`, `challengeEmail`, `challengeRequestedAt`, `preservedRequest`. Put its schema/type in core and import it from the policy module; avoid core→runtime imports. Seed existing `user_auth` evidence through the existing normalization function once, then merge monotonically. Redact email and preserved private context from exports; expose only budgets, terminal reason and request count in diagnostics.
2. Check terminal recovery after typed extraction/normalization and before email/OTP recovery, regardless of `human_escalation.status` and regardless of whether the input contains six digits. Protect explicit identity rejection and verification refusal precedence. An unrelated public question may route normally; it must not clear the terminal recovery record.
3. First invalid verification persists terminal recovery **before** attempting handoff. Failed/skipped/unknown handoff cannot reset it. Subsequent code and “Ese es el código que me llegó” both retain terminal state without verify/send or retry copy. Remove the generic `otp_invalid`/`otp_pending` recovery branch for already-terminal episodes; only a still-valid, unconsumed episode may ask for its first code.
4. Preserve recovery and handoff deduplication across event-plan reset and session changes. Refusal closes the protected request but does not renew the budget. Human-help explicit retry changes only the help effect, never OTP eligibility.
5. Retain only trusted inbound phone resolution. Persist the attempted/skipped decision reason even when no receipt exists; do not fabricate a receipt for an unattempted effect. Requested=false and softPaused=false for failed/unavailable/unknown.
6. Tests: the complete three-turn incident under success, rejection, unknown, disabled capability and missing trusted phone; conflicting support detail plus identity rejection; legacy exhausted seed; reset after failure; unrelated FAQ after failed handoff; explicit retry of definitively failed human help once; unknown never automatically retries. Every variant asserts prompt/output cannot offer another OTP and counts actual gateway calls.

## Work package D — grounded route selection, owner: conversation implementer

### D1. Ambiguous confirmation

Change the no-delta predicate so `phoneConfirmation='unclear'` is equivalent to absent decision. `yes`/`no` are actionable only where typed auth state makes them relevant; a verified identity rejection must still win over provider clarification. In extractor projection, omit phone-auth guidance/fields from pure shortlist selection with no protected request or active phone-auth decision. Do not add a generic “Sí confirmo” keyword branch.

Add the exact stored-output offline twin: null intent, `ambiguity.clear`, `phoneConfirmation.unclear`, all provider/info/contact deltas empty, two providers unselected. It must return the existing “¿Qué proveedor o acción estás confirmando?” and never call the reply model with provider tools. Pair with named-provider selection, actual location refinement, public FAQ, phone rejection in an active protected context, and a one-provider state. Keep their legitimate routes.

### D2. Mailbox and human help

Add structured extraction `humanHelpIntent: 'none' | 'request' | 'accept_offer' | 'retry' | 'decline_offer'`. Emit it from relevant support/capability extraction, with `accept_offer` valid only when a typed offer is pending. Derive explicit-human routing from this field; `actionIntent=solicitar_humano` alone must not override `supportAct` without that evidence. Separate deterministic recovery escalation for exhausted auth/unsupported requested operations from explicit-human intent.

Support-profile prompt must distinguish reporting a full mailbox from asking for a person. Move the existing mailbox rule out of auth-only `auth_control.txt`, which is not loaded in this no-protected-request turn. Do not indiscriminately append auth instructions to every turn. Non-auth human-help replies must not mention OTP/email verification; select route-specific outcome copy.

Replay the exact conflicting extraction (`report_issue/mailbox_capacity/mailbox_full`, solicitar_humano, requestedOperation=null) with humanHelpIntent=none and verify support wins. Add explicit “Quiero hablar con una persona sobre mi correo lleno” with humanHelpIntent=request and verify one handoff. Add an active offered-help acceptance and a refusal. Preserve the four-turn mailbox interaction as the live case.

### D3. Missing-purchase explanation

Add a scoped successful-handoff variant for `reason=phone_information_not_found`. Example product copy: “No pude localizar tu compra con este número en la consulta disponible. Ya solicité apoyo humano para revisarla.” Select it from the typed lookup reason and confirmed effect outcome. Failed and unknown variants must explain both the lookup limitation and the truthful help outcome. Keep generic auth-terminal replies free of purchase facts and preserve the question internally.

## Work package E — transaction-reference worlds, owner: purchase/evaluation implementer

Use `guestOrders` fixtures with one explicitly modeled pending/completed collection and no carts. Pin a fixture-only inbound phone and use the existing canonical normalizer. Create:

- `s13-reference-unavailable-unique.json`: exactly one approved order, fixture event `Evento de prueba A`, code fields absent, amount/currency absent. Existing incident ID points here. Require one trusted-phone lookup, one candidate, `referenceResolution=unavailable`, no auth/selection request, Spanish grounded approval without code-match claim. Code echo is not required.
- `s13-reference-matched.json`: two orders for distinct fixture events A/B; only A has customer transaction number `301816`, B has `301817`. Input remains COD301816. Assert selected candidate alias A and `matched`; reply answers A, not B. Internal order IDs must never render. A permitted customer-reference echo is optional; match correctness is structural.
- `s13-reference-unavailable-multiple.json`: two orders, neither has customer transaction numbers; distinct event/status and authorized total/currency for disambiguation. Assert unavailable, two candidates, no write/automatic selection, and one concise selection question with grounded public labels. No invented match.

Keep backend numeric IDs separate from public transaction numbers in fixtures. Make the fixture adapter contract test assert these fields survive normalization and that requested customer reference is not accidentally treated as an internal ID filter. Add the two new cases with suffixes `customer_transaction_reference_matched` and `customer_transaction_reference_unavailable_multiple`. Existing unique case bumps version and removes the abandoned-cart claim unless actual cart history is explicitly supplied (this plan does not supply one).

## Work package F — trace/judge repair, owner: evaluation implementer

Implement bounded typed packets at the decision/effect boundary, outside model inputs:

- Extraction: actionIntent, humanHelpIntent, phoneConfirmation, support kind/topic/detail, auth-action enum list, requested operation, effective extraction profile, rejected field reasons.
- Auth/help: terminal reason, consumed send/verify counts, trustedPhonePresent, manifest availability/reason, gateway kind, decision action/reason, attempted, gateway outcome, persisted requested/softPaused, dedupe disposition. No raw phone, email, credential, receipt string or physical key.
- Purchase: reference supplied, resolution, candidate count, selected per-turn alias, authorized field-presence flags. Do not log raw amounts/customer references just to debug selection.
- Effects: operation, cumulative dispatch/success/replay counts, outcome and receipt-present boolean, fixture scenario/version/digest. Unknown/not-emitted is never fabricated zero.
- Reply: renderer ID, branch reason, current instruction/input byte counts, final text digest.

Preserve packets identically through Lambda → live target → report. Keep the existing maximum 8 KiB diagnostic envelope, 16 call summaries and 8 candidate details; overflow removes candidate detail first and sets truncation facts. Validate schema/version and tool allowlists on every export; a caller's projection version is not permission to expose an unknown tool. Add double/triple-projection and forged-summary tests.

Fix judge context selection: `resolveEffectiveFixtureScenario` currently walks backward to a previous turn override, while live dispatch uses only the selected turn override or case fixture. Use the **same per-turn resolver** in both paths, with no carry-forward of a prior override. Test override A on turn 0, absent override on turn 1 → case fixture B; no case fixture → real/no-fixture at turn 1. For these nine frozen cases, every effective turn must resolve to its declared world.

The judge must distinguish candidate response, preceding assistant responses and fixture history. It must not attribute a phrase from history to the candidate. Remove the instruction treating a tool-name entry alone as proof of an actual effect; verified effect counts/outcomes and state take precedence. Preserve unavailable-reference policy and do not demand redacted code echo.

Hash the exact serialized request sent to the judge (after all redaction), candidate text, rubric/version, structural evidence and model/config. Persist digests and returned rationale/score with each semantic assertion, plus case/fixture/source artifact digests. Validate judge JSON strictly: malformed score/reason, missing response or skipped judge is a failed gate, never a default pass. Add mocked judge-request tests for context isolation and digest changes. Do not repeatedly sample judges until a case passes; retain failed runs and fix the specific contradiction.

## Integration order and acceptance, owner: integrator

1. Preserve the current tree and its new prompts. Record a clean commit for each work package and source/fixture hashes; do not reset unrelated work. A and B establish executable tests; C and D consume those tests; E and F can be developed independently after A's effect contract is fixed. One integrator owns shared `agent-service.ts` edits to avoid conflicting patches.
2. Register every behavior-affecting change separately in `evals/live-behavior-coverage.yaml`: terminal recovery regardless of help outcome, real-effect trace/deduplication, contextual phone confirmation, explicit-human support arbitration, scoped purchase limitation rendering, and each reference world/policy change. Use actual implementation commits and mandatory live case IDs; do not pretend an old registry entry covers a later behavior change.
3. Run typecheck, lint, full offline tests, prompt audit and coverage registry test. Measure actual auth, mailbox and shortlist extractor/reply request bytes; keep scoped field/prompt absence tests. New diagnostics add zero model-input bytes. Remove now-irrelevant instruction fragments instead of raising prompt ceilings. Failure fixtures and malformed judge evidence must fail for the intended reason.
4. Deploy current content to development through `DEPLOYMENT_ENV=development npm run deploy`, using `se-dev` / `us-east-1` and the account guard `684516060775`. Record full artifact digest and confirm the stack uses it. Do not promote production or change upstream APIs.
5. Run focused incident/companion cases, then the mandatory complete gate:

   ```sh
   AWS_PROFILE=se-dev AWS_REGION=us-east-1 DEV_STACK_NAME=recap-agent-runtime-dev npm run eval:behavior-live
   ```

6. Acceptance requires all hard structural assertions and all required semantic judges passing, zero errors/skips, actual effect counts consistent with copy, no protected disclosure, no automatic retry/OTP loop, and no regression among the other 67 previously passing cases. Full total will exceed 76 after companion cases are added; report the actual total rather than retaining the old denominator.
7. Inspect the complete three-turn OTP sequence and four-turn mailbox sequence, not isolated outputs. Record exact run/artifact/case versions and remaining failures in `docs/implementation-log.md`; update this plan's status and the existing ticket records only after evidence supports it. A deploy or green offline suite alone is not completion.

## Scope exclusions

No upstream contract change, real customer write, production promotion, model change, score-threshold reduction, broad global prompt appendix, keyword-based routing, or new OTP eligibility expansion. Historical reports remain unchanged. The earlier image/currency feature is not redesigned; it remains part of the full regression gate.
