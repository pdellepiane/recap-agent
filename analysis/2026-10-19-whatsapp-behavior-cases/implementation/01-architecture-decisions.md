# 01 — Architecture Decisions (final; do not redesign)

## Current funnel (verified in code)

```text
inbound → classifier preflight (respond/suppress, conversation_health,
  human_help_response) ~0.2 s
→ extractor gpt-6-luna ~8 s (actionIntent, humanHelpIntent, supportAct,
  informationRequests, planning/RSVP fields…)
→ deterministic guards → turn decision
→ information orchestrator (phone-scoped guest reads)
→ canonical profile → compose in resolver_consultas_informativas
```

Image turns bypass the classifier preflight
(agent-service.ts handleTurn line ~801 returns into handleImageTurn
before preflight). Any new router MUST be invoked from one shared
entry covering text, image, and media-only turns.

## Seam audit (each seam names its failure in the 4 cases)

1. **Classifier→routing**: `frustrated` health fired (C x6, B x2,
   A stalled→frustrated) but `hasActivePurchaseThread`
   (conversation-continuity-policy.ts:114) latches true forever once
   any purchase lookup completes, and
   `purchaseThreadSuppressesHealthOffer` (:126) forces
   `shouldOfferHelp=false`. Sensor exists; actuator disconnected.
2. **Extractor-as-router**: escalation needs `actionIntent=
   solicitar_humano` AND typed `humanHelpIntent`
   (agent-service.ts isExplicitHumanRequest ~:10741); any
   `supportAct` vetoes it. Refund demands ask for money, not a
   person, so they never qualify. 2 escalations in 32 turns.
3. **Node/tool**: `resolver_consultas_informativas` has
   `allowedTools: []` (prompt-manifest.ts nodePromptManifest) by
   design — reads pre-execute in the orchestrator. But every
   capability-blocked task (refund execution, bank/email inspection,
   COD linkage, derivation) routes there and can only be talked
   about. Derivation offers are reply prose with no typed offer
   state, so the guest's "sí" accepts nothing (C, turns 4–11).
4. **Capability**: manifest already marks `refund_or_withdrawal.
   execute`, `purchase.modify`, `confirmation_document.send` as
   `not_implemented` (capability-manifest.ts alwaysUnavailableReasons)
   but routing never consults it. `payment_proof.verify` is
   intentionally available as MODEL-MEDIATED review (see existing
   tests capability-boundary.test.ts, agent-service-information-
   flow.test.ts and implementation-log) — classify it as such; do
   NOT mark it not_implemented.
5. **Backend**: guest lane has no `increment_id`; Yape/Plin
   settlement is asynchronous. No presentation fix exists for A/B/D.
6. **Profile/judge**: reply model sees `payment` + `thanks` via
   projectPurchase (information-orchestrator.ts:3472); stored judge
   evidence projectPurchaseEvidenceItems (:287) drops payment block,
   thanks, and COD value (boolean `referencePresent` only).
7. **Handoff**: gateway, dedupe (human-help-policy.ts), soft-pause
   all work — 2/2 takeover successes. Failure is purely upstream.
8. **Amount**: `grandTotal` (charged total) vs item `rowTotal`
   (gift value) vs reported amount are distinct typed fields;
   replies alternated them unlabeled in all 4 cases.
9. **Campaign**: D's post-decline auto-message (S/ 391.87 vs
   S/ 398.53) is campaign-side, not runtime. Out of scope except
   that runtime replies must label which amount they mean.
10. **Eval**: no live case reconstructs any of these interactions.

## Decision 1 — Decisions API is the router (customer-assistance lane)

API contract (official guide, developers.openai.com/api/docs/
guides/decisions): `POST /v1/decisions`, model `gpt-6-luna`,
request `{model, input, questions[]}`; question types `predicate`
(probability 0–1), `choice`, `score`. Isolate behind one client +
config flag with fallback to the existing classifier path on API
failure; nothing downstream depends on the vendor shape.

