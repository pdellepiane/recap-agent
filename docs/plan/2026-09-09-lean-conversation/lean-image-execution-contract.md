# Lean image/profile completion — atomic execution contract

## Binding correction: no package protocol

Read [inbound-continuity-correction.md](inbound-continuity-correction.md) first. Backend batching is invisible: Lambda keeps text + optional image. Earlier ordered-parts/package-schema implementation directions are withdrawn. No timer or batch state. Answer current requests, persist supplemental images quietly, and respond to later questions without repeating resolved explanations.

2026-09-11. Binding decisions and file-level work packets, not completion evidence. Supersedes conflicting retention and image-only reply instructions in earlier amendments. Keep the original lean-conversation objective and E01–E12/R01–R11 acceptance contract. This document does not authorize a parallel writer to shared runtime files.

## Decisions frozen for implementation

- Accept existing base64. Upload original bytes once to OpenAI Files; keep references in the existing plan. Set expiry to FIVE DAYS (432000 seconds) from file creation. Preserve five active references, two images per model request, 16 KiB reference budget and current input byte limits. New uploads use the new expiry; existing files retain their recorded expiry until deletion/expiry, with no migration daemon.
- Do not add a receipt-description/OCR model pass, receipt parsing service, image database, S3 bucket, vector store or provider conversation chain. Do not replace the original image with a description. A summary is lossy and cannot support unanticipated later questions or correction of a misread digit.
- The existing owner may retain necessary facts already extracted during ordinary task processing, with user-image provenance and uncertainty. No mandatory receipt schema expansion solely to anticipate every future question; no generated descriptive chat message. Receipt evidence cannot approve payment or prove a business effect.
- Uploading is a Files API operation, not an extra model inference. Subsequent relevant vision still consumes model input; file reuse is not free permanent model memory. Five days is the selected retention tradeoff, not a guarantee of covering 72 business hours, all future questions, or a fixed project quota. After expiry, ask for resubmission only if original pixels are necessary.
- Backend owns eight-second batching. Reuse the current conversation mutex unchanged unless a demonstrated boundary bug requires correction. No extra lock, queue, sleep, heartbeat or scheduled “waiting for image” message.
- Image-only: successful persistence + typed silent delivery by default; if it fulfills an outstanding request, the established owner continues that task. Question-bearing packages receive a useful response or a truthful limitation. Never treat failed generation as intentional silence.
- Profiles: deepen relevant authorized evidence, keep model view compact, use semantic target selection with state/recency as evidence. No date cutoffs or deterministic “newest pending order wins.” Campaign remains deferred until the real backend contract exists.

## Why this fits the long-horizon simplification

Retain one plan, three owners, one attachment adapter, one existing turn coordinator and the existing owner model path. Eliminate redundant image-inspection narration and duplicate evidence builders. Strict runtime invariants govern byte/type limits, access, identity, storage, concurrency and effects. The model interprets what the user means and writes conversational language. Tests enforce truth and task completion without demanding exact courtesy phrases or descriptions.

No guarantee of zero hallucinations is possible. Required evidence boundaries and counterexamples must detect invented amounts, currencies, dates, identities, image contents and effects. “Less code” must mean removing duplicate responsibilities, not deleting required checks or disguising a bypass.

## Actual mutex behavior and integration boundary

Read docs/conversation-turn-coordination.md and src/storage/conversation-turn-coordinator.ts before edits. The handler uses runWithConversationTurnLease; lock identity is channel + external_user_id. Acquisition precedes plan/history reads. Lease spans the actual Lambda deadline plus safety margin, release follows completion, and conditional release prevents an old owner deleting another lease. Existing bounded acquisition waits return retryable 503 on exhaustion; no assistant message.

This is mutual exclusion, NOT strict FIFO, event deduplication or durable recovery. Existing docs report uncertainty about invoker retry on non-200. Do not claim reliable eventual delivery until backend retry/ordering is confirmed. Keep that integration limitation explicit; do not build replacement queue infrastructure as part of this change. No lease should be held while waiting for a future user message. It only spans actual processing, including image upload, reference persistence, reply/effects and response construction.

## Packet A — retention and native attachment storage

Exclusive ownership: src/core/image-attachments.ts, src/runtime/image-file-store.ts, tests/image-file-persistence.test.ts. Coordinate shared plan schema changes with Packet B.

1. Change IMAGE_FILE_EXPIRY_SECONDS to 432000 and update stale 30-day comments and expiry assertions. Keep expiry centralized; no scattered literals. Do not modify unrelated retention or business records.
2. In OpenAiImageFileStore.uploadImage use the provider's returned expires_at when present, with the requested created_at + expiry fallback only when absent; validate returned ID/time/size before persisting. Never extend expiry on access or replay. Preserve purpose supported by the current documented native image path and installed SDK.
3. Preserve in-memory decode/upload, scoped digest reuse and no public raw-byte/file-ID logging. Do not construct origin evidence from rendered text. A known successful upload followed by failed plan save attempts deletion, then fails truthfully. Process-death orphans remain bounded by provider expiry; document this non-atomic window rather than adding distributed transaction machinery.
4. Reject expired file references from projection; preserve enough availability state to explain why an explicitly referenced image cannot be read. Do not silently substitute a newer image. Retain declared reference/count/input limits and explicit omission evidence.

