# Support continuity, FAQ simplification, and environment isolation plan

Status: implemented as a development candidate; local gates pass. The isolated development Lambda and mandatory live behavior evaluation remain the final acceptance gates. Only the separately authorized neutral-authentication normalizer hotfix is eligible for production before broader approval.

Baseline: `aeb99dc4` on 2026-09-03.

Extended after authenticated AWS and stored-response audit on 2026-09-03. The audit changes the diagnosis and implementation order: repair the schema/normalizer contract first; do not add a lock or treat larger support memory as the root-cause fix for these sequences.

## Implemented scope

- The schema-accepted `authAction=null` purchase request is preserved as the domain value `none`; it is no longer silently converted into an empty request list.
- Purchase requests missing a required resource now produce a typed normalization issue and a bounded clarification path instead of a welcome or invented resource.
- A compact typed support act and support anchor preserve mailbox reports, new details, deferrals, policy questions, and document requests without persisting raw endpoint or knowledge-base payloads.
- Established support uses a dedicated extraction profile. The measured instruction bundle is 7,986 bytes versus 10,584 bytes for the comparable historical planning-enabled support path, a 24.5% reduction. It excludes planning, provider-management, close, and pause prompts.
- Pure support acknowledgments are rendered deterministically from the node-scoped Spanish prompt and use no reply-model, API, knowledge-base, or authentication call.
- A confirmation-document request performs one trusted-phone order-status lookup, exposes only canonical projected status evidence to the reply model, never infers a null currency, and requests human help once because no document-issuance endpoint exists. A repeated request cannot start another lookup or handoff after the first succeeds.
- Development and production now use explicit, fail-closed deployment targets. Development has a separate Lambda, URL, tables, log group, channel key, and secret paths; customer mutations are denied in development before network access.
- Permanent Carina and María Isabel live cases and deterministic offline twins were added. The Carina fixture now supplies both partitioned order data and the detailed gift-purchase contract, avoiding a fixture-only parser mismatch.

The original conversation lease remains unchanged: the authenticated trace audit proved these reported sequences used distinct inbound messages with uncontended leases and a persisted plan. Adding another lock would not correct their deterministic routing failures.

All three newly attached images were reviewed. They describe two distinct conversations, not three cases:

- [Payment-confirmation sequence](</Users/leonardocandio/Downloads/WhatsApp Image 2026-09-02 at 18.50.00.jpeg>)
- [Mailbox continuation](</Users/leonardocandio/Downloads/WhatsApp Image 2026-09-02 at 18.46.04.jpeg>)
- [Earlier transfer-proof context](</Users/leonardocandio/Downloads/WhatsApp Image 2026-09-02 at 18.46.03.jpeg>)

## Objectives

1. Stop generic welcome messages from replacing explicit payment, email, or FAQ questions.
2. Preserve the current topic across short multi-message sequences without confusing a new topic with a retry.
3. Reduce the planning-specific prompt and state burden on established FAQ/support turns without weakening prompt-injection resistance, disclosure controls, authentication, tool authorization, or event-planning behavior.
4. Establish a genuinely isolated development Lambda before testing additional behavioral changes, and promote the exact tested artifact to the existing production Lambda only after explicit approval.

## Evidence boundaries

The screenshots are evidence of user-visible behavior. Current Agent API results establish today's data coverage, not the historical payment state. Historical DynamoDB performance records, CloudWatch completion/lease logs, and stored OpenAI response outputs now establish the actual execution branches.

AWS authentication was refreshed and STS verified account `684516060775`. All AWS calls used `se-dev` in `us-east-1`. Six historical runtime turns were recovered: two payment-confirmation turns and four mailbox-sequence turns. Each had three completed model stages, a successful HTTP 200 completion, `delivery_action=send`, and one uncontended conversation lease. There was no invocation overlap within either recovered sequence.

The Agent API history endpoint returns only the latest five messages, with no documented pagination ([endpoint contract](</Users/leonardocandio/Downloads/AGENT_ENDPOINTS (5).md:123>)). However, history and the same saved plan were present during the audited follow-ups. The support context was recognized but not converted into usable control state. A compact support anchor remains a resilience improvement, not a demonstrated storage-loss fix.

Audit-only operations included GET retrieval of existing OpenAI responses/input items and an in-memory reproduction against the existing normalizer. No new model generation, customer mutation, Lambda invocation, deployment, or test-suite modification occurred.

## What happened in the reported cases

### Case A: payment-confirmation request repeated

Observed sequence:

