# Findings — 2026-10-19 WhatsApp behavior cases

Observation-level only. No diagnosis performed; root cause is explicitly
out of scope for this pass.

## 1. Thread structure (durable)

- The 6 Telegram composites are one continuous scroll: Wilfredo batch
  (earlier day, CRM dated 2026-10-06) → `Today` divider in `[Image #2]` →
  Oct-19 batch in order Luis Miguel → Mirta Lopez → Silvia Morales.
- Claudia posted 7 commentary messages; Paolo posted 1 off-topic message.
  Verbatim texts, positions, and the divider inference are recorded in
  `transcription.md` (commentary section + map table).
- Each forwarded screenshot bubble is attributed to Claudia as forwarder;
  CRM authorship is bot unless the bubble is signed `— Claudia Dawson`
  (Wilfredo tail, Luis tail, Mirta tail).

## 2. What Claudia flagged, per case (her words, summarized without diagnosis)

- Wilfredo: `5:38 PM` intro only — "algunas interacciones extrañas"; no
  explicit verdict in-chat. Human takeover later confirmed the gift
  ("registrado y aprobado") after bot denials.
- Luis Miguel: `5:17 PM` — bot says transaction code does not exist while
  it does. Human takeover later confirmed "El código es correcto".
- Mirta Lopez: `5:44 PM` — should have been escalated earlier; same answer
  repeated; amount flips between gift value and amount paid; "no puedo
  confirmar que se haya acreditado" after an approved payment is worrying.
  `5:45 PM` — that wording makes the guest infer the gift was never
  delivered, triggering the refund demand.
- Silvia Morales: `6:28 PM` — notes the automatic post-decline message with
  payment alternatives. `6:29 PM` — first reply fine, then the same reply
  repeats instead of consulting the team; guest reads it as "we will not
  register your payment".

## 3. Recurring transcript patterns (verbatim in `transcription.md`)

- Post-receipt denial loops: bot restates "no quedó vinculado / no puedo
  confirmar acreditación" across 3–4 turns while the right rail shows an
  approved purchase (Wilfredo PEN 464.86 Ord #307431; Luis USD 86.45 Ord
  #309553) or a matching-amount receipt (Silvia Plin S/ 391.87).
- Derivation offers without confirmation: "puedo derivar… ¿confirmas que
  lo derive?" repeats while the register "no consta que se haya enviado /
  gestionado" (Wilfredo, Mirta).
- Amount alternation within one thread: S/ 79 gift value vs S/ 87.36
  charged total (Mirta); S/ 391.87 transfer vs S/ 398.53 card vs S/ 403.53
  declined charge (Silvia); S/ 464.86 paid vs S/ 442.00 per cart (Wilfredo).

## 4. Caveats for the diagnosis agent

- Three crops are truncated: Wilfredo Yape-movements capture, first Silvia
  bot bubble, last Mirta human-takeover bubble.
- `deviluciòn` (5:45 PM) reflects screenshot line-break rendering; treat as
  "devolución" with low confidence on the accent.
- No backend, CloudWatch, DynamoDB, or Responses-API evidence was pulled;
  all of that is still open.