Pass: Files create receives exactly 432000; returned expiry retained; duplicate committed event reuses file; failed save never returns durable-success acknowledgement; cold-start reference reload works; bytes absent from plan/logs; expired image unavailable rather than guessed. Fail: rolling expiry, raw bytes in history, duplicate business effects, silent substitution or invented successful upload. No new model call, store or scheduler.

## Packet B — packages, mutex, owner continuity

Exclusive ownership: src/lambda/handler.ts, src/core/messages.ts, src/core/inbound-image.ts, src/core/plan.ts, src/runtime/agent-service.ts, src/runtime/contracts.ts, tests/lambda-turn-coordination.test.ts, tests/conversation-turn-coordinator.test.ts, tests/s17-image-turn.test.ts, tests/image-file-persistence.test.ts. Serialize overlap with A/C/D.

1. Keep the existing text + optional image wire schema. No package contract, array normalization or campaign work. Remove only package-specific edits introduced by the mistaken earlier instruction.
2. Follow inbound-continuity-correction.md for semantic continuity across real invocations. At most one reply per invocation; no promise of one reply across future unknown arrivals. Preserve current question, actual delivered answer and attachment references without batch fields.
3. Keep validation before execution and plan/history reads + image upload/reference writes + owner work inside runConversationTurn/runWithConversationTurnLease. Do not nest another acquisition with the same identity. Read after acquisition so a second invocation sees newly persisted references.
4. Consolidate handleUrlImageTurn/runPersistedImageOwnerTurn/file processing into the existing established-owner path where responsibilities overlap; preserve both transport variants. Do not force image turns to FAQ/contacto_inicial, bypass required purchase reads, or invoke a standalone description model.
5. Image-only persistence may finish without generation if there is no outstanding task. Persist typed silence with a reason and source decision. An image fulfilling a task must not be suppressed because text is empty. Use model-extracted task evidence, not receipt keywords.
6. Different invocation ten seconds later reloads persisted image and pending question. An earlier question followed by image must also resume correctly. Respect owner transfer and clear unrelated images from projected context without deleting their reference.
7. Narrow provider file-access error handling. Invalid image/download 404 becomes unavailable evidence for model response when a response is needed. Auth, plan-store and generic model failures are not all image failures. Preserve every attempted model call and failed request metrics.

Pass: all three arrival patterns within/across packages; image-only silent persistence; outstanding request fulfilled; no extra wait or extra description call; two concurrent invocations cannot use the same stale plan; other conversations proceed independently; failed lock acquisition does not run the agent. Tests must not claim FIFO from mutual exclusion. Test release-on-error and retryable contention without increasing existing wait/deadline constants. Fail: missing image on follow-up, generic reset, duplicate answer/effect, response based on stale plan, or false success after timeout.

## Packet C — bounded rich profile, sparse model input

Exclusive ownership: src/runtime/customer-context.ts, src/runtime/information-orchestrator.ts, src/core/information.ts, src/runtime/agent-service.ts profile builder, src/runtime/openai-agent-runtime.ts evidence projection, tests/l4-customer-context.test.ts and tests/l4-customer-context-service.test.ts.

1. Inspect current production assembleCustomerContext/projectCustomerContext callers; the former missing-wiring audit is historical. Extend these callers, not another pipeline. Reuse normalized models and per-turn caches.
2. Expand relevant authorized order/payment/items/event and invitation/event/venue details via actual documented gateway methods. Traverse at most two relationship edges per pass, four concurrent reads, with access-scoped visited IDs and the current invocation deadline. No arbitrary object recursion or speculative new endpoints. Further focused reads remain available to the same owner when required.
3. Preserve source, retrieved time, completeness/pagination, failures and unknowns. An index may retain old candidate references while their unused detail stays out of prompts. No age cutoff. API-side history limitations remain explicit.
4. Model interpretation weighs explicit reference, active question, observed state and recency. A recent pending order plus voucher is a hypothesis, not confirmed identity or payment. Multiple plausible targets trigger focused read or clarification before consequential action. Explicit years-old target must override recency preference.
5. No confirmation before already-authorized reads. No whole-profile dump. Current-question-relevant detailed evidence reaches the actual owner request; inactive facts are absent. Preserve access control and invalidate after writes/identity changes.

Pass: relevant backend detail answers the question without avoidable confirmation; old explicit target works; cyclic relationships terminate; pagination not exhausted is not complete; unrelated-domain sentinels absent from actual serialized request; changed relevant amount/state changes projection; ambiguous target cannot write. Fail: fixed newest-record choice, hidden old records, unauthorized disclosure, a constant empty projection, or adding another profile model.

