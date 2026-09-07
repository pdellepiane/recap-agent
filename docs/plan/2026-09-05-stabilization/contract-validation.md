# Current contract validation and minimal optional upstream proposals

Date: 2026-09-05. No upstream writes were performed. No upstream change is required
for the local implementation or release. S03 tracks proposals only and requires
separate approval before any external implementation.

## Validated current shape

Fresh read-only GETs of `/conversations/messages` at 11:30:39 UTC returned HTTP 200
for both audited Roberto and Maria Paz identities, five messages each. We inspected
keys only for this recheck; no private message payload is copied here.

| Surface | Present | Absent or unproven | Local implementation |
|---|---|---|---|
| Message records, both samples | `id`, `direction`, `source`, `body`, `status`, `sent_at`, `created_at` | `event_id`, `guest_id`, `campaign_id`, `campaign_reference`, `invitation_id`, `recipient_name` were absent in all ten sampled records | Derive bounded narrative context through structured extraction; do not assume wire linkage. |
| Current `messageSchema`, agent-conversation-gateway.ts:647 | Same fields; optional native WhatsApp ID | No typed campaign/event/name metadata | Consume the current contract without requesting new fields. |
| Guest event lookup and event detail | Existing event ID/name/date/URL and optional attendance guest ID/state | Current campaign's inclusion is not guaranteed; original Roberto read and later guest-events probe returned no match/404 | Use unique verified detail; otherwise truthful mismatch and human help. |
| Human handoff, gateway:896 | Existing POST `/conversations/request-human`, phone input, typed success/failure | No observed case proves guaranteed human delivery or response time | Use existing operation, report only confirmed request acceptance. No new endpoint needed. |
| Email OTP, sinenvolturas-gateway.ts:532/:579 | Request/verify endpoints and typed not-found, invalid, rate-limited and failure outcomes | No separate eligibility/preflight endpoint is present in the inspected implementation | Do not probe by sending OTP. Require existing trusted account evidence; otherwise human help. |
| RSVP and quote clients | Existing write calls | No idempotency-key field/header in inspected write contract | No automatic write retries; local receipts and explicit unknown outcomes. |
| Capability manifest | Implemented/feature/gateway/environment availability and unsupported-operation handling already exist | No complete per-turn identity/resource/budget/result discriminant; provider effect tool mappings inherit planning capabilities | Extend this existing manifest, not a second capability catalog. |

Absence is proven for the sampled message responses and inspected schemas/clients,
not every possible server version. We do not claim the backend cannot support an
undocumented feature. The plan consumes only contracts actually observed here.
No new endpoint or eligibility field is invented to complete this release.

## U01 — optional sender-only name correction

**Smallest request:** change only the followup sender's greeting parameter selection.
Use the existing trusted guest name when available; otherwise a neutral greeting.
Do not use CRM display/import ordinals as a name. Do not alter the event title.
No API field or endpoint addition is requested.

**Evidence:** Tito and Maria Paz screenshots display ordinal greetings. Existing
followup records identify source `frontend_followup`. Original sender source code
is unavailable in this repository, so the precise split/name-selection expression
is not claimed verified. Approval package includes the before/after desired
examples and sender tests: numbered, numeric-only, phone-only, compound and accented
names, plus event title `¡Hola, Marcelo!`.

**Local fallback:** all agent-authored replies use neutral greetings absent a
verified name. Already-sent or future upstream templates remain outside local
control until U01 is separately approved and implemented. This limitation does
not block local release.

## U02 — optional repair of existing guest lookup coverage

**Smallest request:** reconcile the existing phone-scoped guest lookup so an
invitation visible to the followup sender/UI is represented through the existing
event and attendance-detail fields for that same authorized phone. Preserve the
current schema. Request no new campaign metadata, endpoint, authorization bypass
or write permission.

**Evidence:** Roberto's runtime extracted attending and received no usable match;
current guest-events probing returned 404 while the screenshot showed an invitation.
Maria Paz's guest-events probe returned only the historical event. The exact backend
join/normalization defect is not proven; the acceptance criterion is observable
lookup agreement for the same trusted identity, not a guessed SQL patch.

**Acceptance for external owner:** current invitation can be read with existing
IDs/detail; unrelated phones cannot access it; old records remain distinguishable;
no schema change; no duplicate invitations; existing RSVP authorization remains.
Approval precedes external source modification. This is the entire request scope.

**Local fallback:** explain the reminder as message evidence; do not list unusable
records, deny an invitation's existence, or claim attendance saved. Attempt existing
human handoff and report its real outcome. U02 is not a dependency of any local task.

## Explicitly not requested upstream

No campaign reference object, recipient-name field, new auth-eligibility API,
constituent-message-ID field, handoff endpoint, idempotency API, or changed deployment
permission is part of this plan. Existing fields and conservative local outcomes
are sufficient for the local acceptance criteria. S03 prepares only U01/U02 for
approval and performs no upstream changes.
