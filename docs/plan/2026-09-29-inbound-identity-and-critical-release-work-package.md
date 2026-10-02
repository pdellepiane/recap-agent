# Inbound identity and critical release work package — 2026-09-29

## Objective and release decision

Make every consented inbound WhatsApp message traceable from the native message through the channel adapter, agent HTTP endpoint, plan, tool calls, effect receipt, and delivered reply. Accept legitimate international numbers without assuming a Peruvian sender. Recover Sinar's unanswered decline only after its identity and prior effects are verified. Correct event-local time handling and the remaining genuine behavior failures. Rebuild a release gate that distinguishes product defects from stale assertions and judge mistakes.

This is a delegatable implementation specification, **not an authorization to execute a new paid live run or promote production**. Production remains on its existing artifact. The prior development gate formally passed 17/28 cases; the full offline run had 125 failures across 32 files. The development artifact deployed before this package was SHA-256 `b5fbabbfaf8c6b56ab944e52e81ee318ced15681a79029044fa4fc76c0a86cc4`. Subsequent timezone source and oracle edits are local and undeployed. Preserve all existing unrelated worktree changes.

## Evidence and root-cause hypotheses

1. The supplied screenshot labels Sinar with `96170197268`. Parsed as `+961 70 197 268`, it lies within Lebanon's published `+961 70` GSM range (ITU [Lebanon numbering plan](https://www.itu.int/dms_pub/itu-t/opb/sp/T-SP-OB.1325-2025-OAS-PDF-E.pdf)). This establishes a credible foreign-number explanation; it does not prove that this is the exact value posted to Lambda or that a specific subscriber owns it.
2. `src/runtime/phone.ts` recognizes only `+51`, `+52`, and `+1`. `src/lambda/request-contract.ts` rejects every other country code for a WhatsApp `contact_phone`. A valid Lebanese guest would therefore receive HTTP 400 before agent execution if sent in international form.
3. Agent API message `28488` stores the explicit decline at `2026-09-28T16:18:50Z` but has no native WhatsApp message ID in the audited record. No matching runtime performance record or identity-hashed Lambda log was found. Production Lambda request `732f10a2-2aa5-45bf-94a8-78bcfe398fce` at `16:19:02.181Z` was authenticated and returned 400 for `contact_phone`; four earlier requests with the same accepted bearer identity failed likewise. The Lambda log records `request_body_present=true`, validation issue, and request ID, but no supplied phone, native message ID, or JSON. Because identity is assigned after schema validation, the 16:19 request cannot be attributed to Sinar from available records. It was production traffic, not the development evaluation run.
4. The adapter repository and its HTTP request/response logs are not present in this workspace or this AWS account's CloudWatch log groups. The channel integration contract in `docs/channel-integration.md` defines adapter ownership of sender mapping, retries, and delivery. Do not infer exact payload bytes from the UI display or temporal proximity.
5. The shared synthetic RSVP fixture stores `18:00Z`/`19:00Z` and event timezone `America/Lima`. Taking the API at face value gives local `13:00`/`14:00`. Four case rubrics had expected the unconverted hours. Their local oracle revisions and a source projection change are currently undeployed. Offset-free API dates remain wall-clock values unless the backend contract says otherwise.

## Binding invariants

### Intake, authorization, and traceability

- Every authenticated native inbound has one stable channel-native message ID and one correlation ID carried through adapter send, Lambda response, Agent API record, runtime trace, effect receipt, and outbound delivery. A validation failure still produces a durable terminal outcome tied to the native message ID.
- The adapter derives `contact_phone` only from the authenticated WhatsApp sender field. It sends a canonical international number and never prepends `+51` to an ambiguous display value. The caller's country is not inferred from the event's city or the current customer profile.
- Parsing a phone establishes numbering structure, **not** ownership. Authorization remains the trusted channel identity plus exact phone-scoped backend lookup. Never transfer a previously authorized guest record to a different normalized number.
- A malformed or unparseable number produces a correlated, actionable failure. A valid international number unsupported by a downstream API does not disappear or become “no invitation”; expose the incomplete source and route to an approved recovery path.
- Every inbound must reach one terminal status: delivered reply, intentional suppression with reason, verified effect with reply, human escalation, or correlated failure awaiting recovery. An Agent API `received` row with no terminal outcome beyond a short bounded window is an incident, not a normal pending state.
- Exact request capture is permitted by the stated customer consent, but only after adapter authentication, with scoped access, encryption, retention, and an audit trail. Do not put raw phones, messages, bearer tokens, or full payloads in broad CloudWatch logs or model prompts. Never capture the Authorization header.

