# Extending the end-to-end supervision

Five things can be added, and they are independent. Do them in this order
when a new behaviour is needed: **fixture → objective → conversation →
ledger**, and only then the structural layer (live case, twin) if the
behaviour is objectively assertable.

---

## 1. A new backend scenario (fixture)

A scenario is the backend a conversation runs against: the records the
customer actually has.

1. Create `evals/fixtures/<scenario>.json`. The shape is the `FixtureData`
   contract in `src/runtime/eval-fixture-gateway.ts` — `guestOrders`,
   `guestGiftPurchases`, `guestEvents`, `handoff`, and so on. Model it on an
   existing fixture and on the real wire shapes in
   `src/runtime/agent-conversation-gateway.ts` (the `OrderWire`,
   `GiftPurchaseWire` and payment schemas).
2. Give it a synthetic phone in the `900…` range. Never a customer's number.
3. Add the scenario to `tests/dossier-purchase-fixtures.test.ts`: load it
   through `FixtureAgentConversationGateway.create('<scenario>')` and assert
   the mapped facts (order ids, payment statuses, totals, currency, the
   reference and thanks presence). The fixture IS the backend contract of the
   objective, so its test is not optional.
4. If the scenario needs a receipt image, use the repository's synthetic
   asset (`evals/fixtures/images/receipt-amount-obscured.png`) and state the
   amount in the guest's text. A dossier screenshot is a private customer
   document and never belongs in a fixture or a case.

## 2. A new objective

Add it to `objectives.md` with the four parts (backend state, goal, must
not, language checks). The "must not" list is the part that carries the
dossier's finding forward, so write it from the customer's point of view:
the sentence she would have said if the agent had got it wrong.

## 3. A new conversation and its ledger

Follow `protocol.md`: reset the dev plan, run the turns, qualify each reply,
write `ledgers/<conversation-id>.md` from `ledger-template.md`. Use a fresh
`--run-id` and `--case-id` per conversation so the fixture effect ledger does
not replay a previous conversation's takeover.

## 4. A rubric check

When a language defect shows up that L1..L9 does not catch, add the check to
`language-rubric.md` with: the rule, what a FAIL looks like, and the worked
example. Keep the worked example real — a phrase from a real transcript, not
an invented one. A rubric without an example is a preference; a rubric with
one is a contract.

## 5. The structural layer (only when the behaviour is objectively assertable)

The language layer and the structural layer answer different questions. Keep
both.

### A live case

- Add `evals/cases/live-behavior-<name>.yaml` with `suite:
  live_behavior_regression`, `targetModes: [ live_lambda ]`, and a
  `backendFixture` scenario on the case AND on every input.
- Assertions are HARD and OBJECTIVE only: effects, plan state, backend facts,
  failure outcomes, receipts. **No `text_semantic`** — the mandatory suite
  forbids it, and the language is the supervisor's job, not a judge's.
- Do not pin the turn on which a probabilistic router acts. Assert the effect
  over the conversation and the negative controls per turn.
- Add the case to `evals/suites/live_behavior_regression.yaml` and update the
  frozen support gate: create a NEW dated gate file next to the existing one
  and point `tests/eval-run-manifest.test.ts` at it. The historical gate file
  stays exactly as it is.
- Register the behavior change in `evals/live-behavior-coverage.yaml`: one
  entry per behavior change, with the implementing commit and the live case
  id. An entry may reuse a case; a behavior change may never reuse an OLDER
  entry.

### A deterministic twin

When the behaviour is model-independent (an effect, a state transition, a
count), pin it in `tests/whatsapp-dossier-twins.test.ts` with the scripted
router. The twin is the part of the suite that must never drift with the
model; the live case is the part that must never drift with the
implementation.

### The offline evaluation target

`src/evals/targets/offline.ts` builds the service for offline replays. When
a new support-lane behaviour must be replayable offline, carry the scripted
router port, the fixture gateway and the orchestrator into that target too,
and keep the target's public behaviour unchanged.

---

## Rules that apply to every extension

- **No canned replies and no post-generation text replacement.** The reply is
  model-written for the turn.
- **No keyword routing.** The runtime decides with typed state and model
  output. An offline lint over a captured reply never influences a runtime
  decision.
- **Every behaviour change ships with**: a live case, its registry entry, a
  targeted eval run, and an `docs/implementation-log.md` entry with the
  reason and the decision.
- **Targeted evals only.** `npm run eval:behavior-live -- --case <id> ...`.
  Never the unfiltered gate; never a retry of a semantic failure without a
  new instruction.
- **Redeploy before validating.** A Lambda-impacting change is redeployed to
  development first, and the run records the artifact identity.
