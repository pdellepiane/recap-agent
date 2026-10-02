# Receipt context audit — 2026-09-18

Audited source: ca89e801. No runtime edits, deployment, live evaluation or paid model generation in this audit.

## Reported interaction and correct behavior

The supplied screenshot shows a receipt followed by an unsolicited visual transcription. The preceding customer conversation, account identity and actual account records are not visible. It is therefore not possible to assert which purchase matches, whether this payment is approved, or what the old extractor received.

When the established conversation concerns a purchase/payment, the receipt should support that task. Read the relevant authorized orders/gifts, compare available event/recipient, amount, currency and transaction facts, and report the backend state of the compatible record. Amount agreement alone does not establish identity or approval. Preserve competing candidates and ask one distinguishing question only if needed. Do not recite the receipt, disclose unrelated abandoned carts, invent a pending review, request another image/URL, or mutate payment status. A new image without an established task should not trigger speculative account-wide searches or a description.

## Current implementation: verified boundaries

- `src/runtime/agent-service.ts`, `hasOutstandingImageTask` and `hasInformationWork`: new/pending extracted requests continue through the information executor; image-only turns without outstanding work persist silently. A completed information request alone is deliberately excluded from the image gate.
- `src/runtime/openai-agent-runtime.ts`, `buildExtractionRequestSpec` and `buildExtractorImagePresence`: extraction receives text/history and attachment availability/message linkage, not image pixels or file IDs. Consequently receipt contents alone cannot drive its purchase lookup or resource selection.
- The reply stage can receive native file images and projected purchase facts together. It cannot retroactively choose another account read when its current tool surface is empty.
- `prompts/nodes/resolver_consultas_informativas/response_contract.txt` restricts description to requests for visual content and distinguishes receipt evidence from backend approval.
- The old `inspectImage` method still contains an automatic-description default, but a source call-site search found no service invocation. Existing regression tests prove normal image turns do not invoke it. Its existence is dead-code debt, not evidence the current service uses that flow.
- `prompts/extractors/information.txt` still says that a photo is FAQ in its assistance paragraph. That instruction is too broad: an image accompanying an established payment question is not inherently FAQ. This audit does not assume deleting those words alone proves correct behavior.
- Orders versus gifts are chosen by the structured request and authorization rules. An image does not establish that both roots were checked. Do not claim comprehensive matching unless the actual tool results establish coverage.

## Evidence

Current offline run: 150 tests passed across five matching suites: s17-image-turn, image-sdk-wire, s08-purchase-reconciliation, information-orchestrator and runtime-actual-request. They establish native image transport, silent image-only behavior, continued pending work, purchase-source handling and receipt/approval separation. They do not establish that a real model will infer a purchase lookup from this particular captionless receipt.

Historical full run d92b78c3 provides narrower live evidence: image_multiple_pending_orders_no_select called lookup_guest_orders_by_phone and named two candidates without approval; image_readable_captionless initially stayed silent. These are older-artifact results, not a current live certification. The URL payment-thread case used a non-receipt placeholder image and is not pixel-matching proof.

## Remaining proof and bounded implementation direction

First obtain the preceding conversation or its identifier. Reconstruct the actual task and authorized records instead of inventing them from the screenshot. Preserve this interaction as a live regression before making a behavioral fix.

The required permanent regression must cover a pending purchase question followed by an image, image and text together, and image followed by the question. Use a synthetic receipt and account records; include an unrelated cart, a genuinely competing record, no compatible record, and unavailable/partial records. The model must receive the actual image and applicable canonical records in the same decision context. Test both order and gift sources where authorized. Structural checks must prove reads and zero payment/RSVP/handoff mutations; semantic checks must require a grounded task answer without mandatory wording or unsolicited transcription. Do not treat a canned mocked reply as proof of real model matching.

If the actual failure is text/history extraction, correct that existing extraction contract and keep the existing purchase executor. If the needed lookup depends on pixels unavailable at that decision, transport the existing native attachment to the existing decision boundary; do not introduce a separate OCR/description agent, keyword receipt router, or description-based memory. Reuse the existing file/URL projection and authorization. This needs explicit serialized-request and native-wire tests and a bounded live check before it can be called verified.

Current conclusion: contextual purchase checks are supported; automatic receipt-to-account matching for this unseen history is not yet proven. The old transcription behavior is not the intended default, but the screenshot alone is insufficient to certify the current version handles this exact interaction correctly.