1. An abandoned-cart campaign referred to a gift for a specific event.
2. The person asked for a payment confirmation.
3. The agent answered with a generic welcome and asked what they needed.
4. The person restated that they had bought a gift and wanted a payment confirmation.
5. The agent repeated the same welcome.

Verified current data coverage:

- A phone-scoped, unfiltered guest-order lookup finds the current event purchase as approved and also returns historical orders and a cart.
- The current typed response has a null currency. The agent must not infer PEN, USD, or a symbol from locale, payment method, screenshot, or event.
- The order has an opaque backend identifier. Filtering the endpoint with the numeric reference visible in the operator UI returns `not_found`; the unfiltered phone lookup succeeds. The current response does not expose a reliable mapping from that customer-visible number to the opaque identifier.
- The documented API exposes purchase status and a user-uploaded payment voucher, but no endpoint was found that issues or resends an official merchant confirmation or receipt. A voucher must not be described as a merchant confirmation.

Expected behavior:

- Interpret this as an actionable purchase-support request, not a generic FAQ and not event planning.
- Resolve the relevant current purchase from the trusted phone and campaign/event context without requiring email OTP.
- State that the purchase is recorded as approved, using only requested and verified fields.
- If the person wants a document to be issued or resent, clearly distinguish status verification from document delivery and hand off once because the current API does not provide that action. Do not claim that a confirmation was sent.
- If an amount is needed while currency is null, say `amount 375.50 via the recorded card payment method` in the conversational language, without a currency name or symbol.

Verified failure mechanism:

1. Both stored extractor outputs contained one `kind=purchase` request with `aspects=[payment_status]`, `resource=gift_purchases`, and `authAction=null`. The first also correctly identified the campaign event.
2. The model-facing schema explicitly permits null `authAction` ([wire schema](../../src/runtime/extraction-schemas.ts:99)).
3. `normalizeInformationRequest()` returns an empty list whenever `!request.resource || !request.authAction` ([normalizer](../../src/runtime/openai-agent-runtime.ts:294)). Therefore it silently discarded both valid wire-format purchase requests.
4. Performance records consequently showed zero information requests, even though the original model outputs contained them. A summary-only audit would incorrectly blame the extractor.
5. With no normalized information work and no provider need, the state machine chose `ask_event_context`, stopped at `no_provider_need_identified`, and entered `entrevista`.
6. The reply request used the welcome schema with mandatory `type=welcome`, greeting, scope, and question fields. It exposed only `list_categories`, `get_category_by_slug`, and `list_locations`, not a purchase or FAQ resolution path.

This is an LLM-output normalization bug, not a backend-order-response parsing bug, not exhausted phone lookups, and not an API 404/500. Neither turn called a purchase endpoint or FAQ search. It is also not evidence that the model failed to understand the request.

The absent explicit confirmation-document aspect remains a separate capability/representation improvement. It did not cause the normalized request to vanish in these traces.

Read-only reproduction against current code: the observed request is accepted by `openAiInformationRequestSchema`; normalization yields zero requests; the same in-memory request with `authAction='none'` yields one. Source files were not changed.

### Case B: bank proof, full mailbox, and repeated restart

Observed sequence:

1. The person uploaded a bank-transfer proof and said hello.
2. The agent sent a generic welcome.
3. The person explained that their registered Gmail account had no capacity and that they would send it later.
4. The agent asked about the email problem, then sent another generic welcome.
5. When the person clarified that the mailbox was full, the generic welcome was sent again.

Verified current data coverage:

- A phone-scoped guest-order lookup finds the current event order as pending and also finds older completed purchases.
- The current order has a null currency and a recorded transfer payment method. No currency may be inferred.
- The API can support the statement that the order remains pending. It cannot validate the uploaded image, prove that the transfer was received, approve it, or prove why a mailbox is full.
- Indexed policy may explain the general validation window for non-card/PayPal payments, but it must be projected as policy evidence, not as an order-specific backend fact.

Expected behavior:

- Preserve a small support anchor: current pending purchase, event, reported proof, mailbox-capacity issue, and the fact that the person intends to send something later.
- Acknowledge the mailbox issue and ask at most one context-relevant clarification only when the referent of `it` remains materially ambiguous.
- If the question is about the pending transfer, combine the phone-scoped status with the indexed validation policy. Do not inspect or validate the image, claim receipt, or bring in an old purchase.
- Do not restart, request email OTP, or repeat the capability introduction.

Verified failure mechanism:

