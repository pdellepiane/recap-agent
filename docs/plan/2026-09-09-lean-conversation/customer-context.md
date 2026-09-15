# Customer operations: structured context before answering

## Latest sync decisions

Read [batching-profile-sync.md](batching-profile-sync.md): backend owns eight-second batching; support all image/text orders within and across packages; image-only defaults to typed silence unless fulfilling an outstanding task. Expand relevant authorized profile details with bounded traversal and no age cutoff. Campaign implementation waits for docs.

Design proposal, 2026-09-10. This extends the existing three-owner design; it is not implemented by this document. Product owner labels are Planning, General information (FAQ), and Customer operations. Retain the existing planned internal identifier `customer_assistance` unless implementation finds a concrete reason to change it; a label change needs no migration or fourth agent.

## Recommendation

Build one typed customer snapshot from authorized backend reads when entering Customer operations. Start independent reads concurrently, reuse the results for the turn, and present a compact view to the model before it answers. The same model can answer, request a focused detail lookup, clarify an ambiguous target, or request an authorized action. No profile-writing LLM, separate research agent, second conversation store, or model-generated biography.

Keep a small common customer summary plus the relevant detail for this question. A runtime snapshot may hold more fetched data than the model sees. Do not put all orders, invitations, transactions, addresses and authentication material into every request. This preserves the intended benefit—ready-to-use customer state—without restoring a large universal prompt.

## Existing building blocks, verified in source

- `src/runtime/information-orchestrator.ts`: `execute` runs independent requests through `Promise.allSettled`; purchase promises, event-detail promises and `PhoneContextSnapshot` already deduplicate/assemble data within a turn. Extend these responsibilities rather than adding a parallel orchestrator.
- `src/runtime/agent-conversation-gateway.ts`: guest-phone and authenticated order/gift lookup methods, associated events and event detail are available interfaces, subject to capability and access checks. Some methods are optional; availability is not guaranteed by interface membership.
- The phone authentication result currently exposes user ID/name/email and credentials. Credentials stay runtime-only; requesting them is not itself permission for additional reads or writes. Preserve the existing trusted-phone/accountless access rules.
- `src/runtime/sinenvolturas-gateway.ts`: `resolveEventPlace` accepts event/source place, location or address and can fall back to country. This is not proof of a complete venue address or a customer's home/shipping address. Purchase schemas inspected do not establish a customer-address capability. Verify source payload, meaning, completeness and permitted disclosure before adding such fields.

## Minimal snapshot contract

Use existing domain types where possible. Each section carries its own load status (`not_requested`, `loading`, `ready`, `not_found`, `unavailable`, `failed`), source, fetched time and access scope. Include completeness/pagination when the backend provides it. `not_found` requires a successful authoritative read; a timeout or unrequested section is not empty data.

| Section | Content | Projection rule |
| --- | --- | --- |
| Identity/access | Backend customer reference, display name if available, guest/host relationships, permitted scopes | No tokens, OTPs or credential payloads. Identity must not be guessed from a name match. |
| Current context | Relevant event/order references, pending question, unresolved candidate set | Reuse current conversation/domain state. A default candidate is not a confirmed target. |
| Purchases/carts | Bounded summaries with IDs, event relationships, actual status and source timestamps | Show relevant summaries; retrieve transaction/item detail only when needed. Preserve older/newer and guest/host distinctions. |
| Invitations/events | Associated event references, role, RSVP state and relevant event facts | Resolve multiple people/events before action. Public event location and private addresses remain separately typed. |
| Action outcomes | Operation, target, actual confirmed/failed/unknown receipt and observed time | Existing success is not evidence of a new write on this turn. Model cannot author receipts. |

An optional address must identify its kind (venue/shipping/billing/etc.), source and completeness. Do not flatten all locations into `address`. An event country fallback cannot answer a street-address question as if complete.

## Execution and latency

1. On entry or changed identity, use established authenticated/trusted-channel evidence. Start a bounded set of independent, authorized summary reads that the available APIs and established task justify. Do not eagerly hydrate every historical record or every event detail.
2. Resolve semantic task scope through the existing owner model path. If not yet known, fetch only a verified cheap common summary; do not add a second LLM solely to build the snapshot. Existing owner/task state can narrow reads on continuations.
3. Await the required sections before composing a factual answer. If those sections succeed, an unrelated optional lookup must not hold up the answer. A failed required section is visible as unavailable/failed so the model can give an honest useful response or ask the missing question.
4. If the answer needs more detail, expose a focused read tool to the same owner. Reuse in-flight promises and completed results; don't fetch the same order/event twice under different helper names.
5. Before a write, validate current target, authorization and authoritative preconditions. A cached profile is context, not write authority. After a confirmed effect, update or invalidate the affected section before the model reports its outcome. Unknown effects must not be blindly retried.
6. Do not depend on unawaited work surviving a Lambda response. Optional reads must settle within the invocation deadline or be cancelled where supported; genuinely durable background hydration would require explicit infrastructure and is out of scope for the first version.

Choose concurrency limits, timeout allocation and reuse TTLs from measured endpoint behavior and existing request budgets, not an invented universal number. Reuse within a turn first. Cross-turn caching is optional and needs identity/access-scoped keys, source timestamps, invalidation after writes/account changes and a clear freshness policy. Never key protected data by display name alone.

## Concrete implementation slice for L4

- `information-orchestrator.ts`: factor existing per-turn caches and normalized results into a shared customer-context assembly path. Preserve parallelism and independent failure handling.
- `src/core/information.ts`: add only missing discriminated section/evidence types; avoid duplicating existing purchase/event models.
- `agent-conversation-gateway.ts` and relevant gateway adapters: verify summary/detail payload contracts; add a field only with source evidence. No new endpoint is assumed.
- `openai-agent-runtime.ts`: project common identity/current references plus task-relevant snapshot sections into the actual Customer operations request. Inactive sections, impossible tools and missing-value boilerplate stay absent.
- `agent-service.ts`: reuse context on entry/continuation, bind scope to identity/access, and invalidate affected facts after actions. Keep the existing plan store authoritative for conversation state.

This is part of `l4-ownership`, after preceding migrations and evidence controls. Do not interrupt the active deletion/validation wave or implement a second profile pipeline alongside it. No production deployment is implied by this design.

## Acceptance scenarios

- Cold customer turn: independent permitted summary reads overlap; no duplicate endpoint calls; first answer uses actual returned data.
- Ready purchase plus slow/failed unrelated event lookup: purchase answer is not delayed until the optional lookup's entire timeout; capture timings to prove it.
- Required lookup failure: no false missing-order or no-purchase claim; useful available facts are still preserved.
- Event-address question: exact relevant event/detail source selected; country-only data remains incomplete; no invented shipping/home address.
- Two events/two purchases: no automatic first-record selection; focused retrieval/clarification resolves the target.
- Accountless trusted-phone flow and protected account flow: existing access rules hold; switched identity cannot reuse another person's cache.
- RSVP/purchase changes after snapshot: write validates authoritative state; confirmed receipt refreshes the response; repeated acknowledgement does not imply a new action.
- Minimum disclosure: changing irrelevant historical purchases leaves the question's model request unchanged; changing its relevant status/address changes the evidence. Removing required facts must fail, so an empty profile cannot win on bytes.

Compare full-scenario first-answer latency, backend call counts, serialized instruction/input/tool/schema bytes, factual coverage and effects against the current implementation on the same fixtures/model. Add meaningful offline twins and mandatory hard structural plus required semantic live cases; extend the coverage registry separately. Run the complete mandatory dev gate after implementation. A full-profile prompt or more backend calls is not a simplification win by itself.
