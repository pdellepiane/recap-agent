# Supervisor handoff: the open-request collapse (2026-10-22)

Status: implemented, committed, deployed, and partially verified. Two fixes
in this round have no live verification through the frozen harness and no
coverage-registry entry. The AWS session expired before this handoff was
written, so the deployed Lambda identity below is a claim from the
implementation log, not a value re-read from AWS.

Read this file top to bottom, then run section 7 before changing anything.

## 1. Where the four original transcripts came from

The four conversations that drive this work are the WhatsApp behaviour
dossier (cases A to D). They were not invented and not exported from the
backend.

- Originals: 12 CRM screenshots shared in the chat on 2026-10-19, saved by
  the operator under `/Users/leonardocandio/Downloads/` with names
  `WhatsApp Image 2026-10-06 at 17.38.16.jpeg` through
  `WhatsApp Image 2026-10-19 at 18.29.42.jpeg`. They are outside the
  repository and will not exist on another machine.
- Case mapping and per-file content:
  `analysis/2026-10-19-whatsapp-behavior-cases/sources.md`.
- Verbatim transcription, including the readability limits (three cropped
  bubbles):
  `analysis/2026-10-19-whatsapp-behavior-cases/transcription.md`
  (`Case A` line 128, `Case B` line 175, `Case C` line 204, `Case D` line
  256).
- Six Telegram composite images (`[Image #1]` to `[Image #6]`, Claudia's
  forwarded scroll) were used only to order the batches and to record her
  commentary, never for CRM text.
- The 32-turn turn table, findings, consolidated plan and the
  implementation package live in the same directory:
  `turn-table-2026-10-20.md` / `.csv`, `findings.md`,
  `consolidated-plan.md`, `implementation/FINAL-ENTRYPOINT.md`.
- IMPORTANT: the whole `analysis/` tree is untracked in git. The user chose
  "skip analysis for now" on 2026-10-22, so none of it is committed. If the
  supervisor works from a clone, the transcripts are not there.

Case to fixture to live case:

| Case | Guest / event | Fixture | Live case |
|---|---|---|---|
| A | Wilfredo, Giuly & Brian | `purchase-yape-receipt-no-match` | `live_behavior.receipt_without_backend_purchase_escalates` |
| B | Luis Miguel, Michi & Chino | `purchase-cod-reference-unavailable` | `live_behavior.cod_unavailable_never_denies_twice` |
| C | Mirta Lopez, Baby Shower | `purchase-approved-host-receipt-refund` | `live_behavior.derivation_accept_executes_takeover`, `live_behavior.host_receipt_fact_in_judge_evidence` |
| D | Silvia Morales, Nicolas | `purchase-declined-card-transfer-pending` | `live_behavior.repeat_signature_backstop_escalates_terse_loop` |
| twin | two approved purchases | `purchase-ambiguous-two-orders` | offline twin only |

## 2. What was implemented in this round

The customer-assistance lane carried five proxies for one fact the runtime
never stored: a needs-human probability, a loop-risk rubric, a
capability-blocked streak, a money-signature repeat count and a
capability-blocked backstop. The change replaces them with one record.

- `src/core/open-request.ts` (new): at most three records
  `{key, opening_text, state, since, turns}`, states
  `answered | needs_input | with_person | unresolved`, written from the
  effect of the turn. `escalate` records the real handoff outcome
  (`with_person` only on a confirmed takeover), `answer` settles only when
  the turn settled the request and the money evidence agrees.
- `src/runtime/decisions-router-policy.ts`: five rules in fixed order
  (pause a turn about the parked request, escalate a request that came
  back unresolved, escalate an explicit person request, honour one offer,
  otherwise follow the route). The guard added on 2026-10-22: a
  conversation that already has a person cannot escalate again.
- Router input reduced to three typed choices: `route`,
  `same_open_request`, `request_settled`
  (`src/runtime/decisions-router-input.ts`, `-client.ts`, `-lane.ts`,
  `-questions.ts`, `prompts/router/*`). `capability_blocked.txt`,
  `loop_risk.txt` and `needs_human_now.txt` are deleted.
- Deleted with the gates: `capability_blocked_streak`,
  `limitation_already_stated`, `prior_limitation_turns`, the money
  signature as a decision input, and the pre-router soft-pause
  short-circuit, so the pause is now the policy's decision.