- The stored extractor outputs for the Gmail issue, deferred submission, and final misspelled clarification (`Esta lkeno`) all returned `informationRequests=[]` and `actionIntent=null`.
- Their summaries nevertheless identified the mailbox issue and its continuation. The final summary explicitly said that the mailbox was full and that this continued the Gmail-capacity problem. The typo was understood; spelling correction is not the missing fix.
- Unlike Case A, no populated request was discarded here. This is a missing structured support-act/continuation representation followed by an unsafe planning fallback.
- All four turns used the same saved plan ID. Follow-ups loaded `entrevista`, recent history was available, and state persistence succeeded. The evidence does not support a lost conversation or failed plan save.
- All four selected `ask_event_context` / `no_provider_need_identified` and rendered `welcome`. No purchase lookup or FAQ search ran. A knowledge-base indexing failure cannot explain a retrieval step that never happened.
- Existing continuity logic recognizes some support details but depends on already-established information state and name/email/event-type fields ([continuity gate](../../src/runtime/agent-service.ts:3115)). A reported obstacle, deferral, or clarification needs its own typed support act even when it is not a new question.
- The repeated replies correspond to distinct native message IDs and separate successful invocations. Each lease was released before the next was acquired. Do not change batching or add a lock to fix this sequence.

The uploaded receipt is visible in the screenshot. The first greeting's stored extractor input contained a five-character image placeholder from the earlier inbound message, not image contents. No separate image-processing runtime turn was recovered in the audited window. Its dispatch/media-metadata path remains unverified; do not infer that the model inspected the receipt or that an image parser failed.

The last clarification's stored input still contained the Gmail-capacity message, the deferral, and both previous agent replies. The saved summary also mentioned the capacity issue. For this concrete failure, more transcript retrieval or a longer summary would not supply missing information; the missing step is structured support disposition.

## Authenticated audit record

Times below are UTC; the screenshots use Lima time (UTC-05:00).

| Turn | Trace ID | Completed at | Raw → normalized information requests | Runtime ms | Total recorded tokens |
|---|---|---|---|---:|---:|
| A1: confirmation request | `01M1HYW30NRBAEG101A0V57EWK` | 2026-09-02 21:02:20.182 | 1 → 0 | 8,160 | 10,645 |
| A2: repeated confirmation request | `01M1HYYC1VYXP0K1V91V4WZMT6` | 2026-09-02 21:03:34.977 | 1 → 0 | 9,376 | 12,509 |
| B1: greeting after proof | `01M1H5SX60WVEK7ZS5G3WV9TJC` | 2026-09-02 13:44:14.273 | raw output not inspected → 0 | 7,986 | 10,896 |
| B2: Gmail capacity | `01M1H5TSGV06Z4K7AVHA7Z0CVJ` | 2026-09-02 13:44:43.292 | 0 → 0 | 14,047 | 12,670 |
| B3: send later | `01M1H5V4A41JYM4Q4ZQ0HC3V6Z` | 2026-09-02 13:44:54.340 | 0 → 0 | 6,171 | 12,300 |
| B4: mailbox full | `01M1H5VWDBX8WZPMMW028SZ1P1` | 2026-09-02 13:45:19.019 | 0 → 0 | 8,826 | 12,325 |

All six classifier decisions were `respond`, without fallback; their health assessment was `progressing`. That assessment must not be treated as proof that the domain question was resolved. All six calls to information execution and RSVP execution had zero recorded duration and empty outcome lists.

All leases were acquired on attempt 1, with acquisition times of 6–57 ms. Release-event `wait_ms` values in the existing log helper represent elapsed held-turn time, not queue contention; use acquire events for contention analysis. There were six distinct native inbound IDs, six completion events, and six welcome outputs across the audited windows, not a single duplicated reply execution.

Key stored response references for reproduction:

- A1 extraction: `resp_0b710dd56708a23d006a988ed6ff4087d2af6d7dac8e5cdb0c`.
- A2 extraction: `resp_0d02e41b9e116a92006a988f20634887d282dd323660002934`; reply: `resp_0f1088fddbf7562f006a988f259d8c87d2af750529680015f2`.
- B2 extraction: `resp_094d0a107ecc8e5d006a98283faa0087d282a03652bc06c37b`.
- B3 extraction: `resp_0654f3d892f9d2cb006a982852549887d28f2f59ae8023e0f7`.
- B4 extraction: `resp_0e87d9c98d91efd8006a982867dfb487d28a14613b98817de2`; reply: `resp_0fa40b4233674641006a98286a692c87d2b318050f6a43aa12`.

