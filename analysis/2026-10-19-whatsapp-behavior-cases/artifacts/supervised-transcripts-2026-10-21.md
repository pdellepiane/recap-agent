# Supervised end-to-end transcripts — WhatsApp behaviour dossier

Artifact for the development deployment of the Decisions router lane
(2026-10-21). Every turn below was sent to the deployed development Lambda
(`recap-agent-runtime-dev`, artifact SHA-256
`dd80f2cb71ee826bc9104bf3a48a67ea1109401e0792de31ac1186b4acb35acd`, code SHA-256
`3YDyy3HugmvJEEvzpIpn6hEJQB4Hkt4xrBGGtKyzWs0=`,
`AGENT_FEATURE_DECISIONS_ROUTER=true`).

How the turns were produced: `scripts/supervised-probe.mjs`, one turn per
invocation, against the MOCKED development fixture backend
(`backendFixture.scenario`). No real customer, no production record and no
production message was involved. The operator chose each message; the case
files' texts were not replayed verbatim, so the conversations are not the
stored cases with different wording.

Reproduce any turn with:

```bash
node scripts/supervised-probe.mjs \
  --scenario <fixture> --user-id <phone> --contact-phone <phone> \
  --run-id <run> --case-id <case> --text "<message>" [--image <file>]
```

---

## C — Mirta: refund demand on an approved gift that carries a host receipt

Fixture `purchase-approved-host-receipt-refund` (one approved purchase,
S/ 87.36, item "Cambiador portátil" worth S/ 79 as host credit, `is_thanked`
true). Phone `+51900000403`. Conversation reset before this run.

### C1 — the guest demands the refund

> **Guest:** Compré un cambiador portátil para el baby shower y quiero que me
> devuelvan el dinero, son 87 soles.

> **Agent:** Entiendo que solicitas la devolución por el cambiador portátil. La
> compra figura aprobada por S/ 87.36; el artículo aparece por S/ 79. La
> solicitud queda para revisión manual, pero no puedo confirmar que el reembolso
> se haya realizado.

| observation | value |
|---|---|
| delivery | `send` / `reply_composed` |
| node | `solicitar_agente_humano` (from `resolver_consultas_informativas`) |
| route | `human_escalation` |
| stop reason | `router_escalation:capability_blocked_threshold` |
| model stages | `router`, `reply` — no classifier, no extraction |
| timing | total 3,551 ms (router 257 ms, reply 3,113 ms) |
| takeover | attempted `true`, succeeded `true`, receipt `handoff_requested` |
| operational note | `Human takeover was requested through the Agent API.` |

What the transcript shows: the two amounts are separated and each keeps its
meaning (charged total S/ 87.36, item S/ 79), the agent states it cannot
confirm the refund happened, and the escalation is reported as done. The
escalation came from the router's own capability judgment on the FIRST turn —
a refund execution is a capability the runtime does not have.

### C2 — the guest accepts the human help

> **Guest:** Sí, por favor, que me pase una persona para que revisen mi pago.

> **Agent:** *(no message — the thread is with a human)*

| observation | value |
|---|---|
| delivery | `suppress` / `human_escalation_active` |
| stop reason | `human_escalation_soft_pause` |
| model stages | none — 66 ms, no model call |
| operational note | `Conversation is soft-paused after human escalation.` |

The takeover had already happened on C1, so the acceptance needed no second
effect: the thread is paused and a person owns it.

### Earlier arc on the same fixture (before the router parser fix)

