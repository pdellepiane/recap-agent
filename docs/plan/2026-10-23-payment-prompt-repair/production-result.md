# Production promotion — payment repair 61969c85

Date: October 23, 2026, America/Lima. AWS modification timestamp: October 24 UTC.

**Production deployment is complete.** The user explicitly authorized promotion after being informed of the public-search follow-up failure. The exact development-tested artifact was promoted; no additional repair or semantic retry was performed before production.

## Deployed state

- Runtime source `61969c85edccc4d663ee27e8cd2c2ec98c4ae945`; ZIP SHA-256 `778c8f8c9aa18193d18f17e96878427b20091e0ef44ead8f93d6f8c36237edcf`.
- Production function `recap-agent-runtime`, modified `2026-10-24T03:10:07.000+0000`; Lambda CodeSha256 `d4yPjJqhgZPRjxfpaHhCeyAJHg70Tq2Pk9b4w2I37c8=` matches development exactly.
- CloudFormation `UPDATE_COMPLETE`; Lambda `Active` / `Successful`; `DEPLOYMENT_ENV=production`; `AGENT_FEATURE_DECISIONS_ROUTER=true`.
- Reply, extraction and classifier models all `gpt-6-luna`, matching the tested development stack.
- Production uses the same OpenAI credential value that passed the development checks (compared privately, never printed).
- Production credential bindings, model parameters and existing Function URL were preserved. The only existing parameter changes were the content-addressed artifact key and enabling the tested router. The inspected change set modified the function in place; the conditional URL update referenced its unchanged ARN. No table, secret, role or function replacement was requested.
- Rollback identity retained: previous production hash `EmUdnFYbVGnHxmgjc1Rtoy+eEMuHKDSZ76ScZd0KF/0=`, modified `2026-10-02T16:05:06.000+0000`. Previous stack parameters remain in ignored local deployment evidence. No rollback was performed.
- All AWS operations used `se-dev` / `us-east-1`; STS account `684516060775` was checked before mutation. The review lock remains pending and unapproved.

## Verification and limitations

- Authenticated invalid-payload smoke: HTTP400. Unauthenticated invalid-payload smoke: HTTP401. Both used an empty object, creating no customer conversation, executing no effects and making no model calls. These establish endpoint/auth/validation health, not end-to-end customer behavior in production.
- Development targeted run `eval-2026-10-24T02-50-20-351Z-66c3cfe1`: **6/6 cases passed**, once each, concurrency one, zero judges; USD0.010769. Includes the new 14-assertion reported-payment regression, original pending-total dispute, independent question after takeover, request-scoped money isolation, public search and withdrawal/gift fees.
- Offline: typecheck and lint passed; 217 test files /1,764 tests passed, one existing skip. All 140 bundled prompt files and frozen case hashes matched source.
- Supervision completed six turns across payment and public search. Payment PASS; public search FAIL on turn2. The user then prioritized production over finishing the planned fee supervision. The three-turn targeted fee case passed on this artifact; no new fee supervision is claimed.
- New measured token/Lambda estimate: USD0.015546, comprising targeted USD0.010769 and supervision USD0.004777. Cumulative recorded estimate USD0.135591. Retrieval/storage/network and production smoke charges are outside this estimate. Additional ceiling was USD0.25.
- Prompt freshness still fails due to pending semantic review and drift. Promotion did not approve or rewrite the lock. All earlier failed evidence is retained.

## What improved

- Production now receives the pending-total guidance on the real compiler path; the former audit-only response contract did not supply it.
- Payment claims are extracted before prose and saved through takeover on the addressed request. Both the exact live regression and supervision retained claimed success with an unknown amount, followed by Yape on acceptance. Exactly one fixture takeover occurred.
- Handoff instructions no longer require repeating the payment status, total or evidence request. The observed response used first person and the confirmed receipt.
- Controlled first-turn extraction instructions shrank from 6,507 to 3,714 bytes (43%); input from 1,541 to 1,162 bytes (25%). Complete authorized profiles are preserved. Actual supervised handoff instructions shrank from 3,872 to 2,169 bytes (44%). Necessary payment guidance increased first-answer instructions from 2,209 to 2,742 bytes; the combined two payment replies fell from 6,081 to 4,911 instruction bytes (19%).
- No uniform speedup is claimed. Supervised delivered payment replies were 4.717s and 2.382s; public replies were 8.982s, 10.033s and 8.506s. These are probe wall times, not WhatsApp delivery latency. Extraction remains a latency contributor.

