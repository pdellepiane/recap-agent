# Language rubric — qualifying what the customer actually reads

The structural assertions of the live cases prove that the RIGHT EFFECT
happened. They say nothing about what the customer read. A reply can escalate
correctly, record a real receipt, and still leave the customer convinced that
their order does not exist.

**The agent that runs the conversation is the one that applies this rubric.**
There is no judge, no semantic scorer and no second model. The rubric is
applied per turn, as the conversation runs, by the same agent that chose the
guest's messages. A verdict that is written down is a verdict the agent
reached by reading the reply, not a score another model produced.

Every check is answered for every reply: **PASS**, **FAIL**, or **N/A** (the
check does not apply to this turn). A FAIL carries a one-line reason quoting
the offending phrase, and it names the customer-level harm.

---

## L1 — One reading per turn

**The rule.** A reply must leave the customer with exactly ONE consistent
understanding of the situation. Two incompatible readings in the same message
are a failure even when every sentence is individually true.

**The canonical failure (dossier case D, turn 2).** The reply said:

> "…el pago figura como rechazado; no puedo confirmar que la transferencia se
> haya aplicado. La información que enviaste requiere una revisión manual.
> La conversación se derivó para revisión…"

Read together, the customer cannot tell whether the order exists. "El pago
figura como rechazado" says the payment failed, "no puedo confirmar que la
transferencia se haya aplicado" says the money is unaccounted for, and "se
derivó para revisión" then adds a third frame. A customer who wanted a
refund because she believes the order never existed now has three reasons to
believe the order never existed AND a handoff she did not ask for, and no
clear picture of what happens to her S/ 391.87.

**What a PASS looks like.** When the turn hands the conversation to a human,
the verified facts and the handoff are stated together, and the UNRESOLVED
part is left with the human instead of being announced as a second verdict:

> "La compra para Nicolás figura con un pago rechazado y tu transferencia por
> Plin no aparece asociada a ese registro. Ya solicité que una persona del
> equipo revise el caso; la revisión queda pendiente."

One reading: the record says X, a person is looking at it, nothing is
required from the customer right now.

