# Payment repair supervision — public

Date: 2026-10-23 America/Lima; fixture `public-event-unassociated`, phone `51900000421`, run/case/session `repair-public-20261024-0254`. Development source `61969c85edccc4d663ee27e8cd2c2ec98c4ae945`; exact artifact later promoted to production.

Messages were written by the supervising assistant after reading the prior reply. No semantic judge was called. Whole-partition dry-run and reset were saved; reset remaining=0 before the first turn.

Router validity: INVALID AS ROUTER-ONLY EVIDENCE — all three turns also ran extraction. This remains valid end-to-end evidence with the router enabled.

Turn 1 — 8.982s wall / 8.509s runtime.

Guest: Busco la boda de Valeria y Diego para ver la hora y la dirección. Mi teléfono es extranjero y no me aparece ningún evento.

Agent:

> Puedes buscar la boda de Valeria y Diego en https://sinenvolturas.com/buscar usando sus nombres.

Trace `01M5NX9FN60R4489N79TN3VNR6`; delivery `{'action': 'send', 'reason': 'reply_composed'}`; stages `extraction, reply, router`.

L1 PASS; L2 PASS; L3 N/A; L4 N/A; L5 PASS; L6 N/A; L7 PASS; L8 PASS; L9 PASS; L10 PASS; L11 N/A.

Turn 2 — 10.033s wall / 9.650s runtime.

Guest: No tengo código ni invitación asociada a mi número. ¿Igual puedo usar ese buscador?

Agent:

> Sí, puedes usar el buscador, pero sin un código o una invitación vinculada a tu número quizá no encuentre el evento. Pide a los organizadores el enlace o código de invitación para consultar la hora y la dirección.

Trace `01M5NXATEJ49ADZ376PA2NVQC0`; delivery `{'action': 'send', 'reason': 'reply_composed'}`; stages `extraction, reply, router`.

L1 FAIL; L2 FAIL; L3 N/A; L4 N/A; L5 PASS; L6 N/A; L7 FAIL; L8 PASS; L9 FAIL; L10 PASS; L11 N/A.

Turn 3 — 8.506s wall / 7.827s runtime.

Guest: Pero quiero buscar por nombres, no abrir una invitación privada. Ella es Valeria Rojas y él Diego Salazar. ¿Puedo hacerlo así?

Agent:

> Sí, puedes buscar por los nombres si el evento es público y sus anfitriones no lo ocultaron del buscador. Si no aparece, es posible que no esté publicado o que esté oculto; necesitarías pedirles el enlace directo.

Trace `01M5NXDYSEAWTJ0ZTPMHJFS677`; delivery `{'action': 'send', 'reason': 'reply_composed'}`; stages `extraction, reply, router`.

L1 PASS; L2 PASS; L3 N/A; L4 N/A; L5 PASS; L6 N/A; L7 PASS; L8 PASS; L9 PASS; L10 PASS; L11 N/A.

FAIL, turn2: “sin un código o una invitación vinculada a tu número quizá no encuentre el evento” incorrectly ties public search to private invitation access. L1/L2/L7/L9 fail: it undermines the preceding names-based guidance and sends the customer to organizers for an unnecessary code. Turn3 recovers after the customer distinguishes public search from a private invitation. No takeover, OTP, dropped reply or fabricated event detail occurred. Disposition: open and explicitly disclosed before the user requested production; no retry or further source edit was made.

Verdict: **FAIL**. Priced usage estimate USD0.003309. [Full production/check record](../../../docs/plan/2026-10-23-payment-prompt-repair/production-result.md).
