# Ledger template

One file per conversation, in `ledgers/<conversation-id>.md`. The ledger is
the durable record of a qualified conversation: what the guest said, what the
agent answered, what the state was, and what the agent (as qualifier) decided
about the language.

Keep it short and factual. A ledger that takes longer to read than the
conversation did is a ledger nobody will read.

---

```markdown
# Conversation <id> — <objective id> (<short title>)

- Date: YYYY-MM-DD
- Runtime: development Lambda `recap-agent-runtime-dev`, artifact <sha>,
  `AGENT_FEATURE_DECISIONS_ROUTER=true`
- Fixture: <scenario> (phone +<phone>)
- Conversation id: <conversation-id> (fixture run id and case id)
- Messages written by: the supervising agent, from the objective (not a script)
- Router validity: <VALID AS ROUTER EVIDENCE — every supervised turn that ran a model stage ran `router`, with only `router`/`reply` stages recorded; soft pauses with no stages do not affect validity | INVALID AS ROUTER EVIDENCE — name every turn that ran `classifier`, `extraction`, or another non-`router`/`reply` stage>

## Goal met

<yes | no | partial> — <one line: what the objective asked for and what the
conversation achieved>

## Turns

| # | Guest said | Agent answered | Route / stop reason | Stages | Takeover | Language |
|---|---|---|---|---|---|---|
| 1 | ... | ... | `information_batch` / `—` | router, reply | — | L1 PASS … L9 PASS |
| 2 | ... | ... | `human_escalation` / `router_escalation:capability_blocked_threshold` | router, reply | attempted, confirmed | **L1 FAIL** — <phrase> → <harm> |

## Language findings

| Turn | Check | Phrase | Customer-level harm | Disposition |
|---|---|---|---|---|
| 2 | L1 | "no puedo confirmar que la transferencia se haya aplicado" + "se derivó para revisión" | Two readings: the order does not exist AND a person is on it; the guest cannot tell what happens to her S/ 391.87 | open — to be fixed in the escalation reply contract |

## Verdict

PASS | PASS WITH FINDINGS | FAIL

<one line: what this conversation proved and what it exposed>
```

---

## Field notes

- **Router validity** — mandatory for the conversation. Use `VALID AS ROUTER EVIDENCE` when every supervised turn that ran a model stage ran `router`, with only `router`/`reply` stages recorded. Use `INVALID AS ROUTER EVIDENCE` if any turn ran `classifier`, `extraction`, or another non-`router`/`reply` stage; name every offending turn. Soft pauses with no stages (`none`) are legitimate silences and are excluded from the validity decision: they are neither evidence for nor against router ownership. If stages are missing or ambiguous, state that rather than guessing. For an invalid ledger, add a short note stating what it still proves, not router ownership. A ledger without this line is incomplete and may not be cited as router evidence.
- **Guest said / Agent answered** — the real text, quoted. The agent's reply
  is the `delivered` block of the probe output; a suppression is written as
  *(no message — soft pause)* with its reason.
- **Route / stop reason** — the observed `route_kind` and `stop_reason`. The
  stop reason is where the router's own trigger is visible
  (`router_escalation:<reason>`), and it is what distinguishes an escalation
  the router chose from one the guest asked for.
- **Stages** — the model stages that ran. On this lane a support turn runs
  `router` and `reply`; a `classifier` or `extraction` stage means the router
  did not own the turn.
- **Takeover** — `—`, `attempted`, `attempted + confirmed`, or
  `failed`. Only a confirmed takeover may be reported as a person joining.
- **Language** — the rubric verdicts for that turn, L1..L9, with the FAILs
  spelled out.
- **Disposition** — what happens to the finding: `open`, `fixed in <sha>`,
  `accepted: <reason>`, or `watched by <objective>`.
