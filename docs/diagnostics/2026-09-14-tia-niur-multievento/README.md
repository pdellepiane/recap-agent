# Tia Niur — multi-event disambiguation failure (diagnostic package, read-only)

Status: validation registered in plan, review pending. No runtime change made here.
Date: 2026-09-14. Source of case facts: operator report (not yet cross-checked against
production logs). Repo anchors verified against HEAD `bdb4a88a` unless marked [OP].

## Summary

Contact "Tia Niur" owns invitations across 2 events. Timeline 03/09 → yesterday (1-day
horizon doctrine applies: each day starts over, but WITHIN a day the agent must keep
both events distinct). Expected: answer about Marcelo's event (#39361). Actual: agent
answered about FACUNDO's event (#33912) — wrong-event attribution, the highest-harm
grounding failure class (user info about the wrong event presented as fact).

## Timeline (operator-provided [OP], to confirm against logs on review)

- 03/09: first turn(s) about Marcelo #39361.
- …: second event (FACUNDO #33912) enters the conversation.
- Yesterday: user asks a follow-up; agent resolves the reference against FACUNDO #33912
  instead of Marcelo #39361 (recency-wins instead of explicit-target-wins).

## Expected vs actual

- Expected: response grounded in Marcelo #39361 (explicit earlier target retained).
- Actual: response grounded in FACUNDO #33912 (newest/only record auto-selected).

## Key files with lines (verified on worktree)

- `src/runtime/agent-service.ts:7038` — `recentMessages` reminder/event anchoring
  (`currentReminderForEvent`); check whether the reminder pinned FACUNDO.
- `src/runtime/agent-service.ts:1148` — `workingPlan: existingPlan`; check which
  event the working plan carried into the turn.
- `src/runtime/agent-service.ts:690` — surrounding effect/gateway closure; check
  which event ID was passed to the lookup.
- `src/runtime/agent-service.ts:1031` — `currentNode: 'ofrecer_agente_humano'`;
  check whether the turn escalated instead of disambiguating.
- `src/runtime/customer-context.ts` — S7 enrichment target selection (explicit∩known,
  old-target retention); check whether both events were enriched and which won.
- `src/runtime/information-orchestrator.ts` — linked detail fetch; check per-turn
  visited set and which event detail was fetched.
- Commits: `37c9cbad` (ambiguous support continuity coverage, verified present),
  `e8299759` (frozen production promotion), `bdb4a88a` (current HEAD).

## 5 gaps with no live case

1. Two events, same contact, same day: follow-up with an ambiguous reference must
   clarify, never auto-select the newest.
2. Explicit old target (Marcelo) after a newer event entered: old target wins.
3. Cross-event history bleed: facts/amounts from event B must never appear in an
   answer about event A.
4. Second-event question after first-event answer in the same day: both stay distinct.
5. Day boundary: next-day message starts over (no stale event carried).

## 4-step checklist (on review)

1. Reproduce manually per `reproducir-manual.md` (no execution): confirm which event
   ID sits in `recentMessages` reminder, `operationalNote`, and `rsvp_state`.
2. Classify: wrong-event grounding (product) vs judge blindness (evaluator) — the
   reply's event facts must cite scoped record IDs.
3. Author one full-context live case per gap 1–2 (additive, hard structural +
   hard `text_semantic` requireJudge:true); gaps 3–5 as offline twins first.
4. Re-gate unfiltered; promote only on green.
