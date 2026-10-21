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
