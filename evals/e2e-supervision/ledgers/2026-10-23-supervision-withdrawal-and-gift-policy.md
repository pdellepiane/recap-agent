# Conversation supervision-2026-10-23-withdrawal-and-gift-policy — withdrawal-and-gift-policy (published fees and calculator)

- Date: 2026-10-23
- Runtime: development Lambda `recap-agent-runtime-dev`, artifact `a38b7f5a` (ZIP SHA-256 `a38b7f5a4554110e6c4c7419a3f508a6a7df67f8e7a808f04e9158e103154fdf`; Lambda `CodeSha256` `o4t/WkVUEQ5sTHQZo/UIpqffZ/jnqAjwTpFY4QMVT98=`), `AGENT_FEATURE_DECISIONS_ROUTER=true`
- Fixture: `withdrawal-fee-policy` (phone +51900000422)
- Conversation id: `supervision-2026-10-23-withdrawal-and-gift-policy` (fixture run id and case id)
- Messages written by: the supervising agent, from the objective (not a script)
- Router validity: VALID AS ROUTER EVIDENCE — every turn ran `router` with the information-lane `extraction` and `reply`; no `classifier` stage ran.

## Goal met

yes — the published withdrawal fee was explained, and the separate gift-commission question was answered from the published rate plus the simulator without inventing a computed quote.

## Turns

| # | Guest said | Agent answered | Route / stop reason | Stages | Takeover | Language |
|---|---|---|---|---|---|---|
| 1 | Hola, ¿cuánto cobran por retirar el dinero de mi evento? | La primera transferencia de fondos de tu evento es gratuita. A partir de la segunda, se cobra US$5 o el equivalente en la moneda de la lista por cada transferencia adicional. Fuente: https://sinenvolturas.tawk.help/article/cuanto-cuesta | `information_batch` / — | router, extraction, reply | — | L1 PASS; L2 PASS; L3 PASS; L4 N/A; L5 PASS; L6 N/A; L7 PASS; L8 PASS; L9 PASS; L10 N/A; L11 N/A |
| 2 | ¿Y cuánto es la comisión por regalo si alguien aporta 50 soles? | La primera transferencia de los fondos es gratuita; cada transferencia adicional cuesta US$5 o su equivalente en soles o pesos. La comisión por regalo depende del medio de pago y de si la asume quien regala o el anfitrión. La tarifa publicada incluye 1,35% más US$1,15 o su equivalente en soles, más la comisión del medio de pago. No puedo calcular el cargo exacto para S/50; puedes simularlo en https://sinenvolturas.com/coste-del-servicio. Fuente: https://sinenvolturas.tawk.help/article/cuanto-cuesta | `information_batch` / — | router, extraction, reply | — | L1 PASS; L2 PASS; L3 PASS; L4 N/A; L5 PASS; L6 N/A; L7 PASS; L8 PASS; L9 PASS; L10 N/A; L11 N/A |
| 3 | Si retiro 500 soles, ¿cuánto me llega? | La política indica que la primera transferencia es gratuita y que cada transferencia posterior tiene un cargo de US$5 o su equivalente en la moneda de la lista. Así que, si es tu primera transferencia, recibirías los S/500 completos; si ya hiciste una anterior, se descontaría ese cargo. La fuente no precisa el equivalente exacto en soles, así que no puedo calcular cuánto recibirías en ese caso. | `information_batch` / — | router, extraction, reply | — | L1 PASS; L2 PASS; L3 PASS; L4 N/A; L5 PASS; L6 N/A; **L7 FAIL**; L8 PASS; L9 PASS; L10 N/A; L11 N/A |

## Language findings

| Turn | Check | Phrase | Customer-level harm | Disposition |
|---|---|---|---|---|
| 3 | L7 | "no puedo calcular cuánto recibirías en ese caso" | The customer asked for a net amount and the reply ends on the limitation without repeating the simulator or saying what she can do to get the exact figure. The link was given one turn earlier, but this reply is a dead end on its own. | open — the calculator pointer should accompany a refusal to compute |

## Verdict

PASS WITH FINDINGS

The published rates and the calculator boundary were correct, and no new conversion was invented. The third reply omitted the next step for the exact amount.
