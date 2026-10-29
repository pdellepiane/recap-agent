# FINAL ENTRY POINT — WhatsApp Language & Routing Fixes (delegatable)

Status: planning complete. Implementer makes NO design decisions:
every threshold, prompt text, test, and done-criterion is specified
here. Read this file top to bottom, then execute WP-L1..WP-L6 in
order. Background evidence lives in this folder (00..04) and in
`evals/e2e-supervision/`; this file is authoritative on conflict.

## 1. What was checked (2026-10-21 handoff audit)

Handoff verified: skill at `evals/e2e-supervision/SKILL.md`,
objectives A–E, rubric L1–L9, protocol, 4 ledgers, transcripts in
`../artifacts/supervised-transcripts-2026-10-21.md`, reply-lint,
fixtures + twins present (`tests/whatsapp-dossier-twins.test.ts`,
19 tests). Reported green: typecheck, lint, 209 files / 1599 tests.

### Assumption audit — verdicts

| # | Assumption in handoff | Verdict | Evidence |
|---|---|---|---|
| 1 | Four qualified conversations cover the dossier | PARTLY FALSE | Ledgers cover C (x2), D, E only. OBJ-A and OBJ-B have objectives but NO ledger/transcript. A and B are unqualified. |
| 2 | Conversations prove loop behaviour fixed | UNSUPPORTED | Supervised conversations run 2 turns; original failures ran 4–12 turns. No conversation exceeds 3 turns. Repetition/compounding is untested end-to-end. |
| 3 | Offer→accept ledger proves router lane | FALSE for turn 1 | That ledger's own verdict admits turn 1 ran the classifier fallback path. It proves the accept arc, not router ownership. Any ledger without `router` in stages is invalid as router evidence. |
| 4 | OBJ-E both endings acceptable = PASS | RISKY | Same input produced clarify vs answer-for-one across runs. Calling both PASS hides nondeterminism; no repeatability distribution exists. |
| 5 | D1 is a clean PASS | CONTESTED | D1 ends "contacta a soporte para que lo revisen" — instructing the guest to contact support from inside the support channel, with no owner or expectation. L7 should have flagged it. |
| 6 | Synthetic obscured receipt tests image handling | WEAKER THAN CLAIMED | Real receipts were legible (amount/date/op readable). The fixture image is amount-obscured, so receipt-reading on realistic images is untested. |
| 7 | Plan reset = delete PLAN item | UNVERIFIED | Skill deletes only `sk=PLAN`. Repo purge tooling also deletes turn-lock and session-focus items for a user. Reset completeness must be proven, not assumed. |
| 8 | Reply repetition is a language problem only | FALSE | Compose receives history, but no typed fact says "you already stated this limitation". Without evidence, prompt text alone will not stop re-assertion across turns. Needs WP-L2 evidence + WP-L3 prompt together. |

## 2. Conclusions (why users are turned away)

From the 32 dossier turns + 4 supervised conversations, the reply
defects cluster into five repeatable mechanisms:

1. **Uncertainty as the message.** "No puedo confirmar…" is used as
   the reply's main clause, repeatedly, with no new fact, action,
   or owner. Stated once it is honesty; stated 4–12 times it reads
   as refusal.
2. **Verdict + handoff in separate frames (L1).** An unresolved-
   money verdict announced as a conclusion, followed by a handoff
   announcement, leaves two readings (D2, open defect).
3. **Capability confession without transfer.** The agent enumerates
   what it cannot do (verify email, check Yape, confirm credit)
   instead of transferring the task to who can.
4. **Dead-end next steps.** "Contacta a soporte", "envía el
   comprobante al correo" — instructions with no owner inside the
   current channel, no expectation, no receipt.
5. **Repetition without memory.** Each turn re-derives the same
   answer from the same evidence; nothing in evidence marks the
   limitation as already stated, so the model restates it as if
   new. This is the mechanism behind every dossier loop.

## 3. Directives (implement verbatim; no rewording decisions left)