### Conversation and effect correctness

- Preserve every authorized customer record and field with source coverage. Failed invitation or purchase reads mean **unknown**, not an empty global result.
- Select RSVP targets by exact authorized event/guest IDs. Report attendance or companion success only from verified same-entity receipts. Do not infer an own-attendance change from a companion request or a declined event from another candidate's state.
- Use the API timestamp's explicit offset and verified event timezone together; a projected local hour must include its local date and zone. Offset-free timestamps retain their recorded wall clock; a date-only value has no hour.
- Commission answers use the complete verified article and calculator link. Do not generate new fee arithmetic or a flat percentage from incomplete evidence.
- Tests must assert customer-visible behavior and effect receipts, not internal node names, obsolete evidence-preview fields, exact prose, or unsupported source facts. Every reported interaction becomes a permanent live case with hard structural checks and a hard `text_semantic` judge.

## Workstream A — Prove the actual Sinar path and repair the attendance

**Owner:** channel integration investigator, paired with operations. **Files/systems:** channel adapter repository and logs, Agent API message `28488`, production Lambda logs, RSVP backend; read-only until a replay is authorized by verified state.

1. Locate the native WhatsApp webhook record and adapter outbound HTTP attempt for the decline at `2026-09-28T16:18:50Z`. Collect native sender, native message ID, signed webhook verification result, exact normalized JSON sent to the Lambda, destination URL, outbound request ID, response status/body, retry attempts, and delivery decision. Use a protected evidence artifact; redact copies used in general reports.
2. Correlate that outbound attempt with production Lambda request ID `732f10a2-2aa5-45bf-94a8-78bcfe398fce`. If unmatched, state that explicitly and inspect other production callers using the same accepted bearer key. Do not label the nearby 400 as Sinar's until the adapter's request ID or native message ID establishes it.
3. Confirm Sinar's exact trusted international sender identity and whether the Agent API stores an invitation for that same identity. Check the current per-event RSVP state and effect receipts for the target guest/event. Do not use the screenshot's display digits as authorization.
4. If the decline never executed and the exact invitation is still unanswered, process it through the normal idempotent RSVP path with the original native message ID or a documented recovery ID; verify the fresh backend state and customer reply. If it already executed or remains ambiguous, avoid a second write and send the case to human support with the evidence and recovery status.

**Done when:** the native message is tied to a specific Lambda request or a documented absence of one, the exact failing field is known, the RSVP state is verified, and the user-facing recovery has a recorded outcome.

## Workstream B — International phone identity without a country allowlist

**Owner:** runtime identity engineer. **Primary files:** `src/runtime/phone.ts`, `src/lambda/request-contract.ts`, `src/runtime/agent-service.ts`, `src/runtime/plan-completion-executor.ts`, `src/runtime/agent-conversation-gateway.ts`, and associated tests. Coordinate contract changes with the adapter and Agent API owners.

