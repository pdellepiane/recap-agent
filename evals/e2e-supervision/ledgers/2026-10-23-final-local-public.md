# Final local supervision — public

Date: 2026-10-23, America/Lima (raw timestamps are UTC on October 24).

Runtime: development Lambda `recap-agent-runtime-dev`; source `2866333aa86485cdba7ec11f06981ed965562e7d`; ZIP SHA-256 `f5161f93b625901aca62d1bf8d6bbafc5a4b3ffd26ae484d0896add7bc187408`; router enabled.

Fixture: `public-event-unassociated`; synthetic phone `51900000421`; run/case/session `final-local-public-20261024-0131`.

Router validity: **INVALID AS ROUTER-ONLY EVIDENCE: extraction ran on turns 1–3; router also ran on all turns. End-to-end evidence remains valid.**

Messages were written by the supervising assistant after reading each preceding reply. No semantic judge or additional supervising model was called. This is a fixture reenactment through the development channel handler, not actual customer backend payment or WhatsApp network delivery.

## Reset and effects

The whole `whatsapp#51900000421` partition was listed in dry-run, then reset: 1 item(s) deleted, remaining 0. No concurrent operator turn was running. Before/after key listings, final plan, effect receipts, timings, tokens and trace identities are preserved in the [evidence](../../../docs/plan/2026-10-23-consolidated-supervisor-audit/artifacts/final-local-check/evidence.json).

Handoff writes: 0; successful: 0; replays: 0.

## Recorded turns

### Turn 1 — 7.747s wall / 7.357s runtime

Guest: Hola, quiero saber dónde y a qué hora es la boda de Valeria y Diego. Soy prima de ella y mi teléfono es del extranjero.

Agent:

> Puedes buscar la boda de Valeria y Diego en https://sinenvolturas.com/buscar usando sus nombres. Si aparece publicada, allí encontrarás los detalles disponibles de lugar y hora.

Delivery: `{"action": "send", "reason": "reply_composed"}`. Route `information_batch`; stop `None`. Stages: `extraction, reply, router`. Trace `01M5NRGJQC6XC5DTNFS97F4DNB`.

L1 PASS; L2 PASS; L3 N/A; L4 N/A; L5 PASS; L6 N/A; L7 PASS; L8 PASS; L9 PASS; L10 PASS; L11 N/A.

### Turn 2 — 13.311s wall / 12.916s runtime

Guest: No tengo código de invitación. ¿Puedo buscarla igual aunque mi número no esté asociado?

Agent:

> Sí, puedes buscarla sin código de invitación ni número asociado. Prueba en https://sinenvolturas.com/buscar con los nombres Valeria y Diego; no encontré la boda en la búsqueda asociada a tu teléfono.

Delivery: `{"action": "send", "reason": "reply_composed"}`. Route `information_batch`; stop `None`. Stages: `extraction, reply, router`. Trace `01M5NRHDDE73EFEDNW2MSHRNP4`.

L1 PASS; L2 PASS; L3 N/A; L4 N/A; L5 PASS; L6 N/A; L7 PASS; L8 PASS; L9 PASS; L10 PASS; L11 N/A.

### Turn 3 — 8.457s wall / 8.066s runtime

Guest: Los apellidos son Rojas y Salazar y creo que es en Arequipa. ¿Con esos datos puedo buscar? No sé si el local es Molino Blanco.

Agent:

> Sí, puedes buscar sin código ni teléfono asociado en https://sinenvolturas.com/buscar. Prueba con los nombres Valeria Rojas y Diego Salazar; Arequipa o Molino Blanco también pueden servir como términos de búsqueda, pero no puedo confirmar que ese sea el lugar.

Delivery: `{"action": "send", "reason": "reply_composed"}`. Route `information_batch`; stop `None`. Stages: `extraction, reply, router`. Trace `01M5NRJAQ7PCENWPSBWHY9DJW8`.

L1 PASS; L2 PASS; L3 N/A; L4 N/A; L5 PASS; L6 N/A; L7 PASS; L8 PASS; L9 PASS; L10 PASS; L11 N/A.

## Findings and verdict

No L1–L11 failure in the supervised exchange. The required second turn answers without code/association, and the third uses added details without takeover, OTP, silence or invented venue/time. Turn 2 adds an unnecessary but accurate phone-lookup caveat. Turn 3 suggests city/venue search terms; this check did not exercise the public website search interface, so that capability suggestion is not separately established. Public source misses remain `not_found`; delivered public guidance settles the request, not the backend lookup.

**PASS**. Goal met within the stated fixture objective. Priced model/Lambda usage estimate: USD0.003278. No persistent schema-composition failure or unexpected dropped reply occurred; payment turn 3 was the intended parked-request silence.
