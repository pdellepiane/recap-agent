# Final development deployment and focused check

Executed October 23, 2026 (America/Lima); machine evidence uses October 24 UTC.

**Development deployment completed. Four selected hard-assertion cases passed. Supervision: payment PASS WITH FINDINGS; public search PASS; withdrawal/gift policy PASS. This is not an all-behavior or production-readiness claim.**

## Source and deployment

- Source: `2866333aa86485cdba7ec11f06981ed965562e7d` (`origin/main` at the start of this continuation). All 143 changed/untracked files in the original checkout matched this commit byte for byte. Work ran in an isolated managed checkout; the original HEAD `8b69c341f6a8e50e965fa16afbc0fb427b0a8c6f` and all 143 files were verified unchanged after execution.
- Fresh archive: SHA-256 `f5161f93b625901aca62d1bf8d6bbafc5a4b3ffd26ae484d0896add7bc187408`; Lambda CodeSha256 `9RYfk7YlkBrKYtG/jWu6/FpLP/0mrkhNCJat17wYdAg=`. All 139 prompt text files matched the source; the four frozen case hashes matched.
- Before deployment: CodeSha256 `o4t/WkVUEQ5sTHQZo/UIpqffZ/jnqAjwTpFY4QMVT98=`, modified `2026-10-23T22:07:12.000+0000`. Retained as the rollback identity; no rollback was warranted or attempted.
- After deployment and final reread: CodeSha256 `9RYfk7YlkBrKYtG/jWu6/FpLP/0mrkhNCJat17wYdAg=`, modified `2026-10-24T01:27:07.000+0000`, Active / Successful, `DEPLOYMENT_ENV=development`, `AGENT_FEATURE_DECISIONS_ROUTER=true`.
- Used the repository CloudFormation deployment script with explicit artifact path/hash, profile `se-dev`, region `us-east-1`; STS confirmed account `684516060775` before mutation. Production and the review lock were unchanged. No runtime or prompt edits were made in this continuation.

## Focused live result

Run `eval-2026-10-24T01-27-46-207Z-0772f6e3`: 4/4 passed, 0 failed, 0 errored, 0 skipped; concurrency 1; one execution per case; zero semantic judges. Cost USD0.008581. The selected CLI command and case results are retained in [evidence](artifacts/final-local-check/evidence.json) and [run summary](artifacts/final-local-check/live-summary.log).

- `live_behavior.pending_total_dispute_is_reviewed` — PASS (3 hard assertions).
- `live_behavior.question_after_takeover_is_answered` — PASS (5 hard assertions).
- `live_behavior.unassociated_event_has_public_search` — PASS (3 hard assertions).
- `live_behavior.withdrawal_fee_policy_and_calculator` — PASS (5 hard assertions).

**Manual finding despite the hard-assertion pass:** the selected payment case first replied “por eso figura saldo pendiente” after describing the pending S/161.20 amount. A pending total does not establish a verified remaining balance. This is an L3/financial-grounding failure: the test’s amount/receipt assertions do not catch that inference. The next reply “La solicitud de derivación fue gestionada” is also administrative rather than natural customer-service Spanish. These failures are retained; no retry or fix was attempted.

## Full supervised conversations

Nine turns total (authorized maximum twelve), three per conversation. These are exact delivered Spanish replies from synthetic development fixture sessions. Wall time measures the HTTP probe including transport/cold-start overhead; runtime time is separately recorded. Neither is WhatsApp delivery latency. No latency comparison on matched traffic was run, so no speedup is established.

### payment — PASS WITH FINDINGS

[Qualified ledger](../../../evals/e2e-supervision/ledgers/2026-10-23-final-local-payment.md). VALID AS ROUTER EVIDENCE

**Turn 1 — 2.573s wall; 2.149s runtime.**

Guest: Hola, me llegó un aviso de saldo pendiente del Baby Shower de prueba. ¿Qué me están cobrando si ya hice mi pago?

Agent:

> Para el Baby Shower de prueba figura una compra pendiente por S/ 161,20, con pago por Yape o Plin; el pago todavía aparece como pendiente, no aprobado. Si ya lo realizaste, envíame el comprobante o el número de operación para revisar qué ocurrió.

**Turn 2 — 2.992s wall; 2.497s runtime.**

Guest: Lo pagué completo por Yape. Sí, por favor, que lo revise una persona del equipo.

Agent:

> La solicitud para que una persona revise el pago quedó derivada. El pago de S/ 161.20 por Yape o Plin figura pendiente; comparte el comprobante con el equipo para que puedan revisarlo.

**Turn 3 — 0.769s wall; 0.214s runtime.**

Guest: De acuerdo, quedo esperando que revisen ese pago.

Agent:

> (no message — deliberate parked-request soft pause)

- Turn 1: **L6 FAIL** — “Si ya lo realizaste” treats an explicit completed-payment claim as hypothetical. The customer has to repeat that she paid instead of receiving acknowledgment. **L9 FAIL** — “compra pendiente” / “el pago todavía aparece como pendiente, no aprobado” repeats the same status inside one answer and reads like record narration. The review path is useful, so L7 passes.
- Turn 2: **L9 FAIL** — “La solicitud para que una persona revise el pago quedó derivada” describes a request being processed in stiff administrative language. The next sentence asks for a receipt, so this is a language defect rather than an absent next step. The confirmed handoff makes L4 pass; no person-joined claim was made.
- State finding: `support_outcome.reported_payment` remains null after both explicit paid-in-full/Yape claims. The original opening text remains in the request, and the handoff succeeded, but structured payment-claim retention was not demonstrated. This is open, not repaired in this continuation.
- Disposition: retain the failures for the next authorized change; do not retry, edit the observed replies, or begin another improvement cycle.

### public — PASS

[Qualified ledger](../../../evals/e2e-supervision/ledgers/2026-10-23-final-local-public.md). INVALID AS ROUTER-ONLY EVIDENCE: extraction ran on turns 1–3; router also ran on all turns. End-to-end evidence remains valid.

**Turn 1 — 7.747s wall; 7.357s runtime.**

Guest: Hola, quiero saber dónde y a qué hora es la boda de Valeria y Diego. Soy prima de ella y mi teléfono es del extranjero.

Agent:

> Puedes buscar la boda de Valeria y Diego en https://sinenvolturas.com/buscar usando sus nombres. Si aparece publicada, allí encontrarás los detalles disponibles de lugar y hora.

**Turn 2 — 13.311s wall; 12.916s runtime.**

Guest: No tengo código de invitación. ¿Puedo buscarla igual aunque mi número no esté asociado?

Agent:

> Sí, puedes buscarla sin código de invitación ni número asociado. Prueba en https://sinenvolturas.com/buscar con los nombres Valeria y Diego; no encontré la boda en la búsqueda asociada a tu teléfono.

**Turn 3 — 8.457s wall; 8.066s runtime.**

Guest: Los apellidos son Rojas y Salazar y creo que es en Arequipa. ¿Con esos datos puedo buscar? No sé si el local es Molino Blanco.

Agent:

> Sí, puedes buscar sin código ni teléfono asociado en https://sinenvolturas.com/buscar. Prueba con los nombres Valeria Rojas y Diego Salazar; Arequipa o Molino Blanco también pueden servir como términos de búsqueda, pero no puedo confirmar que ese sea el lugar.

No L1–L11 failure in the supervised exchange. The required second turn answers without code/association, and the third uses added details without takeover, OTP, silence or invented venue/time. Turn 2 adds an unnecessary but accurate phone-lookup caveat. Turn 3 suggests city/venue search terms; this check did not exercise the public website search interface, so that capability suggestion is not separately established. Public source misses remain `not_found`; delivered public guidance settles the request, not the backend lookup.

### fees — PASS

[Qualified ledger](../../../evals/e2e-supervision/ledgers/2026-10-23-final-local-fees.md). INVALID AS ROUTER-ONLY EVIDENCE: extraction ran on turns 1–3; router also ran on all turns. End-to-end evidence remains valid.

