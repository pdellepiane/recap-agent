---
name: whatsapp-e2e-supervision
description: Supervise end-to-end conversations against the deployed development runtime of the Sin Envolturas WhatsApp assistant, and qualify the LANGUAGE of the customer-facing replies with the written rubric L1..L9. Use when extending the end-to-end tests of the customer-assistance lane, when a conversation against the dev runtime must be judged, or when a reply leaves the customer with two incompatible readings of their own case.
---

# Supervised end-to-end supervision (customer-assistance lane)

The structural tests prove the right EFFECT happened. They cannot see what
the customer read, and the four WhatsApp behaviour cases failed on the WORDS:
"no se encontró ninguna compra" for six turns while an approved purchase
existed, "no puedo confirmar la acreditación" about an approved S/ 87.36 that
carried a host receipt, "no puedo verificar el correo" after a Plin transfer.

So the agent that runs the conversation qualifies the language itself, turn
by turn, against a written rubric. **There is no judge and no second model.**
You are the tester, the observer and the qualifier in the same pass.

Full detail, objectives, ledgers and the extension guide live in the
repository under `evals/e2e-supervision/`:

- `evals/e2e-supervision/README.md` — orientation, commands, gotchas
- `evals/e2e-supervision/objectives.md` — the five objectives
- `evals/e2e-supervision/protocol.md` — the turn loop
- `evals/e2e-supervision/language-rubric.md` — L1..L9
- `evals/e2e-supervision/ledger-template.md` — the ledger format
- `evals/e2e-supervision/extending.md` — how to add fixtures, objectives, cases
- `evals/e2e-supervision/ledgers/` — the qualified conversations so far

## The loop

1. **Pick an objective** (`objectives.md`). It states the backend state, the
   goal, what must NOT be said, and which language checks matter. It is NOT a
   script of messages.
2. **Reset the conversation.** Stop concurrent turns first. Reset the entire
   `channel#user_id` partition, not only `PLAN`: the runtime also writes
   `TURN_LOCK`, `SESSION#<session-id>` and `RSVP_EFFECT#<message-id>`.
   Use only a synthetic `51900xxxxxx` phone, never a customer number.
   **The value must be identical to the probe's `--user-id`, with no leading
   `+`** — the runtime keys conversation state as `channel#user_id` with that
   opaque value, so the reset targets the exact partition the probe writes.
   A leading `+` is tolerated and stripped, so both spellings resolve to the
   same partition; the `+` belongs only to `--contact-phone`:

   ```bash
   node scripts/purge-terminal-plans.mjs \
     --profile se-dev --region us-east-1 --table recap-agent-runtime-dev-plans \
     --channel whatsapp --phone <PHONE> --dry-run
   node scripts/purge-terminal-plans.mjs \
     --profile se-dev --region us-east-1 --table recap-agent-runtime-dev-plans \
     --channel whatsapp --phone <PHONE> --yes
   ```
   The command checks account `684516060775`, paginates a strongly consistent
   query without a sort-key filter, deletes each returned item, then queries
   again and fails unless `remaining` is zero. It prints the exact partition
   key it used and the item count: compare that pk with the probe's
   `--user-id` before trusting a reset. A count of `0` is reported loudly —
   on a phone that has a real conversation it means the identifier form is
   wrong, not that there was nothing to clean. Save its before/after listings.
   For terminal probes use `--channel terminal_whatsapp` instead. Fixture
   ledgers and perf traces are separately scoped history, not conversation
   state; use a fresh run/case identity for the next fixture conversation.
   Proven on 2026-10-21 with synthetic phone `51900000777` (unused by any
   fixture or objective) against the real partition `whatsapp#51900000777`:
   a fixture probe turn wrote only `PLAN`, and the `+`-prefixed partition
   `whatsapp#+51900000777` held nothing — the runtime never writes there.
   Explicitly seeded synthetic records for all four storage shapes proved
   `PLAN`-only deletion leaves three items behind; the complete reset left
   zero, confirmed by an independent second query. Natural probe persistence
   of all four shapes was NOT PROVEN. Neither check proves absence of later
   concurrent writes. Raw evidence: `.artifacts/wp-l1b-reset-proof/`.
3. **Check the runtime**: the router must own the customer-assistance lane.

   ```bash
   aws lambda get-function-configuration --profile se-dev --region us-east-1 \
     --function-name recap-agent-runtime-dev \
     --query 'Environment.Variables.AGENT_FEATURE_DECISIONS_ROUTER'
   ```
4. **Write the guest's next message yourself**, from the objective and from
   what the agent just said. The guest is a real person with a real problem:
   terse, sometimes contradicting themselves, sometimes naming a third party.
   Do not replay a stored case text — the point is to see how the agent
   handles a phrasing it was not tuned on.
5. **Run one turn** (the fixture scenario is mandatory; it is what keeps the
   conversation on the mocked backend):

   ```bash
   node scripts/supervised-probe.mjs \
     --scenario <fixture> --user-id <phone> --contact-phone <phone> \
     --run-id <conversation-id> --case-id <conversation-id> \
     --session-id <conversation-id> [--image <path>] --text "<the guest's message>"
   ```
