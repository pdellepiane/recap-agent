# Request identity and outcome implementation — 2026-10-23

This lane preserves the existing working tree. No AWS operation, deployment or paid evaluation was performed.

## Decisions and changes

- Router reference choices are bound to the exact retained request keys, namespaced as `request:<key>` so an inbound id `new` cannot collide with the new-request discriminator. The client validates the exact requested answer set, rejects unknown/duplicate names, invalid choices, duplicate/unknown probability entries and a supplied probability set missing the chosen value. Probabilities remain observational; no new thresholds were introduced.
- The router sees every retained request's key, opening-text evidence, state and turn count. The lane resolves the selected key and updates that record in place, including when it is older than the most recent answered request. The thread's confirmed handoff receipt remains an independent duplicate-effect guard.
- `request_settled` at routing is permission to inspect new resolving evidence or an explicit withdrawal, never proof that future generation succeeded. Repeated unresolved requests still escalate, while actual resolving evidence can reach composition. `request_outcome` from the existing reply call commits `answered`, `needs_input`, `unresolved` or explicit withdrawal only after successful rendering for delivery. A financial-reconciliation flag, an incomplete information outcome or pending request prevents an answer claim from settling the request. No second model call decides the prose and no prose is rewritten.
- Guest-reported payment and financial-reconciliation evidence are persisted on the addressed request. An unrelated request receives no inherited payment report. Conversation-level support outcome remains an observable latest-turn summary; it no longer settles or blocks another request. Profile-wide declined records no longer force every unrelated reply's next-step flag. Every authorized profile record remains available to extraction and reply.
- The actual reply output schema now includes all sidecar fields, including the previously omitted `claimed_handoff`. Sidecar fields are removed from the structured message before rendering.
- A new typed `information_flow` route invokes the existing structured extractor once for FAQ/event tasks, then executes those tasks through the information orchestrator with proper request IDs. The text path reuses prepared context, skips the already-redundant classifier and avoids blanket suppression of a genuinely new public question after takeover. Image information routing continues through the existing guarded native-image extraction path; it does not send images through the new text helper. Media-only unavailable content retains its prior behavior.
- Router input now distinguishes customer reports from authoritative records. Router prompts and the reply response contract no longer describe a prior open-request state as proof that current evidence cannot resolve it.

## Regression evidence

Two mandatory live candidates were added; neither was run:

- `live_behavior.returned_refund_stays_with_person`: confirmed refund takeover, unrelated authorized date answer, return to refund. Asserts one effect, no repeated handoff deltas, retained confirmed receipt and the authorized event date.
- `live_behavior.unrelated_answer_isolates_money`: financial dispute, unrelated date and its repeat. Allows a legitimate initial escalation, but requires both factual answers without a new handoff on those turns.

Deterministic twins cover retained older-key selection, payment/report isolation, actual outcome versus router prediction, explicit withdrawal, composition failure without settlement, FAQ extraction after takeover without classifier duplication, invalid selected keys and malformed answer-set/probability contracts. Existing A–D twins remain covered. Silvia now records the typed financial dispute on the first composed turn, so its next continuation escalates before a second limitation paragraph; the old retrospective signature-timing assertions were corrected accordingly.

Focused validation: 8 files, 203 tests passed, one skipped before the final extra selected-key test; typecheck and scoped lint passed. Final totals are to be taken from the root integration run after all concurrent lanes finish. Representative serialized router input measures 2943 bytes and the heavy purchase/history example 6928 bytes, using the existing input-budget tests; transport metrics continue recording exact question instruction/input bytes per call. No limits were raised.

## Limits

These changes and offline tests do not certify model routing, delivered Spanish or production behavior. Deployment identity, targeted live outcomes and supervised L1–L11 conversation evidence remain required for those claims. Historical prompt review records must not be marked approved automatically.