- Plan schema: `open_requests` capped at 3.
- `support_outcome.repeat_count` and `support_outcome.signature` remain as
  inert storage. The signature still guards the merge of the one-turn
  reported-payment signal, so removal needs replacement merge semantics.
  This is deliberate, not an oversight.

Commits (nothing pushed):

| Commit | Subject |
|---|---|
| `5f2429ff` | Replace the stuck-detection gates with one open-request record |
| `a9108bc6` | Register the open-request behaviour and retire the limitation-memory pins |
| `34051051` | Answer a different request instead of escalating a parked thread |
| `02d23684` | Keep the open-request list bounded when every slot is parked |
| `21e14ace` | Reconcile the frozen support-gate count with the new live case |
| `8d67e208` | Print the open-request record in the probe summary |

The implementation log records the fifth commit as `8d67d208`; the real
hash is `8d67e208`. Fix that line.

Artifact: `.artifacts/recap-agent-collapse4.zip`, SHA-256
`749a75fb6cfbe1aef0059394798ce8a1171ba20312e138c1d18d6b80cb700e55`
(re-computed on 2026-10-23 and it matches). Development Lambda
`recap-agent-runtime-dev` reported `CodeSha256`
`dJp1+2z74a7wBZOUeYzooRcbogMS4TjB0Y1rgMtwDlU=` at deploy time, with
`AgentFeatureDecisionsRouter=true` and all models `gpt-6-luna`.

The bundle itself was inspected on 2026-10-23 and contains both fixes:

- `lambda/index.js` has
  `current?.state === "with_person" ? { kind: "answer" } : { kind: "escalate", reason: "explicit_person_request" }`
  in `decideRouterPolicy`.
- `lambda/index.js` has the bounded pruner
  `while (kept.length > OPEN_REQUEST_LIMIT)`, evicting a settled record
  before a parked one.

So the artifact is newer than the fix commits in content, even though the
zip timestamp is 18:52Z and the commits are 18:54Z: it was built from the
working tree before the commits were made. Do not "fix" this by rebuilding
unless you also redeploy.

## 3. What failed, and what was done about it

**F1. A second escalation on a parked thread (fixed).** A probe asked an
event-date question on a thread whose refund was already with a person.
The router answered `escalate_human`, the policy escalated again, a second
record was parked, and the reply claimed a new review without the date.
It did so twice (probe turns at 18:39:50Z and 18:40:41Z). Fixed in
`34051051`: with a record `with_person`, `escalate_human` becomes `answer`.
An `unresolved` record still escalates, which preserves the retry path.

**F2. Bounded list that could overflow (fixed).** The pruner computed
`OPEN_REQUEST_LIMIT - parked.length` and passed it to `slice`, so three
parked records produced `slice(-0)`, which keeps everything. The fourth
record failed the plan schema and the turn returned HTTP 500. Fixed in
`02d23684`: the newest record never loses its slot, a settled record gives
up its slot first, and an all-parked list loses its oldest parked record.

**F3. `dist/` was root-owned (fixed by the user).** `npm run deploy` could
not replace `dist/`, left over from 2026-09-22. The artifact was built with
`BUILD_OUTPUT_DIR` and deployed with `DEPLOY_ARTIFACT_PATH`. The user ran
`sudo rm -rf dist`; a fresh `npm run build` is user-owned again and the
plain deploy path works.

**F4. Eleven implementation-log entries were missing in the working copy
(fixed).** They were restored from HEAD before committing, per the user's
choice.

**F5. The probe ran against a phone the fixture does not seed (open, no
code change).** `evals/fixtures/purchase-approved-event-date.json` seeds
`guestOrders`, `guestGiftPurchases` and `guestEvents` only for
`51900000406`. The probe ran on `51900000407`, so every source returned
empty and the reply said "no encuentro un evento asociado al regalo".
That reply is correct for the data available; the search was not skipped.
Do not repeat the earlier conclusion that the information lane failed to
read. See section 6.4 for the proposed guard.

**F6. The implementation log has a wrong commit hash (open).**
`8d67d208` should be `8d67e208`.

