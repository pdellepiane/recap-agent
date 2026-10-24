# 00 — Context: Cases, Traces, Backend State

## Source dossier

- `../transcription.md` — 12 CRM screenshots + Claudia Dawson's 7
  Telegram comments in scroll order, verbatim.
- `../findings.md`, `../sources.md`, `../how-to-repeat.md`,
  `../dates/2026-10-20.md`.
- Convention: white bubble = guest; coral bubble = bot unless signed
  `— Claudia Dawson` (human takeover).

## The four cases

### A — Wilfredo 51997460648 / Giuly & Brian 24/10/2026 (2026-10-06)

Guest sent Yape receipt S/ 464.86, op 03869437, 2026-10-04. Bot denied
any linked purchase for 6 turns, asked which of two identical carts
(470893/471454, S/ 442.00 each) it belonged to, offered derivation
without effect. Human override: "tu regalo está registrado y
aprobado." CRM rail already showed approved PEN 464.86 Orden #307431.

### B — Luis Miguel 51989176370 / Michi & Chino 21/11/2026 (2026-10-19)

Guest sent page confirmation "COD309553". Bot said the code was not
associated with any order across 4 turns while confirming the approved
US$ 86.45 purchase in the same replies. Human override: "El código es
correcto." Claudia: "no se porque le dice que no existe la transaccion
con ese código si sí existe."

### C — Mirta Lopez 51992405363 / Baby Shower 17/10/2026

Runtime conversation is 2026-10-17 (Saturday), forwarded 2026-10-19.
Guest demanded refund of S/ 87.36 (item "Cambiador portátil" S/ 79,
host_credit type). Bot alternated amounts, repeated "no puedo
confirmar acreditación / quién tiene los fondos", offered derivation
~6 times; guest accepted twice; nothing happened. Escalated only at
turn 12. Claudia: should have escalated earlier; amount flips;
"no puedo confirmar que se haya acreditado" after approved payment
makes the guest infer non-delivery. Oct 19+ shows only admin_manual
human messages, zero runtime dispatches.

### D — Silvia Morales 51959609348 / Nicolás 24/10/2026 (2026-10-19)

Campaign auto-message after card decline offered bank transfer
S/ 391.87 vs Mercado Pago card S/ 398.53. Guest paid Plin S/ 391.87,
sent receipt, reported emailing proof. Bot repeated "no puedo
verificar el correo ni confirmar acreditación" 4 turns. Guest named a
third party (Ana Cerdan) as Plin account holder. No escalation.

## Trace recheck (AWS profile se-dev, us-east-1, account 684516060775)

All 32 turns have DynamoDB perf records: A=7
(2026-10-06T20:52–21:11Z), B=9 (2026-10-19T19:53–20:05Z), C=12
(2026-10-17T20:25–22:24Z), D=4 (2026-10-19T15:38–15:53Z).
31/32 route `information_batch` / `resolver_consultas_informativas`.
Exactly 2 `request_human_takeover` calls (A turn 7, C turn 12), both
successful. Audit method: bundled audit script (Agent API messages +
perf GSI + CloudWatch), plus stored OpenAI payload retrieval
(`npm run audit:openai -- --response-id <id>`).

Classifier health per turn (from perf records): C frustrated on 6
consecutive turns (22:12–22:22Z), B frustrated x2, A stalled then
frustrated, D progressing x4 (terse messages; health alone can never
catch her pattern — the repeat backstop exists for this).

Stored extraction, B COD turn
(resp_0e07207bda922dbb006ad67648f77087d187bcd71122138f40): extractor
emitted `informationRequests:[{kind:purchase, orderId:"COD309553"}]`,
`actionIntent/humanHelpIntent/supportAct` null. The denial was
constructed downstream from `referenceResolution=unavailable`.

## Backend state: at conversation time vs today (live API recheck)

Guest endpoints used: `/guest/orders`, `/guest/gift-purchases`,
`/guest/events` (implemented in
`src/runtime/agent-conversation-gateway.ts`).

- A: all 6 in-conversation reads `empty`/`completed_without_results`.
  Approved order exists today; `payment.paid_at` 2026-10-06 21:48Z —
  37 min AFTER the last bot turn. Settlement latency.
- B: guest payloads contain no `increment_id` key at all (verified on
  all 4 phones, all orders). COD unmatchable in guest lane by
  construction. Gateway maps `customerTransactionNumber` only from
  `increment_id` (agent-conversation-gateway.ts ~line 1620).
- C: approved S/ 87.36 present during conversation. `thanks` =
  "Hemos recibido tu regalo…", `is_thanked=true` — reached the reply
  model via projectPurchase, discounted by prompt policy. The ONLY
  presentation/policy failure of the four.
- D: only the declined PayU record existed during turns
  (`transaction_status: declined`, `paid_at` 2026-10-19 15:31Z).
  Pending Plin S/ 391.87 order exists today, created later.

Other backend facts: Yape `op_code` returns `"mobile-payment"`,
voucher null — receipt operation numbers (03869437) exist only in
guest screenshots. `/guest/events` returns event `stage`
(`collected` for B and C events); semantics undocumented in-repo —
do not answer money questions from it until the API owner confirms.

## Measured funnel economics (B COD turn, perf record)

classifier ~0.2 s; extraction 8,086 ms, 18,213 input bytes,
7,615 input tokens, ~20 schema properties; reply 2,838 ms,
32,276 input bytes; total runtime 13,023 ms. Of the extracted
fields, exactly one (`informationRequests`) changed any deterministic
behavior on this lane. The canonical profile is serialized into
both model calls.