### D1 — Escalation replies have ONE frame (fixes D2 / L1)

In escalation turns the unresolved part is TRANSFERRED, not
announced as a second verdict. Structure, in this order:
(1) verified facts, one clause; (2) what was requested from a
person + receipt state; (3) what the guest must do now (usually:
nothing). The phrase class "no puedo confirmar X" must never
appear as a standalone verdict sentence in a turn that also
announces a derivation; if the limitation matters, it is
subordinated inside clause (1) ("…y tu transferencia no aparece
asociada a ese registro, por lo que ya solicité…").

### D2 — A limitation is stated ONCE per conversation

When typed evidence says the same limitation was already stated
(`limitationAlreadyStated=true`, WP-L2), the reply must not
re-open with it. It leads with what changed this turn: a new
fact, the action taken, or the escalation. Re-assertion is
allowed only when new evidence arrived.

### D3 — Never instruct the guest to contact support from inside support

Forbidden next-step class in this channel: "contacta a soporte",
"escribe al correo", "llama a…" as the resolution. The next step
is always one of: the agent acts now (state it), a person was
requested (state receipt), or one specific question (L8).

### D4 — Capability statements transfer, they do not confess

A "no puedo…" sentence is permitted only when immediately paired
with who now owns the task. Bare capability confession as a
closing sentence is prohibited in unresolved-money turns.

### D5 — Length follows resolution state

Escalation turns: max 2 short paragraphs (already in the
solicitar contract; keep). Unresolved answer turns: max 3 short
paragraphs; if the guest asked for brevity ("no me escriban
tanto"), max 2 sentences. Closing pleasantries never repeat a
limitation.

## 4. Exact prompt modifications

### P1 — `prompts/nodes/solicitar_agente_humano/response_contract.txt`

Append exactly this block (Spanish, after existing bullets):

```text
- Un solo marco: hechos verificados en una cláusula, derivación
  solicitada con su estado real, y qué debe hacer la persona
  ahora. Lo no resuelto se transfiere a la revisión; nunca lo
  anuncies como un segundo veredicto ("no puedo confirmar…")
  en la misma respuesta que anuncia la derivación.
- Si la derivación fue automática, dilo sin atribuirla a la
  persona. No prometas plazos ni incorporación de nadie.
```

### P2 — `prompts/nodes/solicitar_agente_humano/system.txt`

Append exactly:

```text
Si el contexto operativo indica que esta misma limitación ya fue
comunicada (limitationAlreadyStated), no la repitas como
conclusión: abre con la acción realizada en este turno.
```

### P3 — `prompts/nodes/resolver_consultas_informativas/response_contract.txt`

Append exactly:

```text
Si la evidencia marca limitationAlreadyStated, no reabras la
respuesta con esa limitación: comienza por el hecho o la acción
nueva de este turno y refiere la limitación solo si llegó
evidencia nueva. Nunca cierres una respuesta de dinero no
resuelto con una confesión de capacidad sin transferir la tarea
a una persona o a un paso concreto. Nunca indiques contactar a
soporte o escribir a un correo como resolución dentro de este
canal. Si la persona pidió brevedad, responde en máximo dos
oraciones.
```

### P4 — `prompts/shared/reply_core.txt`

Append exactly one sentence:

```text
Una limitación ya comunicada en esta conversación no se repite
como si fuera nueva.
```

No other prompt text changes. If a directive seems to need a
canned sentence, stop: directives constrain structure, the model
still writes every sentence (repo invariant).

## 5. Code/evidence modification (the only runtime change)

### WP-L2a — typed limitation memory

Owner: support outcome signature code (where `repeat_count` /
`unresolved_money` are computed; find via the probe's printed
support outcome). Add derived evidence fields, computed
deterministically, no model input:

- `limitationAlreadyStated: boolean` — true when the previous
  delivered turn on this thread carried the same unresolved
  outcome signature as the current turn.
- `priorLimitationTurns: number` — count of consecutive prior
  turns with that signature.

Project both into compose evidence on FAQ and solicitar nodes
(facts only, no prose). Unit test: two consecutive identical
signatures ⇒ true/1; signature change ⇒ false/0.

### WP-L2b — instruction-module selection

Owner: model-request-projector module selection. When
`limitationAlreadyStated=true`, the P2/P3 prompt blocks are
already static text guarded by the evidence flag — no new
module is needed IF the flag is present in evidence on every
such turn. Verify with a prompt-audit test asserting the flag
key exists in the serialized compose input for a repeat turn.
If the flag is absent on any lane that reaches these nodes,
that is the bug to fix; do not add prompt text elsewhere.

## 6. New end-to-end objectives (add in this order)

Add fixtures first (extending.md rules), then objectives to
`evals/e2e-supervision/objectives.md`, then run + ledger each.
Guest beats are specified; wording is improvised per protocol.

- **OBJ-F — the persistent guest (loop/compounding).** Any
  unresolved-money fixture. Guest re-asks the same unresolved
  question 4 times with different phrasing, never accepting the
  derivation offer. Goal: agent escalates or changes action;
  it never delivers the same limitation paragraph twice.
  Checks: L1, L9 + new L10 below. MINIMUM 5 turns — this is the
  conversation length the dossier actually had.
- **OBJ-G — correction.** Guest corrects the agent twice
  ("ya te dije que fue por Plin", "no, el monto es 391.87").
  Goal: correction is incorporated, not re-asked. L6, L9.
- **OBJ-H — post-handoff new question.** After takeover +
  soft-pause, guest asks a genuinely new factual question
  (event date). Goal: narrowed pause answers it; same-thread
  money follow-up stays paused. No ledger exists for this seam.
- **OBJ-I — handoff failure.** Fixture `handoff` outcome =
  failed, then unknown. Goal: reply reports requested-not-
  confirmed truthfully; never claims a person joined. L4.
- **OBJ-J — happy path guard.** Approved purchase, simple
  status question. Goal: direct answer, NO escalation, NO
  "no puedo confirmar" hedge. False-escalation control. L2.
- **OBJ-K — notification question (Luis's real ask).** Approved
  purchase, guest asks whether hosts will be notified. Backend
  has no notification field. Goal: purchase confirmed plainly;
  notification stated as not visible in the record, once,
  without converting it into purchase doubt. L1, L2.
- **OBJ-L — brevity request.** Mirta fixture; guest says
  "no me escriban tanto, solo dígame qué sigue". Goal: reply
  ≤2 sentences with the next step. L7, L9 + D5.
- **OBJ-M — wrong-recipient transfer.** Silvia fixture; guest
  reports Plin sent to a name that is not the business account.
  Goal: mismatch named as mismatch, escalated, recipient never
  treated as proof of fraud or of payment. L1, L6.
- **OBJ-N — de-escalation.** Guest accepts the host-credit
  explanation and withdraws the refund demand mid-thread.
  Goal: agent closes politely, does NOT escalate after
  resolution, does not re-open the limitation. L9.
- **OBJ-O — repeatability.** Re-run OBJ-C and OBJ-E five times
  each from clean plans. Record the distribution of routes and
  verdicts in one ledger. Goal: no run produces an L1/L2 FAIL;
  route variance is reported, not hidden by "both acceptable".

### New rubric check L10 — No repeated limitation

Add to `language-rubric.md` verbatim rule: "A reply that
re-states a limitation already delivered on this thread, as
its opening or closing move and without new evidence or a new
action, is a FAIL. Worked example: dossier case D turns 2–4
('no puedo verificar el correo ni confirmar que los fondos se
hayan acreditado' x3)." Objective F watches L10.

## 7. Work packages (execute in order; atomic commits)

| WP | Scope | Done when (objective) | Est. |
|---|---|---|---|
| WP-L1 | Harden supervision validity: (a) ledger template gains mandatory `stages contain router` validity line — a ledger with classifier/extraction stages on the router lane is marked INVALID AS ROUTER EVIDENCE; (b) prove plan reset completeness by listing all DynamoDB items for a test phone before/after reset (plan, turn lock, session focus) and extend the skill reset to delete every item type found; (c) run + ledger the two missing conversations OBJ-A and OBJ-B | Reset test shows 0 items after reset; A and B ledgers exist with per-turn L1–L9 | 4–6 h |
| WP-L2 | Typed limitation memory (section 5 WP-L2a/L2b) + unit + prompt-audit tests | Tests in 03-style: signature repeat ⇒ flag true; flag present in serialized compose input on repeat turns | 4–6 h |
| WP-L3 | Prompt modifications P1–P4 verbatim + L10 rubric addition | `git diff prompts/` shows exactly the specified blocks and nothing else; prompt audit green | 1–2 h |
| WP-L4 | Redeploy dev Lambda (BUILD_OUTPUT_DIR artifact path per skill gotchas, router flag on) and re-run D2 conversation + OBJ-C | New D ledger: turn-2 reply passes L1 (single frame); artifact SHA recorded in ledger header | 2–3 h |
| WP-L5 | New fixtures + objectives F–O (section 6, in listed order) + ledgers for each | 10 objectives added; every ledger ≥ the specified minimum turns; F ledger ≥5 turns | 10–16 h |
| WP-L6 | Structural layer for assertable findings only (extending.md §5): live case + twin + registry entry for (i) escalation-reply single-frame is NOT structurally assertable — skip; (ii) limitation-flag evidence presence IS — add twin asserting flag flips on repeat; (iii) any routing regression found in F–O that IS effect-assertable. Implementation log entry per change. | Coverage test green; targeted live cases green; no unfiltered gate run | 6–10 h |

Total: 27–43 agent-hours. WP-L1 first (invalid evidence poisons
everything after it). WP-L2 before WP-L3 (prompt without the
evidence flag does nothing). WP-L4 validates the actual defect.

## 8. Validation commands (exact)

```bash
npm run typecheck && npm run lint && npm test
npx vitest run tests/live-behavior-coverage.test.ts
BUILD_OUTPUT_DIR=.artifacts/dist-build npm run build
DEPLOY_ARTIFACT_PATH=.artifacts/recap-agent.zip \
  DEPLOYMENT_ENV=development AGENT_FEATURE_DECISIONS_ROUTER=true \
  npm run deploy
aws lambda get-function-configuration --profile se-dev \
  --region us-east-1 --function-name recap-agent-runtime-dev \
  --query 'Environment.Variables.AGENT_FEATURE_DECISIONS_ROUTER'
node scripts/supervised-probe.mjs --scenario <fixture> \
  --user-id <phone> --contact-phone <phone> --run-id <id> \
  --case-id <id> --session-id <id> --text "<message>"
node scripts/reply-lint.mjs --file <reply.txt>   # candidates only
npm run eval:behavior-live -- --case live_behavior.<id>  # targeted only
```

AWS: profile `se-dev`, region `us-east-1`, account `684516060775`
only. Never the unfiltered live gate. Never remove the probe's
mandatory `--scenario` guard.

## 9. Acceptance for the whole package

1. D2 defect closed: re-run ledger shows L1 PASS on the
   escalation turn, single frame, receipt-truthful.
2. OBJ-F (≥5 turns) shows no limitation paragraph delivered
   twice (L10 PASS on every turn).
3. OBJ-A and OBJ-B ledgers exist; no ledger in the set lacks
   the router-validity line.
4. OBJ-O distribution recorded; any L1/L2 FAIL in 10 runs
   reopens this package instead of being averaged away.
5. Full offline suite, typecheck, lint green; every behavior
   change has registry entry + targeted eval + log entry.

## 10. Non-goals

No judge/second model. No canned replies or text replacement.
No keyword routing (reply-lint stays offline). No changes to
planning/RSVP/close/auth lanes. No backend-team requests.
Campaign-side messages (Silvia's auto-message) are out of scope.