## Exact supervised development conversations

These are synthetic fixture reenactments through development, not real customer delivery or real backend financial effects. Full traces, stage metrics, receipts, plans, original model calls and assertions are preserved in [machine evidence](artifacts/deployment-evidence.json).

### payment — PASS

Turn 1 — 4.717s wall / 4.300s runtime.

Guest: Me acaba de llegar un mensaje por saldo pendiente del Baby Shower de prueba, pero yo ya lo pagué. ¿De dónde sale ese cobro?

Agent:

> El aviso parece venir de la compra del Baby Shower de prueba: figura pendiente por S/ 161,20. Ese importe es el total de la compra, no necesariamente un saldo por pagar; tomo en cuenta que ya la pagaste. Puedo ofrecerte que el equipo revise el pago.

Turn 2 — 2.382s wall / 1.987s runtime.

Guest: Sí, por favor. Lo pagué completo por Yape; que una persona revise por qué me llegó ese aviso.

Agent:

> Ya solicité que una persona revise por qué te llegó el aviso, aunque indicas que pagaste completo por Yape.

Turn 3 — 0.894s wall / 0.433s runtime.

Guest: Perfecto, espero entonces la revisión. Gracias.

Agent:

> (no message — deliberate human_escalation_active soft pause)

PASS: the reply acknowledged the paid-in-full report, distinguished total from unverified balance, offered review without requesting proof, executed one confirmed handoff on acceptance, retained unknown amount/Yape on that request and suppressed the acknowledgment. The first reply is still longer and more tentative than ideal, but no L1–L11 failure was found.

### public — FAIL

Turn 1 — 8.982s wall / 8.509s runtime.

Guest: Busco la boda de Valeria y Diego para ver la hora y la dirección. Mi teléfono es extranjero y no me aparece ningún evento.

Agent:

> Puedes buscar la boda de Valeria y Diego en https://sinenvolturas.com/buscar usando sus nombres.

Turn 2 — 10.033s wall / 9.650s runtime.

Guest: No tengo código ni invitación asociada a mi número. ¿Igual puedo usar ese buscador?

Agent:

> Sí, puedes usar el buscador, pero sin un código o una invitación vinculada a tu número quizá no encuentre el evento. Pide a los organizadores el enlace o código de invitación para consultar la hora y la dirección.

Turn 3 — 8.506s wall / 7.827s runtime.

Guest: Pero quiero buscar por nombres, no abrir una invitación privada. Ella es Valeria Rojas y él Diego Salazar. ¿Puedo hacerlo así?

Agent:

> Sí, puedes buscar por los nombres si el evento es público y sus anfitriones no lo ocultaron del buscador. Si no aparece, es posible que no esté publicado o que esté oculto; necesitarías pedirles el enlace directo.

FAIL, turn2: “sin un código o una invitación vinculada a tu número quizá no encuentre el evento” incorrectly ties public search to private invitation access. L1/L2/L7/L9 fail: it undermines the preceding names-based guidance and sends the customer to organizers for an unnecessary code. Turn3 recovers after the customer distinguishes public search from a private invitation. No takeover, OTP, dropped reply or fabricated event detail occurred. Disposition: open and explicitly disclosed before the user requested production; no retry or further source edit was made.

## Remaining public-search diagnosis for migration

The first event lookup miss selected the public-search module, but the next turn extracted only a FAQ request. `hasNoAssociatedEvent` was derived solely from current information results, so the public-search guidance disappeared and generic invitation FAQ material supplied a false code/association condition. This is an instruction-applicability/continuity gap, not evidence that a public event was found or that the customer needs authentication. A future repair should retain typed public-orientation context per addressed request and prevent private-invitation guidance from overriding it. That repair was not included in this production artifact.

## Local checkout preservation

The isolated managed checkout contains source and deployment records. The original checkout was not reset or overwritten. Its HEAD remains `8b69c341`; its implementation log differs from the earlier fingerprint snapshot and was left as found. The other previously fingerprinted files still match.
