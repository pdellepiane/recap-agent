# Phone-Scoped Access Decision

Date: 2026-08-24  
Status: Accepted for agent behavior; backend unlocks remain to be implemented

## Decision

Treat the verified WhatsApp sender number as a trusted, narrow-scope credential for records that were already bound to that number at invitation or checkout time. Phone scope must not become general account authentication and must not expose sensitive financial or administrative data.

Email OTP remains a step-up mechanism for account-scoped or sensitive data. It is not a viable prerequisite for accountless guests or accountless buyers. When the current API cannot satisfy an accountless request, the agent must retain the original question and request human support instead of repeatedly asking for a registered email.

## Current read contract

| Capability | Current API result | Agent decision now |
| --- | --- | --- |
| Account lookup by phone | Guest-service `user-lookup` returned not found for all five reported contacts | Do not treat this as proof that the person has no invitation or purchase |
| Account lookup by supplied email | Guest-service `user-lookup` returned not found for the reported guest/buyer emails | Do not start an unbounded alternate-email loop |
| Event association by phone | Agent API `GET /guest/events` found the expected event for Kiara, Joaquín, Delia, and Cristian | Use this read before email OTP for event questions and RSVP context |
| Event logistics by phone | Agent API exposes event metadata and can expose event detail | Answer verified event logistics without email OTP |
| RSVP state by phone | `GET /guest/events` does not expose guest ID, response state, or response timestamp | Acknowledge the event association but do not claim a stored RSVP state or perform a mutation from this result alone |
| Purchase lookup by phone | Agent purchase reads require a bearer account token and returned unauthorized without one | Preserve the question and hand off accountless buyers; do not invent purchase data |
| OTP request | Transport can return success even when the person reports no delivery | Automatically resend once, then hand off; a transport success is not proof of delivery or account access |

## Access that should be unlocked by trusted phone only

| Data or action | Phone-only | Conditions |
| --- | --- | --- |
| Associated event identity, date, city, public URL, and event logistics | Yes | The channel adapter supplies the verified sender number and the backend finds an exact invitation association |
| RSVP guest ID, current response state, response timestamp, and allowed transition | Yes | Return only the invitation bound to the trusted sender number |
| Confirm or decline attendance | Yes | Use the trusted sender number plus the backend-returned guest ID; return the authoritative final state after mutation |
| Safe purchase summary | Yes | Checkout phone matches the trusted sender number; expose only order ID, event, created date, amount/currency, high-level payment status, fulfillment status, and whether a dedication change is still eligible |
| Resend an existing confirmation to the already stored destination | Yes | Do not reveal the full destination; rate-limit and audit the action |
| Full email address, account profile, or cross-phone account data | No | Require account authentication or human review |
| Payment IDs, operation codes, bank data, destination accounts, voucher images, gateway messages, decline codes, or admin comments | No | Require step-up authentication and field-level authorization; some fields should remain human-only |
| Dedication text or other purchase mutations | No | Use a signed order link, step-up verification, or human review even when eligibility is visible by phone |
| Host finances, transfers, withdrawals, or ownership disputes | No | Account authentication and role authorization are mandatory |

## Required backend reads

Add two agent-only, read-first contracts protected by the Agent API key and the verified channel number:

1. `GET /guest/invitations?phone_extension=...&phone_number=...`
   - Return `guest_id`, event identity, `has_responded`, `will_attend`, response timestamp, and allowed RSVP transitions.
   - This closes the gap where event association exists but RSVP state is unavailable.

2. `GET /guest/purchases?phone_extension=...&phone_number=...`
   - Return only the safe purchase summary defined above.
   - Include an explicit `access_scope: phone_support_summary` and field allowlist.
   - Return typed `not_found`, `multiple_matches`, `phone_mismatch`, `rate_limited`, `unavailable`, and `failed` outcomes.

The runtime must receive the phone from the channel adapter, never from model-extracted user text. Every phone-scoped read and RSVP mutation must be rate-limited, correlated to the conversation trace, and recorded with field-level redaction.

## Interim runtime policy

- Use the existing Agent API event-by-phone read as an RSVP association fallback.
- Never convert a missing account lookup into “no invitation.”
- Never mutate RSVP from the fallback event record because it lacks guest ID and authoritative state.
- Ask for a registered email at most once for protected purchase data.
- On the first OTP non-delivery report, automatically resend once.
- On a second non-delivery report, repeated valid-code failure, unknown email, or transport/service failure, request human support immediately and retain the original question.
- If the person explicitly refuses verification, clear the protected request and stop asking for personal data; do not force a handoff.
