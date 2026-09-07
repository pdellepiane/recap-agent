# Evidence and corrected failure taxonomy

> Revision 2 policy notice: this file preserves historical observations and the original evaluation failures. The active implementation contract is plan.md revision 2. It supersedes prior upstream dependencies and resend expectations: local release uses current API fields, OTP permits one send/one verification with no resend, and unsupported or failed operations use truthful human escalation. Missing historical evidence does not block the specified local behavior. See contract-validation.md for the fresh shape check.

Audited 2026-09-05. Local source HEAD: `55a6c99b`. Evidence grades used here:
**observed** = screenshot, stored trace/request, or inspected source;
**inference** = causal interpretation supported by those observations;
**unresolved** = evidence missing for a more specific attribution.

## Baseline and scope

- `.continues-handoff.md` was already modified when this task began. It and the
  unrelated untracked `analysis/current-capabilities-paper-brief-2026-09-04/` were
  preserved.
- Both full reports were read. Current:
  `.eval-runs/eval-2026-09-05T01-33-57-291Z-e1e50919/report.json` (59 cases,
  43 passed, 16 failed, zero errors/skips). Previous:
  `.eval-runs/eval-2026-09-04T13-16-18-352Z-79745806/report.json` (30 passed,
  29 failed). The per-case comparison is in `case-matrix.csv`.
- Failure assertions, turn outputs, tool/auth traces and operational notes were
  inspected. Stored raw model requests were retrieved for José, María Paz,
  Roberto, and the Kiara evaluation reply. The whole 59-case raw-request corpus
  was not retrieved; absent request detail is not silently reconstructed.
- AWS STS initially verified account `684516060775` using `se-dev/us-east-1`.
  Reads covered production performance records and CloudWatch. The session later
  expired; the prescribed `aws login --profile se-signin` flow was started.
  No AWS mutation or customer action was performed. Historical artifact identity
  is from the handoff, not a fresh deployment attestation.
- Raw audit files stay private in `.openai-audits/` and
  `/tmp/recap-audit-2026-09-05/`. Durable notes retain only minimal incident facts
  and correlation identifiers; no credentials, OTP values, payment destinations,
  or full customer payloads are copied into this dossier or Notion.

## Reported interactions

### José — confirmed semantic/routing failure with history present

Source image: `WhatsApp Image 2026-09-04 at 18.24.24.jpeg` in Downloads.
Campaign message 16129, `admin_campaign`, 2026-09-03 21:56:12 UTC. Inbound 16677
at 2026-09-04 13:11:09 UTC; reply 16678. Follow-up 16679 at 13:11:35 UTC;
reply 16680. Traces:

- `01M1P8Q9MX0EMHERS8JTKF5VD3`
- `01M1P8R1DEXTVZ5P3129YSHF8E`

Both turns used the same plan. History was `available`, with one and three prior
messages respectively. The second classifier output included both
`action=respond` and `campaign_reply_kind=acknowledgement_only`; extraction's
summary said there was no new request, while `supportAct` and domain actions were
null. The selected route was `ask_event_context`, node `entrevista`.

The stored second reply request included campaign history, the earlier welcome,
empty provider state, planning missing fields, the broad capability catalog,
provider category suggestions and three category/location tools. This is not a
missing-history diagnosis or evidence of a race. The model was communicating a
badly selected planning outcome with unnecessary planning context.

Measured production request bytes (instructions/input, excluding tool/schema
bytes; these are observations, not proposed budgets):

| Turn | Classifier | Extraction | Reply | Reply tools |
|---|---:|---:|---:|---:|
| Initial greeting | 2,343 / 578 | 12,343 / 1,901 | 12,924 / 5,785 | 3 |
| Acknowledgement | 9,227 / 1,329 | 12,343 / 2,400 | 12,924 / 6,384 | 3 |

The acknowledgement used 44,607 instruction+input bytes across three model calls.
Current development has additional continuity guards, so the production trace
does not prove today's source still emits the identical welcome. Reproduce the
whole interaction against the current artifact, including closure quality: merely
replacing a welcome with another generic clarification is not sufficient.

### María Paz — confirmed unusable projection and loss of campaign focus

