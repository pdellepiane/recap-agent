# Conversation supervision-2026-10-23-return-to-parked-refund — return-to-parked-refund (handoff, unrelated date, parked refund)

- Date: 2026-10-23
- Runtime: development Lambda `recap-agent-runtime-dev`, artifact `a38b7f5a` (ZIP SHA-256 `a38b7f5a4554110e6c4c7419a3f508a6a7df67f8e7a808f04e9158e103154fdf`; Lambda `CodeSha256` `o4t/WkVUEQ5sTHQZo/UIpqffZ/jnqAjwTpFY4QMVT98=`), `AGENT_FEATURE_DECISIONS_ROUTER=true`
- Fixture: `purchase-approved-event-date` (phone +51900000406)
- Conversation id: `supervision-2026-10-23-return-to-parked-refund` (fixture run id and case id)
- Messages written by: the supervising agent, from the objective (not a script)
- Router validity: VALID AS ROUTER EVIDENCE — every turn ran `router`; turns 1 and 2 also ran `reply`, and turn 3 was a deterministic soft pause with no reply stage.

## Goal met

yes — one confirmed handoff, the authorized unrelated date question was answered, and the return to the parked refund produced a soft pause without a second handoff.

## Turns

| # | Guest said | Agent answered | Route / stop reason | Stages | Takeover | Language |
|---|---|---|---|---|---|---|
| 1 | Necesito que una persona revise el reembolso de la compra del regalo, por favor. | He solicitado que una persona revise el reembolso. En el registro figura una compra aprobada de S/ 150 por un aporte de celebración; la revisión del reembolso queda por resolver. | `human_escalation` / `router_escalation:explicit_person_request` | router, reply | attempted + confirmed | L1 PASS; L2 PASS; L3 PASS; L4 PASS; L5 PASS; L6 PASS; L7 PASS; L8 PASS; L9 PASS; L10 N/A; L11 PASS |
| 2 | Gracias. Antes de eso, ¿me confirmas la fecha del evento del regalo? | El evento «Celebración de prueba» está programado para el 12 de diciembre de 2026. | `information_batch` / — | router, reply | — | L1 PASS; L2 PASS; L3 N/A; L4 N/A; L5 PASS; L6 PASS; L7 PASS; L8 PASS; L9 PASS; L10 N/A; L11 N/A |
| 3 | Volviendo al reembolso, ¿ya hay alguna novedad? | *(no message — soft pause)* | `human_escalation` / `human_escalation_soft_pause` | router | — | L1–L8 N/A; L9 PASS (legitimate silence for the parked request); L10 N/A; L11 N/A |

## Language findings

None. The handoff was reported as requested and confirmed, the date came from the record, and the silence on turn 3 was the parked request, not a missing answer.

## Verdict

PASS

The thread kept one confirmed handoff, answered an unrelated authorized question on the same thread, and returned to the parked refund without repeating the handoff or inventing a person.
