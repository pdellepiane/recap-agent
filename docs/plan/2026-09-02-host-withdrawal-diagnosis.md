# Host withdrawal misrouted to purchases and RSVP

Status: implementation approved on 2026-09-02; local implementation complete,
development acceptance in progress. Original diagnosis and proposal are retained
below; see `docs/implementation-log.md` for implementation decisions and results.
Evidence reviewed: 2026-09-02. Runtime baseline: `576a381c`; evaluation registration: `e1526687`.

## Interaction and evidence

Source: the supplied `PHOTO-2026-09-01-18-31-07.jpg` interaction. Diana first says
she did not buy a gift and is the bride, then asks about an event withdrawal she
has not received, then supplies the event name, Diana y Fernando.

The audit used read-only conversation history, DynamoDB performance records,
CloudWatch completion logs, stored OpenAI Responses, current source, the supplied
`AGENT_ENDPOINTS (5).md`, and two read-only searches of the configured FAQ index.
AWS identity was verified as account `684516060775` through `se-dev` in `us-east-1`.
No real customer takeover, OTP, RSVP mutation, or new deployment was performed.
Private raw audit artifacts remain ignored; this document contains only selected
diagnostic evidence, not customer phones, credentials, or financial payloads.

Three persisted turns were found on September 1:

| Lima time | Performance record | Observed decision |
| --- | --- | --- |
| 13:31:46 | `01M1F3VP3PZ8PD1AVE39FBNZ6P` | Host correction extracted; generic introduction returned. |
| 13:32:43 | `01M1F3XDBDBGA4061C36MW65G1` | Withdrawal extracted as purchase/payment-status; guest orders queried; scoped miss returned; no FAQ search. |
| 13:34:32 | `01M1F40R16MH6DF49D7RXG8XR4` | Event name extracted only as RSVP reference; invitation and guest-event lookups ran; no FAQ search. |

The stored extractor inputs contain both the host correction and withdrawal
question. The third turn also contains the pending withdrawal request in typed
plan state. All three turns persisted. This is evidence of semantic continuity
and routing failures, not proof of missing history or a lock failure. The audit
does not establish the cause of every repeated message in earlier interactions.

## Root causes and boundaries

1. **Wrong subject extracted.** The extractor emitted `kind: purchase`,
   `resource: orders`, and `aspects: [payment_status]` for a host withdrawal.
   It had the role correction available. Buyer orders cannot establish a host's
   withdrawal status, even when that host also has historical gift purchases.
2. **Pending work does not protect routing.** `hasRsvpWork` in
   `src/runtime/agent-service.ts` guards new information requests and the last
   completed request, but not pending requests. A bare `rsvpEventReference` can
   therefore divert an unresolved information question into RSVP. The failed
   withdrawal request was retained; it was not honored by the next routing step.
3. **Wrongly labeled canonical evidence.** The stored reply input already labels
   variations of Diana's guest name as `event_name`, and the operational note
   instructs the model to enumerate them. The reply did not invent these labels.
   `toUserEventSummary` in `src/runtime/sinenvolturas-gateway.ts` falls back to
   `source.name` when the nested event is absent; for a guest relationship this
   is a guest record. `lookupRsvpPhoneEvidence` promotes the result to an
   authoritative invitation. This is a concrete unsafe parser path consistent
   with the trace; the original raw user-lookup response was not retained in this
   audit, so its exact missing-field shape is not independently established.
4. **FAQ not invoked, not necessarily absent.** Neither relevant turn searched
   the FAQ. The current index contains the active article
   `atc-template-new-solicitud-de-fondos.md`: requests are processed within up to
   72 business hours, Monday–Friday 09:00–18:00. This is the host-funds article,
   not the similarly timed guest-payment-validation article. A broad query
   missed it in the top six; a focused host-funds-transfer query ranked it first
   (0.887665). Current indexing is verified, historical indexing is not.
5. **Specific withdrawal status remains unsupported.** The documented Agent API
   does not expose a withdrawal ledger, individual payout status, or bank receipt
   confirmation. Legacy event aggregate amounts do not supply those facts.
   Phone linkage or successful email verification cannot fill that capability gap.

## Proposed bounded change

- Use structured extraction to distinguish the subject of a financial question:
  guest purchase versus host funds, and general policy versus individual status.
  A reported host role is contextual evidence, not ownership authorization.
- Preserve the pending support subject and attach an event-name-only follow-up
  to it. Require explicit RSVP intent or an established RSVP selection before
  switching to invitations. Explicit user topic changes must remain possible.
- For host-withdrawal timing, search the existing FAQ with a focused semantic
  query and project only the relevant, sourced processing-window policy. Do not
  send the entire article, bank data, fees, card-fund eligibility periods, or
  operational example replies to the response model. No keyword-based routing.
- Explain the general processing window, distinguish it from confirmation of
  this particular withdrawal, and request human review for its actual status.
  Preserve the pending question and event; do not query unrelated gift orders,
  ask for OTP to access an unsupported resource, or assert an arrival deadline.
- Compose useful FAQ evidence and a required handoff in one response. Simply
  emitting FAQ plus `solicitar_humano` is insufficient: the current action-conflict
  guard can defer both, and the scoped-miss early return can bypass useful FAQ
  rendering. Define a typed policy-answer-plus-support outcome instead.
- Keep guest identity separate from event identity. Missing nested event metadata
  must remain unavailable, not become `source.name`. Reconcile only grounded
  event identifiers, suppress unrelated candidates after selection, and generate
  any selection note from the same minimal canonical projection.

Expected answer semantics: acknowledge that the user is asking about a withdrawal
from her event; explain the sourced general processing window; state that its
specific status cannot be verified through the available tools; register support
once and confirm it only if registration succeeds. Supplying the event name then
updates that same support context, without a greeting reset or invitation list.

## Required acceptance before claiming a fix

- Add the complete three-turn interaction as a mandatory live regression with
  hard routing/tool assertions and a required semantic judge, plus offline twins.
- Assert no purchase/RSVP lookup for the withdrawal topic; one relevant FAQ search;
  retained pending subject and event; honest, deduplicated handoff; no automatic OTP.
- Test general FAQ-only questions without unnecessary handoff, an explicit switch
  to RSVP, real buyer-payment questions, missing event metadata, and unavailable
  FAQ/takeover services. Assert no invented withdrawal status or arrival date.
- Test policy retrieval/projection against guest-payment articles and operational
  examples; compare changed model instruction/input bytes and prove irrelevant
  policy, raw payloads, and duplicate candidate evidence are absent.
- Register coverage, run local gates, deploy development, then run the approved
  live gate. This document does not mark those future checks as passed.

## Existing feature test, separate from this proposed fix

Retained report: `.eval-runs/eval-2026-09-01T22-13-13-503Z-3e10ac17/report.json`.
The empty-phone-purchase handoff case passed all five hard assertions and semantic
score 1.0. The overlapping-support case passed serialization and prior-plan
loading, but failed its unconditional lookup/handoff expectations because the
extractor chose support-detail continuation without a lookup. Overall: 1/2, RED.
No extra model run was needed to inspect the retained output. These cases do not
prove the host-withdrawal issue is fixed; the lock addresses a different failure.