No raw response bodies, phone numbers, tokens, payment identifiers, or private purchase payloads are stored in this plan. Use these trace/response references for authorized GET audits.

## Theory verdict

The theory is partly correct.

The current runtime remains planning-oriented at the extraction stage. It sends provider needs, shortlists, event-plan fields, contact fields, information state, and RSVP state to the extractor even when the established task is a narrow support continuation ([extractor snapshot](../../src/runtime/openai-agent-runtime.ts:750)). The reply path already removes provider results for information turns, but the overall information reply bundle remains broad ([reply projection](../../src/runtime/openai-agent-runtime.ts:882)). Local static measurements must be reproduced before implementation, but the current baseline indicates approximately:

- 5,721 instruction bytes for an information/contact extractor profile;
- 8,972 bytes for the corresponding initial-planning profile;
- 11,962 bytes for the active broad profile;
- 13,311 bytes for the current FAQ reply bundle.

This supports a meaningful prompt-size reduction for established support turns. It does not support replacing the entire state machine with an unguarded retrieval call. FAQ and support still require typed routing, disclosure policy, ambiguity handling, authenticated mutations, terminal handoff state, conversation locking, and safe switching back to RSVP or planning.

The live audit strengthens the diagnosis but changes priorities. Repair the wire-to-domain contract and support fallback first. A specialized support lane is a subsequent prompt-scope optimization inside the existing state machine, not a prerequisite rewrite and not a second agent architecture.

Measured historical cost: the six unsuccessful replies used 18 completed model calls and 71,345 total recorded tokens, including 33,843 cached input tokens. Each turn used roughly 10.6–12.7k total tokens and 6.2–14.0 seconds of runtime. These are recorded totals, not uncached billable tokens or end-to-end WhatsApp latency.

The stored extraction instructions were 11,461–11,552 bytes plus 1,938–2,831 input bytes for the audited support turns. The stored welcome reply instructions were 12,916–12,924 bytes plus 5,948–6,780 input bytes, with three irrelevant planning tools. The general classifier alone carried 9,227 instruction bytes after the first turn. Thus there is measured scope for reduction, but preserve the classifier's delivery controls while measuring a smaller profile; do not remove it merely because these domain routes failed.

## Proposed design

### 0. First behavioral fix: lossless, typed extraction normalization

- Treat `authAction=null` as no authentication action for a valid read-only purchase request. Normalize it to the domain value `none`; this grants no authorization and must not bypass trusted-phone binding, account authentication, or sensitive-field restrictions.
- Align the model-facing schema and domain normalizer. Every schema-accepted purchase request must either become a valid domain request or produce an explicit typed normalization issue. Never silently convert an actionable request into an empty list.
- A missing resource or other genuinely insufficient field must preserve the unresolved request and produce a bounded clarification/unsupported outcome. Derive resource choice only from validated requested aspects where the existing orchestrator already owns that decision. Do not guess identifiers, credentials, currency, or permissions.
- Keep valid requests in a mixed batch; represent invalid members individually. Do not erase the entire batch or mark partial acceptance as complete.
- Add sanitized normalization evidence: pre-normalization count, accepted count, rejected count, request kind, affected field, and reason code. Do not log queries or raw model output. The runtime must distinguish `no_request_extracted` from `request_rejected_by_normalizer`.
- Any rejected actionable request blocks the generic welcome fallback. Resolve the validation issue or offer the bounded support path.
- Preserve current minimum-request orchestration: once the Case A status request survives normalization, its status aspect selects `/guest/orders` even if the model supplied the broad `gift_purchases` resource hint.

This is the smallest directly verified correction. It needs no extra model call, no new persistent store, and no concurrency changes.

### 1. Typed conversation lane and support anchor

Derive a bounded `conversation_lane` from the existing node, information request, handoff state, and validated extraction. It is a prompt-selection view, not a second persisted routing authority:

- `planning`
- `public_faq`
- `purchase_support`
- `event_support`
- `rsvp`
- `human_handoff`
- `unresolved`

Reuse `information_state.pending_requests`, `last_completed_request`, `selection_candidates`, and `resume_node`. Extend this existing state with only the missing compact `support_anchor` fields; do not duplicate those existing requests or add another state store. The combined projection contains only validated continuity data:

- support kind;
- selected event and opaque internal order/cart reference, if grounded;
- customer-visible reference only if the backend actually exposes and maps it;
- the last observed canonical status, observation time, and evidence coverage, if needed for continuity; refresh mutable payment status before claiming its current value;
- a reference to the existing last completed support request;
- one unresolved referent or requested detail;
- whether a human handoff has already been requested.

Never persist raw endpoint responses, uploaded-image contents, sensitive payment identifiers, bank data, unbounded model summaries, or duplicated transcript evidence in this anchor. Internal order references remain server-side and are not projected to the reply model.

An empty planning state must not mean a fresh conversation. Freshness, lane, and planning-state emptiness are independent typed facts. Reuse the existing saved plan: these traces prove it survived, so do not introduce a second memory system.

Represent semantic support acts in extraction, including `report_issue`, `provide_detail`, `defer_submission`, `ask_policy`, and `request_document`. A statement can need an acknowledgment or support continuation without being a new FAQ question. An unresolved pronoun remains unresolved; the summarizer's guess is not authoritative evidence of what will be sent.

### 2. Specialized support extraction without an extra model call

Keep the current broad extractor when:

- no lane is established;
- the person is actively planning an event;
- typed state is inconsistent or insufficient.

For an established FAQ/support lane, dynamically load a compact support extractor and schema that can emit only:

- continue current support request;
- new FAQ/support topic;
- switch to planning;
- switch to RSVP;
- request human help;
- ambiguity requiring one clarification.

The compact input contains the trusted recent messages, the typed support anchor, relevant authorization state, and the new message. It excludes provider categories, provider results, budgets, guest ranges, planning preferences, and inactive tool instructions.

This reuses the existing extraction call instead of adding a new router call. A semantic domain-switch field preserves normal conversations; exact-string or keyword routing is prohibited. When the compact extractor positively identifies a switch requiring planning-specific details it does not represent, invoke the existing specialized extraction path once for that switch only. Measure that exceptional cost separately; ordinary support continuations must not gain an extra call.

### 3. Outcome-specific reply projection

Build the reply input from one canonical support result:

- Public FAQ: the selected indexed answer fragments, coverage, and citation metadata only.
- Purchase status: selected event/order, canonical partition/status, requested amount presentation, and policy fragment only when relevant.
- Confirmation-document request: verified status plus `document_delivery_capability: unavailable`.
- Pending transfer: pending status plus the indexed validation-window policy; user-reported proof remains explicitly user reported.
- Email-capacity question: only the FAQ result and the bounded support anchor.

Raw API objects and raw knowledge-base results never reach the reply model. Contradictory endpoint fields are reconciled first; unresolved fields are omitted or marked unknown. Repeated bot greetings are excluded from the support anchor and cannot become evidence for another welcome.

Represent `confirmation_document` as a typed requested support outcome, distinct from `payment_status`. It grants no send/resend tool capability. General document-delivery guidance may come from indexed FAQ evidence; a specific delivery claim requires an actual supported operation and a successful result.

### 4. Welcome and repetition guardrails

- The welcome schema is eligible only when typed evidence says this is a genuinely fresh, unresolved conversation.
- An explicit unresolved support request cannot render a generic welcome. If extraction fails, the fallback is one relevant clarification or one human handoff, not a restart.
- A capability introduction is emitted at most once per conversation unless the person explicitly asks what the agent can do.
- Do not suppress legitimate repeated user messages solely because their text matches. Idempotency uses stable inbound message IDs; distinct IDs are distinct turns.
- Preserve the existing conversation lease. It worked in all six recovered turns and is not the repair target. Retain overlap regressions: if a later distinct message arrives while processing is active, it should wait and then read the saved state. Do not add a second lock or enlarge the batching window for these non-overlapping failures.

### 5. Numeric/COD order-reference boundary

- Continue normalizing customer input with or without `COD` into a customer-visible numeric reference.
- Never send that numeric reference as the backend `order_id` unless the API contract proves it accepts that identifier.
- When the mapping is unavailable, perform one unfiltered phone-scoped lookup and resolve by grounded event, status, date, and amount evidence.
- A filtered 404 is only `this identifier did not match this endpoint`; it is not `this phone has no purchase`.
- If multiple plausible records remain, ask the person to choose from minimum-disclosure descriptions. Never expose opaque backend IDs.

Most of this reference behavior already exists in `order-reference.ts` and `information-orchestrator.ts`. Preserve and regression-test it; do not count a new direct endpoint probe's numeric 404 as proof that the current orchestrator makes that invalid request.

### 6. Development and production isolation