## Packet D — prompts, serialization and useful-answer acceptance

Exclusive ownership: src/runtime/openai-agent-runtime.ts, src/runtime/model-composition.ts as needed, relevant existing prompts/ node files, src/evals/targets/live-lambda.ts, src/evals/runner.ts only for reviewed oracle/observation corrections, tests/image-sdk-wire.test.ts, tests/model-output-origin.test.ts, tests/silence-exemption.test.ts, evals/cases/, evals/live-behavior-coverage.yaml.

1. Replace retired describe-by-default prompt callers with short owner-scoped Spanish guidance. Do not write complete response examples or a new global list of receipt rules. Explicit describe requests remain supported. Remove obsolete production helper and prompt files only after caller replacement is proven; preserve historical evidence.
2. Capture installed SDK serialization of input_image.file_id with current text/task evidence. A handwritten converter mirror is not acceptance. Include all retries/file failures in cost/latency accounting; upload counts separate from model counts.
3. Validate image-only silence at the wire through delivery disposition, no assistant text and persistence evidence. A question-bearing generation failure must fail. Do not coerce null to empty prose and demand a response hash for legitimate silence, or exempt any arbitrary empty output.
4. Add permanent base64/package interactions and paired controls: readable Peruvian receipt, ambiguous/truncated digits, amount/currency/date not legible, non-receipt, explicit description, old-image reference, multiple pending orders, expired image, image then later question, prior question then image, thanks, malformed media and package concurrency. Use non-sensitive synthetic Yape/Plin/bank-style fixtures with known facts; no fixed customer-name or fixture routing. Receipt resemblance does not establish authenticity.
5. Keep correctness/disclosure/effects hard. Do not require thanks, well-wishes, one sentence, backend jargon, unrequested translucency or exact transaction-status prose. Correct existing bad oracles separately under R05, with baseline and candidate on the same revised contract. Preserve old runs and hard expected user outcomes.

Pass: exact visual question answered from accessible original image, illegible fields remain unknown, no payment approval from receipt alone, relevant backend status retained, original model response survives transport, intentional silence distinguished from failure, wrong-answer mutants fail. Fail: image narration added by code, unsupported OCR fact treated as backend truth, mandatory template fragments, hidden model calls, or a judge accepting a known wrong target/amount/effect.

## Definition of done and release evidence

Each packet must deliver code, production callers exercised, regression tests and log evidence, not inspection alone. Run npm run typecheck, npm run lint, targeted meaningful tests and tests/live-behavior-coverage.test.ts. Use no skips as acceptance. Every behavioral change receives its own registry entry with hard structural and hard text_semantic requireJudge:true in live_behavior_regression.

For Lambda-impacting changes, deploy current dev via verified se-dev/us-east-1 account 684516060775. Serialize deployment ownership. Full npm run eval:behavior-live on frozen candidate bytes must execute every mandatory case, including additions, with zero hard failures/errors/skips and all required judges/effects/origin evidence. Diagnostics are not acceptance. Record old/new source/contract/deployment hashes and all results in implementation-log.md/evaluation-manifest.md. Baseline/candidate oracle revisions remain reviewed and comparable. Existing unrelated failed gates remain failed; no packet completion implies release approval.

Measure complete matched scenarios: all model calls, serialized instruction/input/tool/schema bytes, input tokens, upload bytes/count, image-bearing calls, retries, wall latency and lock wait. Report net source/prompt additions/removals with explanation. Acceptance requires zero dedicated image-description calls, zero new storage/queue/lock services, zero unnecessary repeated uploads for committed retries and proof inactive context is absent. Do not manufacture a percentage reduction without comparable baseline data. Final review lists surviving production paths and unresolved upstream contract/retry limits. Promote only under existing authorization after all full-plan gates pass.

## Storage sizing and checked sources

Current official Files docs state up to 512 MB per file and 2.5 TB per project; expiry supports 3600–2592000 seconds. This application retains its smaller 2,000,000-byte input limit. A supposed universal 1 GB Files cap is not supported by these docs; account-specific limits remain to be checked if reported. Do not confuse vector-store pricing with plain vision-file storage.

Estimate retained raw bytes = daily newly uploaded bytes × 5 days, plus other files, orphan uploads and expiration/deletion lag. At 2 MB/image and 100 new images/day, nominal five-day image storage is 1 GB; at 1,000/day it is 10 GB. Thus duration alone never proves “under 1 GB.” Reuse upload byte metrics; do not add a quota service speculatively. File expiry concerns file availability, not a claim of universal zero retention across Responses/logging/data controls.

Sources: https://developers.openai.com/api/reference/resources/files/methods/create ; https://developers.openai.com/api/docs/guides/images-vision ; local docs/conversation-turn-coordination.md and installed image-file-store implementation. No runtime/retention change has yet been made by this planning amendment.
