# Conversation e-2026-10-21 — OBJ-E (two purchases, one ambiguous request)

- Date: 2026-10-21
- Runtime: development Lambda `recap-agent-runtime-dev`, artifact
  `dd80f2cb71ee826bc9104bf3a48a67ea1109401e0792de31ac1186b4acb35acd`,
  `AGENT_FEATURE_DECISIONS_ROUTER=true`
- Fixture: `purchase-ambiguous-two-orders` (phone +51900000405)
- Conversation id: `transcript-e-2026-10-21` (fixture run id and case id)
- Messages written by: the supervising agent, from the objective (not a script)

## Goal met

**yes** — no fact was attributed to the wrong purchase and no shipment state
was invented, which is what the objective requires. WHICH of the two
acceptable endings happened is model-dependent, and the objective says so.

## Turns

| # | Guest said | Agent answered | Route / stop reason | Stages | Takeover | Language |
|---|---|---|---|---|---|---|
| 1 (run 1) | Compré un regalo y quiero saber en qué estado está mi pedido, ¿me pueden decir? | Veo dos pedidos: un juego de sábanas para «Boda Comunitaria» y un aporte para «Cumpleaños Familiar». ¿Cuál regalo quieres consultar? En el registro no aparece el estado de envío. | `information_batch` / `—` | router, reply | — | L1 PASS, L2 PASS, L3 PASS, L5 PASS, L8 PASS (exactly one question), L9 PASS |
| 1 (run 2, same conversation re-run from a clean plan) | Compré un regalo y quiero saber en qué estado está mi pedido, ¿me pueden decir? | Veo un pedido de un regalo físico: un juego de sábanas para la Boda Comunitaria (pedido ORD_amb-01). El pago figura aprobado, pero no aparece información sobre el estado del envío, así que no puedo confirmar si ya fue despachado o entregado. | `information_batch` / `—` | router (273 ms), reply (2,650 ms) | — | L1 PASS, L2 PASS, L3 PASS, L5 **PASS with note** (the order reference is customer-visible in this product), L8 PASS (no question), L9 PASS |

## Language findings

| Turn | Check | Phrase | Customer-level harm | Disposition |
|---|---|---|---|---|
| 1 (run 2) | L5 | "pedido ORD_amb-01" | none — the CRM shows order numbers to customers in this product ("Orden #307431"), so an order reference the customer already has is acceptable. Recorded so the next reader does not re-open it as a defect | none |

## Verdict

**PASS WITH FINDINGS**

Both endings are acceptable under the objective, and the difference is the
model's choice, not a defect: run 1 separated the two purchases and asked
exactly one question; run 2 answered about the physical gift (the guest said
"un regalo", singular) and still claimed no shipment state. Neither run
attributed a fact to the wrong purchase.

This is why the ambiguity guardrail is pinned by the deterministic twin
(`tests/whatsapp-dossier-twins.test.ts`, twin E) rather than by a live case:
the live behaviour is model-dependent, and a live assertion on it would be a
flaky assertion. The conversation still earns its place here — it is what
shows that BOTH endings hold the contract.

Run 2 quoted the order reference. The policy-term and identifier rules were
checked against the product's own behaviour: the CRM shows order numbers to
customers, so the reference is not internal vocabulary. It is recorded rather
than treated as a defect.