**F7. Two behaviour-changing fixes have no coverage entry (open).**
`evals/live-behavior-coverage.yaml` has entries for `5f2429ff` only.
`34051051` and `02d23684` change what the runtime does (answer instead of
escalate; reply instead of 500) and the repository law requires a separate
entry each, pointing at a mandatory live case with hard objective
assertions and no semantic judge. `tests/live-behavior-coverage.test.ts`
passes because it validates the entries that exist, not the commits that
lack one.

**F8. The full suite is not reliably green (open, measured today).** On
2026-10-22 the suite was 211 files / 1697 passed / 1 skipped. Re-run on
2026-10-23 at HEAD `079cf2a9` it was 209 passed / 2 failed files and 1694
passed / 3 failed tests: `tests/eval-run-manifest.test.ts` (2) and
`tests/profile-inference-e2.test.ts` (1). All three are 5000 ms timeouts
under full parallelism; both files pass in isolation (30/30, 5.4 s). Treat
the suite as load-sensitive and raise `testTimeout` or run the two files
serially before claiming green.

**F9. AWS credentials expired (open).** `se-dev` returns "Your session has
expired. Please reauthenticate using 'aws login'." The deployed
`CodeSha256` could not be re-read on 2026-10-23.

**F10. The delegated explorer session died (process note).** Its API key
expired mid-task. The support-lane read path was traced locally instead:
`src/runtime/agent-service.ts:1003` calls `prepareCustomerContextForTurn`
before the router on every router-owned customer-assistance turn, and
`src/runtime/information-orchestrator.ts:549` reads purchase discovery,
associated events with all authorized event details, and the verified
phone account events. It is not gated by `information_request_count` and
not affected by a parked thread.

## 4. Evaluation and end-to-end results

### 4.1 Offline

At the time of the implementation entry: `npx tsc --noEmit` clean,
`npx eslint .` clean, 211 files / 1697 passed / 1 skipped. New direct
tests: `tests/open-request.test.ts` (11, including the bounded-list
overflow) and `tests/decisions-router-policy.test.ts` (42, including the
parked-thread guard and the preserved retry path).

Re-measured on 2026-10-23: the two files above pass in isolation; the full
suite has the three load timeouts in F8. Re-run everything in section 7.1
before accepting the offline state.

### 4.2 Targeted live case

Run `eval-2026-10-22T18-36-38-406Z-035e6cf9`,
case `live_behavior.question_after_takeover_is_answered`,
`status: passed`, `hardGatePassed: true`, score 1.0, USD 0.001534,
15.9 s, 8 tool calls, 2 turns, 0 judge calls.

| Expectation | Severity | Result |
|---|---|---|
| `takeover-happens-once` | hard | pass, handoff attempts 1, successes 1, replays 0 |
| `the-record-parks-the-request-with-a-person` | hard | pass, `human_escalation.status` matched |
| `the-second-turn-does-not-take-the-conversation-over-again` | hard | pass, turn 1 delta 0/0/0, cumulative 1/1/0 |
| `the-parked-request-survives-an-unrelated-question` | hard | pass, `open_requests.0.state` matched |
| `the-unrelated-question-is-handled-by-the-information-lane` | hard | pass, `next_node` matched |

### 4.3 Supervised probe

Phone `51900000407`, scenario `purchase-approved-event-date`, run
`objh-collapse-20261022`, against the deployed development Lambda with the
mocked fixture backend. Guest text is operator-written; delivered text is
read from the development perf table.

