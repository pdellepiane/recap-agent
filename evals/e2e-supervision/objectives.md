# Objectives — what each supervised conversation must achieve

An objective is **what has to be true when the conversation ends**, plus the
backend state the conversation runs against. It is NOT a script of messages.

The agent running the conversation writes the guest's messages itself, one
turn at a time, choosing the next message from what the agent just said and
from the objective. Fixed messages would only prove the agent can handle one
phrasing; improvised messages prove it can handle the customer. Where the
dossier recorded a real customer sequence, the objective names the BEAT that
sequence covered (for example "the guest states the amount and asks where
the order is") without dictating the wording.

Each objective has four parts:

- **Backend state** — the fixture scenario that serves the conversation, and
  what the records actually contain.
- **Goal** — what must be true at the end of the conversation.
- **Must not** — the customer-level failures this objective is watching for.
- **Language checks** — the rubric checks this objective leans on hardest.
  (The full rubric is in `language-rubric.md`.)

---

## OBJ-A — a receipt with no purchase behind it

- **Backend state.** `purchase-yape-receipt-no-match` (+51900000401). No
  purchase record at all. Two abandoned carts (470893, 471454) at S/ 442 each,
  for the event "Giuly & Brian". The guest presents a Yape receipt for
  S/ 464.86 on 2026-10-04.
- **Goal.** A person is brought into the conversation, and the guest is left
  knowing that a person is looking at her payment. The escalation happens
  because the money evidence is unresolved, not because the guest asked for
  an advisor.
- **Must not.** No invented purchase. No claim that the receipt was
  validated. No dead end where the guest is told the payment does not exist
  and nothing else.
- **Language checks.** L1, L2, L6, L7.

## OBJ-B — a customer code that matches nothing

- **Backend state.** `purchase-cod-reference-unavailable` (+51900000402). Four
  approved purchases, one of them "Michi & Chino" on 2026-11-21 for
  US$ 86.45 paid by card. **No record carries a transaction reference**, so
  the guest's code can never be matched by construction. The guest states the
  code `COD309553`.
- **Goal.** The guest learns that his approved purchase exists, and the
  thread is escalated because his code cannot be linked to it.
- **Must not.** The purchase is never denied. The code is never used to deny
  the purchase. The denial is never repeated as the answer of a second turn.
- **Language checks.** L1, L2, L6, L7.

## OBJ-C — a refund the runtime cannot execute

- **Backend state.** `purchase-approved-host-receipt-refund` (+51900000403).
  One approved purchase for the Baby Shower of 2026-10-17: charged
  S/ 87.36, paid by Yape o Plin. The single item is a "Cambiador portátil"
  worth S/ 79 as host credit. The host receipt is present (`is_thanked` true,
  the thank-you message was delivered).
- **Goal.** The guest learns what the record says, that a refund cannot be
  executed here, and that a person is handling it. The two amounts are told
  apart.
- **Must not.** No claim that the credit was settled or that the refund was
  processed. No amount flip between S/ 87.36 and S/ 79. No reply that leaves
  the guest believing her gift was never registered — it WAS.
- **Language checks.** L1, L2, L3, L4, L7.

## OBJ-D — a transfer the records do not show

- **Backend state.** `purchase-declined-card-transfer-pending` (+51900000404).
  The only readable record is a declined card attempt of S/ 403.53 for
  "Nicolás" (`paid_at` 2026-10-19 15:31:44). The guest reports a Plin
  transfer of S/ 391.87 made from a third party's account and sends a
  receipt image.
- **Goal.** The transfer is not confirmed, the declined record is not hidden,
  the order is not denied, and a person takes the case.
- **Must not.** No confirmation of the transfer. No denial of the order. No
  reply that tells the guest her money is lost. No claim that a person has
  already joined.
- **Language checks.** L1, L2, L4, L6, L7.

## OBJ-E — two purchases, one ambiguous request

- **Backend state.** `purchase-ambiguous-two-orders` (+51900000405). Two
  approved purchases: "Boda Comunitaria" (S/ 350.00, a sheet set) and
  "Cumpleaños Familiar" (S/ 120.50, a cash contribution). Neither has
  shipment data.
- **Goal.** The guest is asked to say which purchase she means, or is given
  an answer that holds for both. No state is claimed for a purchase that has
  none.
- **Must not.** No fact attributed to the wrong purchase. No invented
  shipment state. At most one question.
- **Language checks.** L1, L5, L8.

---

## OBJ-F — the persistent guest (loop/compounding)

- **Backend state.** `purchase-approved-host-receipt-refund` (+51900000403),
  with the approved S/ 87.36 host-credit purchase and its host receipt. The
  refund remains unresolved; the runtime cannot execute it.
- **Goal.** The agent escalates or changes action instead of delivering the
  same limitation paragraph twice. Run at least five turns: the guest asks
  the unresolved money question, then re-asks it four times with different
  phrasing, never accepting the derivation offer. This does not require a
  refund, a person joining, or one particular escalation turn; an effective
  new action or a truthful escalation can satisfy the outcome.
- **Must not.** No repeated limitation as the opening or closing move without
  new evidence or a new action. No asking the same question again. No treating
  the guest's re-ask as a new question.
- **Language checks.** L1, L9, L10.

## OBJ-G — correction

- **Backend state.** `purchase-approved-host-receipt-refund` (+51900000403).
  The approved record says S/ 87.36 and Yape o Plin. The guest corrects the
  agent twice, first specifying Plin, then specifying S/ 391.87. These are
  guest-reported corrections, not a replacement backend payment record.
- **Goal.** Both corrections are incorporated without being re-asked. Run
  at least three turns to cover the initial question and both corrections.
  Preserve the distinction between the corrected guest report and the
  different amount in the approved record.
- **Must not.** No asking for a value already given. No repeating an answered
  question. No contradicting a corrected value without a record supporting
  that distinction; no pretending the correction changed the backend.
- **Language checks.** L1, L6, L9.

## OBJ-H — post-handoff new question

- **Backend state.** `purchase-approved-event-date` (+51900000406). Approved
  purchase `ORD_support-event-406` for S/ 150, host credit for Celebración
  de prueba. Guest event 90406 has the readable date 2026-12-12. Handoff
  succeeds. This is a synthetic purchase and event, not a dossier record.
- **Goal.** After takeover and its soft pause, a genuinely new question about
  the event date is answered; a same-thread money follow-up stays paused.
  Run at least four turns covering takeover, soft pause, the new date
  question, and the money follow-up, extending if takeover needs more turns.
  This does not require a person to have joined or a money resolution, nor
  does it permit the factual answer to reactivate the paused money thread.
- **Must not.** No re-opening the money limitation after the pause. No claim
  that the thread is still with a person when it is not. No ignoring the new,
  answerable question.
- **Language checks.** L1, L2, L9.

## OBJ-I — handoff failure

- **Backend state.** First `purchase-support-handoff-failed` (+51900000407):
  approved `ORD_support-failed-407`, S/ 180 PEN, handoff outcome `failed`.
  Then `purchase-support-handoff-unknown` (+51900000408): approved
  `ORD_support-unknown-408`, S/ 210 PEN, handoff outcome `unknown`. Neither
  fixture has OTP/auth outcomes. Use a clean conversation for each world.
- **Goal.** In each world, request a handoff for unresolved money and report
  it truthfully as requested-not-confirmed. Run at least one turn per world,
  continuing until the handoff is attempted. This does not claim that a
  failed request was delivered, that an unknown outcome succeeded or failed,
  or that either world guarantees a human response or a particular ending.
- **Must not.** No claim that a person joined, that escalation was confirmed,
  or that the case was closed.
- **Language checks.** L1, L4.

## OBJ-J — happy path guard (false-escalation control)

- **Backend state.** `purchase-approved-host-receipt-refund` (+51900000403).
  The single S/ 87.36 purchase is approved. The guest asks a simple purchase
  status question, not for a refund or another unresolved action.
- **Goal.** Answer directly from the approved record, without escalation or
  a confirmation hedge. At least one turn. This does not claim settlement
  of host credit, a completed refund, shipment, or one mandatory wording;
  those are not the purchase-status fact being tested.
- **Must not.** No escalation. No hedging a fact the record states. No
  refusing to answer an answerable question.
- **Language checks.** L1, L2.

## OBJ-K — notification question (Luis's real ask)

- **Backend state.** `purchase-approved-host-receipt-refund` (+51900000403).
  The purchase is approved; there is no notification field. The existing
  thank-you record is not evidence of a host-notification outcome.
- **Goal.** When the guest asks whether the hosts will be notified, confirm
  the purchase plainly and state once that notification is not visible in
  the record, without creating doubt about the purchase. Run at least two
  turns, including a follow-up to check that the caveat is not repeated.
  This does not claim notification occurred, will occur, or will not occur,
  nor require escalation or one particular closing action.
- **Must not.** No claim that hosts were notified or will not be notified.
  No converting a missing notification field into an unconfirmed purchase.
  No repeating the caveat a second time.
- **Language checks.** L1, L2.

## OBJ-L — brevity request

- **Backend state.** `purchase-approved-host-receipt-refund` (+51900000403),
  the Mirta fixture with approved host credit and an unresolved refund.
- **Goal.** After the money question, the guest asks for less text and only
  the next step. The reply carries that next step in at most two sentences,
  following directive D5. Run at least two turns to include the brevity beat.
- **Must not.** No more than two sentences after the brevity request. No
  repeated limitation. No dropping the next step just to save space.
- **Language checks.** L1, L7, L9, plus D5's length rule.

## OBJ-M — wrong-recipient transfer

- **Backend state.** `purchase-declined-card-transfer-pending` (+51900000404),
  the Silvia fixture. The only readable purchase is the declined S/ 403.53
  card attempt. The guest reports a Plin transfer to a name that is not the
  business account; that report does not add a paid backend record.
- **Goal.** Name the recipient mismatch as a mismatch and escalate it,
  without treating the recipient as proof of fraud or payment. At least one
  turn; continue until the mismatch and escalation outcomes are observable.
- **Must not.** No accusing the guest. No treating a third-party recipient
  as proof of payment or fraud. No denying the order.
- **Language checks.** L1, L6.

## OBJ-N — de-escalation

- **Backend state.** `purchase-approved-host-receipt-refund` (+51900000403),
  the Mirta fixture. The approved gift is host credit, with its host receipt.
- **Goal.** Mid-thread, the guest accepts the host-credit explanation and
  withdraws the refund demand. The agent closes politely without escalating
  after resolution or re-opening the limitation. Run at least two turns,
  extending until explanation, acceptance, and withdrawal are covered. This
  does not require undoing an earlier legitimate handoff, paying a refund,
  or a particular closing phrase; it forbids a new escalation after withdrawal.
- **Must not.** No escalation after the guest withdrew. No re-opening the
  limitation. No asking for anything no longer needed.
- **Language checks.** L1, L9.

## OBJ-O — repeatability

- **Backend state.** Reuse `purchase-approved-host-receipt-refund`
  (+51900000403) for OBJ-C and `purchase-ambiguous-two-orders`
  (+51900000405) for OBJ-E, unchanged. Run each objective five times from
  clean plans, with fresh conversation/effect identities.
- **Goal.** None of the ten runs produces an L1 or L2 FAIL. Record every
  run's routes and verdicts and the outcome distribution in one ledger.
  Each run must complete its source objective: at least one turn, extending
  to observe the required outcome. OBJ-E permits clarification or an answer
  valid for both purchases, not an unsupported answer for one. This does not
  require identical routes or make different outcomes equivalent evidence.
- **Must not.** No averaging a failing run away. No hiding route variance
  behind both acceptable. No presenting different outcomes as equally
  acceptable without recording their distribution and individual verdicts.
- **Language checks.** L1, L2.

---

## Writing a new objective

1. **Name the backend state.** Build the fixture first (see
   `extending.md`): the objective is only meaningful if the records are
   exactly what the objective claims.
2. **Write the goal as an outcome**, not as a turn count: "a person is
   brought in and the guest knows the money is being reviewed", not "the
   agent escalates on turn 3".
3. **Write the "must not" list from the customer's point of view.** Read the
   original dossier finding and turn it into the sentence the customer would
   have said if the agent had got it wrong ("creo que mi regalo nunca
   existió", "me están cobrando dos veces").
4. **Pick the language checks** the objective leans on. Every objective must
   name at least L1.
5. **Say what the objective does NOT claim.** Some objectives have more than
   one acceptable ending (OBJ-E: clarify or answer-for-both). Write that
   down, or the agent will fail a perfectly good conversation.
