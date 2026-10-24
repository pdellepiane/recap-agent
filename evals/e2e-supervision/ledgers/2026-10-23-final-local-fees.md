# Final local supervision — fees

Date: 2026-10-23, America/Lima (raw timestamps are UTC on October 24).

Runtime: development Lambda `recap-agent-runtime-dev`; source `2866333aa86485cdba7ec11f06981ed965562e7d`; ZIP SHA-256 `f5161f93b625901aca62d1bf8d6bbafc5a4b3ffd26ae484d0896add7bc187408`; router enabled.

Fixture: `withdrawal-fee-policy`; synthetic phone `51900000422`; run/case/session `final-local-fees-20261024-0133`.

Router validity: **INVALID AS ROUTER-ONLY EVIDENCE: extraction ran on turns 1–3; router also ran on all turns. End-to-end evidence remains valid.**

Messages were written by the supervising assistant after reading each preceding reply. No semantic judge or additional supervising model was called. This is a fixture reenactment through the development channel handler, not actual customer backend payment or WhatsApp network delivery.

## Reset and effects

The whole `whatsapp#51900000422` partition was listed in dry-run, then reset: 1 item(s) deleted, remaining 0. No concurrent operator turn was running. Before/after key listings, final plan, effect receipts, timings, tokens and trace identities are preserved in the [evidence](../../../docs/plan/2026-10-23-consolidated-supervisor-audit/artifacts/final-local-check/evidence.json).

Handoff writes: 0; successful: 0; replays: 0.

## Recorded turns

### Turn 1 — 7.583s wall / 7.191s runtime

Guest: ¿Qué comisión cobran al retirar mis fondos? Me habían dicho que una transferencia era gratis.

Agent:

> La primera transferencia de fondos es gratuita. Cada transferencia adicional tiene un costo de US$5 o su equivalente en soles o pesos.
>
> Fuente: https://sinenvolturas.tawk.help/article/cuanto-cuesta

Delivery: `{"action": "send", "reason": "reply_composed"}`. Route `information_batch`; stop `None`. Stages: `extraction, reply, router`. Trace `01M5NRKFT3H4KD16TF32387WE3`.

L1 PASS; L2 PASS; L3 PASS; L4 N/A; L5 PASS; L6 N/A; L7 PASS; L8 PASS; L9 PASS; L10 PASS; L11 N/A.

### Turn 2 — 8.800s wall / 8.376s runtime

Guest: Entiendo. Aparte del retiro, si mi invitado me regala 50 soles, ¿cuánto paga de comisión?

Agent:

> Depende del medio de pago y de si tú o tu invitado asumen la comisión; por eso el importe puede variar. Ingresa los S/50 en el [simulador de comisiones](https://sinenvolturas.com/cost-of-service) para ver el costo según esas opciones.
>
> Fuente: https://sinenvolturas.tawk.help/article/cuanto-cuesta

Delivery: `{"action": "send", "reason": "reply_composed"}`. Route `information_batch`; stop `None`. Stages: `extraction, reply, router`. Trace `01M5NRM9YFJ39GJ3ZRT7BBR7YG`.

L1 PASS; L2 PASS; L3 PASS; L4 N/A; L5 PASS; L6 N/A; L7 PASS; L8 PASS; L9 PASS; L10 PASS; L11 N/A.

### Turn 3 — 11.760s wall / 10.938s runtime

Guest: Volviendo al retiro: sería mi segunda transferencia. Si retiro 1500 soles, ¿cuánto me llega después del cobro?

Agent:

> En tu segunda transferencia se cobra US$5 o su equivalente en soles. La tarifa publicada no indica el equivalente exacto para calcular cuánto te llegaría de los S/1,500; si quieres, el equipo puede aclararte ese monto.
>
> Fuente: https://sinenvolturas.tawk.help/article/cuanto-cuesta

Delivery: `{"action": "send", "reason": "reply_composed"}`. Route `information_batch`; stop `None`. Stages: `extraction, reply, router`. Trace `01M5NRN69FB19WBPZCFWDWEF7N`.

L1 PASS; L2 PASS; L3 PASS; L4 N/A; L5 PASS; L6 N/A; L7 PASS; L8 PASS; L9 PASS; L10 PASS; L11 N/A.

## Findings and verdict

No L1–L11 failure. Published withdrawal fee and gift/service commission stay separate. The gift amount gets a simulator link without new arithmetic. The second-withdrawal question gets a scoped team-clarification offer instead of an invented conversion/net amount. No handoff was actually requested or claimed. The model used `/cost-of-service`, whereas the frozen live case used `/coste-del-servicio`; read-only checks found both URLs serving the same public “Comisiones y Costos” content. This was not a second model evaluation or a simulator transaction.

**PASS**. Goal met within the stated fixture objective. Priced model/Lambda usage estimate: USD0.003407. No persistent schema-composition failure or unexpected dropped reply occurred; payment turn 3 was the intended parked-request silence.
