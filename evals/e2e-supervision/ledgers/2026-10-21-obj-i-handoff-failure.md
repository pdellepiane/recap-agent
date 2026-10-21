# Conversation wp-lane-c-obj-i-2026-10-21 — OBJ-I (handoff failure, then an unknown outcome)

- Date: 2026-10-21
- Runtime: development Lambda `recap-agent-runtime-dev`, artifact
  `df72d58fd03a47a0654b9484de8a92cc4fe4a9c94708eb8421ad654e655cd67f`
  (Lambda `CodeSha256` `33LVj9A6R6BlS5SE3oqSzE/kqclHCOuEIa1lTmVc1n8=` verified),
  `AGENT_FEATURE_DECISIONS_ROUTER=true`
- Fixture: TWO scenarios, TWO phones, TWO clean conversations (the objective
  asks for a clean conversation per world)
  - world A — `purchase-support-handoff-failed` (phone +51900000407),
    conversation id `wp-lane-c-obj-i-failed-2026-10-21`
  - world B — `purchase-support-handoff-unknown` (phone +51900000408),
    conversation id `wp-lane-c-obj-i-unknown-2026-10-21`
- Messages written by: the supervising agent, from the objective (not a script)
- Router validity: VALID AS ROUTER EVIDENCE — every supervised turn of both
  worlds that ran a model stage ran `router`, with only `router`/`reply`
  stages recorded (6 of 6 turns). The `classifier` milliseconds in the
  `timing ms` line are the message-context timer, not a classifier model
  stage: the probe's `model stages` field lists only stages with token usage,
  and it lists `reply, router` on every turn.
- Reset before each world: partition `whatsapp#51900000407` (0 items before,
  0 remaining after) and partition `whatsapp#51900000408` (0 items before, 0
  remaining after). Both are synthetic phones with no prior conversation.
- `scripts/reply-lint.mjs` reported **no candidate issues** on the three
  world-A replies; the findings below are the rubric's, not the lint's.

## Goal met

**partial** — in both worlds the handoff was requested for unresolved money
and the attempt is observable (`takeover.attempted: true`,
`succeeded: false`, a persisted receipt of `handoff_failed` / `outcome_unknown`,
no soft pause). The truthful-report half of the goal holds only in world B
turn 1. In world A no turn ever reported the failed request, and in world B
turns 2 and 3 replaced the truthful first answer with a claim that the case
is "pendiente de revisión manual" — a manual-review claim the runtime holds
no receipt for.

---

# WORLD A — `purchase-support-handoff-failed` (phone +51900000407)

The fixture holds one approved purchase, `ORD_support-failed-407`, S/ 180 PEN,
for "Encuentro de prueba"; the handoff gateway answers `failed`
("Fixture support handoff failed.").

## Turns — world A

| # | Guest said | Agent answered | Route / stop reason | Stages | Takeover | Language |
|---|---|---|---|---|---|---|
| 1 | Hola, hice un aporte de S/ 180 para un encuentro, pero ya no puedo ir y necesito que me devuelvan el dinero. ¿Me ayudan con la devolución? | Veo registrado el aporte de S/ 180 para el Encuentro de prueba, con pago aprobado. La solicitud de devolución no pudo gestionarse y queda pendiente de revisión manual. | `human_escalation` / `router_escalation:capability_blocked_threshold` | router, reply | attempted, **failed** (`handoff_failed`, `requested: false`, `softPaused: false`) | L1 PASS, L2 PASS, L3 PASS, L4 **FAIL**, L5 PASS, L6 PASS, L7 PASS, L8 PASS (no question asked), L9 PASS, L10 N/A (first turn) |
| 2 | Necesito que alguien me atienda esto, por favor. ¿Me pueden pasar con una persona? | Entiendo que necesitas ayuda con la devolución de tu aporte de S/ 180. En este momento no fue posible pasarte con una persona; queda pendiente de revisión manual. | `human_escalation` / `router_escalation:needs_human_now_threshold` | router, reply | **not attempted** (`last_error: failed_no_auto_retry`) | L1 PASS, L2 PASS, L3 PASS, L4 **FAIL**, L5 PASS, L6 PASS, L7 PASS, L8 PASS (no question asked), L9 PASS, L10 PASS (the turn adds a new fact: a person is not available now) |
| 3 | Entonces ¿y mi dinero qué? ¿Cuándo me devuelven los S/ 180? Necesito una fecha, aunque sea aproximada. | Entiendo que necesitas una fecha para saber qué pasará con los S/ 180. El pago figura aprobado, pero no se gestionó la derivación a una persona; tu caso queda pendiente de revisión manual. Por ahora no puedo darte una fecha de devolución. Puedo ayudarte con otra consulta mientras tanto. | `human_escalation` / `router_escalation:needs_human_now_threshold` | router, reply | **not attempted** (`last_error: failed_no_auto_retry`) | L1 PASS, L2 PASS, L3 PASS, L4 **FAIL**, L5 PASS, L6 PASS, L7 PASS, L8 PASS (no question asked), L9 PASS, L10 PASS (the turn adds a new fact: the derivation was not managed, and a next step) |

