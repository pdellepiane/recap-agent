# Implementation Log

## 2026-08-24

### Expand FAQ and protected-information authentication observability

- Added a request-scoped observability context that carries the Lambda request ID into every authentication decision and upstream HTTP exchange, plus a distinct authentication-flow ID, plan ID, and per-call operation ID. Extended that flow context through protected-information execution so guest fallback and authenticated account lookups share the same auth-flow ID as credential resolution.
- Added explicit start/completion/failure records for the protected-information authentication state machine. Records include the prior and next typed auth state, pending FAQ/event/purchase request context, trusted phone and email inputs, confirmation action, auth block, duration, and full exception details.
- Added detailed request/response logging for phone authentication, guest-by-phone fallback and event detail, email OTP send/verification, authenticated guest-service lookup, phone linking, and authenticated order/gift-purchase lookup. Logs include request URLs, ordinary headers, bodies, upstream request IDs, HTTP status, response headers/body, retry attempts, retry decisions, and timing.
- Expanded the channel completion record with the presented bearer token's length and SHA-256 fingerprint, accepted rotation-key count, and the matched current/previous key index so channel-key mismatch and incomplete rotation can be diagnosed without recording a replayable bearer value.
- Kept redaction intentionally narrow for internal testing: emails, phone values, ordinary API payloads, error envelopes, and provider response detail remain visible. Only replayable credentials and session material (`X-Agent-Key`, bearer/JWT values, OTP/request codes, cookies, passwords, and explicit token fields) are replaced with presence, length, SHA-256 fingerprint, and safe unverified JWT claim metadata. Embedded bearer/JWT values in free-text errors receive the same treatment.
- Added deterministic regressions for context correlation, minimal field-based redaction, JWT diagnostics, current/previous channel-key matching, detailed email-OTP exchange logging, and detailed phone-auth exchange logging.

**Prompt footprint:** No prompt, model input, tool surface, or conversational policy changed; serialized model-call instruction and input bytes are therefore unchanged.

**Verification:** `npm run check` passed 491/491 tests across 70 files after one transient AWS-backed fixture timeout was rerun successfully. The development runtime and provider-sync stacks deployed successfully through `se-dev` in `us-east-1` after STS confirmed account `684516060775`. Synthetic no-OTP protected-information request `26da4343-7c18-4f4e-8f3b-b1fa322e29fe` completed with trace `01M0V1QGKYDWF6SWVMMZ8Q0AWJ`. CloudWatch showed auth flow `7b4d3af8-be15-4073-99dd-cbeaf71a2e77` consistently on the phone-auth request/404 response, guest-event fallback request/404 response, typed execution result, and final channel summary. The record retained the synthetic phone, full upstream headers/bodies, status and timing while replacing both the Agent API key and channel bearer with length plus SHA-256 fingerprints; channel key index `0` confirmed the current rotation key matched. No OTP was requested or delivered during the probe.

## 2026-08-20

### Isolate authentication-only reply evidence

- Audited the sole failing hard live case and confirmed that the purchase lookup returned `needs_input` with no purchase results or shipping evidence. The reply model nevertheless received the user's shipping wording through the raw message, extraction query, pending request, capability summary, and tool summary.
- Added a branch-specific reply projection used only when every information result is blocked on authentication. It retains the typed `needs_input` result and authentication guidance while omitting the user message, recent message text, extraction request, pending plan request, capability summary, tool summary, and operational note.
- Preserved the complete pending request in the internal plan so the information lookup can resume after authentication. Completed, failed, and mixed-result information replies and every other route are unchanged.
- Added a deterministic regression and registered `withhold-blocked-information-intent-from-authentication-replies` against the existing mandatory hard live case.

**Verification:** The focused offline regression passed 1/1. The development Lambda deployed successfully. Focused live run `eval-2026-08-20T20-25-18-649Z-fd714a15` passed 1/1 with semantic score 1.0 and trace `01M0GDKB7Q5X9MKD1R2A30S49M`. The reply asked only for the registered email to access account information. GET-only retrieval of the stored OpenAI reply confirmed that its input contained `needs_input`, `email_required`, and `explain_account_information_access`, with no shipping wording, pending query, capability summary, or tool summary. Reply input size fell from 3,259 bytes in the failing trace to 1,246 bytes in the passing trace.

### Accept backend-confirmed RSVP state reversals

- Rechecked the production guest-service lookup for reserved phone `+51973296571`: guest `584353` was declined and guest `584352` was attending for `Otra celebración prueba`.
- Rechecked `POST /api/agent/guest/rsvp` with guest `584353`. The updated production contract returned HTTP 200 with `already_responded=false`, `will_attend=true`, `guest_id=584353`, and the event name. A follow-up user lookup confirmed that the stored state changed from declined to attending on `2026-08-20`.
- Verified the deployed Lambda after resetting the reserved fixture to declined. Run `eval-2026-08-20T15-36-31-505Z-d0b5f2d7` called `lookup_rsvp_invitations` and `guest_rsvp`, then answered `Listo, quedó registrada tu asistencia a Otra celebración prueba`. The only failure was the stale semantic expectation that still required the old backend refusal.
- Updated the contract regression to use the exact production success shape, where `action` is omitted and the resulting `will_attend` state is authoritative.
- Replaced the obsolete live refusal expectation with a repeatable final-state expectation: an explicit attendance request must end in a truthful confirmed response whether the backend changes a previous decline or reports an already-confirmed state on a repeated run.
- Registered `accept-backend-confirmed-rsvp-state-reversal` as its own behavior change, with hard route/tool assertions and a mandatory semantic judge.
- Focused deterministic gates passed 36/36 across the RSVP gateway, RSVP orchestration, and live-behavior coverage registry. Updated live run `eval-2026-08-20T15-44-09-966Z-531b7cd5` passed 1/1 with score 1.0 and trace `01M0FXGH5VCVY3P7K6RH7AAAN1`; the idempotent repeated request answered `Tu asistencia ya está confirmada para Otra celebración prueba. ¡Que disfrutes mucho el evento!` without authentication or an unnecessary mutation.

**Decision:** The backend limitation recorded on 2026-08-14 is resolved for the reserved production fixture. The runtime continues to fail closed unless the endpoint explicitly returns a `will_attend` value matching the requested action.

### Preserve OTP non-delivery intent with minimum disclosure

- Audited live trace `01M0FXTF795ADEYHX1MC887GZS` and retrieved the stored OpenAI extractor and reply Responses with GET-only audit tooling. Extraction correctly returned `authAction=report_otp_not_received`, but normalization discarded that field for `associated_event`; the resulting reply payload incorrectly contained `guidance.reason=otp_pending`.
- Extended the typed associated-event request with the same authentication-recovery action already used by protected purchase requests, preserved it through OpenAI normalization and pending-request merging, and selected the first non-neutral action across all protected requests.
- Kept disclosure minimal: the reply receives only `otp_not_received` guidance, which requires the destination, a wait of up to one minute, the main inbox, correo no deseado, and the two actionable choices to resend or change email. No unrelated OTP failure modules are included.
- Added deterministic normalization and complete associated-event flow regressions plus the mandatory live behavior coverage entry `preserve-associated-event-otp-nondelivery-action`.

**Verification:** `npm run check` passed 458/458 tests across 69 files. The development Lambda was deployed successfully. Live case `live_behavior.otp_not_received_requires_response` passed 1/1 with score 1.0 in run `eval-2026-08-20T16-51-27-570Z-9756788b`, trace `01M0G1BRPECEA4JDSBM2G6AW1C`.

**Mandatory full gate:** Run `eval-2026-08-20T16-55-18-243Z-1be7bd9a` completed 27 cases with 26 passes, 1 hard failure, 0 evaluator errors, and 0 skips. Every RSVP and OTP case passed. The sole remaining failure was `live_behavior.nonphysical_purchase_omits_shipping`, whose pre-authentication reply mentioned dispatch and arrival for a digital gift; the corresponding Notion item was reopened rather than hiding the regression.

## 2026-08-17

### Separate OTP failure classes and fail closed on unverified RSVP success

- Classified email-code request failures into email-not-found, rate-limited, unavailable, and other failures; classified verification failures into invalid-code, rate-limited, unavailable, and other failures.
- Only an invalid/expired code increments the failed-code counter. Rate limits and transport/service failures preserve the counter and tell the user what happened at an appropriate level, without exposing provider internals.
- Added route guidance and Spanish response rules for each new class, including a distinct next step for rate limits versus service outages.
- RSVP HTTP 200 responses now require an explicit `will_attend` value matching the requested action. A response that only says `status=true` or returns a contradictory state is treated as an unsuccessful mutation and cannot be rendered as confirmation.

**Production certainty:** The existing probe remains evidence for guest `584353` only: `/guest/rsvp` returned `already_responded=true`, `will_attend=false`, and a follow-up user lookup still returned false. That does not prove a universal negative for every invitation. The runtime therefore makes no claim unless the endpoint explicitly returns the requested resulting state; a safe pending-invitation fixture and post-mutation read-back are still required before declaring the Notion attendance item complete.

**Verification:** Focused OTP, RSVP, gateway, and orchestration tests passed 71/71; TypeScript typecheck passed. Added coverage-registry entries for both behavior changes.

### Enforce minimum prompt disclosure from typed turn state

- Added a prominent project directive requiring every model call to receive only the typed state, evidence, policies, fields, failure modes, and tools relevant to the current route and outcome.
- Added deterministic prompt-section projection for authentication outcomes. OTP guidance sections are selected from `informationResults[].guidance.reason`; irrelevant instructions are removed before the bundle hash and request are built.
- Reduced reply evidence for information and RSVP routes to their route-owned extraction and plan fields, removed provider/event-category context from those routes, and limited capability descriptions to the active node.
- Added regressions proving irrelevant OTP guidance is absent and recorded the new information-route serialized baseline.

**Reason:** A state machine that already knows the active branch should not send a prompt containing every possible result type or conflicting conditional rule. Smaller relevant requests reduce latency and usage while making the model contract less ambiguous.

**Latest deployed validation before this change:** `eval-2026-08-18T14-40-23-869Z-97906c1c` completed 27 cases with 19 passes, 2 failures, 6 evaluator errors, and 0 skips. This is not a green gate and remains open for follow-up.

**Post-change deployment validation:** `eval-2026-08-18T14-59-36-322Z-d555534d` completed 27 cases with 25 passes, 2 failures, 0 evaluator errors, and 0 skips. All RSVP cases passed. The remaining failures were `nonphysical_purchase_omits_shipping` and the existing `otp_not_received_requires_response` semantic case; neither is hidden or downgraded.

### Omit cash-gift shipping evidence from reply prompts

- Added a reply-model projection that recognizes a purchase as cash-only when every returned item has normalized `type: "cash"`.
- Cash-only purchases omit `shippingStatus`, `sendPhysical`, and `physicalStatus` from the model-facing evidence. The persisted typed purchase result remains unchanged for internal state and audit use.
- Mixed or unknown item types do not receive this projection; shipping evidence remains governed by the existing affirmative physical-fulfillment policy.
- Added a deterministic regression using the production-shaped `ORD-000880` cash envelope from the reported response.

**Reason:** Cash gifts are digital contributions and do not have physical shipping. Sending null or contradictory shipping fields to the reply model creates an unnecessary opportunity for invented dispatch or arrival language.

### Read complete invitation state before handling attendance

- Changed RSVP orchestration to query the user-level guest-event record by the trusted channel phone before deciding whether to mutate an invitation.
- Preserved each guest record ID and normalized numeric or boolean `has_responded` and `will_attend` values into pending, attending, declining, or unknown states.
- Pending invitations can be confirmed in the same turn when the user already expressed the decision; state-only questions report the current state and ask at most one useful follow-up.
- Existing confirmations are reported naturally without another mutation. Reversing an existing response requires one explicit confirmation, and the selected guest ID and desired action survive a short affirmative follow-up.
- Multiple invitations now expose all returned event states for one grounded selection question. A user-level result with no guest records is described as no associated invitations, never as the ambiguous “no pending invitations.”
- Added sanitized `lookup_rsvp_invitations` tool input/output evidence so traces show the guest IDs, event labels, and normalized current states used by the decision.
- Corrected the Agent API client to recognize HTTP 200 envelopes with `already_responded=true` and preserve `will_attend` instead of falsely treating the requested action as a successful update.

**Production contract finding:** A direct production probe with the reserved test phone and guest ID `584353` returned HTTP 200 with `already_responded=true` and `will_attend=false`; a follow-up user lookup confirmed the value remained false. The current backend therefore reports an existing response but does not change it. The agent now reports that unchanged state honestly and offers support. The state-machine path is ready to confirm the change when the endpoint returns a real successful mutation.

**Verification:** Focused TypeScript compilation passed. The RSVP gateway, RSVP orchestration, guest-service mapping, authentication guidance, and prompt-loader suites passed 59/59 tests. Offline RSVP coverage includes pending, already attending, already declining, a one-confirmation reversal, an affirmative follow-up, and a backend refusal that must never be rendered as success.

**Live coverage:** Added mandatory Lambda cases for reporting an existing confirmation, reporting a declined state and offering one change confirmation, and attempting that confirmed change without claiming false success when the production endpoint refuses it. Updated the no-invitation, campaign-context, missing-action, and email-code cases to assert the new state-first and copy-and-paste contracts. The coverage registry, evaluation catalog, RSVP service, prompt audit, and static comparison suites passed 22/22 tests.

**First deployed gate:** `eval-2026-08-17T16-17-36-841Z-63289420` ran all 27 mandatory cases with 21 passing, 6 failing, 0 errors, and 0 skips. All three new state-aware RSVP cases and the revised copy-and-paste code case passed. Four older RSVP fixtures exposed that a user-lookup HTTP 404 was still being rendered as a technical lookup failure, which also prevented persisted ambiguity and campaign evidence from being used. Two unrelated authentication cases varied.

**Follow-up correction:** A parsed user-level not-found response now means zero associated invitations, while thrown transport failures remain technical failures. Persisted RSVP candidates remain available when a fresh lookup has no records, and any recent `admin_campaign` context is preserved even when extraction does not repeat the event name. Focused service, catalog, coverage, type, and lint gates passed after the correction.

**Second deployed gate:** `eval-2026-08-17T16-28-45-351Z-78e05df0` ran 27 cases with 20 passing, 7 failing, 0 errors, and 0 skips. The three new RSVP state cases, the missing-action state case, and both email-code behaviors were functionally correct. The remaining RSVP failures proved the guest-service client throws on HTTP 404 before orchestration can classify it as no associated user record. Replaced generic 404 throwing with a typed guest-service HTTP error and mapped only lookup 404 to `null`; transport and other HTTP failures still throw. Updated the older phone-fallback semantic rubric to the new copy-and-paste contract. Focused mapping, RSVP, live registry, catalog, type, and lint gates passed 32/32 tests.

**Third deployed gate:** `eval-2026-08-17T16-39-50-794Z-f81cd9bb` ran 27 cases with 26 passing, 1 failing, 0 errors, and 0 skips. Every RSVP case and both copy-and-paste code cases passed. The sole failure was an older repeated-code judge interpreting the explicit offer “Puedo solicitar apoyo humano para revisarla” as insufficient because it was not phrased as a question, although the registered contract requires an offer rather than a submitted action. Clarified the rubric to accept an explicit offer without weakening its no-loop, preserved-query, and no-invented-payment requirements.

**Final repeated gate:** `eval-2026-08-17T16-47-50-855Z-3581f431` ran 27 cases with 25 passing, 2 failing, 0 errors, and 0 skips. All RSVP cases passed again, as did the clarified repeated-code case. The two failures were the positive OTP-send fixtures: repeated full-suite execution exhausted the external email-code request limit, so the runtime correctly persisted `user_auth.status=failed` and did not falsely say a code was sent. The immediately preceding deployed run proves both copy-and-paste cases pass when the external service accepts the request. Their positive expectations remain strict rather than accepting a rate-limited send as success.

### Make email-code delivery instructions direct

- Replaced the internal `enter_code_as_text` requirement with `copy_and_paste_code_here`.
- Changed the Spanish response contract to say that the code was sent to the exact email and ask the user to copy and paste it in the conversation.
- Kept the image limitation but explicitly prohibited using the word “texto” as a delivery instruction.

**Reason:** “Código como texto” confused users into spelling digits as words. Copy-and-paste language is shorter, concrete, and compatible with numeric or word-normalized codes.

## 2026-08-13

### Remove the deprecated Agent API deployment endpoint

- Changed the deployment fallback for `AGENT_API_BASE_URL` from the deprecated `se-v2-api-dev.jnq.io` host to `https://api.sinenvolturas.com/api/agent`.
- Added a regression test proving every active deployment and runtime configuration file is free of the deprecated host and that all Sin Envolturas service defaults point to production API paths.

**Reason:** The development Lambda can remain the validation environment, but the deprecated backend host no longer exposes `/guest/rsvp` and must not be selected implicitly by the deploy script.

### Preserve complete live-evaluation traces and calendar dates

- Made the live Lambda trace parser forward-compatible so newly added trace fields are retained instead of silently stripped before structural expectations and artifacts are produced.
- Preserved stage-specific timing fields such as `rsvp_execution` while continuing to validate the stable timing contract.
- Corrected contextual redaction so ordinary calendar years from 1900 through 2099 remain available to the semantic judge while standalone four-to-eight-digit codes continue to be redacted.

**Reason:** The first mandatory RSVP run proved correct state and tool behavior, but its `route_kind` disappeared during evaluation parsing and the year 2026 was replaced as though it were an OTP. Both defects produced false-negative evaluation results and reduced diagnostic fidelity.

### Load local live-evaluation phone fixtures

- Configured the ignored `.env.local` file with the established-phone fixture and the phone-not-found fixture supplied for development evaluation.
- Updated both evaluation entry points to load `.env.local` before `.env`, keeping fixture phones out of Git while preventing mandatory cases from failing because shell variables were omitted.
- Added a regression test for the environment-file precedence in both entry points.

**Decision:** Live fixture phone numbers are local operational configuration, not repository test data. Case files continue to reference environment variable names and evaluation artifacts continue to redact phone values.

### Render close outcomes from selected and deferred needs

- Made the finished-plan renderer use singular wording when exactly one provider received a quote request and plural wording only for multiple selected providers.
- Added an explicit sentence listing deferred categories as outside the submission and without a selected provider.
- Extended the deterministic finished-plan test with one selected photography provider and deferred catering evidence.

**Reason:** The mandatory live case correctly persisted Carlos Schult as the only selected provider and catering as deferred, but the final deterministic renderer said “solicitudes” and “proveedores” in plural and omitted the deferred need. That wording could falsely imply a catering provider was contacted.

**Coverage:** Registered the correction as a distinct behavior change backed by `live_feedback.token_seeded_selection_defer_close`, which asserts both the persisted deferred state and the final required-judge response.

### Define the phone-based guest RSVP contract

- Added a typed, unauthenticated Agent API client for `POST /guest/rsvp` using the trusted channel phone, the structured `attending` or `declining` action, and an optional validated guest ID.
- Modeled successful responses, multiple pending invitations, missing invitations, phone mismatches, already-answered invitations, transient failures, and malformed upstream envelopes as explicit fail-closed outcomes.
- Preserved upstream response data for typed error-envelope parsing without exposing credentials or authorization headers.

**Decision:** RSVP is scoped to the invitation attached to the trusted channel phone and does not enter user-account email or OTP authentication. A guest ID may be sent only after it has been returned by the API and persisted as a candidate.

**Verification:** The focused Agent API gateway suite passed 19/19 tests, including request shape, multiple-invitation parsing, and malformed-response handling.

### Deploy and validate RSVP against the production Agent API

- Deployed the development Lambda with all active Sin Envolturas clients pointing to `api.sinenvolturas.com`; the deprecated test host is no longer an implicit deploy fallback.
- Confirmed the active Lambda configuration for Agent API, guest service, user auth, and marketplace paths.
- Focused live RSVP cases passed for a missing attendance action, trusted-phone execution with a real no-pending backend response, and an ambiguous persisted two-event selection that must not mutate.
- The static RSVP extractor remains 3,558 serialized bytes and the reply request 7,690 bytes with no model tools or prompt-audit violations.

**Focused live evidence:** `eval-2026-08-13T15-55-31-806Z-f4f20c5f`, `eval-2026-08-13T15-55-09-365Z-d4351757`, and `eval-2026-08-13T15-58-11-112Z-607ba159` each passed with zero failures, errors, or skips. The corrected deferred-close live case passed in `eval-2026-08-13T16-10-42-317Z-0f80b39c`.

**Full-gate evidence:** Run `eval-2026-08-13T15-59-21-973Z-02d7e237` executed all 21 mandatory cases after local phone fixtures were configured: 19 passed, 2 failed, 0 errored, and 0 skipped. After the close-output correction, run `eval-2026-08-13T16-11-23-200Z-6a05573b` reached 20/21 with only the pre-existing mixed-language planning case varying; its immediate focused rerun `eval-2026-08-13T16-18-06-095Z-605f088b` passed. A third complete run `eval-2026-08-13T16-18-37-450Z-5255a68f` reached 16/21 with zero errors or skips and varying failures in five legacy cases. RSVP passed in all final runs. The complete gate is recorded as not yet stable rather than misreported as green.

### Reconcile the Notion roadmap with repository evidence

- Kept the attendance-confirmation item `3b1d5d10-94a6-81d6-8e0f-fe2a400fe159` in progress and added implementation, deployment, prompt-size, deterministic-test, and live-run evidence.
- Marked the stale backlog entries “Evaluar el prototipo inicial,” “Implementar el flujo end-to-end inicial,” and “Integrar los endpoints del marketplace” complete with repository-backed evidence comments.

**Decision:** RSVP is not marked complete until a safe real pending-invitation fixture proves a successful mutation and the multiple-pending production envelope, and until the complete mandatory live gate is stable. Historical work that is demonstrably implemented is no longer left as not started.

### Add the structured RSVP conversation flow

- Added the `responder_invitacion` decision node, capability-scoped structured extraction, persisted RSVP state, and a route-owned Spanish reply bundle.
- Clear attendance or nonattendance decisions use the trusted channel phone directly. RSVP never asks for email, OTP, or user-account authentication.
- Multiple pending invitations persist only backend-provided candidate IDs. A follow-up mutation is allowed only when structured extraction resolves one of those stored candidates; invented or ambiguous IDs never reach the backend.
- Pending RSVP follow-ups cannot be discarded as acknowledgements or reactions. Traces now include RSVP extraction evidence, state, candidate count, backend outcome, and stage timing.
- Added a typed feature flag and CloudFormation/deployment wiring, defaulting the development runtime to the enabled capability.

**Decision:** Structured extraction owns intent, action, and event-reference interpretation. Deterministic runtime code only validates stored candidate evidence, performs the mutation once per actionable turn, and prevents an unconfirmed service result from being rendered as success.

**Prompt leanness:** The route-scoped RSVP extractor serializes to 3,558 bytes and the reply request to 7,690 bytes, both with zero model tools and no prompt-audit violations. Across the full static comparison catalog, current serialized prompt bytes remain 52.26% below the historical baseline (336,965 versus 705,769).

**Verification:** `npm run check` passed 431/431 tests. Focused RSVP, extraction, classifier, trace, and prompt suites passed 71/71 tests. `npm run audit:prompts` reported 33 entries with zero violations, and `npm run audit:prompts:compare` passed its monotonic structural gates.

### Make RSVP behavior a mandatory live regression gate

- Added separate behavior-coverage entries for structured RSVP routing, explicit action confirmation, trusted-phone execution without account authentication, backend-confirmed outcome reporting, multiple-candidate persistence, grounded event selection, and suppression protection.
- Added three mandatory development-Lambda cases: a request missing its attendance decision, a clear confirmation against the real endpoint using a reserved synthetic phone, and the complete persisted-state interaction where “Ese” cannot choose between two events.
- Every case has hard state or tool assertions and a hard semantic expectation with a required judge. Deterministic gateway, state-machine, classifier, and orchestration tests remain their offline twins.

**Verification:** `tests/live-behavior-coverage.test.ts` and the evaluation catalog loader passed 5/5 tests before deployment.

## 2026-08-11

### Authenticate protected requests with the current WhatsApp number automatically

- Removed the pre-authentication yes/no confirmation turn. Protected event and purchase requests now call phone authentication immediately when a trusted WhatsApp number is available.
- Email OTP is now entered only when phone authentication returns `user_not_found`, when no trusted phone exists, or when structured extraction records an explicit rejection of the current phone/account.
- A technical phone-authentication failure no longer silently falls back to email. It preserves the protected request, records the failure, and offers retry or human support.
- Reworked the phone-first success, phone-not-found fallback, and stale “Este” live cases around the automatic-auth contract. Added a new live case for explicit account rejection and deterministic twins for success, not-found fallback, explicit rejection, and technical failure.
- Preserved the exact stale “Este” interaction as a migration regression: when a persisted pre-pivot confirmation flag exists, that one turn bypasses generic ambiguity handling and performs the new automatic phone lookup.
- Added `authentication_execution_summary` to turn traces, Dynamo performance records, and CLI summaries. Each phone auth, OTP request, and OTP verification records its sanitized operation, method, outcome, failure class, retryability, error preview, HTTP status, and upstream request ID when supplied. Codes and tokens remain redacted.

**Decision:** The WhatsApp adapter supplies a trusted channel number, so the runtime treats it as the default account lookup key. User confirmation is required only to reject a discovered account, not before lookup.

**Static prompt audit:** The information reply request is 15,296 serialized bytes with zero prompt-audit violations; the automatic-auth rule replaced the confirmation policy without adding model tools.

**Verification:** `npm run check` passed 412/412 tests before deployment; the final stale-state recovery added one deterministic case for a 413-test total. Development stack `recap-agent-runtime` reached `UPDATE_COMPLETE` at `2026-08-11T21:52:35.988Z`. Targeted live runs passed for automatic phone success (`eval-2026-08-11T21-43-14-098Z-89f55d7f`), phone-not-found fallback (`eval-2026-08-11T21-43-41-019Z-354ddfce`), explicit account rejection (`eval-2026-08-11T21-44-10-075Z-51cd660d`), and stale “Este” recovery (`eval-2026-08-11T21-53-15-765Z-6d484763`). The complete mandatory run `eval-2026-08-11T21-53-45-278Z-d7b9d306` passed all 17/17 cases with zero failures, errors, or skips.

### Make phone confirmation explicit and preserve missing-code reports

- Reconstructed the reported WhatsApp interaction from the channel request logs, DynamoDB plan/performance records, and stored OpenAI Responses payloads.
- The Agent API returned `user_not_found` for phone-first authentication and `sent` for the email-code request. No verification call occurred, so this incident did not contain a rejected code.
- The final Lambda turn contained the batched message “Ok Ok”; the response classifier returned `suppress_acknowledgement`, and the runtime intentionally made no extractor or reply call. The visible later message “No me ha llegado” has no Lambda request, Dynamo performance turn, or OpenAI response ID, placing that delivery failure upstream of this runtime.
- Reworded the phone confirmation to explicitly request “sí” for the registered current number or “no” when another number is used.
- Tightened structured extraction guidance so an imprecise demonstrative answer such as “este” remains `unclear` instead of triggering email fallback.
- Added permanent live cases for the exact “Este” response and for “No me ha llegado” during an active code challenge, plus an offline twin for the unclear confirmation.

**Decision:** Preserve the existing structured `phoneConfirmation` decision boundary. Improve the eliciting question and model-owned extraction semantics rather than introducing deterministic keyword routing.

**Trace evidence:** Plan `01KZHNYYA53Z02HB1203K85B4S`; suppressed-turn trace `01KZHP44TBDJH0Q1BQ6JRTRWNT`; classifier response `resp_08dbb4b049864931006a77a66a3ec481948b8e127e3b959a29`; local GET-only audit `.openai-audits/openai-audit-2026-08-11T16-57-12-375Z.json` (mode `0600`, ignored by Git).

**Targeted live verification:** `live_behavior.phone_confirmation_unclear_requires_yes_or_no` passed in run `eval-2026-08-11T17-03-38-678Z-862b5944`; `live_behavior.otp_not_received_requires_response` passed in run `eval-2026-08-11T17-03-51-858Z-3d41f3f9`. Both scored 1 with zero failures, errors, or skips against the redeployed development Lambda.

**Prompt audit:** The information reply request increased by 36 serialized bytes, from 14,929 to 14,965, while retaining zero model tools and no structural audit violations. The initial planning/information extractor remains below its 9,000-byte gate at 8,956 bytes.

**Full-gate follow-up:** Run `eval-2026-08-11T17-05-46-170Z-677101d7` completed all 16 cases with 12 passes, 4 hard failures, 0 errors, and 0 skips. It confirmed the two new structural paths but exposed that the first confirmation wording was an instruction rather than a natural question and that one model reply omitted the required resend/change-email choices. The confirmation now asks a direct yes/no question, defines each answer, and explains the consequence of “no.” Missing-code recovery is deterministically rendered from typed `otp_not_received` guidance so all required recovery choices remain present even if reply composition omits one. The information reply request is now 15,072 serialized bytes, with no prompt-audit violations; the extractor remains 8,956 bytes. After deployment, missing-code recovery passed live run `eval-2026-08-11T17-16-30-569Z-170e24a9`; the first confirmation rerun exposed an overly restrictive semantic rubric, which was corrected to distinguish explaining the email fallback from prematurely requesting the email.

### Promote FAQ retrieval to the mandatory live gate

- Revalidated the FAQ path with 46 focused deterministic tests covering information routing, orchestration, knowledge retrieval, prompt ownership, authentication guidance, and purchase disclosure.
- Promoted the existing recommendation-to-FAQ Lambda case into `live_behavior_regression` and replaced its text-fragment check with a hard semantic expectation requiring a grounded Spanish answer from retrieved knowledge.
- Added FAQ routing from active planning nodes to the behavior coverage registry so future behavioral changes cannot pass without exercising the knowledge-base path.
- Strengthened `AGENTS.md`: every future behavior-changing feature or fix needs its own coverage-registry entry, even when it reuses a prior live case. Registered each of today's three provider-confirmation corrections separately.

**Reason:** FAQ correctness is a primary release gate and must not rely only on offline routing tests or a non-mandatory live suite.

**Verification:** The focused FAQ surface passed 46/46 deterministic tests. Offline support-boundary run `eval-2026-08-11T15-33-19-289Z-b24b30c4` passed. The deployed knowledge-base FAQ passed before and after promotion; the required-judge run `eval-2026-08-11T15-34-17-416Z-bab50bc7` passed, and confirmation run `eval-2026-08-11T15-45-10-415Z-b784a857` also passed. The expanded mandatory run `eval-2026-08-11T15-35-28-613Z-4f9fe6e2` is recorded as failed rather than promoted: 11/14 passed, one mixed-intent behavior case failed, and two Lambda invocations reached the 90-second platform timeout. The independent FAQ rerun passed, isolating FAQ from those remaining gate failures.

### Reconcile live behavior coverage with implemented fixes

- Added a git-tracked behavior coverage registry that maps each behavior-changing fix since the mandatory live-gate policy to one or more permanent live case IDs.
- Added a deterministic gate proving every mapped case exists, belongs to `live_behavior_regression`, targets the live Lambda, has a hard structural assertion, and has a hard semantic expectation with `requireJudge: true`.
- Corrected the owning suite metadata for the four original interaction-derived feedback cases.
- Promoted the exact `Sí confirmo` ambiguity, “the cheaper one,” and “the one in Miraflores” decision-evidence regressions from request-shape-only tests to live Lambda cases.
- Made live seed-plan persistence fail loudly instead of returning an empty skipped result; this exposed an expired AWS login rather than misreporting three empty model responses.

**Reason:** The Roadmap described decision-evidence fixes as complete, but their exact interactions were not all members of the mandatory live suite. The existing evaluator could also hide a Dynamo seed failure as an empty case, weakening the fail-closed contract.

### Reject ungrounded provider confirmations

- Added a typed selection-evidence invariant for confirmation turns with multiple shortlisted candidates.
- A provider selection remains valid only when its extracted reference is grounded in the user message through retained provider or need discriminators. A model-produced `select_provider` operation cannot independently establish that evidence.
- If the reference is not grounded, the runtime clears the unsupported provider reference and selection operation, preserves the shortlist, marks the selection ambiguous, and routes to one clarification without searching or choosing the first candidate.
- The guarded branch renders the neutral Spanish question “¿Qué proveedor o acción estás confirmando?” so the reply model cannot reintroduce an unsupported candidate while asking for clarification.
- Added a deterministic twin for the live `Sí confirmo` interaction while retaining existing name, ordinal, descriptive-service, comparative-price, and location-reference selection behavior.

**Reason:** The newly promoted live case proved the deployed extractor could assign the first shortlisted provider to an underspecified confirmation even though two candidates existed. Its first rerun also showed that the extractor could fabricate a matching selection operation, so the invariant must validate all model-produced selection evidence against the user's message.

**Decision:** Treat multi-candidate confirmation as an invariant-validation problem over structured extraction evidence. Do not use keyword matching to choose flow, and do not allow an ungrounded model reference to mutate the plan.

## 2026-08-10

### Restrict purchase payment and shipping disclosures

- Added a typed purchase-disclosure policy before reply composition. Destination account details are projected only when the authenticated purchase has `paymentStatus: pending`; approved, rejected, missing, and unknown statuses cannot expose the account or transfer destination.
- Shipping status is projected only when the purchase contains affirmative physical-fulfillment evidence from a physical product item type or an explicitly physical dedication. Cash, digital, and unknown purchase types fail closed with no shipping status.
- Added deterministic integration coverage proving that non-qualifying fields are removed before the reply model receives completed purchase evidence, while a pending physical purchase preserves both authorized fields.

**Reason:** A payment destination without a specific pending purchase cannot be reconciled to an order, and shipping language for a nonphysical purchase creates a false fulfillment expectation.

**Decision:** Enforce both rules in typed runtime evidence rather than relying only on prompt compliance. Prompt and live behavior gates remain a separate checkpoint.

### Add route-owned purchase disclosure guidance and live cases

- Classified requests for Yape or transfer destinations as structured purchase lookups with payment-status, payment-detail, and destination-account evidence instead of treating them as general FAQ requests.
- Added one concise information-route owner for both reply rules: a destination requires a completed pending purchase with a projected destination account, and shipping language requires projected physical-fulfillment evidence.
- Added permanent live cases `live_behavior.payment_destination_requires_pending_purchase` and `live_behavior.nonphysical_purchase_omits_shipping`, each with structural routing assertions and a mandatory semantic judge.
- The information reply request grew from 14,563 to 14,929 serialized bytes, a bounded 366-byte increase; the static comparison remains below the historical route baseline.

**Decision:** Keep the prompt policy concise and route-scoped while retaining deterministic evidence stripping as the primary enforcement layer.

## 2026-08-08

### Deploy phone-first auth and pass live behavior gate

- **Live gate passed** for phone-first authentication: `live_behavior.phone_first_auth_success` and `live_behavior.phone_first_auth_fallback` both pass against the redeployed dev Lambda pointing at the production Agent API (`https://api.sinenvolturas.com/api/agent`).
- The WhatsApp fixture `+51 973296571` is a registered account on prod and authenticates successfully via `POST /auth-by-phone` → returns JWT + user email → `auth_method: phone` persisted.
- Fallback case uses a separate unregistered fixture `+51 911111111` which returns `user_not_found`; agent falls back to email OTP flow (`request_user_login_code`) → `user_auth.status: code_requested`.
- Token expiry converted from epoch seconds to ISO; `hasValidUserAuthToken` fails closed on missing/expired expiry.
- Artifact redaction preserves structural hashes/identifiers while removing JWT/OTP/raw phone.
- Evaluation `plan_field_equals` now respects `turnIndex` for turn-specific plan assertions.
- Deployment used `se-dev` profile, account `684516060775`, `us-east-1`, with `AGENT_MESSAGE_LOGGING_ENABLED=false` and provider-sync skipped.

**Reason:** The dev Agent API endpoint lacked `/auth-by-phone` (HTTP 405); the production endpoint supports it and the provided Peru phone is a real registered account there.

**Decision:** Deploy the dev Lambda against the production Agent API base URL so phone-first auth actually functions. The dev endpoint is suitable only for routes that exist on both hosts (`/messages`, `/conversations/messages`, `/conversations/request-human`, `/orders`, `/gift-purchases`).

**Verification:** `npm run check` passed (typecheck + lint + 402 tests); `npm run build` succeeded; Lambda `recap-agent-runtime` deployed (UPDATE_COMPLETE, Active, LastUpdateStatus Successful); live behavior gate run `eval-2026-08-08T04-16-00-659Z-aed40588` passed both phone-first cases.

---

## 2026-08-07

## 2026-08-07

### Apply phone-first release blockers

- Added typed artifact redaction for CLI responses and evaluation storage. JWTs, access tokens, OTPs, and raw phone values are removed while authentication statuses, methods, and field-presence evidence remain available to assertions.
- Extended information authentication guidance with `phone_confirmation`, made token validity require a future ISO expiry, and rejected expired phone-auth epoch timestamps.
- Corrected the live phone-fallback case to assert the documented phone user-not-found and email-not-found path, and added regression coverage for trusted inbound phone routing and unavailable-phone email fallback.

**Reason:** Release validation found sensitive eval/CLI serialization, an incorrect typed next-input value, a misleading live fallback expectation, fail-open session expiry handling, and insufficient proof that phone API calls use only the validated inbound identity.

**Decision:** Keep full state available only to in-process evaluation assertions; serialize redacted projections for CLI and eval artifacts. Do not broaden the phone-first slice into RSVP, outbound logging, or migration work.

**Verification:** `npm run check` and `npm test` passed with 399 tests; `npm run build` and the targeted authentication/evaluation tests passed. Deployment and the live behavior evaluation remain pending because this task explicitly forbids deployment.

**Safe dev deployment command (not run):**

```sh
AWS_PROFILE=se-dev AWS_REGION=us-east-1 \
AGENT_API_BASE_URL=https://se-v2-api-dev.jnq.io/api/agent \
AGENT_MESSAGE_LOGGING_ENABLED=false \
DEPLOY_PROVIDER_SYNC=false npm run deploy
```

The command is explicitly scoped to the guarded development profile and skips the unrelated provider-sync stack. `scripts/deploy.mjs` keeps the broad provider-sync deployment as the default path, but its runtime-only opt-out and development Agent API default prevent this validation command from touching that stack or production by omission.

## 2026-08-07

### Add phone-first authentication for protected information requests

- Used the validated inbound channel phone as the only phone-authentication source and retained the existing digits-only `contact_phone` alongside nullable split fields for the Agent API boundary.
- Added a typed `phoneConfirmation` extraction outcome (`yes`, `no`, or `unclear`) and durable `awaiting_phone_confirmation` state. The first protected request asks for confirmation without calling either authentication endpoint; a yes tries `/auth-by-phone`, while no, unclear, missing phone, and typed phone-auth failures preserve the request and use the existing email OTP fallback.
- Added typed `/auth-by-phone` and `/user/update-phone` gateway methods with strict credential parsing, X-Agent-Key/Bearer handling, structured failure mapping, and epoch-seconds-to-ISO expiry conversion. Tokens and phone values remain redacted from deterministic traces.
- Successful phone authentication persists the backend email, token, ISO expiry, and `auth_method: phone`. Successful email OTP persists `auth_method: email` and attempts the current trusted inbound phone update non-fatally, including the phone-linked conflict.
- Added deterministic unit coverage, legacy-plan parsing coverage, and two live regression cases. The success case resolves `TERMINAL_CONTACT_PHONE`; the fallback case requires a separate `PHONE_FIRST_FALLBACK_CONTACT_PHONE` development fixture. Neither case contains a phone, token, OTP, or API secret.

**Reason:** Protected event and purchase requests must use the WhatsApp webhook identity before requesting email, while terminal turns and unresolvable phone identities must continue to work through email OTP.

**Decision:** Keep the auth gate in `AgentService`, keep event lookup/orchestrator behavior unchanged, require structured confirmation rather than text matching, and merge nested auth state explicitly so an in-flight OTP cannot be replaced by phone-first state.

**Verification:** `npm run check` passed with 388 tests and `npm run build` passed. Development Lambda deployment and `npm run eval:behavior-live` were intentionally not run per task instruction; the next DevOps step must deploy first and then run the mandatory live suite with the configured fixture.

## 2026-08-05

### Stop repeated verification-code loops for protected purchase queries

- Added a persisted count of rejected verification-code attempts and reset it
  whenever the email challenge is restarted or authentication succeeds.
- Kept the protected purchase request pending after a rejection, but changed
  the first failure to offer retry, resend, or email correction without blaming
  the user.
- Changed the second rejection and later prose follow-ups to stop requesting
  another code, avoid repeating inbox instructions, and offer human support
  while explicitly retaining the unresolved purchase question.
- Reconstructed the reported gift-deposit interaction in a deterministic test,
  including the original question, email step, two identical six-digit code
  attempts, and the user's explanation that the code came from the email.

**Reason:** DynamoDB performance records showed that the protected gift query
was classified correctly, but the verification service rejected the freshly
issued code twice. The plan stayed at `code_requested`, so seven subsequent
messages received substantially the same generic authentication response until
the user became frustrated and requested a person.

**Decision:** A correctly shaped code may be attempted twice, but the assistant
must not create an unbounded verification loop or imply that the user copied it
incorrectly. After the second rejection, preserve the pending query and make
human support the single actionable recovery path.

### Gate the reported verification failure in the mandatory live suite

- Added a context-complete three-turn live case seeded with the unresolved gift
  purchase, protected-field scope, destination email, and active code challenge
  recovered from the reported interaction.
- Required exactly two verification attempts, no third verification call for a
  prose follow-up, a persisted two-attempt boundary, retention of the purchase
  query, removal of copy-blaming and inbox-loop language, and mandatory semantic
  judging of both recovery replies.
- Added the case to `live_behavior_regression`, so every future behavior change
  must run it through `npm run eval:behavior-live`.

**Reason:** Deterministic coverage proves state handling, but the regression also
depends on live extraction and reply composition preserving the full interaction
and rendering the intended Spanish recovery behavior.

**Decision:** Validate the real rejected-code branch with a reserved `.invalid`
email and a seeded challenge. This exercises the production verification error
without issuing a new code or contacting a real user.

### Keep the Spanish-only live judge scoped to supported behavior

- Clarified that the language regression must not require the runtime to send or
  discuss an unsupported confirmation-link email while it asks the single
  decision-critical planning question.
- Kept the hard requirements for retained event evidence, Spanish-only natural
  language, and rejection of any false claim that a link was sent.

**Reason:** The expanded live run correctly retained the celebration, location,
and food-service need and used no English words, but the judge failed it solely
for not fulfilling an unsupported side request that the case rubric had called
“relevant” without defining whether it was required.

**Decision:** Judge the supported one-turn contract explicitly. Deferring an
unsupported side request is acceptable; fabricating successful delivery is not.

### Enforce reply invariants already established by structured state

- Made the repeated-code recovery sentence deterministic after Luna completes
  the classifier, extraction, and reply calls, preventing later prose follow-ups
  from drifting back to email correction or another code attempt.
- Made the `budget_or_guest_range` clarification deterministic when that typed
  missing-field invariant is active, so an unsupported side request cannot
  replace the decision-critical planning question.
- Filtered structured contact-request fields against the persisted plan before
  rendering, so a stored valid phone is never requested again.
- Made repeated gift-payment recovery name the retained delivery/payment topic
  from typed request scope instead of referring to an unspecified pending query.
- Replaced contradictory close-confirmation summaries once name, email, and
  phone are complete, using only provider selections already stored in the plan.
- Made a finished lifecycle render a deterministic successful submission notice,
  so generated prose cannot ask for confirmation after `finish_plan` succeeds.
- Added deterministic regressions with deliberately contradictory model replies
  for all three boundaries.

**Reason:** A second live run showed that the structured plan was correct in all
three cases, but generated prose could still contradict it: restart email
recovery, ask for an unsupported link-delivery address, or list an already saved
phone among missing contact fields. The next live run confirmed the deterministic
boundaries but showed that semantic correctness also requires naming the retained
gift-payment topic and replacing contradictory free-form close summaries.
The following live run then proved `finish_plan` had succeeded while the model
still rendered a confirmation question, requiring lifecycle-aware success copy.

**Decision:** LLM extraction remains the source of conversational decisions.
Deterministic code may enforce those already-established decisions at the final
rendering boundary and must preserve the model-call telemetry used by live
behavior tests.

### Align live evaluation telemetry with hashed conversation keys

- Replaced the stale `perf.conversation_id` expectation in the live-evaluation
  response schema with the required 64-character `conversation_hash`.
- Updated live-target fixtures to exercise the privacy-preserving performance
  contract returned by the deployed Lambda.

**Reason:** The first post-credit Luna smoke completed successfully in the
development Lambda, but the local evaluation harness discarded the turn because
its performance-summary schema still expected the raw conversation identifier
removed by the OpenAI audit privacy checkpoint.

**Decision:** Keep raw conversation identifiers in the runtime turn response and
plan where operationally required, but require only the SHA-256 hash in persisted
and CLI performance telemetry. Do not add a compatibility union for the removed
performance field.

### Make the guest-boundary eval target-equivalent

- Updated the 100-guest boundary case to include the boda and Lima evidence in
  the user message for both offline and live targets.
- Preserved the hard requirements that 100 maps to `51-100` and that a complete
  provider request reaches recommendation.

**Reason:** The restored-credit live smoke correctly asked for a missing
location, while the case expected recommendation because its offline fixture
silently injected Lima. The two targets were not evaluating the same evidence.

**Decision:** Put decision-critical evidence in the shared user input rather
than only in an offline extraction fixture. Do not relax the recommendation
expectation or teach the runtime to search without a required location.

### Promote the optimized Luna live baseline

- Deployed the final prompt bundle to the development Lambda and ran the
  three-case `live_smoke` suite across entry planning, the 100-guest boundary,
  recommendation, and persisted provider selection.
- Captured original-response token usage with cached, cache-write, uncached, and
  output tokens priced separately at the project-effective Luna rates.
- Added `openai-luna-optimized-2026-08-05.json` with trace-level evidence,
  quality results, measured averages, and future monotonic gates.
- Added a regression test that recomputes every turn's cost and requires the
  promoted average to remain below both 22,411 input tokens and the `$0.00234584`
  Luna model-only ceiling.
- Updated `eval:compare-models` to load and report the promoted live baseline,
  fail on its quality/performance regression, and clear the prior
  `livePromotionRequired` flag.
- Retrieved stored classifier, extractor, and reply Responses through the
  GET-only audit path and verified `store: true`, Luna, no reasoning effort,
  structured schemas, route-scoped tools, and mode-`0600` local files.

**Reason:** The model migration and prompt audit were locally complete, but API
credit exhaustion had prevented measured development quality, cache behavior,
cost, and stored-response retrieval.

**Decision:** Promote the representative three-case live average rather than a
single warm-cache turn. Use usage captured on the original response as the cost
source because it retains cache-write tokens, while stored GET retrieval remains
the payload-audit source.

**Validation:** `live_smoke` passed 3/3 with score 1.0. Average input fell from
22,411 to 11,667.33 (-47.94%). Average OpenAI cost was `$0.00128448` per
successful full turn, 71.95% below the `$0.00457957` legacy baseline and 45.24%
below the `$0.00234584` Luna model-only ceiling. All three component response
IDs were retrievable without generation.

## 2026-08-04

### Prove historical-to-current prompt leanness

- Added `audit:prompts:compare` to reconstruct the pre-refactor prompt bundles
  from Git and compare them with current production prompt composition.
- Added exact instruction bytes, serialized request bytes, normalized paragraph
  duplication, file counts, and optional non-generative OpenAI input-token
  counts for the classifier, four extractor profiles, and every reply route.
- Added a dated analysis dossier with machine-readable results, per-route
  findings, reproduction steps, and a review against current official OpenAI
  model guidance.
- Removed three remaining negative-rule duplicates from the common anti-patterns
  file while preserving their single owning rules in output style/base behavior.
- Confirmed that official OpenAI API documentation currently provides GPT-5.6,
  not GPT-6, prompting guidance; no speculative GPT-6 rules were introduced.

**Reason:** Structural prompt gates proved that current bundles were internally
consistent, but they did not visibly demonstrate how much the assembled payload
changed from the historical implementation. Current GPT-5.6 guidance also
recommends lean prompts, single ownership, task-relevant tools, surgical edits,
and representative evaluation.

**Decision:** Compare both sides with the same Luna model field and request
settings so the result isolates prompt construction. Keep the unchanged
classifier visible as a control, and defer classifier slimming until live quality
evaluation is available because a false suppression is more harmful than its
current token overhead.

**Validation:** The 32-shape comparison passed with every non-classifier route
smaller. Serialized request bytes fell from 635,882 to 319,703 (49.72%), and
OpenAI's non-generative input counter fell from 135,347 to 66,651 tokens (50.76%).
No Response was created. Final live Luna promotion remains blocked by
insufficient API credits.

### Migrate active GPT defaults to GPT-5.6 Luna

**Reason:** The classifier, extractor, reply composer, and evaluation judges
still defaulted to GPT-5.4 variants. GPT-5.6 also replaces the legacy prompt
cache retention field and bills cache writes separately, so a model-only rename
would have produced incomplete cost telemetry and a deprecated request shape.

**Changes:**
- Centralized `gpt-5.6-luna` as the default for all active GPT text roles and
  updated runtime configuration, CloudFormation, deployment defaults, prompt
  audits, evaluation judges, tests, and active documentation.
- Upgraded the OpenAI Agents SDK to `0.14.2` and the compatible OpenAI SDK to
  `6.49.0`, which provide typed GPT-5.6 prompt-cache options.
- Removed `OPENAI_PROMPT_CACHE_RETENTION` and configured implicit caching with
  `prompt_cache_options.mode=implicit` and a `30m` TTL while retaining stable
  component prompt-cache keys. No explicit breakpoints were added before live
  cache-write measurement.
- Preserved `reasoning.effort=none`, added low verbosity to the direct
  classifier, and kept stored Responses enabled for all three runtime roles.
- Added cache-write token capture, aggregation, schemas, study telemetry, and
  the Luna cache-write price of `$0.25 / 1M` (1.25 times uncached input).
- Added `npm run eval:compare-models`, which runs deterministic behavioral gates
  and route-scoped prompt audits, using `/responses/input_tokens` without
  generation when an API key is available.

**Decision:** Start with GPT-5.6 implicit caching and measure both
`cached_tokens` and `cache_write_tokens` before introducing explicit cache
breakpoints. Historical GPT-5.4 fixtures, prices, and analysis artifacts remain
immutable comparison evidence.

**Validation:** The comparison gate passed all 12 development regression cases
with zero failures, zero prompt violations, and non-generative token counts for
all 31 request-shape entries. `npm run check` passed with 56 files and 362 tests,
`npm run build` passed, and the local prompt audit reported zero violations.
Deployment remains deferred until the final optimized Luna promotion baseline.

### Add completeness and leanness gates

**Reason:** Structural prompt checks covered reply modules but the extractor
still loaded 47,563 serialized bytes of universal instructions on every turn,
including fields its capability-scoped schema had removed. Token reduction was
not safe unless completeness, ownership, and evidence preservation failed
before size improvements could pass.

**Changes:**
- Added `npm run audit:prompts` with route/profile metrics for exact instruction
  bytes, serialized candidate bytes, rule ownership, module relevance, maximum
  tools, duplication, and required-file coverage.
- Added `--remote-token-count`, implemented only through the non-generative
  `/responses/input_tokens` endpoint and covered with a client test that exposes
  no response-creation method.
- Split the universal extractor prompt into capability-owned base, planning,
  information, provider-management, contact, and close/pause files; runtime
  composition now matches the exact capability-scoped output schema.
- Added gates for duplicate structured context subtrees, repeated rule IDs,
  repeated normalized paragraphs, unrelated modules, irrelevant schema fields,
  irrelevant dynamic tools, redundant reply projections, and exact serialized
  prompt sizes.
- Preserved regression rules for ambiguity, provider references, purchase/event
  authentication, negative answers, multi-need planning, contact, close, and
  pause in their owning Spanish files.

**Decision:** Completeness is a hard prerequisite and byte/token reduction is a
secondary gate. Prompt modules and schema capabilities must change together so
the model never receives rules for fields it cannot emit.

**Measured result:** The worst-case extractor candidate fell from 47,563 to
11,593 serialized bytes (75.63% lower); the initial planning/information profile
is 8,748 bytes (81.61% lower), and conversation-only extraction is 2,269 bytes
(95.23% lower). The live non-generative count returned 2,441, 1,856, and 453
input tokens respectively. Representative reply prompt counts were 1,605 for
welcome, 2,384 for recommendation, and 2,892 for information, with zero audit
violations.

**Validation:** `npm run check` passed with 55 files and 359 tests, `npm run
build` passed, and `npm run audit:prompts -- --remote-token-count` completed
against OpenAI without generating or storing a Response. Deployment remains
deferred until the final integrated Luna baseline passes.

### Persist and retrieve OpenAI response references safely

**Reason:** Performance and CloudWatch records had token totals but no
`resp_...` identifiers, so the exact request and response payloads could not be
reconstructed. Performance records also stored the raw Sin Envolturas
conversation ID.

**Changes:**
- Added typed per-component OpenAI call references with response ID, transport
  request ID, model, attempt count, and instruction/input/tool/schema metrics.
- Explicitly enabled `store: true` for classifier, extractor, and reply
  Responses calls and propagated successful references through turn traces into
  DynamoDB performance records.
- Replaced raw performance `conversation_id` with `conversation_hash`; the
  partition key now uses the same SHA-256 value while runtime state continues
  using the original ID only in memory.
- Added `npm run audit:openai` for direct response IDs or hashed
  conversation/trace lookup. It retrieves response objects and every paginated
  input item with GET requests only, then combines identifiers, instructions,
  input, tools, schema, settings, output, and usage.
- Added secret-safe errors, ignored local output, `0700` audit directories,
  `0600` audit files, and fail-closed development AWS identity checks.
- Added tests proving GET-only pagination, API-key redaction, private file
  permissions, stored request flags, reference extraction, and hashed
  persistence.

**Decision:** Do not introduce OpenAI Conversations. Keep the three model roles
isolated and use stored response retrieval only for explicit, time-bounded local
audits. Existing raw-key performance rows will age out through TTL without a
compatibility path.

**Validation:** `npm run check` and `npm run build` passed. No model generation
or OpenAI network access was used by audit tests. Deployment and scoped live
retrieval remain deferred until the final integrated Luna baseline passes.

### Make OpenAI retries error-aware

**Reason:** Classifier and Agents SDK calls either had no application retry or
retried every HTTP 429, including permanent `insufficient_quota` failures. That
made one unrecoverable turn create multiple identical requests.

**Changes:**
- Added one shared OpenAI error classifier for application and Agents SDK retry
  paths, including nested error-code, status, network, timeout, and retry-header
  handling.
- Classified quota exhaustion, authentication, permission, validation, model,
  billing, and other permanent 4xx failures as non-retryable.
- Limited retries to transient rate limits, request timeouts, server errors, and
  network failures with four total attempts and bounded exponential backoff.
- Made the direct classifier honor `retry-after-ms` and `retry-after`; the Agents
  SDK policy uses the same classification and its normalized retry delay.
- Added unit, classifier HTTP, and Agents SDK transport tests proving
  `insufficient_quota` produces exactly one request and transient rate limits
  retry within the bound.

**Decision:** The application owns retry semantics; the OpenAI SDK remains at
zero hidden retries. Unknown errors fail without replay because safe replay is
not established.

**Validation:** `npm run check` and `npm run build` passed. Deployment remains
deferred until the final integrated Luna baseline passes.

### Use capability-scoped extraction schemas

**Reason:** The extractor always sent one universal output schema containing
information, contact, provider-operation, selection, inspection, close, and
pause fields even when the state machine made those capabilities impossible.
Those irrelevant properties consumed request tokens and invited invalid state
changes.

**Changes:**
- Added an explicit typed extraction-capability profile and now constructs the
  Responses output schema from only the enabled capability groups.
- Omitted plan operations until a plan exists, selection and provider
  inspection until a shortlist exists, and close or pause until state-machine
  evidence permits them.
- Omitted information and contact fields when their product capabilities are
  disabled, and removed provider-planning action intents when provider planning
  itself is disabled.
- Kept one complete downstream extraction contract by normalizing omitted
  capability fields to typed neutral values after model output validation.
- Added profile-by-profile required-field and irrelevant-field tests plus a
  downstream normalization regression.

**Decision:** The model-facing schema is capability-specific; the core runtime
contract remains complete. Structured LLM extraction still supplies every
conversational decision that a route is capable of making.

**Validation:** `npm run check` and `npm run build` passed. Per the updated
checkpoint workflow, deployment is deferred until the final integrated Luna
baseline passes.

### Enforce route-scoped prompt composition

**Reason:** Every reply route loaded all eight shared prompt modules, including
planning knowledge, flow rules, and question strategy that many routes could
not use. The personality module also repeated style, domain, and situation
guidance, while an extractor example assigned two contradictory values to
`activeNeedCategory`.

**Changes:**
- Defined core, planning, and question-strategy prompt profiles and now compose
  only the shared modules required by the current decision node.
- Assigned each prompt file a deterministic stable rule ID and exposed those
  IDs in loaded bundles for audits and ownership checks.
- Reduced the shared personality file to its owned voice guidance, leaving
  output, domain, flow, and node behavior in their dedicated files.
- Removed the contradictory `activeNeedCategory: null` line from the auditorium
  extractor example.
- Added tests for stable one-file ownership, required route coverage, unrelated
  module exclusion, and repeated normalized paragraphs.

**Decision:** A prompt file is the atomic rule-ownership unit. Core voice and
output rules apply everywhere; planning and question modules are opt-in route
capabilities, while node files remain the exact behavioral owners.

**Validation:** `npm run check` and `npm run build` passed, and both development
CloudFormation stacks deployed successfully through the guarded `se-dev`
profile in `us-east-1`.

### Preserve complete decision evidence without duplicate reply projections

**Reason:** Reply requests projected the same plan state through overlapping
summaries while omitting the extractor's ambiguity evidence, persisted
preferences, hard constraints, and provider discriminators. This caused the
ambiguous `Si confirmo` turn to fall back to a welcome-shaped response and made
references such as "the cheaper one" or "the one in Miraflores" unreliable.

**Changes:**
- Replaced the separate decision, extraction, plan, needs, missing-fields,
  provider, and funnel blocks with one canonical typed turn-evidence object.
- Preserved ambiguity status, interpretations, the clarification question,
  preferences, hard constraints, provider references, fit criteria, contact
  evidence, and the complete structured decision projection.
- Included provider location, price, rating, rationale, promotion, highlights,
  fit, and detail metadata once in the reply candidate list.
- Removed `external_user_id` from extractor requests and enriched the remaining
  provider context with the discriminators needed for reference resolution.
- Forced ambiguous turns to use the generic clarification output contract
  instead of the welcome contract.
- Added regression coverage for `Si confirmo`, "the cheaper one", "the one in
  Miraflores", sensitive-auth isolation, and single-projection composition.

**Decision:** Treat the canonical evidence object as the sole source of factual
reply context. Keep behavioral instructions outside it, and let deterministic
code validate state without replacing structured LLM extraction.

**Validation:** `npm run check` and `npm run build` passed, and both development
CloudFormation stacks deployed successfully through the guarded `se-dev`
profile in `us-east-1`.

### Lock the pre-optimization OpenAI request and cost baseline

**Reason:** Prompt and model optimization needs a reproducible reference that
separates cached input, uncached input, and output costs. The runtime also
needed an injectable OpenAI transport so tests can inspect the actual serialized
Responses request without making network calls.

**Changes:**
- Added a dated ten-turn GPT-5.4 usage baseline and a versioned pricing catalog
  containing the project-effective GPT-5.6 Luna rates for 2026-08-04.
- Added cost regression coverage proving the legacy full-turn cost and the
  model-only Luna savings independently.
- Made the Agents SDK runtime and direct response classifier accept an injected
  OpenAI client while keeping a production client as the default.
- Disabled the OpenAI SDK's hidden transport retries so retry behavior remains
  owned and observable by the application layer.

**Decision:** Keep the legacy baseline immutable. Use mocked transports for
wire-contract tests and price candidate workloads from measured token classes,
not a single blended token rate.

**Validation:** `npm run check` passed with 50 test files and 326 tests,
`npm run build` completed, and both development CloudFormation stacks deployed
successfully through the guarded `se-dev` profile in `us-east-1`.

## 2026-07-31

### Fail closed on the repository's AWS account and profile

**Reason:** An interactive `aws login` can rewrite the local `default` profile,
which belongs to a separate AWS account on this workstation. Repository scripts
must never inherit that profile or accept a caller-selected account implicitly.

**Changes:**
- Added a repository-wide instruction requiring `se-dev` in `us-east-1`, backed
  by the local `se-signin` login profile.
- Added a shared guard for mutating Node scripts. It rejects any other profile
  or region and verifies AWS account `684516060775` through STS before work.
- Applied the same profile rejection to the terminal and live evaluation SDK
  paths, documented the safety rule, and corrected a diagnostic command that
  previously omitted its explicit profile.
- Added regression tests proving that `default` and other regions are rejected.

**Decision:** AWS isolation is an executable invariant, not a shell convention.
The workstation's `default` profile remains independent and must never be used
by this repository.

**Validation:** Restored `default` to account `385982457198` in `us-east-2`.
Verified `se-dev` resolves through `se-signin` to account `684516060775`, proved
the guard rejects `default`, and ran all subsequent AWS validation and cleanup
with explicit `AWS_PROFILE=se-dev AWS_REGION=us-east-1`.

### Make authentication guidance conversational and replace the FAQ corpus safely

**Reason:** Authentication recovery used a hardcoded customer-facing sentence
that referenced Gmail-specific inbox language and could not adapt naturally.
The first code message omitted delivery expectations and the welcome response
expanded every enabled capability into a long list. The FAQ replacement script
also used same-day batch IDs, read only one cleanup page, and could delete the
supplemental customer-service corpus because cleanup was not source-scoped.

**Changes:**
- Replaced hardcoded authentication replies with typed guidance reasons and the
  exact destination email. Required semantic facts are represented as typed
  guidance requirements, while the information reply agent still writes the
  final customer-facing message under node instructions.
- Instructed the agent to explain why the registered email is needed, say that
  a sent code can take up to one minute, mention only the main inbox and junk
  mail, and offer resend or email correction when a code is missing. Provider-
  specific inbox language is prohibited.
- Replaced the welcome capability catalogue with a three-part structured
  response: one brief greeting, one scope sentence, and one open question.
- Made help-center scraping fail closed on missing categories, missing article
  links, partial article failures, empty content, and exact duplicate bodies.
- Added unique per-run batch IDs, per-file FAQ metadata, paginated and
  source-scoped cleanup, cleanup-consistency retries, and a post-replacement
  count/stale/duplicate audit.
- Added `npm run sync:faq-kb` and documented the separation between scraped FAQ
  articles and curated customer-service templates.

**Decision:** Keep authentication execution deterministic but customer-facing
wording model-generated from typed state. For first contact, ask what the person
needs instead of presenting a tutorial. Treat the FAQ vector store as a merged
corpus with independently replaceable sources rather than one destructive
batch.

**Validation:** The local scrape produced 52 non-empty, content-unique articles
with the same slug set as the prior help-center corpus. The OpenAI FAQ store now
contains one completed 52-file scraped batch plus all 27 curated support files:
79 completed files total and zero duplicate FAQ slugs. Three live retrieval
queries returned relevant evidence from the intended sources. `npm run check`
passed with 50 test files and 325 tests, `npm run build` completed, and both
development CloudFormation stacks deployed successfully through the guarded
`se-dev` profile. Deployed probes returned the concise three-line welcome,
explained that the registered email is needed to access account information,
and handled a missing code with the exact destination email, the security
reason, a one-minute expectation, main-inbox and junk-mail checks, and resend or
email-change options. All synthetic plan and session records were deleted.

### Use one canonical message context across every model stage

**Reason:** Only the response classifier consumed Agent API history. The
extractor and reply composer could therefore lose campaign context, references,
corrections, and merged FAQ plus user-action meaning even though the endpoint
already returned the relevant messages. The reply composer also relied on an
independent OpenAI conversation session, creating two competing transcript
authorities.

**Changes:**
- Added a typed per-turn message context built from one Agent API history read,
  capped at five recent messages and shared by classification, extraction, and
  reply composition.
- Deduplicated the current inbound message by native WhatsApp id, with a bounded
  timestamp-and-body identity fallback for older endpoint records.
- Kept the event plan as compact typed business memory and the Agent API as raw
  channel history. Reply runs are now stateless and no longer append internal
  extraction or composition payloads to an OpenAI conversation session.
- Added extractor guidance for resolving references and producing standalone
  FAQ or user-information queries without copying the full transcript into the
  query.
- Added redacted context observability: availability, source, retrieved and
  retained counts, excluded-current count, directions, message sources, and
  campaign-entry source. Message bodies remain absent from traces.
- Added fail-open behavior for history outages and regression coverage for
  native-id and fallback deduplication, bounded context, campaign anchors,
  history propagation, outages, and merged FAQ plus user-action turns.

**Decision:** Read external history once per turn and reuse one immutable,
curated context object. Pass only typed plan state to deterministic transition
logic. Do not persist raw transcripts in the plan, and do not use
`conversation_id` as a second memory system.

**Validation:** `npm run check` passed with 48 test files and 319 tests, and
`npm run build` completed. Both development CloudFormation stacks deployed
successfully. A synthetic deployed Lambda FAQ turn returned `200`, stayed in
`resolver_consultas_informativas`, and exposed the new redacted trace with
`history_status: empty`, `context_source: agent_api`, zero retained messages,
and no raw bodies. The exact synthetic plan and session-focus records were
deleted after the probe.

### Derive intents, tools, and reachable states from plan capabilities

**Reason:** A no-plan conversation could still present the extractor with the
global `cerrar` intent and rely on a later invariant to discard it. That made an
impossible transition visible to the model and treated the state machine as a
post-classification guard instead of the source of available actions.

**Changes:**
- Added a typed per-turn capability policy derived from structured plan state,
  including active-plan, search-ready, shortlist, selection, contact, close,
  pause, and finish capabilities.
- Replaced the extractor's global intent enum at runtime with a dynamic output
  schema. A plan with no provider needs cannot emit `cerrar`, `pausar`, a close
  action, or `pauseRequested=true`; shortlist actions are unavailable until a
  recommendation exists.
- Added the current allowed-intent set to extractor context so instructions and
  the structured output contract describe the same turn-level capabilities.
- Filtered each node's maximum tool manifest against plan prerequisites before
  tools are exposed to the reply agent. Search requires a search-ready active
  plan, provider inspection requires known candidates, and `finish_plan`
  requires an active plan, a selected provider, and complete contact data.
- Derived reachable decision nodes from the same policy and prevented invalid
  transitions by routing to a safe clarification state while retaining an
  invariant violation in the trace.
- Added regression coverage for empty plans, established plans, shortlists,
  dynamic schemas, dynamic states, tool prerequisites, and merged FAQ plus
  user-action turns.

**Decision:** Dynamic availability is the primary control boundary. The older
no-plan close guard remains only as defense in depth for alternate runtimes and
test doubles that do not execute the OpenAI structured-output schema.

**Validation:** `npm run typecheck`, `npm run lint`, and the complete test suite
passed with 47 test files and 313 tests. `npm run build` completed, and both the
development runtime and provider-sync CloudFormation stacks deployed
successfully.

### Suppress non-actionable campaign replies and improve missing-code support

**Reason:** Recorded WhatsApp conversations showed three customer-facing
regressions: a gift-completion update was interpreted as closing an event plan,
an emoji-only reaction received a long welcome message when campaign history was
missing, and a customer who did not receive an email code was repeatedly asked
for that code without clear recovery options. Authentication messages were also
too long for a support conversation.

**Changes:**
- Allowed structured acknowledgement and reaction suppression without prior
  outbound history only when the classifier finds no question, request,
  correction, selection, or plan-relevant fact. Added prompt and labelled-corpus
  coverage for emoji-only replies and completed-gift updates.
- Clarified extractor rules so a statement that a gift was already sent is not
  a provider-plan close action or a personal-purchase lookup request.
- Added a state-machine invariant that rejects `cerrar` when the persisted plan
  has neither an event nor a provider need. Closing now requires evidence that a
  plan was established before the current turn, independent of classifier or
  extractor quality.
- Added typed `report_otp_not_received` evidence. The runtime now explains the
  security requirement, shows the exact destination email, asks the customer to
  check promotions and junk mail, and offers to resend or change the address.
- Made resending explicit and user-driven, and fixed email correction so a newly
  provided address takes precedence over the stored one.
- Replaced the verbose authentication walkthrough with short, next-step-only
  customer-service messages and tightened the information-node response
  contract to one to three brief paragraphs.

**Decision:** Semantic decisions remain in structured LLM outputs. Deterministic
runtime code validates and executes the typed suppression and authentication
evidence; it does not use keyword or exact-string routing.

**Validation:** `npm run check` passed with 46 test files and 306 tests, and
`npm run build` completed successfully. The development runtime and
provider-sync CloudFormation stacks deployed successfully. Live Lambda probes
with synthetic users returned `message: null` and suppressed delivery for both
an emoji-only reaction and “Ya envié el regalo”, with no prior outbound history
and non-fallback structured classifier evidence. A seeded code-pending probe
returned the short recovery message with the exact destination email, security
reason, inbox checks, resend option, and email-change option without requesting
another code automatically. The synthetic DynamoDB plan was deleted after the
probe.

## 2026-07-29

### Make purchase lookup guidance explicit and prevent clarification loops

**Reason:** A recorded WhatsApp conversation showed that a personal order-status
request could enter a repeated clarification loop. Structured extraction had
already identified a purchase request, but also marked the turn ambiguous; the
runtime then discarded the newly extracted request and asked increasingly
specific questions instead of beginning verification. The purchase instructions
also did not tell the customer clearly what each requested datum would be used
for.

**Changes:**
- Added an information-flow invariant that treats valid typed authenticated
  lookup requests as actionable evidence even when the model also emits an
  inconsistent ambiguity flag. Genuinely vague turns and FAQ requests with
  semantic ambiguity still receive one clarification question.
- Expanded Spanish extraction examples so personal order-status wording maps to
  `orders` with useful default aspects and does not require an order number or a
  narrower status category before authentication begins.
- Made the first purchase reply explicitly explain, in customer-service
  language, that the email is used to send an account-verification code, that
  the order number is optional, and what happens on each path. When the user
  already supplied an order number, the reply acknowledges that it will identify
  the exact purchase and asks only for the email needed to verify the account.
- Defined the no-number path as: verify the email, retrieve recent orders,
  present a compact choice when needed, and then use the selected order for the
  precise lookup. Defined the number-provided path as: verify the email and
  perform the precise lookup directly.
- Made the next-input reply deterministic when every information task is
  waiting for the same prerequisite, so the reply model cannot replace this
  guidance with another exploratory question.
- Updated the welcome capability list to state that recent-order and direct
  order-number lookup are supported, alongside supported gift-purchase details.
- Added automatic exact-detail retrieval when the recent-order endpoint returns
  exactly one candidate; multiple candidates continue through explicit
  selection.

**Decision:** The LLM remains responsible for semantic interpretation and typed
request extraction. Deterministic runtime code enforces consistency between that
typed evidence and the next state, and preserves the exact customer-facing
prerequisite instructions required for authentication and lookup.

**Validation:** `npm run check` passed with 46 test files and 303 tests, and
`npm run build` completed successfully. The regression suite includes the
recorded typed-request-plus-ambiguity shape, both email/order-number paths, and
the recent-list-to-exact-detail transition. Both CloudFormation stacks deployed
successfully with `AWS_PROFILE=se-dev`. The active Lambda reports the production
Agent API URL, purchase information enabled, and message logging disabled.
Redacted probes with the retained test JWT returned HTTP `200` and empty arrays
for both collection routes, as expected for the designated account, and HTTP
`404` for nonexistent exact-order probes. Fresh deployed conversation probes
for the recorded opening phrase and a message containing an order number both
entered `resolver_consultas_informativas`, retained a purchase request, reported
clear ambiguity state, and returned the expected customer-facing guidance for
their respective lookup paths.

## 2026-07-27

### Introduce the first-class multi-capability information engine

**Reason:** FAQ, associated-event lookup, orders, and gift purchases are
independent read-only needs that users can naturally combine. The former
single-intent FAQ route and bespoke event-auth branch could not resolve a mixed
turn coherently, and hosted `file_search` made retrieval behavior depend on a
node-specific reply-agent tool. Purchase prompts also issued blanket gift
refusals despite the new authenticated Agent API contracts.

**Changes:**
- Replaced informational intents and `secondaryIntents` with one structured turn
  plan: optional exclusive `actionIntent` plus ordered typed
  `informationRequests`.
- Added the `resolver_consultas_informativas` node, shared
  `InformationTaskResult[]`, concurrent `Promise.allSettled` orchestration,
  partial-success composition, compact pending-request persistence, resume
  state, and recent-order selection state.
- Added an explicit OpenAI vector-store search gateway and removed the hosted
  `file_search` tool from reply composition.
- Replaced `guest_auth` with shared `user_auth`. One production email OTP unlocks
  pending event and purchase requests, and original personal questions resume
  automatically after verification.
- Added strict Agent API clients for `/orders` and `/gift-purchases`, with
  optional `order_id`, both required headers, bounded retry handling, malformed
  payload rejection, account-level versus route-level `404` classification, and
  request-scoped sensitive-field projection.
- Prevented associated-event results from acting as a purchase-data shortcut by
  removing embedded orders and finance fields before composition.
- Updated Spanish extraction and reply prompts for semantic personal-versus-FAQ
  routing, mixed read-only turns, action conflicts, email-first verification,
  optional order numbers, recent-order retrieval, partial results, and supported
  personal gift details.
- Added capability-level latency, source, status, and result-count telemetry
  without raw questions, evidence, API payloads, credentials, or payment data.
- Added typed runtime configuration and CloudFormation/deploy parameters for
  knowledge retrieval and purchase information. The Agent API is pinned to
  `https://api.sinenvolturas.com/api/agent`; message logging remains disabled by
  default and no development-host fallback exists.
- Removed the obsolete `consultar_faq` and `consultar_evento_invitado` prompt
  bundles and compatibility routes.

**Decision:** Read-only capabilities compose through one information engine.
Planning, provider selection, closing, pause, and takeover remain exclusive
action flows. LLM extraction makes semantic routing decisions; deterministic
code validates and preserves typed evidence. Existing secrets are reused through
the repository's Secrets Manager deployment path, while JWTs remain isolated
from prompts, traces, and pending information state.

**Validation:** `npm run check` passed with 46 test files and 299 tests. Coverage
includes standalone and mixed extraction, concurrent orchestration, partial
success, OTP resumption and reuse, order ID propagation, recent-order selection,
gift detail projection, sensitive-field disclosure, expired authentication,
invalid OTP, malformed payloads, retry behavior, both `404` meanings, vector
retrieval, source grounding, state-machine behavior, gateway behavior, Lambda
request handling, and terminal/WhatsApp parity. `npm run build` and
CloudFormation template validation also passed. The development runtime and
provider-sync stacks deployed successfully using the existing secret names.
The active Lambda reports the production Agent API and user-auth URLs, purchase
information enabled, knowledge retrieval enabled, and message logging disabled.
A redacted production OTP request for the designated acceptance account returned
HTTP `200` with a successful envelope. The interactive code exchange then
returned HTTP `200`, a successful envelope, and a JWT that remained only in
process memory. Authenticated production probes sent both `X-Agent-Key` and the
JWT bearer header to `/orders` and `/gift-purchases`; each returned a JSON error
envelope with HTTP `404`. Because neither request supplied an order ID, this is
route-level unavailability rather than an account-level order miss. No JWT,
service key, personal purchase detail, or payment data was printed or persisted;
the final acceptance process retained neither the OTP nor JWT after exit.

## 2026-07-24

### Make ambiguous FAQ clarification enforceable

**Reason:** A stakeholder run of `npm run demo:feedback-fixes` exposed a real
nondeterministic failure. For “El horario”, structured extraction recorded that
the reference lacked an event or other context but assigned confidence `0.55`.
The runtime only treated confidence below `0.50` as ambiguous, so it searched
the knowledge base and answered with customer-service hours instead of asking
what schedule the user meant.

**Changes:**
- Replaced the numeric ambiguity cutoff with a required typed extraction object
  containing `status` (`clear` or `ambiguous`), two or three candidate
  interpretations, and one optional clarification question.
- Instructed extraction to decide ambiguity semantically from the complete
  message and available context, not from exact words. If its assumptions say
  that the necessary referent is missing, it must mark the turn ambiguous.
- Enforced a final-response invariant for ambiguous FAQ turns: use the
  extractor's bounded interpretations to produce one short Spanish contrast
  question; otherwise use its validated question or a safe generic
  clarification. A reply-model answer cannot override the structured ambiguity
  decision or silently choose one interpretation.
- Added ambiguity status and clarification-question presence to DynamoDB
  feedback signals, plus ambiguity status to the CloudWatch completion summary.
- Strengthened the demonstration so it requires both explicit structured
  ambiguity evidence and exactly one delivered question.

**Decision:** Numeric intent confidence remains useful telemetry but is not a
stable ambiguity state boundary. Conversational behavior is controlled by
explicit typed extraction evidence, and deterministic code only validates and
preserves that established decision.

**Validation:** The failed live trace was
`01KYADH929VMZS0BWP774ABH4Y`; it stored confidence `0.55`, an assumption that
the context was missing, no operational ambiguity note, a file search, and an
answer with zero questions. After the fix, `npm run check` passed with 43 test
files and 287 tests. The runtime and provider-sync stacks deployed successfully
with `se-signin`, and the complete demonstration passed. Corrected trace
`01KYAEMWGD2GMSY999P74X6EN4` delivered “¿Quieres saber el horario del evento o
el horario de atención de Sin Envolturas?” DynamoDB recorded explicit
`ambiguous` status, two interpretations, one clarification question, and one
delivered question. CloudWatch contained the matching protected message hash,
ambiguity status, successful HTTP `200`, and zero output-quality or
Spanish-policy warnings.

### Harden live WhatsApp question handling for nontechnical users

**Reason:** A cross-source review of 35 retained WhatsApp question turns found
that 24 concerned gifts, purchases, payments, deliveries, or transaction
discrepancies even though the runtime has no dedicated integration that can
verify or modify those operations. The reference-search prompt encouraged the
assistant to turn documentation into operational answers, producing unsupported
causes and contradictory procedures. Ten native WhatsApp message identifiers
were processed twice, and a fragmented “dato” then “horario” exchange was
misread as a request for business hours. All retained quality-flag arrays were
empty. CloudWatch recorded successful HTTP `200` executions for recent
representative cases, confirming a routing and wording problem rather than a
Lambda failure.

**Changes:**
- Added a repeatable channel-contract demonstration script and presenter guide.
  The demonstration asserts that the existing text-only payload works with
  `media` omitted, a captionless image works with `text` omitted, and a request
  with neither returns HTTP `400`.
- Added the complete evidence-driven demonstration
  `npm run demo:feedback-fixes`, which organizes the audit into capability,
  ambiguity, verification, email, language, image, duplicate/burst, and
  observability categories. Each category states the observed evidence,
  justification, deployed proof, and remaining limitation. It prints trace ids
  and protected correlation values for cross-source verification.
- Added `feedback_signals` schema version 1 to every new turn-performance
  record. The bounded snapshot stores hashed correlation, request shape and
  ingress delay, routing confidence and decision source, model/tool stages,
  output complexity, existing quality flags, and known Spanish-policy-term
  warnings.
- Added a small CloudWatch summary of the feedback signal version, decision
  source, model-call count, quality-flag count, and Spanish-policy warning count
  for fast cross-source correlation.
- Kept raw message bodies, raw media, raw provider media identifiers, URLs, and
  credentials outside the feedback snapshot. Documented how a future raw-log
  export should be joined and labelled without becoming a keyword-based flow
  controller.
- Replaced gift, sales, purchase, payment, withdrawal, balance, order, and claim
  guidance with an explicit capability boundary: the conversation can directly
  provide event information, while operational cases are offered to a person
  from the team for review.
- Updated structured extraction guidance so transaction-related questions use
  the general question route even when they mention a specific event. The
  runtime no longer asks users to authenticate before explaining that those
  operations require human review.
- Added one-question clarification guidance for ambiguous short messages and a
  direct statement that photographs and screenshots cannot currently be read.
- Expanded guest verification notes to explain why the code is required, where
  to find it, what to type, and what happens when issuance or validation fails.
- Added conservative guest-email normalization that removes whitespace only
  immediately around `@`; it does not infer missing punctuation or characters.
- Strengthened global Spanish-only wording, normalized known leaked English
  service terms in user-visible structured fields, and rendered English
  canonical provider categories with Spanish display labels while preserving
  internal typed values.
- Updated the multi-message burst design to state that constituent messages are
  retained temporarily for replay, trace comparison, and evidence-based wording
  improvements. Raw messages remain outside the durable event plan.
- Added a complete provider-hosted media descriptor to the channel contract,
  matching WhatsApp's native `id`, `mime_type`, `sha256`, and optional filename
  fields. The Internet media type follows RFC 6838/IANA, and the descriptor is
  published as JSON Schema Draft 2020-12.
- Allowed captionless media requests, carried validated media metadata through
  the channel-agnostic inbound message, and added a deterministic image response
  that bypasses classifier, extraction, document search, and reply-model calls.
- Added safe media evidence to DynamoDB performance traces and CloudWatch
  completion logs: count, class, registered media type, and hashed provider
  media identifiers. Raw identifiers, URLs, access tokens, and media bytes are
  excluded.
- Documented current non-support, exact WhatsApp adapter mapping, persistence,
  privacy boundaries, and the future authenticated retrieval and integrity
  verification path in `docs/media-integration.md`.
- Added the dated, sanitized
  `analysis/live-whatsapp-faq-audit/` dossier with reproducible DynamoDB and
  CloudWatch checks.

**Decision:** Do not use documentation search as a substitute for a
transactional integration. Do not diagnose a user's gift or payment state
without a verified operational source. Message-burst persistence belongs in the
adapter's short-lived burst store, where native message identifiers support
ordering, deduplication, replay, and quality analysis; it does not belong in the
long-lived event plan. Treat the WhatsApp media object as trusted channel
evidence that an image was actually sent, but do not download or interpret it
until a bounded media resolver is implemented.

**Validation:** `npm run check` passed with 43 test files and 287 tests. The
development runtime and provider-sync stacks deployed successfully with AWS
profile `se-dev`. Live prompt probes confirmed the event-information-only
transaction boundary, one-question schedule clarification, detailed
verification-code guidance, conservative spaced-email handling, and the direct
image limitation. A final captionless media-contract probe returned HTTP `200` in 526
ms with prompt bundle `deterministic:unsupported_image_media`, zero model token
usage, and no tools. DynamoDB stored one `image/jpeg` descriptor with only the
provider media id hash; CloudWatch recorded the same hash, media count, and
class on the correlated successful request. The `se-dev` account contains only
the runtime, provider-sync, and knowledge-sync Lambdas/stacks; the Meta webhook
adapter is not deployed from this repository or account, so that external
adapter must adopt the documented mapping before real WhatsApp images reach the
runtime with this descriptor.
The packaged demonstration subsequently passed against that deployment: the
legacy body with no `media` field returned HTTP `200`, the image body with no
`text` field returned HTTP `200` through the deterministic path with no tools or
model tokens, and the content-free body returned the expected HTTP `400`.
The complete categorized demonstration also passed live. It verified the
event-information-only transaction boundary, one-question clarification for
“El horario”, detailed verification instructions plus conservative whitespace
repair around `@`, and a captionless `image/jpeg` request. The image case used
trace `01KYAC1G0EXZ906N6V5WEJ2D59`, completed inside the runtime in 13 ms, and
made zero model or tool calls. DynamoDB persisted feedback schema version 1 with
`media_only` input and deterministic routing; CloudWatch recorded the same
protected message correlation with one image, zero model calls, zero quality
flags, and zero known Spanish-policy term warnings.

## 2026-07-21

### Align guest authentication and event lookup on production

**Reason:** A valid production login code returned an authenticated token, but
the runtime immediately sent that production identity and token to the
development guest-service lookup. The dev lookup returned HTTP `404`, causing
the deterministic flow to clear the valid session and ask for email validation
again.

**Changes:**
- Changed the guest-service default from
  `https://se-v2-api-dev.jnq.io/api/guest-service` to
  `https://api.sinenvolturas.com/api/guest-service` in runtime configuration,
  CloudFormation, and the deployment script.
- Updated operational and thesis documentation so guest authentication and
  event lookup show the same production environment.
- Added regression coverage that requires both guest API defaults to resolve to
  production when no override is supplied.

**Decision:** Treat guest code issuance, code verification, and authenticated
event lookup as one environment-bound flow. Do not mix a token or user identity
from one environment with data lookup in another. Explicit environment
overrides remain available for isolated testing, but the checked-in and deployed
defaults must stay aligned.

**Validation:** `npm run check` passed with 43 test files and 276 tests. The
development runtime and provider-sync stacks redeployed successfully, and the
active Lambda reports both guest URLs on `api.sinenvolturas.com`. The code from
the original failed session was already invalid or expired, so the exact
persisted session requested a fresh production code and moved cleanly to
`guest_auth.status = code_requested` with no stored error. The fresh code then
authenticated successfully, production guest lookup returned the account's
event context, and the assistant rendered the event response. DynamoDB retained
`guest_auth.status = authenticated`, a 24-hour token expiry, and no error; Lambda
reported zero errors in the live validation window.

### Make ownership transitions observable and enforce their HTTP contract

**Reason:** A manual resume appeared not to change a live overtaken plan. The
runtime logs proved that no successful resume transition occurred, but rejected
requests did not include their path, so an unauthenticated resume could not be
distinguished from another Function URL call.

**Changes:**
- Restored the identified live test plan through the authenticated resume
  endpoint and confirmed the persisted state is bot-active at `entrevista`.
- Added redacted request path, resolved route, body presence, ownership
  operation, hashed ownership request id, transition result, plan id, and human
  escalation state to structured request completion logs.
- Kept message ids and ownership request ids in distinct hashed fields so
  operational correlation does not blur conversational and control requests.
- Enforced the documented POST-only Function URL contract with HTTP `405` and
  `Allow: POST` for authenticated callers using another method.
- Added handler-level and pure observability regression coverage, including
  pre-authentication resume logging and sensitive path redaction.
- Documented response-driven caller behavior, failure handling, and a CloudWatch
  Logs Insights query for live ownership debugging.

**Decision:** The trusted server-side caller may update its local ownership
indicator only after a confirmed `200` ownership response. Browser code must not
receive the channel credential. Emit enough structured state to diagnose route,
authentication, identity, and transition failures without logging raw user,
phone, message, request, or credential values.

**Validation:** `npm run check` passed with 43 test files and 275 tests. The
development runtime and provider-sync stacks redeployed successfully. Live
probes returned `401` for a resume without the Bearer header, `405` plus
`Allow: POST` for an authenticated GET, and `200 already_active` for an
authenticated idempotent retry. CloudWatch recorded all three with the resume
path and route; the successful retry also included the hashed ownership request
id and the active plan state. A Logs Insights query matched all three records,
Lambda reported zero errors in the validation window, and DynamoDB retained the
resumed `human_escalation.status = none` state at `entrevista`.

### Fail open on history outages and require explicit automation confidence

**Reason:** A conversation-history outage must not silently discard a legitimate
inbound message. Prior outbound history is also not the defining signal for a
corporate automated response; an unequivocal automated business template can
be identified from the inbound message itself.

**Changes:**
- Removed `suppress_context_unavailable` from runtime and evaluation actions.
  Failed Agent API history reads now skip the classifier, retain
  `conversation_context_unavailable` as trace evidence, and continue through
  the normal response flow.
- Added structured `automation_confidence` output and a deterministic invariant
  that permits `suppress_automated_response` only with reason
  `automated_response` and confidence `high`.
- Allowed that high-confidence automation action without prior outbound
  history. Acknowledgement and reaction suppression still requires outbound
  conversational context.
- Expanded regression and labelled-corpus coverage for context-free corporate
  automation, uncertain templates, human business contacts, and history-read
  failures.
- Added a generic branded reception-template case after a live GoCleaning demo
  showed high automation confidence paired with an incorrect `respond` action.
- Added typed automation pattern and scope evidence so the runtime can normalize
  inconsistent classifier actions without keyword matching, while protecting
  quoted bot text and context-free generic business greetings.

**Decision:** Enforcement suppresses only an accepted classifier decision; it
does not convert an infrastructure failure into a silent delivery drop. Keep
ambiguous and human-looking business messages fail-open, and retain fresh
five-message classification with no persisted number-level guard.

**Validation:** `npm run check` passed with 42 test files and 270 tests. A live
classifier evaluation suppressed all 13 automation cases, including four with
no outbound history and the GoCleaning reception template, and none of the 12
human/business lookalikes. The
development Lambda and provider-sync stack were redeployed. An authenticated
Lambda smoke with successful empty Agent API history returned
`suppress_automated_response`, `automation_confidence: "high"`,
`has_prior_outbound_message: false`, and `message: null`; only the classifier
ran, using 1,692 tokens. A second authenticated smoke with the exact GoCleaning
message returned pattern `generic_corporate_reception`, scope `current_sender`,
`message: null`, and classifier-only usage of 2,111 tokens. A forced
failed-history service test confirmed the classifier is skipped and the normal
extraction/reply path sends a response.

### Suppress high-confidence corporate automated responses

**Reason:** Corporate WhatsApp numbers can answer the assistant with automated
menus, away notices, routing messages, and templated confirmations. Treating
those messages as event-planning input invokes extraction, search, and reply
generation unnecessarily and can create a bot-to-bot loop.

**Changes:**
- Extended the existing structured response classifier with
  `suppress_automated_response` and contextual Spanish guidance for
  high-confidence automation detection without keyword matching.
- Kept the external Agent API's five latest messages as the authoritative
  context and preserved the prior-outbound requirement for model-selected
  suppression.
- Added `suppress_context_unavailable` so a failed history lookup stops before
  every model call; successful empty history still supports first contact.
- Added classifier and service regression coverage, including refreshed
  classification on every turn, plus 12 automation and 12 must-respond corpus
  examples.
- Updated runtime/eval schemas and channel documentation for both new delivery
  reasons.

**Decision:** Do not persist an automation guard, cooldown, or blacklist. Each
inbound message reads fresh five-message context and is classified again. Keep
rapid-message coalescing outside this change and preserve fail-open behavior for
classifier/model/schema failures.

**Validation:** `npm run check` passed with 42 test files and 266 tests. A live
classifier evaluation suppressed all 12 automation examples and none of the 12
must-respond lookalikes. The development Lambda and provider-sync stack were
redeployed. An authenticated Lambda smoke turn with synthetic prior-outbound
Agent API history returned `message: null` and delivery action `suppress` with
reason `suppress_automated_response`; extraction, provider search, and reply
composition were skipped, and the classifier was the only model call at 1,217
tokens.

## 2026-07-15

### Restore message requests and separate ownership endpoints

**Reason:** A shared body-level operation discriminator combined message
processing and conversation ownership into one endpoint, breaking the existing
channel request flow. Conversation ownership is also independent of the system
that initiates the transition.

**Changes:**
- Restored `POST /` as the message endpoint with its original request body and
  no operation field.
- Added separate `POST /conversations/overtake` and
  `POST /conversations/resume` endpoints with a shared typed ownership body.
- Removed caller-specific naming from routes, persistence reasons, errors,
  tests, and current integration documentation.
- Updated terminal and live-evaluation clients to use the restored message
  contract and added focused route coverage.

**Decision:** Use HTTP paths to separate the three purposes. Keep ownership
transitions caller-agnostic and infer no source-system identity inside Lambda.

**Validation:** `npm run check` passed with 42 test files and 259 tests, and the
development Lambda was redeployed. A live synthetic cycle returned `overtaken`
from `/conversations/overtake`, accepted an operation-less request at `/` and
suppressed it while externally owned, returned `resumed` from
`/conversations/resume`, and returned HTTP `404` for an unknown path.

### Add explicit CRM conversation takeover

**Reason:** The CRM could release human ownership but had no symmetric control
to take ownership of an active automated conversation before a user requested
handoff through the agent flow.

**Changes:**
- Added the authenticated `overtake_conversation` operation with the same exact
  `(channel, user_id)` identity and correlation fields as the release request.
- Extended `AgentParticipationService` to persist human ownership, move the plan
  to `solicitar_agente_humano`, and return `overtaken` or the idempotent
  `already_overtaken` result.
- Kept the operation model-free and reply-free; later `process_message` turns
  use the existing deterministic suppression path.
- Added typed request/service tests, redacted operation outcomes, README and CRM
  integration documentation, response examples, and checklist updates.

**Decision:** Treat CRM takeover and release as symmetric server-side ownership
controls. Do not call the Agent API human-request endpoint when the CRM itself
initiates takeover because the representative already owns that workflow.

**Validation:** `npm run check` passed with 41 test files and 257 tests, and the
development Lambda was redeployed. A live synthetic ownership cycle returned
`overtaken`, then `already_overtaken`; the following `process_message` returned
`message: null` with `human_escalation_active` suppression, and the release
operation returned `resumed` at `entrevista`.

### Discriminate every Lambda request with an operation

**Reason:** CRM control requests already used an explicit operation while
conversational turns were identified only by the absence of that field. The
shared Function URL should have a uniform, unambiguous request envelope.

**Changes:**
- Made `operation: "process_message"` mandatory for conversational requests.
- Kept `operation: "resume_automated_agent"` for CRM ownership release and
  routed the two operations explicitly before their typed validation paths.
- Updated the terminal client, both live evaluation clients, contract tests,
  adapter pseudocode, field mappings, curl examples, README, and integration
  checklist.

**Decision:** Use required operation literals as the clean request
discriminator. Do not accept operation-less conversational payloads while the
integration remains in active development.

**Validation:** `npm run check` passed with 41 test files and 254 tests, and the
development Lambda was redeployed. Live low-cost probes showed
`process_message` reaching the WhatsApp phone validator, an otherwise valid
operation-less turn being rejected specifically at `operation`, and
`resume_automated_agent` still returning `already_active` for the active
synthetic plan.

### Replace timed handoff expiry with explicit CRM release

**Reason:** Human ownership should end when the CRM operator deliberately lets
the automated agent participate again, not after an arbitrary 12-hour timeout
that may fire while a representative still owns the conversation.

**Changes:**
- Removed `human_escalation.bot_suppressed_until`, the 12-hour calculation, and
  automatic elapsed-time resumption from plan state and runtime behavior.
- Added an authenticated `resume_automated_agent` control request keyed by the
  exact persisted `channel` and `user_id` plan identity.
- Added an `AgentParticipationService` that clears handoff state, restores the
  deterministic resume node, and returns idempotent `resumed` or
  `already_active` results without invoking a model or producing a reply.
- Added typed request validation, redacted operation observability, a 404 result
  for missing plans, focused service/contract tests, and a CRM integration
  example.

**Decision:** Keep the automated agent suppressed indefinitely after human
takeover. The CRM backend must use the existing Bearer-authenticated Function
URL to release it; the browser must not hold the channel credential.

**Validation:** `npm run check` passed with 41 test files and 253 tests, and the
development Lambda was redeployed. A live synthetic Dynamo plan was placed in
human ownership; the first authenticated CRM request returned `resumed`, the
retry returned `already_active`, and the persisted plan showed
`human_escalation.status=none`, `current_node=entrevista`, and save reason
`crm_resume_automated_agent` with no timed-suppression field.

### Disable Agent API message writes behind an explicit toggle

**Reason:** The runtime should not persist inbound or outbound conversation
messages through `POST /messages` unless an operator deliberately enables that
integration. Read-only history and human takeover are separate capabilities and
must remain available.

**Changes:**
- Added typed `AGENT_MESSAGE_LOGGING_ENABLED` runtime configuration with a
  default of `false` in TypeScript, CloudFormation, and deployment wiring.
- Gated the Agent Conversation gateway's message-write method before any HTTP
  request, returning a structured disabled result when the toggle is off.
- Preserved `GET /conversations/messages` history retrieval and
  `POST /conversations/request-human` escalation behavior.
- Added gateway coverage proving disabled logging performs no fetch call, and
  updated the runtime and channel documentation.

**Decision:** Gate message persistence at the HTTP gateway boundary so every
current or future caller is covered. Keep the switch independent from Agent API
history and human escalation instead of disabling the entire gateway.

**Validation:** `npm run check` passed with 40 test files and 248 tests. The
development stack was redeployed with the Lambda environment value set to
`false`. A scoped live turn returned HTTP 200, recorded the message-log action
as `skipped` with reason `disabled`, and left the synthetic phone's Agent API
history count unchanged at zero before and after the turn.

### Add overlap-safe channel bearer rotation

**Reason:** A second channel credential was needed without interrupting the
adapter that still uses the existing bearer token. Replacing the one accepted
value immediately would turn a normal key migration into a channel outage.

**Changes:**
- Changed Lambda channel authentication to resolve and accept the standard
  Secrets Manager `AWSCURRENT` and `AWSPREVIOUS` stages from the same secret.
- Kept constant-time digest comparison across every accepted opaque token.
- Made deployment secret synchronization idempotent so unchanged deployments
  do not create redundant secret versions or displace the useful previous key.
- Added a rotation command that generates a token without printing it, stores
  it in the ignored `.env`, and publishes it through Secrets Manager.
- Updated integration and operational documentation with the overlap workflow
  and explicit retirement requirement.

**Decision:** Use AWS Secrets Manager staging labels rather than a custom JSON
key array or a second secret. One secret remains the source of truth, while the
standard current/previous labels provide a bounded two-token migration window.

**Validation:** `npm run check` passed with 40 test files and 247 tests. The
development Lambda was first deployed with the existing token, the channel
secret was rotated, and Lambda was deployed again to refresh its cached key
set. Live low-cost probes returned the typed request-validation `400` for both
`AWSCURRENT` and `AWSPREVIOUS`, while a random bearer token returned `401`.

### Standardize channel authentication on HTTP Bearer

**Reason:** The WhatsApp adapter used the standard `Authorization: Bearer`
scheme while Lambda only inspected a custom `X-API-Key` header. Valid adapter
credentials therefore appeared absent and every runtime request returned 401.

**Changes:**
- Replaced the custom header parser with strict, case-insensitive Bearer scheme
  parsing and constant-time opaque-token validation.
- Added the standard `WWW-Authenticate: Bearer realm="recap-agent"` challenge to
  401 responses and changed redacted request telemetry to distinguish header
  presence from a valid Bearer credential shape.
- Updated Function URL CORS, terminal and eval clients, tests, request examples,
  adapter pseudocode, README guidance, and the live integration contract.

**Decision:** `Authorization: Bearer <CHANNEL_API_KEY>` is the only supported
channel authentication contract. Do not retain an `X-API-Key` compatibility
path while the integration is under active development.

**Validation:** `npm run check` passed with 40 test files and 246 tests. The
development Lambda and Function URL CORS configuration were redeployed. Live
non-mutating probes confirmed that missing credentials and the removed
`X-API-Key` contract both return 401, while a valid Bearer token advances to the
typed WhatsApp request validator and returns the expected missing
`contact_phone` 400. CloudWatch records the corresponding authorization-header
and bearer-token presence booleans without storing credentials.

### Make the Lambda boundary diagnosable and keep Agent API credentials private

**Reason:** A WhatsApp message was stored upstream twice, while all six related
Function URL invocations returned an opaque 4xx and produced no plan or perf
record. The adapter's direct Agent API write also made it appear that successful
message storage proved successful runtime authentication, and Lambda-side
outbound logging could record a generated reply before Meta delivery was known.

**Changes:**
- Added one redacted `channel_request_completed` structured record per Lambda
  invocation with status, typed outcome, validation issues, duration, delivery
  action, and hashed correlation identifiers.
- Imported the existing runtime log group into CloudFormation, configured JSON
  application logs, reduced routine system-log volume, and set 7-day retention
  without adding a paid dashboard or custom metrics.
- Removed Lambda-side outbound Agent API logging while preserving inbound
  logging and Agent API history reads used by the response classifier.
- Clarified that channel adapters use only `CHANNEL_API_KEY`; Lambda alone
  resolves `SE_API_KEY` from Secrets Manager for private downstream operations.

**Decision:** Keep distinct credentials across trust boundaries, but expose only
the channel credential to adapters. Make Lambda the sole owner of authenticated
inbound Agent API logging and make the delivery adapter authoritative for
outbound messages actually sent through Meta.

**Validation:** `npm run check` passed with 40 test files and 245 tests. The
existing log group was imported without replacement, the development Lambda was
redeployed, and CloudFormation applied seven-day retention. Live non-mutating
probes produced a redacted `unauthorized` record for HTTP 401 and an
`invalid_request` record whose only issue identified missing `contact_phone` for
HTTP 400. Lambda advanced logging reports JSON format, application level
`INFO`, and system level `WARN`.

## 2026-07-10

### Surface response-classifier decisions in the terminal demo

**Reason:** The Bun terminal exposed classifier token usage in the detailed trace, but it did not clearly present the decision and did not send a canonical phone number for production Agent API conversation context.

**Changes:**
- Added `--contact-phone` and `TERMINAL_CONTACT_PHONE` to the developer CLI and included `contact_phone` in Lambda turns.
- Added a prominent response-classifier panel showing mode, predicted and actual delivery, action, reason, context source, prior-outbound evidence, and fallback status.
- Added the same classifier detail and classification latency to the trace table, plus a two-turn demo recipe using a dedicated phone number.

**Decision:** Keep `user_id` as the plan identity and treat the optional international phone as the explicit Agent API context identity. Do not infer a phone from an arbitrary terminal user id.

**Validation:** `npm run check` passed with 37 test files and 232 tests. `npm run terminal -- --help` exposes `--contact-phone`, and a safe live terminal turn rendered the new classifier panel with `mode=observe`, `prediction=SEND`, `actual_delivery=SEND`, `context=local_plan`, and `fallback=false`. The existing model probe separately confirmed `suppress_reaction` for `👍` with prior outbound Agent API context.

## 2026-07-09

### Add context-aware reply suppression

**Reason:** The runtime should avoid unnecessary acknowledgements and reaction replies without risking silence on requests, questions, corrections, or event-planning work.

**Changes:**
- Added a native OpenAI SDK Structured Outputs classifier using `gpt-5.4-nano`, a Spanish prompt stored with the `deteccion_intencion` node, bounded plan/message context, and a strict fail-open response policy.
- Wired the verified production Agent API conversation endpoint into classifier preflight, inbound/outbound message logging, and silent human-handoff follow-up handling.
- Added `observe` and `enforce` delivery modes, an explicit `{ action, reason }` channel delivery contract, classifier trace/perf/token/cost telemetry, seed evaluation labels, and focused unit/service coverage.
- Added CloudFormation and deployment configuration for `OPENAI_RESPONSE_CLASSIFIER_MODEL` and `RESPONSE_CLASSIFIER_MODE`, defaulting to `observe` without adding credentials or IAM permissions.

**Decision:** Semantic suppression is LLM-structured and only allowed with prior outbound context. Any Agent API, classifier, schema, prompt, or model failure sends the normal reply. Existing human escalation now logs inbound follow-ups and remains silent to avoid bot interference.

**Validation:** `npm run check` passed with 37 test files and 232 tests. Development deployment completed with `OPENAI_RESPONSE_CLASSIFIER_MODEL=gpt-5.4-nano` and `RESPONSE_CLASSIFIER_MODE=observe`. The production history probe returned `200` and five messages for `GET https://api.sinenvolturas.com/api/agent/conversations/messages?phone_number=51991347878`. A scoped observe-mode Lambda smoke turn returned `200`, delivered a normal reply, and recorded a non-fallback classifier trace with 296 tokens. `enforce` remains blocked on the documented promotion gate.

## 2026-07-07

### Use the verified production Agent API route

**Reason:** The documented development Agent API base URL did not expose the required routes. Read-only probes against the production host confirmed that the configured `X-Agent-Key` is valid and that the conversation endpoint is live.

**Changes:**
- Changed the Agent API default base URL in runtime config, CloudFormation, deployment script, environment example, and operational documentation to `https://api.sinenvolturas.com/api/agent`.

**Decision:** Use the verified production Agent API route until the backend team deploys and confirms an equivalent isolated development route. Keep the dedicated service key in Secrets Manager; do not reuse guest authentication tokens.

**Validation:** `GET /api/agent/conversations/messages?phone_number=51991347878` returned `200` with the configured `SE_API_KEY` and `401` with an invalid or absent key. The same documented route on `https://se-v2-api-dev.jnq.io/api/agent` returned `404`, independent of the supplied phone number or key.

### Redesign thesis conference poster

**Reason:** The conference poster needed to be A0 landscape, remove the UTEC logo, and present the agent architecture and evaluation results with a more visual, less text-heavy structure.

**Changes:**
- Added a self-contained LaTeX poster under `docs/thesis/poster/` using the original `tikzposter` template style, with A0 landscape layout, four adapted columns, metric cards, architecture figure, recommendation funnel, and a non-overlapping state diagram.
- Copied the provided architecture PNG into the poster figure directory for reproducible local builds.
- Removed the previous logo-dependent title treatment and kept only textual affiliation.
- Installed the missing TinyTeX dependencies needed by the original template path: `tikzposter`, `ae`, `extsizes`, and `a0poster`.
- Routed state-diagram arrows around node boxes and added a compact technical-contributions block to reduce left-column empty space without adding extra diagrams.

**Decision:** Keep the original `tikzposter`-based visual language instead of the interim dependency-light workaround. Limit the poster to the architecture figure and state diagram as the main visuals, using tables and metric cards for the rest to avoid over-diagramming.

**Validation:** Built `docs/thesis/poster/recap-agent-poster.tex` with the bundled LaTeX compile workflow and rendered the one-page PDF to PNG for visual inspection. The final render is A0 landscape, includes the state diagram, has no visible overlapping content, and keeps the UTEC logo out of the poster.

### Wire Agent API service key through Secrets Manager

**Reason:** Development now has the dedicated Sin Envolturas Agent API key in local `.env` as `SE_API_KEY`, so Lambda should use a service credential from Secrets Manager instead of carrying a temporary feature gate or reusing user validation credentials.

**Changes:**
- Updated deployment to require `SE_API_KEY`, publish it to Secrets Manager as `recap-agent/se-api-key`, and pass the secret ARN to the runtime stack.
- Added CloudFormation parameters, Lambda environment, and IAM permissions for `SE_API_SECRET_ID`.
- Updated Lambda bootstrap to resolve the SE service key from Secrets Manager and always construct the HTTP Agent API gateway in deployed runtime.
- Reworked secret caching so OpenAI and SE credentials are cached independently.
- Removed the Agent API staging switch from config, docs, examples, and gateway skip reasons.
- Hardened deploy-time secret publishing so AWS CLI reads secret values from temporary `0600` files instead of command-line arguments.

**Decision:** Agent API calls use only the dedicated `X-Agent-Key` service credential from Secrets Manager. The guest/user validation bearer token remains scoped to guest/event validation and is not reused.

**Validation:** `npm run check` passed after the change. Non-mutating live probes with `SE_API_KEY` against `GET /conversations/messages`, `GET /messages`, and `GET /conversations/request-human` on `https://se-v2-api-dev.jnq.io/api/agent` all returned `404 Ruta no encontrada`, so the dev route mismatch remains independent of the credential. `npm run deploy` published the `recap-agent/se-api-key` secret and updated `recap-agent-runtime`; Lambda now has `SE_API_SECRET_ID` set and no legacy staging-switch or direct Agent API key environment variables.

### Stage human escalation without requiring Agent API credentials

**Reason:** The human-operator handoff endpoints are needed for the WhatsApp-style workflow, but live probes against the documented development `/api/agent` routes returned `404`/`405` route mismatches instead of the documented authenticated responses. The integration should be ready in code while avoiding a hard dependency on an unconfirmed `X-Agent-Key` or route deployment.

**Changes:**
- Added `solicitar_humano` and `solicitar_agente_humano` as first-class intent/node state for human review requests.
- Added persisted `human_escalation` state to plans with requested status, timestamp, phone number, and last error.
- Added a typed Agent API gateway with no-op and HTTP implementations.
- Routed explicit human-support requests into a deterministic local soft-pause that avoids provider search and future bot continuation.
- Updated Spanish extractor and node prompts so human-support requests are not treated as FAQ.
- Added unit coverage for no-op escalation, HTTP gateway auth/method/malformed/retry behavior, and service soft-pause behavior.

**Decision:** Do not reuse the guest/user validation bearer token. It is user-scoped and belongs to the event lookup flow; the Agent API must use a separate service-style `X-Agent-Key`.

## 2026-06-26

### Activate shared assistant personality

**Reason:** The reviewed personality prompt needed to apply to every runtime
conversation, not remain as a review-only artifact. Feedback also requested a
slightly warmer chat feel with limited emoji use and no final plain period so
messages feel less robotic.

**Changes:**
- Added `prompts/shared/agent_personality.txt` to `conversationSharedPromptFiles`
  so every node prompt bundle includes the same personality guidance.
- Kept extractor prompts free of conversational personality guidance.
- Added explicit shared style rules for moderate emoji use and avoiding a final
  plain period.
- Added final outbound sanitization so delivered assistant messages do not end
  with a plain period even when generated by structured renderers.
- Added prompt-loader and service regression tests for bundle inclusion,
  prompt-cache invalidation, non-contradiction, and final-period behavior.

**Decision:** Place personality before `output_style.txt` in the shared prompt
order so the style file can reinforce, but not contradict, the personality.
Prompt bundle ids already hash file paths and content, so personality edits
invalidate cached prompt bundles deterministically.

## 2026-06-24

### Add Notion planning dates to milestone activity handoff

**Reason:** The activity-report handoff needed to include the planning phase
documented in Notion, starting on 2026-03-19, before the implementation
activities.

**Changes:**
- Added a chronological planning block covering charter definition, marketplace
  API capability mapping, OpenAI Agent Builder validation, request/response tool
  pattern design, architecture decision, architecture design, and implementation
  kickoff.
- Added copy-ready planning activity rows with suggested dates and locations.
- Updated the short-table summary so planning activities appear before
  implementation activities.

**Decision:** Keep Notion source names as agent-only context and instruct the
final report filler not to copy source names or mention Notion in the submitted
format. No Lambda redeploy was required because this was documentation-only.

## 2026-06-23

### Draft agent personality prompt

**Reason:** The ATC/Notion customer-service response samples added to the FAQ
knowledge base show a warmer, more practical support voice than the current base
prompt captures. A standalone review artifact was needed before making any
runtime prompt change. The draft was then rewritten using current OpenAI
prompting guidance: keep personality instructions concise, specific, structured,
easy to review, and covered by evals before publishing.

**Changes:**
- Added `prompts/shared/agent_personality.txt`, a Spanish direct-address
  personality guide derived from the ATC chat templates and existing shared
  output-style constraints.
- Reworked the draft into a system-prompt-style artifact with compact principles,
  situation-specific tone rules, and a few high-signal positive/negative examples.

**Decision:** Keep the personality file out of `conversationSharedPromptFiles`
for now so the team can review wording before it affects Lambda behavior. No
development Lambda redeploy was required because this prompt is not consumed by
the runtime yet.

Validation:
- Reviewed current OpenAI prompting guidance for tone, personality blocks,
  code-managed prompts, and eval-backed prompt iteration.
- Reviewed the active ATC chat templates generated by the local export parser.
- Confirmed the new file is not referenced by the prompt manifest.

### Replace report image placeholders and architecture figure

**Reason:** Final report assets were added for UTEC, Sin Envolturas, and the
AWS/OpenAI architecture diagram. The report needed to use those assets directly
instead of the temporary logo placeholders and the earlier TikZ architecture
figure.

**Changes:**
- Replaced report header and cover logo references with the provided UTEC PNG and
  Sin Envolturas JPEG assets.
- Converted the provided draw.io architecture SVG into a report-ready SVG/PDF
  derivative with a widened canvas and fixed light-mode colors.
- Replaced the first architecture figure with the converted architecture PDF.
- Restored an `Images/README.md` that documents the editable source diagram and
  the generated LaTeX asset.

**Decision:** Keep the original draw.io SVG as the editable source and commit a
PDF derivative for reliable `pdflatex` builds. No Lambda redeploy was required
because this was documentation-only.

Validation:
- Rebuilt the LaTeX report through the full BibTeX cycle.
- Rendered the cover and diagram pages to PNG for visual inspection.

## 2026-06-22

### Architecture and implementation report

**Reason:** The thesis deliverable needed a detailed Spanish academic technical
report describing the current `recap-agent` architecture and implementation,
using the repository as authoritative evidence plus implementation logs, docs,
analysis dossiers, Notion context, and AWS development deployment state.

**Changes:**
- Added a Sullivan-template-based LaTeX report under `docs/thesis/architecture-report/`.
- Copied the report template class, bibliography file, and image assets into the
  repo so the report is git-trackable and self-contained.
- Adapted the copied class locally for the installed TinyTeX package set while
  preserving the report structure.
- Added native LaTeX/TikZ architecture, state-machine, and turn-pipeline diagrams.
- Added an analysis dossier documenting sources, AWS checks, Notion checks, and
  repeatable build commands.

**Decision:** Keep the report body at architecture level without direct code
excerpts or code-file references, while still grounding claims in the current
implementation and deployed development environment.

Validation:
- `pdflatex -interaction=nonstopmode -halt-on-error recap-agent-architecture-report.tex`
- `bibtex recap-agent-architecture-report`
- Two final `pdflatex` passes; final log check found no unresolved references,
  no empty bibliography, and no overfull boxes.

## 2026-06-19

### Batch 3 objective feedback fixes

**Reason:** Batch 3 feedback exposed objective failures in routing, provider
selection state, auth-code recovery, output hygiene, contact validation, FAQ
retrieval guidance, and turn observability. DynamoDB perf logs also lacked final
assistant-output evidence, which made wording regressions dependent on screenshots.

**Changes:**
- Added privacy-aware outbound observability to turn perf records: assistant
  message length/hash/redacted preview, quality flags, structured message kind,
  redacted tool input/output previews, and provider result summaries.
- Added a CloudFormation/config flag, `PERF_CAPTURE_ASSISTANT_PREVIEW`, to control
  redacted assistant preview capture while preserving TTL-based retention.
- Centralized outbound rendering through one service helper and sanitize leaked
  `filecite turnN file N` artifacts before channel delivery or logging.
- Mapped internal missing-field ids to user-facing Spanish labels in extractor and
  reply prompt snapshots.
- Changed guest-event auth follow-ups in an active `code_requested` state to resend
  the code instead of dead-ending on "send me the code".
- Tightened provider alias resolution so generic first tokens such as "baby" cannot
  coerce unknown provider names like Baby Baloo into Baby Loli, while preserving
  meaningful first-name provider selection.
- Fixed contact phone validation precedence so a valid international phone in raw
  user text can clear a local/partial model extraction.
- Strengthened Spanish extractor and FAQ prompts for event-specific lookup,
  confirmed/invited guest questions, unknown provider preservation, unselect/defer
  operations, multi-front handling, and batch-3 FAQ retrieval topics.
- Added regression coverage in service, prompt-loader, OpenAI runtime snapshot, and
  perf-trace tests.

**Decision:** Keep conversational flow decisions grounded in structured extraction
and state-machine evidence. Deterministic logic was limited to validation,
sanitization, logging, and already-established auth/plan states.

Validation:
- `npm run check`
- `npm run deploy`
- Live Lambda smoke for "Tengo un problema con mi evento" routed to
  `consultar_evento_invitado`.
- DynamoDB perf smoke confirmed persisted assistant-message preview/hash/quality
  fields and structured message kind.

## 2026-06-16

### Make live FAQ ATC assertions paraphrase-tolerant

**Reason:** The live FAQ KB source eval used brittle exact Spanish surface forms
for ATC gift-claim guidance, while the deployed Lambda can validly paraphrase the
same facts.

**Changes:**
- Replaced exact ATC containment phrases with regex assertions that still require
  the no-obligation/no-responsibility-to-buy fact.
- Added a paraphrase-tolerant claim-handling regex that requires a claim/problem
  signal tied to the brand, product, Shop, or store context.
- Left the official Tawk.to card-commission assertions unchanged.

**Decision:** Keep the assertion fact-specific rather than generic, but allow
valid Spanish paraphrases from live model output.

### Strengthen live FAQ KB source assertions

**Reason:** The live FAQ KB source eval had permissive source markers, so it could
pass on generic text when the local semantic judge was skipped.

**Changes:**
- Tightened the official Tawk.to FAQ assertion to require the exact card-payment
  facts for foreign cards: `3.70% + IGV / IVA` and `0.40 USD + IGV / IVA`, plus
  the payment-method/foreign-card context.
- Tightened the ATC suggested-response assertion to require the gift-claim policy
  facts: the user is not obligated to buy the gift and product/Shop claims go
  directly through the product brand.

**Decision:** Keep content-marker assertions instead of full-response equality so
the live answer can vary while still proving both retrieved source families were
used.

### Add live FAQ KB source coverage eval

**Reason:** The FAQ knowledge base needed a token-consuming live validation that
confirms answers can use both preserved official Tawk.to FAQ snippets and the new
ATC/Notion suggested-response template snippets.

**Changes:**
- Added `live.faq_kb_sources_official_and_atc`, a live FAQ flow that asks for
  card-payment commission details and gift/product claim guidance in one turn.
- Added the focused `live_faq_kb_sources` suite for targeted live validation.
- Asserted the `consultar_faq` route, `file_search` usage, absence of provider
  search/results, FAQ trace retrieval output, official commission markers, ATC
  gift-claim markers, and a semantic both-source coverage rubric.

**Decision:** Keep this as a dedicated live suite so the source-coverage eval can
be run independently from the broader live benchmark while still consuming the
real deployed Lambda/runtime target.

### Refresh entrypoint planning live-smoke expectation

**Reason:** The live smoke case for a known event planning opener had a stale node
expectation. Current event-plan-first routing can validly enter multi-need
elicitation without performing provider search.

**Changes:**
- Updated `entrypoint.event_known_no_active_need` to allow either `entrevista` or
  `elicitacion_necesidades` as the first transition.
- Corrected the Spanish input from `un boda` to `una boda` so the event type
  assertion continues to validate a known-event opener.
- Kept the no-provider-search assertion to continue guarding against premature
  provider lookup.

**Decision:** Treat the observed `contacto_inicial->elicitacion_necesidades`
transition as valid planning behavior and avoid runtime routing changes.

### Scope ATC supplemental FAQ knowledge-base cleanup

**Reason:** The supplemental ATC FAQ sync reused full FAQ replacement cleanup, so
uploading only ATC response-sample files could delete unrelated FAQ files from the
same OpenAI vector store.

**Changes:**
- Added optional source-scoping metadata to knowledge-base uploads.
- Configured `sync:faq-atc-kb` uploads with `source: notion_customer_service_templates`,
  `source_kind: response_sample`, `channel: chat`, and `status: Vigente`.
- Scoped ATC cleanup to only stale vector-store files with the same ATC source,
  preserving existing non-ATC FAQ files.
- Added regression tests that mock vector-store files and verify old FAQ files survive
  while stale ATC files can be removed.

**Decision:** Keep normal FAQ sync cleanup behavior unchanged when no cleanup source
scope is configured; only supplemental ATC sync uses source-scoped cleanup.

### ATC supplemental FAQ knowledge-base templates

**Reason:** Customer-service response samples exported from ATC/Notion should enrich
FAQ file-search retrieval without changing deterministic conversational routing.

**Changes:**
- Added a local-export source seam and parser for ATC template CSV/markdown exports.
- Normalized eligible Chat/Listo/Vigente templates into standalone supplemental FAQ
  markdown files for vector-store ingestion, excluding Desestimado templates by
  default and reporting missing triggers as quality debt.
- Added generation and sync scripts for the supplemental KB output directory.
- Updated the `consultar_faq` prompt to follow retrieved customer-service samples
  closely when they fit the user's question.
- Added tests for ingestion counts/drop rules, trigger handling, no runtime trigger
  routing, and KB/provider vector-store separation.

**Decision:**
- Keep triggers as semantic retrieval hints inside generated KB documents only; do
  not introduce exact-string or keyword routing for conversational flow decisions.
- Generate separate supplemental files instead of appending to existing FAQ docs.


## 2026-05-14

### Canonical schema normalization

**Reason:** Event type, provider price level, decision nodes, provider summaries,
location matching, and generated actions were still crossing module boundaries as
loose strings. That allowed prompt variation such as "matrimonio", "baby shower",
or "$$$" to drift into stored plans, eval fixtures, ranking logic, and rendered
messages without a single canonical parse boundary.

**Changes:**
- Added canonical Zod-backed modules for event types, price levels, and
  country-only location keys.
- Changed plan, extraction, eval, and provider-fit contracts to use canonical
  event type ids instead of free-form event strings.
- Changed provider summaries to use the shared `providerSummarySchema` from
  `core/provider.ts`, with canonical provider categories and price levels.
- Normalized Sin Envolturas API price symbols into `low`, `mid`, `high`, and
  `very_high`; rendering converts them back to user-friendly symbols.
- Replaced budget-fit scoring based on string length with scoring over the
  canonical price-level schema.
- Centralized country-key matching for vector filters, provider sync attributes,
  and provider gateway location scoring.
- Added `decisionNodeSchema` and made plan/eval node fields fail fast on invalid
  decision node strings.
- Removed generated `actions` from structured message schemas, renderer output,
  and prompt response contracts. Flow control now stays driven by typed intents,
  selected provider hints, node state, and persisted plan state.
- Removed model authority over `providerFitCriteria.budgetTier`; runtime budget
  parsing now computes the ranking tier from `budgetSignal`.
- Migrated tests and eval fixtures atomically to canonical event and price values.

**Decision:**
- Use the existing repo pattern of const tuple values plus `z.enum(...)` and
  inferred TypeScript types as the runtime contract. No backward compatibility
  shim was added for non-canonical enum strings.

Validation:
- `npm run check`
- `npm run eval -- --suite dev_regression --target offline`

## 2026-05-07

### Multiple providers per need

**Reason:** A single event need can naturally require contacting more than one
provider, but the plan model stored only one `selected_provider_id` and one
`selectedProviderHint`. That made plural choices like "EDO y 4Foodies" lossy and
kept the multi-intent path focused on one provider even when the user selected
several before opening another need.

**Changes:**
- Replaced singular selected-provider plan fields with arrays:
  `selected_provider_ids` and `selected_provider_hints` on both each
  `provider_needs` entry and the active-need top-level projection.
- Updated extraction contracts, prompt snapshots, trace summaries, terminal debug
  output, and eval schemas to use `selectedProviderHints` / selected-provider arrays.
- Reworked provider selection resolution in `agent-service.ts` to support multiple
  ordinal choices, multiple name/alias matches, fallback alias scanning for
  secondary-intent selection turns, grouped selections by need, and deduped appends.
- Updated shortlist replacement behavior so a fresh shortlist can clear previous
  selections for that need, while unrelated need updates preserve existing selections.
- Updated `finish_plan` to create one quote request per selected provider across
  every selected need; `no_selected_providers` now only applies when all arrays are
  empty.
- Updated Spanish extractor and node prompts for plural selection, including
  examples like "la primera y la tercera" and "EDO y Dulcefina".
- Added unit, service, finish-tool, and offline eval coverage for multi-provider
  selection and selection-plus-new-need turns.
- Added new eval cases:
  `selection.choose_multiple_catering_from_shortlist` and
  `multi_need.select_two_caterings_and_open_music`; both are included in
  `dev_regression`.

**Decision:**
- Use a clean array-based plan shape as the durable model. A narrow load-boundary
  normalization remains only to tolerate legacy persisted/local seed objects while
  converting them into the new array shape immediately.

Flow nodes affected:
- `deteccion_intencion`
- `usuario_elige_proveedor`
- `anadir_a_proveedores_recomendados`
- `seguir_refinando_guardar_plan`
- `recomendar`
- `crear_lead_cerrar`

## 2026-05-05

### Multi-intent extraction with provider selection heuristics

**Reason:** When a user combines provider selection with a new need in one message
(e.g., "ok quiero a dj pulga. ahora ayudame con catering. tienes algo para tortas?"),
the extractor only supports a single `intent` field, forcing the LLM to choose one
primary intent. This caused `selectedProviderHint` to be lost when the primary intent
was `buscar_proveedores` instead of `confirmar_proveedor`. The provider selection
was not captured, and the system failed to mark DJ Pulga as selected for Música.

**Changes:**
- Added `secondaryIntents` field to extraction schema (`ExtractionResult`, Zod schema,
  and `openai-agent-runtime.ts`): allows the LLM to express additional intents beyond
  the primary one. For example, `intent: buscar_proveedores` with
  `secondaryIntents: ["confirmar_proveedor"]` when a user selects a provider AND
  requests a new need.
- Added `resolveEffectiveSelectionHint()` heuristic in `agent-service.ts`: when
  `confirmar_proveedor` appears in primary or secondary intents but
  `selectedProviderHint` is null, scans the user message for provider name aliases
  from the shortlist using existing `providerAliases()` and
  `normalizeSelectionText()` matching. Auto-fills the hint as a fallback.
- Updated `tryResolveSelection` call site to use effective hint instead of raw
  extraction field.
- Strengthened multi-intent guidance in `prompts/extractors/normalization_rules.txt`:
  new "multi-intención" section with explicit examples for combined selection + need
  switch messages. Instructs the LLM to always fill `selectedProviderHint` when
  referencing a shortlist provider, regardless of primary intent.
- Updated `prompts/extractors/field_definitions.txt`: added `secondaryIntents` field
  definition with usage guidance.
- Updated `prompts/extractors/conflict_resolution.txt`: references `secondaryIntents`
  for combined selection + need switch scenarios.

### Fix vector search category filter case mismatch, search funnel transparency, and category prompt enforcement

**Reason:** Vector search for providers returned 0 results when category filters were applied because `buildProviderVectorSearchFilters` used `normalizeKey()` on category values (lowercasing them, e.g., "catering") while the vector store stored `category_key` as the exact canonical value (e.g., "Catering"). OpenAI's vector store filter matching is case-sensitive, so the filter never matched. Dulcefina (id=94, Catering category, tortas specialist) was consistently missed. Additionally, the agent was inventing non-canonical category names like "decoración" instead of using canonical names like "Hogar y deco".

**Changes:**
- Fixed `buildProviderVectorSearchFilters` in `provider-vector-search.ts`: removed `normalizeKey()` from category filter values, using exact canonical values returned by `resolveSearchCategories()` instead. The `country_key` filter continues using `normalizeKey()` since the uploader stores country keys lowercased via `attributeKey()`.
- Added search funnel debug logging (`[search-funnel]` prefix) throughout `sinenvolturas-gateway.ts` and `provider-vector-search.ts`: logs vector query details, raw hit count, enriched provider count, and API fallback triggers.
- Strengthened category enforcement in `prompts/extractors/field_definitions.txt`: `vendorCategory`, `vendorCategories`, and `activeNeedCategory` now explicitly list the 17 canonical category values and require exact matches. Added known user-expression mappings (e.g., "decoración" → "Hogar y deco").
- Implemented true parallel vector search in `ProviderVectorSearchGateway.search()`: when `resolveSearchCategories` returns multiple categories (bucket expansion like "Catering" → `["Catering","Licores"]`), each category fires its own vector search with the FULL `maxResults` budget. Results are merged, deduplicated, and sorted globally by score so representation is score-driven, not quota-driven.
- Added `buildLocationFilter()` helper and updated `buildProviderVectorSearchFilters()` to reuse it.
- Updated `prompts/nodes/recomendar/response_contract.txt`: agent must mention actual canonical categories represented in results (e.g., "Catering y Licores") instead of bucket names.

## 2026-05-06

### Vector-first provider search, category buckets, and trace fixes

**Reason:** Provider search returned only 3 results when 6 existed because API-first hybrid search used a single-page term-iteration fallback and strict country filtering excluded providers without location metadata. Category suggestions were unanchored, leading to non-canonical names. FAQ node injected full provider context unnecessarily, wasting tokens.

**Changes:**
- Restructured `searchProvidersHybrid` to vector-first: run vector search, enrich results, return if any found; API fallback only when vector returns 0 results.
- Added `categoryBuckets` to `provider-category.ts` with 10 categories + Otros, mapping merged buckets to underlying canonical categories (e.g., "Belleza" → ["Salud y belleza", "Maquillaje"]).
- Added `resolveSearchCategories()` function to expand bucket or canonical names into search categories for parallel vector queries.
- Updated `buildProviderVectorSearchFilters` in `provider-vector-search.ts` to accept `categories[]` array instead of single plan, supporting OR filters for merged categories. Made `country_key` filter inclusive: matches providers with the target country OR with empty country (no location set).
- Increased search limits: `PROVIDER_SEARCH_LIMIT` 5→12, `PROVIDER_VECTOR_MAX_RESULTS` 12→24, `REPLY_PROVIDER_LIMIT` 4→6, `PRESENTATION_PROVIDER_LIMIT` 5→6.
- Injected category bucket names into `entrevista` prompts dynamically via `composeConversationInput`.
- Updated `entrevista/response_contract.txt` to reference canonical bucket list.
- Stripped `providerResults` from `consultar_faq` context to reduce token usage (~3-5K tokens saved per FAQ turn).
- Deduplicated `collectHostedToolCalls` in `openai-agent-runtime.ts` by composite key to prevent duplicate `file_search` traces.
- Fixed duplicate `consultar_faq` node in path by checking if last path entry matches current node before pushing.
- Added `--show-slugs` flag to terminal client for debug output showing provider slugs alongside categories.
- Purged all DynamoDB plans (clean break, no backward compatibility).
- Deployed both runtime and provider sync stacks.

## 2026-05-06

### Fix config validation and wire provider vector store ID end-to-end
- Fixed `src/runtime/config.ts` schema: removed `.min(1)` from `PROVIDER_VECTOR_STORE_ID` and `KB_VECTOR_STORE_ID` so empty strings passed by CloudFormation do not crash Lambda initialization.
- Set `ProviderVectorStoreId` parameter in the `recap-agent-runtime` CloudFormation stack to the active OpenAI vector store (`vs_69f939de45708191bebc5879baba8b8c`).
- Updated `recap-agent-provider-sync-dev` stack to use the same vector store ID so scheduled syncs update the correct store.
- Updated `.env.example` to document `PROVIDER_VECTOR_STORE_ID` and `KB_VECTOR_STORE_ID` as required configurations.
- Updated `docs/provider-vector-search.md` to emphasize that `PROVIDER_VECTOR_STORE_ID` must be set as a CloudFormation parameter and is persisted in the Lambda environment.

Reason:
- CloudFormation passes empty strings for unset parameters, which caused `z.string().min(1)` to throw during Lambda cold start. More importantly, without the ID being persisted in the stack, every deployment would lose the vector store reference and silently fall back to API-only search.

Decision:
- Keep the vector store ID as a first-class CloudFormation parameter. Do not rely on `.env` inside the Lambda — env files are not packaged in the deployment artifact. The ID must flow through CloudFormation → Lambda environment variable → runtime config.

### Enforce shared canonical provider category schema across extraction, KB, and API search
- Created `src/core/provider-category.ts` with a single source of truth: `providerCategoryValues` enum derived from the actual marketplace API category slugs and display names.
- Categories are now exact canonical strings (e.g., `"Fotografía y video"`, `"Catering"`, `"Locales"`) everywhere.
- Changed the OpenAI extractor schema (`extractionSchema`) to use `providerCategorySchema` for `vendorCategory`, `vendorCategories`, and `activeNeedCategory`. The model is now forced to output exact canonical values.
- Updated `src/core/plan.ts` to store `vendor_category`, `active_need_category`, and `providerNeed.category` as the canonical enum.
- Added `normalizeRawPlan` boundary normalization in `src/core/plan.ts` so old plans and API responses are mapped to canonical values at load time.
- Updated `src/runtime/provider-vector-search.ts` to remove the heuristic `categoryAliasKeys` function. Vector search now uses an exact `eq` filter on `category_key`.
- Updated `src/runtime/sinenvolturas-gateway.ts` to normalize API category names to canonical values in `toProviderSummary`. Removed `categoryAliases` heuristic. `categoryMatchScore` now does exact canonical comparison.
- Updated `src/provider-sync/uploader.ts` to store the exact canonical category as `category_key` in vector store metadata.
- Updated `src/runtime/agent-service.ts` to use canonical values in `buildNeedUpdates`, `normalizeCategoryValue`, and `isVenueLikeCategory`.
- Updated `src/evals/case-schema.ts` to enforce canonical categories in offline eval fixtures.
- Updated all test fixtures, eval cases, and prompts to use canonical category values.
- Updated extractor prompts (`prompts/extractors/examples.md`, `prompts/extractors/normalization_rules.txt`) to instruct the model to emit exact canonical category names.

Reason:
- Heuristic alias mapping (`categoryAliasKeys`, `categoryAliases`) was a shortcut that created drift between what the extractor output, what the KB stored, and what the API returned. This led to missed matches and cross-category bleed. A shared enum guarantees that every layer speaks the same category language.

Decision:
- Use the official marketplace display names as canonical values rather than slugs. They are human-readable, stable, and work naturally for both API text search and user-facing rendering. No separate display-name mapping is needed.
- Accept a clean break: old plans with non-canonical categories are normalized at the storage boundary. The KB must be recreated with the new `category_key` values.

Flow nodes affected:
- All nodes that touch provider search or extraction (`entrevista`, `buscar_proveedores`, `refinar_criterios`, `reintentar`, `recomendar`).

## 2026-05-05

### Add hybrid provider vector search
- Added a provider sync pipeline that fetches all provider details, formats one Markdown file per provider, and uploads those files to a dedicated OpenAI vector store with provider metadata attributes.
- Added direct vector-store search for provider retrieval, with configurable `api`, `vector`, and `hybrid` modes.
- Updated the Sin Envolturas gateway to merge API candidates and semantic candidates by provider ID, enrich vector-only hits through the provider detail endpoint, and preserve typed provider summaries before final provider-fit ranking.
- Added provider vector search configuration to runtime config, Lambda bootstrap, deployment parameters, and CloudFormation.
- Added a scheduled provider sync CloudFormation template and local `npm run sync:providers` command.
- Updated the provider sync stack to accept a versioned code artifact key so CloudFormation deploys Lambda code updates reliably.
- Tightened provider vector query formulation with active-need-only multi-query search and category alias metadata filters to improve recall without mixing provider types.
- Documented the provider vector-search architecture in `docs/provider-vector-search.md`.

Reason:
- Filter-based provider search misses matches that are semantically relevant but do not share exact keywords with the user request. Provider details already contain richer descriptions, services, promos, and terms that are better suited for vector retrieval.

Decision:
- Keep the provider API as the source of truth and default to hybrid retrieval. The runtime only uses vector search when a provider vector store ID is configured, so deployments can fall back safely to API-only behavior.

Flow nodes affected:
- `buscar_proveedores`
- `reintentar`
- `recomendar`

## 2026-04-05

### Bootstrap runtime skeleton
- Added project conventions in `AGENTS.md`.
- Added TypeScript, build, and test scaffolding for a serverless agent runtime.
- Locked the architecture around a node-aligned state machine, DynamoDB plan persistence, and a live terminal-to-Lambda path.

Reason:
- The repo started empty, so the first change needed to establish the implementation rules and traceability baseline before code work.

Decision:
- Use DynamoDB as the primary `PlanStore` target from the first slice, while keeping the storage interface portable for tests and future adapters.

Flow nodes affected:
- All nodes indirectly, because this establishes the traceability and implementation rules the flow depends on.

### Implement first vertical slice
- Added the decision-node enum and node-aligned flow service.
- Added structured plan schema, sufficiency rules, provider result summaries, and trace records.
- Added `PlanStore` abstraction with DynamoDB and in-memory implementations.
- Added OpenAI Agents SDK runtime with a conversational agent, a structured extractor, and file-based Spanish prompt loading.
- Added a real Sin Envolturas provider gateway using live read endpoints.
- Added a Lambda handler, a terminal client that targets the live Lambda Function URL, and a CloudFormation stack with Lambda, DynamoDB, and Function URL resources.
- Added tests for sufficiency, prompt integrity, and agent service persistence behavior.

Reason:
- The requested first slice needed to be executable end to end, not just scaffolded, while still excluding the WhatsApp webhook implementation.

Decision:
- Use the real provider API now behind the future MCP-shaped gateway contract, so terminal-driven testing exercises live provider data while keeping the transport abstraction clean.
- Persist the plan both after required extraction nodes and again after reply generation so the stored `conversation_id` remains aligned with OpenAI Conversations.

Flow nodes affected:
- `contacto_inicial`
- `deteccion_intencion`
- `existe_plan_guardado`
- `entrevista`
- `minimos_para_buscar`
- `aclarar_pedir_faltante`
- `buscar_proveedores`
- `busqueda_exitosa`
- `hay_resultados`
- `recomendar`
- `refinar_criterios`
- `usuario_elige_proveedor`
- `anadir_a_proveedores_recomendados`
- `seguir_refinando_guardar_plan`
- `guardar_cerrar_temporalmente`
- `informar_error_reintento`

### Move OpenAI credential access to AWS Secrets Manager
- Added Secrets Manager runtime resolution for the Lambda.
- Updated CloudFormation to create and authorize access to an OpenAI secret.
- Added a tracked deployment script that reads `OPENAI_API_KEY` from local `.env`, syncs it to AWS Secrets Manager, uploads the Lambda artifact to S3, and deploys the stack.

Reason:
- The Lambda is the runtime that calls OpenAI, so the secret must live in AWS rather than in the terminal client environment.

Decision:
- Keep `.env` local and out of git, and use it only as the deployment-time source of truth for secret synchronization.

Flow nodes affected:
- All nodes indirectly, because every runtime call to OpenAI depends on this credential path.

### Replace the thin terminal client with a debug-first Bun CLI
- Replaced the minimal terminal loop with a Bun-first CLI that targets the deployed Lambda Function URL.
- Added CloudFormation output resolution so the CLI can infer the Function URL and plans table by default.
- Added persisted-plan inspection from DynamoDB after each turn.
- Added rich trace and plan rendering for local debugging.
- Added a tracked `.env.example` so defaults are documented while still allowing CLI flags to override them.

Reason:
- The dev tool needs to be informative enough to debug conversations, not just send plain text and print raw JSON.

Decision:
- Keep the CLI on the same deployed runtime path as Lambda by always sending turns to the live Function URL, while using local AWS access only for developer inspection of CloudFormation outputs and persisted plans.

Flow nodes affected:
- All nodes indirectly, because the CLI now exposes node transitions, prompt bundle usage, and persisted-plan state for every turn.

## 2026-04-06

### Rewrite prompt architecture into node contracts
- Replaced the one-file prompt placeholders with multi-file Spanish prompt bundles per node.
- Split conversational prompt composition from extraction prompt composition.
- Added shared flow discipline, question strategy, and anti-pattern prompt files for conversational turns.
- Added extractor-specific prompt files for field definitions, normalization rules, conflict resolution, and examples.
- Scoped tool availability per node in the runtime so the Agents SDK only exposes tools allowed by the current flow step.
- Added prompt loader tests that verify bundle structure and extractor isolation.

Reason:
- The original prompt files were too thin and too loosely coupled to the runtime, which made node behavior improvised and hard to audit against the thesis flow.

Decision:
- Keep prompt files as plain Spanish text under `prompts/`, but make the runtime enforce the same structure through the manifest so prompt traceability is behavioral, not just nominal.

Flow nodes affected:
- `contacto_inicial`
- `deteccion_intencion`
- `existe_plan_guardado`
- `entrevista`
- `minimos_para_buscar`
- `aclarar_pedir_faltante`
- `usuario_responde`
- `buscar_proveedores`
- `busqueda_exitosa`
- `hay_resultados`
- `recomendar`
- `refinar_criterios`
- `usuario_elige_proveedor`
- `anadir_a_proveedores_recomendados`
- `seguir_refinando_guardar_plan`
- `continua`
- `accion_final_exitosa`
- `necesidad_cubierta`
- `crear_lead_cerrar`
- `guardar_seleccion_reintentar_luego`
- `guardar_cerrar_temporalmente`
- `informar_error_reintento`
- `reintentar`

### Increase Lambda timeout for prompt-heavy runtime turns
- Raised the Lambda timeout in CloudFormation from 30 seconds to 90 seconds.

Reason:
- The deployed runtime timed out on a live invocation after the prompt rewrite, which increased end-to-end turn latency enough to hit the previous limit.

Decision:
- Increase the function timeout now to keep the live serverless path usable while preserving the same runtime architecture.

Flow nodes affected:
- All nodes indirectly, because the timeout applies to the full conversational turn path.

## 2026-04-07

### Add terminal-plan purge utility for DynamoDB
- Added a repo-native purge script for deleting persisted plans created by the terminal test channel.
- Defaulted the script to the `terminal_whatsapp` channel and made it resolve the plans table from CloudFormation or flags.
- Added a `--dry-run` mode and required `--yes` for destructive execution.
- Documented the command in the README.

Reason:
- Terminal-driven testing leaves plan artifacts in the shared DynamoDB table, so the project needs a fast and explicit cleanup path that does not require ad hoc AWS console work.

Decision:
- Implement the purge as a small Node script under `scripts/` instead of an AWS CLI snippet so it stays versioned, reviewable, and aligned with the same stack defaults as the rest of the repo tooling.

Flow nodes affected:
- All nodes indirectly, because the utility deletes persisted plan records regardless of which node last wrote them.

### Centralize runtime configuration and ban explicit any
- Added a project-level convention in `AGENTS.md` that explicit `any` is banned.
- Added ESLint with TypeScript-aware rules so `npm run check` enforces the no-`any` rule through standard linting instead of a custom script.
- Replaced the flat config helper with a validated, centralized runtime config object.
- Moved model names, provider search limits, recommendation limits, detail lookup caps, and default channel settings into the config module.
- Wired Lambda bootstrap, provider gateway, and reply runtime to consume the centralized settings.

Reason:
- Model behavior and runtime knobs were spread across handler defaults, gateway constants, and agent runtime literals, which makes tuning harder and increases drift risk.

Decision:
- Keep configuration environment-driven, but parse it once into a nested typed object so behavior tuning remains explicit and auditable.

Flow nodes affected:
- All nodes indirectly, because the config controls how the runtime searches, recommends, and defaults channel behavior across the full turn path.

### Clarify non-streaming channel scope
- Added a project convention stating that streaming responses are out of scope for now.
- Locked the terminal client to direct WhatsApp-style emulation instead of introducing response patterns the real channel cannot support.

Reason:
- The deployed dev tool should reflect the real channel contract rather than optimizing around terminal-only capabilities that will not exist in WhatsApp.

Decision:
- Keep the runtime synchronous and single-response per inbound turn until a real supported multi-message channel pattern is designed.

Flow nodes affected:
- All nodes indirectly, because this constrains how replies are delivered across the full conversational path.

### Align repo and Lambda runtime to Node 24 LTS
- Updated the Lambda runtime in CloudFormation from `nodejs20.x` to `nodejs24.x`.
- Updated local build targets from `node20` to `node24`.
- Raised the repo engine requirement to Node 24 and added `.nvmrc` for local alignment.

Reason:
- There is no reason to keep the repo and Lambda on an older Node line when the latest available LTS is already supported by the target stack.

Decision:
- Keep the repo and AWS runtime on the same LTS major so build output, local tooling, and deployed execution semantics stay aligned.

Flow nodes affected:
- All nodes indirectly, because the Node runtime applies to the full Lambda execution path.

### Align deployed model defaults with centralized runtime config
- Updated CloudFormation model parameter defaults to match the centralized values in `src/runtime/config.ts`.
- Updated the deploy script to pass explicit model parameter overrides from `.env` or shell env when present.
- Updated `.env.example` and README examples to use the same reply and extractor model defaults as the runtime config.

Reason:
- The Lambda environment is injected by CloudFormation, so stale template defaults could override the centralized TypeScript config at deploy time and produce a different model selection in AWS than the repo suggests locally.

Decision:
- Keep `src/runtime/config.ts` as the canonical runtime config shape, but ensure CloudFormation defaults and deploy-time parameter wiring stay aligned with it so deployed behavior does not drift.

Flow nodes affected:
- All nodes indirectly, because the reply and extractor models govern the full turn path.

### Shift the agent to an event-plan-first model
- Expanded the persisted plan schema to support multiple provider needs plus an active need for the current search or recommendation turn.
- Kept event-level context at the top of the plan while projecting the active need into the legacy single-need fields for runtime compatibility.
- Updated sufficiency, resume logic, provider search, selection handling, and terminal debug output to operate around the active need inside a broader event plan.
- Rewrote the Spanish extractor and node prompts so the agent reasons about the event first and about one active provider need at a time.
- Added an explicit project convention in `AGENTS.md` stating that the agent is event-plan-first and that single-provider search is a subset of that behavior.

Reason:
- The previous runtime was structurally biased toward one provider search at a time, which mismatched the intended product behavior of helping users plan events that often require several providers.

Decision:
- Refactor incrementally toward an event-plan-first model by introducing `provider_needs` and `active_need_category` now, while preserving the existing active-need mirror fields so the deployed runtime, CLI, and traces stay stable during the transition.

Flow nodes affected:
- `deteccion_intencion`
- `entrevista`
- `aclarar_pedir_faltante`
- `recomendar`
- `refinar_criterios`
- `seguir_refinando_guardar_plan`
- `usuario_elige_proveedor`

### Expand the provider tool surface to cover validated marketplace endpoints
- Expanded the provider gateway contract beyond the initial four operations so the runtime can expose the full set of validated marketplace capabilities.
- Added support for category lookup by slug, relevant providers, related providers, provider reviews, event vendor context, event favorites, user events vendor context, tracked provider detail views, quote creation, favorites creation, and provider review creation.
- Updated the Agents SDK tool registry and node prompt manifest so the new capabilities are reachable from the appropriate nodes.
- Updated node tool policy prompts so the conversational layer matches the actual tool surface.

Reason:
- The validated endpoint map in Notion covers more than the initial discovery/search subset, and the runtime should not artificially narrow the system to four operations when the marketplace already exposes a richer capability surface.

Decision:
- Keep the current flow behavior conservative, but expose the full validated endpoint capability set through typed gateway methods and Agents SDK tools so future flow work can build on a stable surface instead of reworking the tool layer again.

Flow nodes affected:
- `entrevista`
- `aclarar_pedir_faltante`
- `buscar_proveedores`
- `recomendar`
- `usuario_elige_proveedor`
- `anadir_a_proveedores_recomendados`
- `crear_lead_cerrar`
- `existe_plan_guardado`
- `reintentar`
- `accion_final_exitosa`

### Improve the first-turn entrypoint for event planning
- Added a first-turn branch so the runtime keeps the conversation in `entrevista` when neither the event type nor an active provider need is known yet.
- Updated the shared and opening Spanish prompts so the agent introduces itself as an event-planning assistant and asks what type of event the user wants to plan before jumping to provider categories.

Reason:
- The previous first reply was still too provider-search-centric and skipped the higher-level event-planning framing that the product now needs.

Decision:
- Keep the existing decision-flow structure, but short-circuit the first missing-data path into `entrevista` whenever the event itself is still undefined. That preserves the node model while fixing the opening behavior.

Flow nodes affected:
- `contacto_inicial`
- `entrevista`

### Enrich recommendation data with provider detail and Sin Envolturas links
- Expanded the typed provider summary model so shortlist items can carry real differentiators from the marketplace, including promo text, service highlights, terms highlights, website URL, min/max price, and the Sin Envolturas detail-page URL.
- Updated the live Sin Envolturas gateway to parse `info_translations`, `promos`, and social-network links into those typed fields instead of leaving them only inside `raw`.
- Enriched provider search results with detail lookups before persisting and recommending them, so the recommendation node receives structured differentiators even when the model does not call detail tools on its own.
- Raised the default recommendation display limit from 3 to 4 and updated the recommendation prompt contract to require concrete differentiators plus the Sin Envolturas link.

Reason:
- The previous recommendation output was too generic because the service persisted shallow search summaries and relied on the model to optionally fetch detail, which often did not happen. That made providers hard to differentiate and omitted direct links to their marketplace pages.

Decision:
- Keep search and recommendation in the same turn, but move provider-detail enrichment into deterministic service logic so the model starts from richer, typed provider records instead of improvising from weak summaries.

Flow nodes affected:
- `buscar_proveedores`
- `hay_resultados`
- `recomendar`

### Fix provider-selection continuity so chosen vendors do not restart search
- Updated the turn orchestration so a provider confirmed by name can be resolved from the active shortlist even when the extractor does not emit an explicit `selectedProviderHint`.
- Changed the post-selection resume path to continue from `seguir_refinando_guardar_plan`, matching the intended state-flow branch after a provider is chosen and saved.
- Allowed the continuity node to use provider detail when the user asks a concrete follow-up about the already selected vendor.
- Added extractor guidance for partial-name selections and a regression test covering the "quiero EDO" path.

Reason:
- The runtime was recognizing `confirmar_proveedor` in traces but still falling back into `buscar_proveedores` and `recomendar`, which broke the Figma state-flow branch where provider choice should transition into saved selection and continuation.

Decision:
- Resolve provider choice deterministically from the current shortlist before any new search is attempted, and treat post-selection follow-ups as continuity work rather than a fresh recommendation cycle.

Flow nodes affected:
- `usuario_elige_proveedor`
- `anadir_a_proveedores_recomendados`
- `seguir_refinando_guardar_plan`
- `recomendar`

### Expose tool outputs in the CLI debug state and add shared domain knowledge
- Extended turn traces to include serialized tool outputs and the provider results that were active for the turn.
- Updated the terminal CLI to render tool outputs and expanded provider debug details, including promo data, services, terms, and URLs.
- Added shared domain-knowledge prompt files for both the conversational runtime and the extractor so all agents inherit local Sin Envolturas terminology, especially around `local` meaning venue/event space.
- Hardened extraction merging so nulls from the extractor do not erase previously known event facts like location, guest range, or event type.

Reason:
- The dev CLI was not exposing enough information to understand why the agent branched a certain way or what data came back from provider search/detail calls. At the same time, the runtime was forgetting previously known facts across turns and re-asking obvious domain concepts like `local`.

Decision:
- Treat full debug visibility as a first-class developer feature by surfacing tool outputs directly in the trace and by keeping provider debug data visible in the CLI without needing raw JSON mode. Treat shared domain knowledge as prompt-level configuration so local terminology is learned consistently by both the reply agent and the extractor.

Flow nodes affected:
- `entrevista`
- `aclarar_pedir_faltante`
- `refinar_criterios`
- `buscar_proveedores`
- `recomendar`

### Preserve mixed provider selections, keep planning mode broader, and harden venue/guest normalization
- Updated the turn orchestrator so a user can confirm a previously recommended provider for one need and open a different active need in the same message without losing the first selection.
- Kept provider confirmation on the selected need while allowing the turn to continue into search/recommendation for the newly active need when appropriate.
- Broadened the interview gating so the runtime stays in `entrevista` whenever the event already exists but no active provider need has been chosen yet, instead of treating the missing category as a search blocker immediately.
- Added deterministic guest-count parsing in the service layer so explicit counts like `100 invitados` map to the correct inclusive range even if the extractor model drifts.
- Strengthened the Sin Envolturas search gateway with category aliases and looser location matching so venue-style queries like `local` can still surface Lima-wide results when the plan contains district-plus-city locations.
- Tightened extractor and interview prompt guidance to preserve mixed-intent turns and to prioritize the event context before asking for provider categories.
- Added regression tests for mixed selection-plus-new-need turns, event-known/no-need planning turns, and the `100 invitados` boundary case.

Reason:
- The live interactions still showed three core failures: confirming one provider while asking for another category only persisted one side of the turn, broad event-planning openings were still treated as missing-category errors, and venue/guest normalization remained brittle enough to trigger unnecessary clarifications.

Decision:
- Keep the multi-need event-plan model, but make selection persistence independent from the currently active need, make the pre-search interview stage handle missing active needs, and add deterministic normalization where exact user input should outrank model inference.

Flow nodes affected:
- `entrevista`
- `usuario_elige_proveedor`
- `anadir_a_proveedores_recomendados`
- `buscar_proveedores`
- `recomendar`
- `seguir_refinando_guardar_plan`

## 2026-04-10

### Add full-marketplace provider completeness census tooling
- Added a reproducible full-census analysis script under `analysis/provider-information-completeness/artifacts/` to crawl the current Sin Envolturas marketplace pagination and fetch every provider detail record.
- Updated the provider-information-completeness dossier to promote full-marketplace conclusions, reproducibility steps, and supporting census artifacts.
- Added a Spanish stakeholder-facing presentation document inside the dossier so the findings can be shared directly without translating the technical notes live.

Reason:
- The earlier category-led sample was good enough for directional guidance, but not for stronger claims about how representative the provider-data issues are across the whole marketplace.
- The dossier had the evidence, but it still needed a concise narrative version that non-technical stakeholders could read quickly.

Decision:
- Keep the original sample artifact for fast spot checks, but treat the census artifact as the default basis for marketplace-wide conclusions about provider differentiation and missing fields.
- Keep the stakeholder presentation in Spanish because it is presentation material for business audiences rather than developer-facing documentation.

Flow nodes affected:
- None directly. This change adds analysis tooling and documentation rather than changing runtime behavior.

## 2026-04-14

### Add exhaustive provider-entry audit artifacts
- Added an exhaustive provider-audit script under `analysis/provider-information-completeness/artifacts/` that exports provider-level JSON and CSV coverage for every current marketplace entry.
- Added field-level, category-level, and collision-cluster artifacts so the dossier can support exact cleanup work rather than only aggregate percentages.
- Updated the provider-information-completeness dossier and stakeholder presentation to reflect the 2026-04-14 full-entry audit.

Reason:
- The earlier census answered marketplace-wide questions, but it still did not provide hard entry-level coverage for all providers or exact issue inventories for remediation work.

Decision:
- Keep the census artifacts as lightweight historical snapshots, but treat the new provider-entry audit as the primary source for exhaustive coverage and cleanup prioritization.

Flow nodes affected:
- None directly. This change adds analysis tooling and documentation rather than changing runtime behavior.

## 2026-04-12

### Add a repo-native evaluation framework for offline and live benchmarking
- Added a typed evaluation subsystem under `src/evals/` covering case schemas, YAML or JSON loading, expectation evaluation, scoring, offline and live targets, reporting, and a CLI entrypoint.
- Added git-tracked evaluation assets under `evals/`, including reusable templates, suite manifests, model matrices, sample fixtures, and seeded regression cases for planning, clarification, recommendation, selection continuity, multi-need continuity, domain knowledge, failure modes, and trace observability.
- Added fixture imports and variable interpolation so cases can reuse seed plans and provider payload fragments instead of duplicating large provider blocks across files.
- Added offline harness support using the real `AgentService` with in-memory persistence plus fixture-backed runtime and provider gateway behavior, and added live Lambda normalization that maps deployed responses back into the same result envelope.
- Added JSONL, JSON, and Markdown report artifacts with aggregate summaries by suite, config, and target plus flaky-case detection.
- Added operator-facing `npm` scripts and documentation for authoring cases, running smoke subsets safely, using dry-runs for cost estimation, and benchmarking across model matrices.
- Added test coverage for schema validation, loader behavior, offline target execution, live target normalization, report generation, and runner-level dry-run and envelope stability.

Reason:
- The agent is still evolving, so the project needed a standardized benchmark harness that can measure state correctness, trajectory quality, tool use, and reply quality without depending on brittle transcript snapshots.
- The repo also needed a shared evaluation language so model, prompt, and orchestration changes can be compared against the same git-tracked cases across offline and live surfaces.

Decision:
- Keep the framework repo-native and TypeScript-first instead of introducing an external evaluation platform as a runtime dependency.
- Use layered expectations and weighted scorers rather than exact response snapshots so the suite stays useful during active development.
- Treat offline evaluation as the default inner loop and live Lambda evaluation as an explicit, budget-aware integration check.

Flow nodes affected:
- None directly. This change adds benchmarking infrastructure, fixtures, documentation, and tests rather than changing the runtime flow behavior itself.

## 2026-04-13

### Reduce extraction and reply token pressure, and expose tool inputs in traces
- Replaced full-plan prompt payloads in the OpenAI runtime with a compact plan snapshot for both extraction and reply composition, preserving key planning fields while removing large duplicated state blocks.
- Added truncation for long conversation summaries in model inputs so summary growth does not linearly inflate prompt size turn by turn.
- Stripped `raw` objects from high-volume tool payloads (`get_provider_detail`, `get_provider_detail_and_track_view`, `list_provider_reviews`) before returning results to the model, reducing tool-context token overhead.
- Extended turn traces with `tool_inputs` and updated the terminal CLI trace renderer to display per-tool inputs and remain robust when older runtime responses do not include the new field.
- Updated project conventions to prefer clean breaks in dev and to redeploy Lambda after Lambda-impacting changes.

Reason:
- Live interactions showed very high token usage and slow extraction latency caused by oversized per-turn context and verbose tool payloads that were not required for model decisions.
- Debugging tool behavior needed both inputs and outputs in the CLI trace, not outputs only.

Decision:
- Keep semantic coverage by sending a compact, purpose-built plan snapshot to models instead of the full persisted plan JSON.
- Remove heavyweight `raw` blobs from tool responses sent to the model while preserving useful structured fields for recommendation quality.
- Treat Lambda redeploy as mandatory in development after runtime-impacting changes to avoid testing stale behavior.

Flow nodes affected:
- `entrevista`
- `aclarar_pedir_faltante`
- `buscar_proveedores`
- `recomendar`
- `reintentar`

## 2026-04-14

### Make search resilient to sparse location granularity and require location in recommendations
- Reworked provider selection in the Sin Envolturas gateway to use category-first matching with location-aware ranking, instead of a strict category+location hard filter that could drop valid providers when location data is coarse.
- Added exact-location preference without forcing zero results: when exact city matches do not exist, category-matching providers with broader location metadata remain eligible.
- Expanded recommendation/output prompt contracts so every shown provider includes location information, and explicitly labels missing location as `Ubicación no especificada`.
- Added a regression test covering the real failure mode where a `Lima` music search returns providers with country-level location (`Perú`) and should still surface options.

Reason:
- Live traces showed users were being sent to refinement despite valid providers existing, because strict location filtering eliminated category-relevant results due to incomplete or coarse marketplace location fields.
- Recommendation messages also needed a stricter contract to always expose location context for decision-making.

Decision:
- Keep precision by preferring exact location matches when present, but preserve recall by falling back to category-relevant candidates when location granularity is insufficient.
- Enforce location visibility at response-contract level so provider cards are always location-explicit to users.

Flow nodes affected:
- `buscar_proveedores`
- `recomendar`

## 2026-04-14

### Tighten zero-result refinement messaging after search-ready turns
- Updated the `refinar_criterios` prompt contract to force explicit acknowledgment that search already ran when `Listo para buscar` is `sí`.
- Required a single concrete closed question after empty results, instead of optional or deferential phrasing.
- Added a guardrail to avoid re-asking the same criterion immediately after the user already relaxed it (for example, budget).
- Updated the `refinar_criterios` system contract so refinement in search-ready context is treated as immediate continuation, not a permission-based next step.

Reason:
- Live terminal traces showed the runtime did execute provider search in search-ready turns, but the conversational reply still used vague "si quieres" follow-ups that sounded like search had not happened and added friction.

Decision:
- Keep search orchestration unchanged in the service layer, and fix the issue at the node prompt-contract level where response behavior is defined.

Flow nodes affected:
- `refinar_criterios`

## 2026-04-14

### Add granular runtime and transport latency tracing in the dev CLI
- Added structured per-stage timing data (`timing_ms`) to turn traces in the runtime service, including plan load, working-plan prep, extraction, extraction-merge, sufficiency, provider search, provider enrichment, prompt loading, reply composition, and persistence.
- Updated terminal CLI rendering to show key timings directly in the reply title (notably extraction and compose latency) and a full timing breakdown in the trace table.
- Added HTTP transport timing in the CLI invocation layer (fetch and JSON parse) so end-to-end latency can be split between network/transport and agent pipeline execution.
- Added token-usage tracing (`token_usage`) for extractor, reply, and combined totals when the runtime exposes usage, and surfaced those values in the CLI trace/debug output.
- Extended eval trace schema validation to include the new `timing_ms` shape.

Reason:
- Live Lambda interactions were taking several seconds and the existing debug output only showed total turn latency, which was insufficient to identify whether delays came from extraction, provider operations, reply composition, persistence, or transport.

Decision:
- Keep instrumentation lightweight and always-on in trace payloads so the same runtime path used in development and evaluation can surface actionable latency breakdowns without adding separate debug codepaths.

Flow nodes affected:
- All nodes indirectly, because latency instrumentation wraps the full turn pipeline regardless of the active decision node.

## 2026-04-16

### Optimize extraction token usage and wire prompt-cache controls
- Reduced extraction input payload size by switching to a compact plan snapshot and removing verbose recommended-provider summaries from the extractor prompt context.
- Added Agents SDK model settings for both extractor and reply calls to set prompt cache retention and send stable prompt cache keys.
- Added GPT-5-specific low-latency defaults (`reasoning.effort: none`, `text.verbosity: low`) through runtime model settings.
- Extended token usage parsing and trace/eval schemas to capture cached input token counts when available.
- Added runtime/deployment configuration for `OPENAI_PROMPT_CACHE_RETENTION` across config parsing, CloudFormation, deploy script wiring, and docs.

Reason:
- Live runs showed extraction taking longer than reply in several turns, with high prompt overhead and poor visibility into cache-hit effectiveness.

Decision:
- Prioritize non-invasive latency/cost reduction by shrinking dynamic extraction context and improving cache routing/retention without changing flow logic or user-facing node contracts.

Flow nodes affected:
- All nodes indirectly, because extraction and reply model calls run on every conversational turn.

### Add CLI cache and latency efficiency insights
- Extended the terminal CLI trace output with a dedicated `Performance Insights` section that reports extraction-vs-compose ratio, pipeline-vs-transport share, and cache-hit-driven savings indicators.
- Enhanced token usage rendering to include cached input tokens, cache hit rate, estimated input-token savings, and effective billed input tokens per extraction/reply/overall bucket.
- Added a compact cache-hit hint in the reply header so optimization impact is visible without scrolling through full traces.

Reason:
- Runtime telemetry now includes cached-token data, but operators still needed a turn-level view that quickly translates raw counters into actionable signals about savings and bottlenecks.

Decision:
- Keep instrumentation in the existing CLI trace surface so optimization validation stays in the normal debugging workflow, without adding separate analysis scripts.

Flow nodes affected:
- All nodes indirectly, because the CLI renders traces for every conversational turn regardless of node.

### Document channel-agnostic architecture and channel adapter contract
- Added `docs/channel-integration.md` with a thorough guide covering:
  - current channel-agnostic boundaries in runtime orchestration,
  - Lambda request/response contract by `client_mode`,
  - telemetry guarantees for all channels,
  - low-cost retention strategy,
  - step-by-step process to implement new consumer-facing channels.
- Updated `README.md` to include a dedicated channel-agnostic and telemetry section, link the new integration guide, and align deployment examples with telemetry retention configuration.
- Updated `docs/evaluation-framework.md` to explicitly document why live eval runs set `client_mode=cli` and how that interacts with telemetry visibility versus telemetry persistence.

Reason:
- The runtime now captures telemetry broadly but only surfaces diagnostics selectively; contributors need one explicit, consistent source of truth for how to implement non-debug channels without losing observability.

Decision:
- Keep channel behavior documented as a strict adapter-layer concern while preserving a channel-agnostic core runtime and always-on server-side telemetry.

Flow nodes affected:
- None directly. This change updates architecture and integration documentation without modifying flow logic.

### Add low-cost turn-level performance telemetry with CLI-only surfacing
- Added a dedicated `logs/trace/perf` module that converts each turn trace into a normalized performance record with derived metrics such as cache-hit rate, extraction-to-compose ratio, tool-call volume, provider-result volume, and hashed user identifiers.
- Added a low-cost telemetry persistence path backed by a dedicated on-demand DynamoDB table with TTL retention (`PERF_RETENTION_DAYS`), plus a no-op fallback store when the table is not configured.
- Updated the Lambda handler to persist telemetry on every turn while only exposing trace and perf diagnostics in the response when the caller explicitly declares `client_mode=cli`, keeping these metrics opaque for non-CLI clients.
- Updated CloudFormation and deployment wiring to provision and configure the perf table and retention controls.
- Updated the CLI to send `client_mode=cli` and render the returned perf snapshot inside debug output.
- Extended the live-eval response schema and live target normalization so end-to-end test runs can validate telemetry payloads on the deployed path.
- Added perf module unit tests plus a live-target test assertion for perf hydration.
- Added an SDK/API compatibility guard for prompt cache retention, translating the configured `in-memory` option into the currently accepted API wire value so deployed runs remain stable.

Reason:
- Feedback quality and runtime cost or latency tuning need durable, structured hard data per turn; trace-only console output was not enough for comparative analysis.
- The project needed this observability with minimal operational cost for a small user base.

Decision:
- Use an always-on per-turn telemetry record persisted to a PAY_PER_REQUEST + TTL DynamoDB table to keep storage and operations inexpensive.
- Keep telemetry output gated behind explicit CLI mode in Lambda responses so runtime observability does not leak by default to non-development clients.

Flow nodes affected:
- All nodes indirectly, because telemetry wraps the full turn lifecycle regardless of active decision node.

### Harden token and cache usage extraction from Agents SDK run results
- Expanded token-usage extraction in `OpenAiAgentRuntime` to parse SDK-native camelCase usage shapes (`state.usage`, `runContext.usage`, and `rawResponses[].usage`) in addition to existing snake_case fields.
- Added fallback parsing for cached tokens from `inputTokensDetails` arrays and `requestUsageEntries`, reducing false `null` usage in traces and CLI perf output.
- Added focused regression tests for run-state usage parsing and request-level cached-token aggregation.

Reason:
- Live CLI sessions still showed `n/a` token and cache fields in turns where model usage should have been available, indicating the parser missed current Agents SDK usage shapes.

Decision:
- Prefer extracting usage from SDK run objects first-class, while keeping existing snake_case compatibility to avoid regressions across provider payload variants.

Flow nodes affected:
- All nodes indirectly, because token and cache telemetry is collected for every runtime turn regardless of active node.

## 2026-04-20

### Implement mixed provider search strategy to maximize coverage
- Updated `SinEnvolturasGateway` search flows to query both `GET /filtered` and `GET /filtered/full` for the same allowlisted search inputs and merge results by provider id.
- Added endpoint-specific normalization for `/filtered/full` items so the runtime can preserve richer promo and description snippets when present.
- Added deterministic merge rules that prefer richer metadata from `/filtered/full` while backfilling higher-availability location and website fields from `/filtered`.
- Kept the strict tool input surface unchanged (`keyword`, `category+location`, and plan-driven search) while improving recall and field completeness under the same tool contracts.
- Updated gateway unit tests to assert both endpoint calls are made for typed search tools.

Reason:
- Coverage analysis showed `/filtered/full` has stronger descriptive and promo fields, while `/filtered` currently has better practical location population for matching and explanation quality.

Decision:
- Use a mixed endpoint strategy at the gateway layer so tools stay strict and simple for the model, while runtime search results gain both recall and metadata completeness without adding new model-facing tool complexity.

Flow nodes affected:
- `buscar_proveedores` and `reintentar` indirectly, because both rely on provider search tools backed by this gateway.

### Add two-stage recommendation funnel (top 15 context -> top 5 presented)
- Increased runtime provider candidate limits so up to 15 shortlisted providers are persisted and passed into reply composition context.
- Updated `SinEnvolturasGateway` search retrieval to auto-fetch up to 4 sequential pages per query window, dedupe by provider id, and merge field completeness before final plan-aware ranking.
- Kept deterministic ranking in gateway and prompt-level presentation constraints in `recomendar` so the LLM receives a richer top-15 pool and is instructed to present only the best 5 options to the user.
- Updated shared output style rules to cap displayed recommendation shortlists at five options.

Reason:
- The recommendation flow needed broader candidate recall to improve quality while preserving concise user-facing shortlists and avoiding full LLM-side reranking over raw endpoint pages.

Decision:
- Use a hybrid two-stage funnel: deterministic retrieval/ranking for breadth and consistency, then LLM final selection/narration over a bounded top-15 context into a top-5 response.

Flow nodes affected:
- `recomendar` directly for presentation policy, plus `buscar_proveedores` and `reintentar` indirectly through expanded retrieval depth and shortlist persistence.

### Extend trace diagnostics and perf persistence observability
- Added a `recommendation_funnel` block to turn traces with candidate availability, candidate ids sent in reply context, and presentation target limit.
- Extended Lambda perf summaries returned to CLI with persistence status (`persisted`) and target store (`storage_target`) so runtime diagnostics can confirm whether Dynamo writes actually succeeded.
- Extended persisted perf records in DynamoDB with recommendation-funnel counts/ids to support downstream analysis of retrieval breadth versus presentation constraints.
- Updated CLI trace rendering to print the recommendation funnel and persistence status inside the trace/perf sections.
- Updated eval schemas and perf unit tests to validate the new observability fields.

Reason:
- Existing CLI diagnostics showed latency and token data but did not explicitly confirm persistence success or expose the retrieval-to-presentation funnel needed to audit top-15 to top-5 behavior.

Decision:
- Keep these diagnostics lightweight, always structured, and available in CLI mode so operators can verify both live execution and persisted telemetry without ad hoc scripts.

Flow nodes affected:
- All nodes indirectly, because trace and perf capture wrap every turn regardless of active node.

### Add non-cluttering live progress indicator for Lambda turn buffering
- Updated the terminal CLI invocation flow to render a single in-place dynamic progress line while waiting for each Lambda turn response.
- Added exact progress phases for request send, runtime wait, response parse, reply render, trace render, Dynamo plan load, and plan render, plus a near-timeout hint when turn latency approaches the configured timeout.
- Kept the dynamic `\r` progress line active through the full post-response lifecycle (trace rendering and plan loading/rendering), not only through network wait, so stalls after reply are visible in real time.
- Added local CLI timing telemetry (`render_reply`, `render_trace`, `load_plan`, `render_plan`, `render_raw`) to diagnose delays that happen after the agent reply is already available.
- Added trace-output truncation guards for large tool payloads and provider lists so oversized debug blocks do not freeze terminal rendering.
- Added graceful handling for invocation failures (including timeout aborts) so the CLI reports a clear error instead of appearing silently stuck.

Reason:
- Live usage showed long waits with little feedback, making it hard to tell whether buffering came from extraction, provider search, compose, transport, or a true timeout.

Decision:
- Keep output clean by using a single rewritten line (no log spam) with exact observable phases only, then clear the line before normal reply rendering.

Flow nodes affected:
- None directly in flow logic. This is a CLI observability and UX improvement for all runtime turns.

### Audit and harden venue/local/place provider search consistency
- Added a dedicated analysis dossier at `analysis/venue-local-search-audit` with live endpoint evidence, reproducible commands, and dated findings for venue-category inconsistency.
- Updated `SinEnvolturasGateway.categoryAliases()` to normalize a wider family of venue-like inputs (`local`, `locales`, `venue`, `place`, `lugar`, `salon`, `espacio`, `recepcion`) into robust search aliases.
- Updated `searchProvidersByCategoryLocation()` to try alias-based composed terms first, then retry category-only terms when strict `category + location` queries return empty.
- Added `searchProvidersBySearchTerms()` helper to keep fallback search behavior deterministic and bounded.
- Added regression coverage in `tests/sinenvolturas-gateway.test.ts` for the case where `venue + Lima` fails but alias fallback (`local`) succeeds.

Reason:
- Live behavior showed recurring zero-results for venue-like phrasing even when `local` returned valid `Locales` providers, causing inconsistent recommendations for the same intent.

Decision:
- Keep the model-facing tools unchanged and fix inconsistency in gateway query normalization and fallback strategy, backed by reproducible analysis artifacts.

Flow nodes affected:
- `buscar_proveedores` and `reintentar` indirectly, because both rely on gateway-backed provider search and category/location retrieval logic.

## 2026-04-20

### Finish-plan tool, lifecycle persistence, and plan-row TTL
- Extended the persisted plan schema with `lifecycle_state` (`active` | `finished`), `contact_name`, and `contact_email` to support a post-selection closeout path.
- Added `finish_plan` to the OpenAI runtime tools: it requires `name` and `email`, marks the plan finished, moves the node to `necesidad_cubierta`, returns a stub payload (`provider_contact_flow_not_implemented_yet`), and signals a 24-hour DynamoDB TTL via `onPlanFinished`.
- Wired `AgentService` to pass TTL through every plan persist after `finish_plan`, and to short-circuit new turns when a stored plan is already finished (deterministic Spanish reply, no extractor or compose).
- Enabled DynamoDB TTL on the plans table (`ttl_epoch_seconds`) and taught `DynamoPlanStore` to write and strip that attribute separately from the Zod plan payload.
- Updated `crear_lead_cerrar` prompts to authorize and describe `finish_plan`.
- Added tests for lifecycle parsing, merge behavior, finished-plan short-circuit, and eval live-lambda seed alignment.

Reason:
- The product needs an explicit “contact providers and close” step with inbox persistence later; today we only persist closure metadata and enforce a cooldown before a fresh plan can be stored again.

Decision:
- Use DynamoDB item TTL on the same `PLAN` row so finished rows disappear after 24 hours and `getByExternalUser` naturally returns null for a new `createEmptyPlan` session.

Flow nodes affected:
- `crear_lead_cerrar`, `necesidad_cubierta`, and `existe_plan_guardado` (read path for finished plans).

### Lint hygiene (token usage + gateway test)
- Replaced an unsafe spread in `OpenAiAgentRuntime.collectUsageCandidates` with an explicit loop.
- Added `urlFromVitestFetchMockCall` in `tests/sinenvolturas-gateway.test.ts` so Vitest fetch mock assertions stay strictly typed.

Reason:
- `npm run lint` must stay clean after the runtime changes touched nearby code paths.

### Finish-plan state-model hardening + SOTA-style eval metrics
- Added `isPlanFinished()` in `src/core/plan.ts` and wired it into `AgentService` and `resolveResumeNode()` so lifecycle closure is represented as a first-class state-model guard, not ad-hoc string checks.
- Extended eval result/report schemas with benchmark metrics (`tool_precision/recall/F1`, branch coverage, state and trajectory pass rates, plan persistence rate, cache hit rate, token totals, latency distribution).
- Implemented automatic benchmark metric computation per case in `src/evals/runner.ts` and aggregate benchmark summaries in `src/evals/reporting.ts`, including Markdown rendering.
- Added a new offline eval case `state.finished_plan_short_circuits_turn` and included it in `dev_regression` and `benchmark_full` suites to validate finished-plan branch behavior and closure messaging.
- Added deterministic unit coverage for finished-state resume semantics (`tests/decision-flow.test.ts`) and TTL persistence callback plumbing in `tests/agent-service.test.ts`.

Reason:
- The finish flow needs to be integrated with the plan lifecycle model and validated with richer, benchmark-oriented quality signals instead of only pass/fail checks.

Decision:
- Keep the existing expectation/scorer framework and augment it with always-on benchmark KPIs so every run yields standardized state, tool-use, and trajectory metrics without requiring per-case boilerplate.

### Live Lambda eval expansion for finished-plan lifecycle
- Extended `runLiveLambdaCase` to preload `seedPlan` into Dynamo before sending turn inputs, mirroring offline seeding behavior for branch validation.
- Promoted `state.finished_plan_short_circuits_turn` to `template.base-both-targets` so the same lifecycle branch runs in both offline and live modes.
- Added the new lifecycle case to `evals/suites/live_smoke.yaml` to keep a low-cost live assertion for the finished-plan short-circuit.
- Expanded `tests/eval-live-target.test.ts` with a dedicated seeded-plan test that verifies persisted finished lifecycle fields are used during live target normalization.

Reason:
- The finished-plan branch should be validated under real Lambda transport with Dynamo-backed state, not only via offline fixtures.

### Parallel eval execution + dashboard artifacts
- Added configurable eval concurrency via `parallelism` in `runEvaluation` and CLI flag `--parallel <n>`, using a bounded worker pool while preserving deterministic result ordering.
- Added `dashboard.json` and `dashboard.csv` artifacts per run with objective case-level KPIs and report-level benchmark summaries for BI ingestion.
- Documented parallel run usage and dashboard outputs in `README.md`.

Reason:
- Large benchmark suites need faster turnaround and machine-consumable metrics output suitable for dashboards beyond markdown reports.

### Eval-case diversity expansion for state and failure branches
- Added `state.resume_from_temporal_close_goes_to_entrevista` to validate resume behavior from `guardar_cerrar_temporalmente`.
- Added `state.close_intent_saves_temporal_node` to distinguish generic close intent from final finished lifecycle state.
- Added `search_error.provider_failure_moves_to_retry_node` to cover provider search exception routing into `informar_error_reintento`.
- Included the new scenarios in `dev_regression` and `benchmark_full` suites.

Reason:
- The benchmark needed broader behavioral coverage across resume, close, and operational error branches to reduce blind spots in quality metrics.

### Flow fixes after benchmark feedback
- When continuing to another need after selecting a provider in a mixed turn, search-result projection now clears `selected_provider_id` and `selected_provider_hint` for the newly active shortlisted need to avoid stale cross-need selection hints.
- Provider search failures now record `search_providers_from_plan` in `tools_called` plus an error payload in `tool_outputs`, so observability and tool-usage expectations reflect attempted calls that failed upstream.

Reason:
- Benchmark failures revealed two instrumentation/state-quality issues: stale selection hints on a different active need and missing tool-call trace data on failed provider searches.

### Live-target skip classification fix
- Updated eval result finalization to preserve runtime `skipped` outcomes explicitly (instead of coercing them into `failed` via unmet expectations when no turns are available).
- Added deterministic skipped-case artifact output with baseline benchmark metrics so dashboard ingestion remains stable even when live target configuration is unavailable.

Reason:
- Live benchmark runs without a configured Function URL were being misreported as failures, creating false negatives in dashboard KPIs.

### Cross-target expectation normalization for live OpenAI variability
- Relaxed `entrypoint.event_known_no_active_need` by removing strict plan-field equality checks (`event_type`, `location`) that are deterministic offline but model-variable in live extraction.
- Relaxed `domain.guest_range_boundary_100` to accept either `recomendar` or `aclarar_pedir_faltante` transitions, reflecting valid live behavior when location is still missing.

Reason:
- Live Lambda/OpenAI runs should validate behavior envelopes without overfitting to fixture-deterministic extraction outputs.

### Live Lambda benchmark hardening
- Added trace-level expectation types (`trace_field_equals`, `trace_field_subset`, `trace_field_number`) and `provider_result_count` so live cases can assert structured runtime behavior beyond broad node envelopes.
- Tightened existing live comprehensive cases to check search readiness, persistence, provider search usage, provider result counts, and null selection state where appropriate.
- Expanded `live_comprehensive` with four multi-turn and negative-control cases covering event-first planning, follow-up catering search, multi-need capture, refinement after recommendations, and vague requests that must not search.
- Added latency/tool-call targets to the base live scorer so budget efficiency is no longer an automatic perfect score.
- Fixed live target plan hydration to resolve the deployed plans table from CloudFormation outputs unless `PLANS_TABLE_NAME` is explicitly set, avoiding false null-field failures from the local default table name.
- Updated live local-space and photography search-path cases to include guest counts so their strict search expectations align with the runtime sufficiency rule that requires category, location, and budget or guest range.
- Tightened the event-first multi-need live case wording so the opening turn explicitly has no chosen provider category, reducing stochastic misclassification as a venue search.
- Raised the event-plan-to-catering tool ceilings to allow normal recommendation enrichment/review calls while still bounding runaway tool usage.

Reason:
- The live Lambda suite was too permissive: broad allowed transitions and missing trace assertions let integrations score 100% while still hiding search readiness, persistence, and state-continuity regressions.
- The first hardened live run also exposed an eval-adapter defect: Dynamo had the correct persisted plan, while artifacts showed fallback trace-only plans because the adapter read the wrong table.

Decision:
- Keep text checks tolerant, but make the primary gates structured: plan fields, trace fields, provider counts, tool calls, and multi-turn continuity.

### Preserve known guest range when extraction returns unknown
- Updated runtime plan merge behavior so extractor output `guestRange: "unknown"` is treated like no new information and cannot overwrite an already known guest range.
- Extended `AgentService` regression coverage to preserve a seeded `guest_range` when a follow-up extraction returns null/unknown fields.

Reason:
- The hardened live suite found a real state-continuity bug: a second turn in a multi-need flow degraded `guest_range` from `21-50` to `unknown`, weakening subsequent provider search context.

Decision:
- Keep explicit guest counts inferred from the user message highest priority, keep concrete extractor ranges second, and reserve the prior plan value whenever the extractor only emits `unknown`.

### Guard broad event planning against implicit venue inference
- Added a deterministic runtime guard that drops venue-like extracted categories when there is no active need and the user message does not explicitly mention local, salón, espacio, venue, or equivalent wording.
- Updated extractor domain knowledge and examples to distinguish broad event-planning openers from explicit venue/local requests.
- Added regression coverage for an extractor that incorrectly returns `local` from a broad planning opener.

Reason:
- Live reruns showed stochastic false venue searches for messages like “quiero planear un matrimonio en Lima”, which violates the event-plan-first behavior and creates premature provider searches.

Decision:
- Keep explicit venue requests fully supported, but require explicit venue wording before opening a local/salón need from an otherwise broad event-planning turn.

### Preserve numeric-leading provider selections and avoid post-turn plan fetches
- Updated provider selection resolution to match provider names before interpreting a hint as an ordinal, so names such as `4Foodies` are not mistaken for option numbers.
- Added ordinal-word support for selections such as `primera opción`, allowing active shortlists to be confirmed without re-running provider search.
- Stopped persisting unresolved `selected_provider_hint` values onto shortlisted needs; hints now become durable only when they resolve to a selected provider.
- Added the current plan snapshot to CLI-mode Lambda responses and updated the terminal/eval clients to use it instead of doing a second DynamoDB plan read after every turn.
- Updated terminal plan diagnostics to show selected providers inside each provider need and moved local timing calculation so plan-render time is visible in the trace diagnostics.
- Added regression coverage for numeric-leading provider names and ordinal-word selection.

Reason:
- A live terminal conversation showed two linked failures: selecting `4Foodies` while opening music left catering as merely shortlisted, and later `primera opción` did not persist the music selection.
- The same run showed runtime perf records in DynamoDB were fast enough while the terminal spent tens of seconds after the reply waiting on an extra plan fetch, making diagnostics misleading.

Decision:
- Treat the Lambda response as the authoritative post-turn debug envelope for CLI mode, while keeping `/plan` available for explicit out-of-band DynamoDB inspection.

### Align conversational provider selection across prompts and reducer
- Extended the extractor input snapshot with compact shortlisted provider context: title, slug, category, services, promo, and short description.
- Updated extractor prompts to resolve conversational references to prior shortlist items, including descriptive references like `la de tablas de queso`, `la de violín`, or `la propuesta en vivo` when exactly one provider is plausible.
- Tightened recommendation and provider-selection response contracts so replies only claim a provider is selected when the plan has `selected_provider_id`.
- Added deterministic reducer fallback for descriptive references by scoring the user message against known provider titles, services, promos, descriptions, and other shortlist text.
- Changed provider alias matching to require token boundaries so short aliases such as `edo` cannot match unrelated words like `proveedor`.
- Added regression coverage where the extractor emits no `selectedProviderHint`, but the reducer still selects the cheese-table catering option and continues to the next need.
- Added regression coverage for model-generated descriptive hints that mention `4Foodies` while also containing the word `proveedor`.

Reason:
- A planning agent should understand natural follow-ups, not only exact names and option numbers. The previous extractor context lacked provider names/differentiators, and persistence could fail when the structured hint was absent.

Decision:
- Let the model interpret conversational references with richer context, but keep durable plan mutation deterministic and conservative: select only on a unique, clear match; otherwise ask for clarification instead of guessing.

## 2026-04-21

### Expand channel integration contract
- Rewrote `docs/channel-integration.md` as a thorough adapter guide with the current live Lambda Function URL, CloudFormation output names, request and response contracts, channel and CLI response examples, error handling, state identity rules, telemetry correlation, provider endpoint dependencies, runtime configuration, validation commands, and adapter completion checklist.
- Included the currently deployed development endpoint (`https://jwtjjociscvaa5dsrp5gokmno40doiva.lambda-url.us-east-1.on.aws/`) and DynamoDB tables (`recap-agent-runtime-plans`, `recap-agent-runtime-perf`) resolved from CloudFormation on 2026-04-21.

Reason:
- The previous guide explained the high-level channel-agnostic intent but did not give enough concrete detail for someone to implement or validate a real channel adapter.

Decision:
- Keep the guide focused on the runtime boundary and live integration contract, while making clear that webhook auth, retries, formatting, deduplication, and delivery callbacks belong in channel adapters rather than `src/runtime`.

## 2026-04-23

### Wire `finish_plan` to real `/api-web/vendor/quote` endpoint
- Replaced the stub `finish_plan` implementation with a real integration against the Sin Envolturas `POST /api-web/vendor/quote` endpoint.
- Changed `finish_plan` tool parameters from `(name, email)` to no parameters; it now reads `contact_name`, `contact_email`, and `contact_phone` from the persisted plan.
- Added `contact_phone` to the persisted plan schema, extraction schema, and extractor field definitions.
- `finish_plan` now iterates over every `provider_needs` entry with `selected_provider_id` set, calling `createQuoteRequest` per selected provider with:
  - `name`, `email`, `phone` from the plan contact fields
  - `phoneExtension: '+51'`
  - `eventDate: today`
  - `guestsRange` from `plan.guest_range`
  - `description` from `plan.conversation_summary`
  - `userId` omitted (guest user path)
- Returns per-provider outcomes (`success` | `error`) plus an overall `status` (`success`, `partial`, `failed`) and the 24h TTL epoch.
- On success, mutates the plan to `lifecycle_state: finished`, `current_node: necesidad_cubierta`, and invokes `onPlanFinished` so DynamoDB TTL is written.

### Split pause vs close routing in `AgentService`
- Separated `pausar` (pause) from `cerrar` (close) intent handling:
  - `pausar` / `pauseRequested` routes to `guardar_cerrar_temporalmente` (temporary save).
  - `cerrar` routes to `crear_lead_cerrar` (real close flow).
- This fixes the previous behavior where both intents were collapsed into a temporary close, which did not make sense for a definitive close action.

### Rewrite `crear_lead_cerrar` prompts for multi-turn close flow
- Rewrote all four prompt files (`system`, `response_contract`, `tool_policy`, `transition_policy`) to implement a three-step close flow:
  1. Collect contact info (name, email, phone) if missing.
  2. Show a summary of selected providers per need and ask for explicit confirmation.
  3. Upon confirmation, call `finish_plan` to send quote requests and close.
- The agent must not close without explicit user confirmation.
- Users can edit contact info or provider selections at the confirmation step; normal extraction handles corrections next turn.

### Update related prompts
- Updated `seguir_refinando_guardar_plan` system and response contract to proactively suggest closing the plan when all needs have selected providers.
- Updated `guardar_cerrar_temporalmente` system prompt to only mention pause (no longer close).
- Updated extractor system and field definitions to extract `contactName`, `contactEmail`, `contactPhone` from any turn.

### Type and contract updates
- Added `onPlanFinished?: (ttlEpochSeconds: number) => void` to `ComposeReplyRequest` in `src/runtime/contracts.ts`.
- Added `contactName`, `contactEmail`, `contactPhone` to the runtime extraction schema and `ExtractionResult` contract.
- Updated `buildExtractorPlanSnapshot` and `buildPromptPlanSnapshot` to include contact fields in model context.
- Added `finish_plan` to `toolNames` and `crear_lead_cerrar.allowedTools` in the prompt manifest.
- Rewrote `src/runtime/finish-plan-tool.ts` as an async shared function that calls the provider gateway per selected provider.

### Tests
- Added `contactName`, `contactEmail`, `contactPhone: null` to all `ExtractionResult` objects in `tests/agent-service.test.ts`.
- Verified all 20 core tests pass (agent-service, decision-flow, plan-lifecycle, sufficiency).

Reason:
- The `finish_plan` tool was a stub (`provider_contact_flow_not_implemented_yet`) even though the Sin Envolturas API already exposes `POST /api-web/vendor/quote`. The product needs a real close flow that contacts selected vendors and marks the plan finished.
- The previous `cerrar` intent routing to `guardar_cerrar_temporalmente` was confusing because temporary save and definitive close are semantically different actions.

Decision:
- Use the existing `createQuoteRequest` gateway method (already typed for `/quote`) inside a loop over selected providers, keeping the model-facing tool surface minimal (`finish_plan` with no params).
- Persist contact info to the plan so the multi-turn close flow survives across turns without requiring the agent to re-ask.
- Keep user editing flexible at the confirmation step: normal extraction and flow routing handle corrections without special-case logic.

Flow nodes affected:
- `crear_lead_cerrar` (complete rewrite of close flow)
- `guardar_cerrar_temporalmente` (clarified as pause-only)
- `seguir_refinando_guardar_plan` (proactive close suggestion)
- `necesidad_cubierta` (post-finish close node)
- All nodes indirectly through extraction schema changes

### Fix broaden-search and close-contact confusion after recommendation
- Added an AgentService broaden-search branch for refinement turns like `busca más` / `más opciones`.
- The service now calls `search_providers_by_category_location` with `page: 2` for the active need and location, persists unseen providers when found, and carries a user-facing note when no additional distinct options exist.
- Changed the runtime conversation envelope label from `Error operativo` to `Nota operativa` so the model can safely communicate search exhaustion without treating it as a system failure.
- Updated `recomendar` prompts so the reply must explicitly say when no more options were found and must not claim provider contact is impossible when the close flow can send quote requests.
- Updated extractor guidance so requests like `puedes contactar al proveedor` map to `intent: cerrar`, and contextual pronoun selections after a single highlighted recommendation are treated as provider selections instead of ambiguous chatter.
- Added regression tests for both broaden-search outcomes: new providers on page 2 and no-additional-options fallback.

### Expand broaden-search beyond a single extra page
- Replaced the page-2-only widen logic with an aggregated unseen-provider search in `AgentService`.
- `busca más` / `más opciones` now collect providers across up to 5 pages of `search_providers_by_category_location` for:
  - the active category plus current location, then
  - the active category without location as a wider fallback.
- The service deduplicates provider IDs across all fetched pages and excludes providers already shown in the active shortlist before persisting the next batch.
- The target is now a fresh unseen batch of up to 5 providers instead of trusting a single upstream page boundary.
- Added regression coverage for:
  - collecting unseen providers from later pages after earlier duplicates,
  - no-new-results exhaustion,
  - fallback from location-scoped search to category-wide search.

Reason:
- A single `page: 2` call was still too dependent on upstream ranking and could keep surfacing the same providers, which did not satisfy user requests to widen the search meaningfully.

Decision:
- Keep the change in `AgentService` so broaden-search behavior remains deterministic and easy to observe in trace logs without expanding the provider gateway surface area yet.

### Make broaden-search intent-driven instead of phrase-driven
- Removed the manual widen-phrase parser from `AgentService.shouldBroadenProviderSearch(...)`.
- Broadening now depends primarily on extractor output and existing recommendation context:
  - `intent === refinar_busqueda`
  - there is already an active shortlist to expand
  - the extractor did not introduce a real search-criteria change versus the baseline plan
- Criteria changes that keep the flow on the normal `search_providers_from_plan` path include changes to category, location, budget, event type, guest range, preferences, or hard constraints.
- Added a regression test proving that a budget refinement (`más económicas`) reuses the original search path instead of broadening the old shortlist.

Reason:
- Phrase matching was brittle and could drift from the extractor's intent model, creating inconsistent behavior between similar refinement turns.

Decision:
- Let the extractor decide whether the user is refining, and let runtime logic decide whether that refinement means "expand current shortlist" or "rerun search with new constraints".

### Add richer perf diagnostics for failed interaction analysis
- Expanded `TurnTrace` with structured debugging summaries instead of relying only on counters:
  - `search_strategy` (`none`, `search_from_plan`, `broaden_existing_shortlist`)
  - `extraction_summary` (intent confidence, extracted category/location/budget/guest range, preferences, hard constraints, selected hint, pause flag, contact presence)
  - `plan_summary` (current node, lifecycle state, event type, active need, location, budget, guest range, provider-need categories/statuses, contact presence)
  - explicit `recommendation_funnel` typing in the core trace contract
- Expanded `TurnPerfRecord` so Dynamo perf rows now persist the key data needed to reconstruct failures without fetching ephemeral runtime output:
  - `user_message_hash`
  - truncated `user_message_preview`
  - `previous_node`
  - `node_path`
  - `intent`
  - `prompt_bundle_id`
  - `tools_considered`
  - `search_strategy`
  - `extraction_summary`
  - `plan_summary`
  - `provider_result_ids`
  - full `missing_fields`
- Kept these as compact summaries rather than dumping full raw plan blobs or model internals, so the records remain queryable and useful for debugging interaction failures like web-chat stalls or repeated recommendation loops.
- Added perf-trace tests covering the new persisted fields and updated runtime tests to stay aligned with the richer trace schema.

Reason:
- The previous perf records were too thin to explain why a turn stayed in `entrevista`, why a refine request broadened versus reran search, or what extracted criteria led to a failed interaction. Debugging required correlating multiple tables and guessing at missing context.

Decision:
- Persist concise, searchable summaries of extraction and plan state directly into the perf table so a single Dynamo query can explain most interaction failures.

### Push more need-switching behavior into extractor semantics
- Strengthened extractor instructions so mid-recommendation pivots like `y qué djs tienes`, `y de foto?`, `también quiero ver música`, or `ahora muéstrame catering` are interpreted as switching `activeNeedCategory`, even if the previous provider need was not selected yet.
- Expanded extractor field definitions and normalization rules so:
  - `vendorCategory` follows the new provider class mentioned in the current turn,
  - `activeNeedCategory` can switch immediately without forcing closure of the previous need,
  - entertainment labels like `dj`, `djs`, `música`, `banda`, and `orquesta` normalize into the music family.
- Added explicit extractor examples for:
  - switching from one need to another mid-flow,
  - asking for a different category with conversational phrasing,
  - distinguishing `muéstrame otras opciones` (refine current need) from `y qué djs tienes` (switch need).
- Extended debug persistence further so perf rows now also capture:
  - `operational_note`
  - `prompt_file_paths`
  - richer `extraction_summary` (`vendor_categories`, `assumptions`, summary preview)
  - richer `plan_summary` (`provider_need_count`, summary preview, open question count)

Reason:
- Category switching is subtle and language-dependent. Deterministic parsing quickly becomes brittle here, while the extractor already has the plan context and shortlist needed to make the right semantic call.

Decision:
- Keep deterministic runtime parsing minimal and focused on narrow structural cases (selection references, explicit guest-number inference, venue guardrails), while moving need-switch interpretation and category normalization further into the extractor LLM and storing the resulting reasoning context in perf.

### Move provider-choice interpretation from runtime parsing into extractor context
- Enriched the extractor plan snapshot so each shortlisted provider now carries explicit ordered context (`rank`) plus location and price-level summary, giving the extractor enough information to resolve references like `la segunda`, `ese`, or `la de tablas de queso` from the plan snapshot itself.
- Strengthened extractor instructions and examples to treat `selectedProviderHint` as a required structured output whenever the user is clearly choosing from a visible shortlist.
- Reduced runtime provider-selection heuristics to a near-zero fallback layer:
  - the runtime now trusts `selectedProviderHint` from the extractor,
  - resolves it by exact/partial provider alias or ordinal only,
  - and only auto-selects when there is exactly one candidate and the intent is already `confirmar_proveedor`.
- Removed the previous raw-message salvage path that tried to infer provider choice directly in the runtime from pronouns and descriptive phrases.

Reason:
- Provider-choice parsing in the runtime was one of the largest remaining heuristic fronts. It duplicated semantic work that the extractor can do better because it already sees the ordered shortlist and the full plan context.

Decision:
- Let the extractor own almost all provider-reference interpretation and keep the runtime to structural resolution of the extractor's explicit hint.

Reason:
- The live interaction showed two user-facing failures: asking for a wider search just replayed the same shortlist, and asking to contact a provider from the recommendation phase incorrectly claimed the product could not do something that `finish_plan` already supports.

Decision:
- Keep the fix minimal and deterministic in the runtime by owning widen-scope behavior in `AgentService`, instead of hoping the reply model will infer pagination or search exhaustion from prompts alone.
- Keep close/contact routing model-driven through extractor guidance, but add guardrails in `recomendar` so the reply stays truthful even if the turn has not yet transitioned into `crear_lead_cerrar`.

## 2026-04-28

### Recover repo after iCloud desync and deleted .git/node_modules
- Removed ~170 duplicate files created by macOS iCloud (`* 2.*` pattern) after verifying non-"2" versions were newer via `diff` and `stat` mtime comparison.
- Re-created `.git` from scratch: `git init`, `git remote add origin https://github.com/pdellepiane/recap-agent.git`, fetched `origin/main`, force-checked out tracking branch, then restored working tree from an rsync backup taken before checkout.
- Verified 11 modified files and 20+ untracked files (uncommitted changes) were preserved.
- Re-installed dependencies with `bun install` (409 packages, migrated from `package-lock.json`).
- Added `.cursor/` to `.gitignore` alongside existing rules (`node_modules/`, `dist/`, `.env`, `.DS_Store`, eval runs, broken-git backups).
- Committed all non-WIP changes as a single feature commit (`ade1910`).

Reason:
- The iCloud conflict created two copies of most files; without careful comparison we could have lost days of uncommitted work.

Decision:
- Use timestamp and diff comparison rather than heuristics to decide which copy to keep.
- Create a filesystem backup before any destructive git operation.

### Finish knowledge-sync WIP: connect scraped Tawk help center to agent runtime
**What was already there before this session:**
- `src/knowledge-sync/` — scraper (`TawkHelpScraper`), formatter (`articlesToMarkdown`), uploader (`OpenAiKnowledgeUploader`), sync orchestrator (`runKnowledgeBaseSync`), Lambda handler (`handler.ts`), and types.
- `scripts/sync-knowledge-base.ts` — local CLI script to scrape and optionally upload.
- `infra/knowledge-sync.yml` — standalone CloudFormation stack with a scheduled Lambda (`rate(1 day)`), EventBridge rule, and IAM role.
- `scripts/build.mjs` — already built `src/knowledge-sync/handler.ts` into `dist/knowledge-sync/index.js`.

**What was missing (the actual gap):**
- The agent runtime (`OpenAiAgentRuntime`) never received the vector-store configuration and never exposed `file_search` as a tool to the reply agent. This meant the scraped knowledge base was uploaded to OpenAI but the agent could not query it.
- The main CloudFormation stack (`infra/cloudformation/stack.yaml`) did not pass KB env vars (`KB_ENABLED`, `KB_VECTOR_STORE_ID`) to the runtime Lambda.
- The deploy script (`scripts/deploy.mjs`) only deployed the main stack, not the knowledge-sync stack.

**What was implemented/fixed:**
1. **Runtime integration:**
   - Added `knowledgeBase?: { enabled: boolean; vectorStoreId: string | null }` to `OpenAiAgentRuntime` constructor options.
   - Added `createFileSearchTool()` method that returns a `HostedTool` with `type: 'hosted_tool'`, `name: 'file_search'`, and `providerData.vector_store_ids` when KB is enabled and a vector store ID is configured.
   - The `file_search` tool is automatically appended to the reply agent's tool list on every `composeReply` call.
   - `src/lambda/handler.ts` now passes `config.knowledgeBase` to the runtime constructor.
2. **Infrastructure wiring:**
   - Added `KB_ENABLED`, `KB_BASE_URL`, `KB_VECTOR_STORE_NAME`, `KB_VECTOR_STORE_ID` to `src/runtime/config.ts` environment schema and `AppConfig` type.
   - Added `PRESENTATION_PROVIDER_LIMIT` env var to config (was referenced in handler but missing from schema, causing a pre-existing type error).
3. **Uploader fix:**
   - Fixed `openai-uploader.ts` `uploadAndPoll` call: the SDK expects `{ files: [...] }`, not a raw array. Was a type error that would have failed at runtime.
4. **Pre-existing type-error cleanup (unrelated but blocking clean typecheck):**
   - `src/evals/targets/offline.ts` — added missing `contactName/Email/Phone` fields to mock extractions.
   - `src/evals/runner.ts` — added `default` case to `evaluateExpectation` switch.
   - `src/evals/case-schema.ts` — made `benchmarkSummary` optional in `evalReportSchema`.
   - `src/storage/plan-store.ts` — added `ttlEpochSeconds?: number` to `SavePlanInput`.
   - `src/runtime/contracts.ts` — added `recommendationFunnel` to `ComposeReplyResult`.

**Scraper validation:**
- Ran `KB_SKIP_UPLOAD=true npx tsx scripts/sync-knowledge-base.ts` against `https://sinenvolturas.tawk.help`.
- Result: **52 articles scraped**, output written to `dist/knowledge-base/sinenvolturas-kb.md` (1,213 lines).
- Content categories observed: "Sobre Sin Envolturas", "Actualización Web", "FAQ", "Pagos", "Eventos". Articles cover pricing, gift lists, event planning, payment methods, commissions.
- Build output verified: `dist/knowledge-sync/index.js` (652 KB) and sourcemap exist.

**Vector store status:**
- Quoted OpenAI API for existing vector stores: **none found** (`[]`).
- No `KB_VECTOR_STORE_ID` configured in `.env`.
- The knowledge-sync Lambda has never been deployed (no `.artifacts/` directory, no S3 zip history).

**Deployment gaps still open:**
1. `infra/cloudformation/stack.yaml` does **not** pass `KB_ENABLED` or `KB_VECTOR_STORE_ID` to the runtime Lambda's environment variables. The runtime will default to `enabled: true` with `vectorStoreId: null`, so `file_search` will not be attached until the env var is added.
2. `scripts/deploy.mjs` does **not** deploy `infra/knowledge-sync.yml`. There is no automated path to:
   - Create the knowledge-sync Lambda,
   - Upload the `dist/knowledge-sync/` zip to the expected S3 key,
   - Pass the OpenAI API key to the knowledge-sync Lambda (it expects `OPENAI_API_KEY` as a plain env var, not via Secrets Manager).
3. No initial vector store creation + upload has been done. The first run requires:
   - Creating a vector store via OpenAI API,
   - Uploading `dist/knowledge-base/sinenvolturas-kb.md` to it,
   - Recording the vector store ID into the runtime Lambda's env vars.

**Recommended next steps (in order):**
1. Add `KB_ENABLED` and `KB_VECTOR_STORE_ID` parameters to `infra/cloudformation/stack.yaml` and wire them into the `RuntimeFunction` environment block.
2. Extend `scripts/deploy.mjs` (or create a separate deploy script) to:
   - Zip `dist/knowledge-sync/` and upload to the S3 key expected by `infra/knowledge-sync.yml`,
   - Deploy `infra/knowledge-sync.yml` with the OpenAI API key parameter,
   - Run the knowledge-sync Lambda once manually (or wait for the scheduled trigger) to create the vector store,
   - Capture the returned vector store ID and update the main stack's `KB_VECTOR_STORE_ID` parameter,
   - Re-deploy the main stack so the runtime Lambda receives the vector store ID.
3. Alternatively, do a one-time local upload to create the vector store, record the ID in `.env` and the main stack, then rely on the scheduled Lambda for subsequent updates.

Reason:
- The knowledge-sync feature was structurally complete (scraper, formatter, uploader, scheduler, build target) but lacked the final runtime integration that actually lets the agent query the knowledge base. Without this wiring, the vector store would have been a dead artifact.

Decision:
- Use the Agents SDK `HostedTool` mechanism for `file_search` rather than raw Responses API calls, because the reply agent is already instantiated through the SDK and `HostedTool` is the documented way to attach OpenAI-hosted tools.
- Keep the knowledge-sync stack separate from the main runtime stack (as it was designed) because it has a different lifecycle, trigger pattern (scheduled vs on-demand), and S3 artifact path. But document the dependency: the main runtime needs the vector store ID that the sync stack creates.

Files changed:
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/config.ts`
- `src/runtime/contracts.ts`
- `src/lambda/handler.ts`
- `src/knowledge-sync/openai-uploader.ts`
- `src/evals/targets/offline.ts`
- `src/evals/runner.ts`
- `src/evals/case-schema.ts`
- `src/storage/plan-store.ts`
- `docs/implementation-log.md`

### Redesign knowledge-base as first-class state-machine node
**Problem with previous approach:**
- `file_search` was an ambient tool injected on every reply agent call regardless of node. The LLM decided whether to use it, but there was no explicit KB intent, no dedicated prompt bundle, no tracking of KB mode vs planning mode, and no clean return path.
- The scraper produced one monolithic markdown file with no per-article metadata.
- The sync schedule was daily (too frequent) and used a plain `OPENAI_API_KEY` env var instead of Secrets Manager.

**New state-machine node: `consultar_faq`**
- Added `consultar_faq` to `decisionNodes`, `planIntentValues`, and extraction schema.
- Added `kbQuery: string | null` to extraction schema and `ExtractionResult` contract.
- Added KB intent branch in `AgentService.handleTurn()`:
  - Sets `current_node = 'consultar_faq'`
  - Persists the plan with `current_node` updated but NO changes to planning fields (`event_type`, `vendor_category`, `provider_needs`, etc.)
  - Loads the `consultar_faq` prompt bundle
  - Returns immediately (skips search/selection flow)
- Added resume logic in `resolveResumeNode()`: if returning from `consultar_faq`, resume to `entrevista` (if plan has prior context) or `deteccion_intencion` (if fresh).
- Added `resolveExtractionNode()` mapping: `extraction.intent === 'consultar_faq'` → `'consultar_faq'`.
- Created prompt bundle `prompts/nodes/consultar_faq/`:
  - `system.txt` — Node objective, constraints, exit behavior
  - `response_contract.txt` — Tone, citation rules, re-ask support, transition to planning
  - `tool_policy.txt` — Only `file_search` (no provider tools)
  - `transition_policy.txt` — Rules for staying in KB vs switching to planning
- Added `consultar_faq` to `nodePromptManifest` with empty `allowedTools` (file_search is a hosted tool injected by runtime, not a function tool).

**Scraper redesign: per-article markdown with YAML frontmatter**
- Rewrote `src/knowledge-sync/formatter.ts` to produce one file per article instead of a monolithic file.
- Each article now has YAML frontmatter with:
  - `title`, `slug`, `category` (scraped)
  - `article_type` (heuristic mapper: `pricing`, `faq`, `tutorial`, `announcement`, `policy`, `event_guide`, `about`)
  - `tags` (auto-extracted from content keywords, max 8)
  - `source_url` (link back to Tawk)
  - `last_updated` (scraped timestamp)
  - `related_topics` (broader topic buckets, max 5)
- Added `ArticleMetadata`, `FormattedArticle` types to `src/knowledge-sync/types.ts`.

**Uploader redesign: batch rotation with cleanup**
- Rewrote `OpenAiKnowledgeUploader` to support batch uploads:
  - `uploadBatch()` uploads each article file individually, then creates a vector store file batch with `batch_id` and `source` attributes.
  - `cleanupOldBatches()` lists all files in the vector store and deletes those whose `batch_id` does not match the current run.
  - Polls batch status until `completed` (max 5 min wait).
- This replaces the old single-file upload that would have accumulated stale content over time.

**Sync handler improvements**
- Updated `src/knowledge-sync/handler.ts` to support Secrets Manager (`OPENAI_SECRET_ID`) as the primary auth path, with `OPENAI_API_KEY` as fallback.
- Added manual trigger support via `?force=true` query parameter or `{ "force": true }` body payload.
- Updated `src/knowledge-sync/sync.ts` to orchestrate per-article formatting and batch upload.

**CloudFormation updates**
- `infra/knowledge-sync.yml`:
  - Changed schedule from `rate(1 day)` to `rate(7 days)` (weekly).
  - Replaced plain `OpenAiApiKey` parameter with `OpenAiSecretArn` (Secrets Manager).
  - Added IAM policy `secretsmanager:GetSecretValue`.
- `infra/cloudformation/stack.yaml` (main runtime):
  - Already had `KbEnabled` and `KbVectorStoreId` parameters from previous commit.
  - Verified they are wired into `RuntimeFunction` environment variables.

**Documentation**
- Created `docs/knowledge-base-integration.md` covering architecture, file rotation, metadata schema, state machine integration, scheduling, deployment guide, cost considerations, and troubleshooting.
- Added TODO section for future `script_id` integration when response scripts are confirmed.

**Verified:**
- Scraper produces 52 individual `.md` files with YAML frontmatter.
- Build succeeds (`dist/knowledge-sync/index.js` generated).
- Typecheck and tests pass.

Reason:
- An ambient `file_search` tool created ambiguity: the LLM could invoke it during provider recommendation or extraction phases, leading to inconsistent behavior and no clear tracking of whether the user was in "FAQ mode" or "planning mode".

Decision:
- Make the knowledge base a first-class decision node with its own prompt bundle, explicit intent (`consultar_faq`), and clean entry/exit semantics. This aligns with the existing node-aligned architecture and makes KB interactions observable in traces and perf records.
- Use per-article files with metadata to enable future filtering, script matching, and granular debugging.

Files changed:
- `src/core/decision-nodes.ts`
- `src/core/decision-flow.ts`
- `src/core/plan.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/contracts.ts`
- `src/runtime/prompt-manifest.ts`
- `src/knowledge-sync/types.ts`
- `src/knowledge-sync/formatter.ts`
- `src/knowledge-sync/openai-uploader.ts`
- `src/knowledge-sync/sync.ts`
- `src/knowledge-sync/handler.ts`
- `scripts/sync-knowledge-base.ts`
- `infra/knowledge-sync.yml`
- `prompts/nodes/consultar_faq/system.txt`
- `prompts/nodes/consultar_faq/response_contract.txt`
- `prompts/nodes/consultar_faq/tool_policy.txt`
- `prompts/nodes/consultar_faq/transition_policy.txt`
- `docs/knowledge-base-integration.md`
- `docs/implementation-log.md`

### Deploy knowledge-base infrastructure to AWS
- Built and uploaded `dist/knowledge-sync/knowledge-sync.zip` to S3 (`recap-agent-artifacts-684516060775-us-east-1/knowledge-sync/dev/latest.zip`).
- Deployed `infra/knowledge-sync.yml` as stack `recap-agent-knowledge-sync-dev` with:
  - `OpenAiSecretArn`: `arn:aws:secretsmanager:us-east-1:684516060775:secret:recap-agent/openai-api-key-mtKG04`
  - Weekly EventBridge schedule (`rate(7 days)`)
- Initial Lambda invocation failed with HTTP 403 from `sinenvolturas.tawk.help` — Tawk blocks AWS Lambda IP ranges.
- Added browser-like `User-Agent` header to scraper (`Mozilla/5.0...`), but Tawk still blocked Lambda IPs.
- **Workaround:** Ran initial sync locally from macOS (which Tawk allows):
  - Scraped 52 articles
  - Created new vector store: `vs_69f0ed048b7c8191b037d68ed6e25956`
  - Uploaded 52 files as batch `local-20260428`
  - Batch completed successfully after ~20 polling cycles
- Updated knowledge-sync stack with `KbVectorStoreId=vs_69f0ed048b7c8191b037d68ed6e25956`.
- Rebuilt main runtime artifact with all KB code changes and uploaded to S3.
- Deployed main runtime stack `recap-agent-runtime` with:
  - `KbEnabled=true`
  - `KbVectorStoreId=vs_69f0ed048b7c8191b037d68ed6e25956`
- Added `KB_VECTOR_STORE_ID=vs_69f0ed048b7c8191b037d68ed6e25956` to local `.env`.

Reason:
- The infrastructure needed to be deployed so the agent runtime can actually use the vector store. Without deployment, the `file_search` tool would not be wired to any vector store.

Decision:
- Accept that Tawk blocks AWS Lambda IPs for scraping. The scheduled Lambda will need to run from a non-AWS IP (e.g., local machine, GitHub Actions, or an EC2 with a NAT gateway) until Tawk whitelists the IP or provides an API.
- The Lambda is still valuable for scheduled triggers and manual invocation if the scraping step is skipped (e.g., if content is pushed to S3 first).
- Document this limitation in `docs/knowledge-base-integration.md` as a known issue.

Files changed:
- `src/knowledge-sync/scraper.ts` (added User-Agent header)
- `docs/implementation-log.md`

### Set up GitHub OIDC for secretless AWS authentication
**Problem:** The GitHub Actions workflow required `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in GitHub Secrets, which need periodic rotation and are a security risk if leaked.

**Solution:** Use AWS OIDC (OpenID Connect) so GitHub Actions can assume an IAM role directly via short-lived tokens — no long-lived credentials needed.

**What was done:**
1. Created OIDC identity provider `arn:aws:iam::684516060775:oidc-provider/token.actions.githubusercontent.com`.
2. Created IAM role `recap-agent-github-actions` with a trust policy that only allows the `pdellepiane/recap-agent` repository to assume it.
3. Attached least-privilege permissions:
   - `s3:PutObject` on `knowledge-sync/dev/*` (upload scraped articles)
   - `lambda:InvokeFunction` on `recap-agent-knowledge-sync-dev` (trigger sync)
   - `secretsmanager:GetSecretValue` on `recap-agent/openai-api-key-*` (optional, if workflow ever needs the key)
4. Updated `.github/workflows/knowledge-sync.yml`:
   - Added `permissions: id-token: write, contents: read`
   - Replaced static AWS credentials with `aws-actions/configure-aws-credentials@v4` using `role-to-assume`
   - Added `--cli-binary-format raw-in-base64-out` to the Lambda invoke command
5. Updated `docs/knowledge-base-integration.md` with OIDC setup instructions.

**Result:** Zero secrets in GitHub. The workflow authenticates to AWS via OIDC, uploads articles to S3, and invokes the Lambda. The Lambda reads the OpenAI key from Secrets Manager. No manual rotation needed for any credential.

Files changed:
- `.github/workflows/knowledge-sync.yml`
- `docs/knowledge-base-integration.md`
- `docs/implementation-log.md`

### Clean up: remove GitHub Actions automation after Tawk IP blocking confirmed
**Problem:** Both AWS Lambda and GitHub Actions IPs are blocked by Tawk/Cloudflare (HTTP 403). The automated scraping pipeline via GitHub Actions + S3 + Lambda does not work.

**What was cleaned up:**
1. Removed `.github/workflows/test-tawk.yml` (test workflow).
2. Removed `.github/workflows/knowledge-sync.yml` (automated sync workflow).
3. Deleted `.github/workflows/` directory entirely.
4. Updated `docs/knowledge-base-integration.md`:
   - Removed GitHub Actions / OIDC sections
   - Removed serverless architecture diagram with GitHub Actions
   - Updated deployment instructions to manual local scrape + S3 upload + Lambda trigger
   - Updated troubleshooting to reflect that both Lambda and GitHub Actions are blocked
5. Kept the deployed infrastructure intact:
   - `recap-agent-knowledge-sync-dev` Lambda (works for OpenAI upload from S3)
   - `recap-agent-runtime` stack (works with KB enabled)
   - Vector store `vs_69f0ed048b7c8191b037d68ed6e25956` (52 articles)

**Current workflow:**
1. Scrape locally: `KB_SKIP_UPLOAD=true npx tsx scripts/sync-knowledge-base.ts`
2. Upload to S3: `aws s3 cp knowledge-base-articles.zip s3://.../articles-latest.zip`
3. Trigger Lambda: `aws lambda invoke --function-name recap-agent-knowledge-sync-dev ...`

**Note:** A weekly EventBridge schedule still triggers the Lambda, which will re-sync from S3 if articles are present. Without manual step 1-2, the scheduled run will fail gracefully (no articles in S3).

Files changed:
- `.github/workflows/test-tawk.yml` (deleted)
- `.github/workflows/knowledge-sync.yml` (deleted)
- `docs/knowledge-base-integration.md`
- `docs/implementation-log.md`

### Fix KB intent detection and first-turn "plan or question" prompt
**Problem:** Agent did not detect `consultar_faq` intent and did not offer "plan or question" on first turn. KB vector store was deployed correctly (`KbEnabled=true`, `KbVectorStoreId=vs_...`), but prompts lacked KB awareness.

**Root causes:**
1. `prompts/extractors/field_definitions.txt` did not list `consultar_faq` as a valid `intent`.
2. `prompts/nodes/deteccion_intencion/system.txt` and `transition_policy.txt` did not mention FAQ / KB questions.
3. `prompts/nodes/contacto_inicial/system.txt` and `response_contract.txt` only offered event planning, not KB questions.
4. `prompts/nodes/entrevista/system.txt` and `response_contract.txt` did not offer "plan or question" when no plan context exists yet.

**Fixes:**
1. Added `consultar_faq` intent definition to `field_definitions.txt`.
2. Updated `deteccion_intencion` prompts to recognize FAQ questions and transition to `consultar_faq`.
3. Updated `contacto_inicial` prompts to offer both event planning and KB questions.
4. Updated `entrevista` prompts to ask "plan or question" when no plan data exists yet.

**Deployment:** Rebuilt and redeployed `recap-agent-runtime` stack via `node scripts/deploy.mjs`. KB parameters preserved (not overridden).

Files changed:
- `prompts/extractors/field_definitions.txt`
- `prompts/nodes/deteccion_intencion/system.txt`
- `prompts/nodes/deteccion_intencion/transition_policy.txt`
- `prompts/nodes/contacto_inicial/system.txt`
- `prompts/nodes/contacto_inicial/response_contract.txt`
- `prompts/nodes/entrevista/system.txt`
- `prompts/nodes/entrevista/response_contract.txt`
- `docs/implementation-log.md`

### Add TPM rate-limit retry mitigation

- Increased `OpenAI` client `maxRetries` from 2 (default) to 3, giving the low-level SDK more room to absorb transient 429 bursts.
- Added `ModelRetrySettings` to `buildModelSettings()` with `maxRetries: 3`, `backoff` (`initialDelayMs: 1000`, `maxDelayMs: 30_000`, `multiplier: 2`, `jitter: true`), and `policy: retryPolicies.any(retryPolicies.httpStatus([429]), retryPolicies.networkError())`.
- This configures the agents SDK runner to retry 429 rate-limit errors and network errors up to 3 times with exponential backoff capped at 30 seconds, enough to cover the typical 20-second TPM windows reported by the OpenAI API.

Reason:
- A 429 error (`TPM Limit 200000, Used 164777, Requested 103461`) showed the agent hitting the gpt-5.4-mini tokens-per-minute ceiling mid-turn. The agents SDK's default retry policy was `maxRetries: 0` (no runner-level retries), and the raw OpenAI SDK capped backoff at 8 seconds—too short for a 20-second cooldown.

Decision:
- No behavior change: the agent still produces the same outputs. The only difference is that transient 429 responses now get retried with appropriate backoff instead of immediately failing the turn.

Files changed:
- `src/runtime/openai-agent-runtime.ts`
- `docs/implementation-log.md`

### Reduce token volume sent to extraction and reply models

- `buildExtractorPlanSnapshot`: stripped provider details from the extraction prompt. Previously sent up to 8 providers with rank, id, title, slug, category, location, price_level, services (up to 4), promo, and description (140 chars). Now sends only rank, id, and title for up to 4 providers.
  - Rationale: the extractor's job is to classify intent and extract plan fields. Knowing provider titles and IDs is enough to detect references like "el primero" or "me gusta el X"; descriptions and services do not improve extraction accuracy.
- `summarizeRecommendedProviders`: removed `detailUrl` from every provider line and reduced `serviceHighlights` from 2 to 1.
  - Rationale: `detailUrl` is never spoken to the user and URLs tokenize very inefficiently (~15–30 tokens each). One service highlight is sufficient to differentiate providers in the model context; two adds marginal value at non-trivial token cost.

Reason:
- The 429 TPM error indicated the agent was close to the 200k token-per-minute ceiling. Reducing prompt size lowers the per-request token footprint, decreasing the probability of hitting the limit and also reducing latency/cost.

Decision:
- These are safe cuts because none of the removed fields influence the model's behavioral contract: extraction still sees which providers exist, and reply still sees location, price, promo, description, and one service highlight for each provider.

Files changed:
- `src/runtime/openai-agent-runtime.ts`
- `src/core/plan.ts`
- `docs/implementation-log.md`

## 2026-04-30

### Add structured channel-specific reply rendering

- Added structured reply contracts so model output is parsed into typed presentation data before it reaches channel adapters.
- Added deterministic WhatsApp and webchat renderers, with webchat using plain text bullets and direct URLs instead of Markdown or HTML assumptions.
- Required inbound Lambda requests to include `channel`, and registered renderers for `whatsapp`, `webchat`, and `terminal_whatsapp`.
- Updated offline evals and agent service tests to pass explicit renderer maps.
- Added message renderer tests and a repo `npm run deploy` command that runs checks before deployment.

Reason:
- Batch 1 feedback identified presentation drift: Markdown leakage, inconsistent bullets, and channel-specific formatting decisions being left to the model. The runtime needed a typed, deterministic rendering layer to keep business logic channel-agnostic while producing stable outbound text.

Decision:
- Keep Lambda responses as a plain `message` string for client compatibility, but make the generated content structured internally. Use plain-text webchat output until the frontend explicitly supports Markdown or HTML.

Flow nodes affected:
- All conversational nodes indirectly, because every reply can now be rendered from structured output.
- `contacto_inicial`
- `recomendar`
- `crear_lead_cerrar`

Files changed:
- `src/runtime/structured-message.ts`
- `src/runtime/message-renderer.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/agent-service.ts`
- `src/lambda/handler.ts`
- `src/evals/targets/offline.ts`
- `tests/agent-service.test.ts`
- `tests/message-renderer.test.ts`
- `prompts/shared/output_style.txt`
- `prompts/shared/common_anti_patterns.txt`
- `prompts/nodes/contacto_inicial/response_contract.txt`
- `prompts/nodes/recomendar/response_contract.txt`
- `prompts/nodes/crear_lead_cerrar/response_contract.txt`
- `package.json`
- `docs/implementation-log.md`

### Restore Batch 2 no-cooling lifecycle behavior

- Removed the finished-plan TTL contract from plan storage, runtime reply requests, and finish-plan tool output.
- Updated finished-plan tests so new planning intents reset the plan immediately instead of showing a 24-hour cooling message.
- Kept telemetry TTL untouched; only the voluntary finished-plan cooldown mechanism was removed.

Reason:
- Batch 2 requires closed plans to stop mentioning cooling periods and to allow a fresh plan when the user asks for a new planning flow.

Decision:
- Treat finished plans as retained context unless the next user intent is planning-related; do not persist a DynamoDB TTL for finished plans.

Files changed:
- `src/core/plan.ts`
- `src/storage/plan-store.ts`
- `src/runtime/contracts.ts`
- `src/runtime/finish-plan-tool.ts`
- `src/runtime/agent-service.ts`
- `tests/agent-service.test.ts`
- `tests/plan-lifecycle.test.ts`
- `prompts/nodes/crear_lead_cerrar/response_contract.txt`
- `prompts/nodes/necesidad_cubierta/response_contract.txt`
- `docs/implementation-log.md`

### Restore Batch 3 contact validation consistency

- Verified that the runtime Batch 3 contact plumbing is present: `NormalizedInboundMessage.contactPhone`, Lambda `contact_phone` wiring, `contact_validation_error` trace fields, runtime contact normalization/validation, and finish-plan phone splitting.
- Restored dedicated Batch 3 regression tests in `tests/agent-service.test.ts` for invalid phone rejection, invalid email rejection, standalone phone correction, webhook phone seeding, Peruvian finish-plan splitting, and Mexican finish-plan splitting.
- Kept the phone storage convention aligned with WhatsApp-style payloads: `contact_phone` stores the full international number as digits-only (E.164 without `+`), and finish-plan splits country code at the gateway boundary.
- Confirmed `tests/perf-trace.test.ts` fixtures include `contact_validation_error` for both extraction and plan summaries.
- Fixed restored Batch 5 provider-fit utilities enough to keep `npm run check` green: Spanish `mil soles` budget parsing, accented photography category normalization, plural dessert category normalization, and birthday-vs-wedding ranking penalty behavior.

Reason:
- A restore left Batch 3 runtime code mostly present but dropped its regression coverage, which made contact validation vulnerable to silent regression. The same check run exposed restored Batch 5 tests that no longer matched the implementation.

Decision:
- Treat Batch 3 as consistent only when both runtime behavior and regression coverage are present.
- Keep phone handling country-agnostic and WhatsApp-compatible rather than Peruvian-local-only.
- Preserve the repository rule that every code/test/doc change must finish with `npm run check` passing.

Files changed:
- `tests/agent-service.test.ts`
- `src/runtime/provider-fit.ts`
- `docs/implementation-log.md`

### Implement Batch 5 structured provider-fit reranking

- Added `providerFitCriteria` to the extractor output contract so the LLM turns the user request into structured ranking criteria before provider reranking.
- Replaced provider intent keyword classification with deterministic scoring driven by those extracted criteria plus provider detail fields: event types, category, descriptions, service highlights, terms, promos, and price level.
- Wired `AgentService` to enrich provider search results, require extractor criteria, rerank the enriched list, and persist/send the reranked shortlist to the final reply LLM.
- Added provider-fit regression coverage for the low-budget birthday catering case where La Botanería should outrank wedding-only or high-price options.

Reason:
- Batch 5 feedback showed search results could contain providers that technically matched a category but were poor fits for the user's actual event and budget. The extractor must define the user's ranking intent once, then the runtime should apply it consistently before asking the reply model to present final options.

Decision:
- Do not run a second LLM over providers and do not silently fallback when criteria are missing. The extractor owns structured intent/criteria extraction; the runtime owns deterministic provider reranking; the reply LLM only chooses how to present from the already reranked shortlist.

Files changed:
- `src/runtime/provider-fit.ts`
- `src/runtime/contracts.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/agent-service.ts`
- `src/core/plan.ts`
- `src/evals/targets/offline.ts`
- `tests/provider-fit.test.ts`
- `tests/agent-service.test.ts`

### Add structured multi-need elicitation and plan editing

- Added the `elicitacion_necesidades` node and prompt bundle so event-level planning can create multiple provider needs at once.
- Added Zod-backed structured extraction schemas for provider query intents, plan operations, provider references, recommendation explanations, and provider detail requests.
- Added a multi-need provider retrieval path that executes structured query intents per need, enriches provider details, ranks each need independently, and persists independent shortlists.
- Added global structured provider-plan operations for adding, updating, deleting, deferring, reactivating, selecting, unselecting, and replacing providers or needs.
- Extended trace/terminal diagnostics and eval fixtures to expose structured extraction counts and multi-need query-intent search.
- Clarified extractor retrieval readiness so category + city/location + guest range or budget is enough for first-pass provider retrieval; exact date or district can remain as later refinement context.
- Added event-type-specific provider priority menus and a runtime elicitation gate: broad event descriptions now produce a compact starter menu without provider search, while detailed concepts can still run multi-need retrieval.

Reason:
- Event planning should be event-plan-first: a rich event description should produce several provider needs and shortlists in one pass, not force the user through one category at a time.

Decision:
- Use clean Zod schemas and structured extraction fields only for the new behavior. Do not add keyword-based routing or compatibility aliases for the new extraction shape.
- Treat event-type priorities as a runtime guardrail so model output cannot fan out into every marketplace category.

Files changed:
- `src/core/decision-nodes.ts`
- `src/core/event-provider-priorities.ts`
- `src/core/plan.ts`
- `src/core/trace.ts`
- `src/runtime/extraction-schemas.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/provider-gateway.ts`
- `src/runtime/provider-vector-search.ts`
- `src/runtime/sinenvolturas-gateway.ts`
- `src/runtime/prompt-manifest.ts`
- `src/evals/case-schema.ts`
- `src/evals/targets/offline.ts`
- `src/terminal/client.ts`
- `prompts/extractors/field_definitions.txt`
- `prompts/extractors/normalization_rules.txt`
- `prompts/nodes/elicitacion_necesidades/*`
- `tests/extraction-schemas.test.ts`
- `tests/agent-service.test.ts`
- `evals/cases/multi-need-elicitation-shortlists.yaml`
- `evals/suites/dev_regression.yaml`
- `docs/implementation-log.md`

### Make FAQ retrieval observable and required

- Restricted the hosted OpenAI `file_search` tool to the `consultar_faq` node instead of injecting it into every reply node.
- Made FAQ replies require a tool call when the KB vector store is configured, and enabled included search results for trace diagnostics.
- Added hosted-tool trace extraction so live evals can assert that `file_search` was actually called, not merely available.
- Scoped hosted-tool trace extraction to current-turn SDK items so prior FAQ session history does not appear as a tool call after returning to planning.
- Implemented the existing `provider_result_count` eval expectation so FAQ cases can assert that provider search stayed out of KB turns.
- Strengthened the FAQ tool policy so the first FAQ action is always a faithful KB search rather than an answer from model memory.
- Added live Lambda eval cases for direct FAQ commission questions and a multi-turn FAQ re-ask followed by provider planning.
- Replaced reply output schemas with node-specific required fields after live validation exposed unsupported optional fields in the shared structured schema.
- Locally scraped the current Tawk KB with `KB_SKIP_UPLOAD=true` to confirm stable article content for eval assertions.

Reason:
- FAQ mode could previously appear configured while production replies were not provably consulting the KB. The migration needs evidence that FAQ answers are retrieval-backed and honest when the answer is missing.

Decision:
- Treat `file_search` as a FAQ-only, traceable runtime dependency. Tests now verify both wiring and live behavior through real generation turns.

Files changed:
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/structured-message.ts`
- `prompts/nodes/consultar_faq/tool_policy.txt`
- `tests/openai-agent-runtime-token-usage.test.ts`
- `src/evals/runner.ts`
- `evals/cases/live-faq-commission-uses-kb.yaml`
- `evals/cases/live-faq-reask-then-planning.yaml`
- `evals/suites/live_comprehensive.yaml`
- `docs/implementation-log.md`

### Verify FAQ interruption from all nodes

- Added an `AgentService` regression that seeds every active decision node and sends a FAQ turn, asserting the service routes to `consultar_faq`, persists that node, and does not run provider search.
- Added a live Lambda eval seeded from `recomendar` to verify a mid-recommendation user can ask a FAQ and trigger real `file_search` retrieval.

Reason:
- Runtime routing supported FAQ as a global intent, but "from every node" was only inferred from control flow. The migration needs an explicit safety net.

Decision:
- Cover every active node deterministically in unit tests, then cover the highest-risk mid-flow interruption with real live generation.

Files changed:
- `tests/agent-service.test.ts`
- `evals/cases/live-faq-from-recommendation.yaml`
- `evals/suites/live_comprehensive.yaml`
- `docs/implementation-log.md`

### Add npm deploy script

- Added `npm run deploy` as the canonical package script for `node scripts/deploy.mjs`.

Reason:
- Deployment previously required knowing the underlying script path. The project should support a standard npm deploy command.

Decision:
- Keep deployment behavior unchanged and expose the existing script through `package.json`.

Files changed:
- `package.json`
- `docs/implementation-log.md`

### Add native guardrails for email integrity and jailbreak attempts

- Added an OpenAI Agents SDK output guardrail that trips when generated replies contain corrupted or non-canonical Sin Envolturas support emails, then normalizes the final structured output to `hola@sinenvolturas.com`.
- Added a blocking OpenAI Agents SDK input guardrail for direct jailbreak and prompt-injection attempts such as ignoring system/developer instructions or revealing internal prompts.
- Added regression coverage for support email normalization and jailbreak detection.

Reason:
- Live FAQ output produced `[email protected]` instead of the real support email. Support emails must remain truthful and exact.
- The same guardrail layer should also reject obvious attempts to override system/developer instructions.

Decision:
- Use native Agents SDK guardrails at the generation boundary and keep deterministic normalization as the recovery path so users receive a correct answer instead of a server error.

Files changed:
- `src/runtime/openai-agent-runtime.ts`
- `tests/openai-agent-runtime-token-usage.test.ts`
- `docs/implementation-log.md`

### Apply event-type provider priorities to normal plan projection

- Reused the normalized event-type provider priority map when structured extractor categories are projected into `provider_needs` in the normal flow.
- Filtered inferred provider categories against the normalized event type while preserving explicitly requested active/vendor categories.
- Collapsed broad multi-need normal projections to the event-specific starter set so irrelevant categories such as wedding planners do not appear for birthdays.
- Added a regression proving a birthday plan with an overbroad extractor output keeps the birthday starter needs and excludes `Wedding planners`.

Reason:
- Event-specific provider prioritization must be a plan-level invariant, not only an elicitation-node behavior. Normal provider search turns can also populate multiple needs before the elicitation node runs.

Decision:
- Keep structured extraction as the only signal source, then normalize category projection through the shared event priority map in `AgentService`.

Files changed:
- `src/runtime/agent-service.ts`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Hard-enforce invisible associated-event auth flow

- Hid `guest_auth` and internal auth metadata from the reply model prompt snapshot.
- Removed `lookup_user_event_context` from the model-callable tool registry and added manifest coverage to keep it unavailable.
- Masked the historical `consultar_evento_invitado` node name as `consultar_evento_asociado` in prompt headings and reply context so model-facing wording covers hosts, owners, guests, celebrated users, and buyers.
- Changed model-facing event context from authenticated-event wording to verified associated-event wording.
- Parsed the real login-code response shape at `data.user.credentials.access_token`.
- Persisted successful event auth for exactly 24 hours, ignoring backend `expires_in` for agent-session lifetime.
- Reused valid persisted auth across follow-up sessions, requested a new code after expiry, and cleared failing lookup tokens without immediately requesting another code in the same turn.
- Added prompt isolation, gateway token parsing, 24-hour auth-window, expired-token, and no-model-lookup regression coverage.

Reason:
- The model should not decide or see internal auth state unless deterministic code needs it to ask a user-facing next step. The live API also returns access tokens under `credentials`, which could make correct codes appear invalid.

Decision:
- Keep auth and lookup fully deterministic in `AgentService`; the LLM only receives a user-facing next-step note or sanitized verified event context. Preserve internal node names and state-machine enums to avoid a broad migration, but mask them in model-visible prompt text.

Files changed:
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/prompt-loader.ts`
- `src/runtime/prompt-manifest.ts`
- `src/runtime/sinenvolturas-gateway.ts`
- `prompts/extractors/field_definitions.txt`
- `prompts/extractors/conflict_resolution.txt`
- `prompts/nodes/consultar_evento_invitado/system.txt`
- `prompts/nodes/consultar_evento_invitado/response_contract.txt`
- `prompts/nodes/consultar_evento_invitado/tool_policy.txt`
- `prompts/nodes/consultar_evento_invitado/transition_policy.txt`
- `tests/agent-service.test.ts`
- `tests/sinenvolturas-gateway.test.ts`
- `tests/openai-agent-runtime-token-usage.test.ts`
- `tests/prompt-loader.test.ts`
- `tests/message-renderer.test.ts`
- `docs/implementation-log.md`

### Require verified email on authenticated guest lookup

- Changed authenticated guest event lookup to require both the bearer token and the verified email used during login-code validation.
- Updated `SinEnvolturasGateway.lookupAuthenticatedGuest` to call `/user-lookup?email=<verified-email>` with `Authorization: Bearer <token>`.
- Kept the lookup deterministic in `AgentService`: code validation and lookup happen together, and the model only receives the authenticated event context.
- Mapped the observed `400 {"error":"Invalid or expired code"}` login-code response to `invalid_code` so the flow asks for the code again instead of failing generically.
- Updated service, gateway, state-machine, and offline eval fakes/tests to enforce the token-plus-email lookup contract.

Reason:
- Raw API validation showed that `/api/guest-service/user-lookup` returns `422` when called with only a bearer token; it requires `email` or `phone` even after login-code validation. This caused an invalid agent response after successful code verification.

Decision:
- Use the same verified email for lookup immediately after successful code validation and for persisted-token follow-ups. Do not expose direct lookup as a model tool in `consultar_evento_invitado`.

Files changed:
- `src/runtime/provider-gateway.ts`
- `src/runtime/sinenvolturas-gateway.ts`
- `src/runtime/agent-service.ts`
- `src/evals/targets/offline.ts`
- `tests/sinenvolturas-gateway.test.ts`
- `tests/agent-service.test.ts`
- `tests/batch4-state-machine.test.ts`
- `docs/implementation-log.md`

### Add deterministic auth gate for invited event lookup

- Added persisted `guest_auth` state for `consultar_evento_invitado` with code-requested, authenticated, email-not-found, failed, token, expiry, error, and request timestamp fields.
- Added gateway methods for guest login-code request, login-code verification, and bearer-token authenticated guest event lookup.
- Moved invited event authentication and event lookup out of LLM tool selection and into `AgentService`; the reply model now receives authenticated event context only after deterministic verification succeeds.
- Disabled `lookup_user_event_context` as an allowed tool for `consultar_evento_invitado` and updated Spanish node prompts to phrase auth states without deciding auth.
- Added CloudFormation, deploy-script, and README env support for `SINENVOLTURAS_GUEST_AUTH_BASE_URL`.
- Added gateway and agent-service regression tests for unknown email rejection, code request, invalid code, successful token persistence, token reuse, and token failure re-auth.

Reason:
- Event details are user-specific and should not depend on model discretion. Unknown emails must be rejected before code entry, and the model should never decide whether to trust an email, send a code, validate a code, or call authenticated lookup.

Decision:
- Persist guest bearer tokens in the plan until expiry or authenticated lookup failure, using a 24-hour default expiry if the API response does not provide one. Redact tokens from prompt context and trace inputs/outputs while preserving auth status and deterministic tool traces.

Files changed:
- `src/core/plan.ts`
- `src/runtime/provider-gateway.ts`
- `src/runtime/sinenvolturas-gateway.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/prompt-manifest.ts`
- `src/runtime/config.ts`
- `src/lambda/handler.ts`
- `prompts/nodes/consultar_evento_invitado/system.txt`
- `prompts/nodes/consultar_evento_invitado/tool_policy.txt`
- `prompts/nodes/consultar_evento_invitado/response_contract.txt`
- `infra/cloudformation/stack.yaml`
- `scripts/deploy.mjs`
- `README.md`
- `tests/sinenvolturas-gateway.test.ts`
- `tests/agent-service.test.ts`
- `tests/prompt-loader.test.ts`

### Simplify invited event list fields

- Changed invited-event responses to present event information as a simple list with the user-relevant fields: name, URL, place, date, attendance confirmation, and companion indication.
- Added `url` and `place` to the compact event lookup payload. Public event URLs are built from the root slug route (`https://sinenvolturas.com/{slug}`), and place uses the best available location field with country as fallback.
- Removed generic summary instructions that encouraged low-value fields like visibility, amounts, transactions, and country unless the user asks for them explicitly.
- Added tests for URL/place mapping and prompt bundle coverage for the required fields.

Reason:
- The previous "complete summary" output was technically exhaustive but not useful. For event lookup, users need a concise list of practical event details.

Decision:
- Keep pruning in TypeScript and make the model-facing event summary include only user-useful event fields by default. Preserve detailed fields in the compact payload for explicit follow-up questions, but instruct the response prompt not to show them unless asked.

Files changed:
- `src/runtime/provider-gateway.ts`
- `src/runtime/sinenvolturas-gateway.ts`
- `prompts/nodes/consultar_evento_invitado/system.txt`
- `prompts/nodes/consultar_evento_invitado/tool_policy.txt`
- `prompts/nodes/consultar_evento_invitado/response_contract.txt`
- `tests/agent-service.test.ts`
- `tests/sinenvolturas-gateway.test.ts`
- `tests/prompt-loader.test.ts`
- `docs/implementation-log.md`

### Require complete invited-event summaries

- Updated invited-event prompts so answers about a selected event always include a compact event summary, not only the specific field requested.
- Made the token-pruned tool payload contract explicit in the prompt: the model should use the compact summary and not expect raw endpoint JSON.
- Added prompt-loader coverage to lock the event-summary and pruning instructions into the loaded prompt bundle.

Reason:
- Live testing showed event-specific questions could answer only the date/time. Users asking about an event should receive the key available event information in one useful response.

Decision:
- Keep the existing TypeScript pruning layer as the source of truth for model-facing event data, and enforce response completeness at the node prompt contract level.

Files changed:
- `prompts/nodes/consultar_evento_invitado/system.txt`
- `prompts/nodes/consultar_evento_invitado/tool_policy.txt`
- `prompts/nodes/consultar_evento_invitado/response_contract.txt`
- `tests/prompt-loader.test.ts`
- `docs/implementation-log.md`

### Make discovery welcome capabilities dynamic

- Added typed agent feature flags to runtime config, CloudFormation, and deploy parameter wiring.
- Passed feature flags into the OpenAI reply runtime and generated a capability summary from the enabled features.
- Extended `welcome` structured messages with `capability_lines_es` so renderers can show a richer discovery menu without hardcoded prose.
- Updated onboarding prompts to use the runtime-provided enabled capability list instead of a static two-option sentence.
- Added renderer and runtime tests for capability rendering and feature-gated capability summaries.

Reason:
- The first "how can you help me?" reply was too terse and static. It also needed to stay aligned with feature toggles so future capability changes do not require rewriting onboarding copy in multiple places.

Decision:
- Keep flow intent extraction LLM-based, but make capability discovery deterministic from typed runtime configuration. The state-machine welcome path remains responsible for choosing the `welcome` output schema when there is no planning context, while the reply runtime supplies the currently enabled capability surface.

Files changed:
- `src/runtime/config.ts`
- `src/lambda/handler.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/structured-message.ts`
- `src/runtime/message-renderer.ts`
- `infra/cloudformation/stack.yaml`
- `scripts/deploy.mjs`
- `prompts/shared/base_system.txt`
- `prompts/nodes/contacto_inicial/response_contract.txt`
- `prompts/nodes/entrevista/response_contract.txt`
- `tests/message-renderer.test.ts`
- `tests/openai-agent-runtime-token-usage.test.ts`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Tighten invited event lookup follow-ups and payload shape

- Kept `consultar_evento_invitado` as the resume node so event lookup follow-up questions do not fall back to planning interview mode.
- Added a deterministic guard that keeps short invited-event follow-ups in the invited-event route when the extractor mislabels them as provider detail and there is no provider context.
- Replaced the model-facing guest-service output with a compact typed event summary: user id/name/contact, grouped event summaries, RSVP status, host/celebrated metadata, aggregate event fields, and minimal recent-order summaries.
- Removed raw endpoint data, bank accounts, addresses, documents, subscriptions, and unrelated user profile fields from the tool output.
- Clarified prompts for multi-event disambiguation and follow-up matching by event name/slug.
- Added tests for invited-event resume behavior, misclassified follow-up handling, compact email lookup output, and phone lookup URL mapping.

Reason:
- Live terminal testing showed a follow-up like "dame la info de paolo y mariana" routed to `entrevista` as provider detail. The previous tool also exposed the full endpoint payload to the model, wasting tokens and carrying unnecessary sensitive fields.

Decision:
- Keep this mode stateful at the node level and parse the endpoint response in TypeScript before the agent sees it. Email and phone are both supported by the endpoint contract from the pasted notes: email is exact-match and phone matches `phone_number`.

Files changed:
- `src/core/decision-flow.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/provider-gateway.ts`
- `src/runtime/sinenvolturas-gateway.ts`
- `src/evals/targets/offline.ts`
- `prompts/extractors/conflict_resolution.txt`
- `prompts/nodes/consultar_evento_invitado/system.txt`
- `prompts/nodes/consultar_evento_invitado/tool_policy.txt`
- `prompts/nodes/consultar_evento_invitado/response_contract.txt`
- `prompts/nodes/consultar_evento_invitado/transition_policy.txt`
- `tests/agent-service.test.ts`
- `tests/batch4-state-machine.test.ts`
- `tests/decision-flow.test.ts`
- `tests/sinenvolturas-gateway.test.ts`
- `docs/implementation-log.md`

### Add invited event lookup mode

- Added a `consultar_evento_invitado` intent and decision node for questions about events associated with the asking user.
- Added node prompts that require consulting `lookup_user_event_context` before answering event facts and keep provider search out of this mode.
- Added a typed guest-service lookup gateway method for `/user-lookup` by email or phone, plus a dedicated runtime config and CloudFormation parameter for the guest-service base URL.
- Wired the new tool into the OpenAI Agents runtime and allowed it only on the invited-event node.
- Added regression coverage for state-machine routing from every saved node and guest-service URL mapping.

Reason:
- Users can ask about a real Sin Envolturas event they are invited to, which is neither provider planning nor general FAQ. The agent needs to verify event data through the provided endpoint response shape before answering.

Decision:
- Model this as a separate informational node, similar to FAQ, so it preserves the event plan and resumes planning afterward without running provider search. Keep the runtime channel-agnostic and use email/phone identifiers already known by the plan or provided by the user.

Files changed:
- `src/core/decision-nodes.ts`
- `src/core/decision-flow.ts`
- `src/core/plan.ts`
- `src/core/turn-decision.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/config.ts`
- `src/runtime/contracts.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/provider-gateway.ts`
- `src/runtime/sinenvolturas-gateway.ts`
- `src/runtime/prompt-manifest.ts`
- `src/lambda/handler.ts`
- `infra/cloudformation/stack.yaml`
- `scripts/deploy.mjs`
- `prompts/extractors/field_definitions.txt`
- `prompts/extractors/conflict_resolution.txt`
- `prompts/nodes/consultar_evento_invitado/system.txt`
- `prompts/nodes/consultar_evento_invitado/tool_policy.txt`
- `prompts/nodes/consultar_evento_invitado/response_contract.txt`
- `prompts/nodes/consultar_evento_invitado/transition_policy.txt`
- `tests/agent-service.test.ts`
- `tests/prompt-loader.test.ts`
- `tests/sinenvolturas-gateway.test.ts`
- `docs/implementation-log.md`

### Add deterministic turn decisions and session-scoped focus

- Added Zod-validated `DecisionEvidence`, `TurnDecision`, per-need sufficiency, and session-focus schemas.
- Routed single-vs-multi provider search through a decision object before provider tools or reply composition.
- Added turn-decision, presentation-scope, route-kind, session-focus, and invariant-status fields to traces and persisted perf records.
- Added optional `session_id` to Lambda, terminal, and live-eval request bodies; session focus is stored as a companion item in the plans table when adapters provide it.
- Added a compact deterministic state-decision block to reply composition so prompts no longer need to infer the route from broad transition text.
- Added regression coverage proving a stale Catering active need cannot downgrade a current multi-front wedding request into single-category search.

Reason:
- A live conversation produced five structured provider fronts, but the runtime followed stale active Catering state and presented only Catering recommendations.

Decision:
- The model owns structured interpretation; application code owns routing consequences, provider search mode, presentation scope, persistence, and invariant traceability.

Files changed:
- `src/core/turn-decision.ts`
- `src/core/sufficiency.ts`
- `src/core/messages.ts`
- `src/core/trace.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/contracts.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/lambda/handler.ts`
- `src/logs/trace/perf.ts`
- `src/storage/plan-store.ts`
- `src/storage/in-memory-plan-store.ts`
- `src/storage/dynamo-plan-store.ts`
- `src/terminal/client.ts`
- `src/evals/targets/live-lambda.ts`
- `tests/agent-service.test.ts`
- `tests/perf-trace.test.ts`
- `docs/channel-integration.md`
- `docs/implementation-log.md`

### Flatten provider-need retrieval queries

- Replaced the extractor-facing `queryStrings` plus `subQueries` hierarchy with one `queries` list per provider need.
- Capped each provider need to 3 retrieval queries and detailed elicitation to 5 searched needs per turn; additional detailed needs remain in the plan as identified and unsearched.
- Updated elicitation gating so broad category menus do not trigger provider searches just because many generic category queries were extracted.
- Added regression coverage for capped detailed search and retained extra needs.

Reason:
- The previous query/sub-query hierarchy encouraged over-fragmented retrieval, especially during KB-style or broad elicitation turns.

Decision:
- Keep one model-facing query level and ask the extractor to consolidate first, splitting only when components inside the same provider need are genuinely different.

Files changed:
- `src/runtime/extraction-schemas.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `prompts/extractors/field_definitions.txt`
- `evals/cases/multi-need-elicitation-shortlists.yaml`
- `tests/agent-service.test.ts`
- `tests/extraction-schemas.test.ts`
- `docs/implementation-log.md`

### Persist structured traceability summaries in perf telemetry

- Added first-class trace and perf fields for close actions, provider-selection references, contact validation, provider candidate provenance, and FAQ retrieval usage.
- Replaced contact validation trace inference based on operational note text with structured validation over extracted and persisted contact fields.
- Tightened extraction Zod schemas so FAQ queries, provider sub-queries, and close actions use required defaulted fields accepted by live structured outputs.
- Added an OpenAI structured-output schema compatibility validator and regression test that converts every OpenAI-facing output schema in one pass.
- Updated eval trace parsing and regression tests so live Lambda telemetry can be asserted without relying on exact wording.

Reason:
- Batch feedback validation needed more deterministic telemetry in the perf table to explain why close, FAQ, and provider-selection turns took a particular path.

Decision:
- Store compact Zod-validated summaries alongside the existing trace summaries, keeping exact text matching out of critical telemetry decisions.

Files changed:
- `src/core/trace.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/close-flow-schemas.ts`
- `src/runtime/extraction-schemas.ts`
- `src/runtime/openai-structured-schema.ts`
- `src/logs/trace/perf.ts`
- `src/evals/case-schema.ts`
- `tests/agent-service.test.ts`
- `tests/extraction-schemas.test.ts`
- `tests/openai-structured-schema.test.ts`
- `tests/perf-trace.test.ts`
- `docs/implementation-log.md`

### Stabilize close selections and contact validation

- Resolved close-time provider selections from structured `selectedProviderReferences` before checking unresolved shortlists.
- Removed raw `ninguna` text as a critical close mutation path; deferring a pending need now requires structured `closeAction: { type: "defer_need" }`.
- Kept close/contact clarification turns in `crear_lead_cerrar` when extraction emits `closeAction: { type: "clarify" }`, preventing provider search from extension-code questions.
- Reused the typed phone parser in contact normalization and `finish_plan`, requiring supported country codes and complete national numbers before persisting or sending quote requests.
- Updated close-node and extractor prompts to request phone numbers with country code and to handle extension/country-code clarification without relisting providers.
- Added regression coverage for structured close selections, structured defer actions, raw decline non-mutation, incomplete Peru phone rejection, local phone rejection, finish-plan phone splitting, and extension clarification.

Reason:
- Batch 2 perf logs showed selected providers being lost during close, raw decline text mutating unrelated needs, incomplete phones reaching `finish_plan`, and phone-extension questions triggering provider search.

Decision:
- Keep critical close and contact actions driven by Zod-validated structured extraction and service-owned validation, with exact text only allowed as non-critical extraction input.

Files changed:
- `src/runtime/agent-service.ts`
- `src/runtime/finish-plan-tool.ts`
- `src/runtime/openai-agent-runtime.ts`
- `prompts/extractors/normalization_rules.txt`
- `prompts/nodes/crear_lead_cerrar/response_contract.txt`
- `prompts/nodes/crear_lead_cerrar/transition_policy.txt`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Apply locality ranking to hybrid provider search

- Updated vector-only and hybrid provider search results to pass through the same category/location selector used by API search.
- Changed hybrid search to merge API and vector candidates instead of returning vector candidates alone whenever vector hits exist.
- Applied typed category/location selection to vector query-intent results as well.
- Verified the Lurín trace candidates against the live provider API: ids `164` and `173` are Mexico, while ids `132`, `142`, `131`, `133`, and `95` are Peru.
- Added regression coverage where high-scoring Mexico vector hits are omitted when Peru photography providers are available for a Lurín/Lima/Peru plan.
- Added regression coverage that the same external user can resume with a previously selected provider and proceed to contact without a new provider search.

Reason:
- Batch 2 logs showed a Lurín, Peru photography search returning Mexico providers because hybrid search bypassed the location-aware selector.

Decision:
- Treat vector search as candidate retrieval only; final provider presentation must always pass through deterministic category/location selection.

Files changed:
- `src/runtime/sinenvolturas-gateway.ts`
- `tests/sinenvolturas-gateway.test.ts`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Clarify FAQ scope and product-claim support

- Updated shared scope and welcome prompts to state that the assistant helps with Sin Envolturas questions and event-provider planning, but does not design or build external websites.
- Strengthened FAQ prompts so support escalation consistently offers the web chat or `hola@sinenvolturas.com`, without claiming there is no direct number unless the knowledge base says so.
- Inspected the live scraped knowledge base without uploading changes; confirmed relevant facts are present across the `estamos-obligados-a-comprar` and Shop claim articles.
- Updated FAQ policy so gift/product claim questions combine no-obligation gift guidance, configured commission/value framing, direct brand claim handling, and Sin Envolturas help channels.
- Added live eval cases for web-design/support scope and gift/product-claim wording, and included them in the live comprehensive suite.
- Added prompt-loader regression coverage for the new scope and FAQ policy instructions.

Reason:
- Batch 2 feedback showed out-of-scope web-design support copy and gift/product claim answers that were directionally right but unclear and incomplete.

Decision:
- Keep product facts grounded in the knowledge base, but make the FAQ node explicitly combine related KB facts when a user asks a blended support question.

Files changed:
- `prompts/shared/base_system.txt`
- `prompts/shared/domain_scope.txt`
- `prompts/extractors/field_definitions.txt`
- `prompts/nodes/contacto_inicial/response_contract.txt`
- `prompts/nodes/consultar_faq/system.txt`
- `prompts/nodes/consultar_faq/response_contract.txt`
- `prompts/nodes/consultar_faq/tool_policy.txt`
- `evals/cases/live-faq-web-design-support.yaml`
- `evals/cases/live-faq-gift-product-claim.yaml`
- `evals/suites/live_comprehensive.yaml`
- `tests/prompt-loader.test.ts`
- `docs/implementation-log.md`

### Add structured close/contact schema foundations

- Added Zod schemas for close actions and service-owned close flow results, including discriminated unions for close confirmation, need deferral, contact request, abandonment, clarification, and close outcomes.
- Added structured selected provider references and close actions to the extraction schema so later close-flow changes can consume typed extraction instead of exact user-message matching.
- Tightened contact request messages to canonical field IDs and added defensive renderer labels for legacy internal contact field names.
- Added a typed international phone parser that rejects incomplete Peru numbers, requires country codes, and returns structured extension/national-number fields.
- Added schema, renderer, and phone parser regression tests.

Reason:
- Batch 2 feedback exposed close and contact behavior that should be deterministic. Critical plan actions need structured extraction and Zod-validated service objects rather than substring matching.

Decision:
- Establish typed schema foundations first, then use them in the next milestone to refactor close-flow transitions and remove raw text-driven close mutations.

Files changed:
- `src/runtime/close-flow-schemas.ts`
- `src/runtime/phone.ts`
- `src/runtime/extraction-schemas.ts`
- `src/runtime/contracts.ts`
- `src/runtime/structured-message.ts`
- `src/runtime/message-renderer.ts`
- `tests/extraction-schemas.test.ts`
- `tests/message-renderer.test.ts`
- `tests/phone.test.ts`
- `docs/implementation-log.md`

### Add per-sub-query provider retrieval and provenance

- Added Zod-backed provider sub-query, sub-query candidate, and sub-query result models.
- Extended provider needs with optional `sub_query_results` so plans can retain which query found each selected provider.
- Updated multi-need retrieval to search each sub-query independently, rerank per component, and store selected providers per sub-query instead of merging every need into one broad shortlist.
- Added reusable selection helpers for sub-query fit criteria, category filtering, must-have evidence boosting, and no-match reporting.
- Updated multi-need structured messages and renderers to allow multiple providers per need with `match_label_es`.
- Updated extractor and elicitation prompt contracts to ask for sub-queries on complex needs such as sushi plus wedding cake.
- Compact terminal plan output now includes sub-query selected IDs and candidate IDs for debugging.

Reason:
- Provider vector search was working, but complex needs were collapsed into one shortlist. Exact matches like Edo Sushi Bar for sushi could lose to generic wedding caterers because the ranking and presentation operated at the broad need level.

Decision:
- Treat each service component inside a provider need as its own retrieval and ranking unit, while preserving the provider need as the user-facing grouping.

Files changed:
- `src/core/provider-sub-query.ts`
- `src/core/plan.ts`
- `src/runtime/extraction-schemas.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/provider-sub-query-selection.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/structured-message.ts`
- `src/runtime/message-renderer.ts`
- `src/terminal/client.ts`
- `prompts/extractors/field_definitions.txt`
- `prompts/nodes/elicitacion_necesidades/response_contract.txt`
- `tests/extraction-schemas.test.ts`
- `tests/provider-sub-query-selection.test.ts`
- `tests/message-renderer.test.ts`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Compact multi-need kickstart recommendations

- Limited `multi_need_recommendation` to one provider per need so the first plan kickstart stays scannable.
- Changed the multi-need renderer to use compact provider rows instead of full repeated provider cards.
- Kept limitations visible through `caveat_es`, rendered as `Limitación`, while avoiding repeated location/price/promo labels.
- Reduced reply-model provider context for multi-need elicitation to the top provider per need.
- Tightened prompt language so internal concepts such as "activo" or "frente activo" are not surfaced to users.
- Tightened the multi-need intro guidance so the copy says first selection/top recommendation per need instead of implying multiple options are shown per front.

Reason:
- The multi-need kickstart reply became too long and repetitive when it listed every shortlisted provider for every need.

Decision:
- Store full shortlists in the plan, but present only the top choice per need in the initial multi-need summary. Deeper comparison remains available when the user asks to review a specific front.

Files changed:
- `src/runtime/structured-message.ts`
- `src/runtime/message-renderer.ts`
- `src/runtime/openai-agent-runtime.ts`
- `prompts/nodes/elicitacion_necesidades/response_contract.txt`
- `prompts/shared/output_style.txt`
- `tests/message-renderer.test.ts`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Add structured multi-need recommendation rendering

- Added a `multi_need_recommendation` structured message type with grouped needs, provider references, and next-step guidance.
- Refactored message rendering through a shared base renderer so provider-card formatting is reusable while WhatsApp and WebChat keep channel-specific presentation.
- Updated elicitation reply schema selection so `elicitacion_necesidades` returns grouped structured results whenever the plan has stored provider shortlists.
- Added grouped provider context to reply prompts so the model emits provider IDs and rationale while renderers own names, locations, prices, promos, and ficha links.
- Added assistant identity guidance and tightened prompt style away from weak diagnostic openings such as "veo" and "detecté".
- Extended provider explanation extraction with `scope=all_needs` so users can ask for justification across all stored needs without triggering search.

Reason:
- Multi-need elicitation was searching correctly but summarizing provider choices in prose, which made the UX inconsistent and hard to tune per channel.

Decision:
- Make multi-need provider presentation a structured output and renderer concern, with clean schema changes instead of prose compatibility behavior.

Files changed:
- `src/runtime/structured-message.ts`
- `src/runtime/message-renderer.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/contracts.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/extraction-schemas.ts`
- `prompts/shared/base_system.txt`
- `prompts/shared/output_style.txt`
- `prompts/extractors/field_definitions.txt`
- `prompts/extractors/normalization_rules.txt`
- `prompts/nodes/elicitacion_necesidades/response_contract.txt`
- `prompts/nodes/entrevista/response_contract.txt`
- `prompts/nodes/seguir_refinando_guardar_plan/response_contract.txt`
- `tests/message-renderer.test.ts`
- `tests/extraction-schemas.test.ts`
- `tests/agent-service.test.ts`
- `tests/openai-agent-runtime-token-usage.test.ts`
- `docs/implementation-log.md`

### Distinguish no event from event type otro

- Clarified extractor prompt semantics: `eventType=null` means no event was described, while `eventType=otro` means a real event exists but does not fit the known taxonomy.
- Added extractor examples and normalization guidance so generic onboarding like "hola, como puedes ayudarme" uses `intent=null`, `eventType=null`, and no provider query intents.
- Kept runtime defense-in-depth based on absence of structured planning evidence, not on `otro` itself.
- Added regression coverage proving a generic greeting does not create a starter plan, while a real `otro` event with location and guest range still enters elicitation.

Reason:
- Generic onboarding was being misclassified as `elicitar_necesidades` with `eventType=otro`, creating a fake plan. `otro` should remain a valid event type, not a proxy for no-plan.

Decision:
- Make nullability the source of truth for "no event" and reserve `otro` for real out-of-taxonomy events.

Files changed:
- `prompts/extractors/field_definitions.txt`
- `prompts/extractors/normalization_rules.txt`
- `prompts/extractors/domain_knowledge.txt`
- `prompts/extractors/examples.md`
- `src/runtime/agent-service.ts`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Use query strings as detailed elicitation evidence

- Count natural-language `providerQueryIntents.queryStrings` as structured detail for the detailed elicitation gate.
- Keep the gate bounded to small query-intent sets so broad over-expanded extraction still falls back to a starter menu.
- Added explicit missing-field context to reply prompts, including a deterministic instruction not to mention missing requirements when neither plan-level nor per-need missing fields exist.
- Updated regression coverage so detailed multi-need retrieval still triggers when per-need details live in query strings rather than preferences.

Reason:
- Live detailed prompts produced retrieval-ready query intents with rich query strings, but no top-level preferences, so the runtime downgraded them and skipped provider search. The reply then hallucinated missing requirements despite empty state.

Decision:
- Treat query intent query strings as part of the structured retrieval-readiness signal and make missing-field narration state-bound.

Files changed:
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Add dynamic event-type category guidance to prompts

- Added dynamic event-type category context to extractor and reply model inputs, including the starter suggestions and full priority order for the normalized event type.
- Updated extractor and elicitation node prompts to treat event-type categories as the initial suggestion menu while still allowing off-priority categories when explicitly requested by the user.
- Added a regression proving an off-priority category such as `Wedding planners` remains available for a birthday when it is the explicit requested provider category.

Reason:
- Event-type priorities should control what the agent suggests by default, but should not behave like a hard allowlist that blocks user-insisted categories.

Decision:
- Keep the static prompt files as policy and inject the concrete event-type category menu dynamically through runtime prompt input.

Files changed:
- `src/runtime/openai-agent-runtime.ts`
- `prompts/extractors/field_definitions.txt`
- `prompts/nodes/elicitacion_necesidades/response_contract.txt`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Stop broad elicitation from inventing venue missing fields

- Raised the detailed elicitation gate so a small set of extracted categories alone no longer makes a broad event concept search-ready.
- For broad starter elicitation, discard extractor-proposed per-need missing fields such as date or district and keep only the priority-confirmation marker.
- Tightened extractor and elicitation reply prompts so date, date range, zone, and district are not described as missing requirements when a useful location is already present and those fields are not explicit plan missing fields.
- Added regression coverage where the extractor emits `fecha` and `distrito` for broad starter needs and runtime strips them before composing the reply.

Reason:
- The model told the user that Locales needed a date/date range and district even though the plan only knew country/location context and those fields are not required for provider retrieval.

Decision:
- Treat those fields as optional refinements, not default missing requirements, unless the structured plan state explicitly says otherwise.

Files changed:
- `src/runtime/agent-service.ts`
- `prompts/extractors/field_definitions.txt`
- `prompts/nodes/elicitacion_necesidades/response_contract.txt`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Advance from selected providers to the next stored shortlist

- When structured provider-selection operations succeed and another need already has a stored shortlist, the state machine now advances to `recomendar` for that next need instead of stopping in `seguir_refinando_guardar_plan`.
- Added an `existing_plan_shortlist` search strategy trace value for this no-new-search transition.
- Added provider titles to the prompt plan snapshot so multi-need plans can show the top stored choices per need instead of only IDs.
- Updated elicitation and plan-refinement response contracts to show stored top choices when they already exist.
- Added regression coverage for selecting two venue providers and immediately advancing to the Catering shortlist.

Reason:
- After the user said they wanted to quote both venue options and continue with another provider type, the agent acknowledged the edit but did not surface the next need's already stored choices.

Decision:
- Treat stored shortlists as first-class plan state: continuing to another need should present existing options immediately, without requiring another user turn or another search.

Files changed:
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/core/trace.ts`
- `prompts/nodes/elicitacion_necesidades/response_contract.txt`
- `prompts/nodes/seguir_refinando_guardar_plan/response_contract.txt`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Treat detailed query intents as enough for multi-need retrieval

- Updated the detailed elicitation gate to inspect structured `providerQueryIntents`, not only top-level extraction preferences and constraints.
- A turn with at least two retrieval-ready query intents and at least three distinct per-need preferences or constraints now triggers `multi_need_query_intents`.
- Added regression coverage for a detailed wedding request whose useful details live inside query intents: sushi catering, natural wedding photography, live music, and minimalist flowers.

Reason:
- Detailed event prompts were being downgraded to a starter menu when the extractor placed the specifics inside per-need query intents instead of top-level preferences.

Decision:
- Use the structured per-need intent payload as the source of truth for retrieval readiness.

Files changed:
- `src/runtime/agent-service.ts`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Make turn decisions authoritative for provider routing

- Moved post-extraction provider routing to the typed `TurnDecision` surface for multi-need elicitation, stored-shortlist presentation, missing-field clarification, event-context stops, provider selection stops, and single-need search.
- Removed the legacy `shouldRouteProviderSearchToElicitation` override and stopped hiding final decision/current-node mismatches with a fallback decision in the main turn trace.
- Added structured decision evidence for broad provider-menu requests so broad multi-need openings still produce an elicitation menu without relying on a scattered heuristic.
- Stopped loading node `transition_policy.txt` files into conversational prompt bundles; the reply model now receives the deterministic turn decision context instead of broad static graph policy.
- Replaced stale durable active-need wording in reply context with the turn's operative focus and added session-focus routing so a matching `session_id` can narrow an otherwise ambiguous provider search.
- Added regression coverage for the stale-active-need multi-front request and matching-session focus behavior, including assertions that `turn_decision.nextNode` matches the executed node.

Reason:
- The previous implementation logged a structured decision, but legacy branches could still override or reinterpret the route. That preserved part of the old uncoupled behavior and kept unnecessary transition policy clutter in prompts.

Decision:
- Treat `TurnDecision` as the main routing contract after structured extraction and deterministic plan reduction. Keep model work focused on structured interpretation and reply wording; keep routing consequences in application code.

Files changed:
- `src/core/turn-decision.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/prompt-manifest.ts`
- `tests/agent-service.test.ts`
- `tests/prompt-loader.test.ts`
- `docs/implementation-log.md`

### Add feedback regression and live token eval coverage

- Added a feedback coverage matrix that maps batch1 and batch2 failures to expected fixed behavior, regression IDs, and coverage type.
- Added offline feedback regression cases for close/contact loops, invalid phone handling, standalone phone correction, `ninguna` deferral, unresolved shortlist close blocking, zero-result close behavior, selection confirmation, post-error clarification, support-boundary FAQs, gift/product-claim FAQs, location filtering, and stale-focus multi-need routing.
- Added a dedicated live feedback token suite with seeded/mock multi-turn flows and a fresh multi-front request, all asserting real token usage per turn.
- Extended eval case schemas to support optional per-turn `sessionId`, richer fixture extraction fields, trace-field expectations, and a `token_usage_present` aggregate expectation.
- Passed eval `sessionId` through both offline and live targets so session focus can be tested deterministically.
- Added a live-target unit test proving seeded plans and session IDs are sent to the Lambda adapter and non-null token usage is preserved across multiple turns.

Reason:
- Feedback regressions need durable coverage that catches the old broken behavior, not only broad runtime unit tests. Live token-consuming evals are needed for failures that depend on real extraction/reply behavior over many turns.

Decision:
- Keep fast deterministic feedback coverage offline, and isolate slower token-consuming Lambda checks in `live_feedback_token_regression` so they can be run explicitly with `AWS_PROFILE=se-dev`.

Files changed:
- `docs/feedback-test-coverage.md`
- `docs/evaluation-framework.md`
- `docs/implementation-log.md`
- `evals/cases/feedback-*.yaml`
- `evals/cases/live-feedback-token-*.yaml`
- `evals/suites/feedback_regression.yaml`
- `evals/suites/live_feedback_token_regression.yaml`
- `evals/templates/base-live.yaml`
- `src/evals/case-schema.ts`
- `src/evals/runner.ts`
- `src/evals/targets/live-lambda.ts`
- `src/evals/targets/offline.ts`
- `tests/eval-live-target.test.ts`

### Tolerate incidental close-action metadata from structured extraction

- Relaxed close-action validation so non-`defer_need` close actions do not fail the whole turn if the extractor includes an incidental active category.
- Kept deterministic runtime behavior: only `defer_need` uses `closeAction.category`, and runtime trace already projects non-defer categories as null.
- Added extractor prompt guidance that `category` belongs only to `defer_need` and `reason` belongs only to `clarify`.
- Added schema coverage for accepting a non-defer close action with an incidental category.
- Routed standalone contact-field updates and contact validation errors back through `crear_lead_cerrar` when the previous node is the close flow, preventing invalid phone corrections from falling through into provider search.
- Ignored provider-selection references on close-flow contact-field turns so stale or incidental provider references cannot select a pending provider while the user is only sending contact data.
- Adjusted live token eval contact inputs to use explicit country-code phone format and removed an ambiguous final confirmation that could be interpreted as selecting a still-visible provider.
- Converted structured `delete_need` operations into `deferred` when the extractor emits them alongside provider-selection context for an unresolved shortlisted need, matching the close-flow meaning of "no quiero ninguna" without changing explicit standalone deletion.
- Added extractor guidance that declining all options for a recommended need should be `defer_need`, not `delete_need`.

Reason:
- Live token regression exposed an HTTP 500 where the deployed extractor emitted `closeAction.category` for a non-defer close action. It also showed invalid standalone phone corrections could continue into provider search, and a "no quiero ninguna" turn could delete a shortlisted need instead of deferring it.

Decision:
- Preserve strict requirements for critical fields (`defer_need` still requires a category, `clarify` still requires a reason), while treating extra non-authoritative close-action metadata as harmless.
- Treat contact updates and contact validation failures during `crear_lead_cerrar` as close-flow turns even when the extractor does not classify the message as `cerrar`.
- Preserve explicit standalone `delete_need` behavior, but prefer non-destructive deferral when a delete-shaped operation appears as part of selection/close progression over a shortlisted need.

Files changed:
- `src/runtime/close-flow-schemas.ts`
- `src/runtime/agent-service.ts`
- `prompts/extractors/field_definitions.txt`
- `evals/cases/live-feedback-token-contact-correction.yaml`
- `evals/cases/live-feedback-token-selection-defer-close.yaml`
- `evals/cases/live-feedback-token-multifront.yaml`
- `tests/agent-service.test.ts`
- `tests/extraction-schemas.test.ts`
- `docs/implementation-log.md`

### Add observable shuffled live transcript eval

- Added `eval:observable-live`, a terminal-observable live Lambda conversation runner that uses a fresh user/session and no seeded plan.
- The runner shuffles operation blocks on every run while preserving dependency order within each block.
- It prints only the transcript (`you>` and `agent>` replies) and hides plan/trace output by using the channel-style Lambda response.
- Added operation coverage for add, update, delete, select, unselect, replace, defer, reactivate, refine, detail, explain, compare, FAQ/support, and close/contact flow.
- Added unit coverage for the generated script shape and internal block ordering.

Reason:
- A human-readable end-to-end eval is needed to observe the real conversation behavior in terminal without the large plan and trace tables, while still exercising broad supported operations from scratch.

Decision:
- Keep this separate from deterministic YAML suites because the requested shuffle makes it intentionally non-snapshot-like. Use it as an observational live transcript check, not a hard regression gate.

Files changed:
- `package.json`
- `src/evals/live-observable-cli.ts`
- `src/evals/observable-live-script.ts`
- `tests/observable-live-script.test.ts`
- `docs/evaluation-framework.md`
- `docs/implementation-log.md`

### Make observable live eval plan-aware

- Replaced the static observable live transcript script with a stateful turn planner that reads the latest hidden live plan/trace context after every Lambda turn.
- Kept operation order shuffled across eligible blocks while preserving dependency order inside each block.
- Added prerequisites so provider detail, comparison, selection, replacement, deferral, reactivation, and refinement turns only target needs or shortlists that exist in the current plan.
- Switched the observable CLI to request `client_mode=cli` diagnostics internally while continuing to hide raw trace and plan output from the terminal transcript.
- Added unit coverage for shuffled eligible operation ordering, ordered dependent sub-turns, plan-derived provider/need references, fallback behavior without shortlists, and CLI diagnostic request parsing.

Reason:
- The observable live eval was exercising a broad conversation shape, but static follow-up text could drift away from the plan the agent was actually building. That made turn-by-turn observation less representative of real plan-aware conversation behavior.

Decision:
- Keep the runner observational rather than a deterministic scoring target, but make each generated user turn depend on the latest plan state. Preserve shuffled block order so runs still explore different valid operation sequences.

Files changed:
- `src/evals/live-observable-cli.ts`
- `src/evals/observable-live-script.ts`
- `tests/observable-live-script.test.ts`
- `docs/evaluation-framework.md`
- `docs/implementation-log.md`

### Ignore spurious replace operations on plain selections

- Hardened provider-plan operation application so a simple `select_provider` is not blocked by an extra `replace_provider` emitted for the same category when that category has no existing selected provider.
- Based turn-decision replace detection on applied operations instead of raw extractor operations, preventing a shadowed replace from routing a successful selection as an unresolved plan modification.
- Added agent-service regression coverage for selecting EDO Sushi Bar when extraction includes both a valid select operation and an impossible replace operation.

Reason:
- Three exact observable live runs showed one Dynamo perf trace with an operational note on `Selecciona Edo Sushi Bar para Catering.` The provider was selected correctly, but the extractor also emitted a stale replace operation and the runtime surfaced an unnecessary clarification note.

Decision:
- Treat this as extractor noise only when there is no provider to replace in that category and a concrete select operation for the category exists. Keep real replace behavior unchanged when the category already has a selected provider.

Files changed:
- `src/runtime/agent-service.ts`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Refine architecture report diagrams and prose

- Rewrote the thesis architecture report into broader academic prose sections with fewer nested headings.
- Shortened the report while preserving the implementation, AWS, OpenAI, Notion, and repository evidence gathered for the original version.
- Replaced the previous dense flow diagrams with cleaner TikZ figures.
- Added a dedicated AWS architecture topology figure that shows the channel boundary, runtime stack, sync stacks, OpenAI Agents/Vector Stores, DynamoDB, Secrets Manager, CloudWatch, EventBridge, S3, and Sin Envolturas APIs.
- Validated the revised PDF with a full LaTeX/BibTeX build, LaTeX log checks, and rendered-page visual inspection.

Reason:
- The first report draft was technically complete but read too much like structured notes, and two TikZ diagrams became visually mangled in the compiled PDF.
- The final report needs a more paper-like narrative and an architecture diagram that can later be redrawn with official AWS logos.

Decision:
- Keep the report source and rendered PDF under the copied Sullivan-template report directory.
- Treat the new AWS figure as an implementation-faithful topology rather than a branded final artwork, so it remains easy to replace nodes with official logos later.
- No Lambda redeploy was required because this was documentation-only.

Files changed:
- `docs/thesis/architecture-report/recap-agent-architecture-report.tex`
- `docs/thesis/architecture-report/recap-agent-architecture-report.pdf`
- `analysis/architecture-implementation-report/how-to-repeat.md`
- `analysis/architecture-implementation-report/dates/2026-06-22.md`
- `docs/implementation-log.md`

### Replace internal report bibliography with public sources

- Removed internal Notion/project-document entries from the report bibliography.
- Added public bibliography entries for the UNAM technical-report writing guide, official AWS service documentation, official OpenAI Agents and Retrieval documentation, and selected academic conversational-agent/RAG sources from the provided AF.csv export.
- Replaced direct internal-document citations in the prose with public citations where they support report form, serverless architecture, agent orchestration, retrieval, and production conversational-agent design.
- Removed the internal "Fuentes utilizadas" appendix table so the rendered bibliography contains only public or academic sources.
- Rebuilt the report and resolved bibliography typography warnings.

Reason:
- The report bibliography should be defensible for thesis review and should not cite private project artifacts such as Notion pages, internal implementation logs, or deployment inspection notes as formal references.

Decision:
- Keep internal evidence as the basis for architectural description, but exclude it from formal bibliography.
- Use official AWS/OpenAI documentation for platform claims and academic papers only for broader conversational-agent context.
- No Lambda redeploy was required because this was documentation-only.

Files changed:
- `docs/thesis/architecture-report/recap-agent-architecture-report.tex`
- `docs/thesis/architecture-report/recap-agent-architecture-report.pdf`
- `docs/thesis/architecture-report/sample.bib`
- `docs/implementation-log.md`

### Apply advisor feedback to architecture report

- Removed the "Proyecto de tesis" presentation line from the cover and metadata.
- Added UTEC and Sin Envolturas logo slots to the cover and page header.
- Cleaned the report `Images/` directory and replaced template assets with stable UTEC and Sin Envolturas placeholder PDFs plus a README that documents how to swap in final logos.
- Rewrote the documentary summary, introduction, architecture, conversational model, provider integration, persistence, observability, contracts, and discussion passages according to advisor feedback.
- Reworked the AWS architecture TikZ figure so AWS, OpenAI, and Sin Envolturas API boundaries are visually grouped, boxes are separated, arrows are clearer, and the color legend is explicit.
- Simplified the runtime cycle figure by removing a return-loop arrow that clipped the first node.
- Rebuilt the PDF, checked LaTeX logs, and visually inspected rendered pages for the cover and diagrams.

Reason:
- Advisor feedback requested clearer institutional branding, more formal academic prose, stronger examples, better explanation of state-machine and hybrid-search concepts, explicit contract traceability, and less crowded figures.

Decision:
- Use stable logo filenames under `docs/thesis/architecture-report/Images/` (`utec-logo.pdf` and `sin-envolturas-logo.pdf`) and draw LaTeX placeholder boxes when the final images are not present.
- Keep the AWS architecture as a TikZ topology that can later be redrawn with official service logos.
- No Lambda redeploy was required because this was documentation-only.

Files changed:
- `docs/thesis/architecture-report/recap-agent-architecture-report.tex`
- `docs/thesis/architecture-report/recap-agent-architecture-report.pdf`
- `docs/thesis/architecture-report/Images/README.md`
- `docs/thesis/architecture-report/Images/utec-logo.pdf`
- `docs/thesis/architecture-report/Images/sin-envolturas-logo.pdf`
- `docs/implementation-log.md`
# 2026-07-01

## Begin evidence-driven recommendation optimization

- Preserved the original 150-conversation evaluation as git snapshot `5317d79`
  on `codex/recommendation-metrics-optimization`.
- Added hierarchical location compatibility that distinguishes Lima districts,
  Lima, Ica, generic country-only locations, and cross-country mismatches.
- Changed provider selection to reject contradictory regions/countries and to
  stop falling back to unrelated marketplace categories when a requested
  category has no valid candidate.
- Added qualitative Spanish budget normalization so signals such as `mínimo`,
  `bajo`, `medio`, and `alto` influence provider-fit scoring.
- Expanded the study with location/category/budget constraint satisfaction,
  provider-need coverage, shortlist size, catalog exposure, and concentration
  metrics.
- Documented the metric portfolio, research basis, and non-regression decision
  rule in `analysis/technical-evaluation-study/metric-expansion.md`.

### Reason

The baseline manual audit showed that provider identity provenance was strong,
but only 35% of the reviewed recommendations were both grounded and
constraint-consistent. Code inspection confirmed that country-only location
matching treated Ica as an exact match for Lima and that category selection
could broaden to unrelated providers.

### Decision

Optimize user-relevant suitability rather than raw strict-completion counts.
Treat contradictory locations and categories as hard exclusions, preserve
unknown-granularity providers only when no verified local candidate exists, and
retain reliability, cost, latency, shortlist availability, and catalog
concentration as guardrails.

## Tighten explicit-need and budget propagation after targeted live gate

- Ran six targeted live scenarios after the initial location/category fix.
- Confirmed that contradictory Ica and Mexico providers were removed from all
  targeted Lima/San Isidro/Miraflores results.
- Changed starter-need projection to preserve only query-intent categories that
  the structured extractor marked retrieval-ready; broad event planning still
  receives the normal compact starter menu.
- Filled a missing structured fit-budget amount from the already persisted plan
  budget before both single-need and sub-query ranking.
- Added regression coverage for explicit single/multi-need preservation and
  broad-plan fallback behavior.

### Reason

The targeted gate showed that a direct single-category request could still be
expanded into default event categories and that a qualitative low budget could
be lost when a model-produced fit object left its numeric budget field null.

### Decision

Use structured retrieval readiness as the evidence that a provider category is
an established current need. Deterministic code may complete a missing numeric
budget tier from persisted structured state, but it must not infer new needs
from message text.

## Reject severe fit conflicts from shortlists

- Added a shared provider-eligibility gate after ranking.
- Low and very-low budget plans now exclude candidates tagged with
  `budget_risk` instead of presenting an expensive provider as the only option.
- Candidates with explicit avoid-constraint evidence or a known need mismatch
  are also excluded.
- Applied the same gate to single-need and structured sub-query retrieval.

### Reason

The second targeted live gate correctly identified a high-price music provider
as a budget risk for a minimum-budget request, but still displayed it. An honest
no-match/refinement outcome is more useful than a shortlist that knowingly
violates a strong constraint.

## Add reproducible technical evaluation study

- Completed the previously declared benchmark metrics by calculating latency,
  tool-use, state, trajectory, persistence, token, cache, and node-coverage
  measurements for every evaluation case.
- Added per-case error isolation and a 95-second live-turn timeout so one Lambda
  failure does not terminate a complete benchmark.
- Added a frozen, balanced 50-scenario Spanish corpus with three repetitions,
  stable event-group and route-family metadata, structured terminal criteria,
  and validation enforcing ten scenarios per event group.
- Added dated OpenAI and Lambda pricing, deterministic provider/FAQ grounding
  checks, Wilson confidence intervals, study-level aggregation, CSV exports,
  SVG charts, a stratified manual grounding-audit sample, and an English
  reproducibility dossier under `analysis/technical-evaluation-study/`.
- Added metric, pricing, manifest, reporting, and runner regression coverage.

### Reason

The thesis report described evaluation and telemetry capabilities but did not
contain an executed, repeatable quantitative protocol. The new study produces
traceable evidence for functionality, architecture, grounding, scenario
behavior, and telemetry without making user-study or baseline-comparison claims.

### Decision

Keep research aggregation outside the channel-agnostic runtime. Grade
conversational behavior from typed plans and traces rather than exact response
strings, preserve raw study runs, and price only services with a documented
public rate.

## Execute the 150-conversation technical study

- Deployed the development runtime and provider-sync stacks through
  CloudFormation, then verified the active Node.js 24 Lambda configuration,
  1 GB memory, 90-second timeout, hybrid search, and configured model aliases.
- Executed all 50 frozen scenarios three times, producing 150 conversation
  artifacts and 265 captured turns from 270 planned turns.
- Generated CSV/JSON results, SVG charts, workflow coverage, dated cost
  estimates, a 20-turn manual grounding audit, and a comprehensive findings
  report.
- Correlated the three HTTP 502 responses with CloudWatch and confirmed that
  each request reached the Lambda's 90-second timeout.
- Corrected study-level transition coverage to use adjacent nodes inside the
  structured trace path. Raw run reports were not modified.

### Result

- The strict frozen protocol completed 43/150 conversations, but a post-run
  audit found non-canonical need labels in several hard expectations; the
  findings report preserves the raw number and explicitly rejects interpreting
  it as a general agent-success rate.
- More stable component results include 95.3% event-type persistence, 97.8%
  required-shortlist production, 98.9% turn persistence, 82.4% weighted prompt
  cache use, and USD 1.19 total priced cost.
- Deterministic provider provenance passed for all grounding-required turns,
  while the manual audit exposed location and category suitability as the
  dominant remaining grounding risk.

## Improve semantic event-service fit

- Preserved hybrid-retrieval relevance as the tie-breaker when providers have
  equal structured fit scores.
- Required home-and-decoration candidates to contain evidence that their
  offering is intended for events before they can enter an event shortlist.
- Required structured sub-query must-have evidence when a provider need
  declares explicit must-have constraints.
- Added a bounded fit boost for verified event-service evidence so a relevant
  event decorator can clear the strong-match threshold while ordinary home
  retail remains excluded.
- Added regression coverage for retrieval tie-breaking and event-decoration
  eligibility.

### Reason

The first optimization iteration eliminated known location and category
conflicts, but manual review still found semantically weak providers within
otherwise correct categories, especially home retailers returned for event
decoration needs.

### Decision

Use provider-catalog evidence only after the structured event-plan sub-query has
selected the category. This validation ranks and filters provider suitability;
it does not inspect user wording or decide conversational flow.

## Execute semantic-fit evaluation iteration

- Deployed the semantic service-fit changes to the development Lambda through
  the repository CloudFormation workflow and verified the active Node.js 24,
  1 GB, 90-second configuration and model aliases.
- Executed the frozen 50-scenario manifest three times, producing 150 immutable
  conversation artifacts.
- Added event-service applicability to the generated recommendation-quality
  summary so event-oriented evidence among home-and-decoration recommendations
  is measured directly rather than inferred from category correctness.

### Result

- Location mismatches remained at zero, category satisfaction was 99.87%, and
  budget compatibility remained 100%.
- Event-service evidence among home-and-decoration provider appearances rose
  from 53.03% in iteration one to 54.69% in iteration two.
- Unique provider exposure rose from 54 to 57, flaky scenarios fell from four
  to three, and priced cost fell from USD 1.081 to USD 1.055.
- Need recommendation coverage fell from 86.15% to 83.00%, p95 conversation
  latency rose from 26.4 to 28.2 seconds, and one conversation timed out.

### Decision

Retain the iteration-two snapshot for its targeted semantic improvement, but
do not claim a general quality increase. Treat the coverage and timeout changes
as explicit regressions and require any later iteration to recover coverage
without weakening location, category, budget, or event-service safeguards.

## Restore evidence-ranked provider coverage

- Kept structured sub-query must-have evidence as a positive fit signal and
  warning source, but removed it as a universal hard eligibility requirement.
- Preserved the hard event-service evidence requirement for
  `Hogar y deco` event sub-queries.

### Reason

Iteration two reduced need recommendation coverage from 86.15% to 83.00%.
The missing-needs breakdown grew primarily in `Locales`, `Música`, and
`Florería y papelería`, where marketplace descriptions do not consistently
repeat every structured must-have phrase. Treating incomplete descriptive
metadata as proof of incompatibility created false no-match outcomes.

### Decision

Use must-have catalog evidence to rank candidates unless the constraint has a
domain-specific, independently verifiable safety rule. Continue to reject
home-and-decoration candidates that lack event-service evidence.

## Execute coverage-recovery evaluation iteration

- Deployed the evidence-ranked coverage change through CloudFormation.
- Ran a four-case live gate spanning two multi-need plans and two event
  decoration recovery paths, with all requested needs shortlisted and both
  decoration paths retaining event-service evidence.
- Executed the frozen 50-scenario manifest three times and preserved all 150
  raw conversation artifacts.

### Result

- Known location mismatches remained at zero; category and budget satisfaction
  were both 100%.
- Event-service evidence among home-and-decoration appearances increased to
  57.35%, unique displayed providers increased to 59, and all scenario outcomes
  were stable across repetitions.
- No conversation timed out. P95 conversation latency was 27.30 seconds and
  total priced cost was USD 1.065.
- The final-plan need-coverage ratio fell to 80.29% because observed extracted
  needs increased to 208 while needs with recommendations remained nearly flat
  at 167. This metric does not separate extraction breadth from retrieval.

### Decision

Use iteration three as the preferred semantic and reliability snapshot, while
preserving iteration one as the best observed need-coverage ratio. Leave the
fourth paid iteration unused until a causal improvement and a stable
expected-need denominator are defined.

## Audit publication readiness

- Added a human-readable inventory of all 50 frozen scenarios and their stable
  iteration-three pass/fail outcomes.
- Consolidated the complete functional, recommendation, architecture,
  workflow, cost, and grounding results in the analysis dossier.
- Backfilled the dossier's dated note, source inventory, and durable findings.
- Recorded that the iteration-three manual grounding sample remains unscored.

### Reason

A publication decision requires the negative and incomplete evidence alongside
the successful constraint and reliability metrics. Aggregate charts alone hide
which route families failed and whether human grounding judgments are complete.

### Decision

Do not present the current study as evidence of general recommender efficacy.
It can support a transparent engineering and evaluation case study. Require a
corrected versioned benchmark, genuine behavior fixes, completed manual audit,
and untouched confirmatory run before making performance claims.

## Enforce global search sufficiency for structured query intents

- Intersected extractor-provided retrieval-ready query intents with the
  deterministic per-need sufficiency result before selecting search routes.
- Added a regression test proving that a structured DJ query with guest count
  but no location routes to `aclarar_pedir_faltante` and performs no provider
  search.

### Reason

All five frozen missing-location scenarios searched immediately even though the
plan correctly recorded `location` as missing. Structured query intents could
bypass the same deterministic sufficiency gate applied to plan-based search.

### Decision

Treat structured LLM query intent as search evidence, not authority to waive
required global plan fields. Category, location, and either budget or guest
range remain mandatory before every provider-search mode.

## Normalize corporate auditoriums in structured extraction

- Added explicit Spanish extractor-domain guidance mapping auditoriums,
  convention centers, venues, and event halls to canonical `Locales`.
- Added explicit corporate-event normalization and a structured auditorium
  extraction example.

### Reason

The corporate no-results scenario repeatedly recognized the airport and guest
constraints but left the provider category unset, despite describing an
auditorium. This caused an unnecessary category clarification instead of an
honest constrained search and refinement outcome.

### Decision

Keep this knowledge in the structured extractor prompt rather than adding
runtime keyword routing. The LLM establishes event type and provider need;
deterministic code only validates the resulting typed plan.

## Version the corrected technical-study benchmark

- Preserved the historical v1 manifest and added
  `technical-evaluation-50-v2`.
- Replaced free-form expected provider categories with canonical typed
  marketplace categories in v2.
- Aligned terminal expectations with declared state-machine semantics for
  multi-need presentation, pause/resume, closure, no-results, refinement, and
  recovery routes.
- Switched future technical-study runs to v2 while keeping artifact
  regeneration compatible with v1.
- Split expected-need quality into extraction recall, retrieval coverage given
  extraction, end-to-end coverage, and unexpected extracted needs.

### Reason

The v1 completion rate mixed runtime failures with noncanonical labels and
overly narrow valid-route expectations. Its final-plan need coverage also mixed
extraction breadth with retrieval success.

### Decision

Never rewrite v1 or reinterpret its raw outcomes. Use v2 only for future
confirmatory evidence, validate its categories at load time, and report the
separate expected-need denominators instead of a single ambiguous rate.

## Complete primary review of iteration-three grounding sample

- Scored all 20 reproducibly sampled iteration-three turns for provider
  existence, attribute faithfulness, rationale support, and hard-constraint
  consistency.
- Marked selection and closure rationales `not_applicable` rather than treating
  action confirmations as recommendation explanations.
- Recorded evidence-specific notes for unsupported capacity, event-type,
  decoration, audiovisual, promotion, and location claims.

### Result

- Provider existence: 20/20.
- Attribute faithfulness: 19/20.
- Recommendation rationale support: 6/10 applicable recommendation turns.
- Hard-constraint consistency: 14/20.

### Decision

Treat these as primary-review results only. Publication-quality manual grounding
evidence still requires an independent second reviewer and disagreement
adjudication; do not manufacture reviewer independence within one agent run.

## Prevent cross-category rows in multi-need rendering

- Added a deterministic renderer invariant requiring each provider card to
  match the canonical category of its multi-need section.
- Added regression coverage proving a catering provider cannot render under
  `Locales`, even if a malformed model response places its ID there.

### Reason

The primary grounding review found a wedding response that repeated every
provider under every need and labeled the wrong-category rows “No corresponde a
esta categoría.” The underlying plan was correctly grouped; the structured
reply violated that grouping.

### Decision

Treat the plan/provider category relation as a rendering invariant. The model
may explain and order valid cards, but it cannot move a provider into a
different typed need section.

## Normalize audiovisual production to the catalog taxonomy

- Added explicit structured-extraction normalization from `audiovisuales` and
  `producción audiovisual` to canonical `Fotografía y video`.

### Reason

The primary audit found the generic Sin Envolturas store selected under
`Otros` as audiovisual support. The marketplace has no standalone audiovisual
category; relevant production providers live under `Fotografía y video`.

### Decision

Resolve the semantic-to-catalog mapping in typed extraction so retrieval uses
the correct catalog category. Do not paper over an incorrect need by allowing
cross-category fallback.

## Define baseline and ablation protocol

- Declared immutable historical and pre-confirmatory baseline snapshots.
- Mapped each recommendation-system component to its disabled/enabled commits
  and direct outcome measures.
- Added explicit targeted gates that must pass before the fourth full run.
- Declared the fourth run untouched after execution to prevent test-set tuning.

### Reason

Iteration comparisons alone are not a defensible baseline when the benchmark
grading changed. A publication-ready comparison needs immutable configurations,
comparable metric definitions, and a precommitted confirmatory boundary.

### Decision

Use historical raw traces only for unchanged metrics or separately labeled
retrospective V2 regrading. Never overwrite historical summaries, and do not
spend the confirmatory run until every targeted gate passes.

## Materialize the pre-confirmatory V2 baseline

- Re-evaluated immutable iteration-three final typed plans against canonical V2
  expected needs without changing historical V1 reports or summaries.
- Recorded expected-need extraction, conditional retrieval, end-to-end
  coverage, unexpected-need, missing-location, auditorium, and cross-category
  baselines in a separate JSON artifact.

### Result

- Expected-need extraction recall: 158/165 (95.76%).
- Retrieval coverage given extraction: 144/158 (91.14%).
- End-to-end expected-need coverage: 144/165 (87.27%).
- Missing-location searches: 15/15; intended clarifications: 0/15.
- Corporate auditorium mapped to `Locales`: 0/3.

### Decision

Use this artifact as the direct pre-intervention comparator for the untouched
V2 confirmation. Keep the original V1 grading as historical evidence rather
than silently replacing it.

## Automate confirmatory live gates

- Added a typed live-gate command covering all five missing-location cases plus
  multi-need, pause/resume, no-results, recovery, selection, closure,
  auditorium, audiovisual-taxonomy, and cross-category rendering checks.
- The command exits nonzero if any semantic invariant or V2 hard gate fails and
  preserves its normal evaluation artifacts.

### Reason

The fourth study must not be spent based on informal spot checks. A repeatable
go/no-go command makes the precommitted criteria executable and auditable.

### Decision

Require `npm run eval:confirmatory-gates` to pass against the deployed
development Lambda before starting the untouched 50×3 confirmation.

## Close focused-need sufficiency bypass

- Required focused and session-focused categories to appear in the
  deterministic `readyByPlan` set before selecting single-need search.
- Added a regression test for the exact live failure shape: a focused catering
  need with guest count and budget but no location and no query-intent array.

### Reason

The first confirmatory gate proved the query-intent fix covered only one branch.
When extraction emitted a focused category without query intents, the runtime
still searched despite `location` remaining in global missing fields.

### Decision

Apply one readiness authority to every search entry path. Focus determines
which ready need to search; it cannot make an insufficient need ready.

## Preserve V2 and freeze corrected V3 benchmark

- Preserved the committed V2 manifest unchanged after its first live gate.
- Added V3 with corrected pause/resume and closure telemetry endpoints.
- Changed recovery cases lacking both guest count and budget to expect
  clarification instead of an invalid search.
- Added explicit corporate context to the corporate-auditorium input; the V2
  description had corporate context that its Spanish conversation omitted.
- Switched future study and confirmatory-gate commands to V3.

### Reason

The first V2 gate exposed benchmark errors as well as runtime errors. Rewriting
an already exercised frozen manifest would erase that evidence.

### Decision

Treat every exercised manifest as immutable. Correct semantics only in a new
version, and reserve V3 as the final precommitted confirmatory manifest.

## Preserve shortlist on resume and structured auditorium evidence

- Added an explicit `retomar_plan` decision that presents persisted shortlists
  without repeating provider retrieval.
- Added structured venue evidence from typed fit criteria or provider query
  intents to the implicit-venue guard.
- Added regression tests for zero-search shortlist resume and explicit
  corporate-auditorium preservation.

### Reason

The V3 gate showed pause/resume re-ran marketplace search instead of presenting
the stored shortlist. It also showed the extractor understood `Locales` in its
reply context, but the legacy implicit-venue guard removed the category because
`auditorio` was absent from its lexical cue list.

### Decision

Resume from persisted typed state and avoid a needless external call. Preserve
venue needs using structured LLM evidence rather than extending keyword-based
flow routing.

## Clarify incomplete refinements without a shortlist

- Routed typed provider-plan updates back to `aclarar_pedir_faltante` when
  required event context remains missing and no shortlist exists.
- Added a regression test for a decoration refinement that preserves location
  but still lacks both budget and guest count.

### Reason

The post-deployment V3 gate showed the refinement operation was applied
correctly, but the generic modification branch bypassed sufficiency and ended
at `seguir_refinando_guardar_plan`.

### Decision

An applied refinement does not make a provider need searchable. When it has no
existing shortlist, the same typed sufficiency evidence used by initial search
must determine whether the next action is clarification.

## Freeze V4 as an auditable overlay

- Added a V4 manifest overlay that inherits all 50 frozen V3 scenarios and
  changes only the pause/resume expectation.
- Updated the study CLI and confirmatory gate to materialize V4.
- Added validation for overlay identifiers and a regression test for the
  materialized terminal transition.

### Reason

The V3 gate proved that resuming a saved shortlist should present those
recommendations at `recomendar`, not discard them by returning to a generic
refinement node. V3 had also marked search and shortlist as absent even though
its first turn intentionally creates both.

### Decision

Keep exercised V3 byte-for-byte intact. Represent the narrowly corrected
contract as a versioned overlay so the provenance and exact semantic delta
remain reviewable.

## Add self-contained independent grounding reviewer

- Added a TypeScript generator that resolves every blinded response reference
  to its immutable case trace.
- Generated a standalone HTML reviewer containing the request, response,
  constraints, provider evidence, and raw tool evidence for all 20 sampled
  cases.
- Added browser-local autosave, completion validation, and one-click export to
  the required independent-review CSV schema.

### Reason

The combined response reference was not directly searchable in raw JSON, which
made independent review unnecessarily dependent on navigating large reports.

### Decision

Keep the primary judgments absent from the reviewer and embed only immutable
evidence. Require all four rubric judgments and reviewer notes before allowing
CSV export.

## Preserve complete provider notes in semantic search

- Added normalized `providerNotes` populated from every localized, titled
  provider-information section.
- Added the notes to provider vector documents and deterministic fit evidence.
- Added tests proving nonstandard sections survive API parsing and appear in
  the indexed Markdown.

### Reason

The independent grounding review exposed unsupported capacity, service, and
event-fit rationales. Service and terms highlights were already indexed, but
other potentially decisive provider sections were silently discarded.

### Decision

Index the complete public provider ficha while retaining service and terms as
first-class structured fields. Absence of a fact remains unknown; the runtime
must not infer capacity or service suitability from provider existence alone.

## Serialize provider-index refreshes

- Limited the provider-sync Lambda to one concurrent execution.
- Made stale vector-file cleanup tolerate an already-deleted file.
- Paginated the complete vector-file inventory and delete stale files with
  two-way bounded concurrency that stays within the vector-file API limit.
- Increased the sync timeout to cover indexing plus full-batch replacement.

### Reason

The deployment-triggered scheduled refresh overlapped a manual refresh. One
execution deleted vector files still being polled by the other, producing a
404 and leaving both refreshes without a trustworthy success result. A
follow-up inventory also found 1,985 files across eleven batches because the
old cleanup inspected only the first API page.

### Decision

Provider index replacement is a singleton operation. Serialize executions at
the Lambda boundary, enumerate every page, and keep cleanup idempotent for
stale-list races.

## Tolerate vector-index read-after-write lag

- Treat a 404 while polling a newly created vector-file association as
  transient until the normal indexing timeout expires.

### Reason

The first refresh into a clean vector store created all provider associations,
but OpenAI temporarily returned 404 for one association during the completion
poll. Failing immediately abandoned an otherwise recoverable batch.

### Decision

Creation followed by retrieval is eventually consistent. Keep the association
pending on 404; still fail on explicit `failed`/`cancelled` status or timeout.

## Render the executed manifest in study findings

- Replaced the hardcoded V1 manifest label in generated findings with the
  manifest identifier from the immutable study summary.

### Reason

The final V4 study summary was correct, but its Markdown reproducibility header
still displayed the historical V1 label.

### Decision

Presentation artifacts must derive version labels from study metadata. Raw run
reports remain unchanged; regenerate only derivative tables, charts, and text.

## Add a context-aware frustration and conversation-progress monitor

- Extended the existing native `gpt-5.4-nano` Structured Output with conversation
  health, a typed reason, and the user's response to an outstanding help offer.
- Persisted consecutive non-progress evidence and help-offer state in the event
  plan.
- Added the `ofrecer_agente_humano` state-machine node and a deterministic Spanish
  offer that runs before extraction, provider search, and reply composition.
- Routed structured acceptance through the verified Agent API takeover workflow;
  declines resume the automated flow without immediately repeating the offer.
- Added trace, perf, terminal-demo, unit, service, prompt, and labelled-eval
  coverage for progress, stalls, explicit frustration, acceptance, and decline.
- Made the terminal client exit cleanly when scripted input reaches EOF after a
  demo turn.

### Reason

The assistant needed a low-cost way to notice circular or unresolved interactions
and proactively offer help before user frustration becomes abandonment.

### Decision

Reuse the existing classifier call instead of adding another model request. Offer
human help after one explicit-frustration assessment or two consecutive
non-progress assessments, but never request takeover until the user accepts.

## Enforce reply suppression and bound human handoff silence

- Changed typed runtime, CloudFormation, deployment, examples, and channel docs
  to default `RESPONSE_CLASSIFIER_MODE` to `enforce`.
- Added a persisted `human_escalation.bot_suppressed_until` timestamp set 12
  hours after direct or frustration-monitor handoff requests.
- Kept inbound Agent API logging active while bypassing classifier, extractor,
  search, and reply work during the handoff window.
- Added legacy fallback from `requested_at`, automatic state clearing and normal
  flow resumption after expiry, and trace evidence for that transition.
- Reworked deterministic and prompt copy so users are clearly told that a team
  member will join the chat, without exposing the internal 12-hour window.

### Reason

Once customer support takes ownership, concurrent bot replies can confuse both
the user and the representative. An indefinite pause, however, can permanently
strand conversations if support ownership is never cleared.

### Decision

Enforce classifier suppression now. Give customer support exclusive chat
ownership for a bounded 12-hour internal window, then resume automatically on
the next inbound turn. Keep that duration operational rather than user-facing.

**Validation:** `npm run check` passed with 37 test files and 237 tests. The
development Lambda was deployed with `RESPONSE_CLASSIFIER_MODE=enforce`. A live
Agent API-backed reaction turn returned `message: null`, suppressed delivery,
and no extractor or reply usage. A separate phone-free handoff persisted an
expiration exactly 12 hours after `requested_at`; its confirmation exposed no
duration, and the following inbound turn remained silent with zero model usage.

## Decouple outbound Agent API logging from classification

- Changed sent-message logging to depend on the configured Agent Conversation
  gateway instead of the optional response classifier.
- Kept suppressed deliveries excluded from outbound logs.
- Added service coverage proving a normal generated reply is logged with its
  canonical phone number even when no classifier is configured.

### Reason

Outbound conversation history is a channel integration responsibility. Tying it
to classifier availability could silently omit assistant replies in runtimes or
tests that configure the Agent API gateway independently.

### Decision

Log every generated `send` delivery through the configured Agent Conversation
gateway before returning it. Preserve best-effort behavior so logging failures
never block the user response.

**Validation:** `npm run check` passed with 37 test files and 238 tests. The
development Lambda was redeployed in enforced mode. A scoped live turn recorded
successful inbound and outbound logging calls in its trace, and the production
Agent API history returned the generated assistant reply as `direction:
"outbound"` alongside the corresponding inbound message.

## Protect channel invocation and hydrate WhatsApp phone context

- Added a dedicated `CHANNEL_API_KEY` service credential, Secrets Manager
  publication, least-privilege Lambda secret access, and CloudFormation wiring.
- Added constant-time `X-API-Key` validation before runtime initialization while
  retaining Function URL `NONE` auth so adapters do not need AWS credentials.
- Updated terminal and live-eval callers to authenticate with the channel key.
- Added a typed Lambda request contract that requires valid international
  `contact_phone` context for production and sandbox WhatsApp channels.
- Hydrated normalized channel phone context into the working plan before the
  classifier and extractor run, and added regression coverage proving the first
  extractor turn sees the persisted phone.
- Reworked `docs/channel-integration.md` with authentication, rotation, complete
  delivery behavior, and explicit Meta WhatsApp field mapping.

### Reason

The raw Function URL needed a service-to-service credential without requiring
channel infrastructure to hold AWS IAM credentials. Separately, treating the
WhatsApp sender only as a user id allowed the first model turn to miss trusted
phone context and potentially ask for it again.

### Decision

Use a separate high-entropy application API key in `X-API-Key`, validated before
any expensive work. Require adapters to pass the WhatsApp sender twice with
different semantics: namespaced `user_id` for plan identity and E.164
`contact_phone` for trusted contact context and downstream requests.

**Validation:** `npm run check` passed with 39 test files and 243 tests. The
deployment generated the local channel key without printing it, published
`recap-agent/channel-api-key`, and updated the development Lambda. Live probes
confirmed missing and incorrect keys return `401`, an authenticated WhatsApp
request without phone context returns a field-specific `400`, and a valid first
turn persisted the normalized phone in the plan before extraction. That same
phone appeared in Agent API history retrieval plus inbound and outbound logging,
and the reply asked only for event details rather than the user's phone.

## Document the production WhatsApp webhook server flow

- Added a Mermaid architecture flow covering Meta verification, raw-body
  signature validation, durable idempotency, queue acknowledgement, runtime
  authentication, delivery suppression, Graph API send, retries, and alerts.
- Split webhook responsibilities into a fast HTTP acceptance path and a slower
  queued turn-worker path.
- Added executable-shape TypeScript showing the mandatory delivery-action branch
  before sending through WhatsApp.

### Reason

Calling the synchronous agent runtime directly inside the Meta webhook response
window risks webhook retries, duplicate plans, and duplicate user replies. The
adapter also needs an explicit rule for suppressed turns and human handoff.

### Decision

Verify and enqueue quickly, then process each unique WhatsApp `wamid` in a
worker. Use the same `wamid` as runtime `message_id` across retries and only call
the Graph API when the runtime explicitly returns a send delivery.

## Route guest email validation through the production API

- Changed the guest-auth default in runtime configuration, the HTTP gateway,
  CloudFormation, and the deploy script from the development host to
  `https://api.sinenvolturas.com/api-web/user`.
- Updated operational and thesis documentation to show the production auth URL.
- Left the guest-service event lookup URL unchanged because it is a separate API.

### Reason

The deployed runtime still sent login-code requests to the development host even
though the equivalent production routes were available.

### Decision

Use the production user-auth API for both `POST /request-login-code` and `POST
/login-code`. Keep their existing payloads and response handling because a safe
production probe confirmed the expected contract.

**Validation:** A production probe with a reserved nonexistent email returned
`200` from `/request-login-code`, and an invalid synthetic code returned the
expected `400 Invalid or expired code` from `/login-code`. `npm run check` passed
with 42 test files and 259 tests. The development runtime and provider-sync
stacks deployed successfully, and the active Lambda configuration reports the
production guest-auth base URL.
### Add fail-closed interaction behavior regressions

- Added `live_behavior_regression` as the permanent suite for concrete user-reported interaction failures. Each reconstructed case carries structural assertions and a mandatory semantic contract for the correct response.
- Added `npm run eval:behavior-live`; it requires an evaluator key and exits unsuccessfully for failed, errored, skipped, or missing cases.
- Added `requireJudge` to semantic expectations so behavior gates cannot pass when evaluation was silently skipped.
- Added repository rules requiring context-complete live cases and deterministic offline twins where feasible for every future interaction fix, and requiring the live gate after behavior-changing deployments.
- Removed the legacy deterministic-temperature parameter from the semantic judge after the fail-closed gate exposed that GPT-5.6 Luna rejects `temperature: 0`; an injected-client request test now locks the compatible request shape.
- The first mandatory live run passed the Spanish-only case but exposed close-flow defects. Accepted complete supported international digits with or without a plus sign, and retained short phone candidates omitted by extraction long enough to validate them and keep the close node active.
- Corrected the multifront interaction contract without weakening behavior: it now accepts an honest statement that retrieval found no exact live-music match instead of requiring the agent to imply a fabricated match.
- Completed the live fixtures exposed by the second run: close flow now stops when `finish_plan` succeeds instead of sending a post-finish confirmation into a new plan; the correction fixture carries the selected provider evidence required by the finish tool; and the extractor explicitly maps “no quiero ninguna” for an unambiguous shortlisted category to `defer_need`, preventing the close flow from asking the same choice again.
- Narrowed the Spanish-only semantic rubric after the third run reached 4/5: the judge must inspect retained plan evidence and cannot require the reply to restate an already retained event type or location. This keeps the no-English gate strict while avoiding redundant prompt/output behavior.
- Changed semantic expectations from response-only judging to context-complete judging. The evaluator now receives the synthetic interaction history, node transitions, tools, retained event evidence, provider-need states, and contact-field presence through the selected turn, while raw contact values remain excluded.
- Final validation passed against the deployed development Lambda: `eval-2026-08-05T15-47-50-196Z-8ad8bfe9` completed all five mandatory live behavior cases with five passes, zero failures, zero errors, and zero skips. `npm run check` passed 371 deterministic tests across 58 files. The Notion regression-suite item remains in progress by design, while the prompt-leanness item remains completed with the verified Spanish-only checkpoint.

### Consolidate the Spanish-only response contract

- Made `shared/output_style.txt` the single owner of the natural-language policy: every common word, verb, adjective, instruction, and interface term must be Spanish even when the user writes in English.
- Limited exceptions to exact proper names, provider names, untranslated official brands, email addresses, URLs, numbers, and literal codes.
- Removed the duplicate language instruction from `shared/base_system.txt` and added a prompt-composition test that proves the stronger rule appears exactly once in every conversation bundle.
- Added a mandatory live mixed-language regression that combines deterministic checks for known leaks with a semantic judge for arbitrary untranslated English.
- Kept the stricter policy lean: representative serialized reply requests decreased by 25 bytes, from 7,304 to 7,279 for initial contact and from 13,543 to 13,518 for the information route.
- Corrected grammatical agreement in deterministic vocabulary repair so `el baby shower` becomes `la celebración por la llegada del bebé`, rather than the malformed `el celebración` observed by the mandatory live judge.

### Validate the repeated verification recovery in development

- Deployed the bounded verification-recovery and completed-submission rendering changes to both development stacks; `recap-agent-runtime` and `recap-agent-provider-sync-dev` reached `UPDATE_COMPLETE`.
- Ran the mandatory deployed behavior suite as `eval-2026-08-05T16-46-43-197Z-e846609b`: all six cases passed, all six hard gates passed, and there were zero failures, errors, or skips.
- The reconstructed payment-verification incident passed with a final score of `0.9223937471014739`. After two rejected codes, the reply retained the pending gift-payment delivery and status question, stopped requesting another code, offered human recovery, and contained no English leakage.
- The mixed-language Spanish-only case scored `1.0`; the close, contact-correction, multi-need, and deferred-selection regressions also passed.

**Decision:** Treat this run as the deployment acceptance checkpoint for the July 31 verification-loop fix. Future behavior changes must continue to execute the complete live suite, including this incident-derived case.

## Guard payment destinations and nonphysical purchase language

- Added a typed purchase-disclosure policy that exposes Yape or bank-transfer destinations only for an identified purchase whose normalized payment status is `pending`.
- Removed shipping evidence from the information response projection unless the queried purchase has affirmative physical-fulfillment evidence.
- Added deterministic policy and orchestration tests for approved nonphysical purchases and pending physical purchases.
- Clarified the information extractor and response contract so payment destinations come from structured purchase evidence rather than FAQ content.
- Added permanent live behavior cases for an unauthenticated payment-destination request and a nonphysical purchase query.
- Reduced the information extractor prompt while preserving its required structured evidence; the initial information extractor remains below its 9,000-byte static budget, and the complete information route remains below the legacy request baseline.

### Initial deployed live-gate diagnosis

The first post-deployment run, `eval-2026-08-11T01-59-55-114Z-0d49b9be`, completed six passes, two failures, and two fixture errors across ten cases. The new nonphysical-purchase case passed all hard gates. The payment-destination response safely disclosed no destination and requested the next authentication detail, but its judge rubric incorrectly required discussing purchase status before authentication. The contact-correction case passed both semantic gates but retained a stale assertion against a phone value intentionally removed from safe artifacts. Both phone-first cases stopped before their first turn because their documented environment fixtures were not supplied.

**Decision:** Keep the runtime behavior unchanged. Align the payment rubric with the next-authentication-step contract, assert phone presence through redacted trace evidence, and rerun the complete live gate with both required phone fixtures explicitly configured.

### Final deployed acceptance

- The development stack reached `UPDATE_COMPLETE` at `2026-08-11T01:58:57.863Z`; the active Lambda uses `https://api.sinenvolturas.com/api/agent` with message logging disabled.
- Mandatory run `eval-2026-08-11T02-07-01-378Z-761162d7` passed all 10 cases and all hard gates, with zero failures, errors, or skips.
- Both new purchase cases scored `1.0`. Phone-first success and email fallback each scored `0.95`; the existing repeated-verification, Spanish-only, multifront, close, contact-correction, and deferred-selection cases also passed.
- The Roadmap now has a completed purchase-disclosure item, the phone-first authentication item is consistently marked completed/done, and the continuously growing regression-suite item records this checkpoint while remaining in progress by design.

**Decision:** Accept the deployed purchase-disclosure safeguards and the committed phone-first authentication work as complete. Keep `live_behavior_regression` as the mandatory fail-closed gate for future behavior changes.

## Bound OpenAI stage latency below the Lambda ceiling

- Audited 929 completed development turns from the performance table. Runtime latency was 6,309 ms at p50, 14,411 ms at p95, 23,682 ms at p99, and 34,203 ms at maximum. Component maxima were 14,560 ms for classification, 30,379 ms for extraction, 18,356 ms for reply composition, and 3,943 ms for information execution.
- Found four 90,000 ms Lambda timeouts in retained CloudWatch logs. All four occurred during overlapping live-evaluation runs on 2026-08-11; the failed invocations ended before a performance record could be persisted.
- Identified the architectural gap: OpenAI SDK clients otherwise retained a ten-minute request timeout, so Lambda's 90-second ceiling could terminate a hung model or vector-store request before the application recorded its failing stage.
- Added sanitized `openai_stage_started`, `openai_stage_completed`, and `openai_stage_failed` records for classification, extraction, reply composition, FAQ retrieval, and provider vector search. These records contain stage, model class, deadline, duration, and sanitized error metadata, but no prompt, user content, credentials, or authorization headers.
- Added configurable stage deadlines of 16 seconds for classification, 35 seconds for extraction, 22 seconds for reply composition, and 8 seconds for vector-store retrieval. The observed component maxima remain below those bounds, while the ordinary classifier/extractor/retrieval/reply critical path now has an 81-second upper model-and-retrieval budget inside the 90-second Lambda ceiling.
- Reduced vector-store SDK retries from three to one and placed all attempts under the same stage abort signal. Existing application-level failure behavior remains intact: classifier failure is fail-open, FAQ retrieval returns a retryable result, and hybrid provider search can use its existing API fallback.
- Added deterministic tests for abort propagation, sanitized timeout telemetry, runtime defaults, CloudFormation environment wiring, and the signal passed through classifier, Agents SDK, and knowledge retrieval requests.

**Validation before deployment:** `npm run check` passed 416 tests across 64 files. Development deployment and the mandatory live behavior run are recorded in the next validation checkpoint.

### Development latency validation

- Deployed only `recap-agent-runtime`; the stack reached `UPDATE_COMPLETE` with Lambda modified at `2026-08-11T22:27:52Z`. The active function retains its 90-second ceiling and reports the expected 16,000/35,000/22,000/8,000 ms classifier/extractor/reply/retrieval settings.
- Post-deployment run `eval-2026-08-11T22-28-34-464Z-30b7137c` executed all cases that did not require local phone fixtures: 12 passed, zero behavior assertions failed, and zero Lambda or stage timeouts occurred. The multi-need regression that had previously disappeared behind a 90-second timeout completed in 26,301 ms with a 22,246 ms traced runtime; the deployed FAQ regression completed in 11,085 ms with a 7,571 ms traced runtime.
- Five phone-auth cases failed closed before invoking Lambda because `TERMINAL_CONTACT_PHONE` and `PHONE_FIRST_FALLBACK_CONTACT_PHONE` were absent from the shell. This is a fixture gate failure, not a runtime or behavior failure, so this run is not recorded as a complete mandatory-suite pass.
- A complete rerun with the phone fixtures was started, then intentionally stopped after the user requested only the tests needed for this latency change. The successful targeted latency evidence above and the 416-test deterministic gate are the acceptance evidence for this operational change; the next behavior-changing update must still produce a fully passing `npm run eval:behavior-live` artifact.

**Decision:** Keep the bounded deadlines and stage telemetry. Do not raise the Lambda timeout or introduce asynchronous WhatsApp processing based on test-only overlapping load. Avoid overlapping full live-evaluation runs against the shared development Lambda.

## Explain image limitations after sending an email code

- Added two structured response requirements for `otp_sent` and `otp_resent`: explain that the assistant cannot read images or screenshots, and ask the person to type the code as text in the conversation.
- Updated the information-node system prompt and response contract so the model expresses those requirements naturally in Spanish. No deterministic reply override or exact canned message was introduced.
- Strengthened the existing phone-not-found to email-OTP live regression: its mandatory semantic judge now requires both the image limitation and the request to enter the code as text.
- Added offline coverage for both newly sent and resent codes, plus prompt-composition assertions that prove the rules reach the model.

**Decision:** Keep wording model-generated while making the two facts mandatory through typed guidance and node-scoped prompt rules.

### Deployed validation

- `npm run check` passed all 416 deterministic tests across 64 files. The prompt audit explicitly accepted the information-route request increase from 15,296 to 15,429 serialized bytes.
- Deployed only `recap-agent-runtime`; CloudFormation reached `UPDATE_COMPLETE` at `2026-08-12T13:37:12.889Z`.
- Added the dedicated permanent live case `live_behavior.otp_sent_explains_image_limitation` so validation does not depend on first manufacturing a phone lookup result.
- Targeted deployed run `eval-2026-08-12T13-39-37-478Z-4de840cc` passed with score `1.0`, zero failures, errors, or skips. The generated Spanish response reported the code destination and delivery delay, mentioned the main and junk inboxes, explicitly stated that images and screenshots cannot be read, and asked for the code as text.

**Decision:** Accept the model-generated OTP image guidance as deployed. Keep the dedicated case in `live_behavior_regression` for every future behavior-changing run.
## 2026-08-13 — Standardize cross-boundary turn and FAQ observability

**Reason:** Production support could establish that some inbound WhatsApp messages were stored but never dispatched, yet the pre-runtime boundary did not preserve a native message identifier or a shared correlation result. FAQ/tool outcomes were generic counts, successful OpenAI stages were split from their response identifiers, and the authentication trace required manual reconstruction.

**Decision:** Require the native WhatsApp `message_id` at the runtime boundary; return the Lambda request ID and runtime trace ID to the adapter; emit one standardized completion record containing authentication path/reason, typed information outcomes, and classifier/extractor/reply request and response references. Enrich information summaries with stable outcome codes, retryability, query fingerprints, and bounded FAQ evidence references so retrieval distinguishes results, empty results, configuration failures, and transient failures. Add OpenAI request/response identifiers to successful stage logs while retaining sanitized failed-stage logs.

**Operations:** Added the personal `audit-recap-message` skill with a fail-closed `se-dev`/`us-east-1` audit script. It reconstructs Agent API history, DynamoDB performance evidence, and Lambda logs without exposing credentials, and classifies stored inbound messages with no runtime evidence as pre-runtime dispatch failures.

## 2026-08-13 — Accept OTPs expressed as Spanish digit words

**Reason:** In the reported purchase-verification interaction, “Uno cuatro siete cinco uno cinco” unambiguously represented the six-digit OTP `147515`, but the runtime asked the user to rewrite it with numerals.

**Decision:** Normalize only an all-digit-word Spanish sequence of four to eight tokens while an OTP is pending; ordinary prose remains invalid. Add the complete purchase-verification state as a mandatory live regression plus a deterministic normalization twin.

**Live-gate follow-up:** The first complete deployed run proved that the word-form code invoked `verify_user_login_code` and was not rejected for formatting. It also exposed that a recovered pending information query was removed from the reply input after successful capability execution. Preserve the canonical pending requests in the reply extraction so terse legacy confirmation responses such as “Este” can continue the already-known question rather than asking the user to repeat it.

## 2026-08-13 — State retrieved numeric FAQ answers explicitly

**Reason:** Deployed run `eval-2026-08-13T23-05-15-817Z-4aaffce9` routed the commission question correctly, retrieved six grounded FAQ records, and avoided provider search, but its answer made the user infer the 5% rate from a US$100 example. The mandatory semantic gate therefore failed at 0.88.

**Decision:** When retrieved FAQ evidence contains the requested fee, rate, deadline, limit, or other numeric value, state it directly rather than only illustrating it. Keep the existing grounding constraint: values absent from retrieved evidence must not be invented.

**Validation follow-up:** The first deployed attempt passed the FAQ semantic gate at 0.98. A second complete run exposed response variance: the answer replaced available values with “depende del método de pago.” Strengthen the same route-owned rule to include every applicable retrieved value, preserve exact monetary examples, and prohibit vague replacement language. The run also showed that the retired-phone-confirmation judge was evaluating whether the response explained an internal mechanism already covered by hard tool and state assertions; narrow that semantic rubric to the observable conversation contract.

## 2026-08-13 — Remove stale ambiguity from retired phone-confirmation recovery

**Reason:** Targeted deployed validation authenticated the current WhatsApp number and completed associated-event retrieval, but the reply still asked the user to complete “Este.” The reply evidence had cleared the ambiguity status while retaining the extractor's contradictory summary that the message was incomplete.

**Decision:** For this narrowly identified legacy recovery state, replace the stale summary with the canonical pending information queries already persisted in the plan. This preserves decision evidence and lets the model answer the completed lookup without keyword routing or a deterministic user-facing response.

### Deployed validation and external gate condition

- `npm run check` passed all 439 deterministic tests across 69 files.
- The runtime stack deployed successfully with the final Lambda-impacting changes.
- Targeted deployed run `eval-2026-08-13T23-43-06-194Z-4437f38c` passed the strengthened FAQ case with score `0.9973`; the response included grounded method-specific monetary values and did not resume provider selection.
- Targeted deployed run `eval-2026-08-13T23-43-06-194Z-c95c6248` passed the retired-phone-confirmation recovery case with score `0.98`; phone authentication and associated-event lookup completed without asking the user to repeat the known question.
- Complete mandatory runs `eval-2026-08-13T23-14-45-276Z-a7dc728c` and `eval-2026-08-13T23-29-53-656Z-38d47607` reached every case with zero evaluator errors or skips. The OTP sender returned HTTP 429 (`Too many requests. Try again later.`) for both code-send fixtures, so those external-success assertions correctly failed closed. The traces identify `request_user_login_code`, `email_otp`, HTTP 429, and the terminal failure reason; rerunning after a short cooldown produced the same dependency response.
- A deployed `channel_request_completed` record was verified to correlate the Lambda request ID, runtime trace ID, hashed native WhatsApp message ID, authentication path/reason, typed FAQ outcome and hashed evidence references, and successful classifier/extractor/reply OpenAI response and request IDs.

**Decision:** Accept the changed FAQ and recovery behaviors based on their passing deployed cases and keep the full-suite OTP failures visible rather than weakening the gate or misclassifying an external HTTP 429 as a Lambda/LLM regression.

## 2026-08-13 — Restore optional channel message IDs

**Reason:** The observability checkpoint accidentally made `message_id` mandatory for WhatsApp even though the documented channel contract historically allowed it to be omitted. Audits of three retained production conversations found seven inbound records and zero stored native WhatsApp message IDs. Enforcing the new requirement before the upstream team adopted it could reject otherwise valid messages at the Lambda boundary.

**Decision:** Restore `message_id` as optional. Continue using a generated UUID internally when it is absent, and label completion telemetry with `message_id_source=native|generated` so support can distinguish genuine cross-system correlation from a runtime-only identifier. Keep the documented recommendation that the upstream adapter should eventually provide a stable native `wamid`.

## 2026-08-14 — Preserve campaign-grounded RSVP context when no mutation is pending

**Reason:** Two production interactions were correctly extracted as attendance confirmations for named events and called `guest_rsvp`, but the pending-only endpoint returned `no_pending`. The reply then incorrectly implied that no invitation was associated with the phone even though the recent campaign message established the invitation and event name.

**Decision:** Treat the structured `rsvpEventReference` as grounded only when it is present in a recent `admin_campaign` message. When the endpoint then returns `no_pending`, report that the known invitation is no longer pending and that no new update was made. Do not claim that the invitation is missing, and do not invent whether the existing response is attending or declining because the endpoint does not return that state. Preserve the raw `guest_rsvp` result and record `referenced_invitation_not_pending` as the turn outcome.

**Regression coverage:** Added one deterministic full-context test and two separate mandatory live cases for the José/Gia Antonella and Cinthya/Julisabeth y Andrés interactions. Both retain hard tool assertions and hard semantic judges.

## 2026-08-14 — Keep first-turn attendance decisions actionable

**Reason:** The complete live suite showed that “Gracias, confirmo asistencia” could be classified as a non-actionable acknowledgement when no RSVP state had been created yet. That stopped the turn before structured extraction and the RSVP endpoint, even though the campaign history grounded the invitation.

**Decision:** Explicit attendance and non-attendance decisions must always receive `respond`, including when the RSVP state is still `none` and the message also contains thanks. Keep the decision model-based and pass the turn to structured extraction; do not add keyword routing or a deterministic conversational response.

**Regression coverage:** Reuse the permanent Cinthya campaign interaction as the mandatory deployed semantic case and add a static prompt-composition assertion proving that first-turn RSVP decisions cannot be treated as simple acknowledgements.

**Reliability follow-up:** A targeted deployed run passed, but the subsequent complete suite reproduced acknowledgement suppression for the same Cinthya interaction. Treat a recent `admin_campaign` source as established invitation context: if the classifier proposes acknowledgement suppression, normalize it to `respond` with reason `campaign_context_requires_extraction` so structured extraction—not keyword routing—decides the conversational flow. Emoji-only reactions and high-confidence automated responses retain their existing suppression behavior.

**Prompt leanness follow-up:** Consolidated the overlapping pending-state and first-turn RSVP classifier paragraphs into one rule. The static comparison returned to zero violations while retaining the same actionable-decision requirements.

### Final deployed validation

- `npm run check` passed all 443 tests across 69 files, including the static prompt comparison with zero violations.
- The runtime stack reached `UPDATE_COMPLETE` at `2026-08-14T15:41:48.914Z` using the required `se-dev` profile and account guard.
- `bun run terminal` completed automatic trusted-phone authentication and associated-event lookup without email OTP (trace `01M00CT680NGHVTHPYSTYBM5X4`). A separate terminal RSVP turn entered `responder_invitacion`, called `guest_rsvp` without account-authentication tools, retained Gia Antonella, and safely reported the pending-only limitation (trace `01M00CXANFXAK465P0EB8CTFPT`).
- Final mandatory run `eval-2026-08-14T15-43-14-976Z-5412326d` passed all five RSVP cases. Cinthya passed at `1.0` with classifier action `respond` and trace `01M00F81E6JYVTKMW6Z9KF62G1`; José passed at `0.9947` with trace `01M00F8AR7X4PQ8WZ6EFWNVYZZ`.
- The complete suite finished 21/24 with zero evaluator errors or skips. The three unrelated failures remain visible: two email-code cases received backend send failures instead of the expected successful code-send state, and the cheaper-provider case produced the correct Spanish selection text but omitted the expected operation type from its trace projection. None of the RSVP, FAQ, automatic phone-auth success, OTP word-code, purchase-disclosure, or Spanish-only gates regressed.

**Decision:** Accept the RSVP fix as deployed and deterministic. Keep the roadmap item in progress because the backend still cannot distinguish an existing attending response from an existing declining response. Do not weaken the unrelated failing gates.

## 2026-08-20 — Search immediately when the last planning field arrives

**Reason:** A reported WhatsApp interaction asked for wedding planners, collected a 100-to-200 guest estimate and Lima, then replied that the context was ready and promised options in a later step. The message audit confirmed successful delivery and runtime execution. On the final turn, the persisted `Wedding planners` need was `search_ready` with no missing fields and the extractor emitted one retrieval-ready query intent for that category, but the turn decision discarded its category because the follow-up correctly left unchanged top-level category fields null. The router produced `insufficient_reachable_transition`, kept `entrevista`, and performed no provider search.

**Decision:** Treat the sole retrieval-ready query-intent category as typed turn focus when it matches the sole ready need. Do not fall back to durable active-need focus by itself, because that could revive stale categories on unrelated turns. Preserve the existing deterministic guest/budget reply only when it is the sole missing field; when location and scale are both missing, allow the route-owned response contract to ask for both in one compact question.

**Changes:**

- Updated turn evidence construction to derive focus from exactly one retrieval-ready query intent before session focus, while keeping explicit top-level extraction focus authoritative.
- Narrowed the single-field guest/budget response override so it no longer replaces a combined location-and-scale clarification.
- Added deterministic twins for the combined initial clarification and the exact final location-follow-up state. The latter asserts `aclarar_pedir_faltante -> recomendar`, `single_need_search`, `Wedding planners` focus, immediate provider search, and persisted recommendations.
- Added `live_behavior.wedding_planner_location_completes_search` to `live_behavior_regression`. It reconstructs the greeting, explicit wedding-planner request, guest-range answer, and Lima answer with hard structural assertions plus a required hard semantic judge.
- Registered the compact-question behavior and the retrieval-ready follow-up focus as separate behavior changes in `evals/live-behavior-coverage.yaml`.
- Removed an invalid test-only `eventHint` property from an unrelated purchase fixture that prevented the repository typecheck from reaching the behavioral tests. This did not change runtime behavior.

**Minimum-disclosure and prompt-size evidence:** No prompt file or model schema changed for this fix, so added instruction and input bytes are zero. `npm run audit:prompts` reported zero violations; the static serialized requests remain 11,703 bytes for `aclarar_pedir_faltante` and 11,375 bytes for `recomendar`. In the passing deployed reconstruction, the compact-question turn used classifier/extractor/reply instruction and input bytes of `9,334/701`, `10,291/1,706`, and `11,287/6,423`. The final search turn used `9,334/690`, `13,281/2,024`, and `10,974/14,291`. The larger final reply input is provider evidence from the completed search, not newly added global instruction content.

**Validation:** `npm run check` passed 461 tests across 69 files after typecheck and lint. Both development CloudFormation stacks deployed successfully. Focused deployed run `eval-2026-08-20T21-25-46-977Z-26b2fe7c` passed all eight hard expectations: the first planning reply requested location and scale/budget together; the final turn transitioned to `recomendar`, searched immediately, found 12 candidates, and the semantic judge confirmed that the response presented five real options instead of promising a later step. The post-final-deployment mandatory run `eval-2026-08-20T21-30-14-294Z-d5691c83` executed 28/28 cases with zero errors or skips; the new planning case passed again. The suite finished 26/28 because two unrelated RSVP fixtures now expected declined/awaiting-change state while the backend reported confirmed attendance. Focused reruns `eval-2026-08-20T21-38-36-325Z-4a08c14a` and `eval-2026-08-20T21-38-54-751Z-dc555eac` reproduced those RSVP state mismatches, so the complete gate remains formally red and is not reported as a global pass.

## 2026-08-20 — Make starting over a native plan transition

**Reason:** In the reported WhatsApp interaction, “No no, quisiera empezar de nuevo, ¿podemos?” was extracted as `elicitar_necesidades`. The assistant promised to restart, but no state transition replaced the persisted wedding plan. The next provider request therefore reused the old event, location, guest range, shortlist, and contact fields. The same audit found that a later five-message burst was stored by the Agent API but produced no Lambda invocation, performance record, or model call; that unanswered burst failed at the upstream adapter-to-runtime dispatch boundary rather than in planning or reply generation.

**Decision:** Add `reset_plan` as an explicit structured action, decision node, and route kind. Make it available through the dynamic action schema for every plan lifecycle state. When extracted, replace the working plan with a new plan ID before RSVP, information, provider-operation, sufficiency, or routing logic can consume old state; ignore stored session focus; then persist and reply from the dedicated reset node. If the same message also provides new event requirements, reduce only that new extraction into the fresh plan so the normal search/clarification router can continue without an extra acknowledgement-only step.

**Changes:**

- Added the node-scoped Spanish prompt bundle under `prompts/nodes/reset_plan/` and one extraction rule in `prompts/extractors/planning.txt`; no reset wording or exact-string routing was added to TypeScript.
- Added deterministic coverage that seeds the complete stale wedding/provider/contact state and proves a new plan ID, cleared event/provider/contact fields, no provider or close tools, a valid `reset_plan` state-machine route, and persisted-state telemetry.
- Added `live_behavior.reset_plan_discards_stored_context` with hard plan, transition, route, persistence, and tool assertions plus a hard required semantic judge. Registered native reset availability and complete stale-context removal as separate behavior changes.
- Corrected final-save telemetry so a successfully persisted ordinary/reset route reports `plan_persisted=true` and its actual persist reason.
- Updated the prompt audit and historical comparator to count the new route and compare its prompt shape against the legacy interview route instead of attempting to read nonexistent historical reset files.

**Minimum-disclosure and prompt-size evidence:** The only shared extraction addition is a 226-byte planning-only rule. `npm run audit:prompts` reported zero violations: `extractor:conversation_only` remains 2,269 serialized bytes and excludes both the planning file and reset guidance; planning profiles are 9,210 bytes for initial planning and 12,214/12,212 bytes for active-plan/shortlist extraction. The new reply route is 10,221 serialized bytes and has zero tools. In mandatory deployed validation, the reset turn used classifier/extractor/reply instruction and input bytes of `9,334/621`, `13,507/2,321`, and `9,832/5,040`.

**Deletion:** Before mutation, the audit preserved the last complete message span and established the failure boundary. The authorized purge then deleted one persisted plan and 29 runtime performance/history records for the exact original WhatsApp identity. Early live validation briefly recreated one plan and one performance record before the case contact was changed; both were deleted again. Final exact-key and user-index queries returned zero plan records and zero runtime-history records. Private audit files and superseded local eval artifacts were moved to macOS Trash. The upstream Agent API exposes only GET/HEAD for conversation history, so its stored messages could not be deleted through any supported endpoint; per-event CloudWatch deletion is also unavailable without deleting shared log streams.

**Validation:** `npm run check` passed all 464 tests across 69 files after typecheck and lint, and `npm run audit:prompts` had zero violations. Both development CloudFormation stacks deployed successfully; the final runtime Lambda revision was modified at `2026-08-20T22:33:40Z`. Focused deployed runs passed the reset case at score `1.0`, including the retained production-backed contact run `eval-2026-08-20T22-47-53-560Z-42bf4063`. Mandatory run `eval-2026-08-20T22-48-13-261Z-0c7d3f09` executed 29/29 cases with zero errors or skips; the reset case passed at `1.0` with trace `01M0GNXZ8CA6KXJDGJ0C8PDQFD`, `recomendar -> reset_plan`, no provider search, and `plan_persisted=true`. The complete suite finished 26/29: two unrelated RSVP fixtures expected a declined invitation while the authoritative production lookup returned confirmed attendance, and the phone-fallback semantic judge scored an otherwise correct OTP reply at 0.88 because it omitted the phrase “one-time.” The mandatory gate therefore remains formally red and is not reported as a global pass.

## 2026-08-22 — Use the documented accountless guest flow before email OTP

**Reason:** WhatsApp campaign button responses remain upstream of this Lambda, but guests can answer or ask about the invitation in free chat. The runtime could authenticate an account by phone and could mutate RSVP by trusted phone, yet an accountless invited guest was sent toward email OTP instead of using the documented `GET /agent/guest/events` and `GET /agent/event` routes. RSVP parsing also omitted the documented `pending_guests` envelope, treated `already_responded: true` as a refused update even when `will_attend` confirmed the requested final state, asked for a second confirmation before a reversal, and selected the oldest recent campaign context.

**Decision:** Make no Agent API contract extensions. After `auth-by-phone` returns `user_not_found`, resolve associated-event requests from the trusted WhatsApp phone through the existing guest-event endpoint and retrieve the selected event detail without JWT. Use email/OTP only when the trusted phone has no safe guest match. Keep RSVP decisions on the existing trusted-phone endpoint, apply explicit reversals in the same turn, treat matching `will_attend` as authoritative, parse `pending_guests`, and prefer the newest recent campaign. When a turn contains an associated-event information request but no explicit RSVP decision or selected guest, route it to information even if extraction also found a campaign-grounded event reference.

**Implementation:**

- Added strict normalized gateway results for the documented guest-event list and event-detail routes. The production response represents `contact_info` as an object rather than the array shown by the initial fixture, so the parser accepts both documented wire variants and normalizes them into the existing internal label/value representation.
- Added typed `trusted_phone_guest` evidence to information execution. A single invited event is selected automatically; multiple events require a grounded event hint or return only the candidate names and dates for one compact selection question.
- Kept the new auth guidance outcome-specific and projected only after guest lookup succeeds. No global information prompt rule or new backend field was added.
- Added deterministic gateway, orchestration, service, RSVP, campaign-ordering, prompt-relevance, and live-coverage regressions. The permanent live case reconstructs the production campaign history and event-location question for the accountless test guest.

**Minimum-disclosure and prompt-size evidence:** `npm run audit:prompts` reported zero violations. The RSVP reply route is 8,579 serialized request bytes; accountless guest guidance is injected only for the completed typed outcome. The repository-wide static comparison is 347,525 bytes versus the 723,799-byte baseline, a 51.99% reduction.

**Validation and deployment:**

- `npm run check` passed typecheck, lint, 471 tests across 69 files, and `tests/live-behavior-coverage.test.ts` on the final code. Direct production-shaped gateway validation returned one guest event, a successful event detail, two moments, and four normalized contact fields.
- Deployed the final runtime artifact through CloudFormation in account `684516060775`, region `us-east-1`, using `se-dev`; the provider-sync stack was not changed. The ordinary deploy helper first succeeded, then later retries stalled while reading the current Secrets Manager value. The final two revisions therefore reused the stack's existing secret references and parameters and changed only the CloudFormation code artifact.
- Mandatory run `eval-2026-08-22T09-21-40-761Z-acd65cf7` proved the new accountless case end to end at `0.9667`: `contacto_inicial -> resolver_consultas_informativas`, then `auth_by_phone`, `lookup_guest_events_by_phone`, and `get_guest_event_detail`, with no OTP or RSVP mutation. The one-turn reply was: “La recepción y fiesta serán en Hacienda Recoveco, Avenida Manuel Valle, Lima, Perú”.
- The complete run finished 23/30 with five failures and two evaluator errors, so the global gate remains formally red. The target case passed. The residual hard failures are outside the implemented path: the retired email-after-phone-rejection case now contradicts guest-first lookup; two long-known RSVP cases assume mutable production state is declined/pending while the authoritative lookup returns confirmed; and two OTP wording cases varied semantically. The two errored cases were evaluator/runtime errors rather than skipped cases. Earlier post-deployment run `eval-2026-08-22T09-10-22-154Z-5fbc8807` completed all 30 cases without errors and passed 26, with only the obsolete guest-first and mutable-RSVP expectations remaining.

**Boundary:** Native WhatsApp template-button callbacks still do not invoke this Lambda and remain the campaign/button service's responsibility. This Lambda now handles the free-chat fallback and event questions in one turn using only the currently deployed Agent API capabilities.

## 2026-08-22 — Classify campaign replies from typed, minimum-disclosure context

**Reason:** A production campaign recipient replied with a polite decline. The model classified the turn as `suppress_acknowledgement`, but a blanket runtime override changed the result to `respond` solely because any recent message had `source=admin_campaign`. The state machine then reopened onboarding and sent the generic welcome. The relevant campaign body and inbound reply were available; the incorrect decision was introduced after classification.

**Decision:** Select a campaign-specific classifier profile only when the latest outbound message is an admin campaign. Project that campaign body, the current inbound message, and two typed status fields; omit the plan and unrelated history. Add a typed `campaign_reply_kind` so a pure acknowledgement or declined offer can be suppressed while RSVP decisions, questions, requests, and ambiguous replies continue to structured extraction. Keep the deterministic layer as a consistency check between the model's action and typed kind, not as phrase matching.

**Implementation:** Added the campaign classifier prompt, profile-aware prompt loading and trace fields, a realistic classifier-only corpus, and a repeatable `npm run eval:classifier-live` command. Removed the blanket campaign suppression override that caused the reported regression. Older campaign messages no longer select the campaign profile after a newer agent reply.

**Minimum-disclosure evidence:** The campaign classifier uses 2,343 instruction bytes, down from 9,334 bytes for the prior general classifier path (74.9% smaller). Realistic inputs measured 252–504 bytes; the reconstructed production interaction was 504 bytes. No plan, provider, purchase, authentication, or unrelated conversation-history content is included.

**Validation:** Typecheck, lint, prompt audit, static prompt comparison, and all 476 unit tests across 69 files passed. The classifier-only live gate passed 48/48 attempts: 16 realistic cases repeated three times, with no fallback. It distinguished identical wording by campaign purpose—for example, declining a promotion was suppressed while declining an RSVP was sent to extraction. The first mandatory deployed run exposed one additional real-history shape: an older `admin_campaign`, a later agent message, and then a newer `admin_manual` invitation reminder. The general classifier suppressed the explicit RSVP confirmation. The profile selector now treats that newer admin reminder as refreshed typed campaign context while still ignoring an old campaign when a regular agent message is newest. After redeployment, the exact Cinthya case used `classifier_profile=campaign_reply`, `campaign_reply_kind=rsvp_decision`, transitioned to `responder_invitacion`, and passed at 1.0.

**Final deployed gate:** Run `eval-2026-08-23T00-06-55-627Z-0b66bdb5` completed 30/30 cases with no evaluator errors or skips; 24 passed and six failed, so the global gate remains formally red. Both campaign-grounded RSVP cases, accountless guest-event lookup, immediate RSVP reversal, generic-reset, and the new planning behavior passed. Residual failures were unrelated mutable RSVP-state expectations, legacy/variable OTP expectations, and one provider-reference assertion. The classifier-only gate then passed 48/48 again on the deployed code.

### Scheduled production smoke — 2026-08-22 19:03 America/Lima

The Codex automation capability was not exposed in this session, so no scheduled-task ID could be created. The current task remained active and opened the smoke window at exactly `2026-08-22T19:03:00-05:00`.

At `2026-08-23T00:03:24Z`, the production Agent API returned HTTP 200 and zero conversation messages for the sole authorized mutation identity. A second check at `2026-08-23T00:16:14Z` again returned zero messages and zero `outbound/admin_campaign` records. Because the required CRM template body and timestamp were absent, the smoke stopped at the declared integration boundary: no RSVP button was pressed, no free-chat message was sent, and no RSVP record was mutated. Production safety for the end-to-end campaign path is not claimed.

Read-only comparison confirmed that a previously reported real recipient does have a complete `outbound/admin_campaign` record with a timestamp and non-empty body, followed by an inbound reply and an agent response. The body was inspected only for classifier reconstruction; reporting retains only hashes, byte counts, source, direction, and timestamps. The production Agent API has no global conversation-list endpoint, so new recipients cannot be enumerated by this Lambda. Sanitized Lambda and DynamoDB monitoring from 19:03 through 19:16 excluded `live_behavior.*` fixtures and found zero genuine production follow-up turns. Consequently there was no real post-campaign evidence of duplicate processing, missing context, generic welcome output, OTP fallback, HTTP 403/429/500, or model-stage timeout during that observation window; absence of traffic is not evidence that those paths are production-safe.

## 2026-08-22 — Normalize documented OTPs and exhaust phone event context before email

**Reason:** The documented login code contains exactly six digits, but the runtime accepted the first alphanumeric token containing a digit at any length from four through eight. This could submit an order number, year, or malformed alphanumeric value as an OTP, while rejecting common six-digit formatting such as grouped digits. Separately, the accountless guest fallback only ran when every protected information request was an associated-event request. A message combining an event-detail question with a private purchase question therefore skipped usable invitation context and asked for email before answering either part.

**Decision:** Normalize only one unambiguous six-digit OTP candidate. Accept contiguous digits, safely space- or hyphen-separated digits, and six consecutive Spanish digit words; preserve leading zeroes and reject wrong-length, alphanumeric, or multiple distinct candidates. For protected mixed-information turns, attempt account authentication by trusted phone first; after `user_not_found`, resolve every associated-event request through the trusted-phone guest endpoints before asking for email only for private requests that remain unresolved. A guest lookup is never used to invent or disclose purchase state.

**Implementation:** Added twelve deterministic OTP normalization cases and a mixed-information state-machine regression. The latter proves `auth_by_phone`, `lookup_guest_events_by_phone`, and `get_guest_event_detail` run in one turn; event evidence completes while the purchase result remains `needs_input: email`; and no login code is requested before the user supplies an email. Added a separate mandatory live behavior case with hard trajectory, tool, state, and required semantic expectations.

**Minimum-disclosure evidence:** No prompt files, model schemas, or global instructions changed for these two fixes. The result-specific operational evidence is selected only when a trusted-phone guest result completed and another protected result still needs email. Prompt audit reported zero violations. Static serialized requests measured 350,060 bytes versus the 732,995-byte baseline, a 52.24% reduction. In the passing deployed mixed case, classifier/extractor/reply instruction and input bytes were `2,343/325`, `10,517/2,558`, and `13,408/9,068`; the larger reply input contains the selected event detail and two typed information results rather than new global guidance.

**Validation and deployment:** `npm run check` passed typecheck, lint, and 486 tests across 69 files. The focused deployed case passed at `0.9647` in run `eval-2026-08-23T00-49-51-360Z-720ac684`, trace `01M0P1H3ZS7RM8MVMKWVF62FE0`. It returned the verified reception location immediately, requested the registered email only for purchase status, called both phone lookup forms plus event detail, and did not call either OTP endpoint. The final development Lambda revision `61de3ad2-d6b3-4fc7-9ec5-160c1bada7d4` was active with a successful update at `2026-08-23T00:47:40Z` in account `684516060775`, region `us-east-1`, using `se-dev`.

**Mandatory live gate:** Run `eval-2026-08-23T00-50-17-032Z-afb3544f` executed 31/31 cases with no evaluator errors or skips; 28 passed and three failed, so the global gate remains formally red. Both accountless guest cases passed, as did the OTP word-normalization, OTP-send, OTP-nondelivery, repeated-failure, phone-auth success, and phone-auth fallback cases. The residual failures were the pre-existing wrong-account fixture, whose persisted production conversation still supplied guest context, and two mutable RSVP-state fixtures whose authoritative backend state contradicted their seeded expectations. None failed on OTP normalization or the new mixed phone fallback.

## 2026-08-24 — End authentication loops and define phone-scoped access

**Reason:** Five reported WhatsApp interactions exposed the same contract mismatch through different routes. The extractor generally preserved the user's request and correctly identified missing-code reports, but the runtime kept the conversation inside email authentication after OTP delivery was reported missing, after an accountless buyer explained that no account existed, and after a person explicitly refused verification. A separate RSVP interaction had a trusted-phone event association in the Agent API while the pending-invitation lookup returned no match, so the bot contradicted both its own campaign and the CRM attendance card.

**Read-only API evidence and access decision:** The investigation used only GET requests and stored audit evidence. The public account lookup returned `404` for every reported phone and supplied email, while `GET /api/agent/guest/events` resolved the associated event for four of the five reported phones. That guest-event response exposed event identity but not guest ID or current RSVP state. Purchase reads remained JWT-protected, and the API exposed no phone-scoped purchase summary. The resulting policy is recorded in `docs/phone-scoped-access-decision.md`: a trusted channel phone may unlock event association and logistics, current RSVP state and mutation once the backend returns a guest identity, and an allowlisted purchase-support summary once a phone-scoped endpoint exists. Phone alone must not expose payment identifiers, bank or destination-account data, vouchers, gateway or decline details, admin notes, host finances, or purchase mutations.

**Decision and implementation:**

- The first typed OTP non-delivery report now dispatches one automatic resend. A second report, a resend request after two sends, or a terminal authentication transport/account failure requests human takeover immediately while preserving the protected query.
- `accountless_user` and `decline_authentication` are structured extraction outcomes. An accountless protected purchase is handed to a person without another registered-email prompt; an explicit privacy or security refusal closes the protected query and does not force a handoff.
- RSVP lookup now falls back from the pending-invitation contract to read-only trusted-phone event association. Association without guest ID is evidence that the invitation exists, not authority to claim or mutate RSVP state. A person saying they already confirmed receives an acknowledgement rather than a false denial or an email/OTP request.
- OTP send and non-delivery counters are persisted as typed authentication state. Loop-breaking decisions are deterministic consequences of that state; no exact-string conversational routing was added.

**Permanent regressions:** Added three new deployed cases for first non-delivery auto-resend, accountless-purchase handoff, and explicit-authentication refusal. Updated the repeated non-delivery, repeated invalid-code, and campaign RSVP cases with hard structural assertions and required semantic judges. Added deterministic twins for every new path and registered six distinct behavior changes in the live coverage registry.

**Minimum-disclosure evidence:** Removed obsolete resolver guidance for missing-code choice loops, terminal authentication failures, and repeated failures because those branches are now resolved before reply composition. The information resolver request decreased from 13,818 to 13,637 serialized bytes. The extractor additions were condensed until the initial-information request remained below its existing 9,300-byte guard; no prompt-size threshold was relaxed.

**Local validation:** `npm run check` passed typecheck, lint, and all 494 tests across 70 files. The mandatory coverage test, prompt audit, RSVP regressions, and information-flow regressions all passed. Development deployment and the required live behavior gate are recorded below after execution.

**First deployed gate and safety follow-up:** The runtime stack deployed successfully in account `684516060775`, region `us-east-1`, using `se-dev`; provider sync was unchanged. Mandatory run `eval-2026-08-25T01-38-36-001Z-f4592141` executed all 34 cases with zero errors or skips and finished 28/34. The three new loop cases for first auto-resend, exhausted non-delivery handoff, and explicit refusal passed, as did the trusted-phone campaign RSVP case. The accountless case reached real human takeover without email or OTP, but its structural assertion showed that the extractor's restatement replaced the original pending query. The repeated-invalid-code case reached real takeover and retained the query in state, but its user-facing message did not name that pending question. The run also revealed that an explicit rejection of the current phone association still allowed the accountless guest orchestrator to use that phone and disclose event detail.

The follow-up preserves the stored query whenever a typed authentication action continues an existing information thread, includes the pending query in terminal handoff messages, and removes trusted-phone evidence from the orchestrator when structured extraction says the person rejected that phone association. A deterministic regression proves that no guest-event or event-detail call occurs after rejection and that the question remains pending for email fallback. The Gia Antonella semantic case was aligned with the now-observed trusted-phone event association: it must acknowledge the event without pretending the read-only response included guest or attendance state. After these changes, `npm run check` passed typecheck, lint, and all 495 tests across 70 files. Final deployment and live-gate results follow in a later entry.

**Second deployed gate and extractor disambiguation:** The follow-up deployment completed successfully. Mandatory run `eval-2026-08-25T01-57-13-368Z-24067a0e` executed 34/34 with zero errors or skips and finished 29/34. Accountless purchase handoff passed at `0.992`, repeated-invalid-code handoff passed at `0.936`, both campaign RSVP cases passed, and the new first-resend, exhausted-resend, and explicit-refusal cases remained green. The explicit phone-rejection case still failed because the extractor conflated “that account/number is not mine” with refusal to continue all verification; the deterministic disclosure guard was therefore not reached. The old phone-first fallback case also expected `code_requested` for a deliberately nonexistent email even though the backend returned failure and the hardened runtime correctly requested human takeover. Two mutable RSVP cases again expected declined state while the authoritative read returned attending; an unrelated provider ambiguity case varied into a phone-confirmation clarification.

The extractor contract now makes these structured outcomes mutually exclusive: rejecting ownership of the current account or number is `phoneConfirmation=no`, while `decline_authentication` requires rejecting continuation of verification. The invalid-email live case now requires the actual terminal-failure behavior—one code request attempt followed by human takeover that preserves the gift query—and forbids claiming a code was sent. This prompt rewrite is shorter than the prior rule and kept all prompt-size guards green. `npm run check` again passed all 495 tests across 70 files. The final deployment and mandatory run are recorded below.

**Final phone-rejection invariant and deployed gate:** A final read of the deployed trace showed that the extractor could still emit both typed signals for “that is not my account or registered number.” The runtime now gives the narrower `phoneConfirmation=no` decision precedence over `decline_authentication`: it clears phone-derived authorization, suppresses every trusted-phone guest/event lookup, preserves the protected request, and continues only through email fallback. A deterministic twin intentionally supplies both signals and proves the invariant without phrase matching. The node-scoped extractor rule also states that phone/account rejection is not a refusal to continue by email. `npm run check` passed typecheck, lint, coverage registration, prompt audit, and all 495 tests across 70 files.

The final development Lambda revision `e4bbfa17-ba14-4ad0-beea-f2c974fff662` was active with a successful update at `2026-08-25T02:24:15Z` in account `684516060775`, region `us-east-1`, using `se-dev`. Mandatory run `eval-2026-08-25T02-24-49-576Z-e508d1b8` executed 34/34 cases with zero evaluator errors or skips and finished 26/34, so the global gate remains formally red. The phone-account-rejection case passed all hard structural and semantic assertions at `1.0`: no phone retry, cleared phone authentication, preserved private query, and requested registered-email fallback. Accountless purchase handoff, explicit verification refusal, terminal invalid-email fallback, repeated invalid-code handoff, and both campaign-grounded RSVP cases also passed. Residual failures were two OTP fixtures that reached real `429` rate limiting instead of their seeded happy paths, one stale word-OTP fixture with no active challenge, one missing-code handoff semantic judge that rejected cautious wording after the fixture supplied no phone, two mutable RSVP fixtures whose authoritative state is now attending, and two unrelated semantic/production-state variations. No evaluator failure or skipped case was hidden; the mandatory global gate is not reported as green.

## 2026-08-25 — Reconcile both phone-scoped RSVP reads before reply composition

**Reason:** The Cristian interaction proved that the pending/invitation record read and the trusted-phone event-association read describe different facts. Reading only the former, or treating its empty result as “no invitation,” contradicted a valid event association. Sending both raw results to the reply model would preserve that contradiction and duplicate event, campaign, phone, and identifier data.

**Decision:** Start both phone-scoped reads concurrently on every RSVP turn and reconcile them deterministically before reply composition. A guest record is authoritative for RSVP state. A phone-event result may add an event association when no matching guest record exists, but cannot create a guest ID or RSVP state. Match records by event ID, with normalized event name only as a fallback. Preserve partial-coverage evidence when one read fails; fail closed when there is no usable evidence and either read failed.

**Minimum-disclosure projection:** The reply model receives one `rsvp_phone_evidence` object containing only `coverage`, `resolution`, and, per event, `event_name`, `event_date`, `invitation_record`, and `rsvp_state`. It does not receive the trusted phone, guest or event IDs, access method, raw API payloads, city, currency, or the duplicated campaign history. Once this canonical evidence exists, RSVP extraction omits the candidate guest ID and event reference, and plan evidence omits candidate records and timestamps. Mutation results update the same canonical object before reply composition so the model never sees a pre-mutation state beside a success note.

**Permanent regressions:** Added deterministic tests proving concurrent start order, event-ID deduplication with authoritative state dominance, partial coverage on one-source failure, post-mutation final-state projection, and absence of raw identifiers or duplicated history in the serialized reply input. Updated the mandatory Cinthya live case to require both read tools and to judge the answer against reconciled phone evidence.

**Local validation:** `npm run check` passed typecheck, lint, and all 498 tests across 70 files, including prompt audit, static prompt comparison, mandatory live-coverage validation, and the RSVP/minimum-disclosure regressions. Deployment, request-byte measurements, and the mandatory live gate are recorded below after execution.