Source image: `WhatsApp Image 2026-09-04 at 18.19.00.jpeg`.
Trace `01M1MWD57P5HCM26A1DAWQK1BY`, agent reply 16598 at
2026-09-04 00:16:57 UTC. The runtime input was a coalesced greeting plus confusion.
The recent-message list contained `frontend_followup`, while `entry_source` was
null. No RSVP polarity was extracted. The reply projection contained **nine**
invitation candidates, eight with null names/dates, plus Baby Shower Julieta
dated 04/07/2026. The operational instruction explicitly asked the model to list
the invitations and request a selection. It did not provide the current reminder
as a trusted selected subject. The model's “eight unnamed events” answer follows
this unusable projection; it is not evidence it invented eight records.

Current read-only `/guest/events` returned only the old Julieta event, while the
screenshot shows the Marcelo invitation in the UI. That is present-day corroboration
of an API/UI coverage mismatch, not a snapshot of the original raw response.
The runtime's two lookup sources require separate coverage/identity semantics.
Do not discard all historical invitations by date alone: an explicit historical
question remains valid. For confusion about a reminder, explain that reminder
first and only ask a selectable question when a real decision is required.

The later corrected “Maria” reminder is stored as `frontend_followup`. The original
“40.” greeting is visible in the screenshot but absent from the current last-five
message response. Sender ownership is strongly indicated, but the original
personalization expression has not been inspected.

### Roberto — confirmed intent, no usable invitation; backend root cause open

Source image: `WhatsApp Image 2026-09-04 at 18.20.56.jpeg`.
Trace `01M1PMHPCKRCPDF0DGQ9HR6EW5`; inbound 16735, reply 16736.
Three preceding reminders are stored as `frontend_followup` (Aug 22, Aug 29,
Sep 4). Extraction correctly produced `rsvpAction=attending` with the event
reference. History was available and included all three reminders.

`lookup_rsvp_invitations` returned `not_found`; the canonical reply input carried
`resolution=not_found`, `reason=no_invitations`, `coverage=complete`. No attendance
mutation was called. The reply model followed that evidence. The current
read-only guest-events endpoint also returned HTTP 404 despite the UI invitation.

Investigate shared phone normalization, guest/invitation identifiers, endpoint
coverage, and source inclusion with the backend owner. No evidence yet selects
one of those as the exact bug. An outbound reminder proves outreach occurred;
it does not by itself authorize an invitation mutation. Represent contradictory
sources explicitly instead of confidently denying the invitation exists.

### Tito — screenshot confirmed, historical runtime attribution unresolved

Source image: `WhatsApp Image 2026-09-04 at 18.09.02.jpeg`.
The image shows a greeting using the ordinal, an attendance acknowledgement, then
relationship/thanks followed by repeated introductions. The visual ordering of
same-minute messages does not prove effect ordering or duplicate delivery.

OCR confirmed the phone ending 4780 (an initial visual transcription was corrected).
The current message endpoint returned an empty list and the guest-events endpoint
returned 404 for that identity. The corrected historical AWS audit encountered an
expired login. Therefore do not classify this as pre-runtime dispatch or a proven
model failure. Recover the original conversation identity and message IDs from the
upstream support system in S14. The screenshot still supplies a permanent behavior
specification for personalization and post-confirmation continuity.

## Corrections to the handoff's 16-failure classification

IDs below omit the common `live_behavior.` prefix. Hard failures remain blocking.