Keep the current customer-facing function and URL as production. Create a second CloudFormation stack whose resources derive from a distinct development function name. The existing template already derives log and DynamoDB names from `FunctionName` ([CloudFormation resources](../../infra/cloudformation/stack.yaml:199)), but deployment defaults currently target one stack and one function ([deployment defaults](../../scripts/deploy.mjs:28)).

Verified inventory on 2026-09-03: `recap-agent-runtime` is the only conversational runtime among the `recap-agent*` functions/stacks. `recap-agent-provider-sync-dev` and `recap-agent-knowledge-sync-dev` are sync jobs, not a development conversation Lambda. The runtime has no aliases, no `DEPLOYMENT_ENV` value, and uses `recap-agent-runtime-plans` / `recap-agent-runtime-perf` with the production Agent API URL. FAQ and purchase features are enabled.

Current revision: `a954695c-4d83-4b80-8f2c-3106e8b1ff2d`; last modified `2026-09-02T19:45:31Z`; code SHA-256 (AWS base64): `cJUrNKB8I9Yo8j/L+0w/f/SJmajo5RaF+bWp/C5hd18=`. Case A occurred after this deployment and Case B before it. Both stored reply schemas show the same welcome failure. The exact older source commit for Case B is not asserted because historical `$LATEST` execution does not by itself identify an immutable revision.

Required separation:

- separate Lambda, URL, log group, plans table, performance table, channel key, and secret paths;
- explicit `DEPLOYMENT_ENV=development|production`; unknown or missing values fail closed;
- development scripts and evals require the development URL and may never fall back to production;
- production rejects backend fixtures and test-mode input before gateway selection;
- development allows fixtures only for an authenticated test caller;
- development outbound/customer mutations are denied before network access by default;
- when no non-production backend exists, use fixtures for writes and explicitly authorized read-only probes for real contracts;
- provider/knowledge indexes and sync jobs must not mutate a production store from development;
- one immutable artifact is built once, identified by digest, tested in development, and promoted with reviewed configuration to production after explicit approval;
- rollback points to the previously published artifact and configuration, not copied development state.

AWS Lambda published versions lock code and most configuration, while unqualified invocation targets `$LATEST` ([AWS Lambda versions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-versions.html)). Function URLs can target an alias or `$LATEST`, but not a numbered version directly ([AWS Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html)). This plan does not require introducing API Gateway or changing the current production URL.

## Sub-agent-oriented execution plan

Use at most two concurrent `gpt-5.6-luna` workers. Workers may not spawn children. Reuse them between waves to avoid context and quota multiplication. The primary agent owns all cross-cutting integration, `agent-service.ts`, deployments, and promotion decisions.

### Wave 0 — evidence and baselines (primary, read-only)

Completed for the six text turns: authenticated performance/log audit, stored extraction/reply retrieval, current deployment inventory, actual request-byte/token/latency baselines, and read-only normalizer reproduction.

Findings: Case A is schema/normalizer request loss; Case B is missing typed support continuation; both share an inappropriate welcome fallback. No lock contention, duplicate native IDs, missing saved plan, endpoint failure, or FAQ retrieval failure was observed.

Remaining optional context audit: identify how the receipt image was forwarded and the exact trusted campaign/attachment metadata available. Do not make image interpretation part of the text-turn fix. Recheck the deployment revision before any later execution because other tasks may change it.

Exit: satisfied for the proposed text-turn fixes. No paid live evaluations were run.

### Wave 1 — environment isolation

Worker A owns infrastructure and deployment implementation only:

- `infra/cloudformation/stack.yaml`
- new typed deployment configuration modules/scripts
- environment-specific secret and artifact parameters
- development write-denial configuration

Worker B owns environment safety tests and operator documentation only:

- deployment target/fail-closed tests
- fixture rejection and endpoint-resolution tests
- promotion/rollback runbook
- no edits to Worker A's files

Primary integrates the handler-level environment guard, resolves conflicts, deploys only the development stack, and confirms that production resources, URL, tables, and secrets are unchanged.

Exit: all subsequent behavioral testing targets an isolated development Lambda.

### Wave 2 — contract repair before prompt redesign

Worker A owns the schema/normalizer correction and its unit tests:

- `src/runtime/extraction-schemas.ts`
- the extraction-normalization methods in `src/runtime/openai-agent-runtime.ts` only
- one dedicated normalization-contract test file

Detailed instructions: reproduce the schema-accepted `authAction=null` loss first; normalize no-action semantics without granting authentication; make any other rejection explicit; preserve valid members of mixed batches; return a typed normalization report; do not add global prose rules or infer routes from the summary text. No changes to order parsers, payment statuses, phone identity, or RSVP behavior.

