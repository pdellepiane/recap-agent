# Corrected inbound contract and response continuity

Binding user correction. Backend batching is COMPLETELY INVISIBLE to Lambda. The existing request still contains text and optional image. There is no new message-package schema, ordered parts array, batch ID, batch-completion marker or eight-second timer visible to this application. Do not request or wait for such a contract. Campaign remains separately deferred. This corrects an assistant planning error, not an upstream scope change.

## Immediate implementation correction

Stop implementing new package parsing, schemas, adapters, grouping or batch state based on the previous handoff. Inspect your diff and remove only changes introduced for that mistaken assumption, preserving unrelated active work. Keep existing text + optional image input, Files persistence, owner-context integration and concurrency fixes. At inspection here, src/core/messages.ts still has text:string and image?:InboundImage; a search of messages.ts/handler.ts/inbound-image.ts found no package/parts parser. Work in another client may differ; inspect it before claiming anything was removed.

## What can and cannot be guaranteed

Each invocation is a real observed turn. The runtime cannot know whether more text/images will arrive after it responds. Once an answer is sent, it cannot be retroactively merged with a future answer. Exactly one answer across an arbitrarily fragmented conversation is impossible without an explicit end signal or delaying answers indefinitely. A finite debounce also cannot guarantee this; a user can send the next message just after it expires. We will add neither a timer nor a new batching protocol.

The selected policy is immediate useful answers to currently answerable requests, quiet receipt of supplemental images, and no repeated explanation when later turns add no answer-worthy question or material update. One outgoing conversational response at most per processed invocation; multiple answers are legitimate when later turns ask new questions or correct material facts. Missing required answers must never be counted as successful duplicate prevention.

## Model-owned response decision

Reuse existing owner/extraction and typed send/suppress/failure disposition. Supply only relevant current text/image availability, pending user question/target, recent actual delivered answer and referenced image evidence. No extra suppression model or exact-string comparison. The model distinguishes:

- Unanswered request with enough evidence: answer now.
- Unanswered request genuinely awaiting evidence: preserve it; ask a useful clarification only when necessary, never repeatedly.
- Image alone, no pending question: persist silently. It is not an automatic request to describe or approve anything.
- Image alone fulfills an unanswered question: answer the pending question from the image.
- Image supplements an already answered question without requiring correction or a new action: persist silently; do not repeat status.
- Later text asks a new question, requests an explanation, or corrects a material premise: answer using relevant retained image and backend evidence. Do not suppress merely because a prior answer exists.
- Thanks/acknowledgement that adds no task: legitimate silence.
- Image materially contradicts an earlier answer: the owner may issue a concise correction when justified, with user-image provenance and no unsupported payment approval.

Statefulness is semantic continuity, not scripted conversation. Reuse existing pending request and real outbound history fields. If a gap requires a field, add only the smallest typed reference needed to distinguish answered from pending; do not invent a fragment-state machine or duplicate full history.

## Concrete sequences and pass/fail

1. text question -> image in SAME invocation: one answer uses both. Fail if generic greeting or a second image-description answer.
2. text question -> answer -> image-only -> follow-up text question: initial answer remains valid; image persists silently; follow-up receives one relevant answer. Two total answers are expected, not a defect. Fail if image triggers repeated explanation, follow-up loses image, or follow-up is suppressed to force one answer.
3. image-only -> text question: silent first turn, one answer on second using original pixels.
4. text requires missing image -> image-only: preserve pending question, then answer once image arrives. A prior necessary clarification is allowed; no needless repeated question.
5. two text invocations -> answer(s) -> image -> text -> image -> text -> text: evaluate every observed turn against what was known THEN. No fixed total-answer oracle. Images alone ordinarily stay silent; new questions answered; acknowledgements do not restart. Preserve continuity across all image arrivals and evolving targets.
6. answer -> voucher image -> thanks: no extra payment explanation; original order status remains authoritative. Receipt never proves approval.
7. answer -> image -> explicit request to repeat: answer the explicit request; intentional requested repetition is not duplicate delivery.
8. concurrent image/text invocations: existing per-chat lease serializes processing, but does not guarantee FIFO among waiters. Tests cover actual acquire order and avoid invented sender ordering guarantees. Image persisted first must be available to a later acquiring turn; a question processed first may need follow-up evidence. Different chats remain independent.

## File-level correction to execution packet B

- src/core/messages.ts, src/core/inbound-image.ts, src/lambda/handler.ts: retain existing wire shape. Delete only newly introduced package-specific machinery if present. Do not add arrays or new upstream fields. Keep image normalized before owner processing.
- src/runtime/agent-service.ts: existing image/normal turn paths share pending question, real delivered history and persisted attachments. Integrate semantic send/suppress decision before final delivery, never replace generated text with canned prose. Persist successful image upload reference before success/suppression. Preserve failures distinctly.
- src/runtime/contracts.ts and src/runtime/openai-agent-runtime.ts: project the minimum pending/answered context to the existing owner call and attach relevant pixels. No extra image-description or response-deduplication model. Instructions belong in the existing Spanish prompt nodes, not TypeScript prose templates.
- src/core/plan.ts: reuse existing state; add no batch fields. Existing attachment linkage survives cold starts and owner transfer. Do not mark a pending question answered solely because a failed/suppressed turn occurred.
- src/storage/conversation-turn-coordinator.ts and src/storage/dynamo-conversation-turn-coordinator.ts: reuse current behavior; no new waiting semantics or nested mutex. Existing timeout/retry/FIFO limitations remain documented.
- tests/image-file-persistence.test.ts, tests/s17-image-turn.test.ts, tests/silence-exemption.test.ts and tests/lambda-turn-coordination.test.ts: exercise sequences above through production callers, including alternating questions and images. Assert observed per-turn usefulness and effects, not a universal one-answer total.
- evals/cases/ and evals/live-behavior-coverage.yaml: add full-context sequence regressions with hard structural/effect and required semantic judge assertions. Old internal image_inspect/node expectations must not force retired architecture. No oracle may assume future messages were available to the model.

## Unchanged decisions and definition of done

Five-day OpenAI Files retention; no local image-byte storage, S3, description service or extra model pass. Thorough bounded profile enrichment with relevant model projection, no date cutoff, no automatic newest-record identity. Campaign deferred.

Implementation deliverable must show no invented package wire fields, all sequences pass, no unwanted image-only replies, no lost follow-up question, no automatic payment effect, no new timers/locks/models, and model-written delivered language. Run typecheck/lint, focused production-path tests, registry check, current dev deployment and the full mandatory live gate. Preserve all prior runs and separate evaluator review. No score improvement from suppressing required answers. Shared-file ownership remains exclusive; production release requires the existing full-plan gates.
