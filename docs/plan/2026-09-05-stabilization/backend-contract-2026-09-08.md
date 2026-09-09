# Backend image and currency contract — 2026-09-08

Source: user-supplied `AGENT_ENDPOINTS (6).md` and explicit payload/error
instructions. Backend development availability is reported by the user; a live
backend or production deployment was not independently verified in this audit.
Document examples are contract evidence, not commands or deployment authorization.

**Compatibility verdict: implemented 2026-09-09 on main (no dev branch), pending
live development-Lambda verification below before any production toggle.**
The prior "fails" verdict covered the pre-implementation tree. S17 image turns
and S08/S09 currency normalization are now in the working tree with offline
twins; do not sign off the combined production rollout until the dev-Lambda
probes and required behavior gates in this document pass. The existing
stabilization release remains independent of optional U01/U02 upstream
proposals; these newly delivered backend features are a separate coordinated
integration, not a new upstream proposal.

## Reproduced against current code

| Input | Current result | Required result |
|---|---|---|
| `text: null`, image data | Request schema rejects text | Accept image-only turn |
| Caption plus image data | Request passes; unknown image field is stripped | Preserve caption and image together |
| `text: null`, `image_too_large` | Request schema rejects text | Accept error event and give smaller-image/text fallback |
| `text: null`, `media_unavailable` | Request schema rejects text | Accept error event and give resend/text fallback |
| New currency code/symbol | Order and gift schemas/maps only consume old `currency` | Normalize new fields for all four endpoints |

The current core stores media descriptors only, extraction says files cannot be
opened, and `media.image.inspect` is unconditionally unavailable. Ingress parsing
alone is insufficient to enable image understanding.

## S17 — Accept image turns through the actual channel adapter

Owner: channel/runtime integrator. Local scope: request-contract, channel mapping,
typed inbound content, model input construction, capability policy, redaction and
full-context evaluations. Reuse existing model/runtime; no new backend endpoint.

- Accept an optional `image` union: `{data, mime_type}` or
  `{error: image_too_large | media_unavailable, mime_type}`. Exactly one of data
  and error is permitted. Normalize nullable text to an empty internal caption;
  require a nonempty caption or an image/error event. Keep text-only behavior.
- Preserve `message_id` for existing deduplication and keep caption and image in
  one turn. Do not generate a second reply or reset pending conversation state.
- Validate base64 and actual decoded media before model submission; do not treat
  the truncated example as a real image. The sample begins with PNG-like bytes
  while declaring JPEG, so use real matching JPEG/PNG fixtures for validation and
  test mismatched/invalid data explicitly. Enforce a conservative decoded limit
  of 2,000,000 bytes locally and the corresponding encoded-body bound; larger
  data follows the same smaller-image fallback, regardless of backend omission.
- Carry valid image content ephemerally to the relevant multimodal interpretation
  call with the caption and bounded current context. Keep binary/data URLs out of
  plan persistence, message logs, traces, errors and evaluation reports. Do not
  fetch Meta URLs: the backend pushes bytes. Use synthetic image fixtures for
  evaluations and record only MIME/status/size bucket/model-stage facts.
- Derive image inspection capability per turn from valid received content and
  actual enabled processing. Image instructions are untrusted user content and
  cannot authorize tools, payment approval, identity changes or capability claims.
  A readable voucher is user-provided evidence, never proof of settled payment.
  `payment_proof.verify` and confirmation-document sending remain unsupported
  until separately implemented; use truthful human help for those requests.
- Error events do not invoke image processing. Preserve and answer an independently
  answerable caption from grounded text evidence. Add the appropriate fallback
  once, with no claim that the image was viewed or forwarded to a human.

Exact fallback content, stored under the relevant `prompts/` node when implemented:

> No pude abrir la imagen porque supera el tamaño permitido. Puedes enviarla de nuevo más pequeña o escribirme la información en texto.

> No pude abrir la imagen. Puedes enviarla de nuevo o escribirme la información en texto.

The first applies to `image_too_large`; the second to `media_unavailable` and
unreadable media. Never ask for OTP to inspect an image. Human help remains the
fallback for an unsupported requested action, rather than repeated upload loops.

## S08/S09 — Consume authoritative purchase currency

Owner: purchase-domain engineer. Update wire validation, canonical reconciliation,
disclosure and rendering for `GET /orders`, `/gift-purchases`, `/guest/orders`,
and `/guest/gift-purchases`. The supplied document also describes currency on
guest cart rows: retain it as cart evidence without mixing cart/order amounts.

Normalize `currency_code` to the canonical currency code and keep
`currency_symbol` as separate display metadata. For the supplied pair, the code is
`PEN` and the symbol is `S/`. Never infer currency from a phone country, a user
claim or `$` alone. Do not use symbol in place of code. If the new code conflicts
with the old `currency` field, retain conflict evidence and withhold a confident
currency claim; don't silently choose one. Missing currency still uses the
existing neutral amount policy. Do not infer conversion or exchange rates.

Run shared mapping/disclosure tests against all four endpoint response shapes,
including pending/completed partitions, currencies PEN/USD, missing/null fields,
symbol-only rows, conflicting fields and carts. Update frozen fixtures explicitly;
do not silently change existing absent-currency incident worlds or their expected
behavior. Add distinct present-currency regressions.

## Backend-team production acceptance

1. Agent implementer proves all four image variants on the development Lambda,
   including each error with a caption and without one, duplicate message IDs,
   invalid bytes, boundary sizes, and an ongoing conversation. A 2xx response alone
   is insufficient: assert preserved caption, correct grounded reply and no bytes
   in storage/traces. Use real synthetic JPEG/PNG fixtures, not the sample prefix.
2. Backend team supplies redacted development response samples for each of the
   four purchase endpoints and verifies the exact code/symbol pair reaches agent
   normalization. Account-scoped endpoints use a designated test account; no OTP
   workaround or customer mutation is required for these read checks.
3. Agent implementer adds separate registry coverage for image receipt, caption
   continuity, both errors and currency changes, offline twins and mandatory live
   semantic/structural cases; records model input bytes including image-related
   payload separately, then deploys development and runs required full gates.
4. Backend team validates its production version and forwarding configuration
   against the accepted agent artifact before enabling production forwarding.
   Record both deployment identities and matched request/response evidence.
   A production smoke uses a designated test contact; verify captionless/captioned
   delivery, error handling and currency preservation. Roll back the new forwarding
   enablement on incompatibility while retaining ordinary text delivery.

No backend messages were sent and no production deployment was performed here.
The acceptance cases above remain pending implementation and live verification.