**Turn 1 — 7.583s wall; 7.191s runtime.**

Guest: ¿Qué comisión cobran al retirar mis fondos? Me habían dicho que una transferencia era gratis.

Agent:

> La primera transferencia de fondos es gratuita. Cada transferencia adicional tiene un costo de US$5 o su equivalente en soles o pesos.
>
> Fuente: https://sinenvolturas.tawk.help/article/cuanto-cuesta

**Turn 2 — 8.800s wall; 8.376s runtime.**

Guest: Entiendo. Aparte del retiro, si mi invitado me regala 50 soles, ¿cuánto paga de comisión?

Agent:

> Depende del medio de pago y de si tú o tu invitado asumen la comisión; por eso el importe puede variar. Ingresa los S/50 en el [simulador de comisiones](https://sinenvolturas.com/cost-of-service) para ver el costo según esas opciones.
>
> Fuente: https://sinenvolturas.tawk.help/article/cuanto-cuesta

**Turn 3 — 11.760s wall; 10.938s runtime.**

Guest: Volviendo al retiro: sería mi segunda transferencia. Si retiro 1500 soles, ¿cuánto me llega después del cobro?

Agent:

> En tu segunda transferencia se cobra US$5 o su equivalente en soles. La tarifa publicada no indica el equivalente exacto para calcular cuánto te llegaría de los S/1,500; si quieres, el equipo puede aclararte ese monto.
>
> Fuente: https://sinenvolturas.tawk.help/article/cuanto-cuesta

No L1–L11 failure. Published withdrawal fee and gift/service commission stay separate. The gift amount gets a simulator link without new arithmetic. The second-withdrawal question gets a scoped team-clarification offer instead of an invented conversion/net amount. No handoff was actually requested or claimed. The model used `/cost-of-service`, whereas the frozen live case used `/coste-del-servicio`; read-only checks found both URLs serving the same public “Comisiones y Costos” content. This was not a second model evaluation or a simulator transaction.

## Selected-case exchanges

These are the live runner’s recorded texts. Its artifact redactor replaced the 1500 withdrawal amount with `[redacted-code]`; the unredacted supervised amounts above are retained separately. Silence is recorded explicitly.

### live_behavior.pending_total_dispute_is_reviewed

Turn 1 — 10.046s runner latency.

Guest: Me avisaron que hay saldo pendiente del Baby Shower de prueba. No entendí, ¿por qué?

Agent:

> El Baby Shower de prueba aparece con un pago de S/ 161,20 por Yape o Plin todavía pendiente; por eso figura saldo pendiente. No se muestra una fecha de pago ni una aprobación. Si ya pagaste, envíame el comprobante para revisar el caso.

Turn 2 — 2.652s runner latency.

Guest: Yo pagué todo, ¿me puedes confirmar?

Agent:

> La solicitud de derivación fue gestionada. El Baby Shower de prueba sigue figurando con el pago pendiente; este caso pasa a revisión para validar lo que indicaste. No necesitas volver a explicar el motivo por ahora.

Turn 3 — 0.573s runner latency.

Guest: Sigo esperando, que lo revise una persona del equipo por favor.

Agent:

> (no message — human_escalation_active)

### live_behavior.question_after_takeover_is_answered

Turn 1 — 4.924s runner latency.

Guest: Quiero que me pase con una persona del equipo, por favor. Es sobre la compra del regalo.

Agent:

> Ya solicité que te atienda una persona del equipo para ayudarte con la compra del regalo.

Turn 2 — 2.844s runner latency.

Guest: Gracias. Una cosa aparte: ¿qué fecha tiene el evento del regalo? Quiero confirmarla antes de viajar.

Agent:

> El evento del regalo es el 12 de diciembre de 2026. ¡Espero que te sirva para organizar tu viaje!

### live_behavior.unassociated_event_has_public_search

Turn 1 — 10.480s runner latency.

Guest: Soy prima de la novia, mi número no es peruano. Quiero confirmar hora y lugar de la boda de Alexandra Toledo y Alejandro Castillo. ¿Es en Molino Blanco?

Agent:

> No puedo confirmar la hora ni el lugar de esa boda. Puedes buscarla en la web pública en https://sinenvolturas.com/buscar usando los nombres Alexandra Toledo y Alejandro Castillo; allí podrás comprobar si será en Molino Blanco.

### live_behavior.withdrawal_fee_policy_and_calculator

Turn 1 — 12.466s runner latency.

Guest: ¿Cuánto cuestan los retiros de mis fondos? Me dijeron que el primero era gratis.

Agent:

> Sí, la primera transferencia de tus fondos es gratis. Cada transferencia adicional cuesta US$5 o su equivalente en soles o pesos.
>
> Fuente: https://sinenvolturas.tawk.help/article/cuanto-cuesta

Turn 2 — 10.573s runner latency.

Guest: ¿Y cuánto sería en soles para retirar [redacted-code]?

Agent:

> Para una transferencia adicional, la tarifa es US$5 o su equivalente en soles; no depende de que retires [redacted-code]. La fuente no publica el monto exacto en soles, así que puedo pedir al equipo que te lo confirme.
>
> Fuente: https://sinenvolturas.tawk.help/article/cuanto-cuesta

Turn 3 — 7.894s runner latency.

Guest: Otra consulta: para un regalo de 50 soles, ¿cuánto pagaría mi invitado de comisión?

Agent:

> La comisión depende del medio de pago y de quién la asuma; no hay un importe único. Para ver cuánto pagaría tu invitado por un regalo de S/50 según el medio elegido, usa la calculadora: https://sinenvolturas.com/coste-del-servicio
>
> Fuente: https://sinenvolturas.tawk.help/article/cuanto-cuesta

## Validation, cost and remaining limits

- Build: passed. Required `tests/live-behavior-coverage.test.ts`: 2/2 passed. Frozen hashes and all 139 bundled prompt files verified. The prior implementation’s complete offline suite is documented in the handoff; it was not rerun wholesale for this documentation-only continuation.
- `npm run audit:prompt-freshness` failed as expected: pending semantic review and dependency/prompt drift. The [failure output](artifacts/final-local-check/freshness.log) is retained. No approval was manufactured.
- Dependency installation reported 15 audit findings (5 moderate, 8 high, 2 critical); no dependency changes or remediation were attempted under this frozen-source check.
- New measured-usage estimate: selected cases USD0.008581 + supervision USD0.008075 = **USD0.016656**, below the additional USD0.25 ceiling. Cumulative recorded estimate including prior USD0.103389: USD0.120045, below the original USD1 ceiling. Pricing version `2026-09-25`; all nine supervised stages with recorded usage/models were priced. Recorded attempts were one per stage. No model failure with unknown failed-attempt usage was observed.
- These are usage estimates, not billing reconciliation. Supervision Lambda estimates use runtime duration; the live runner uses its recorded latency. Retrieval/storage/network charges are outside this estimate.
- Public search took 7.747–13.311 seconds wall; fees 7.583–11.760 seconds; delivered payment replies 2.573–2.992 seconds. Public/fee extraction remains a significant latency contributor.
- The supervised payment state left `reported_payment=null` despite explicit paid-in-full claims. Payment acknowledgment, total-versus-balance language, and handoff naturalness remain open. No improvement cycle was launched.
- Public and fee conversations are valid end-to-end development evidence, but **not router-only evidence** under the ledger’s strict criterion: extraction ran on all six turns alongside the router.
- No production deployment, review-lock approval, extra nine-case panel, semantic retry, additional model judge or real customer mutation occurred. Fixture handoff receipts prove fixture effects, not real customer service delivery.
- Both observed simulator URL variants were read-only checked: [cost-of-service](https://sinenvolturas.com/cost-of-service) and [coste-del-servicio](https://sinenvolturas.com/coste-del-servicio) served the public “Comisiones y Costos” page. No form submission or net calculation was performed.