## Language findings — world A

| Turn | Check | Phrase | Customer-level harm | Disposition |
|---|---|---|---|---|
| 1 | L4 | "queda pendiente de revisión manual" | the handoff request was attempted and FAILED (`handoff_failed`, `requested: false`, `effectConfirmed: false`), so nothing is queued on a human's side. The reply tells the guest her request is waiting for a manual review, so she stops writing and waits for a refund that nobody has been asked to process. That sentence asserts a standing manual review, which is the class of claim the runtime's own gate defines as needing a gateway success receipt (`claimed_handoff`: "True only when the reply states that a human handoff or a manual review was registered"), and the deployed response contract reserves "queda para revisión manual" for the integration-not-connected case, not for a failed call | **open** — the failed outcome needs its own truthful wording; "no gestionado" is the real result and the reply must not announce a standing review |
| 2 | L4 | "queda pendiente de revisión manual" | same unsupported claim, now on the turn where the guest explicitly asked for a person. Nothing was attempted on this turn (`failed_no_auto_retry`), so the guest is told a review is pending while her explicit request produced no new attempt at all | **open** — see turn 1; root cause below |
| 3 | L4 | "tu caso queda pendiente de revisión manual" | the turn is otherwise honest ("no se gestionó la derivación a una persona"), and then the same unsupported clause contradicts it: the derivation was not managed, so the case cannot be waiting in a manual queue. The guest is left believing a refund request is in progress when the request never reached anyone | **open** — see turn 1 |

**Root cause observed for turns 2 and 3 (runtime, not prose).** When a failed
handoff is not retried, `agent-service` builds the gateway result
`{ status: 'skipped', reason: 'not_configured', message: helpDecision.reason }`
and the real reason (`failed_no_auto_retry`) survives only in
`plan.human_escalation.last_error`, which the reply model never reads. The
reply evidence therefore carries `handoff_outcome: handoff_skipped_unavailable`
and the note "Local human escalation soft-pause only: not_configured." — the
same projection the runtime uses for "the integration is not connected". The
reply model cannot distinguish *failed and not retried* from *not configured*,
and writes "no fue posible pasarte con una persona" from a state that never
existed.

**Second observation, outside the rubric but customer-visible.** The guest
asked explicitly for a person ("¿Me pueden pasar con una persona?"), and the
policy that allows a definitively failed handoff to be retried on a new
explicit inbound (`decideHumanHelpAttempt`, `explicitRetry`) is only reachable
through `isExplicitHumanRequest(plan, extraction)`. The router lane runs no
extraction, so the explicit retry can never fire on this lane: her explicit
request is answered with "no fue posible" and no attempt is made.

## Verdict — world A

**FAIL**