| Case | Verified boundary / uncertainty | Package |
|---|---|---|
| `otp_nondelivery_auto_resends_once` | Request-code attempted, unavailable because real customer writes disabled; test expects simulated resend success. | S02, S06 |
| `otp_number_words_are_verified` | Verification **was attempted** and blocked. Judge's statement that no attempt occurred contradicts the trace. Also calibrate attribution of a pending user request versus a verified purchase. | S02, S13 |
| `repeated_otp_failure_preserves_gift_query` | First verification unavailable; runtime enters handoff and later turns are paused. Test expects two rejected-code attempts in a different world. | S02, S06 |
| `rsvp_state_reversal_ends_confirmed` | No write tool was executed. Operational note says update service not configured; this is capability/composition mismatch, not an observed failed write response. | S02, S07 |
| `otp_not_received_requires_response` | Persisted exhaustion is ignored without fresh extraction action; code-entry guidance repeats. | S06 |
| `rsvp_declined_state_offers_one_change` | Read-only status suppresses the expected offer and clears pending state. Duplicate status text is also visible. Resolve policy explicitly. | S07, S10 |
| `purchase_kiara_pending_by_phone` | Stored model input says approved; hard rubric says pending. Case has no backend fixture. Model follows input. Historical wire mapping vs backend drift remains unproven; do not claim a confirmed merge bug. | S01, S08 |
| `purchase_joaquin_dedication_selection` | Unsupported mutation boundary prevents safe gift read/selection. Spanish output is visibly Spanish despite a judge complaint; structural missing-read failure is real. | S08, S13 |
| `active_cart_checkout_continuity_alex` | Pending order amount/status is attached ambiguously to a separate cart; unnecessary general transfer policy also appears. | S09 |
| `current_campaign_order_over_historical_declined_maria_jose` | Current event is retained, but disputed amount/provenance is flattened into an asserted recorded total. | S09 |
| `purchase_delia_status_by_phone` | Unavailable-reference path creates unnecessary uncertainty; redacted numeric fragment appears in output. Verify selected-record evidence and judge redaction separately. | S09, S13 |
| `purchase_martha_accountless_selection` | Missing selection question is visible. Event hallucination is not proven solely by this judge: no frozen backend fixture, and absence of guest association does not itself make an order's event label untrusted. Inspect field provenance. | S01, S08, S09 |
| `purchase_pending_transfer_continuity` | Final typed acknowledgement is too vague for the correction; intermediate capability clarification interrupts the question. Do not restore timezone conversion; separate reported and authoritative time/currency. | S09 |
| `ambiguous_confirmation_clarifies` | Clarification scope receives provider candidates. Assert their absence before composition. | S10 |
| `provider_reference_cheaper_option` | Selected-provider state and visible reply succeed; expected operation trace is empty. Trace contract question, not a demonstrated selection failure. | S13 |
| `customer_transaction_code_by_phone` | Judge downgrades an otherwise appropriate answer for not echoing a code; visible reference policy and redaction need explicit alignment. | S13 |

## Architectural findings with source anchors

Line numbers refer to the inspected HEAD; follow symbols if source moves.

| Observation | Source | Consequence |
|---|---|---|
| Service has 9,564 lines; runtime composer 2,493; information orchestrator 1,865 | `src/runtime/agent-service.ts`, `openai-agent-runtime.ts`, `information-orchestrator.ts` | Scope changes by responsibility and centralize wiring ownership. Size alone is not proof of a bug. |
| Classifier recognizes `admin_campaign` but not `frontend_followup` as campaign profile | `src/runtime/message-response-classifier.ts:144` | Current followups can lose campaign-specific interpretation. |
| Entry selection prefers admin campaign, else oldest retained message; only five messages kept | `src/runtime/turn-message-context.ts:182` | Current followup can be displaced by a historic message. Persist validated campaign focus in the canonical state if needed, not more raw history. |
| Current-message exclusion uses exact body/time fallback; coalesced body can differ | `src/runtime/turn-message-context.ts:221` | Characterize constituent message IDs; María Paz had zero excluded current messages. This is a duplication-of-context risk, not proof of duplicate processing. |
| RSVP reads two sources and enriches the sole associated event even if historical | `src/runtime/agent-service.ts:2440` | Separate coverage, identity and current campaign relevance; do not manufacture selectable labels. |
| OTP exhaustion requires a new recovery action | `src/runtime/agent-service.ts:4036`, `:5370` | Persisted counters cannot reliably terminate a loop. |
| RSVP write, model composition, then save | `src/runtime/agent-service.ts:2226`, `:2294`, `:2350` | Successful effect can precede a failing reply and unsaved result. Source-level risk; not the proven cause of these screenshots. |
| RSVP status query ties future offer to read-only status | `src/runtime/agent-service.ts:2190`; `src/core/rsvp.ts:32` | Introduce explicit offer disposition. |
| Capability-filtered extraction schema differs from text's action list | `src/runtime/openai-agent-runtime.ts:177`, `:824`, `:865` | One projection must own schema and advertised actions. |
| Clarification scope does not exclude separately projected provider candidates | `src/runtime/openai-agent-runtime.ts:991`, `:1047`, `:1112` | Structural exclusion beats another instruction not to mention them. |
| Inline operational prose; bundle loaded with different context in service/runtime | `src/runtime/agent-service.ts:2150`, `:4342`; `src/runtime/openai-agent-runtime.ts:373`, `:1033`; `prompt-loader.ts:98` | Policy provenance and request hash can disagree. |
| Purchase merge uses source priority; conflict sets coverage but still projects a preferred record | `src/runtime/information-orchestrator.ts:1319`, `:1408` | Per-field provenance and unresolved conflicts need a typed outcome. This is not proof it caused Kiara. |
| Finish-plan sends today's date, marks aggregate finished on partial success, mutates shared plan | `src/runtime/finish-plan-tool.ts:53`, `:106`; `openai-agent-runtime.ts:2185` | Risk of false event date, stranded failures and duplicate retry; add per-provider outcomes. |
| Fixture runtime exists and supports OTP/RSVP but still forwards provider effects | `src/runtime/eval-fixture-gateway.ts:446`, `:500`, `:964`; `src/lambda/handler.ts:678`, `:719` | Extend existing simulation with exhaustive effects; do not introduce a parallel fake backend. |
| Legacy RSVP isolation reads no prior state and restores decline; gateway constructed without explicit write block | `src/evals/rsvp-isolation.ts:63`, `:86`, `:154` | Not safe state isolation; replace it. No legacy hook executed during this audit. |
| Judge treats notes as established facts and gathers all scenario phone histories | `src/evals/runner.ts:805`, `:834` | Stale/or cross-subject expectations can contaminate grading. Scope to the effective case/turn fixture and provenance. |
| Plan Put lacks revision condition but handler uses a turn coordinator | `src/storage/dynamo-plan-store.ts:94`; `src/lambda/handler.ts:367` | Fault-test lease expiry/save before adding revisions or another lock system. |