1. Replace the three-country `COUNTRY_RULES` with a maintained, metadata-backed international parser. Evaluate a vetted libphonenumber implementation and pin its metadata/version; Google's [library documentation](https://github.com/google/libphonenumber) distinguishes possible/valid number structure from actual ownership. Require canonical E.164 input at the WhatsApp adapter boundary while continuing to tolerate any already-supported safe wire form only if existing clients need it.
2. Return explicit typed outcomes for malformed input, missing international prefix, valid parsed number, and valid number rejected by a downstream provider. Preserve canonical E.164, country calling code, and national significant number separately. Avoid first-prefix heuristics (for example, mistaking `+961` for another `+96` prefix) and avoid country inference from message language or event location.
3. Audit every `splitInternationalPhone` caller and Agent API route that takes `phone_extension`/`phone_number`: guest events/details, orders, gift purchases, RSVP write/read, history, human handoff, and plan completion. Verify whether the Agent API itself supports `+961` read-only before enabling mutation for that country. A downstream limitation must surface as incomplete coverage or human help, never a global “not found.”
4. Preserve authorization and plan identity across canonicalization. Duplicate or retried inbound messages must reuse the same plan key and RSVP dedupe key. Migration of previously stored digit-only phone values must be explicit and lossless.
5. Update `docs/channel-integration.md` and the request contract to accept valid global E.164 while still requiring trusted WhatsApp sender provenance. Update error messages so “unsupported country” is not confused with malformed input.

**Offline matrix:** Peru, Mexico, NANP, Lebanon `+961 70` and other variable-length codes; digit-only local ambiguity; whitespace/punctuation; leading-zero national rules; too-short/too-long values; invalid symbols; duplicate message replay; exact Agent API country/national split; foreign number accepted at Lambda but downstream read failed. A positive `+961` case must reach the RSVP lookup with the exact trusted identity. A synthetic foreign RSVP decline live case must have hard one-write/final-state assertions and a hard semantic judge.

## Workstream C — Correlation and protected exact-payload capture

**Owner:** adapter engineer for sender/client logging; observability engineer for Lambda and infrastructure. **Primary files:** adapter repo, `src/lambda/handler.ts`, channel-request logging/redaction, `infra/cloudformation/stack.yaml`, `docs/channel-integration.md`. Use CloudFormation for all AWS resources.

1. Assign a correlation ID at verified webhook intake and forward it as a header. Preserve native `message_id` and normalized `user_id` in the request even if the body later fails validation. Return the correlation ID and Lambda request ID on every response, including 400.
2. Before request schema validation, extract *only safe, bounded identity fields* from an authenticated JSON object for structured logging: channel, native message-ID hash, stable user-ID hash, phone hash, parsing outcome, and correlation ID. Do not trust these fields for authorization until validation passes. Record the field path and typed error. This closes the current pre-validation identity gap without exposing raw PII in CloudWatch.
3. Store the exact authenticated outbound adapter payload and Lambda-received body in an encrypted, access-controlled diagnostic store keyed by correlation ID and native message ID. Exclude bearer credentials and unrelated webhook data; use a bounded retention/lifecycle policy and audit reads. Record body digest at both sides to prove byte equality without routinely opening payloads. Capture malformed JSON and 400s as well as successes.
4. Ensure the Agent API message row retains the native WhatsApp ID and correlation ID. Record adapter HTTP attempts, status/body, retry classification, and final delivery state. A 400 is a terminal adapter defect, not an automatic retry.
5. Add a reconciliation alarm/job: inbound `received` with no terminal agent/delivery status within a bounded window opens a recoverable incident. Dashboard dimensions include country code, validation reason, adapter version, endpoint, and delivery outcome, without raw phone labels.

**Done when:** given any consented inbound ID, support can locate its exact adapter payload, prove whether Lambda received identical bytes, see validation/result/effect/delivery, and diagnose a pre-validation 400 without guessing from timestamps. Test this on success, invalid phone, malformed JSON, timeout, duplicate, intentional suppression, and human takeover.

## Workstream D — Timezone contract and remaining behavior repairs

**Owner D1 (timezone/RSVP):** `src/runtime/openai-agent-runtime.ts`, timestamp projection, RSVP prompt, RSVP tests, four versioned live case oracles. Treat explicit `Z` as UTC and convert to verified event `America/Lima`; prove date rollover and multi-event separation. Do not convert offset-free wall times or fabricate a zone. The current local edits are a starting point only and require independent review, offline verification, and development deployment.

