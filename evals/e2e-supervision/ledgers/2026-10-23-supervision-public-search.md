# Conversation supervision-2026-10-23-public-search-without-association — public-search-without-association (unassociated event)

- Date: 2026-10-23
- Runtime: development Lambda `recap-agent-runtime-dev`, artifact `a38b7f5a` (ZIP SHA-256 `a38b7f5a4554110e6c4c7419a3f508a6a7df67f8e7a808f04e9158e103154fdf`; Lambda `CodeSha256` `o4t/WkVUEQ5sTHQZo/UIpqffZ/jnqAjwTpFY4QMVT98=`), `AGENT_FEATURE_DECISIONS_ROUTER=true`
- Fixture: `public-event-unassociated` (phone +51900000421)
- Conversation id: `supervision-2026-10-23-public-search-without-association` (fixture run id and case id)
- Messages written by: the supervising agent, from the objective (not a script)
- Router validity: VALID AS ROUTER EVIDENCE — every turn ran `router`. Turn 1 also ran the information-lane `extraction` after the router; turn 2 ran only `router` before the escalation reply failed.

## Goal met

partial — turn 1 led to public search without OTP, invented event details or private access; turn 2 escalated a search clarification and delivered no message at all.

## Turns

| # | Guest said | Agent answered | Route / stop reason | Stages | Takeover | Language |
|---|---|---|---|---|---|---|
| 1 | Hola, quiero ver los detalles de la boda de Valeria y Diego. ¿Me ayudas a ubicar el evento? | No pude ubicar un evento asociado a la boda de Valeria y Diego, así que no tengo detalles confirmados. Puedes buscar en la web pública por los nombres del evento o de los anfitriones en https://sinenvolturas.com/buscar. | `information_batch` / — | router, extraction, reply | — | L1 PASS; L2 PASS; L3 N/A; L4 N/A; L5 PASS; L6 PASS; L7 PASS; L8 PASS; L9 PASS; L10 N/A; L11 N/A |
| 2 | No tengo código de invitación, solo sé que se casan en Lima en diciembre. ¿Puedes buscar el evento con eso? | *(no message — delivery failure)* | `human_escalation` / `router_escalation:unresolved_request_repeated` | router | attempted + confirmed | **L7 FAIL**; **L9 FAIL**; L1–L6, L8, L10, L11 N/A |

## Language findings

| Turn | Check | Phrase | Customer-level harm | Disposition |
|---|---|---|---|---|
| 2 | L9 | *(no delivered text; delivery action `failure`, reason `router_escalation_composition_failed`)* | The customer asked a follow-up question and received nothing. This is not a legitimate soft pause: the turn was a public-search clarification, not the parked request. | open — escalation composition must not leave the customer silent |
| 2 | L7 | *(no delivered text)* | There is no next step because there is no reply; the customer cannot tell whether the search is still running, failed, or went to a person. | open — same failure |

## Behavioral finding

The router marked the turn as the same open request and `request_settled=false`; the record from turn 1 was `unresolved` after the associated-event search returned `not_found`. The policy therefore escalated with `router_escalation:unresolved_request_repeated` even though the guest supplied new search data rather than repeating the same question. The escalation reply then failed schema validation:

- CloudWatch request `61c958b2-b07b-4e28-8e67-6b520f4650c2`, 2026-10-23T22:13:54.809Z: `openai_stage_failed`, stage `reply`, `ModelBehaviorError`, "Invalid output type: final assistant output did not match the expected schema."
- The operational note was "typed operational failure delivered without prose"; `delivery.action=failure`, `human_escalation.status=requested`, takeover attempted and confirmed.

A public search that returned `not_found` is a completed answer, not an unresolved request that needs a person on the next follow-up. The one-turn live case `live_behavior.unassociated_event_has_public_search` covers only turn 1 and does not catch this.

## Verdict

FAIL

Turn 1 met the objective. Turn 2 produced a silent escalation: the follow-up was not answered and the customer received no message. The two findings are open and need a behaviour change plus a follow-up regression; no retry or panel expansion was performed.