6. **Read the reply and the observed state** the probe prints: delivery
   action and reason, node, route, stop reason, model stages with timing and
   tokens, conversation health, support outcome (signature, repeat count,
   unresolved-money flag, reported payment), escalation state, help receipt,
   takeover flags, information reads, perf signals.
7. **Apply the rubric** (below). Write the verdict.
8. **Write the ledger row** (`ledger-template.md`).
9. **Decide the next move**: the goal is met → stop and write the
   conversation verdict; the agent asked a question → answer it as the guest;
   the agent suppressed the reply → the thread is with a person, record it and
   stop; a language FAIL → record it and KEEP GOING, the next turns show
   whether the defect repeats or compounds.

## The rubric, in short

Full rules and worked examples in `language-rubric.md`. Answer every check
for every reply: PASS, FAIL or N/A. A FAIL quotes the offending phrase and
names the customer-level harm.

- **L1 — One reading per turn.** The reply must leave the customer with
  exactly ONE consistent understanding. Two incompatible readings are a
  failure even when every sentence is individually true. The canonical case:
  a handoff announcement next to an unresolved-money verdict ("no puedo
  confirmar que la transferencia se haya aplicado" + "la conversación se
  derivó para revisión") — the customer cannot tell whether her order exists,
  and thinks the refund is needed.
- **L2 — No unfounded negative.** Never say something is missing, does not
  exist or is unconfirmed when the record says otherwise.
- **L3 — Money labels.** Every amount is attributed: charged total, gift
  value, customer-reported amount, policy amount, balance. The dossier's
  S/ 87.36 ↔ S/ 79 flip.
- **L4 — Truthful handoff reporting.** Report the handoff exactly as it
  happened; never imply a person joined without a confirmed receipt; never
  attribute the escalation to a customer who did not ask for it.
- **L5 — No internal identifiers.** No internal codes, no system vocabulary,
  no policy terms. A customer reference they already have is fine.
- **L6 — Does not deny the customer.** Engage with the customer's report; a
  mismatch is a mismatch, not a contradiction of her.
- **L7 — One clear next step.** Who does what now, and what is expected of
  her, if anything.
- **L8 — One question.** At most one, and it unblocks the next step.
- **L9 — The reply is a reply.** Natural Spanish, answers what she just
  wrote, no template menu, no repeated paragraph. A soft pause is a
  legitimate silence, recorded with its reason.

Order matters: **L1 first**. It is the check that catches the harm the
others refine.

`scripts/reply-lint.mjs --file <reply.txt>` reports CANDIDATE issues (a
handoff phrase next to an unresolved-money phrase, policy terms, internal
identifiers, several questions). It is a lint, never a verdict: it produces
false positives on purpose, and you clear them with the rubric.

## Completing a conversation

A conversation is complete when the objective's goal is met or the thread is
soft-paused. The ledger's final entry states: goal met (yes/no/partial), the
language findings with phrase and harm, the escalation and whether the reply
described it truthfully, and the verdict: PASS, PASS WITH FINDINGS or FAIL.

**PASS WITH FINDINGS is the normal outcome of a good conversation with a bad
sentence in it.** It is not a soft pass: the findings are defects, they are
listed, and each one ends in a behaviour change, a new rubric check, a new
objective, or an explicit decision to accept it. A finding that only ever
lives in a ledger comes back.

## Gotchas that will bite you

- **The fixture scenario is mandatory.** Without it the probe would reach the
  REAL backend and could write against a real customer record. Never remove
  the guard.
- **The router must be on** (`AGENT_FEATURE_DECISIONS_ROUTER=true`). With the
  flag off the classifier path owns the turn and nothing about the router is
  under test.
- **`dist/` is root-owned on this machine** and cannot be removed or renamed
  without sudo. Build elsewhere and deploy the artifact:
  `BUILD_OUTPUT_DIR=.artifacts/dist-build npm run build`, zip it, then
  `DEPLOY_ARTIFACT_PATH=.artifacts/recap-agent.zip DEPLOYMENT_ENV=development
  AGENT_FEATURE_DECISIONS_ROUTER=true npm run deploy`.
- **AWS access is `se-dev` / `us-east-1` / account 684516060775** and nothing
  else. `aws login --profile se-signin` refreshes the session.
- **The openai SDK cannot call `/v1/decisions`** (6.49 installed, the
  endpoint needs >= 7.30, and `@openai/agents` pins `openai@^6.46`). The
  router uses an isolated raw-fetch client. Do not "fix" this by upgrading.
- **A delegated lane may die with "This API key has expired"** — pass an
  explicit `model` to the delegation.
- **Never run the unfiltered live gate.** Targeted cases only:
  `npm run eval:behavior-live -- --case <id> ...`.
- **No semantic judges in the live suite.** The language is your job.
