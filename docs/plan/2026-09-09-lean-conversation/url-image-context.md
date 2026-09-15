# URL image context — binding scope amendment

## Superseding decision — base64 image continuity (2026-09-11)

Read [persistent-image-context.md](persistent-image-context.md) first. Backend URLs are optional. Base64 images will be uploaded to OpenAI Files, retained as plan references for 30 days, and used by the established owner across turns. Earlier directions to preserve base64 description behavior are superseded. Implementation remains pending.

2026-09-10. User-authorized design amendment; implementation and live acceptance remain pending. This amendment supersedes conflicting image-storage and image-behavior instructions in receipt-attachment-feedback.md and task packets. Preserve the existing implementation assignment, acceptance gates and explicitly authorized promotion on readiness.

## Minimal upstream contract

Add one strict input variant: `image: {"url": "https://..."}`. Preserve existing base64 and media-error variants. Reject ambiguous URL-plus-data payloads. Do not require MIME, size, expiry, new media IDs or authentication headers from the sender. Reuse existing envelope identity and ordering fields.

The URL must return a supported image directly (PNG, JPEG, WEBP or nonanimated GIF), be reachable by OpenAI without cookies, custom authorization headers or private-network access, and remain valid when used in subsequent model requests. Signed URLs are acceptable while valid; no public bucket or public indexing is required. A webpage containing an image is not the image URL. Persisting an expiring URL cannot guarantee future access; request a refreshed reference only when missing image evidence is necessary for the task. Do not add a refresh service in this change.

## Exact implementation boundary

1. Extend src/core/inbound-image.ts, corresponding inbound types in src/core/messages.ts, and src/lambda/handler.ts validation/normalization with the URL variant. Keep the existing base64 path, limits, inspection behavior and nonpersistent bytes unchanged. This explicit migration scope overrides broad media-refactor directions for base64; it is not permission to add fixed replies. Do not put download URLs in opaque channel-media IDs.
2. Extend the existing event-plan schema and persistence projection with bounded attachment references linked to existing inbound identity/order. Store the URL and only necessary linkage, never image bytes, base64, generated image-description history, a new object-store key or another attachment database. Follow existing plan concurrency/idempotency conventions. Duplicated delivery must not duplicate references or effects; late events must not replace newer context. Make count/serialized-size bounds explicit in the implementation and test them against the plan item budget.
3. In src/runtime/agent-service.ts, route URL images through the established owner's context assembly. In src/runtime/openai-agent-runtime.ts, supply relevant URLs as native image content to that owner's existing model call. Verify the installed Agents SDK's input field and serialized Responses request (`type: input_image`, `image_url: HTTPS URL`); do not assume SDK and API field names match. No new image-description model, URL downloader, proxy, rehosting, object storage or base64 conversion. Keep the base64 inspection path intact.
4. Project relevant stored attachments on later turns when required; storing a URL alone does not give the model image access. Do not resend every image or the full customer profile on every call. Treat signed URLs as credentials in logs/traces: redact access parameters and never disclose them as conversational text. Preserve useful request-shape/byte evidence without publishing raw customer media links.
5. The owner interprets whether an attachment supports the current task, asks an explicit image question, or needs clarification. Use existing typed answer/silent disposition; no keyword rules, fixed acknowledgements, text replacement or unconditional image suppression. Spanish prompt changes belong to the actual owner nodes and URL-specific context projection, without changing base64 inspection instructions.
6. URL fetch failure is unavailable evidence, not proof of receipt contents or payment. Preserve established conversation state and answer from other sufficient evidence. If necessary, let the model request a usable reference. Never approve payment from a receipt or fabricate a team action.

## Behavior and validation

Reconstruct the complete supplied payment interaction as a permanent URL-path regression: prior payment discussion, pending order, separate abandoned cart, payment report, receipt URL, separate thanks. The receipt supports the payment task without unsolicited description; thanks does not restart the explanation. Exclude irrelevant cart facts from the payment model projection and reply, while retaining them for a later cart-specific question. This relevance requirement applies to customer-context projection, not a blanket cart ban.

Add positive counterparts: explicit describe-image question, image with question/caption, image then later question, an image answering an outstanding request, and standalone image with no established request. Add duplicate/reordered delivery, inaccessible/expired URL, unsupported URL response, and storage-bound cases. Use a controlled non-sensitive remotely accessible fixture for live vision; localhost or fictional image URLs do not prove successful vision. Include a meaningful visual question whose answer requires seeing the fixture. Assert actual native image request shape, persisted references without bytes/descriptions, no extra inspection call for URL input, unchanged base64 behavior, no unintended payment effects, and truthful response disposition. Semantic assertions test relevance and usefulness, never exact wording.

Register each behavioral change in evals/live-behavior-coverage.yaml with mandatory live_behavior_regression cases, hard structural expectations and hard text_semantic requireJudge true. Add offline twins for transport, persistence, ordering and scope preservation; measure serialized instruction/input bytes. Run focused tests, typecheck/lint, coverage registration checks, dev deploy on verified se-dev/us-east-1 account 684516060775, then the full mandatory live suite on frozen current bytes. No skipped cases, judge errors, hard failures or duplicates may count as acceptance. Preserve all outstanding plan checks, independent origin/effect evidence and final promotion gates. Update implementation-log.md and evaluation-manifest.md with actual evidence; this amendment does not mark implementation complete.

## Sources

- OpenAI image inputs: https://developers.openai.com/api/docs/guides/images-vision
- S3 consistency: https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html

S3 has strong read-after-write consistency. Avoiding an additional store here is an architectural simplification because the upstream already hosts the image, not a workaround for eventual consistency.