On the first deployment the opening turn fell back to the classifier path, so
the arc was: the opening turn OFFERED the escalation ("Puedo derivar tu
solicitud para revisión manual"), the guest's acceptance on the next turn
executed the takeover (`stop_reason: router_escalation:needs_human_now_threshold`,
receipt `handoff_requested`), and the follow-up was soft-paused. That is the
offer → accept → takeover path the package specifies; the current deployment
reaches the takeover one turn earlier because the router recognises the
blocked capability immediately.

---

## D — Silvia: a reported Plin transfer against a declined card record

Fixture `purchase-declined-card-transfer-pending` (the only readable record is
a declined card attempt, S/ 403.53, `paid_at` 2026-10-19 15:31:44). Phone
`+51900000404`. The turn carries the repository's synthetic receipt image
(`evals/fixtures/images/receipt-amount-obscured.png`); the dossier screenshot is
a private customer document.

### D1 — receipt photo plus the reported transfer

> **Guest:** [receipt image] Aquí está el comprobante, ya hice la transferencia
> por Plin de S/ 391.87 para el regalo de Nicolás.

> **Agent:** Gracias por compartir el comprobante. La imagen muestra un
> comprobante, pero el monto y la fecha no se alcanzan a leer; además, no
> confirma por sí sola que el pago se haya aplicado al regalo de Nicolás.
>
> En el registro de la compra para Nicolás figura un pago rechazado de S/ 403.53
> con tarjeta, no una transferencia por Plin. Por eso, no puedo confirmar que la
> transferencia de S/ 391.87 esté asociada a esa compra. Si ya realizaste el
> pago, contacta a soporte para que lo revisen.

| observation | value |
|---|---|
| delivery | `send` / `reply_composed` |
| route | `information_batch` (support node) |
| model stages | `router`, `reply` — no classifier, no extraction |
| timing | total 5,029 ms (router 359 ms, reply 4,122 ms) |
| support outcome | signature `4090cdd8…`, `repeat_count` 1, `unresolved_money` false |
| reported payment | `391.87` / `PEN` / `Plin` / `claimed_success: true` |

What the transcript shows: the transfer is NOT confirmed, the declined record
IS cited (so the order is not denied), and the guest is pointed at a human
without one being invented. The sidecar captured the guest's claim — that
model-side signal is what makes the declined-against-reported-success outcome
deterministic on the next turn.

### D2 — terse follow-up naming a third party

> **Guest:** Ya se los mandé por correo, fue una transferencia de mi cuenta a
> nombre de Ana Cerdán.

> **Agent:** Gracias por enviar el comprobante. En el registro de la compra para
> Nicolás, el pago figura como rechazado; no puedo confirmar que la
> transferencia se haya aplicado. La información que enviaste requiere una
> revisión manual.
>
> La conversación se derivó para revisión, aunque no habías pedido hablar con
> una persona. No puedo confirmar que alguien ya se haya incorporado ni indicar
> un plazo.

| observation | value |
|---|---|
| delivery | `send` / `reply_composed` |
| route | `human_escalation` |
| stop reason | `router_escalation:capability_blocked_threshold` |
| model stages | `router`, `reply` |
| timing | total 4,956 ms (router 182 ms, reply 4,681 ms) |
| support outcome | signature `4497e46e…`, `repeat_count` 1, `unresolved_money` **true** |
| takeover | attempted `true`, succeeded `true`, receipt `handoff_requested` |

What the transcript shows: the agent says plainly that the conversation WAS
derived even though the guest never asked for a person, and it claims neither
that someone has joined nor any timeframe. That is the honest report the
`solicitar_agente_humano` contract requires, and it is the opposite of the
original dossier behaviour (nine turns of "I cannot confirm the credit").

---

## E — two approved purchases, an ambiguous request

Fixture `purchase-ambiguous-two-orders` ("Boda Comunitaria" 350.0, "Cumpleaños
Familiar" 120.5). Phone `+51900000405`.

### E1 — a request that fits both orders

> **Guest:** Compré un regalo y quiero saber en qué estado está mi pedido, ¿me
> pueden decir?

Two runs, both on the router lane, and the model chose differently:

> **Agent (run 1):** Veo dos pedidos: un juego de sábanas para «Boda
> Comunitaria» y un aporte para «Cumpleaños Familiar». ¿Cuál regalo quieres
> consultar? En el registro no aparece el estado de envío.

> **Agent (run 2):** Veo un pedido de un regalo físico: un juego de sábanas
> para la Boda Comunitaria (pedido ORD_amb-01). El pago figura aprobado, pero no
> aparece información sobre el estado del envío, así que no puedo confirmar si
> ya fue despachado o entregado.

| observation | value |
|---|---|
| delivery | `send` / `reply_composed` |
| route | `information_batch` (support node) |
| model stages | `router`, `reply` |
| timing | total 3,084 ms (router 273 ms, reply 2,650 ms) |
| takeover | none |

What the transcript shows: in run 1 the agent separated the two orders and
asked exactly one question, claiming no state for either. In run 2 it answered
about the physical gift (the guest said "un regalo", singular) and still
claimed no shipment state, and it quoted the order reference `ORD_amb-01` —
a customer-visible reference in this product (the CRM shows "Orden #307431" to
customers). The behaviour is model-dependent, which is why the ambiguity
guardrail is pinned by the deterministic twin rather than by a live case.

---

## Cost and shape of the new lane on this deployment

| | old path (classifier) | router path |
|---|---|---|
| model calls per support turn | 3 (classifier, extraction, reply) | 2 (router, reply) |
| router call | — | 182–359 ms, ~2,200 input tokens |
| extraction | 4,295–13,948 ms | 0 |
| reply | 1,741–4,681 ms | same order |
| total per turn | 9,239–28,168 ms | 3,084–5,561 ms |
| takeover evidence | `human_takeover_attempted` only on the classifier path | set on every path |
| router decision in the trace | absent | `router_decision` (route + probabilities) |