**Owner D2 (RSVP state/effects):** `src/runtime/agent-service.ts`, RSVP evidence/receipt projection, outcome-scoped prompts. Resolve the current multi-candidate conflict using canonical per-invitation state with provenance; preserve contradictory raw records as visible conflict. A lookup failure must never be phrased as no invitation. A companion rejection must carry its backend reason and must not imply a requested own-attendance change. Review first-turn campaign decline and exact event/guest binding.

**Owner D3 (purchase/support/FAQ):** purchase source coverage, host-withdrawal first-turn routing, and commission source use. Partial purchase reads must explain which source failed and offer human help without asserting that no purchase exists. A host correcting “I am the bride” must not be pushed into an unsolicited provider menu. Retain the currently passing commission cases and the no-arithmetic invariant; use the published calculator for user-chosen amounts. Do not rewrite the pending-credit rubric solely to improve a score; adjudicate it against the fixture and customer question.

**Owner D4 (eval integrity):** version genuine oracle corrections with evidence; keep historical run verdicts. Review the remaining 125 offline failures file by file, beginning with information-flow, actual-request, token-usage, and prompt-loader clusters. Separate outdated assertion shape from true behavior regressions; never weaken authorization, effect, or semantic requirements to make a suite green. Register each conversational change in `evals/live-behavior-coverage.yaml` and run `tests/live-behavior-coverage.test.ts`.

Owners must agree on shared types before editing. D1/D2 share RSVP runtime files and should execute sequentially or under one owner. D4 owns eval YAMLs; D1–D3 own runtime and scoped prompts. All teams share the checkout: preserve others' edits, do not revert unrelated work, and keep commits atomic. Record each code/prompt decision and run/artifact identity in `docs/implementation-log.md`.

## Verification and release gate

1. **Preflight:** TypeScript typecheck, lint, changed-module tests, complete phone/ingress/timezone offline twins, prompt relevance and serialized byte measurements, `git diff --check`, and mandatory live-coverage registry. Classify every pre-existing offline failure; a residual genuine safety or functional failure blocks release. A repaired assertion must explain why the old expectation contradicted source evidence.
2. **Development deployment:** use only `se-dev` in `us-east-1`, refresh backing login through `se-signin` if needed, and fail closed unless STS reports account `684516060775`. Build a content-addressed artifact, deploy Lambda-impacting changes to development, and record stack/Lambda code SHA and model settings.
3. **Selected live evaluation:** freeze case IDs and paid-run budget before invocation. Include the 28-case critical panel, the new foreign-number inbound/RSVP case, exact Sinar campaign decline reconstruction, and any new separately registered behavior changes. Run only explicitly selected `npm run eval:behavior-live -- --case ...` cases; never run an unfiltered/full live gate, retry semantic failures, or broaden the panel without a fresh user instruction. Each interaction case needs hard structural/effect checks and hard `text_semantic` with `requireJudge: true`.
4. **Manual source/receipt audit:** inspect delivered answers, serialized customer/effect evidence, exact event/order IDs, commission citation/link, local date/time, payment disclosure, and native-to-runtime correlation. A judge error may be adjudicated only from saved evidence; its formal failure remains reported. Any unverified RSVP success, wrong guest/event mutation, false invitation absence, invented fee, wrong local time, or unmatched inbound blocks promotion.
5. **Production canary and recovery:** promote only the exact development artifact after the gate and adapter checks pass. Observe real foreign-number intake and terminal outcomes using the correlation path. Preserve a rollback artifact. Reconcile Sinar's decline under Workstream A, with one verified effect and no duplicate write.

## Handoff outputs

- An incident timeline tying Agent API message `28488` to a native message and adapter/Lambda request, or explicitly documenting the still-missing link.
- A versioned phone and channel request contract supporting legitimate global E.164 senders, including `+961`.
- Protected exact-payload evidence and redacted cross-system trace, plus an orphaned-inbound alert.
- Source-backed timezone projection and versioned live oracles for all affected cases.
- A per-case 28-panel disposition and per-file offline failure ledger, each marked product defect, oracle error, judge error, infrastructure failure, or unresolved.
- An exact development artifact/run manifest, release decision, and Sinar recovery receipt. No production promotion on an unresolved critical item.