Worker B owns fixture preparation and independent contract review, not those implementation files:

- sanitized fixtures representing the two actual Case A extractor outputs;
- a schema-admission matrix covering `null`, `none`, explicit OTP actions, missing resource, mixed valid/invalid requests, FAQ, and associated-event requests;
- a review proving no silent accepted-request loss and no authorization widening.

Primary integrates the normalization report into routing/performance evidence and prevents invalid actionable extraction from reaching welcome rendering. Validate this smallest fix before beginning prompt-scope optimization.

Exit: the two recorded Case A requests survive normalization, status resolution can reach the existing phone-scoped orchestrator, explicit auth actions remain unchanged, and invalid requests cannot masquerade as a greeting. No new model call is required.

### Wave 3 — support continuation and minimum disclosure

Worker A owns domain types, state transitions, and deterministic reconciliation modules:

- derived `conversation_lane` and minimal extensions to existing information-state types
- continuity and domain-switch transition functions
- reference-resolution and evidence-coverage helpers
- unit tests for those modules

Worker B owns prompt selection, compact support prompt files, projection, and prompt-size tests:

- exact support extractor/reply prompts under `prompts/`
- support-specific dynamic schema/profile
- canonical FAQ and purchase evidence projection
- tests proving irrelevant planning/tool/policy content is absent

Primary owns integration into `src/runtime/agent-service.ts`, welcome eligibility, lock interaction, and any shared runtime files. Finish the typed support-act and welcome eligibility fixes before enabling a compact extractor. Workers are told that they are not alone in the repository and must not revert other edits.

Exit: mailbox reports, deferrals, and clarifications continue support without restarting. If the compact extractor is enabled in this release, established support turns use compact context while fresh planning and explicit domain switches retain the full guarded flow. Prompt optimization may be a separate atomic follow-up; it must not delay the verified contract fix.

### Wave 4 — interaction regressions and independent review

Worker A owns complete regression fixtures and eval definitions:

- both screenshot interactions as full-sequence `live_behavior_regression` cases;
- deterministic offline twins;
- separate coverage entries for normalization request preservation, explicit normalization failures, welcome eligibility, and structured support continuation;
- add new document-capability or prompt-profile entries only if those behaviors are changed in the release; preserve existing currency/COD cases rather than falsely registering unchanged old behavior as a new fix.

Worker B performs a read-only critic review and measurement pass:

- prompt-injection and unauthorized-tool review;
- prompt bytes and call-count comparison;
- normal planning, mixed planning/FAQ, RSVP, and human-handoff regression review;
- concurrency and idempotency failure-mode review.

Primary fixes review findings, deploys the exact artifact to development, runs the focused cases first, then the complete local and live gates. Production promotion remains a separate explicit approval step.

## Required regression matrix

### Reported interactions

- Payment-confirmation request after campaign: no welcome, current phone-scoped approved order selected, no currency inference, no false claim that a document was sent, one handoff only if issuance/resend is requested.
- Mailbox-capacity continuation after transfer proof: no welcome loop, current support topic retained, no image validation, no OTP loop, no historical purchase selected. Retrieve current order status and indexed policy only when the semantic request needs them; do not turn a simple deferral into unnecessary endpoint/FAQ calls. Test both available and absent relevant FAQ evidence.

### Schema and routing boundary

- Replay the recorded model-shaped purchase request with `authAction=null` through the real normalizer, not a mocked already-normalized `ExtractResult`.
- Assert a schema-accepted request is preserved or produces an explicit typed issue; request-count loss cannot remain silent.
- `authAction=null` and `none` perform no authentication mutation. Explicit OTP actions are preserved and still gated normally.
- Normalizing a neutral auth action does not clear an existing authentication challenge, invent a verified identity, or widen disclosure. Account-only requests and sensitive-field requests remain subject to their existing authorization gates.
- A resource/field failure preserves the unresolved support need; it cannot return `informationRequests=[]` and fall through to welcome as if nothing was requested.
- Mixed FAQ/purchase batches retain valid members and expose partial normalization coverage.
- Greeting, fresh planning, public FAQ, and RSVP fixtures remain valid; do not solve Case A by changing all null fields globally.
- The original typo, support report, and deferral sequence runs from the original empty-information state, not from a pre-seeded support anchor that bypasses the failure.
- The final full-mailbox reply receives neither planning tools nor a mandatory welcome schema. A clarification must not ask again whether the mailbox is full.

