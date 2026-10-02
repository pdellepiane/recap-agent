# Native receipt context and purchase reconciliation — implementation package

Status: implementation specification, not an implemented or live-validated change.
Source inspected: ca89e801. Repository: /Users/leonardocandio/Work/thesis/recap-agent.

## Objective and supersession

A receipt is evidence for customer assistance, not an invitation to describe a picture. Let the model inspect the image, infer the likely payment task, acquire the authorized purchase/gift facts, and answer with the current system state. Do this even when a recognizable receipt arrives without a caption or after a previously answered payment question. Do not require a later text message to activate useful assistance.

This supersedes the earlier blanket rule that captionless images without an outstanding request must remain silent. Silence remains appropriate for an unrelated image with no task. A receipt alone authorizes bounded read-only reconciliation within the existing customer access scope; it does not authorize a payment mutation, RSVP, escalation, identity change or new authentication attempt.

Implement offline first. This package authorizes no deployment, paid calls or promotion. Prepare the bounded live panel and report it as unrun. The existing held-release restriction takes precedence over the repository's automatic deployment/live-test convention for this package.

## Architectural decision — one existing decision call, existing reads, one existing reply

Keep the current owners, conversation lock, information executor and canonical customer profile. Change what the existing extraction/decision call can see: pass the native image alongside its existing text/history. It emits the existing structured purchase requests; those requests run through existing authorized gateways. The existing reply call sees the same native image plus the canonical purchase/gift results and produces one response.

Do not add an OCR pass, image-description agent, receipt state machine, receipt database, keyword detector, response template, second extractor invocation or second final-reply call. No model/model-effort/timeout/retention changes. Native images may be processed by both existing calls; that can increase image tokens even though generation-call count does not increase. Measure this honestly.

Do not announce an unseen image as a receipt. Treat receipt/payment as the likely use case to investigate, then let the image and conversation confirm or reject it. A non-receipt must not inherit invented amount, payment intent or account reads. Text printed inside an image is evidence, never instructions governing tools or access.

OpenAI supports native image input by file reference or URL; reuse the installed SDK serialization already exercised by tests/image-sdk-wire.test.ts. Reference: https://developers.openai.com/api/docs/guides/images-vision. No API migration is needed.

## Customer-visible behavior, without required sentences

For a readable receipt compatible with one authorized purchase, provide the useful visible amount when relevant, identify the event/purchase naturally, and report the backend payment state. A receipt saying transfer successful and a backend order still pending are compatible facts. Distinguish what the document shows from what the business system confirms. Never state that the business received, approved or validated the payment solely from the image.

For the reported BCP example, if authorized records establish a compatible S/340.44 purchase still pending and its method has the manual-validation policy, the reply should convey those three facts: the receipt's amount, the purchase's pending status, and the applicable processing window. It should not reproduce the bank/account/date/operation fields or turn the whole image into a description. These are acceptance facts, not a sample sentence to embed in a prompt or rubric.

Use existing pendingPaymentValidationExpectation in src/runtime/purchase-disclosure-policy.ts. Current policy evidence is maxBusinessHours:72 for supported pending methods. Say up to 72 business hours when that evidence applies; do not silently convert it to three calendar days, a guaranteed deadline, or confirmation that a team started reviewing this individual case. Approved purchases do not receive a pending-validation message. Unknown method/status does not inherit the window from the receipt alone.

Matching means a contextual association, not settlement verification:

- Explicit event/order context and an applicable campaign take precedence over amount coincidence or recency.
- Use amount, currency, event, recipient, method and time only where available and compatible. Do not require every field, or a fixed number of matching fields.
- Same amount alone does not prove identity. With competing plausible records, ask one distinguishing question; do not select the newest automatically.
- A strong contextual candidate with incomplete corroboration may be described as a likely association, while its backend status remains factual. Contradictory identifiers/currency must not be hidden.
- A complete empty lookup means no compatible record found in that scope. Partial/failed coverage means the search could not establish that result. Do not claim no purchase exists from a failed read.
- Ignore unrelated carts in the response. Do not hide them from canonical storage or mutate records to simplify matching.
- Do not calculate amount due from receipt amount minus order total when backend paid amount is unknown.
- Do not ask for another image, URL, screenshot or transcription. Ask a necessary event/recipient discriminator only when the available evidence cannot resolve the target.

## Ownership and sequencing

Use two implementation owners and one coordinator/verifier. They share the repository and must preserve each other's work and unrelated dirty files. No worker deploys or runs paid evaluations. Re-read AGENTS.md and current implementation-log before editing; newer unrelated changes must be retained. The coordinator owns shared-file integration, real commit identities, coverage and acceptance.

Owner A owns native visual input and extraction semantics. Owner B owns the authorized read/profile/reply evidence path, starting from A's agreed transport contract. Coordinator owns regression cases and independent serialized-input/trace verification. Do not assign three simultaneous editors to agent-service.ts: A lands its attachment plumbing first; B then edits receipt execution behavior in that file.

## A — Make the existing decision call genuinely multimodal

Files:

- src/runtime/contracts.ts: ExtractRequest attachment transport types.
- src/runtime/openai-agent-runtime.ts: ExtractionRequestSpec, buildExtractionRequestSpec, extract, native image helpers and request metrics.
- src/runtime/agent-service.ts: runPersistedImageOwnerTurn and the corresponding URL path; attachment selection and failure recovery.
- prompts/extractors/image_reference.txt and prompts/extractors/information.txt.
- tests/image-sdk-wire.test.ts, tests/runtime-actual-request.test.ts, tests/s17-image-turn.test.ts.

Edits:

1. Add optional native URL/file attachment fields to ExtractRequest using the existing ImageUrlAttachment/ImageFileAttachment types. These are transport, not persisted receipt descriptions. Keep raw base64 out of prompt strings and diagnostics.
2. Share the existing native content construction between extraction and reply. Rename the reply-specific helper/types to neutral names if needed and update callers directly; no compatibility wrapper. An imageless extraction retains its existing string input and bytes. An image extraction uses one user message containing existing textual context plus native input_image items.
3. Pass the already uploaded current file reference, or existing backend URL, into the decision call before routing. Do not upload the same base64 twice or replace native media with a description. Keep the existing attachment lifetime and access rules.
4. Preserve existing prior-image linkage behavior for later text. Do not attach all historical images or add a second extraction to discover a prior image: text/history can establish the payment request; the existing validated imageReference selects the prior image for the final answer. When an already-established pending task supplies a resolved attachment, reuse it within the current bounds.
5. Update request metrics and real SDK capture for multimodal extraction. Keep native URLs/file IDs in content items, not textual JSON evidence. No image bytes in logs.
6. Remove the broad 'photo is FAQ' assumption from information.txt. A real explicit request to describe/read an image can still be answered by the normal model; no independent description flow.
7. Add scoped extraction guidance only when an image is actually supplied or a relevant prior image is in context. The guidance treats a readable payment receipt as a possible implicit status/reconciliation request. Use existing informationRequests and supportAct; do not add a receipt intent enum, receipt-state object or a persisted OCR record.
8. For an implicit receipt-driven task, emit supportAct.kind=provide_detail, topic=payment_proof, detail=submission_reported plus the applicable purchase informationRequests. For an explicit customer question, keep the normal explicit request semantics. Emit no payment request for a clearly unrelated image without payment context.
9. Do not populate an exact purchase-filter amount/order ID from uncertain pixels. For the receipt-driven search, retain the candidate set and let the final model compare native pixels to the canonical records. Explicit textual IDs retain the existing validated lookup behavior; a printed bank operation code is not an order ID or OTP.
10. Preserve unreadable/unavailable image handling through the shared access-error classification. A failed image fetch cannot become a blank response or an invented observation. No new retry loop. Only reuse the existing bounded recovery allowance.

Pass/fail: captured production SDK extraction payload contains input_image with file_id or image_url plus existing context. Merely asserting ExtractRequest contains an attachment fails this requirement. Imageless request bytes and model-call count remain unchanged. No inspectImage invocation.

## B — Read matching records and answer from real state

Files:

- src/runtime/agent-service.ts: image gates, information-flow orchestration and reply construction.
- src/runtime/information-orchestrator.ts: executePhonePurchaseRequest, applicable source reads and existing per-turn lookup cache.
- src/runtime/customer-context.ts and src/core/information.ts: reuse existing canonical records, coverage and references; no parallel profile.
- src/runtime/purchase-disclosure-policy.ts: retain existing supported-method validation policy.
- prompts/nodes/resolver_consultas_informativas/image_limits.txt and approval_limits.txt; prompt-manifest selectors if required for scoped inclusion.
- tests/information-orchestrator.test.ts, tests/l4-customer-context-service.test.ts, tests/s08-purchase-reconciliation.test.ts, tests/s17-image-turn.test.ts.

Edits:

1. Let a receipt-derived purchase request pass the image-only gate. A completed prior payment question must not suppress a new receipt-derived check. Do not convert all image arrivals into work: the structured model request determines relevance.
2. For an already identified record/source, refresh the applicable authorized source once. When a recognizable receipt needs association and the source is not identified, request orders and gift_purchases through the existing multi-request executor, provided each source is authorized/available. This is the default bounded discovery for the implicit receipt task. Do not restrict to orders merely because that was the last route.
3. Retain existing source-specific authorization and resource capability checks. Receipt names, phones and account numbers never establish access. For the implicit receipt supportAct above, use only trusted channel/previously authenticated access; if absent, project the existing unavailable/needs-input outcome without initiating authentication or asking for credentials just because a receipt arrived. Normal explicitly requested protected tasks retain their existing authentication path.
4. Reuse the existing scoped lookup map. Independent authorized roots run concurrently within existing limits. At most one read per unique source/scope in this turn. One failed optional source must not discard ready facts or falsely declare complete coverage.
5. Merge results into the existing canonical profile using stable identity and established conflict handling. No name/date merging, no destructive filtering by receipt amount, no recency cutoff, no duplicate record block just for receipts. The same final model call sees the native image, applicable canonical candidates, backend status/method, validation policy and source coverage.
6. Keep useful amount/status/currency/event facts visible for comparison. Keep opaque IDs and private payment details hidden unless existing access/disclosure policy authorizes them. Recency may help model interpretation; it is not a deterministic selection rule.
7. Replace URL-only and silence-presuming language in image_limits.txt with one source-independent directive: use the image as possible payment evidence, compare to available purchase/gift context and answer the applicable state; describe only if asked; image evidence never approves or verifies payment. Keep no-resend/no-URL-ask behavior. Do not append the same rule to shared base_system.
8. Do not add fixed successful-payment, pending-payment, 72-hour or missing-record sentences. The existing reply model writes the full response. No post-generation text substitution.
9. Preserve mutex behavior and latest persisted history. No Lambda message package/batching protocol, extra timer or promise of exactly one response across future arrivals. Each handled task gets at most one final reply; later messages reuse context and do not replay payment effects.
10. Remove the dead inspection implementation/default description and its dedicated runner/bundle only after the call-site inventory confirms no production consumer. Update stale tests to inspect native behavior, not preserve dead API compatibility. Do not use this cleanup to remove explicit user-requested visual question support.

