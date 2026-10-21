# Supervised end-to-end supervision of the customer-assistance lane

A handoff for an agent that will **extend the end-to-end tests and qualify
the language** of what the customer receives.

## Why this exists

The live cases of the WhatsApp behaviour dossier assert effects: a takeover
happened, a receipt exists, the plan records the escalation, no unauthorised
effect was produced. They are hard, objective and worth their cost — and they
are blind to the part the customers actually complained about.

The four dossier conversations failed on the WORDS:

- "no se encontró ninguna compra" for six turns while an approved purchase
  existed (case A);
- a code denied for five turns while the same reply confirmed the approved
  US$ 86.45 purchase (case B);
- "no puedo confirmar la acreditación" about an approved S/ 87.36 that carried
  a host receipt (case C);
- "no puedo verificar el correo ni confirmar acreditación" for four turns
  after a Plin transfer (case D).

A structural gate cannot see any of that. A judge could, but a judge is a
second opinion on a transcript — it does not know what the guest had already
been told, and it is not the agent that has to live with the result. So the
agent that runs the conversation qualifies the language itself, turn by turn,
against a written rubric, and writes the verdict down.

## The three hats, on one agent

| Hat | What it does | Where it is written down |
|---|---|---|
| **Tester** | Writes the guest's messages from the objective — not a fixed script | `protocol.md` |
| **Observer** | Reads the delivered reply and the observed state of the turn | the probe output |
| **Qualifier** | Applies the language rubric L1..L9 and decides the verdict | `language-rubric.md` |

There is no judge, no semantic scorer, and no second model. The same agent
that chose the guest's words reads the reply and decides whether it is
acceptable. That is the point: the agent that made the conversation is the
one that qualifies it.

## The files

| File | What it is |
|---|---|
| `README.md` | This orientation, the commands, the environment gotchas |
| `objectives.md` | The five dossier objectives, and how to write a new one |
| `protocol.md` | The turn loop, the reset, the completion criteria |
| `language-rubric.md` | L1..L9, with the canonical failure worked out |
| `ledger-template.md` | The row format for a qualified conversation |
| `extending.md` | How to add a fixture, an objective, a case, a rubric check |
| `ledgers/` | The qualified conversations recorded so far |

## The commands

Everything runs against the **development** stack with the mocked backend.
Production is never involved.

```bash
# one turn of a conversation
node scripts/supervised-probe.mjs \
  --scenario purchase-approved-host-receipt-refund \
  --user-id 51900000403 --contact-phone "+51900000403" \
  --run-id <conversation-id> --case-id <conversation-id> \
  --session-id <conversation-id> \
  --text "<the guest's message>"

# the metrics of the lane, read-only over the dev perf records
node scripts/measure-support-lane.mjs --since 2026-10-21T00:00:00.000Z

# the structural live cases (explicitly selected; never the unfiltered gate)
npm run eval:behavior-live -- --case live_behavior.<case_id>

# a candidate lint over a captured reply
node scripts/reply-lint.mjs --file <reply.txt> --handoff --unresolved
```

The probe prints the delivered message and the observed state of the turn:
the delivery action, the node, the route, the stop reason, the model stages
with their timing and tokens, the conversation health, the support outcome
(signature, repeat count, unresolved-money flag, reported payment), the
escalation state, the help receipt, the takeover flags, the information reads
and the perf signals.

## Environment gotchas that will bite you

1. **The fixture scenario is mandatory.** The probe refuses to run without
   `--scenario`. That is deliberate: a probe without it would reach the REAL
   backend and could write against a real customer record. Never remove the
   guard.
2. **The router must be on.** `AGENT_FEATURE_DECISIONS_ROUTER=true` on the
   deployed Lambda. With the flag off the classifier path owns the turn and
   none of the router behaviour is under test.
3. **The dev plan is keyed by `channel#user_id`.** A conversation leaves a
   plan behind, and the next conversation with the same phone inherits it.
   Reset the whole partition before every conversation (`protocol.md`).
   The reset value must equal the probe's `--user-id` — `51900000403`, with
   no leading `+` — because that opaque value is what the runtime keys on.
   A leading `+` is tolerated and stripped, so both spellings resolve to the
   same partition; the `+` belongs only to `--contact-phone`:

   ```bash
   node scripts/purge-terminal-plans.mjs \
     --profile se-dev --region us-east-1 --table recap-agent-runtime-dev-plans \
     --channel whatsapp --phone 51900000403 --dry-run
   ```

   The command prints the exact partition key it used and the item count:
   compare that pk with the `--user-id` you are about to probe with. A count
   of `0` means the identifier form is wrong, not that there was nothing to
   clean.
4. **The openai SDK cannot call `/v1/decisions`.** The installed SDK is 6.49
   and the endpoint needs >= 7.30, while `@openai/agents` pins `openai@^6.46`.
   The router therefore uses an isolated raw-fetch client
   (`src/runtime/decisions-router-client.ts`). Do not "fix" this by upgrading
   the SDK.
5. **`dist/` is root-owned on this machine** and cannot be removed or renamed
   without sudo. Build elsewhere and deploy the artifact:

   ```bash
   BUILD_OUTPUT_DIR=.artifacts/dist-build npm run build
   (cd .artifacts/dist-build && rm -f ../recap-agent.zip && zip -qr ../recap-agent.zip .)
   DEPLOY_ARTIFACT_PATH=.artifacts/recap-agent.zip DEPLOYMENT_ENV=development \
     AGENT_FEATURE_DECISIONS_ROUTER=true npm run deploy
   ```
6. **AWS access is `se-dev` / `us-east-1` / account 684516060775** and nothing
   else. `aws login --profile se-signin` refreshes the backing session; a
   mutating script must fail closed unless the account matches.
7. **The subagent model key may be expired.** If a delegated lane dies with
   "This API key has expired", pass an explicit `model` to the delegation
   (`opencode/minimax-m3.1-flash-free` was working).

## Where the results live

`ledgers/` holds the qualified conversations. Each ledger names its objective,
the turns with their verdicts, the language findings and the conversation
verdict. A language defect that only ever lives in a ledger comes back, so
every finding is expected to end in one of: a behaviour change, a new rubric
check, a new objective, or an explicit decision to accept it.

The dossier's own transcripts are in
`analysis/2026-10-19-whatsapp-behavior-cases/artifacts/`:
`turn-table-2026-10-20.md` (the 32 real turns) and
`supervised-transcripts-2026-10-21.md` (the supervised conversations).