### Continuity and concurrency

- Two distinct messages within eight seconds arrive as one batch and yield one coherent reply.
- Two distinct messages nine seconds apart serialize and the second sees the first turn's saved support anchor.
- Retry with the same stable message ID produces no second outbound reply.
- Same text with two distinct message IDs remains two legitimate turns.
- An unavailable history endpoint falls back to the support anchor without claiming history is empty.
- Repeated prior bot welcomes are not copied into canonical support evidence.

### Architecture safety

- Fresh event-planning request still takes the full planning path.
- Established planning can ask a FAQ and resume planning afterward.
- Established support can switch to planning or RSVP explicitly.
- Prompt-injection attempts cannot expand tool permissions or disclose raw API/KB data.
- Unsupported document issuance and image verification produce a bounded explanation/handoff, not fabricated success.
- Null currency never gains a name or symbol.
- A numeric/COD filtered miss followed by an unfiltered phone success never becomes a global purchase denial.

### Environment safety

- Development invocation cannot write messages, mutate RSVP, update phone, send quotes, favorite providers, or post reviews unless an explicit isolated test backend capability authorizes it.
- Production rejects fixture/test inputs.
- Eval and terminal clients fail when only a production URL is configured.
- Deployment fails if the AWS identity, region, environment, secrets, artifact digest, or target stack is not explicit.
- Promoting the tested artifact does not copy development plans, performance records, or test secrets.

## Acceptance gates

1. Preserve the audited distinction between model output and normalized output. The Case A contract replay and Case B full continuation pass without a new lock, summary keyword routing, or extra model call for normalization repair.
2. For any compact-profile change included in the release, support continuation extraction instruction-plus-input bytes decrease by at least 30% from the reproduced baseline. Fresh planning prompt bytes must not grow by more than 5%. The minimal contract repair should add zero prompt bytes; measure any typed-schema growth separately.
3. No additional model call is introduced for established support turns. Record cached/uncached tokens and p50/p95 stage latency; do not claim latency improvement solely from byte reduction.
4. All focused offline tests, full local tests, coverage registry tests, and mandatory live semantic judges pass against the development Lambda.
5. Both complete reported sequences pass the mandatory development live cases with hard structural and semantic assertions. Use offline tests for the full timing/idempotency matrix plus one focused live overlap case; repeat paid model cases only to investigate an observed failure or variance, not as a default three-run multiplier.
6. Sanitized artifacts record prompt bytes, call count, latency, deployment revision, artifact digest, config manifest, fixture outcomes, and live-eval report path.
7. Production remains unchanged until the user explicitly approves promotion of the exact tested artifact and reviewed configuration.

## Known limitations and decisions needed

- Historical text-turn causes are verified. The image-dispatch path and the exact older deployment commit for Case B remain unverified; neither is required to reproduce the request-loss/welcome bug.
- The backend currently does not expose a reliable customer-visible transaction-number mapping in the tested phone-scoped results. Durable direct numeric/COD lookup requires a backend contract change or documented identifier field.
- No API capability has been identified for issuing/resending an official payment confirmation. That action remains a human handoff even when status can be answered automatically.
- User-uploaded proof cannot be visually verified by the current agent flow and must remain user-reported evidence.
- Null currency remains unknown. Payment method, country, locale, or interface display must never fill it.
- Separate Lambdas do not by themselves isolate downstream side effects. A development backend/credential or a deny-by-default gateway policy is required before real mutation testing.
- The current latest-five-message contract limits transcript recovery. The proposed support anchor mitigates continuity but is not a substitute for an immutable conversation event log.
- No FAQ retrieval occurred in these failed turns. Whether a specific mailbox-capacity or confirmation-delivery article is indexed remains a separate coverage question. Query the relevant indexed source before claiming such guidance exists; if absent, acknowledge the operational issue and use bounded support rather than inventing an FAQ answer.
- Removing or merging the response classifier is deliberately deferred. It controls reply delivery rather than domain intent, and must not be changed until an A/B parity measurement shows that its safety behavior is preserved.

## Explicit non-goals

- No wholesale rewrite of event planning.
- No unguarded FAQ retrieval path.
- No keyword or exact-string routing.
- No larger raw transcript or raw endpoint dump into model context.
- No inference of currency, payment validation, receipt delivery, or image contents.
- No API Gateway, queue, or distributed-workflow redesign solely for these cases.
- No production deployment during implementation waves without a distinct promotion approval.