Router questions (fixed):
- predicate `needs_human_now`
- predicate `capability_blocked` — instruction text must enumerate:
  cannot execute refunds/withdrawals, modify purchases, send
  confirmation documents, inspect bank/Yape/Plin accounts or email
  inboxes, verify a COD against a record with
  `referencePresent=false`, or prove host notification delivery.
- choice `route` ∈ {answer_with_records, ask_clarification,
  offer_human, escalate_human, rsvp_flow, planning_flow,
  suppress_ack}
- score `loop_risk` 0..4, rubric fixed: 0 progressing; 1 first
  unresolved outcome; 2 same outcome repeated; 3 repeated +
  frustration/correction; 4 repeated + explicit money-action
  demand (refund, reconciliation) still unresolved.

Router input (built deterministically in code, exact fields):
current message + image flag; last 5 message previews; profile
digest (per purchase: orderId, eventName, paymentStatus,
grandTotal, currency, referencePresent, thanksPresent,
pending/declined flags; carts: ids, subtotals); capability digest
(every operation id + available/reason + class backend_read /
model_review / effect_write / unsupported); outcomeSignature +
repeatCount; botClaimedDerivationPending bool;
turns-since-progress count.

outcomeSignature = hash of (result kind, status, sorted orderIds,
paymentStatuses, referenceResolution, coverage) per purchase turn,
stored in plan; repeatCount increments on consecutive identical
signatures, resets on any change.

## Decision 2 — deterministic policy owns effects (constants)

Escalate THIS turn if any holds:
- `needs_human_now >= 0.70`
- `loop_risk >= 3`
- `capability_blocked >= 0.80` and route ∈ {escalate_human,
  offer_human}
- backstop: `repeatCount >= 2` on an unresolved money signature
  (reference unavailable, empty-with-receipt, declined-vs-reported-
  success) — overrides router output
- route = escalate_human with `needs_human_now >= 0.50`

`offer_human` only when `loop_risk = 2` and no escalation trigger;
it sets the existing typed help-offer state the same turn so a
later accept executes. Derivation/manual-review success may be
claimed only with an in-turn gateway success receipt (existing
handoff evidence projection in reply-evidence-projector.ts).
Dedupe and soft-pause reuse human-help-policy.ts unchanged.
Delete on this lane: the `supportAct` veto, the by-name
`isExplicitHumanRequest` gate, extractor `humanHelpIntent` and
routing use of `actionIntent`. No compatibility shim (repo rule).

## Decision 3 — extractor removed from this lane, kept elsewhere

Support/FAQ/escalation turns: router → deterministic reads →
ONE compose call with structured output
`{generatedMessage, citedOrderIds, reportedPayment?}`.
Sidecar fields are validated after generation (citedOrderIds ⊆
profile orderIds) and feed next-turn signatures; they never block
or rewrite the message (Model-Written invariant).

Extractor stays for lanes where code must act BEFORE generation:
planning/provider search (query construction), RSVP writes,
close/`finish_plan`, auth/OTP selectors. Router `route` selects
those lanes; only then is `extract()` invoked. The extractor
schema loses the deleted routing fields with no shim.
A single tool-calling run replacing extract+compose on those
lanes is explicitly deferred (see README revisit trigger).

## Decision 4 — target funnel

```text
inbound (text | image | media-only, one shared entry)
→ deterministic: plan, message context, profile snapshot,
  capability digest, outcome signature/counters
→ Decisions router
→ policy:
    escalate → takeover effect → solicitar_agente_humano compose
    suppress → no delivery (existing soft-pause rules unchanged)
    answer/offer/clarify → phone-scoped reads → one compose call
    planning/rsvp/close/auth → existing extractor flow, unchanged
```

Expected replay outcomes: C escalates at first frustrated turn
(turn 6 of 12, not 12); B escalates at the "propia página"
objection turn; A and D escalate via the repeat backstop
(D's classifier never fires — this is why the backstop exists).
