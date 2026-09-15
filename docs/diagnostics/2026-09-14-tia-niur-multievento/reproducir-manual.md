# Manual reproduction (no execution) — Tia Niur multi-event case

Reconstruct the failed turn from stored artifacts only. Do not send messages,
deploy, or run live cases from this guide.

## 1. `recentMessages`

- Open the run artifact for the failed turn (`.eval-runs/<run>/artifacts/live_lambda/*.json`).
- List inbound/outbound bodies in order. Mark which event each message is about
  (Marcelo #39361 vs FACUNDO #33912).
- Find the reminder/entry anchor: which event ID does `currentReminderForEvent`
  carry (`agent-service.ts:7038`)? If it pins #33912 while the user's explicit
  target was #39361, the anchor is suspect #1.

## 2. `operationalNote`

- Read `trace.operational_note` (may be `[omitted]` in older runs; use the newest
  run where it is captured).
- Check: does the note name an event ID? Does it agree with the reminder?
- Check the 72h/manual-check fragment: is it attached to the right event?

## 3. `rsvp_state`

- Read the persisted plan's RSVP/event state at turn start (`workingPlan`,
  `agent-service.ts:1148`): which event was `current_node`/intent scoped to?
- Read the lookup call at `:690`: which event ID went to the gateway?
- Read the outcome at `:1031`: did the turn escalate (`ofrecer_agente_humano`)
  instead of disambiguating between the two events?

## Verdict sketch

- Reminder + working plan + lookup all point at #33912 while history holds an
  explicit #39361 target → recency-wins product defect (multi-event resolution).
- Any one of the three points at #39361 but the reply used #33912 → downstream
  projection/merge defect (enrichment merge in `customer-context.ts`).
- Reply matches #39361 but judge failed it → evaluator artifact (judge packet
  lacks event labels); fix the packet, not the product.