**Also FAIL.** Two true statements that cannot both be the customer's
situation (for example "your payment was approved" and "I can't find your
purchase" in the same reply), or a reply that states a verdict and then walks
it back.

---

## L2 — No unfounded negative

**The rule.** The reply must not tell the customer that something is missing,
does not exist, or is unconfirmed when the record shows otherwise.

**Dossier failures this catches.** Case A said "no se encontró ninguna compra"
for six turns while an approved purchase existed. Case C said "no puedo
confirmar la acreditación" about an approved S/ 87.36 with a host receipt.

**Check.** For every negative claim ("no aparece", "no puedo confirmar", "no
registré", "no está"), the agent must be able to point at the record that
supports it — and must NOT have it contradicted by another part of the reply.
A negative is allowed when the record genuinely says so, and it must be
delivered with what the record DOES say.

---

## L3 — Money labels

**The rule.** Every amount is attributed to what it is, and the amounts are
consistent with the record and with each other.

**Dossier failure this catches.** Case C alternated S/ 87.36 (the charged
total) and S/ 79 (the gift value) with no label, so the customer could not
tell whether she was owed 87.36 or 79.

**Check.** Every amount in the reply maps to exactly one of: the charged
total, the item's gift value, the amount the customer reported, a policy
amount, or a balance. The same amount is never described two ways. When two
different amounts appear, the reply makes the difference visible ("la compra
figura aprobada por S/ 87.36; el artículo es por S/ 79").

---

## L4 — Truthful handoff reporting

**The rule.** The reply reports the handoff exactly as it happened.

- A takeover that was requested and confirmed may be reported as requested.
- A takeover that was NOT requested must never be implied.
- A takeover that was requested but NOT confirmed may be reported as
  requested — never as "a person has joined", never with a timeframe, never
  with a promise about the outcome.
- A reply that escalates must not attribute the request to the customer
  ("como pediste un asesor…") when the customer never asked for one. Saying
  so plainly is correct and is what the `solicitar_agente_humano` contract
  asks for.

---

## L5 — No internal identifiers

**The rule.** The customer-facing text carries no internal vocabulary: no
order ids, no internal codes, no system field names, no product jargon from
the policy-term list (`RSVP`, `email`, `chat`, `marketplace`, `delivery`,
`spam`, `streaming`, `app`, `login`, `FAQ`, `feedback`, `screenshot`, `host`,
`bartender`, `catering`, `baby shower`).

**Note.** A customer's own reference (their COD, their transfer id) is fine
to echo. An internal order id is not, unless the product already shows order
numbers to customers — in this product it does (the CRM shows "Orden
#307431"), so an order reference the customer already has is acceptable.

The perf record's `spanish_policy_term_hits` lists the policy terms found in
the delivered text; treat it as a candidate signal, not as the verdict.

---

## L6 — Does not deny the customer

**The rule.** When the customer reports something that the record does not
contradict, the reply engages with the report instead of dismissing it. A
mismatch is stated as a mismatch ("el registro muestra una tarjeta rechazada
y tú reportas una transferencia por Plin"), and the difference is handed to
whoever can resolve it.

**FAIL.** "No hiciste ese pago", "eso no lo registra nadie", or any phrasing
that turns an unverified difference into a contradiction of the customer.

---

## L7 — One clear next step

**The rule.** The customer can tell what happens next and what is expected of
them, if anything. A reply that ends on "no puedo confirmar…" with no next
step is a dead end, even if every sentence is true.

**Check.** After reading the reply, the customer can answer: "who does what
now, and do I have to do anything?" If the answer is unclear, FAIL.

---

## L8 — One question

**The rule.** At most one question to the customer, and it is the one that
unblocks the next step. Several questions, or a question plus an unrelated
ask, is a FAIL — the dossier's loops asked repeatedly and the customer never
answered anything.

---

## L9 — The reply is a reply

**The rule.** The delivered text reads as an answer to what the customer just
wrote, in natural Spanish, at the length the situation needs. No template
menu, no repeated paragraph from a previous turn, no boilerplate that ignores
the current message, and no silence where a reply was owed.

**Note.** Silence is legitimate only when the turn is about the request that is
already with a person: the thread is parked for that request, and the runtime
deliberately answers nothing. That is recorded as a suppression with its
reason, not as a language failure. A turn that asks about something else is not
covered by this note: it must be answered, even on a parked thread.

---

## L10 — No repeated limitation

**The rule.** A reply that re-states a limitation already delivered on this thread, as its opening or closing move and without new evidence or a new action, is a FAIL.

Worked example: dossier case D turns 2–4 ('no puedo verificar el correo ni confirmar que los fondos se hayan acreditado' x3).

---

## L11 — Who acted

**The rule.** The reply keeps straight who did what. A record of something the
guest did, or of something the host did, is never presented as something the
store did, and a record of a thank-you is never presented as proof of a
notification.

**Check.** Take every sentence in which the store is the subject of an action
("le avisamos", "se le notificó", "le enviamos"). The reply must be able to
point at a record that shows the store doing it. The host receipt
(`isThanked`, `thanks.message`, `thanks.sendMethod`) shows that a thank-you
exists; it does not show that the store told the host anything.

**FAIL.** Case B of the 2026-10-19 dossier read a guest thank-you receipt as a
delivered host notification. A reply that says the host "ya fue avisada" while
the only record is a thank-you the host sent is a FAIL, even when it is polite
and even when it adds a next step.

---

## How to apply the rubric

1. Read the delivered reply (the `delivered` block of the probe output).
2. Read the observed state next to it: the route, the stop reason, the
   takeover flags, the operational note, the reply's node.
3. Answer L1..L9 in order. L1 first: it is the check that catches the
   customer-level harm the others refine.
4. Write the verdict in the ledger row. A FAIL quotes the offending phrase.
5. Decide what the conversation does next:
   - **PASS** → continue the objective.
   - **FAIL** → record it, then continue anyway. The turn is a finding, not
     a reason to abandon the conversation: the next turns show whether the
     defect is repeated, isolated or compounding.
6. Never soften a FAIL because the behaviour "looked fine". The structural
   gate passing is a separate matter and does not qualify the language.

## What a FAIL is for

A FAIL is a defect report, not a score. It names the phrase, the harm and
the turn. The agent that found it decides what to do with it: fix the
behaviour (a prompt, a policy, a code path), add a rubric check, or extend
the objective so the case keeps watching for it. A language defect that is
only ever written in a ledger and never turned into a fix is a defect that
comes back.