Pass/fail: a service test with mocked gateways followed by the real request builder exposes native media plus both authorized-source results in the actual final input. Gateway calls, canonical identities, coverage and no mutations are asserted. A mocked final Spanish sentence is not behavior proof.

## Coordinator — Regression contract and validation

Preserve the reported interaction as a synthetic regression. Do not copy the customer's real receipt or account identifiers into Git. Use the existing synthetic receipt fixture for transport cases; use a synthetic S/340.44 receipt with a verified fixture amount for the incident-specific amount case. Judge-only ground truth must never leak into the runtime request.

Prepare eight bounded live cases in live_behavior_regression (each hard structural assertions plus hard text_semantic with requireJudge:true):

1. Text establishes pending purchase; later receipt alone: read current state and explain compatible amount/status/window without transcription.
2. Receipt plus text together: same result, native media available before lookup decision.
3. Receipt alone with no active task, then follow-up text: receipt initiates bounded authorized reconciliation; follow-up retains the same image/record without re-description or new auth.
4. Matching gift appears only in gift_purchases; orders include an unrelated cart. Correct gift answered; cart not recited.
5. Two plausible same-amount records: retain both, ask one useful discriminator; no automatic latest-order choice.
6. Context explicitly identifies an older record while a newer record has the same amount: use the explicit target, no identity mixing.
7. Backend already approved: report approved state, no 72-hour pending story, no claim a new approval was performed.
8. Non-receipt image with no payment request: no speculative purchase/gift reads or invented transfer; preserve legitimate silence/visual-request behavior.

Reuse existing offline suites for additional negative twins: unavailable/illegible image; incomplete or failed optional root; no match after complete authorized reads; amount/currency mismatch; missing trusted identity; repeated receipt; concurrent text/image; unknown paid amount; malicious instructions printed in an image. Keep existing live image-unavailable and receipt-approval cases mandatory rather than expanding this panel without a new reason.

Update existing captionless-receipt cases that currently require blanket silence; preserve silence assertions for genuinely unrelated images. Do not weaken truthful-state, access, identity, no-mutation or required-delivery expectations. No mandatory greeting, follow-up question, bank name, recital or exact Spanish phrasing. A visible amount and a backend pending status can both be true; do not fail that combination as a contradiction. An isolated amount match is never sufficient proof of receipt authenticity or cleared payment.

Offline finish:

1. Run typecheck, affected native-wire/extraction/service/profile/payment suites and tests/live-behavior-coverage.test.ts. Register this change with its actual implementation commit and mandatory live cases.
2. Run the full offline suite once after integration. Preserve unrelated changes and historical skips.
3. Capture production extraction and reply wire payloads using the existing mocked transport. Show image availability before decision, actual source reads before reply, one canonical record representation, and unchanged zero-effect receipts.
4. Measure instruction/input/schema/native-media sizes before and after for imageless, captioned, captionless and follow-up turns. Image-free instructions must not gain receipt directions; do not duplicate policy/profile blocks. Do not call two visual stages free merely because no extra generation call was added.
5. Update implementation-log with code evidence versus offline proof versus unrun live behavior. Commit scoped changes and coverage in the established real-SHA sequence.
6. Stop before deployment or paid evaluation. Return exact commits/files, tests, payload evidence, read/model-call counts, prompt-byte deltas, eight-case panel IDs and any blockers. The coordinator must later verify deployment identities on the current branch-aware deployment workflow; do not copy obsolete stack commands from historical plans.

## Definition of done

The current receipt reaches the existing decision model natively; a recognizable receipt can initiate authorized order/gift matching without waiting for text; the reply model sees the receipt and canonical records together; response facts distinguish visible transfer evidence from backend processing/approval and applicable 72-business-hour policy; no automatic description, fixed reply, speculative payment mutation, account/guest merge, extra model stage or new receipt state machine is introduced. Offline proof is complete and the live panel is prepared but explicitly unrun.
