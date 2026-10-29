# Implementation Package — Decisions Router + Early Human Routing

Status: Phase A (WP0–WP6 below) implemented 2026-10-21.
Phase B (reply language) is delegated via
[FINAL-ENTRYPOINT.md](FINAL-ENTRYPOINT.md) — start there for
all remaining work. This file + 00–04 are the Phase A record.
Date: 2026-10-20, reconciled 2026-10-21.

## What this fixes

Four WhatsApp conversations where the agent looped in the FAQ node
instead of routing to a human: Wilfredo (Yape receipt), Luis Miguel
(COD309553 denial), Mirta Lopez (refund loop), Silvia Morales (Plin vs
declined card). Root cause is architectural, not wording: escalation
signals existed and were suppressed, capability-blocked tasks routed
to the one node with no tools, and a separate extraction call consumed
~8 s/turn on a lane where only 1 of its fields changed behavior.

## Reading order for the implementing agent

1. [00-context-cases-traces.md](00-context-cases-traces.md) — cases,
   turn-by-turn traces, backend state then vs now. Read first.
2. [01-architecture-decisions.md](01-architecture-decisions.md) —
   current funnel, seam audit, target funnel, policy constants.
   These decisions are final; do not redesign.
3. [02-workpackages.md](02-workpackages.md) — WP0–WP6 in order, each
   with files, steps, and objective done-criteria.
4. [03-acceptance-tests.md](03-acceptance-tests.md) — offline twins,
   live cases, commands, byte/latency gates.
5. [04-implementation-rules.md](04-implementation-rules.md) — repo
   conventions that override any conflicting instinct.

## Non-negotiables (summary; full text in 04)

- Quick wins, not an overhaul. Planning/RSVP/close/auth lanes keep
  their extractor flow. Only the customer-assistance lane changes.
- Decisions API is the router on that lane. Deterministic code owns
  thresholds, dedupe, effects, and claim gating.
- No backend-team dependency. Unmatchable money evidence escalates
  to a human; that is correct behavior, not a failure.
- Every behavior change ships with a live case + registry entry +
  targeted eval + implementation-log entry (repo law).

## Estimates

37–56 agent-hours total including tests. WP0–WP3 sequential;
WP4/WP5 parallel after WP3; WP6 last.
