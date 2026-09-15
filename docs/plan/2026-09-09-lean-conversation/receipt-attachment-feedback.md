# Receipt attachment and unrelated cart — behavior specification

## Superseding decision — base64 image continuity (2026-09-11)

Read [persistent-image-context.md](persistent-image-context.md) first. Backend URLs are optional. Base64 images will be uploaded to OpenAI Files, retained as plan references for 30 days, and used by the established owner across turns. Earlier directions to preserve base64 description behavior are superseded. Implementation remains pending.

## Latest binding amendment — URL images

Read [url-image-context.md](url-image-context.md) before implementing media changes. New URL inputs receive native owner-context attachment behavior and plan-stored references. Existing base64 behavior and nonpersistent handling remain unchanged for now. No new image/object storage. This amendment supersedes conflicting earlier media directions; implementation and acceptance remain pending.


2026-09-10. Design/audit only; no runtime fix or passing live regression claimed.

## Observed interaction

User supplied a screenshot of a payment discussion: payment reported as already made; assistant discussed a pending order plus a separate cart; user sent a receipt image, then thanks; assistant described the receipt and repeated the order/cart discussion. A read-only audit of the supplied conversation confirmed image message 18201 at 02:10:34Z, thanks 18202 at 02:10:36Z, image-description reply 18203 at 02:10:38Z, and another outbound 18204 at 02:10:53Z (2026-09-10). Runtime evidence was available. Do not publish phone identity, receipt details or raw customer payloads in this public specification.

Current source independently establishes a design problem: prompts/nodes/resolver_consultas_informativas/image_inspection.txt explicitly requests a description for captionless images and receipts, and agent-service.ts handleImageTurn directly delivers inspection.answer. This source finding is not a claim that every historical model payload was independently retrieved.

## Expected behavior

- Preserve the image as an inbound attachment with message identity/order and a retrievable media reference. Do not manufacture a descriptive chat message or replay that description as authoritative history.
- Existing payment context gives the attachment its purpose. No unsolicited OCR summary, amount/bank narration, unrelated cart/checkout guidance, or unsupported payment-approved claim.
- A supplied receipt is user evidence, not backend confirmation of credited payment or proof that a team processed it.
- A captionless attachment without an outstanding request can be stored silently. An explicit image question, or an image fulfilling an existing request, must still be handled using that context; do not apply a universal image-suppression rule.
- Thanks does not require reopening the transaction. Any response must be model-generated and contextually useful. Legitimate suppression is an explicit typed disposition, not an empty fabricated model answer.
- Do not ask what the user wants when payment context already establishes it. Ask a model-written clarification only when the task or target is unresolved.
- A separate abandoned cart stays out of this payment-status answer. Keep cart information available for a later cart question; do not delete it or globally hide carts whenever an order exists. Profile assembly alone does not establish relevance: projection must follow the current task.

## Storage and message contract

Official Meta webhook examples represent an image as a message with an ID, image media ID and optional caption. A later text message is a separate event. Preserve that link/order, while separating storage from outbound delivery.

Use a controlled retrievable attachment reference, preferably an existing durable backend reference; otherwise private object storage with scoped retrieval and retention. DynamoDB holds message/conversation links, object key, MIME type, byte size and timestamps, not raw megabyte-sized image bytes. DynamoDB maximum item size is 400 KB. Current repository MAX_IMAGE_BYTES is 2,000,000, not three megabytes. A change to URL input or size needs coordinated adapter/schema validation; do not silently assume support. Avoid storing expiring access URLs as the sole durable identity, exposing public receipt URLs, or accepting unrestricted server-side URL fetching.

Model context receives the relevant attachment only when needed. Typed extracted facts may be retained with user-image provenance; they are not a substitute for authoritative payment state. Do not rely on provider media or unawaited Lambda work being indefinitely available. Keep logical message grouping/ordering in the adapter and semantic response decisions in the owner model; no keyword routing or sleep inserted into Lambda as a substitute for durable delivery coordination.

## Implementation and regression handoff

Review image prompt, handleImageTurn, inbound-image schema, channel-media contract, history/attachment persistence and customer-context projection as one bounded behavior change. Replace the describe-by-default policy with context-aware attach/answer/clarify disposition. Reconstruct original prior reminder/payment report, pending order plus distinct abandoned cart, image and separate thanks in a mandatory live case with hard structural checks and requireJudge semantic assertions. Preserve real/backend distinctions in the fixture; retrieve missing stored context rather than invent it.

Cover image then question, image plus caption, receipt then thanks, explicit describe-image request, unreadable required evidence, cart-specific question, duplicate/reordered delivery, and unavailable media references. Assert no automatic payment mutation, no unsolicited cart mention or visual inventory, preserved attachment accessibility, no duplicate substantive reply, and a correct supported-answer counterpart. Use semantic expectations rather than banning particular wording. Separate deliberate response-policy changes from old image-description tests through the reviewed evaluator-change process. Register the behavior change, add offline twins, measure request bytes, deploy dev and run the complete mandatory gate when implementation occurs.

Sources checked:
- Meta image webhook example: https://www.postman.com/meta/whatsapp-business-platform/request/dy46yyn/received-media-message-with-image
- AWS large items guidance: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-use-s3-too.html