## Required permanent incident cases (specifications, not implemented tests)

All new live cases belong to `live_behavior_regression`, have hard structural
assertions and a hard semantic expectation with `requireJudge: true`, and get
separate behavior-change coverage entries when implemented.

- `live_behavior.tito_numbered_name_and_post_rsvp_closure`: numbered CRM label,
  trusted guest name, sent reminder, verified attending outcome, relationship
  comment, thanks. No new planning lane or additional RSVP effect. Upstream
  personalization has its own sender contract test; Lambda alone cannot test it.
- `live_behavior.maria_paz_current_reminder_explanation`: old completed event,
  current reminder whose title resembles a greeting, eight unlabeled historical
  records, split greeting/confusion. Explain current reminder; no attendance write,
  no unusable candidate dump. Add an explicit switch to the old event as a contrast.
- `live_behavior.roberto_reminder_invitation_disagreement`: three prior reminders,
  explicit attending decision, UI-linked invitation but guest lookup empty/404.
  Preserve unresolved intent; no false success or definitive no-invitation claim.
  A companion case supplies a verified unique invitation and asserts one simulated
  write and final attending state. Multiple/ambiguous matches never auto-write.
- `live_behavior.jose_campaign_greeting_then_acknowledgement`: campaign, typo
  greeting, prior reply, acknowledgement/deferral. No provider tools/interview,
  repeated welcome, or RSVP mutation. Semantics allow a brief contextual closure
  or deliberate suppression, with expected delivery action checked structurally.

Freeze as-of time, source identity and endpoint outcomes. Include topic-switch,
late followup, duplicated transport, split/combined turn and unknown-name variants.
Do not copy real phone numbers or rely on live customer records for these fixtures.

## What was not established

No full current development replay of the four new incidents was performed, and
no fresh complete mandatory run was requested for this documentation-only task.
The exact sender name-selection code, full Tito trace, original raw purchase
responses for every unfixtured case, and backend idempotency support still need
verification. Performance summaries are post-turn evidence, not complete
historical persisted-plan snapshots. Do not infer current deployed code hashes
from local HEAD or from the timestamp of a screenshot.

## Planning-task verification

- `npx vitest run tests/live-behavior-coverage.test.ts`: passed, one test. This
  verifies the existing registry, not implementation of the proposed new cases.
- Local document links, 15 unique ticket references and dependency targets were
  checked. `case-matrix.csv` contains all 59 cases and the comparison confirms
  13 improvements and zero new failures in the two supplied runs.
- Notion Roadmap was queried after writes: 10 new planned tickets plus five
  existing tickets updated, all 15 with S01–S15 scope markers. Existing statuses
  were preserved; no defect was marked completed by this research task.
- The original handoff and unrelated work were not edited. Additional unrelated
  reviewer report files appeared during the task and were also preserved.