| Time (Z) | Guest | Agent | Route |
|---|---|---|---|
| 18:37:55 | Señores, quiero la devolución del dinero. Pagué S/ 150 y no me llegó nada. | La solicitud anterior de derivación no llegó a gestionarse y este turno no se volvió a enviar. Entiendo que pides la devolución; el mensaje anterior indicaba una compra aprobada por S/ 180, mientras que ahora reportas un pago de S/ 150 y q... (preview truncated at 120 chars) | human_escalation |
| 18:38:56 | Sigo esperando la devolución de mi dinero. Insisto, por favor. | He solicitado la derivación para que revisen tu caso y la devolución pendiente. Por favor, espera a que te contacten por este canal. | human_escalation |
| 18:39:32 | ¿Y la devolución de los S/ 150 ya está aprobada? | (no assistant message recorded) | human_escalation |
| 18:39:50 | Otra consulta aparte: ¿me confirmas qué fecha tiene el evento del regalo? Quiero saber si llego a tiempo. | He solicitado una revisión para ayudarte con la devolución que reportaste y confirmar la fecha del evento del regalo. Por ahora no tengo una fecha verificada; ¿puedes esperar a que revisen ambos temas? | human_escalation (F1) |
| 18:40:41 | ¿A qué hora empieza el evento? Solo eso, gracias. | Tu consulta sobre la hora de inicio se derivó para revisión, donde podrán confirmar el horario. | human_escalation (F1) |
| 18:50:40 | ¿Me confirmas qué fecha tiene el evento del regalo? Es lo único que necesito. | No encuentro información del evento del regalo asociada a este contacto, así que no puedo confirmarte la fecha. Si me compartes el nombre del evento o el número de pedido, puedo ayudarte a identificarlo. | information_batch |
| 18:53:46 | ¿Qué fecha tiene el evento del regalo? Solo necesito ese dato. | No puedo confirmar la fecha: no encuentro un evento asociado al regalo en la información disponible. | information_batch |

The 18:50:40 and 18:53:46 records show the guard from `34051051` working
live: `router_decision.route = "escalate_human"` while the turn was
answered by `resolver_consultas_informativas` instead of escalating again.
The empty gift/event facts are F5, not a search failure.

### 4.4 End-to-end supervision

The skill, objectives A to O, rubric L1 to L9, protocol and the 2026-10-21
ledgers are under `evals/e2e-supervision/`; the supervised transcripts are
`analysis/2026-10-19-whatsapp-behavior-cases/artifacts/supervised-transcripts-2026-10-21.md`.
No ledger was written for the 2026-10-22 probe turns above, and their
replies were not qualified against L1 to L9. That is a protocol gap, not a
pass.

## 5. Transcripts

### 5.1 Live case, exact delivered text

```
Turn 1 guest: Quiero que me pase con una persona del equipo, por favor. Es sobre la compra del regalo.
Turn 1 agent: He solicitado que una persona del equipo revise contigo la compra del regalo. No puedo confirmar que ya se haya incorporado alguien a esta conversación.
              node solicitar_agente_humano, 8.1 s

Turn 2 guest: Gracias. Una cosa aparte: ¿qué fecha tiene el evento del regalo? Quiero confirmarla antes de viajar.
Turn 2 agent: El evento «Celebración de prueba» está fechado el 12 de diciembre de 2026.
              node resolver_consultas_informativas, 7.8 s
```

### 5.2 Probe thread

See the table in 4.3. The probe stores one turn per invocation; the raw
records are in `recap-agent-runtime-dev-perf` under
`gsi1pk = CHANNEL_USER#whatsapp#<sha256(phone)>`.

## 6. Open items, in the order to close them

**6.1 Re-authenticate and verify the deployed identity.** Run
`aws login --profile se-signin`, then `aws sts get-caller-identity
--profile se-dev` (must be account `684516060775`, `us-east-1`) and
`aws lambda get-function-configuration --function-name
recap-agent-runtime-dev --query CodeSha256`. It must equal
`dJp1+2z74a7wBZOUeYzooRcbogMS4TjB0Y1rgMtwDlU=`. If it does not, rebuild
and redeploy before any live run, because everything in section 4.2 is
attributed to that artifact.

**6.2 Add the missing coverage entries.** One for `34051051` (parked thread
does not escalate a different request) and one for `02d23684` (bounded
list). Each must name a mandatory live case with hard objective
assertions; no semantic judge. Then run
`npx vitest run tests/live-behavior-coverage.test.ts`.

**6.3 Decide how to pin the guard live.** The live case in 4.2 asserts the
outcome (no second takeover, record survives, information lane answers),
but its router call is probabilistic and returned `answer_with_records` in
that run. The guard from `34051051` is only exercised when the router
returns `escalate_human`. If you require deterministic coverage of that
branch, the honest options are a scripted router in an offline test (it
exists: `tests/decisions-router-policy.test.ts`) plus a live case that
asserts the outcome and states that the branch is not pinned. Do not add a
keyword or a route override to force it.

