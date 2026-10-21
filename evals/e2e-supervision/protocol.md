# The supervision protocol

One agent, three hats, no judge. The agent that plays the customer also
reads the reply, applies the language rubric and writes the verdict. Nothing
is delegated to another model, and no judge scores the conversation.

```
        ┌──────────────────────────────────────────────────────────┐
        │  ONE AGENT                                              │
        │                                                          │
        │  1. picks the next guest message from the objective      │
        │  2. runs one turn against the deployed runtime           │
        │  3. reads the delivered reply and the observed state     │
        │  4. applies the language rubric (L1..L9)                 │
        │  5. writes the ledger row and decides the next move      │
        └──────────────────────────────────────────────────────────┘
```

## Before the first turn

1. The objective is chosen (`objectives.md`).
2. The dev conversation state is clean for that phone. The plan is keyed by
   `channel#user_id`, so a previous conversation with the same phone leaks
   into the next one. Reset it:

   ```bash
   node -e "
   const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
   const {DynamoDBDocumentClient,DeleteCommand}=require('@aws-sdk/lib-dynamodb');
   process.env.AWS_PROFILE='se-dev'; process.env.AWS_REGION='us-east-1';
   (async()=>{
     const c=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}));
     await c.send(new DeleteCommand({TableName:'recap-agent-runtime-dev-plans',
       Key:{pk:'whatsapp#<PHONE>',sk:'PLAN'}}));
   })();"
   ```

3. The runtime is the deployed development Lambda with the router lane on.
   Check before trusting a turn:

   ```bash
   aws lambda get-function-configuration --profile se-dev --region us-east-1 \
     --function-name recap-agent-runtime-dev \
     --query 'Environment.Variables.AGENT_FEATURE_DECISIONS_ROUTER'
   ```

   `true` means the Decisions router owns the customer-assistance lane. If it
   says `false`, the turn is running the classifier path and none of the
   router behaviour is under test.

## The loop

For each turn:

1. **Choose the guest's next message.** From the objective, from what the
   agent just said, and from what the guest would plausibly do next. The
   guest is a real person with a real problem: terse, sometimes confusing,
   sometimes contradicting themselves, occasionally naming a third party.
   The message is yours to write. Do not replay a stored case text — the
   point is to see how the agent handles a phrasing it was not tuned on.
2. **Run one turn.**

   ```bash
   node scripts/supervised-probe.mjs \
     --scenario <fixture> --user-id <phone> --contact-phone <phone> \
     --run-id <conversation-id> --case-id <conversation-id> \
     --session-id <conversation-id> \
     [--image <path>] \
     --text "<the guest's message>"
   ```

   `--scenario` is mandatory: it is what keeps the conversation on the
   mocked development fixture instead of a real backend.
3. **Read the output.** The probe prints the delivered message and the
   observed state: delivery action and reason, the node, the route, the stop
   reason, the model stages with their timing and tokens, the conversation
   health, the support outcome (signature, repeat count, unresolved-money
   flag, reported payment), the escalation state, the help receipt and the
   takeover flags, the information reads and the perf signals.
4. **Apply the rubric** (`language-rubric.md`), L1 first. Write the verdict.
5. **Write the ledger row** (`ledger-template.md`).
6. **Decide the next move.**
   - The objective's goal is met → stop and write the conversation verdict.
   - The agent answered with a question → answer it as the guest.
   - The agent answered with a suppression (soft pause) → the thread is with
     a person; record it and stop unless the objective says otherwise.
   - A language FAIL → record it and keep going: the next turns show whether
     the defect repeats or compounds. A FAIL is a finding, not a reason to
     abandon the conversation.

## Completing a conversation

A conversation is complete when the objective's goal is met or the thread is
soft-paused. The final ledger entry carries:

- **Goal met** — yes / no / partial, with one line of why.
- **Language** — the count of FAILs, and for each: the phrase and the harm.
- **Escalation** — whether a takeover happened, and whether the reply
  described it truthfully.
- **Verdict** — PASS, PASS WITH FINDINGS, or FAIL.

`PASS WITH FINDINGS` is the normal outcome of a good conversation with a bad
sentence in it. It is not a soft pass: the findings are defects, they are
listed, and they are the input for the next change.

## The "and it also has to consider the language" rule

A conversation is not finished when the effects are right. It is finished when
the effects are right **and** the language is qualified. Both halves are the
same agent's job in the same pass, turn by turn. An agent that runs the
conversation, records the effects and skips the reading of the replies has
produced a structural test — which the live cases already are.

## The reply lint (a candidate signal, never a verdict)

`scripts/reply-lint.mjs` reads a delivered reply and reports CANDIDATE
issues: a handoff announcement next to an unresolved-money phrase, policy
terms, internal identifiers, more than one question. It is an offline lint
over a captured reply; it never influences a runtime decision and it never
replaces the rubric. The agent still decides.

```bash
node scripts/reply-lint.mjs --file <reply.txt> [--handoff] [--unresolved] \
  [--policy-terms] [--order-ids]
```