The world produced the failure it exists to expose, and it produced it
cleanly: the handoff failed, nothing was soft-paused, no person was claimed
to have joined, the escalation was never claimed as confirmed and the case
was never claimed as closed — the three failures the objective watches for
did NOT occur. What did not hold is the truth of the report. In all three
turns the reply announces a standing manual review ("queda pendiente de
revisión manual") that no receipt backs, and on the two turns where the guest
asked again the runtime made no attempt at all. The guest cannot tell a
refund request that is in a queue from one that was never delivered, so she
waits.

---

# WORLD B — `purchase-support-handoff-unknown` (phone +51900000408)

The fixture holds one approved purchase, `ORD_support-unknown-408`, S/ 210 PEN,
for "Reunión de prueba"; the handoff gateway answers `unknown` ("Fixture
handoff outcome is unknown; no automatic retry.").

## Turns — world B

| # | Guest said | Agent answered | Route / stop reason | Stages | Takeover | Language |
|---|---|---|---|---|---|---|
| 1 | Hola, hice un aporte de S/ 210 para una reunión y quiero que me devuelvan el dinero. ¿Me pueden ayudar con la devolución? | Hola, veo registrado un aporte de S/ 210, con pago aprobado, para la reunión. El caso requiere revisión humana, pero el estado de la derivación no está confirmado; por ahora, no necesitas hacer nada más aquí. | `human_escalation` / `router_escalation:capability_blocked_threshold` | router, reply | attempted, **unknown** (`outcome_unknown`, `requested: false`, `softPaused: false`) | L1 PASS, L2 PASS, L3 PASS, L4 PASS, L5 PASS, L6 PASS, L7 PASS, L8 PASS (no question asked), L9 PASS, L10 N/A (first turn) |
| 2 | Quiero que alguien me escriba para hablar de esto. ¿Ya quedó derivada mi solicitud o la tengo que volver a mandar? | Tu solicitud no quedó derivada: en este momento no está disponible la gestión con una persona. No hace falta que la vuelvas a enviar; queda pendiente de revisión manual. | `human_escalation` / `router_escalation:needs_human_now_threshold` | router, reply | **not attempted** (`last_error: unknown_stays_unretried`) | L1 PASS, L2 PASS, L3 PASS, L4 **FAIL**, L5 PASS, L6 PASS, L7 PASS, L8 PASS (no question asked), L9 PASS, L10 PASS (the turn adds a new instruction: do not resend) |
| 3 | ¿Y si al final no aparece en esa revisión manual qué hago? ¿Vuelvo a escribir mañana o ya no tiene caso? | La derivación no se pudo gestionar y queda pendiente de revisión manual. Si no recibes respuesta o no aparece en esa revisión, vuelve a escribir por este canal para dar seguimiento; no hace falta esperar hasta mañana. | `human_escalation` / `router_escalation:loop_risk_threshold` | router, reply | **not attempted** (`last_error: unknown_stays_unretried`) | L1 PASS, L2 PASS, L3 PASS, L4 **FAIL**, L5 PASS, L6 PASS, L7 PASS, L8 PASS (no question asked), L9 PASS, L10 PASS (the turn adds a new instruction: write again for follow-up) |

## Language findings — world B

| Turn | Check | Phrase | Customer-level harm | Disposition |
|---|---|---|---|---|
| 2 | L4 | "queda pendiente de revisión manual" + "No hace falta que la vuelvas a enviar" | turn 1 said the state of the derivation was not confirmed; turn 2 resolves that unknown in the guest's favour — it tells her the case IS pending a manual review AND tells her not to send it again. The request may never have been delivered (`outcome_unknown`, `requested: false`), so the guest is told to stop asking for the one thing that would make her case exist | **open** — an unknown outcome must stay unknown in the reply; the "no resends" instruction compounds it |
| 3 | L4 | "La derivación no se pudo gestionar" + "queda pendiente de revisión manual" | the same sentence resolves the unknown the other way: it states a definite failure for an outcome the runtime cannot resolve ("the outcome is unknown; no automatic retry"). The guest is told her escalation definitely failed when it may in fact have reached someone — and, worse, she is then told to wait for a manual review that the same sentence says does not exist | **open** — same root cause as world A turns 2–3: the runtime's reply evidence collapses *unknown* and *not configured* into one skipped fact, so the reply can only pick one of the two |

## Verdict — world B

**PASS WITH FINDINGS** (goal met on turn 1, regressed on turns 2 and 3)

Turn 1 is the wording the objective asks for and the runtime can produce:
"El caso requiere revisión humana, pero el estado de la derivación no está
confirmado" — the review is needed, the request is NOT confirmed delivered,
no person is claimed, nothing is promised, no timeframe, no closure, and the
money facts are stated plainly (S/ 210, approved). That sentence alone is the
reference for what the failed world should have said.

Turns 2 and 3 are where it is lost, and the loss is not the model's alone:
the runtime's own state for both turns is the skipped projection
("not_configured"), while the plan holds the true reason
(`unknown_stays_unretried`). The guest's follow-up questions get answers that
contradict turn 1 — "no quedó derivada", "no se pudo gestionar",
"queda pendiente de revisión manual" — so on the same thread the guest is
first told the state is unconfirmed, then told it failed, then told it is
pending a review, and finally told to write again in case it never appears.

---

## Verdict

**FAIL** (the ledger as a whole; world A FAIL, world B PASS WITH FINDINGS)

Both worlds did what the objective needed from the BACKEND: the handoff was
requested for unresolved money, the attempt is observable, the outcome is
persisted, and nothing was soft-paused. The three customer-level failures the
objective watches for — a person claimed to have joined, an escalation claimed
as confirmed, a case claimed as closed — did not occur in any of the six
turns, and no reply put a second money verdict next to the handoff
announcement (L1 clean on all six).

The goal that was not met is the truthful report. Five of the six turns
announce a standing manual review that no receipt supports, and the one
clean turn (world B, turn 1) is undone by the two turns after it. The
sentence that carries the defect — "queda pendiente de revisión manual" —
is the class of claim the runtime's own gate defines as a manual-review
success claim: `claimed_handoff` is "True only when the reply states that a
human handoff or a manual review was registered", and the gate refuses a
success claim that has no in-turn gateway success receipt. The model declared
no such claim in its sidecar, and the unsupported prose went out anyway.

Two runtime seams produced the defect and both are visible in the probe
output, not inferred:

1. the skipped projection collapses *failed-and-not-retried*,
   *unknown-and-not-retried* and *integration-not-connected* into one
   `handoff_skipped_unavailable` fact, so the reply model writes from a state
   that never existed;
2. the explicit-retry policy is reachable only through the extraction, which
   the router lane does not run, so a guest who explicitly asks for a person
   after a failed handoff gets no new attempt and no explanation of why.

The finding is not the wording; it is that the runtime cannot tell the reply
model which of the three states it is in.