**6.4 Guard the probe against unseeded phones.** `scripts/supervised-probe.mjs`
accepts any `--user-id` / `--contact-phone` without checking that the
scenario seeds that phone. A run on an unseeded phone is indistinguishable
from "searched and found nothing" and already produced one wrong
conclusion. Make the probe read the fixture's `guestOrders`,
`guestGiftPurchases` and `guestEvents` keys and fail closed when the phone
is absent, unless the operator passes an explicit override.

**6.5 Fix the documentation defects.** `docs/implementation-log.md`:
`8d67d208` to `8d67e208`, add the 2026-10-23 findings (F8 timeouts, F9
expired session, F5 probe-phone cause), and record the artifact
re-inspection.

**6.6 Write the missing ledger and qualify the replies.** Apply L1 to L9 to
the seven probe replies in 4.3 and write a ledger under
`evals/e2e-supervision/ledgers/` with the artifact identity and the phone
reset. Two candidates are already visible: "No puedo confirmar la fecha"
as the main clause is uncertainty-as-the-message (L1/L2 class), and the
18:39:50 reply asks the guest to wait on two fronts in one frame.

**6.7 Decide the `analysis/` status.** The four-case transcripts, the
supervision ledgers' companion artifacts and the turn table are untracked.
Either commit the text files (no screenshots) or record why they stay
local.

**6.8 Deferred product work, do not start without the user.**
`support_outcome.repeat_count` / `signature` are inert storage;
`human_escalation.status` has only `none | requested`, so a parked request
stays parked for the thread with no exit; the router emitted
`request_settled_probability: 1` together with `request_settled: false`
on the 18:53 turn, which is an internal inconsistency worth a validation
decision.

## 7. Commands the supervisor should run

### 7.1 Offline

```bash
npx tsc --noEmit
npx eslint .
npx vitest run tests/open-request.test.ts tests/decisions-router-policy.test.ts \
  tests/live-behavior-coverage.test.ts
npx vitest run tests/eval-run-manifest.test.ts tests/profile-inference-e2.test.ts
npx vitest run            # expect the F8 timeouts until they are handled
```

### 7.2 Artifact inspection

```bash
shasum -a 256 .artifacts/recap-agent-collapse4.zip   # 749a75fb...
python3 - <<'PY'
import zipfile
d = zipfile.ZipFile('.artifacts/recap-agent-collapse4.zip').read('lambda/index.js').decode()
assert 'current?.state === "with_person" ? { kind: "answer" }' in d
assert 'while (kept.length > OPEN_REQUEST_LIMIT)' in d
print('artifact carries both fixes')
PY
```

### 7.3 Deploy and targeted live

```bash
DEPLOYMENT_ENV=development npm run deploy
npm run eval:behavior-live -- --case live_behavior.question_after_takeover_is_answered
```

Never run the unfiltered live gate. Retry only with a new user
instruction, and record the run id, artifact identity and cost in the
implementation log.

### 7.4 Probe (only after the phone guard from 6.4 exists, or with eyes open)

```bash
node scripts/supervised-probe.mjs \
  --scenario purchase-approved-event-date \
  --user-id 51900000406 --contact-phone +51900000406 \
  --run-id <new-run> --case-id <case> \
  --text "<operator-written message>"
```

Use only synthetic `51900xxxxxx` phones. Purge the whole partition before
the first turn, not only `PLAN`
(`node scripts/purge-terminal-plans.mjs --channel whatsapp --phone
<phone> --dry-run`, then `--yes`).

## 8. Constraints that must not be violated

- Every delivered sentence is model-written. No canned prose, no
  post-generation replacement, no deterministic conversational questions.
- No keyword or exact-string matching decides flow. Decisions come from
  typed state and structured model output.
- Prompts stay in Spanish; code, comments and docs stay in English.
- `live_behavior_regression` takes hard objective assertions only. No
  semantic judges, style pins, byte budgets or internal-node pins.
- Targeted live cases only, selected explicitly. Report failures as they
  appear; never retry a semantic failure to make it pass.
- `se-dev` only, `us-east-1`, account `684516060775`. No production
  change without an explicit instruction.
- Redeploy the development Lambda after any runtime, prompt,
  infrastructure or dependency change.
- Keep the implementation log current for every change, with the reason
  and the decision.
