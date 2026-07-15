# Implementation Log

## 2026-07-15

### Discriminate every Lambda request with an operation

**Reason:** CRM control requests already used an explicit operation while
conversational turns were identified only by the absence of that field. The
shared Function URL should have a uniform, unambiguous request envelope.

**Changes:**
- Made `operation: "process_message"` mandatory for conversational requests.
- Kept `operation: "resume_automated_agent"` for CRM ownership release and
  routed the two operations explicitly before their typed validation paths.
- Updated the terminal client, both live evaluation clients, contract tests,
  adapter pseudocode, field mappings, curl examples, README, and integration
  checklist.

**Decision:** Use required operation literals as the clean request
discriminator. Do not accept operation-less conversational payloads while the
integration remains in active development.

**Validation:** `npm run check` passed with 41 test files and 254 tests, and the
development Lambda was redeployed. Live low-cost probes showed
`process_message` reaching the WhatsApp phone validator, an otherwise valid
operation-less turn being rejected specifically at `operation`, and
`resume_automated_agent` still returning `already_active` for the active
synthetic plan.

### Replace timed handoff expiry with explicit CRM release

**Reason:** Human ownership should end when the CRM operator deliberately lets
the automated agent participate again, not after an arbitrary 12-hour timeout
that may fire while a representative still owns the conversation.

**Changes:**
- Removed `human_escalation.bot_suppressed_until`, the 12-hour calculation, and
  automatic elapsed-time resumption from plan state and runtime behavior.
- Added an authenticated `resume_automated_agent` control request keyed by the
  exact persisted `channel` and `user_id` plan identity.
- Added an `AgentParticipationService` that clears handoff state, restores the
  deterministic resume node, and returns idempotent `resumed` or
  `already_active` results without invoking a model or producing a reply.
- Added typed request validation, redacted operation observability, a 404 result
  for missing plans, focused service/contract tests, and a CRM integration
  example.

**Decision:** Keep the automated agent suppressed indefinitely after human
takeover. The CRM backend must use the existing Bearer-authenticated Function
URL to release it; the browser must not hold the channel credential.

**Validation:** `npm run check` passed with 41 test files and 253 tests, and the
development Lambda was redeployed. A live synthetic Dynamo plan was placed in
human ownership; the first authenticated CRM request returned `resumed`, the
retry returned `already_active`, and the persisted plan showed
`human_escalation.status=none`, `current_node=entrevista`, and save reason
`crm_resume_automated_agent` with no timed-suppression field.

### Disable Agent API message writes behind an explicit toggle

**Reason:** The runtime should not persist inbound or outbound conversation
messages through `POST /messages` unless an operator deliberately enables that
integration. Read-only history and human takeover are separate capabilities and
must remain available.

**Changes:**
- Added typed `AGENT_MESSAGE_LOGGING_ENABLED` runtime configuration with a
  default of `false` in TypeScript, CloudFormation, and deployment wiring.
- Gated the Agent Conversation gateway's message-write method before any HTTP
  request, returning a structured disabled result when the toggle is off.
- Preserved `GET /conversations/messages` history retrieval and
  `POST /conversations/request-human` escalation behavior.
- Added gateway coverage proving disabled logging performs no fetch call, and
  updated the runtime and channel documentation.

**Decision:** Gate message persistence at the HTTP gateway boundary so every
current or future caller is covered. Keep the switch independent from Agent API
history and human escalation instead of disabling the entire gateway.

**Validation:** `npm run check` passed with 40 test files and 248 tests. The
development stack was redeployed with the Lambda environment value set to
`false`. A scoped live turn returned HTTP 200, recorded the message-log action
as `skipped` with reason `disabled`, and left the synthetic phone's Agent API
history count unchanged at zero before and after the turn.

### Add overlap-safe channel bearer rotation

**Reason:** A second channel credential was needed without interrupting the
adapter that still uses the existing bearer token. Replacing the one accepted
value immediately would turn a normal key migration into a channel outage.

**Changes:**
- Changed Lambda channel authentication to resolve and accept the standard
  Secrets Manager `AWSCURRENT` and `AWSPREVIOUS` stages from the same secret.
- Kept constant-time digest comparison across every accepted opaque token.
- Made deployment secret synchronization idempotent so unchanged deployments
  do not create redundant secret versions or displace the useful previous key.
- Added a rotation command that generates a token without printing it, stores
  it in the ignored `.env`, and publishes it through Secrets Manager.
- Updated integration and operational documentation with the overlap workflow
  and explicit retirement requirement.

**Decision:** Use AWS Secrets Manager staging labels rather than a custom JSON
key array or a second secret. One secret remains the source of truth, while the
standard current/previous labels provide a bounded two-token migration window.

**Validation:** `npm run check` passed with 40 test files and 247 tests. The
development Lambda was first deployed with the existing token, the channel
secret was rotated, and Lambda was deployed again to refresh its cached key
set. Live low-cost probes returned the typed request-validation `400` for both
`AWSCURRENT` and `AWSPREVIOUS`, while a random bearer token returned `401`.

### Standardize channel authentication on HTTP Bearer

**Reason:** The WhatsApp adapter used the standard `Authorization: Bearer`
scheme while Lambda only inspected a custom `X-API-Key` header. Valid adapter
credentials therefore appeared absent and every runtime request returned 401.

**Changes:**
- Replaced the custom header parser with strict, case-insensitive Bearer scheme
  parsing and constant-time opaque-token validation.
- Added the standard `WWW-Authenticate: Bearer realm="recap-agent"` challenge to
  401 responses and changed redacted request telemetry to distinguish header
  presence from a valid Bearer credential shape.
- Updated Function URL CORS, terminal and eval clients, tests, request examples,
  adapter pseudocode, README guidance, and the live integration contract.

**Decision:** `Authorization: Bearer <CHANNEL_API_KEY>` is the only supported
channel authentication contract. Do not retain an `X-API-Key` compatibility
path while the integration is under active development.

**Validation:** `npm run check` passed with 40 test files and 246 tests. The
development Lambda and Function URL CORS configuration were redeployed. Live
non-mutating probes confirmed that missing credentials and the removed
`X-API-Key` contract both return 401, while a valid Bearer token advances to the
typed WhatsApp request validator and returns the expected missing
`contact_phone` 400. CloudWatch records the corresponding authorization-header
and bearer-token presence booleans without storing credentials.

### Make the Lambda boundary diagnosable and keep Agent API credentials private

**Reason:** A WhatsApp message was stored upstream twice, while all six related
Function URL invocations returned an opaque 4xx and produced no plan or perf
record. The adapter's direct Agent API write also made it appear that successful
message storage proved successful runtime authentication, and Lambda-side
outbound logging could record a generated reply before Meta delivery was known.

**Changes:**
- Added one redacted `channel_request_completed` structured record per Lambda
  invocation with status, typed outcome, validation issues, duration, delivery
  action, and hashed correlation identifiers.
- Imported the existing runtime log group into CloudFormation, configured JSON
  application logs, reduced routine system-log volume, and set 7-day retention
  without adding a paid dashboard or custom metrics.
- Removed Lambda-side outbound Agent API logging while preserving inbound
  logging and Agent API history reads used by the response classifier.
- Clarified that channel adapters use only `CHANNEL_API_KEY`; Lambda alone
  resolves `SE_API_KEY` from Secrets Manager for private downstream operations.

**Decision:** Keep distinct credentials across trust boundaries, but expose only
the channel credential to adapters. Make Lambda the sole owner of authenticated
inbound Agent API logging and make the delivery adapter authoritative for
outbound messages actually sent through Meta.

**Validation:** `npm run check` passed with 40 test files and 245 tests. The
existing log group was imported without replacement, the development Lambda was
redeployed, and CloudFormation applied seven-day retention. Live non-mutating
probes produced a redacted `unauthorized` record for HTTP 401 and an
`invalid_request` record whose only issue identified missing `contact_phone` for
HTTP 400. Lambda advanced logging reports JSON format, application level
`INFO`, and system level `WARN`.

## 2026-07-10

### Surface response-classifier decisions in the terminal demo

**Reason:** The Bun terminal exposed classifier token usage in the detailed trace, but it did not clearly present the decision and did not send a canonical phone number for production Agent API conversation context.

**Changes:**
- Added `--contact-phone` and `TERMINAL_CONTACT_PHONE` to the developer CLI and included `contact_phone` in Lambda turns.
- Added a prominent response-classifier panel showing mode, predicted and actual delivery, action, reason, context source, prior-outbound evidence, and fallback status.
- Added the same classifier detail and classification latency to the trace table, plus a two-turn demo recipe using a dedicated phone number.

**Decision:** Keep `user_id` as the plan identity and treat the optional international phone as the explicit Agent API context identity. Do not infer a phone from an arbitrary terminal user id.

**Validation:** `npm run check` passed with 37 test files and 232 tests. `npm run terminal -- --help` exposes `--contact-phone`, and a safe live terminal turn rendered the new classifier panel with `mode=observe`, `prediction=SEND`, `actual_delivery=SEND`, `context=local_plan`, and `fallback=false`. The existing model probe separately confirmed `suppress_reaction` for `👍` with prior outbound Agent API context.

## 2026-07-09

### Add context-aware reply suppression

**Reason:** The runtime should avoid unnecessary acknowledgements and reaction replies without risking silence on requests, questions, corrections, or event-planning work.

**Changes:**
- Added a native OpenAI SDK Structured Outputs classifier using `gpt-5.4-nano`, a Spanish prompt stored with the `deteccion_intencion` node, bounded plan/message context, and a strict fail-open response policy.
- Wired the verified production Agent API conversation endpoint into classifier preflight, inbound/outbound message logging, and silent human-handoff follow-up handling.
- Added `observe` and `enforce` delivery modes, an explicit `{ action, reason }` channel delivery contract, classifier trace/perf/token/cost telemetry, seed evaluation labels, and focused unit/service coverage.
- Added CloudFormation and deployment configuration for `OPENAI_RESPONSE_CLASSIFIER_MODEL` and `RESPONSE_CLASSIFIER_MODE`, defaulting to `observe` without adding credentials or IAM permissions.

**Decision:** Semantic suppression is LLM-structured and only allowed with prior outbound context. Any Agent API, classifier, schema, prompt, or model failure sends the normal reply. Existing human escalation now logs inbound follow-ups and remains silent to avoid bot interference.

**Validation:** `npm run check` passed with 37 test files and 232 tests. Development deployment completed with `OPENAI_RESPONSE_CLASSIFIER_MODEL=gpt-5.4-nano` and `RESPONSE_CLASSIFIER_MODE=observe`. The production history probe returned `200` and five messages for `GET https://api.sinenvolturas.com/api/agent/conversations/messages?phone_number=51991347878`. A scoped observe-mode Lambda smoke turn returned `200`, delivered a normal reply, and recorded a non-fallback classifier trace with 296 tokens. `enforce` remains blocked on the documented promotion gate.

## 2026-07-07

### Use the verified production Agent API route

**Reason:** The documented development Agent API base URL did not expose the required routes. Read-only probes against the production host confirmed that the configured `X-Agent-Key` is valid and that the conversation endpoint is live.

**Changes:**
- Changed the Agent API default base URL in runtime config, CloudFormation, deployment script, environment example, and operational documentation to `https://api.sinenvolturas.com/api/agent`.

**Decision:** Use the verified production Agent API route until the backend team deploys and confirms an equivalent isolated development route. Keep the dedicated service key in Secrets Manager; do not reuse guest authentication tokens.

**Validation:** `GET /api/agent/conversations/messages?phone_number=51991347878` returned `200` with the configured `SE_API_KEY` and `401` with an invalid or absent key. The same documented route on `https://se-v2-api-dev.jnq.io/api/agent` returned `404`, independent of the supplied phone number or key.

### Redesign thesis conference poster

**Reason:** The conference poster needed to be A0 landscape, remove the UTEC logo, and present the agent architecture and evaluation results with a more visual, less text-heavy structure.

**Changes:**
- Added a self-contained LaTeX poster under `docs/thesis/poster/` using the original `tikzposter` template style, with A0 landscape layout, four adapted columns, metric cards, architecture figure, recommendation funnel, and a non-overlapping state diagram.
- Copied the provided architecture PNG into the poster figure directory for reproducible local builds.
- Removed the previous logo-dependent title treatment and kept only textual affiliation.
- Installed the missing TinyTeX dependencies needed by the original template path: `tikzposter`, `ae`, `extsizes`, and `a0poster`.
- Routed state-diagram arrows around node boxes and added a compact technical-contributions block to reduce left-column empty space without adding extra diagrams.

**Decision:** Keep the original `tikzposter`-based visual language instead of the interim dependency-light workaround. Limit the poster to the architecture figure and state diagram as the main visuals, using tables and metric cards for the rest to avoid over-diagramming.

**Validation:** Built `docs/thesis/poster/recap-agent-poster.tex` with the bundled LaTeX compile workflow and rendered the one-page PDF to PNG for visual inspection. The final render is A0 landscape, includes the state diagram, has no visible overlapping content, and keeps the UTEC logo out of the poster.

### Wire Agent API service key through Secrets Manager

**Reason:** Development now has the dedicated Sin Envolturas Agent API key in local `.env` as `SE_API_KEY`, so Lambda should use a service credential from Secrets Manager instead of carrying a temporary feature gate or reusing user validation credentials.

**Changes:**
- Updated deployment to require `SE_API_KEY`, publish it to Secrets Manager as `recap-agent/se-api-key`, and pass the secret ARN to the runtime stack.
- Added CloudFormation parameters, Lambda environment, and IAM permissions for `SE_API_SECRET_ID`.
- Updated Lambda bootstrap to resolve the SE service key from Secrets Manager and always construct the HTTP Agent API gateway in deployed runtime.
- Reworked secret caching so OpenAI and SE credentials are cached independently.
- Removed the Agent API staging switch from config, docs, examples, and gateway skip reasons.
- Hardened deploy-time secret publishing so AWS CLI reads secret values from temporary `0600` files instead of command-line arguments.

**Decision:** Agent API calls use only the dedicated `X-Agent-Key` service credential from Secrets Manager. The guest/user validation bearer token remains scoped to guest/event validation and is not reused.

**Validation:** `npm run check` passed after the change. Non-mutating live probes with `SE_API_KEY` against `GET /conversations/messages`, `GET /messages`, and `GET /conversations/request-human` on `https://se-v2-api-dev.jnq.io/api/agent` all returned `404 Ruta no encontrada`, so the dev route mismatch remains independent of the credential. `npm run deploy` published the `recap-agent/se-api-key` secret and updated `recap-agent-runtime`; Lambda now has `SE_API_SECRET_ID` set and no legacy staging-switch or direct Agent API key environment variables.

### Stage human escalation without requiring Agent API credentials

**Reason:** The human-operator handoff endpoints are needed for the WhatsApp-style workflow, but live probes against the documented development `/api/agent` routes returned `404`/`405` route mismatches instead of the documented authenticated responses. The integration should be ready in code while avoiding a hard dependency on an unconfirmed `X-Agent-Key` or route deployment.

**Changes:**
- Added `solicitar_humano` and `solicitar_agente_humano` as first-class intent/node state for human review requests.
- Added persisted `human_escalation` state to plans with requested status, timestamp, phone number, and last error.
- Added a typed Agent API gateway with no-op and HTTP implementations.
- Routed explicit human-support requests into a deterministic local soft-pause that avoids provider search and future bot continuation.
- Updated Spanish extractor and node prompts so human-support requests are not treated as FAQ.
- Added unit coverage for no-op escalation, HTTP gateway auth/method/malformed/retry behavior, and service soft-pause behavior.

**Decision:** Do not reuse the guest/user validation bearer token. It is user-scoped and belongs to the event lookup flow; the Agent API must use a separate service-style `X-Agent-Key`.

## 2026-06-26

### Activate shared assistant personality

**Reason:** The reviewed personality prompt needed to apply to every runtime
conversation, not remain as a review-only artifact. Feedback also requested a
slightly warmer chat feel with limited emoji use and no final plain period so
messages feel less robotic.

**Changes:**
- Added `prompts/shared/agent_personality.txt` to `conversationSharedPromptFiles`
  so every node prompt bundle includes the same personality guidance.
- Kept extractor prompts free of conversational personality guidance.
- Added explicit shared style rules for moderate emoji use and avoiding a final
  plain period.
- Added final outbound sanitization so delivered assistant messages do not end
  with a plain period even when generated by structured renderers.
- Added prompt-loader and service regression tests for bundle inclusion,
  prompt-cache invalidation, non-contradiction, and final-period behavior.

**Decision:** Place personality before `output_style.txt` in the shared prompt
order so the style file can reinforce, but not contradict, the personality.
Prompt bundle ids already hash file paths and content, so personality edits
invalidate cached prompt bundles deterministically.

## 2026-06-24

### Add Notion planning dates to milestone activity handoff

**Reason:** The activity-report handoff needed to include the planning phase
documented in Notion, starting on 2026-03-19, before the implementation
activities.

**Changes:**
- Added a chronological planning block covering charter definition, marketplace
  API capability mapping, OpenAI Agent Builder validation, request/response tool
  pattern design, architecture decision, architecture design, and implementation
  kickoff.
- Added copy-ready planning activity rows with suggested dates and locations.
- Updated the short-table summary so planning activities appear before
  implementation activities.

**Decision:** Keep Notion source names as agent-only context and instruct the
final report filler not to copy source names or mention Notion in the submitted
format. No Lambda redeploy was required because this was documentation-only.

## 2026-06-23

### Draft agent personality prompt

**Reason:** The ATC/Notion customer-service response samples added to the FAQ
knowledge base show a warmer, more practical support voice than the current base
prompt captures. A standalone review artifact was needed before making any
runtime prompt change. The draft was then rewritten using current OpenAI
prompting guidance: keep personality instructions concise, specific, structured,
easy to review, and covered by evals before publishing.

**Changes:**
- Added `prompts/shared/agent_personality.txt`, a Spanish direct-address
  personality guide derived from the ATC chat templates and existing shared
  output-style constraints.
- Reworked the draft into a system-prompt-style artifact with compact principles,
  situation-specific tone rules, and a few high-signal positive/negative examples.

**Decision:** Keep the personality file out of `conversationSharedPromptFiles`
for now so the team can review wording before it affects Lambda behavior. No
development Lambda redeploy was required because this prompt is not consumed by
the runtime yet.

Validation:
- Reviewed current OpenAI prompting guidance for tone, personality blocks,
  code-managed prompts, and eval-backed prompt iteration.
- Reviewed the active ATC chat templates generated by the local export parser.
- Confirmed the new file is not referenced by the prompt manifest.

### Replace report image placeholders and architecture figure

**Reason:** Final report assets were added for UTEC, Sin Envolturas, and the
AWS/OpenAI architecture diagram. The report needed to use those assets directly
instead of the temporary logo placeholders and the earlier TikZ architecture
figure.

**Changes:**
- Replaced report header and cover logo references with the provided UTEC PNG and
  Sin Envolturas JPEG assets.
- Converted the provided draw.io architecture SVG into a report-ready SVG/PDF
  derivative with a widened canvas and fixed light-mode colors.
- Replaced the first architecture figure with the converted architecture PDF.
- Restored an `Images/README.md` that documents the editable source diagram and
  the generated LaTeX asset.

**Decision:** Keep the original draw.io SVG as the editable source and commit a
PDF derivative for reliable `pdflatex` builds. No Lambda redeploy was required
because this was documentation-only.

Validation:
- Rebuilt the LaTeX report through the full BibTeX cycle.
- Rendered the cover and diagram pages to PNG for visual inspection.

## 2026-06-22

### Architecture and implementation report

**Reason:** The thesis deliverable needed a detailed Spanish academic technical
report describing the current `recap-agent` architecture and implementation,
using the repository as authoritative evidence plus implementation logs, docs,
analysis dossiers, Notion context, and AWS development deployment state.

**Changes:**
- Added a Sullivan-template-based LaTeX report under `docs/thesis/architecture-report/`.
- Copied the report template class, bibliography file, and image assets into the
  repo so the report is git-trackable and self-contained.
- Adapted the copied class locally for the installed TinyTeX package set while
  preserving the report structure.
- Added native LaTeX/TikZ architecture, state-machine, and turn-pipeline diagrams.
- Added an analysis dossier documenting sources, AWS checks, Notion checks, and
  repeatable build commands.

**Decision:** Keep the report body at architecture level without direct code
excerpts or code-file references, while still grounding claims in the current
implementation and deployed development environment.

Validation:
- `pdflatex -interaction=nonstopmode -halt-on-error recap-agent-architecture-report.tex`
- `bibtex recap-agent-architecture-report`
- Two final `pdflatex` passes; final log check found no unresolved references,
  no empty bibliography, and no overfull boxes.

## 2026-06-19

### Batch 3 objective feedback fixes

**Reason:** Batch 3 feedback exposed objective failures in routing, provider
selection state, auth-code recovery, output hygiene, contact validation, FAQ
retrieval guidance, and turn observability. DynamoDB perf logs also lacked final
assistant-output evidence, which made wording regressions dependent on screenshots.

**Changes:**
- Added privacy-aware outbound observability to turn perf records: assistant
  message length/hash/redacted preview, quality flags, structured message kind,
  redacted tool input/output previews, and provider result summaries.
- Added a CloudFormation/config flag, `PERF_CAPTURE_ASSISTANT_PREVIEW`, to control
  redacted assistant preview capture while preserving TTL-based retention.
- Centralized outbound rendering through one service helper and sanitize leaked
  `filecite turnN file N` artifacts before channel delivery or logging.
- Mapped internal missing-field ids to user-facing Spanish labels in extractor and
  reply prompt snapshots.
- Changed guest-event auth follow-ups in an active `code_requested` state to resend
  the code instead of dead-ending on "send me the code".
- Tightened provider alias resolution so generic first tokens such as "baby" cannot
  coerce unknown provider names like Baby Baloo into Baby Loli, while preserving
  meaningful first-name provider selection.
- Fixed contact phone validation precedence so a valid international phone in raw
  user text can clear a local/partial model extraction.
- Strengthened Spanish extractor and FAQ prompts for event-specific lookup,
  confirmed/invited guest questions, unknown provider preservation, unselect/defer
  operations, multi-front handling, and batch-3 FAQ retrieval topics.
- Added regression coverage in service, prompt-loader, OpenAI runtime snapshot, and
  perf-trace tests.

**Decision:** Keep conversational flow decisions grounded in structured extraction
and state-machine evidence. Deterministic logic was limited to validation,
sanitization, logging, and already-established auth/plan states.

Validation:
- `npm run check`
- `npm run deploy`
- Live Lambda smoke for "Tengo un problema con mi evento" routed to
  `consultar_evento_invitado`.
- DynamoDB perf smoke confirmed persisted assistant-message preview/hash/quality
  fields and structured message kind.

## 2026-06-16

### Make live FAQ ATC assertions paraphrase-tolerant

**Reason:** The live FAQ KB source eval used brittle exact Spanish surface forms
for ATC gift-claim guidance, while the deployed Lambda can validly paraphrase the
same facts.

**Changes:**
- Replaced exact ATC containment phrases with regex assertions that still require
  the no-obligation/no-responsibility-to-buy fact.
- Added a paraphrase-tolerant claim-handling regex that requires a claim/problem
  signal tied to the brand, product, Shop, or store context.
- Left the official Tawk.to card-commission assertions unchanged.

**Decision:** Keep the assertion fact-specific rather than generic, but allow
valid Spanish paraphrases from live model output.

### Strengthen live FAQ KB source assertions

**Reason:** The live FAQ KB source eval had permissive source markers, so it could
pass on generic text when the local semantic judge was skipped.

**Changes:**
- Tightened the official Tawk.to FAQ assertion to require the exact card-payment
  facts for foreign cards: `3.70% + IGV / IVA` and `0.40 USD + IGV / IVA`, plus
  the payment-method/foreign-card context.
- Tightened the ATC suggested-response assertion to require the gift-claim policy
  facts: the user is not obligated to buy the gift and product/Shop claims go
  directly through the product brand.

**Decision:** Keep content-marker assertions instead of full-response equality so
the live answer can vary while still proving both retrieved source families were
used.

### Add live FAQ KB source coverage eval

**Reason:** The FAQ knowledge base needed a token-consuming live validation that
confirms answers can use both preserved official Tawk.to FAQ snippets and the new
ATC/Notion suggested-response template snippets.

**Changes:**
- Added `live.faq_kb_sources_official_and_atc`, a live FAQ flow that asks for
  card-payment commission details and gift/product claim guidance in one turn.
- Added the focused `live_faq_kb_sources` suite for targeted live validation.
- Asserted the `consultar_faq` route, `file_search` usage, absence of provider
  search/results, FAQ trace retrieval output, official commission markers, ATC
  gift-claim markers, and a semantic both-source coverage rubric.

**Decision:** Keep this as a dedicated live suite so the source-coverage eval can
be run independently from the broader live benchmark while still consuming the
real deployed Lambda/runtime target.

### Refresh entrypoint planning live-smoke expectation

**Reason:** The live smoke case for a known event planning opener had a stale node
expectation. Current event-plan-first routing can validly enter multi-need
elicitation without performing provider search.

**Changes:**
- Updated `entrypoint.event_known_no_active_need` to allow either `entrevista` or
  `elicitacion_necesidades` as the first transition.
- Corrected the Spanish input from `un boda` to `una boda` so the event type
  assertion continues to validate a known-event opener.
- Kept the no-provider-search assertion to continue guarding against premature
  provider lookup.

**Decision:** Treat the observed `contacto_inicial->elicitacion_necesidades`
transition as valid planning behavior and avoid runtime routing changes.

### Scope ATC supplemental FAQ knowledge-base cleanup

**Reason:** The supplemental ATC FAQ sync reused full FAQ replacement cleanup, so
uploading only ATC response-sample files could delete unrelated FAQ files from the
same OpenAI vector store.

**Changes:**
- Added optional source-scoping metadata to knowledge-base uploads.
- Configured `sync:faq-atc-kb` uploads with `source: notion_customer_service_templates`,
  `source_kind: response_sample`, `channel: chat`, and `status: Vigente`.
- Scoped ATC cleanup to only stale vector-store files with the same ATC source,
  preserving existing non-ATC FAQ files.
- Added regression tests that mock vector-store files and verify old FAQ files survive
  while stale ATC files can be removed.

**Decision:** Keep normal FAQ sync cleanup behavior unchanged when no cleanup source
scope is configured; only supplemental ATC sync uses source-scoped cleanup.

### ATC supplemental FAQ knowledge-base templates

**Reason:** Customer-service response samples exported from ATC/Notion should enrich
FAQ file-search retrieval without changing deterministic conversational routing.

**Changes:**
- Added a local-export source seam and parser for ATC template CSV/markdown exports.
- Normalized eligible Chat/Listo/Vigente templates into standalone supplemental FAQ
  markdown files for vector-store ingestion, excluding Desestimado templates by
  default and reporting missing triggers as quality debt.
- Added generation and sync scripts for the supplemental KB output directory.
- Updated the `consultar_faq` prompt to follow retrieved customer-service samples
  closely when they fit the user's question.
- Added tests for ingestion counts/drop rules, trigger handling, no runtime trigger
  routing, and KB/provider vector-store separation.

**Decision:**
- Keep triggers as semantic retrieval hints inside generated KB documents only; do
  not introduce exact-string or keyword routing for conversational flow decisions.
- Generate separate supplemental files instead of appending to existing FAQ docs.


## 2026-05-14

### Canonical schema normalization

**Reason:** Event type, provider price level, decision nodes, provider summaries,
location matching, and generated actions were still crossing module boundaries as
loose strings. That allowed prompt variation such as "matrimonio", "baby shower",
or "$$$" to drift into stored plans, eval fixtures, ranking logic, and rendered
messages without a single canonical parse boundary.

**Changes:**
- Added canonical Zod-backed modules for event types, price levels, and
  country-only location keys.
- Changed plan, extraction, eval, and provider-fit contracts to use canonical
  event type ids instead of free-form event strings.
- Changed provider summaries to use the shared `providerSummarySchema` from
  `core/provider.ts`, with canonical provider categories and price levels.
- Normalized Sin Envolturas API price symbols into `low`, `mid`, `high`, and
  `very_high`; rendering converts them back to user-friendly symbols.
- Replaced budget-fit scoring based on string length with scoring over the
  canonical price-level schema.
- Centralized country-key matching for vector filters, provider sync attributes,
  and provider gateway location scoring.
- Added `decisionNodeSchema` and made plan/eval node fields fail fast on invalid
  decision node strings.
- Removed generated `actions` from structured message schemas, renderer output,
  and prompt response contracts. Flow control now stays driven by typed intents,
  selected provider hints, node state, and persisted plan state.
- Removed model authority over `providerFitCriteria.budgetTier`; runtime budget
  parsing now computes the ranking tier from `budgetSignal`.
- Migrated tests and eval fixtures atomically to canonical event and price values.

**Decision:**
- Use the existing repo pattern of const tuple values plus `z.enum(...)` and
  inferred TypeScript types as the runtime contract. No backward compatibility
  shim was added for non-canonical enum strings.

Validation:
- `npm run check`
- `npm run eval -- --suite dev_regression --target offline`

## 2026-05-07

### Multiple providers per need

**Reason:** A single event need can naturally require contacting more than one
provider, but the plan model stored only one `selected_provider_id` and one
`selectedProviderHint`. That made plural choices like "EDO y 4Foodies" lossy and
kept the multi-intent path focused on one provider even when the user selected
several before opening another need.

**Changes:**
- Replaced singular selected-provider plan fields with arrays:
  `selected_provider_ids` and `selected_provider_hints` on both each
  `provider_needs` entry and the active-need top-level projection.
- Updated extraction contracts, prompt snapshots, trace summaries, terminal debug
  output, and eval schemas to use `selectedProviderHints` / selected-provider arrays.
- Reworked provider selection resolution in `agent-service.ts` to support multiple
  ordinal choices, multiple name/alias matches, fallback alias scanning for
  secondary-intent selection turns, grouped selections by need, and deduped appends.
- Updated shortlist replacement behavior so a fresh shortlist can clear previous
  selections for that need, while unrelated need updates preserve existing selections.
- Updated `finish_plan` to create one quote request per selected provider across
  every selected need; `no_selected_providers` now only applies when all arrays are
  empty.
- Updated Spanish extractor and node prompts for plural selection, including
  examples like "la primera y la tercera" and "EDO y Dulcefina".
- Added unit, service, finish-tool, and offline eval coverage for multi-provider
  selection and selection-plus-new-need turns.
- Added new eval cases:
  `selection.choose_multiple_catering_from_shortlist` and
  `multi_need.select_two_caterings_and_open_music`; both are included in
  `dev_regression`.

**Decision:**
- Use a clean array-based plan shape as the durable model. A narrow load-boundary
  normalization remains only to tolerate legacy persisted/local seed objects while
  converting them into the new array shape immediately.

Flow nodes affected:
- `deteccion_intencion`
- `usuario_elige_proveedor`
- `anadir_a_proveedores_recomendados`
- `seguir_refinando_guardar_plan`
- `recomendar`
- `crear_lead_cerrar`

## 2026-05-05

### Multi-intent extraction with provider selection heuristics

**Reason:** When a user combines provider selection with a new need in one message
(e.g., "ok quiero a dj pulga. ahora ayudame con catering. tienes algo para tortas?"),
the extractor only supports a single `intent` field, forcing the LLM to choose one
primary intent. This caused `selectedProviderHint` to be lost when the primary intent
was `buscar_proveedores` instead of `confirmar_proveedor`. The provider selection
was not captured, and the system failed to mark DJ Pulga as selected for Música.

**Changes:**
- Added `secondaryIntents` field to extraction schema (`ExtractionResult`, Zod schema,
  and `openai-agent-runtime.ts`): allows the LLM to express additional intents beyond
  the primary one. For example, `intent: buscar_proveedores` with
  `secondaryIntents: ["confirmar_proveedor"]` when a user selects a provider AND
  requests a new need.
- Added `resolveEffectiveSelectionHint()` heuristic in `agent-service.ts`: when
  `confirmar_proveedor` appears in primary or secondary intents but
  `selectedProviderHint` is null, scans the user message for provider name aliases
  from the shortlist using existing `providerAliases()` and
  `normalizeSelectionText()` matching. Auto-fills the hint as a fallback.
- Updated `tryResolveSelection` call site to use effective hint instead of raw
  extraction field.
- Strengthened multi-intent guidance in `prompts/extractors/normalization_rules.txt`:
  new "multi-intención" section with explicit examples for combined selection + need
  switch messages. Instructs the LLM to always fill `selectedProviderHint` when
  referencing a shortlist provider, regardless of primary intent.
- Updated `prompts/extractors/field_definitions.txt`: added `secondaryIntents` field
  definition with usage guidance.
- Updated `prompts/extractors/conflict_resolution.txt`: references `secondaryIntents`
  for combined selection + need switch scenarios.

### Fix vector search category filter case mismatch, search funnel transparency, and category prompt enforcement

**Reason:** Vector search for providers returned 0 results when category filters were applied because `buildProviderVectorSearchFilters` used `normalizeKey()` on category values (lowercasing them, e.g., "catering") while the vector store stored `category_key` as the exact canonical value (e.g., "Catering"). OpenAI's vector store filter matching is case-sensitive, so the filter never matched. Dulcefina (id=94, Catering category, tortas specialist) was consistently missed. Additionally, the agent was inventing non-canonical category names like "decoración" instead of using canonical names like "Hogar y deco".

**Changes:**
- Fixed `buildProviderVectorSearchFilters` in `provider-vector-search.ts`: removed `normalizeKey()` from category filter values, using exact canonical values returned by `resolveSearchCategories()` instead. The `country_key` filter continues using `normalizeKey()` since the uploader stores country keys lowercased via `attributeKey()`.
- Added search funnel debug logging (`[search-funnel]` prefix) throughout `sinenvolturas-gateway.ts` and `provider-vector-search.ts`: logs vector query details, raw hit count, enriched provider count, and API fallback triggers.
- Strengthened category enforcement in `prompts/extractors/field_definitions.txt`: `vendorCategory`, `vendorCategories`, and `activeNeedCategory` now explicitly list the 17 canonical category values and require exact matches. Added known user-expression mappings (e.g., "decoración" → "Hogar y deco").
- Implemented true parallel vector search in `ProviderVectorSearchGateway.search()`: when `resolveSearchCategories` returns multiple categories (bucket expansion like "Catering" → `["Catering","Licores"]`), each category fires its own vector search with the FULL `maxResults` budget. Results are merged, deduplicated, and sorted globally by score so representation is score-driven, not quota-driven.
- Added `buildLocationFilter()` helper and updated `buildProviderVectorSearchFilters()` to reuse it.
- Updated `prompts/nodes/recomendar/response_contract.txt`: agent must mention actual canonical categories represented in results (e.g., "Catering y Licores") instead of bucket names.

## 2026-05-06

### Vector-first provider search, category buckets, and trace fixes

**Reason:** Provider search returned only 3 results when 6 existed because API-first hybrid search used a single-page term-iteration fallback and strict country filtering excluded providers without location metadata. Category suggestions were unanchored, leading to non-canonical names. FAQ node injected full provider context unnecessarily, wasting tokens.

**Changes:**
- Restructured `searchProvidersHybrid` to vector-first: run vector search, enrich results, return if any found; API fallback only when vector returns 0 results.
- Added `categoryBuckets` to `provider-category.ts` with 10 categories + Otros, mapping merged buckets to underlying canonical categories (e.g., "Belleza" → ["Salud y belleza", "Maquillaje"]).
- Added `resolveSearchCategories()` function to expand bucket or canonical names into search categories for parallel vector queries.
- Updated `buildProviderVectorSearchFilters` in `provider-vector-search.ts` to accept `categories[]` array instead of single plan, supporting OR filters for merged categories. Made `country_key` filter inclusive: matches providers with the target country OR with empty country (no location set).
- Increased search limits: `PROVIDER_SEARCH_LIMIT` 5→12, `PROVIDER_VECTOR_MAX_RESULTS` 12→24, `REPLY_PROVIDER_LIMIT` 4→6, `PRESENTATION_PROVIDER_LIMIT` 5→6.
- Injected category bucket names into `entrevista` prompts dynamically via `composeConversationInput`.
- Updated `entrevista/response_contract.txt` to reference canonical bucket list.
- Stripped `providerResults` from `consultar_faq` context to reduce token usage (~3-5K tokens saved per FAQ turn).
- Deduplicated `collectHostedToolCalls` in `openai-agent-runtime.ts` by composite key to prevent duplicate `file_search` traces.
- Fixed duplicate `consultar_faq` node in path by checking if last path entry matches current node before pushing.
- Added `--show-slugs` flag to terminal client for debug output showing provider slugs alongside categories.
- Purged all DynamoDB plans (clean break, no backward compatibility).
- Deployed both runtime and provider sync stacks.

## 2026-05-06

### Fix config validation and wire provider vector store ID end-to-end
- Fixed `src/runtime/config.ts` schema: removed `.min(1)` from `PROVIDER_VECTOR_STORE_ID` and `KB_VECTOR_STORE_ID` so empty strings passed by CloudFormation do not crash Lambda initialization.
- Set `ProviderVectorStoreId` parameter in the `recap-agent-runtime` CloudFormation stack to the active OpenAI vector store (`vs_69f939de45708191bebc5879baba8b8c`).
- Updated `recap-agent-provider-sync-dev` stack to use the same vector store ID so scheduled syncs update the correct store.
- Updated `.env.example` to document `PROVIDER_VECTOR_STORE_ID` and `KB_VECTOR_STORE_ID` as required configurations.
- Updated `docs/provider-vector-search.md` to emphasize that `PROVIDER_VECTOR_STORE_ID` must be set as a CloudFormation parameter and is persisted in the Lambda environment.

Reason:
- CloudFormation passes empty strings for unset parameters, which caused `z.string().min(1)` to throw during Lambda cold start. More importantly, without the ID being persisted in the stack, every deployment would lose the vector store reference and silently fall back to API-only search.

Decision:
- Keep the vector store ID as a first-class CloudFormation parameter. Do not rely on `.env` inside the Lambda — env files are not packaged in the deployment artifact. The ID must flow through CloudFormation → Lambda environment variable → runtime config.

### Enforce shared canonical provider category schema across extraction, KB, and API search
- Created `src/core/provider-category.ts` with a single source of truth: `providerCategoryValues` enum derived from the actual marketplace API category slugs and display names.
- Categories are now exact canonical strings (e.g., `"Fotografía y video"`, `"Catering"`, `"Locales"`) everywhere.
- Changed the OpenAI extractor schema (`extractionSchema`) to use `providerCategorySchema` for `vendorCategory`, `vendorCategories`, and `activeNeedCategory`. The model is now forced to output exact canonical values.
- Updated `src/core/plan.ts` to store `vendor_category`, `active_need_category`, and `providerNeed.category` as the canonical enum.
- Added `normalizeRawPlan` boundary normalization in `src/core/plan.ts` so old plans and API responses are mapped to canonical values at load time.
- Updated `src/runtime/provider-vector-search.ts` to remove the heuristic `categoryAliasKeys` function. Vector search now uses an exact `eq` filter on `category_key`.
- Updated `src/runtime/sinenvolturas-gateway.ts` to normalize API category names to canonical values in `toProviderSummary`. Removed `categoryAliases` heuristic. `categoryMatchScore` now does exact canonical comparison.
- Updated `src/provider-sync/uploader.ts` to store the exact canonical category as `category_key` in vector store metadata.
- Updated `src/runtime/agent-service.ts` to use canonical values in `buildNeedUpdates`, `normalizeCategoryValue`, and `isVenueLikeCategory`.
- Updated `src/evals/case-schema.ts` to enforce canonical categories in offline eval fixtures.
- Updated all test fixtures, eval cases, and prompts to use canonical category values.
- Updated extractor prompts (`prompts/extractors/examples.md`, `prompts/extractors/normalization_rules.txt`) to instruct the model to emit exact canonical category names.

Reason:
- Heuristic alias mapping (`categoryAliasKeys`, `categoryAliases`) was a shortcut that created drift between what the extractor output, what the KB stored, and what the API returned. This led to missed matches and cross-category bleed. A shared enum guarantees that every layer speaks the same category language.

Decision:
- Use the official marketplace display names as canonical values rather than slugs. They are human-readable, stable, and work naturally for both API text search and user-facing rendering. No separate display-name mapping is needed.
- Accept a clean break: old plans with non-canonical categories are normalized at the storage boundary. The KB must be recreated with the new `category_key` values.

Flow nodes affected:
- All nodes that touch provider search or extraction (`entrevista`, `buscar_proveedores`, `refinar_criterios`, `reintentar`, `recomendar`).

## 2026-05-05

### Add hybrid provider vector search
- Added a provider sync pipeline that fetches all provider details, formats one Markdown file per provider, and uploads those files to a dedicated OpenAI vector store with provider metadata attributes.
- Added direct vector-store search for provider retrieval, with configurable `api`, `vector`, and `hybrid` modes.
- Updated the Sin Envolturas gateway to merge API candidates and semantic candidates by provider ID, enrich vector-only hits through the provider detail endpoint, and preserve typed provider summaries before final provider-fit ranking.
- Added provider vector search configuration to runtime config, Lambda bootstrap, deployment parameters, and CloudFormation.
- Added a scheduled provider sync CloudFormation template and local `npm run sync:providers` command.
- Updated the provider sync stack to accept a versioned code artifact key so CloudFormation deploys Lambda code updates reliably.
- Tightened provider vector query formulation with active-need-only multi-query search and category alias metadata filters to improve recall without mixing provider types.
- Documented the provider vector-search architecture in `docs/provider-vector-search.md`.

Reason:
- Filter-based provider search misses matches that are semantically relevant but do not share exact keywords with the user request. Provider details already contain richer descriptions, services, promos, and terms that are better suited for vector retrieval.

Decision:
- Keep the provider API as the source of truth and default to hybrid retrieval. The runtime only uses vector search when a provider vector store ID is configured, so deployments can fall back safely to API-only behavior.

Flow nodes affected:
- `buscar_proveedores`
- `reintentar`
- `recomendar`

## 2026-04-05

### Bootstrap runtime skeleton
- Added project conventions in `AGENTS.md`.
- Added TypeScript, build, and test scaffolding for a serverless agent runtime.
- Locked the architecture around a node-aligned state machine, DynamoDB plan persistence, and a live terminal-to-Lambda path.

Reason:
- The repo started empty, so the first change needed to establish the implementation rules and traceability baseline before code work.

Decision:
- Use DynamoDB as the primary `PlanStore` target from the first slice, while keeping the storage interface portable for tests and future adapters.

Flow nodes affected:
- All nodes indirectly, because this establishes the traceability and implementation rules the flow depends on.

### Implement first vertical slice
- Added the decision-node enum and node-aligned flow service.
- Added structured plan schema, sufficiency rules, provider result summaries, and trace records.
- Added `PlanStore` abstraction with DynamoDB and in-memory implementations.
- Added OpenAI Agents SDK runtime with a conversational agent, a structured extractor, and file-based Spanish prompt loading.
- Added a real Sin Envolturas provider gateway using live read endpoints.
- Added a Lambda handler, a terminal client that targets the live Lambda Function URL, and a CloudFormation stack with Lambda, DynamoDB, and Function URL resources.
- Added tests for sufficiency, prompt integrity, and agent service persistence behavior.

Reason:
- The requested first slice needed to be executable end to end, not just scaffolded, while still excluding the WhatsApp webhook implementation.

Decision:
- Use the real provider API now behind the future MCP-shaped gateway contract, so terminal-driven testing exercises live provider data while keeping the transport abstraction clean.
- Persist the plan both after required extraction nodes and again after reply generation so the stored `conversation_id` remains aligned with OpenAI Conversations.

Flow nodes affected:
- `contacto_inicial`
- `deteccion_intencion`
- `existe_plan_guardado`
- `entrevista`
- `minimos_para_buscar`
- `aclarar_pedir_faltante`
- `buscar_proveedores`
- `busqueda_exitosa`
- `hay_resultados`
- `recomendar`
- `refinar_criterios`
- `usuario_elige_proveedor`
- `anadir_a_proveedores_recomendados`
- `seguir_refinando_guardar_plan`
- `guardar_cerrar_temporalmente`
- `informar_error_reintento`

### Move OpenAI credential access to AWS Secrets Manager
- Added Secrets Manager runtime resolution for the Lambda.
- Updated CloudFormation to create and authorize access to an OpenAI secret.
- Added a tracked deployment script that reads `OPENAI_API_KEY` from local `.env`, syncs it to AWS Secrets Manager, uploads the Lambda artifact to S3, and deploys the stack.

Reason:
- The Lambda is the runtime that calls OpenAI, so the secret must live in AWS rather than in the terminal client environment.

Decision:
- Keep `.env` local and out of git, and use it only as the deployment-time source of truth for secret synchronization.

Flow nodes affected:
- All nodes indirectly, because every runtime call to OpenAI depends on this credential path.

### Replace the thin terminal client with a debug-first Bun CLI
- Replaced the minimal terminal loop with a Bun-first CLI that targets the deployed Lambda Function URL.
- Added CloudFormation output resolution so the CLI can infer the Function URL and plans table by default.
- Added persisted-plan inspection from DynamoDB after each turn.
- Added rich trace and plan rendering for local debugging.
- Added a tracked `.env.example` so defaults are documented while still allowing CLI flags to override them.

Reason:
- The dev tool needs to be informative enough to debug conversations, not just send plain text and print raw JSON.

Decision:
- Keep the CLI on the same deployed runtime path as Lambda by always sending turns to the live Function URL, while using local AWS access only for developer inspection of CloudFormation outputs and persisted plans.

Flow nodes affected:
- All nodes indirectly, because the CLI now exposes node transitions, prompt bundle usage, and persisted-plan state for every turn.

## 2026-04-06

### Rewrite prompt architecture into node contracts
- Replaced the one-file prompt placeholders with multi-file Spanish prompt bundles per node.
- Split conversational prompt composition from extraction prompt composition.
- Added shared flow discipline, question strategy, and anti-pattern prompt files for conversational turns.
- Added extractor-specific prompt files for field definitions, normalization rules, conflict resolution, and examples.
- Scoped tool availability per node in the runtime so the Agents SDK only exposes tools allowed by the current flow step.
- Added prompt loader tests that verify bundle structure and extractor isolation.

Reason:
- The original prompt files were too thin and too loosely coupled to the runtime, which made node behavior improvised and hard to audit against the thesis flow.

Decision:
- Keep prompt files as plain Spanish text under `prompts/`, but make the runtime enforce the same structure through the manifest so prompt traceability is behavioral, not just nominal.

Flow nodes affected:
- `contacto_inicial`
- `deteccion_intencion`
- `existe_plan_guardado`
- `entrevista`
- `minimos_para_buscar`
- `aclarar_pedir_faltante`
- `usuario_responde`
- `buscar_proveedores`
- `busqueda_exitosa`
- `hay_resultados`
- `recomendar`
- `refinar_criterios`
- `usuario_elige_proveedor`
- `anadir_a_proveedores_recomendados`
- `seguir_refinando_guardar_plan`
- `continua`
- `accion_final_exitosa`
- `necesidad_cubierta`
- `crear_lead_cerrar`
- `guardar_seleccion_reintentar_luego`
- `guardar_cerrar_temporalmente`
- `informar_error_reintento`
- `reintentar`

### Increase Lambda timeout for prompt-heavy runtime turns
- Raised the Lambda timeout in CloudFormation from 30 seconds to 90 seconds.

Reason:
- The deployed runtime timed out on a live invocation after the prompt rewrite, which increased end-to-end turn latency enough to hit the previous limit.

Decision:
- Increase the function timeout now to keep the live serverless path usable while preserving the same runtime architecture.

Flow nodes affected:
- All nodes indirectly, because the timeout applies to the full conversational turn path.

## 2026-04-07

### Add terminal-plan purge utility for DynamoDB
- Added a repo-native purge script for deleting persisted plans created by the terminal test channel.
- Defaulted the script to the `terminal_whatsapp` channel and made it resolve the plans table from CloudFormation or flags.
- Added a `--dry-run` mode and required `--yes` for destructive execution.
- Documented the command in the README.

Reason:
- Terminal-driven testing leaves plan artifacts in the shared DynamoDB table, so the project needs a fast and explicit cleanup path that does not require ad hoc AWS console work.

Decision:
- Implement the purge as a small Node script under `scripts/` instead of an AWS CLI snippet so it stays versioned, reviewable, and aligned with the same stack defaults as the rest of the repo tooling.

Flow nodes affected:
- All nodes indirectly, because the utility deletes persisted plan records regardless of which node last wrote them.

### Centralize runtime configuration and ban explicit any
- Added a project-level convention in `AGENTS.md` that explicit `any` is banned.
- Added ESLint with TypeScript-aware rules so `npm run check` enforces the no-`any` rule through standard linting instead of a custom script.
- Replaced the flat config helper with a validated, centralized runtime config object.
- Moved model names, provider search limits, recommendation limits, detail lookup caps, and default channel settings into the config module.
- Wired Lambda bootstrap, provider gateway, and reply runtime to consume the centralized settings.

Reason:
- Model behavior and runtime knobs were spread across handler defaults, gateway constants, and agent runtime literals, which makes tuning harder and increases drift risk.

Decision:
- Keep configuration environment-driven, but parse it once into a nested typed object so behavior tuning remains explicit and auditable.

Flow nodes affected:
- All nodes indirectly, because the config controls how the runtime searches, recommends, and defaults channel behavior across the full turn path.

### Clarify non-streaming channel scope
- Added a project convention stating that streaming responses are out of scope for now.
- Locked the terminal client to direct WhatsApp-style emulation instead of introducing response patterns the real channel cannot support.

Reason:
- The deployed dev tool should reflect the real channel contract rather than optimizing around terminal-only capabilities that will not exist in WhatsApp.

Decision:
- Keep the runtime synchronous and single-response per inbound turn until a real supported multi-message channel pattern is designed.

Flow nodes affected:
- All nodes indirectly, because this constrains how replies are delivered across the full conversational path.

### Align repo and Lambda runtime to Node 24 LTS
- Updated the Lambda runtime in CloudFormation from `nodejs20.x` to `nodejs24.x`.
- Updated local build targets from `node20` to `node24`.
- Raised the repo engine requirement to Node 24 and added `.nvmrc` for local alignment.

Reason:
- There is no reason to keep the repo and Lambda on an older Node line when the latest available LTS is already supported by the target stack.

Decision:
- Keep the repo and AWS runtime on the same LTS major so build output, local tooling, and deployed execution semantics stay aligned.

Flow nodes affected:
- All nodes indirectly, because the Node runtime applies to the full Lambda execution path.

### Align deployed model defaults with centralized runtime config
- Updated CloudFormation model parameter defaults to match the centralized values in `src/runtime/config.ts`.
- Updated the deploy script to pass explicit model parameter overrides from `.env` or shell env when present.
- Updated `.env.example` and README examples to use the same reply and extractor model defaults as the runtime config.

Reason:
- The Lambda environment is injected by CloudFormation, so stale template defaults could override the centralized TypeScript config at deploy time and produce a different model selection in AWS than the repo suggests locally.

Decision:
- Keep `src/runtime/config.ts` as the canonical runtime config shape, but ensure CloudFormation defaults and deploy-time parameter wiring stay aligned with it so deployed behavior does not drift.

Flow nodes affected:
- All nodes indirectly, because the reply and extractor models govern the full turn path.

### Shift the agent to an event-plan-first model
- Expanded the persisted plan schema to support multiple provider needs plus an active need for the current search or recommendation turn.
- Kept event-level context at the top of the plan while projecting the active need into the legacy single-need fields for runtime compatibility.
- Updated sufficiency, resume logic, provider search, selection handling, and terminal debug output to operate around the active need inside a broader event plan.
- Rewrote the Spanish extractor and node prompts so the agent reasons about the event first and about one active provider need at a time.
- Added an explicit project convention in `AGENTS.md` stating that the agent is event-plan-first and that single-provider search is a subset of that behavior.

Reason:
- The previous runtime was structurally biased toward one provider search at a time, which mismatched the intended product behavior of helping users plan events that often require several providers.

Decision:
- Refactor incrementally toward an event-plan-first model by introducing `provider_needs` and `active_need_category` now, while preserving the existing active-need mirror fields so the deployed runtime, CLI, and traces stay stable during the transition.

Flow nodes affected:
- `deteccion_intencion`
- `entrevista`
- `aclarar_pedir_faltante`
- `recomendar`
- `refinar_criterios`
- `seguir_refinando_guardar_plan`
- `usuario_elige_proveedor`

### Expand the provider tool surface to cover validated marketplace endpoints
- Expanded the provider gateway contract beyond the initial four operations so the runtime can expose the full set of validated marketplace capabilities.
- Added support for category lookup by slug, relevant providers, related providers, provider reviews, event vendor context, event favorites, user events vendor context, tracked provider detail views, quote creation, favorites creation, and provider review creation.
- Updated the Agents SDK tool registry and node prompt manifest so the new capabilities are reachable from the appropriate nodes.
- Updated node tool policy prompts so the conversational layer matches the actual tool surface.

Reason:
- The validated endpoint map in Notion covers more than the initial discovery/search subset, and the runtime should not artificially narrow the system to four operations when the marketplace already exposes a richer capability surface.

Decision:
- Keep the current flow behavior conservative, but expose the full validated endpoint capability set through typed gateway methods and Agents SDK tools so future flow work can build on a stable surface instead of reworking the tool layer again.

Flow nodes affected:
- `entrevista`
- `aclarar_pedir_faltante`
- `buscar_proveedores`
- `recomendar`
- `usuario_elige_proveedor`
- `anadir_a_proveedores_recomendados`
- `crear_lead_cerrar`
- `existe_plan_guardado`
- `reintentar`
- `accion_final_exitosa`

### Improve the first-turn entrypoint for event planning
- Added a first-turn branch so the runtime keeps the conversation in `entrevista` when neither the event type nor an active provider need is known yet.
- Updated the shared and opening Spanish prompts so the agent introduces itself as an event-planning assistant and asks what type of event the user wants to plan before jumping to provider categories.

Reason:
- The previous first reply was still too provider-search-centric and skipped the higher-level event-planning framing that the product now needs.

Decision:
- Keep the existing decision-flow structure, but short-circuit the first missing-data path into `entrevista` whenever the event itself is still undefined. That preserves the node model while fixing the opening behavior.

Flow nodes affected:
- `contacto_inicial`
- `entrevista`

### Enrich recommendation data with provider detail and Sin Envolturas links
- Expanded the typed provider summary model so shortlist items can carry real differentiators from the marketplace, including promo text, service highlights, terms highlights, website URL, min/max price, and the Sin Envolturas detail-page URL.
- Updated the live Sin Envolturas gateway to parse `info_translations`, `promos`, and social-network links into those typed fields instead of leaving them only inside `raw`.
- Enriched provider search results with detail lookups before persisting and recommending them, so the recommendation node receives structured differentiators even when the model does not call detail tools on its own.
- Raised the default recommendation display limit from 3 to 4 and updated the recommendation prompt contract to require concrete differentiators plus the Sin Envolturas link.

Reason:
- The previous recommendation output was too generic because the service persisted shallow search summaries and relied on the model to optionally fetch detail, which often did not happen. That made providers hard to differentiate and omitted direct links to their marketplace pages.

Decision:
- Keep search and recommendation in the same turn, but move provider-detail enrichment into deterministic service logic so the model starts from richer, typed provider records instead of improvising from weak summaries.

Flow nodes affected:
- `buscar_proveedores`
- `hay_resultados`
- `recomendar`

### Fix provider-selection continuity so chosen vendors do not restart search
- Updated the turn orchestration so a provider confirmed by name can be resolved from the active shortlist even when the extractor does not emit an explicit `selectedProviderHint`.
- Changed the post-selection resume path to continue from `seguir_refinando_guardar_plan`, matching the intended state-flow branch after a provider is chosen and saved.
- Allowed the continuity node to use provider detail when the user asks a concrete follow-up about the already selected vendor.
- Added extractor guidance for partial-name selections and a regression test covering the "quiero EDO" path.

Reason:
- The runtime was recognizing `confirmar_proveedor` in traces but still falling back into `buscar_proveedores` and `recomendar`, which broke the Figma state-flow branch where provider choice should transition into saved selection and continuation.

Decision:
- Resolve provider choice deterministically from the current shortlist before any new search is attempted, and treat post-selection follow-ups as continuity work rather than a fresh recommendation cycle.

Flow nodes affected:
- `usuario_elige_proveedor`
- `anadir_a_proveedores_recomendados`
- `seguir_refinando_guardar_plan`
- `recomendar`

### Expose tool outputs in the CLI debug state and add shared domain knowledge
- Extended turn traces to include serialized tool outputs and the provider results that were active for the turn.
- Updated the terminal CLI to render tool outputs and expanded provider debug details, including promo data, services, terms, and URLs.
- Added shared domain-knowledge prompt files for both the conversational runtime and the extractor so all agents inherit local Sin Envolturas terminology, especially around `local` meaning venue/event space.
- Hardened extraction merging so nulls from the extractor do not erase previously known event facts like location, guest range, or event type.

Reason:
- The dev CLI was not exposing enough information to understand why the agent branched a certain way or what data came back from provider search/detail calls. At the same time, the runtime was forgetting previously known facts across turns and re-asking obvious domain concepts like `local`.

Decision:
- Treat full debug visibility as a first-class developer feature by surfacing tool outputs directly in the trace and by keeping provider debug data visible in the CLI without needing raw JSON mode. Treat shared domain knowledge as prompt-level configuration so local terminology is learned consistently by both the reply agent and the extractor.

Flow nodes affected:
- `entrevista`
- `aclarar_pedir_faltante`
- `refinar_criterios`
- `buscar_proveedores`
- `recomendar`

### Preserve mixed provider selections, keep planning mode broader, and harden venue/guest normalization
- Updated the turn orchestrator so a user can confirm a previously recommended provider for one need and open a different active need in the same message without losing the first selection.
- Kept provider confirmation on the selected need while allowing the turn to continue into search/recommendation for the newly active need when appropriate.
- Broadened the interview gating so the runtime stays in `entrevista` whenever the event already exists but no active provider need has been chosen yet, instead of treating the missing category as a search blocker immediately.
- Added deterministic guest-count parsing in the service layer so explicit counts like `100 invitados` map to the correct inclusive range even if the extractor model drifts.
- Strengthened the Sin Envolturas search gateway with category aliases and looser location matching so venue-style queries like `local` can still surface Lima-wide results when the plan contains district-plus-city locations.
- Tightened extractor and interview prompt guidance to preserve mixed-intent turns and to prioritize the event context before asking for provider categories.
- Added regression tests for mixed selection-plus-new-need turns, event-known/no-need planning turns, and the `100 invitados` boundary case.

Reason:
- The live interactions still showed three core failures: confirming one provider while asking for another category only persisted one side of the turn, broad event-planning openings were still treated as missing-category errors, and venue/guest normalization remained brittle enough to trigger unnecessary clarifications.

Decision:
- Keep the multi-need event-plan model, but make selection persistence independent from the currently active need, make the pre-search interview stage handle missing active needs, and add deterministic normalization where exact user input should outrank model inference.

Flow nodes affected:
- `entrevista`
- `usuario_elige_proveedor`
- `anadir_a_proveedores_recomendados`
- `buscar_proveedores`
- `recomendar`
- `seguir_refinando_guardar_plan`

## 2026-04-10

### Add full-marketplace provider completeness census tooling
- Added a reproducible full-census analysis script under `analysis/provider-information-completeness/artifacts/` to crawl the current Sin Envolturas marketplace pagination and fetch every provider detail record.
- Updated the provider-information-completeness dossier to promote full-marketplace conclusions, reproducibility steps, and supporting census artifacts.
- Added a Spanish stakeholder-facing presentation document inside the dossier so the findings can be shared directly without translating the technical notes live.

Reason:
- The earlier category-led sample was good enough for directional guidance, but not for stronger claims about how representative the provider-data issues are across the whole marketplace.
- The dossier had the evidence, but it still needed a concise narrative version that non-technical stakeholders could read quickly.

Decision:
- Keep the original sample artifact for fast spot checks, but treat the census artifact as the default basis for marketplace-wide conclusions about provider differentiation and missing fields.
- Keep the stakeholder presentation in Spanish because it is presentation material for business audiences rather than developer-facing documentation.

Flow nodes affected:
- None directly. This change adds analysis tooling and documentation rather than changing runtime behavior.

## 2026-04-14

### Add exhaustive provider-entry audit artifacts
- Added an exhaustive provider-audit script under `analysis/provider-information-completeness/artifacts/` that exports provider-level JSON and CSV coverage for every current marketplace entry.
- Added field-level, category-level, and collision-cluster artifacts so the dossier can support exact cleanup work rather than only aggregate percentages.
- Updated the provider-information-completeness dossier and stakeholder presentation to reflect the 2026-04-14 full-entry audit.

Reason:
- The earlier census answered marketplace-wide questions, but it still did not provide hard entry-level coverage for all providers or exact issue inventories for remediation work.

Decision:
- Keep the census artifacts as lightweight historical snapshots, but treat the new provider-entry audit as the primary source for exhaustive coverage and cleanup prioritization.

Flow nodes affected:
- None directly. This change adds analysis tooling and documentation rather than changing runtime behavior.

## 2026-04-12

### Add a repo-native evaluation framework for offline and live benchmarking
- Added a typed evaluation subsystem under `src/evals/` covering case schemas, YAML or JSON loading, expectation evaluation, scoring, offline and live targets, reporting, and a CLI entrypoint.
- Added git-tracked evaluation assets under `evals/`, including reusable templates, suite manifests, model matrices, sample fixtures, and seeded regression cases for planning, clarification, recommendation, selection continuity, multi-need continuity, domain knowledge, failure modes, and trace observability.
- Added fixture imports and variable interpolation so cases can reuse seed plans and provider payload fragments instead of duplicating large provider blocks across files.
- Added offline harness support using the real `AgentService` with in-memory persistence plus fixture-backed runtime and provider gateway behavior, and added live Lambda normalization that maps deployed responses back into the same result envelope.
- Added JSONL, JSON, and Markdown report artifacts with aggregate summaries by suite, config, and target plus flaky-case detection.
- Added operator-facing `npm` scripts and documentation for authoring cases, running smoke subsets safely, using dry-runs for cost estimation, and benchmarking across model matrices.
- Added test coverage for schema validation, loader behavior, offline target execution, live target normalization, report generation, and runner-level dry-run and envelope stability.

Reason:
- The agent is still evolving, so the project needed a standardized benchmark harness that can measure state correctness, trajectory quality, tool use, and reply quality without depending on brittle transcript snapshots.
- The repo also needed a shared evaluation language so model, prompt, and orchestration changes can be compared against the same git-tracked cases across offline and live surfaces.

Decision:
- Keep the framework repo-native and TypeScript-first instead of introducing an external evaluation platform as a runtime dependency.
- Use layered expectations and weighted scorers rather than exact response snapshots so the suite stays useful during active development.
- Treat offline evaluation as the default inner loop and live Lambda evaluation as an explicit, budget-aware integration check.

Flow nodes affected:
- None directly. This change adds benchmarking infrastructure, fixtures, documentation, and tests rather than changing the runtime flow behavior itself.

## 2026-04-13

### Reduce extraction and reply token pressure, and expose tool inputs in traces
- Replaced full-plan prompt payloads in the OpenAI runtime with a compact plan snapshot for both extraction and reply composition, preserving key planning fields while removing large duplicated state blocks.
- Added truncation for long conversation summaries in model inputs so summary growth does not linearly inflate prompt size turn by turn.
- Stripped `raw` objects from high-volume tool payloads (`get_provider_detail`, `get_provider_detail_and_track_view`, `list_provider_reviews`) before returning results to the model, reducing tool-context token overhead.
- Extended turn traces with `tool_inputs` and updated the terminal CLI trace renderer to display per-tool inputs and remain robust when older runtime responses do not include the new field.
- Updated project conventions to prefer clean breaks in dev and to redeploy Lambda after Lambda-impacting changes.

Reason:
- Live interactions showed very high token usage and slow extraction latency caused by oversized per-turn context and verbose tool payloads that were not required for model decisions.
- Debugging tool behavior needed both inputs and outputs in the CLI trace, not outputs only.

Decision:
- Keep semantic coverage by sending a compact, purpose-built plan snapshot to models instead of the full persisted plan JSON.
- Remove heavyweight `raw` blobs from tool responses sent to the model while preserving useful structured fields for recommendation quality.
- Treat Lambda redeploy as mandatory in development after runtime-impacting changes to avoid testing stale behavior.

Flow nodes affected:
- `entrevista`
- `aclarar_pedir_faltante`
- `buscar_proveedores`
- `recomendar`
- `reintentar`

## 2026-04-14

### Make search resilient to sparse location granularity and require location in recommendations
- Reworked provider selection in the Sin Envolturas gateway to use category-first matching with location-aware ranking, instead of a strict category+location hard filter that could drop valid providers when location data is coarse.
- Added exact-location preference without forcing zero results: when exact city matches do not exist, category-matching providers with broader location metadata remain eligible.
- Expanded recommendation/output prompt contracts so every shown provider includes location information, and explicitly labels missing location as `Ubicación no especificada`.
- Added a regression test covering the real failure mode where a `Lima` music search returns providers with country-level location (`Perú`) and should still surface options.

Reason:
- Live traces showed users were being sent to refinement despite valid providers existing, because strict location filtering eliminated category-relevant results due to incomplete or coarse marketplace location fields.
- Recommendation messages also needed a stricter contract to always expose location context for decision-making.

Decision:
- Keep precision by preferring exact location matches when present, but preserve recall by falling back to category-relevant candidates when location granularity is insufficient.
- Enforce location visibility at response-contract level so provider cards are always location-explicit to users.

Flow nodes affected:
- `buscar_proveedores`
- `recomendar`

## 2026-04-14

### Tighten zero-result refinement messaging after search-ready turns
- Updated the `refinar_criterios` prompt contract to force explicit acknowledgment that search already ran when `Listo para buscar` is `sí`.
- Required a single concrete closed question after empty results, instead of optional or deferential phrasing.
- Added a guardrail to avoid re-asking the same criterion immediately after the user already relaxed it (for example, budget).
- Updated the `refinar_criterios` system contract so refinement in search-ready context is treated as immediate continuation, not a permission-based next step.

Reason:
- Live terminal traces showed the runtime did execute provider search in search-ready turns, but the conversational reply still used vague "si quieres" follow-ups that sounded like search had not happened and added friction.

Decision:
- Keep search orchestration unchanged in the service layer, and fix the issue at the node prompt-contract level where response behavior is defined.

Flow nodes affected:
- `refinar_criterios`

## 2026-04-14

### Add granular runtime and transport latency tracing in the dev CLI
- Added structured per-stage timing data (`timing_ms`) to turn traces in the runtime service, including plan load, working-plan prep, extraction, extraction-merge, sufficiency, provider search, provider enrichment, prompt loading, reply composition, and persistence.
- Updated terminal CLI rendering to show key timings directly in the reply title (notably extraction and compose latency) and a full timing breakdown in the trace table.
- Added HTTP transport timing in the CLI invocation layer (fetch and JSON parse) so end-to-end latency can be split between network/transport and agent pipeline execution.
- Added token-usage tracing (`token_usage`) for extractor, reply, and combined totals when the runtime exposes usage, and surfaced those values in the CLI trace/debug output.
- Extended eval trace schema validation to include the new `timing_ms` shape.

Reason:
- Live Lambda interactions were taking several seconds and the existing debug output only showed total turn latency, which was insufficient to identify whether delays came from extraction, provider operations, reply composition, persistence, or transport.

Decision:
- Keep instrumentation lightweight and always-on in trace payloads so the same runtime path used in development and evaluation can surface actionable latency breakdowns without adding separate debug codepaths.

Flow nodes affected:
- All nodes indirectly, because latency instrumentation wraps the full turn pipeline regardless of the active decision node.

## 2026-04-16

### Optimize extraction token usage and wire prompt-cache controls
- Reduced extraction input payload size by switching to a compact plan snapshot and removing verbose recommended-provider summaries from the extractor prompt context.
- Added Agents SDK model settings for both extractor and reply calls to set prompt cache retention and send stable prompt cache keys.
- Added GPT-5-specific low-latency defaults (`reasoning.effort: none`, `text.verbosity: low`) through runtime model settings.
- Extended token usage parsing and trace/eval schemas to capture cached input token counts when available.
- Added runtime/deployment configuration for `OPENAI_PROMPT_CACHE_RETENTION` across config parsing, CloudFormation, deploy script wiring, and docs.

Reason:
- Live runs showed extraction taking longer than reply in several turns, with high prompt overhead and poor visibility into cache-hit effectiveness.

Decision:
- Prioritize non-invasive latency/cost reduction by shrinking dynamic extraction context and improving cache routing/retention without changing flow logic or user-facing node contracts.

Flow nodes affected:
- All nodes indirectly, because extraction and reply model calls run on every conversational turn.

### Add CLI cache and latency efficiency insights
- Extended the terminal CLI trace output with a dedicated `Performance Insights` section that reports extraction-vs-compose ratio, pipeline-vs-transport share, and cache-hit-driven savings indicators.
- Enhanced token usage rendering to include cached input tokens, cache hit rate, estimated input-token savings, and effective billed input tokens per extraction/reply/overall bucket.
- Added a compact cache-hit hint in the reply header so optimization impact is visible without scrolling through full traces.

Reason:
- Runtime telemetry now includes cached-token data, but operators still needed a turn-level view that quickly translates raw counters into actionable signals about savings and bottlenecks.

Decision:
- Keep instrumentation in the existing CLI trace surface so optimization validation stays in the normal debugging workflow, without adding separate analysis scripts.

Flow nodes affected:
- All nodes indirectly, because the CLI renders traces for every conversational turn regardless of node.

### Document channel-agnostic architecture and channel adapter contract
- Added `docs/channel-integration.md` with a thorough guide covering:
  - current channel-agnostic boundaries in runtime orchestration,
  - Lambda request/response contract by `client_mode`,
  - telemetry guarantees for all channels,
  - low-cost retention strategy,
  - step-by-step process to implement new consumer-facing channels.
- Updated `README.md` to include a dedicated channel-agnostic and telemetry section, link the new integration guide, and align deployment examples with telemetry retention configuration.
- Updated `docs/evaluation-framework.md` to explicitly document why live eval runs set `client_mode=cli` and how that interacts with telemetry visibility versus telemetry persistence.

Reason:
- The runtime now captures telemetry broadly but only surfaces diagnostics selectively; contributors need one explicit, consistent source of truth for how to implement non-debug channels without losing observability.

Decision:
- Keep channel behavior documented as a strict adapter-layer concern while preserving a channel-agnostic core runtime and always-on server-side telemetry.

Flow nodes affected:
- None directly. This change updates architecture and integration documentation without modifying flow logic.

### Add low-cost turn-level performance telemetry with CLI-only surfacing
- Added a dedicated `logs/trace/perf` module that converts each turn trace into a normalized performance record with derived metrics such as cache-hit rate, extraction-to-compose ratio, tool-call volume, provider-result volume, and hashed user identifiers.
- Added a low-cost telemetry persistence path backed by a dedicated on-demand DynamoDB table with TTL retention (`PERF_RETENTION_DAYS`), plus a no-op fallback store when the table is not configured.
- Updated the Lambda handler to persist telemetry on every turn while only exposing trace and perf diagnostics in the response when the caller explicitly declares `client_mode=cli`, keeping these metrics opaque for non-CLI clients.
- Updated CloudFormation and deployment wiring to provision and configure the perf table and retention controls.
- Updated the CLI to send `client_mode=cli` and render the returned perf snapshot inside debug output.
- Extended the live-eval response schema and live target normalization so end-to-end test runs can validate telemetry payloads on the deployed path.
- Added perf module unit tests plus a live-target test assertion for perf hydration.
- Added an SDK/API compatibility guard for prompt cache retention, translating the configured `in-memory` option into the currently accepted API wire value so deployed runs remain stable.

Reason:
- Feedback quality and runtime cost or latency tuning need durable, structured hard data per turn; trace-only console output was not enough for comparative analysis.
- The project needed this observability with minimal operational cost for a small user base.

Decision:
- Use an always-on per-turn telemetry record persisted to a PAY_PER_REQUEST + TTL DynamoDB table to keep storage and operations inexpensive.
- Keep telemetry output gated behind explicit CLI mode in Lambda responses so runtime observability does not leak by default to non-development clients.

Flow nodes affected:
- All nodes indirectly, because telemetry wraps the full turn lifecycle regardless of active decision node.

### Harden token and cache usage extraction from Agents SDK run results
- Expanded token-usage extraction in `OpenAiAgentRuntime` to parse SDK-native camelCase usage shapes (`state.usage`, `runContext.usage`, and `rawResponses[].usage`) in addition to existing snake_case fields.
- Added fallback parsing for cached tokens from `inputTokensDetails` arrays and `requestUsageEntries`, reducing false `null` usage in traces and CLI perf output.
- Added focused regression tests for run-state usage parsing and request-level cached-token aggregation.

Reason:
- Live CLI sessions still showed `n/a` token and cache fields in turns where model usage should have been available, indicating the parser missed current Agents SDK usage shapes.

Decision:
- Prefer extracting usage from SDK run objects first-class, while keeping existing snake_case compatibility to avoid regressions across provider payload variants.

Flow nodes affected:
- All nodes indirectly, because token and cache telemetry is collected for every runtime turn regardless of active node.

## 2026-04-20

### Implement mixed provider search strategy to maximize coverage
- Updated `SinEnvolturasGateway` search flows to query both `GET /filtered` and `GET /filtered/full` for the same allowlisted search inputs and merge results by provider id.
- Added endpoint-specific normalization for `/filtered/full` items so the runtime can preserve richer promo and description snippets when present.
- Added deterministic merge rules that prefer richer metadata from `/filtered/full` while backfilling higher-availability location and website fields from `/filtered`.
- Kept the strict tool input surface unchanged (`keyword`, `category+location`, and plan-driven search) while improving recall and field completeness under the same tool contracts.
- Updated gateway unit tests to assert both endpoint calls are made for typed search tools.

Reason:
- Coverage analysis showed `/filtered/full` has stronger descriptive and promo fields, while `/filtered` currently has better practical location population for matching and explanation quality.

Decision:
- Use a mixed endpoint strategy at the gateway layer so tools stay strict and simple for the model, while runtime search results gain both recall and metadata completeness without adding new model-facing tool complexity.

Flow nodes affected:
- `buscar_proveedores` and `reintentar` indirectly, because both rely on provider search tools backed by this gateway.

### Add two-stage recommendation funnel (top 15 context -> top 5 presented)
- Increased runtime provider candidate limits so up to 15 shortlisted providers are persisted and passed into reply composition context.
- Updated `SinEnvolturasGateway` search retrieval to auto-fetch up to 4 sequential pages per query window, dedupe by provider id, and merge field completeness before final plan-aware ranking.
- Kept deterministic ranking in gateway and prompt-level presentation constraints in `recomendar` so the LLM receives a richer top-15 pool and is instructed to present only the best 5 options to the user.
- Updated shared output style rules to cap displayed recommendation shortlists at five options.

Reason:
- The recommendation flow needed broader candidate recall to improve quality while preserving concise user-facing shortlists and avoiding full LLM-side reranking over raw endpoint pages.

Decision:
- Use a hybrid two-stage funnel: deterministic retrieval/ranking for breadth and consistency, then LLM final selection/narration over a bounded top-15 context into a top-5 response.

Flow nodes affected:
- `recomendar` directly for presentation policy, plus `buscar_proveedores` and `reintentar` indirectly through expanded retrieval depth and shortlist persistence.

### Extend trace diagnostics and perf persistence observability
- Added a `recommendation_funnel` block to turn traces with candidate availability, candidate ids sent in reply context, and presentation target limit.
- Extended Lambda perf summaries returned to CLI with persistence status (`persisted`) and target store (`storage_target`) so runtime diagnostics can confirm whether Dynamo writes actually succeeded.
- Extended persisted perf records in DynamoDB with recommendation-funnel counts/ids to support downstream analysis of retrieval breadth versus presentation constraints.
- Updated CLI trace rendering to print the recommendation funnel and persistence status inside the trace/perf sections.
- Updated eval schemas and perf unit tests to validate the new observability fields.

Reason:
- Existing CLI diagnostics showed latency and token data but did not explicitly confirm persistence success or expose the retrieval-to-presentation funnel needed to audit top-15 to top-5 behavior.

Decision:
- Keep these diagnostics lightweight, always structured, and available in CLI mode so operators can verify both live execution and persisted telemetry without ad hoc scripts.

Flow nodes affected:
- All nodes indirectly, because trace and perf capture wrap every turn regardless of active node.

### Add non-cluttering live progress indicator for Lambda turn buffering
- Updated the terminal CLI invocation flow to render a single in-place dynamic progress line while waiting for each Lambda turn response.
- Added exact progress phases for request send, runtime wait, response parse, reply render, trace render, Dynamo plan load, and plan render, plus a near-timeout hint when turn latency approaches the configured timeout.
- Kept the dynamic `\r` progress line active through the full post-response lifecycle (trace rendering and plan loading/rendering), not only through network wait, so stalls after reply are visible in real time.
- Added local CLI timing telemetry (`render_reply`, `render_trace`, `load_plan`, `render_plan`, `render_raw`) to diagnose delays that happen after the agent reply is already available.
- Added trace-output truncation guards for large tool payloads and provider lists so oversized debug blocks do not freeze terminal rendering.
- Added graceful handling for invocation failures (including timeout aborts) so the CLI reports a clear error instead of appearing silently stuck.

Reason:
- Live usage showed long waits with little feedback, making it hard to tell whether buffering came from extraction, provider search, compose, transport, or a true timeout.

Decision:
- Keep output clean by using a single rewritten line (no log spam) with exact observable phases only, then clear the line before normal reply rendering.

Flow nodes affected:
- None directly in flow logic. This is a CLI observability and UX improvement for all runtime turns.

### Audit and harden venue/local/place provider search consistency
- Added a dedicated analysis dossier at `analysis/venue-local-search-audit` with live endpoint evidence, reproducible commands, and dated findings for venue-category inconsistency.
- Updated `SinEnvolturasGateway.categoryAliases()` to normalize a wider family of venue-like inputs (`local`, `locales`, `venue`, `place`, `lugar`, `salon`, `espacio`, `recepcion`) into robust search aliases.
- Updated `searchProvidersByCategoryLocation()` to try alias-based composed terms first, then retry category-only terms when strict `category + location` queries return empty.
- Added `searchProvidersBySearchTerms()` helper to keep fallback search behavior deterministic and bounded.
- Added regression coverage in `tests/sinenvolturas-gateway.test.ts` for the case where `venue + Lima` fails but alias fallback (`local`) succeeds.

Reason:
- Live behavior showed recurring zero-results for venue-like phrasing even when `local` returned valid `Locales` providers, causing inconsistent recommendations for the same intent.

Decision:
- Keep the model-facing tools unchanged and fix inconsistency in gateway query normalization and fallback strategy, backed by reproducible analysis artifacts.

Flow nodes affected:
- `buscar_proveedores` and `reintentar` indirectly, because both rely on gateway-backed provider search and category/location retrieval logic.

## 2026-04-20

### Finish-plan tool, lifecycle persistence, and plan-row TTL
- Extended the persisted plan schema with `lifecycle_state` (`active` | `finished`), `contact_name`, and `contact_email` to support a post-selection closeout path.
- Added `finish_plan` to the OpenAI runtime tools: it requires `name` and `email`, marks the plan finished, moves the node to `necesidad_cubierta`, returns a stub payload (`provider_contact_flow_not_implemented_yet`), and signals a 24-hour DynamoDB TTL via `onPlanFinished`.
- Wired `AgentService` to pass TTL through every plan persist after `finish_plan`, and to short-circuit new turns when a stored plan is already finished (deterministic Spanish reply, no extractor or compose).
- Enabled DynamoDB TTL on the plans table (`ttl_epoch_seconds`) and taught `DynamoPlanStore` to write and strip that attribute separately from the Zod plan payload.
- Updated `crear_lead_cerrar` prompts to authorize and describe `finish_plan`.
- Added tests for lifecycle parsing, merge behavior, finished-plan short-circuit, and eval live-lambda seed alignment.

Reason:
- The product needs an explicit “contact providers and close” step with inbox persistence later; today we only persist closure metadata and enforce a cooldown before a fresh plan can be stored again.

Decision:
- Use DynamoDB item TTL on the same `PLAN` row so finished rows disappear after 24 hours and `getByExternalUser` naturally returns null for a new `createEmptyPlan` session.

Flow nodes affected:
- `crear_lead_cerrar`, `necesidad_cubierta`, and `existe_plan_guardado` (read path for finished plans).

### Lint hygiene (token usage + gateway test)
- Replaced an unsafe spread in `OpenAiAgentRuntime.collectUsageCandidates` with an explicit loop.
- Added `urlFromVitestFetchMockCall` in `tests/sinenvolturas-gateway.test.ts` so Vitest fetch mock assertions stay strictly typed.

Reason:
- `npm run lint` must stay clean after the runtime changes touched nearby code paths.

### Finish-plan state-model hardening + SOTA-style eval metrics
- Added `isPlanFinished()` in `src/core/plan.ts` and wired it into `AgentService` and `resolveResumeNode()` so lifecycle closure is represented as a first-class state-model guard, not ad-hoc string checks.
- Extended eval result/report schemas with benchmark metrics (`tool_precision/recall/F1`, branch coverage, state and trajectory pass rates, plan persistence rate, cache hit rate, token totals, latency distribution).
- Implemented automatic benchmark metric computation per case in `src/evals/runner.ts` and aggregate benchmark summaries in `src/evals/reporting.ts`, including Markdown rendering.
- Added a new offline eval case `state.finished_plan_short_circuits_turn` and included it in `dev_regression` and `benchmark_full` suites to validate finished-plan branch behavior and closure messaging.
- Added deterministic unit coverage for finished-state resume semantics (`tests/decision-flow.test.ts`) and TTL persistence callback plumbing in `tests/agent-service.test.ts`.

Reason:
- The finish flow needs to be integrated with the plan lifecycle model and validated with richer, benchmark-oriented quality signals instead of only pass/fail checks.

Decision:
- Keep the existing expectation/scorer framework and augment it with always-on benchmark KPIs so every run yields standardized state, tool-use, and trajectory metrics without requiring per-case boilerplate.

### Live Lambda eval expansion for finished-plan lifecycle
- Extended `runLiveLambdaCase` to preload `seedPlan` into Dynamo before sending turn inputs, mirroring offline seeding behavior for branch validation.
- Promoted `state.finished_plan_short_circuits_turn` to `template.base-both-targets` so the same lifecycle branch runs in both offline and live modes.
- Added the new lifecycle case to `evals/suites/live_smoke.yaml` to keep a low-cost live assertion for the finished-plan short-circuit.
- Expanded `tests/eval-live-target.test.ts` with a dedicated seeded-plan test that verifies persisted finished lifecycle fields are used during live target normalization.

Reason:
- The finished-plan branch should be validated under real Lambda transport with Dynamo-backed state, not only via offline fixtures.

### Parallel eval execution + dashboard artifacts
- Added configurable eval concurrency via `parallelism` in `runEvaluation` and CLI flag `--parallel <n>`, using a bounded worker pool while preserving deterministic result ordering.
- Added `dashboard.json` and `dashboard.csv` artifacts per run with objective case-level KPIs and report-level benchmark summaries for BI ingestion.
- Documented parallel run usage and dashboard outputs in `README.md`.

Reason:
- Large benchmark suites need faster turnaround and machine-consumable metrics output suitable for dashboards beyond markdown reports.

### Eval-case diversity expansion for state and failure branches
- Added `state.resume_from_temporal_close_goes_to_entrevista` to validate resume behavior from `guardar_cerrar_temporalmente`.
- Added `state.close_intent_saves_temporal_node` to distinguish generic close intent from final finished lifecycle state.
- Added `search_error.provider_failure_moves_to_retry_node` to cover provider search exception routing into `informar_error_reintento`.
- Included the new scenarios in `dev_regression` and `benchmark_full` suites.

Reason:
- The benchmark needed broader behavioral coverage across resume, close, and operational error branches to reduce blind spots in quality metrics.

### Flow fixes after benchmark feedback
- When continuing to another need after selecting a provider in a mixed turn, search-result projection now clears `selected_provider_id` and `selected_provider_hint` for the newly active shortlisted need to avoid stale cross-need selection hints.
- Provider search failures now record `search_providers_from_plan` in `tools_called` plus an error payload in `tool_outputs`, so observability and tool-usage expectations reflect attempted calls that failed upstream.

Reason:
- Benchmark failures revealed two instrumentation/state-quality issues: stale selection hints on a different active need and missing tool-call trace data on failed provider searches.

### Live-target skip classification fix
- Updated eval result finalization to preserve runtime `skipped` outcomes explicitly (instead of coercing them into `failed` via unmet expectations when no turns are available).
- Added deterministic skipped-case artifact output with baseline benchmark metrics so dashboard ingestion remains stable even when live target configuration is unavailable.

Reason:
- Live benchmark runs without a configured Function URL were being misreported as failures, creating false negatives in dashboard KPIs.

### Cross-target expectation normalization for live OpenAI variability
- Relaxed `entrypoint.event_known_no_active_need` by removing strict plan-field equality checks (`event_type`, `location`) that are deterministic offline but model-variable in live extraction.
- Relaxed `domain.guest_range_boundary_100` to accept either `recomendar` or `aclarar_pedir_faltante` transitions, reflecting valid live behavior when location is still missing.

Reason:
- Live Lambda/OpenAI runs should validate behavior envelopes without overfitting to fixture-deterministic extraction outputs.

### Live Lambda benchmark hardening
- Added trace-level expectation types (`trace_field_equals`, `trace_field_subset`, `trace_field_number`) and `provider_result_count` so live cases can assert structured runtime behavior beyond broad node envelopes.
- Tightened existing live comprehensive cases to check search readiness, persistence, provider search usage, provider result counts, and null selection state where appropriate.
- Expanded `live_comprehensive` with four multi-turn and negative-control cases covering event-first planning, follow-up catering search, multi-need capture, refinement after recommendations, and vague requests that must not search.
- Added latency/tool-call targets to the base live scorer so budget efficiency is no longer an automatic perfect score.
- Fixed live target plan hydration to resolve the deployed plans table from CloudFormation outputs unless `PLANS_TABLE_NAME` is explicitly set, avoiding false null-field failures from the local default table name.
- Updated live local-space and photography search-path cases to include guest counts so their strict search expectations align with the runtime sufficiency rule that requires category, location, and budget or guest range.
- Tightened the event-first multi-need live case wording so the opening turn explicitly has no chosen provider category, reducing stochastic misclassification as a venue search.
- Raised the event-plan-to-catering tool ceilings to allow normal recommendation enrichment/review calls while still bounding runaway tool usage.

Reason:
- The live Lambda suite was too permissive: broad allowed transitions and missing trace assertions let integrations score 100% while still hiding search readiness, persistence, and state-continuity regressions.
- The first hardened live run also exposed an eval-adapter defect: Dynamo had the correct persisted plan, while artifacts showed fallback trace-only plans because the adapter read the wrong table.

Decision:
- Keep text checks tolerant, but make the primary gates structured: plan fields, trace fields, provider counts, tool calls, and multi-turn continuity.

### Preserve known guest range when extraction returns unknown
- Updated runtime plan merge behavior so extractor output `guestRange: "unknown"` is treated like no new information and cannot overwrite an already known guest range.
- Extended `AgentService` regression coverage to preserve a seeded `guest_range` when a follow-up extraction returns null/unknown fields.

Reason:
- The hardened live suite found a real state-continuity bug: a second turn in a multi-need flow degraded `guest_range` from `21-50` to `unknown`, weakening subsequent provider search context.

Decision:
- Keep explicit guest counts inferred from the user message highest priority, keep concrete extractor ranges second, and reserve the prior plan value whenever the extractor only emits `unknown`.

### Guard broad event planning against implicit venue inference
- Added a deterministic runtime guard that drops venue-like extracted categories when there is no active need and the user message does not explicitly mention local, salón, espacio, venue, or equivalent wording.
- Updated extractor domain knowledge and examples to distinguish broad event-planning openers from explicit venue/local requests.
- Added regression coverage for an extractor that incorrectly returns `local` from a broad planning opener.

Reason:
- Live reruns showed stochastic false venue searches for messages like “quiero planear un matrimonio en Lima”, which violates the event-plan-first behavior and creates premature provider searches.

Decision:
- Keep explicit venue requests fully supported, but require explicit venue wording before opening a local/salón need from an otherwise broad event-planning turn.

### Preserve numeric-leading provider selections and avoid post-turn plan fetches
- Updated provider selection resolution to match provider names before interpreting a hint as an ordinal, so names such as `4Foodies` are not mistaken for option numbers.
- Added ordinal-word support for selections such as `primera opción`, allowing active shortlists to be confirmed without re-running provider search.
- Stopped persisting unresolved `selected_provider_hint` values onto shortlisted needs; hints now become durable only when they resolve to a selected provider.
- Added the current plan snapshot to CLI-mode Lambda responses and updated the terminal/eval clients to use it instead of doing a second DynamoDB plan read after every turn.
- Updated terminal plan diagnostics to show selected providers inside each provider need and moved local timing calculation so plan-render time is visible in the trace diagnostics.
- Added regression coverage for numeric-leading provider names and ordinal-word selection.

Reason:
- A live terminal conversation showed two linked failures: selecting `4Foodies` while opening music left catering as merely shortlisted, and later `primera opción` did not persist the music selection.
- The same run showed runtime perf records in DynamoDB were fast enough while the terminal spent tens of seconds after the reply waiting on an extra plan fetch, making diagnostics misleading.

Decision:
- Treat the Lambda response as the authoritative post-turn debug envelope for CLI mode, while keeping `/plan` available for explicit out-of-band DynamoDB inspection.

### Align conversational provider selection across prompts and reducer
- Extended the extractor input snapshot with compact shortlisted provider context: title, slug, category, services, promo, and short description.
- Updated extractor prompts to resolve conversational references to prior shortlist items, including descriptive references like `la de tablas de queso`, `la de violín`, or `la propuesta en vivo` when exactly one provider is plausible.
- Tightened recommendation and provider-selection response contracts so replies only claim a provider is selected when the plan has `selected_provider_id`.
- Added deterministic reducer fallback for descriptive references by scoring the user message against known provider titles, services, promos, descriptions, and other shortlist text.
- Changed provider alias matching to require token boundaries so short aliases such as `edo` cannot match unrelated words like `proveedor`.
- Added regression coverage where the extractor emits no `selectedProviderHint`, but the reducer still selects the cheese-table catering option and continues to the next need.
- Added regression coverage for model-generated descriptive hints that mention `4Foodies` while also containing the word `proveedor`.

Reason:
- A planning agent should understand natural follow-ups, not only exact names and option numbers. The previous extractor context lacked provider names/differentiators, and persistence could fail when the structured hint was absent.

Decision:
- Let the model interpret conversational references with richer context, but keep durable plan mutation deterministic and conservative: select only on a unique, clear match; otherwise ask for clarification instead of guessing.

## 2026-04-21

### Expand channel integration contract
- Rewrote `docs/channel-integration.md` as a thorough adapter guide with the current live Lambda Function URL, CloudFormation output names, request and response contracts, channel and CLI response examples, error handling, state identity rules, telemetry correlation, provider endpoint dependencies, runtime configuration, validation commands, and adapter completion checklist.
- Included the currently deployed development endpoint (`https://jwtjjociscvaa5dsrp5gokmno40doiva.lambda-url.us-east-1.on.aws/`) and DynamoDB tables (`recap-agent-runtime-plans`, `recap-agent-runtime-perf`) resolved from CloudFormation on 2026-04-21.

Reason:
- The previous guide explained the high-level channel-agnostic intent but did not give enough concrete detail for someone to implement or validate a real channel adapter.

Decision:
- Keep the guide focused on the runtime boundary and live integration contract, while making clear that webhook auth, retries, formatting, deduplication, and delivery callbacks belong in channel adapters rather than `src/runtime`.

## 2026-04-23

### Wire `finish_plan` to real `/api-web/vendor/quote` endpoint
- Replaced the stub `finish_plan` implementation with a real integration against the Sin Envolturas `POST /api-web/vendor/quote` endpoint.
- Changed `finish_plan` tool parameters from `(name, email)` to no parameters; it now reads `contact_name`, `contact_email`, and `contact_phone` from the persisted plan.
- Added `contact_phone` to the persisted plan schema, extraction schema, and extractor field definitions.
- `finish_plan` now iterates over every `provider_needs` entry with `selected_provider_id` set, calling `createQuoteRequest` per selected provider with:
  - `name`, `email`, `phone` from the plan contact fields
  - `phoneExtension: '+51'`
  - `eventDate: today`
  - `guestsRange` from `plan.guest_range`
  - `description` from `plan.conversation_summary`
  - `userId` omitted (guest user path)
- Returns per-provider outcomes (`success` | `error`) plus an overall `status` (`success`, `partial`, `failed`) and the 24h TTL epoch.
- On success, mutates the plan to `lifecycle_state: finished`, `current_node: necesidad_cubierta`, and invokes `onPlanFinished` so DynamoDB TTL is written.

### Split pause vs close routing in `AgentService`
- Separated `pausar` (pause) from `cerrar` (close) intent handling:
  - `pausar` / `pauseRequested` routes to `guardar_cerrar_temporalmente` (temporary save).
  - `cerrar` routes to `crear_lead_cerrar` (real close flow).
- This fixes the previous behavior where both intents were collapsed into a temporary close, which did not make sense for a definitive close action.

### Rewrite `crear_lead_cerrar` prompts for multi-turn close flow
- Rewrote all four prompt files (`system`, `response_contract`, `tool_policy`, `transition_policy`) to implement a three-step close flow:
  1. Collect contact info (name, email, phone) if missing.
  2. Show a summary of selected providers per need and ask for explicit confirmation.
  3. Upon confirmation, call `finish_plan` to send quote requests and close.
- The agent must not close without explicit user confirmation.
- Users can edit contact info or provider selections at the confirmation step; normal extraction handles corrections next turn.

### Update related prompts
- Updated `seguir_refinando_guardar_plan` system and response contract to proactively suggest closing the plan when all needs have selected providers.
- Updated `guardar_cerrar_temporalmente` system prompt to only mention pause (no longer close).
- Updated extractor system and field definitions to extract `contactName`, `contactEmail`, `contactPhone` from any turn.

### Type and contract updates
- Added `onPlanFinished?: (ttlEpochSeconds: number) => void` to `ComposeReplyRequest` in `src/runtime/contracts.ts`.
- Added `contactName`, `contactEmail`, `contactPhone` to the runtime extraction schema and `ExtractionResult` contract.
- Updated `buildExtractorPlanSnapshot` and `buildPromptPlanSnapshot` to include contact fields in model context.
- Added `finish_plan` to `toolNames` and `crear_lead_cerrar.allowedTools` in the prompt manifest.
- Rewrote `src/runtime/finish-plan-tool.ts` as an async shared function that calls the provider gateway per selected provider.

### Tests
- Added `contactName`, `contactEmail`, `contactPhone: null` to all `ExtractionResult` objects in `tests/agent-service.test.ts`.
- Verified all 20 core tests pass (agent-service, decision-flow, plan-lifecycle, sufficiency).

Reason:
- The `finish_plan` tool was a stub (`provider_contact_flow_not_implemented_yet`) even though the Sin Envolturas API already exposes `POST /api-web/vendor/quote`. The product needs a real close flow that contacts selected vendors and marks the plan finished.
- The previous `cerrar` intent routing to `guardar_cerrar_temporalmente` was confusing because temporary save and definitive close are semantically different actions.

Decision:
- Use the existing `createQuoteRequest` gateway method (already typed for `/quote`) inside a loop over selected providers, keeping the model-facing tool surface minimal (`finish_plan` with no params).
- Persist contact info to the plan so the multi-turn close flow survives across turns without requiring the agent to re-ask.
- Keep user editing flexible at the confirmation step: normal extraction and flow routing handle corrections without special-case logic.

Flow nodes affected:
- `crear_lead_cerrar` (complete rewrite of close flow)
- `guardar_cerrar_temporalmente` (clarified as pause-only)
- `seguir_refinando_guardar_plan` (proactive close suggestion)
- `necesidad_cubierta` (post-finish close node)
- All nodes indirectly through extraction schema changes

### Fix broaden-search and close-contact confusion after recommendation
- Added an AgentService broaden-search branch for refinement turns like `busca más` / `más opciones`.
- The service now calls `search_providers_by_category_location` with `page: 2` for the active need and location, persists unseen providers when found, and carries a user-facing note when no additional distinct options exist.
- Changed the runtime conversation envelope label from `Error operativo` to `Nota operativa` so the model can safely communicate search exhaustion without treating it as a system failure.
- Updated `recomendar` prompts so the reply must explicitly say when no more options were found and must not claim provider contact is impossible when the close flow can send quote requests.
- Updated extractor guidance so requests like `puedes contactar al proveedor` map to `intent: cerrar`, and contextual pronoun selections after a single highlighted recommendation are treated as provider selections instead of ambiguous chatter.
- Added regression tests for both broaden-search outcomes: new providers on page 2 and no-additional-options fallback.

### Expand broaden-search beyond a single extra page
- Replaced the page-2-only widen logic with an aggregated unseen-provider search in `AgentService`.
- `busca más` / `más opciones` now collect providers across up to 5 pages of `search_providers_by_category_location` for:
  - the active category plus current location, then
  - the active category without location as a wider fallback.
- The service deduplicates provider IDs across all fetched pages and excludes providers already shown in the active shortlist before persisting the next batch.
- The target is now a fresh unseen batch of up to 5 providers instead of trusting a single upstream page boundary.
- Added regression coverage for:
  - collecting unseen providers from later pages after earlier duplicates,
  - no-new-results exhaustion,
  - fallback from location-scoped search to category-wide search.

Reason:
- A single `page: 2` call was still too dependent on upstream ranking and could keep surfacing the same providers, which did not satisfy user requests to widen the search meaningfully.

Decision:
- Keep the change in `AgentService` so broaden-search behavior remains deterministic and easy to observe in trace logs without expanding the provider gateway surface area yet.

### Make broaden-search intent-driven instead of phrase-driven
- Removed the manual widen-phrase parser from `AgentService.shouldBroadenProviderSearch(...)`.
- Broadening now depends primarily on extractor output and existing recommendation context:
  - `intent === refinar_busqueda`
  - there is already an active shortlist to expand
  - the extractor did not introduce a real search-criteria change versus the baseline plan
- Criteria changes that keep the flow on the normal `search_providers_from_plan` path include changes to category, location, budget, event type, guest range, preferences, or hard constraints.
- Added a regression test proving that a budget refinement (`más económicas`) reuses the original search path instead of broadening the old shortlist.

Reason:
- Phrase matching was brittle and could drift from the extractor's intent model, creating inconsistent behavior between similar refinement turns.

Decision:
- Let the extractor decide whether the user is refining, and let runtime logic decide whether that refinement means "expand current shortlist" or "rerun search with new constraints".

### Add richer perf diagnostics for failed interaction analysis
- Expanded `TurnTrace` with structured debugging summaries instead of relying only on counters:
  - `search_strategy` (`none`, `search_from_plan`, `broaden_existing_shortlist`)
  - `extraction_summary` (intent confidence, extracted category/location/budget/guest range, preferences, hard constraints, selected hint, pause flag, contact presence)
  - `plan_summary` (current node, lifecycle state, event type, active need, location, budget, guest range, provider-need categories/statuses, contact presence)
  - explicit `recommendation_funnel` typing in the core trace contract
- Expanded `TurnPerfRecord` so Dynamo perf rows now persist the key data needed to reconstruct failures without fetching ephemeral runtime output:
  - `user_message_hash`
  - truncated `user_message_preview`
  - `previous_node`
  - `node_path`
  - `intent`
  - `prompt_bundle_id`
  - `tools_considered`
  - `search_strategy`
  - `extraction_summary`
  - `plan_summary`
  - `provider_result_ids`
  - full `missing_fields`
- Kept these as compact summaries rather than dumping full raw plan blobs or model internals, so the records remain queryable and useful for debugging interaction failures like web-chat stalls or repeated recommendation loops.
- Added perf-trace tests covering the new persisted fields and updated runtime tests to stay aligned with the richer trace schema.

Reason:
- The previous perf records were too thin to explain why a turn stayed in `entrevista`, why a refine request broadened versus reran search, or what extracted criteria led to a failed interaction. Debugging required correlating multiple tables and guessing at missing context.

Decision:
- Persist concise, searchable summaries of extraction and plan state directly into the perf table so a single Dynamo query can explain most interaction failures.

### Push more need-switching behavior into extractor semantics
- Strengthened extractor instructions so mid-recommendation pivots like `y qué djs tienes`, `y de foto?`, `también quiero ver música`, or `ahora muéstrame catering` are interpreted as switching `activeNeedCategory`, even if the previous provider need was not selected yet.
- Expanded extractor field definitions and normalization rules so:
  - `vendorCategory` follows the new provider class mentioned in the current turn,
  - `activeNeedCategory` can switch immediately without forcing closure of the previous need,
  - entertainment labels like `dj`, `djs`, `música`, `banda`, and `orquesta` normalize into the music family.
- Added explicit extractor examples for:
  - switching from one need to another mid-flow,
  - asking for a different category with conversational phrasing,
  - distinguishing `muéstrame otras opciones` (refine current need) from `y qué djs tienes` (switch need).
- Extended debug persistence further so perf rows now also capture:
  - `operational_note`
  - `prompt_file_paths`
  - richer `extraction_summary` (`vendor_categories`, `assumptions`, summary preview)
  - richer `plan_summary` (`provider_need_count`, summary preview, open question count)

Reason:
- Category switching is subtle and language-dependent. Deterministic parsing quickly becomes brittle here, while the extractor already has the plan context and shortlist needed to make the right semantic call.

Decision:
- Keep deterministic runtime parsing minimal and focused on narrow structural cases (selection references, explicit guest-number inference, venue guardrails), while moving need-switch interpretation and category normalization further into the extractor LLM and storing the resulting reasoning context in perf.

### Move provider-choice interpretation from runtime parsing into extractor context
- Enriched the extractor plan snapshot so each shortlisted provider now carries explicit ordered context (`rank`) plus location and price-level summary, giving the extractor enough information to resolve references like `la segunda`, `ese`, or `la de tablas de queso` from the plan snapshot itself.
- Strengthened extractor instructions and examples to treat `selectedProviderHint` as a required structured output whenever the user is clearly choosing from a visible shortlist.
- Reduced runtime provider-selection heuristics to a near-zero fallback layer:
  - the runtime now trusts `selectedProviderHint` from the extractor,
  - resolves it by exact/partial provider alias or ordinal only,
  - and only auto-selects when there is exactly one candidate and the intent is already `confirmar_proveedor`.
- Removed the previous raw-message salvage path that tried to infer provider choice directly in the runtime from pronouns and descriptive phrases.

Reason:
- Provider-choice parsing in the runtime was one of the largest remaining heuristic fronts. It duplicated semantic work that the extractor can do better because it already sees the ordered shortlist and the full plan context.

Decision:
- Let the extractor own almost all provider-reference interpretation and keep the runtime to structural resolution of the extractor's explicit hint.

Reason:
- The live interaction showed two user-facing failures: asking for a wider search just replayed the same shortlist, and asking to contact a provider from the recommendation phase incorrectly claimed the product could not do something that `finish_plan` already supports.

Decision:
- Keep the fix minimal and deterministic in the runtime by owning widen-scope behavior in `AgentService`, instead of hoping the reply model will infer pagination or search exhaustion from prompts alone.
- Keep close/contact routing model-driven through extractor guidance, but add guardrails in `recomendar` so the reply stays truthful even if the turn has not yet transitioned into `crear_lead_cerrar`.

## 2026-04-28

### Recover repo after iCloud desync and deleted .git/node_modules
- Removed ~170 duplicate files created by macOS iCloud (`* 2.*` pattern) after verifying non-"2" versions were newer via `diff` and `stat` mtime comparison.
- Re-created `.git` from scratch: `git init`, `git remote add origin https://github.com/pdellepiane/recap-agent.git`, fetched `origin/main`, force-checked out tracking branch, then restored working tree from an rsync backup taken before checkout.
- Verified 11 modified files and 20+ untracked files (uncommitted changes) were preserved.
- Re-installed dependencies with `bun install` (409 packages, migrated from `package-lock.json`).
- Added `.cursor/` to `.gitignore` alongside existing rules (`node_modules/`, `dist/`, `.env`, `.DS_Store`, eval runs, broken-git backups).
- Committed all non-WIP changes as a single feature commit (`ade1910`).

Reason:
- The iCloud conflict created two copies of most files; without careful comparison we could have lost days of uncommitted work.

Decision:
- Use timestamp and diff comparison rather than heuristics to decide which copy to keep.
- Create a filesystem backup before any destructive git operation.

### Finish knowledge-sync WIP: connect scraped Tawk help center to agent runtime
**What was already there before this session:**
- `src/knowledge-sync/` — scraper (`TawkHelpScraper`), formatter (`articlesToMarkdown`), uploader (`OpenAiKnowledgeUploader`), sync orchestrator (`runKnowledgeBaseSync`), Lambda handler (`handler.ts`), and types.
- `scripts/sync-knowledge-base.ts` — local CLI script to scrape and optionally upload.
- `infra/knowledge-sync.yml` — standalone CloudFormation stack with a scheduled Lambda (`rate(1 day)`), EventBridge rule, and IAM role.
- `scripts/build.mjs` — already built `src/knowledge-sync/handler.ts` into `dist/knowledge-sync/index.js`.

**What was missing (the actual gap):**
- The agent runtime (`OpenAiAgentRuntime`) never received the vector-store configuration and never exposed `file_search` as a tool to the reply agent. This meant the scraped knowledge base was uploaded to OpenAI but the agent could not query it.
- The main CloudFormation stack (`infra/cloudformation/stack.yaml`) did not pass KB env vars (`KB_ENABLED`, `KB_VECTOR_STORE_ID`) to the runtime Lambda.
- The deploy script (`scripts/deploy.mjs`) only deployed the main stack, not the knowledge-sync stack.

**What was implemented/fixed:**
1. **Runtime integration:**
   - Added `knowledgeBase?: { enabled: boolean; vectorStoreId: string | null }` to `OpenAiAgentRuntime` constructor options.
   - Added `createFileSearchTool()` method that returns a `HostedTool` with `type: 'hosted_tool'`, `name: 'file_search'`, and `providerData.vector_store_ids` when KB is enabled and a vector store ID is configured.
   - The `file_search` tool is automatically appended to the reply agent's tool list on every `composeReply` call.
   - `src/lambda/handler.ts` now passes `config.knowledgeBase` to the runtime constructor.
2. **Infrastructure wiring:**
   - Added `KB_ENABLED`, `KB_BASE_URL`, `KB_VECTOR_STORE_NAME`, `KB_VECTOR_STORE_ID` to `src/runtime/config.ts` environment schema and `AppConfig` type.
   - Added `PRESENTATION_PROVIDER_LIMIT` env var to config (was referenced in handler but missing from schema, causing a pre-existing type error).
3. **Uploader fix:**
   - Fixed `openai-uploader.ts` `uploadAndPoll` call: the SDK expects `{ files: [...] }`, not a raw array. Was a type error that would have failed at runtime.
4. **Pre-existing type-error cleanup (unrelated but blocking clean typecheck):**
   - `src/evals/targets/offline.ts` — added missing `contactName/Email/Phone` fields to mock extractions.
   - `src/evals/runner.ts` — added `default` case to `evaluateExpectation` switch.
   - `src/evals/case-schema.ts` — made `benchmarkSummary` optional in `evalReportSchema`.
   - `src/storage/plan-store.ts` — added `ttlEpochSeconds?: number` to `SavePlanInput`.
   - `src/runtime/contracts.ts` — added `recommendationFunnel` to `ComposeReplyResult`.

**Scraper validation:**
- Ran `KB_SKIP_UPLOAD=true npx tsx scripts/sync-knowledge-base.ts` against `https://sinenvolturas.tawk.help`.
- Result: **52 articles scraped**, output written to `dist/knowledge-base/sinenvolturas-kb.md` (1,213 lines).
- Content categories observed: "Sobre Sin Envolturas", "Actualización Web", "FAQ", "Pagos", "Eventos". Articles cover pricing, gift lists, event planning, payment methods, commissions.
- Build output verified: `dist/knowledge-sync/index.js` (652 KB) and sourcemap exist.

**Vector store status:**
- Quoted OpenAI API for existing vector stores: **none found** (`[]`).
- No `KB_VECTOR_STORE_ID` configured in `.env`.
- The knowledge-sync Lambda has never been deployed (no `.artifacts/` directory, no S3 zip history).

**Deployment gaps still open:**
1. `infra/cloudformation/stack.yaml` does **not** pass `KB_ENABLED` or `KB_VECTOR_STORE_ID` to the runtime Lambda's environment variables. The runtime will default to `enabled: true` with `vectorStoreId: null`, so `file_search` will not be attached until the env var is added.
2. `scripts/deploy.mjs` does **not** deploy `infra/knowledge-sync.yml`. There is no automated path to:
   - Create the knowledge-sync Lambda,
   - Upload the `dist/knowledge-sync/` zip to the expected S3 key,
   - Pass the OpenAI API key to the knowledge-sync Lambda (it expects `OPENAI_API_KEY` as a plain env var, not via Secrets Manager).
3. No initial vector store creation + upload has been done. The first run requires:
   - Creating a vector store via OpenAI API,
   - Uploading `dist/knowledge-base/sinenvolturas-kb.md` to it,
   - Recording the vector store ID into the runtime Lambda's env vars.

**Recommended next steps (in order):**
1. Add `KB_ENABLED` and `KB_VECTOR_STORE_ID` parameters to `infra/cloudformation/stack.yaml` and wire them into the `RuntimeFunction` environment block.
2. Extend `scripts/deploy.mjs` (or create a separate deploy script) to:
   - Zip `dist/knowledge-sync/` and upload to the S3 key expected by `infra/knowledge-sync.yml`,
   - Deploy `infra/knowledge-sync.yml` with the OpenAI API key parameter,
   - Run the knowledge-sync Lambda once manually (or wait for the scheduled trigger) to create the vector store,
   - Capture the returned vector store ID and update the main stack's `KB_VECTOR_STORE_ID` parameter,
   - Re-deploy the main stack so the runtime Lambda receives the vector store ID.
3. Alternatively, do a one-time local upload to create the vector store, record the ID in `.env` and the main stack, then rely on the scheduled Lambda for subsequent updates.

Reason:
- The knowledge-sync feature was structurally complete (scraper, formatter, uploader, scheduler, build target) but lacked the final runtime integration that actually lets the agent query the knowledge base. Without this wiring, the vector store would have been a dead artifact.

Decision:
- Use the Agents SDK `HostedTool` mechanism for `file_search` rather than raw Responses API calls, because the reply agent is already instantiated through the SDK and `HostedTool` is the documented way to attach OpenAI-hosted tools.
- Keep the knowledge-sync stack separate from the main runtime stack (as it was designed) because it has a different lifecycle, trigger pattern (scheduled vs on-demand), and S3 artifact path. But document the dependency: the main runtime needs the vector store ID that the sync stack creates.

Files changed:
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/config.ts`
- `src/runtime/contracts.ts`
- `src/lambda/handler.ts`
- `src/knowledge-sync/openai-uploader.ts`
- `src/evals/targets/offline.ts`
- `src/evals/runner.ts`
- `src/evals/case-schema.ts`
- `src/storage/plan-store.ts`
- `docs/implementation-log.md`

### Redesign knowledge-base as first-class state-machine node
**Problem with previous approach:**
- `file_search` was an ambient tool injected on every reply agent call regardless of node. The LLM decided whether to use it, but there was no explicit KB intent, no dedicated prompt bundle, no tracking of KB mode vs planning mode, and no clean return path.
- The scraper produced one monolithic markdown file with no per-article metadata.
- The sync schedule was daily (too frequent) and used a plain `OPENAI_API_KEY` env var instead of Secrets Manager.

**New state-machine node: `consultar_faq`**
- Added `consultar_faq` to `decisionNodes`, `planIntentValues`, and extraction schema.
- Added `kbQuery: string | null` to extraction schema and `ExtractionResult` contract.
- Added KB intent branch in `AgentService.handleTurn()`:
  - Sets `current_node = 'consultar_faq'`
  - Persists the plan with `current_node` updated but NO changes to planning fields (`event_type`, `vendor_category`, `provider_needs`, etc.)
  - Loads the `consultar_faq` prompt bundle
  - Returns immediately (skips search/selection flow)
- Added resume logic in `resolveResumeNode()`: if returning from `consultar_faq`, resume to `entrevista` (if plan has prior context) or `deteccion_intencion` (if fresh).
- Added `resolveExtractionNode()` mapping: `extraction.intent === 'consultar_faq'` → `'consultar_faq'`.
- Created prompt bundle `prompts/nodes/consultar_faq/`:
  - `system.txt` — Node objective, constraints, exit behavior
  - `response_contract.txt` — Tone, citation rules, re-ask support, transition to planning
  - `tool_policy.txt` — Only `file_search` (no provider tools)
  - `transition_policy.txt` — Rules for staying in KB vs switching to planning
- Added `consultar_faq` to `nodePromptManifest` with empty `allowedTools` (file_search is a hosted tool injected by runtime, not a function tool).

**Scraper redesign: per-article markdown with YAML frontmatter**
- Rewrote `src/knowledge-sync/formatter.ts` to produce one file per article instead of a monolithic file.
- Each article now has YAML frontmatter with:
  - `title`, `slug`, `category` (scraped)
  - `article_type` (heuristic mapper: `pricing`, `faq`, `tutorial`, `announcement`, `policy`, `event_guide`, `about`)
  - `tags` (auto-extracted from content keywords, max 8)
  - `source_url` (link back to Tawk)
  - `last_updated` (scraped timestamp)
  - `related_topics` (broader topic buckets, max 5)
- Added `ArticleMetadata`, `FormattedArticle` types to `src/knowledge-sync/types.ts`.

**Uploader redesign: batch rotation with cleanup**
- Rewrote `OpenAiKnowledgeUploader` to support batch uploads:
  - `uploadBatch()` uploads each article file individually, then creates a vector store file batch with `batch_id` and `source` attributes.
  - `cleanupOldBatches()` lists all files in the vector store and deletes those whose `batch_id` does not match the current run.
  - Polls batch status until `completed` (max 5 min wait).
- This replaces the old single-file upload that would have accumulated stale content over time.

**Sync handler improvements**
- Updated `src/knowledge-sync/handler.ts` to support Secrets Manager (`OPENAI_SECRET_ID`) as the primary auth path, with `OPENAI_API_KEY` as fallback.
- Added manual trigger support via `?force=true` query parameter or `{ "force": true }` body payload.
- Updated `src/knowledge-sync/sync.ts` to orchestrate per-article formatting and batch upload.

**CloudFormation updates**
- `infra/knowledge-sync.yml`:
  - Changed schedule from `rate(1 day)` to `rate(7 days)` (weekly).
  - Replaced plain `OpenAiApiKey` parameter with `OpenAiSecretArn` (Secrets Manager).
  - Added IAM policy `secretsmanager:GetSecretValue`.
- `infra/cloudformation/stack.yaml` (main runtime):
  - Already had `KbEnabled` and `KbVectorStoreId` parameters from previous commit.
  - Verified they are wired into `RuntimeFunction` environment variables.

**Documentation**
- Created `docs/knowledge-base-integration.md` covering architecture, file rotation, metadata schema, state machine integration, scheduling, deployment guide, cost considerations, and troubleshooting.
- Added TODO section for future `script_id` integration when response scripts are confirmed.

**Verified:**
- Scraper produces 52 individual `.md` files with YAML frontmatter.
- Build succeeds (`dist/knowledge-sync/index.js` generated).
- Typecheck and tests pass.

Reason:
- An ambient `file_search` tool created ambiguity: the LLM could invoke it during provider recommendation or extraction phases, leading to inconsistent behavior and no clear tracking of whether the user was in "FAQ mode" or "planning mode".

Decision:
- Make the knowledge base a first-class decision node with its own prompt bundle, explicit intent (`consultar_faq`), and clean entry/exit semantics. This aligns with the existing node-aligned architecture and makes KB interactions observable in traces and perf records.
- Use per-article files with metadata to enable future filtering, script matching, and granular debugging.

Files changed:
- `src/core/decision-nodes.ts`
- `src/core/decision-flow.ts`
- `src/core/plan.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/contracts.ts`
- `src/runtime/prompt-manifest.ts`
- `src/knowledge-sync/types.ts`
- `src/knowledge-sync/formatter.ts`
- `src/knowledge-sync/openai-uploader.ts`
- `src/knowledge-sync/sync.ts`
- `src/knowledge-sync/handler.ts`
- `scripts/sync-knowledge-base.ts`
- `infra/knowledge-sync.yml`
- `prompts/nodes/consultar_faq/system.txt`
- `prompts/nodes/consultar_faq/response_contract.txt`
- `prompts/nodes/consultar_faq/tool_policy.txt`
- `prompts/nodes/consultar_faq/transition_policy.txt`
- `docs/knowledge-base-integration.md`
- `docs/implementation-log.md`

### Deploy knowledge-base infrastructure to AWS
- Built and uploaded `dist/knowledge-sync/knowledge-sync.zip` to S3 (`recap-agent-artifacts-684516060775-us-east-1/knowledge-sync/dev/latest.zip`).
- Deployed `infra/knowledge-sync.yml` as stack `recap-agent-knowledge-sync-dev` with:
  - `OpenAiSecretArn`: `arn:aws:secretsmanager:us-east-1:684516060775:secret:recap-agent/openai-api-key-mtKG04`
  - Weekly EventBridge schedule (`rate(7 days)`)
- Initial Lambda invocation failed with HTTP 403 from `sinenvolturas.tawk.help` — Tawk blocks AWS Lambda IP ranges.
- Added browser-like `User-Agent` header to scraper (`Mozilla/5.0...`), but Tawk still blocked Lambda IPs.
- **Workaround:** Ran initial sync locally from macOS (which Tawk allows):
  - Scraped 52 articles
  - Created new vector store: `vs_69f0ed048b7c8191b037d68ed6e25956`
  - Uploaded 52 files as batch `local-20260428`
  - Batch completed successfully after ~20 polling cycles
- Updated knowledge-sync stack with `KbVectorStoreId=vs_69f0ed048b7c8191b037d68ed6e25956`.
- Rebuilt main runtime artifact with all KB code changes and uploaded to S3.
- Deployed main runtime stack `recap-agent-runtime` with:
  - `KbEnabled=true`
  - `KbVectorStoreId=vs_69f0ed048b7c8191b037d68ed6e25956`
- Added `KB_VECTOR_STORE_ID=vs_69f0ed048b7c8191b037d68ed6e25956` to local `.env`.

Reason:
- The infrastructure needed to be deployed so the agent runtime can actually use the vector store. Without deployment, the `file_search` tool would not be wired to any vector store.

Decision:
- Accept that Tawk blocks AWS Lambda IPs for scraping. The scheduled Lambda will need to run from a non-AWS IP (e.g., local machine, GitHub Actions, or an EC2 with a NAT gateway) until Tawk whitelists the IP or provides an API.
- The Lambda is still valuable for scheduled triggers and manual invocation if the scraping step is skipped (e.g., if content is pushed to S3 first).
- Document this limitation in `docs/knowledge-base-integration.md` as a known issue.

Files changed:
- `src/knowledge-sync/scraper.ts` (added User-Agent header)
- `docs/implementation-log.md`

### Set up GitHub OIDC for secretless AWS authentication
**Problem:** The GitHub Actions workflow required `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in GitHub Secrets, which need periodic rotation and are a security risk if leaked.

**Solution:** Use AWS OIDC (OpenID Connect) so GitHub Actions can assume an IAM role directly via short-lived tokens — no long-lived credentials needed.

**What was done:**
1. Created OIDC identity provider `arn:aws:iam::684516060775:oidc-provider/token.actions.githubusercontent.com`.
2. Created IAM role `recap-agent-github-actions` with a trust policy that only allows the `pdellepiane/recap-agent` repository to assume it.
3. Attached least-privilege permissions:
   - `s3:PutObject` on `knowledge-sync/dev/*` (upload scraped articles)
   - `lambda:InvokeFunction` on `recap-agent-knowledge-sync-dev` (trigger sync)
   - `secretsmanager:GetSecretValue` on `recap-agent/openai-api-key-*` (optional, if workflow ever needs the key)
4. Updated `.github/workflows/knowledge-sync.yml`:
   - Added `permissions: id-token: write, contents: read`
   - Replaced static AWS credentials with `aws-actions/configure-aws-credentials@v4` using `role-to-assume`
   - Added `--cli-binary-format raw-in-base64-out` to the Lambda invoke command
5. Updated `docs/knowledge-base-integration.md` with OIDC setup instructions.

**Result:** Zero secrets in GitHub. The workflow authenticates to AWS via OIDC, uploads articles to S3, and invokes the Lambda. The Lambda reads the OpenAI key from Secrets Manager. No manual rotation needed for any credential.

Files changed:
- `.github/workflows/knowledge-sync.yml`
- `docs/knowledge-base-integration.md`
- `docs/implementation-log.md`

### Clean up: remove GitHub Actions automation after Tawk IP blocking confirmed
**Problem:** Both AWS Lambda and GitHub Actions IPs are blocked by Tawk/Cloudflare (HTTP 403). The automated scraping pipeline via GitHub Actions + S3 + Lambda does not work.

**What was cleaned up:**
1. Removed `.github/workflows/test-tawk.yml` (test workflow).
2. Removed `.github/workflows/knowledge-sync.yml` (automated sync workflow).
3. Deleted `.github/workflows/` directory entirely.
4. Updated `docs/knowledge-base-integration.md`:
   - Removed GitHub Actions / OIDC sections
   - Removed serverless architecture diagram with GitHub Actions
   - Updated deployment instructions to manual local scrape + S3 upload + Lambda trigger
   - Updated troubleshooting to reflect that both Lambda and GitHub Actions are blocked
5. Kept the deployed infrastructure intact:
   - `recap-agent-knowledge-sync-dev` Lambda (works for OpenAI upload from S3)
   - `recap-agent-runtime` stack (works with KB enabled)
   - Vector store `vs_69f0ed048b7c8191b037d68ed6e25956` (52 articles)

**Current workflow:**
1. Scrape locally: `KB_SKIP_UPLOAD=true npx tsx scripts/sync-knowledge-base.ts`
2. Upload to S3: `aws s3 cp knowledge-base-articles.zip s3://.../articles-latest.zip`
3. Trigger Lambda: `aws lambda invoke --function-name recap-agent-knowledge-sync-dev ...`

**Note:** A weekly EventBridge schedule still triggers the Lambda, which will re-sync from S3 if articles are present. Without manual step 1-2, the scheduled run will fail gracefully (no articles in S3).

Files changed:
- `.github/workflows/test-tawk.yml` (deleted)
- `.github/workflows/knowledge-sync.yml` (deleted)
- `docs/knowledge-base-integration.md`
- `docs/implementation-log.md`

### Fix KB intent detection and first-turn "plan or question" prompt
**Problem:** Agent did not detect `consultar_faq` intent and did not offer "plan or question" on first turn. KB vector store was deployed correctly (`KbEnabled=true`, `KbVectorStoreId=vs_...`), but prompts lacked KB awareness.

**Root causes:**
1. `prompts/extractors/field_definitions.txt` did not list `consultar_faq` as a valid `intent`.
2. `prompts/nodes/deteccion_intencion/system.txt` and `transition_policy.txt` did not mention FAQ / KB questions.
3. `prompts/nodes/contacto_inicial/system.txt` and `response_contract.txt` only offered event planning, not KB questions.
4. `prompts/nodes/entrevista/system.txt` and `response_contract.txt` did not offer "plan or question" when no plan context exists yet.

**Fixes:**
1. Added `consultar_faq` intent definition to `field_definitions.txt`.
2. Updated `deteccion_intencion` prompts to recognize FAQ questions and transition to `consultar_faq`.
3. Updated `contacto_inicial` prompts to offer both event planning and KB questions.
4. Updated `entrevista` prompts to ask "plan or question" when no plan data exists yet.

**Deployment:** Rebuilt and redeployed `recap-agent-runtime` stack via `node scripts/deploy.mjs`. KB parameters preserved (not overridden).

Files changed:
- `prompts/extractors/field_definitions.txt`
- `prompts/nodes/deteccion_intencion/system.txt`
- `prompts/nodes/deteccion_intencion/transition_policy.txt`
- `prompts/nodes/contacto_inicial/system.txt`
- `prompts/nodes/contacto_inicial/response_contract.txt`
- `prompts/nodes/entrevista/system.txt`
- `prompts/nodes/entrevista/response_contract.txt`
- `docs/implementation-log.md`

### Add TPM rate-limit retry mitigation

- Increased `OpenAI` client `maxRetries` from 2 (default) to 3, giving the low-level SDK more room to absorb transient 429 bursts.
- Added `ModelRetrySettings` to `buildModelSettings()` with `maxRetries: 3`, `backoff` (`initialDelayMs: 1000`, `maxDelayMs: 30_000`, `multiplier: 2`, `jitter: true`), and `policy: retryPolicies.any(retryPolicies.httpStatus([429]), retryPolicies.networkError())`.
- This configures the agents SDK runner to retry 429 rate-limit errors and network errors up to 3 times with exponential backoff capped at 30 seconds, enough to cover the typical 20-second TPM windows reported by the OpenAI API.

Reason:
- A 429 error (`TPM Limit 200000, Used 164777, Requested 103461`) showed the agent hitting the gpt-5.4-mini tokens-per-minute ceiling mid-turn. The agents SDK's default retry policy was `maxRetries: 0` (no runner-level retries), and the raw OpenAI SDK capped backoff at 8 seconds—too short for a 20-second cooldown.

Decision:
- No behavior change: the agent still produces the same outputs. The only difference is that transient 429 responses now get retried with appropriate backoff instead of immediately failing the turn.

Files changed:
- `src/runtime/openai-agent-runtime.ts`
- `docs/implementation-log.md`

### Reduce token volume sent to extraction and reply models

- `buildExtractorPlanSnapshot`: stripped provider details from the extraction prompt. Previously sent up to 8 providers with rank, id, title, slug, category, location, price_level, services (up to 4), promo, and description (140 chars). Now sends only rank, id, and title for up to 4 providers.
  - Rationale: the extractor's job is to classify intent and extract plan fields. Knowing provider titles and IDs is enough to detect references like "el primero" or "me gusta el X"; descriptions and services do not improve extraction accuracy.
- `summarizeRecommendedProviders`: removed `detailUrl` from every provider line and reduced `serviceHighlights` from 2 to 1.
  - Rationale: `detailUrl` is never spoken to the user and URLs tokenize very inefficiently (~15–30 tokens each). One service highlight is sufficient to differentiate providers in the model context; two adds marginal value at non-trivial token cost.

Reason:
- The 429 TPM error indicated the agent was close to the 200k token-per-minute ceiling. Reducing prompt size lowers the per-request token footprint, decreasing the probability of hitting the limit and also reducing latency/cost.

Decision:
- These are safe cuts because none of the removed fields influence the model's behavioral contract: extraction still sees which providers exist, and reply still sees location, price, promo, description, and one service highlight for each provider.

Files changed:
- `src/runtime/openai-agent-runtime.ts`
- `src/core/plan.ts`
- `docs/implementation-log.md`

## 2026-04-30

### Add structured channel-specific reply rendering

- Added structured reply contracts so model output is parsed into typed presentation data before it reaches channel adapters.
- Added deterministic WhatsApp and webchat renderers, with webchat using plain text bullets and direct URLs instead of Markdown or HTML assumptions.
- Required inbound Lambda requests to include `channel`, and registered renderers for `whatsapp`, `webchat`, and `terminal_whatsapp`.
- Updated offline evals and agent service tests to pass explicit renderer maps.
- Added message renderer tests and a repo `npm run deploy` command that runs checks before deployment.

Reason:
- Batch 1 feedback identified presentation drift: Markdown leakage, inconsistent bullets, and channel-specific formatting decisions being left to the model. The runtime needed a typed, deterministic rendering layer to keep business logic channel-agnostic while producing stable outbound text.

Decision:
- Keep Lambda responses as a plain `message` string for client compatibility, but make the generated content structured internally. Use plain-text webchat output until the frontend explicitly supports Markdown or HTML.

Flow nodes affected:
- All conversational nodes indirectly, because every reply can now be rendered from structured output.
- `contacto_inicial`
- `recomendar`
- `crear_lead_cerrar`

Files changed:
- `src/runtime/structured-message.ts`
- `src/runtime/message-renderer.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/agent-service.ts`
- `src/lambda/handler.ts`
- `src/evals/targets/offline.ts`
- `tests/agent-service.test.ts`
- `tests/message-renderer.test.ts`
- `prompts/shared/output_style.txt`
- `prompts/shared/common_anti_patterns.txt`
- `prompts/nodes/contacto_inicial/response_contract.txt`
- `prompts/nodes/recomendar/response_contract.txt`
- `prompts/nodes/crear_lead_cerrar/response_contract.txt`
- `package.json`
- `docs/implementation-log.md`

### Restore Batch 2 no-cooling lifecycle behavior

- Removed the finished-plan TTL contract from plan storage, runtime reply requests, and finish-plan tool output.
- Updated finished-plan tests so new planning intents reset the plan immediately instead of showing a 24-hour cooling message.
- Kept telemetry TTL untouched; only the voluntary finished-plan cooldown mechanism was removed.

Reason:
- Batch 2 requires closed plans to stop mentioning cooling periods and to allow a fresh plan when the user asks for a new planning flow.

Decision:
- Treat finished plans as retained context unless the next user intent is planning-related; do not persist a DynamoDB TTL for finished plans.

Files changed:
- `src/core/plan.ts`
- `src/storage/plan-store.ts`
- `src/runtime/contracts.ts`
- `src/runtime/finish-plan-tool.ts`
- `src/runtime/agent-service.ts`
- `tests/agent-service.test.ts`
- `tests/plan-lifecycle.test.ts`
- `prompts/nodes/crear_lead_cerrar/response_contract.txt`
- `prompts/nodes/necesidad_cubierta/response_contract.txt`
- `docs/implementation-log.md`

### Restore Batch 3 contact validation consistency

- Verified that the runtime Batch 3 contact plumbing is present: `NormalizedInboundMessage.contactPhone`, Lambda `contact_phone` wiring, `contact_validation_error` trace fields, runtime contact normalization/validation, and finish-plan phone splitting.
- Restored dedicated Batch 3 regression tests in `tests/agent-service.test.ts` for invalid phone rejection, invalid email rejection, standalone phone correction, webhook phone seeding, Peruvian finish-plan splitting, and Mexican finish-plan splitting.
- Kept the phone storage convention aligned with WhatsApp-style payloads: `contact_phone` stores the full international number as digits-only (E.164 without `+`), and finish-plan splits country code at the gateway boundary.
- Confirmed `tests/perf-trace.test.ts` fixtures include `contact_validation_error` for both extraction and plan summaries.
- Fixed restored Batch 5 provider-fit utilities enough to keep `npm run check` green: Spanish `mil soles` budget parsing, accented photography category normalization, plural dessert category normalization, and birthday-vs-wedding ranking penalty behavior.

Reason:
- A restore left Batch 3 runtime code mostly present but dropped its regression coverage, which made contact validation vulnerable to silent regression. The same check run exposed restored Batch 5 tests that no longer matched the implementation.

Decision:
- Treat Batch 3 as consistent only when both runtime behavior and regression coverage are present.
- Keep phone handling country-agnostic and WhatsApp-compatible rather than Peruvian-local-only.
- Preserve the repository rule that every code/test/doc change must finish with `npm run check` passing.

Files changed:
- `tests/agent-service.test.ts`
- `src/runtime/provider-fit.ts`
- `docs/implementation-log.md`

### Implement Batch 5 structured provider-fit reranking

- Added `providerFitCriteria` to the extractor output contract so the LLM turns the user request into structured ranking criteria before provider reranking.
- Replaced provider intent keyword classification with deterministic scoring driven by those extracted criteria plus provider detail fields: event types, category, descriptions, service highlights, terms, promos, and price level.
- Wired `AgentService` to enrich provider search results, require extractor criteria, rerank the enriched list, and persist/send the reranked shortlist to the final reply LLM.
- Added provider-fit regression coverage for the low-budget birthday catering case where La Botanería should outrank wedding-only or high-price options.

Reason:
- Batch 5 feedback showed search results could contain providers that technically matched a category but were poor fits for the user's actual event and budget. The extractor must define the user's ranking intent once, then the runtime should apply it consistently before asking the reply model to present final options.

Decision:
- Do not run a second LLM over providers and do not silently fallback when criteria are missing. The extractor owns structured intent/criteria extraction; the runtime owns deterministic provider reranking; the reply LLM only chooses how to present from the already reranked shortlist.

Files changed:
- `src/runtime/provider-fit.ts`
- `src/runtime/contracts.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/agent-service.ts`
- `src/core/plan.ts`
- `src/evals/targets/offline.ts`
- `tests/provider-fit.test.ts`
- `tests/agent-service.test.ts`

### Add structured multi-need elicitation and plan editing

- Added the `elicitacion_necesidades` node and prompt bundle so event-level planning can create multiple provider needs at once.
- Added Zod-backed structured extraction schemas for provider query intents, plan operations, provider references, recommendation explanations, and provider detail requests.
- Added a multi-need provider retrieval path that executes structured query intents per need, enriches provider details, ranks each need independently, and persists independent shortlists.
- Added global structured provider-plan operations for adding, updating, deleting, deferring, reactivating, selecting, unselecting, and replacing providers or needs.
- Extended trace/terminal diagnostics and eval fixtures to expose structured extraction counts and multi-need query-intent search.
- Clarified extractor retrieval readiness so category + city/location + guest range or budget is enough for first-pass provider retrieval; exact date or district can remain as later refinement context.
- Added event-type-specific provider priority menus and a runtime elicitation gate: broad event descriptions now produce a compact starter menu without provider search, while detailed concepts can still run multi-need retrieval.

Reason:
- Event planning should be event-plan-first: a rich event description should produce several provider needs and shortlists in one pass, not force the user through one category at a time.

Decision:
- Use clean Zod schemas and structured extraction fields only for the new behavior. Do not add keyword-based routing or compatibility aliases for the new extraction shape.
- Treat event-type priorities as a runtime guardrail so model output cannot fan out into every marketplace category.

Files changed:
- `src/core/decision-nodes.ts`
- `src/core/event-provider-priorities.ts`
- `src/core/plan.ts`
- `src/core/trace.ts`
- `src/runtime/extraction-schemas.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/provider-gateway.ts`
- `src/runtime/provider-vector-search.ts`
- `src/runtime/sinenvolturas-gateway.ts`
- `src/runtime/prompt-manifest.ts`
- `src/evals/case-schema.ts`
- `src/evals/targets/offline.ts`
- `src/terminal/client.ts`
- `prompts/extractors/field_definitions.txt`
- `prompts/extractors/normalization_rules.txt`
- `prompts/nodes/elicitacion_necesidades/*`
- `tests/extraction-schemas.test.ts`
- `tests/agent-service.test.ts`
- `evals/cases/multi-need-elicitation-shortlists.yaml`
- `evals/suites/dev_regression.yaml`
- `docs/implementation-log.md`

### Make FAQ retrieval observable and required

- Restricted the hosted OpenAI `file_search` tool to the `consultar_faq` node instead of injecting it into every reply node.
- Made FAQ replies require a tool call when the KB vector store is configured, and enabled included search results for trace diagnostics.
- Added hosted-tool trace extraction so live evals can assert that `file_search` was actually called, not merely available.
- Scoped hosted-tool trace extraction to current-turn SDK items so prior FAQ session history does not appear as a tool call after returning to planning.
- Implemented the existing `provider_result_count` eval expectation so FAQ cases can assert that provider search stayed out of KB turns.
- Strengthened the FAQ tool policy so the first FAQ action is always a faithful KB search rather than an answer from model memory.
- Added live Lambda eval cases for direct FAQ commission questions and a multi-turn FAQ re-ask followed by provider planning.
- Replaced reply output schemas with node-specific required fields after live validation exposed unsupported optional fields in the shared structured schema.
- Locally scraped the current Tawk KB with `KB_SKIP_UPLOAD=true` to confirm stable article content for eval assertions.

Reason:
- FAQ mode could previously appear configured while production replies were not provably consulting the KB. The migration needs evidence that FAQ answers are retrieval-backed and honest when the answer is missing.

Decision:
- Treat `file_search` as a FAQ-only, traceable runtime dependency. Tests now verify both wiring and live behavior through real generation turns.

Files changed:
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/structured-message.ts`
- `prompts/nodes/consultar_faq/tool_policy.txt`
- `tests/openai-agent-runtime-token-usage.test.ts`
- `src/evals/runner.ts`
- `evals/cases/live-faq-commission-uses-kb.yaml`
- `evals/cases/live-faq-reask-then-planning.yaml`
- `evals/suites/live_comprehensive.yaml`
- `docs/implementation-log.md`

### Verify FAQ interruption from all nodes

- Added an `AgentService` regression that seeds every active decision node and sends a FAQ turn, asserting the service routes to `consultar_faq`, persists that node, and does not run provider search.
- Added a live Lambda eval seeded from `recomendar` to verify a mid-recommendation user can ask a FAQ and trigger real `file_search` retrieval.

Reason:
- Runtime routing supported FAQ as a global intent, but "from every node" was only inferred from control flow. The migration needs an explicit safety net.

Decision:
- Cover every active node deterministically in unit tests, then cover the highest-risk mid-flow interruption with real live generation.

Files changed:
- `tests/agent-service.test.ts`
- `evals/cases/live-faq-from-recommendation.yaml`
- `evals/suites/live_comprehensive.yaml`
- `docs/implementation-log.md`

### Add npm deploy script

- Added `npm run deploy` as the canonical package script for `node scripts/deploy.mjs`.

Reason:
- Deployment previously required knowing the underlying script path. The project should support a standard npm deploy command.

Decision:
- Keep deployment behavior unchanged and expose the existing script through `package.json`.

Files changed:
- `package.json`
- `docs/implementation-log.md`

### Add native guardrails for email integrity and jailbreak attempts

- Added an OpenAI Agents SDK output guardrail that trips when generated replies contain corrupted or non-canonical Sin Envolturas support emails, then normalizes the final structured output to `hola@sinenvolturas.com`.
- Added a blocking OpenAI Agents SDK input guardrail for direct jailbreak and prompt-injection attempts such as ignoring system/developer instructions or revealing internal prompts.
- Added regression coverage for support email normalization and jailbreak detection.

Reason:
- Live FAQ output produced `[email protected]` instead of the real support email. Support emails must remain truthful and exact.
- The same guardrail layer should also reject obvious attempts to override system/developer instructions.

Decision:
- Use native Agents SDK guardrails at the generation boundary and keep deterministic normalization as the recovery path so users receive a correct answer instead of a server error.

Files changed:
- `src/runtime/openai-agent-runtime.ts`
- `tests/openai-agent-runtime-token-usage.test.ts`
- `docs/implementation-log.md`

### Apply event-type provider priorities to normal plan projection

- Reused the normalized event-type provider priority map when structured extractor categories are projected into `provider_needs` in the normal flow.
- Filtered inferred provider categories against the normalized event type while preserving explicitly requested active/vendor categories.
- Collapsed broad multi-need normal projections to the event-specific starter set so irrelevant categories such as wedding planners do not appear for birthdays.
- Added a regression proving a birthday plan with an overbroad extractor output keeps the birthday starter needs and excludes `Wedding planners`.

Reason:
- Event-specific provider prioritization must be a plan-level invariant, not only an elicitation-node behavior. Normal provider search turns can also populate multiple needs before the elicitation node runs.

Decision:
- Keep structured extraction as the only signal source, then normalize category projection through the shared event priority map in `AgentService`.

Files changed:
- `src/runtime/agent-service.ts`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Hard-enforce invisible associated-event auth flow

- Hid `guest_auth` and internal auth metadata from the reply model prompt snapshot.
- Removed `lookup_user_event_context` from the model-callable tool registry and added manifest coverage to keep it unavailable.
- Masked the historical `consultar_evento_invitado` node name as `consultar_evento_asociado` in prompt headings and reply context so model-facing wording covers hosts, owners, guests, celebrated users, and buyers.
- Changed model-facing event context from authenticated-event wording to verified associated-event wording.
- Parsed the real login-code response shape at `data.user.credentials.access_token`.
- Persisted successful event auth for exactly 24 hours, ignoring backend `expires_in` for agent-session lifetime.
- Reused valid persisted auth across follow-up sessions, requested a new code after expiry, and cleared failing lookup tokens without immediately requesting another code in the same turn.
- Added prompt isolation, gateway token parsing, 24-hour auth-window, expired-token, and no-model-lookup regression coverage.

Reason:
- The model should not decide or see internal auth state unless deterministic code needs it to ask a user-facing next step. The live API also returns access tokens under `credentials`, which could make correct codes appear invalid.

Decision:
- Keep auth and lookup fully deterministic in `AgentService`; the LLM only receives a user-facing next-step note or sanitized verified event context. Preserve internal node names and state-machine enums to avoid a broad migration, but mask them in model-visible prompt text.

Files changed:
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/prompt-loader.ts`
- `src/runtime/prompt-manifest.ts`
- `src/runtime/sinenvolturas-gateway.ts`
- `prompts/extractors/field_definitions.txt`
- `prompts/extractors/conflict_resolution.txt`
- `prompts/nodes/consultar_evento_invitado/system.txt`
- `prompts/nodes/consultar_evento_invitado/response_contract.txt`
- `prompts/nodes/consultar_evento_invitado/tool_policy.txt`
- `prompts/nodes/consultar_evento_invitado/transition_policy.txt`
- `tests/agent-service.test.ts`
- `tests/sinenvolturas-gateway.test.ts`
- `tests/openai-agent-runtime-token-usage.test.ts`
- `tests/prompt-loader.test.ts`
- `tests/message-renderer.test.ts`
- `docs/implementation-log.md`

### Require verified email on authenticated guest lookup

- Changed authenticated guest event lookup to require both the bearer token and the verified email used during login-code validation.
- Updated `SinEnvolturasGateway.lookupAuthenticatedGuest` to call `/user-lookup?email=<verified-email>` with `Authorization: Bearer <token>`.
- Kept the lookup deterministic in `AgentService`: code validation and lookup happen together, and the model only receives the authenticated event context.
- Mapped the observed `400 {"error":"Invalid or expired code"}` login-code response to `invalid_code` so the flow asks for the code again instead of failing generically.
- Updated service, gateway, state-machine, and offline eval fakes/tests to enforce the token-plus-email lookup contract.

Reason:
- Raw API validation showed that `/api/guest-service/user-lookup` returns `422` when called with only a bearer token; it requires `email` or `phone` even after login-code validation. This caused an invalid agent response after successful code verification.

Decision:
- Use the same verified email for lookup immediately after successful code validation and for persisted-token follow-ups. Do not expose direct lookup as a model tool in `consultar_evento_invitado`.

Files changed:
- `src/runtime/provider-gateway.ts`
- `src/runtime/sinenvolturas-gateway.ts`
- `src/runtime/agent-service.ts`
- `src/evals/targets/offline.ts`
- `tests/sinenvolturas-gateway.test.ts`
- `tests/agent-service.test.ts`
- `tests/batch4-state-machine.test.ts`
- `docs/implementation-log.md`

### Add deterministic auth gate for invited event lookup

- Added persisted `guest_auth` state for `consultar_evento_invitado` with code-requested, authenticated, email-not-found, failed, token, expiry, error, and request timestamp fields.
- Added gateway methods for guest login-code request, login-code verification, and bearer-token authenticated guest event lookup.
- Moved invited event authentication and event lookup out of LLM tool selection and into `AgentService`; the reply model now receives authenticated event context only after deterministic verification succeeds.
- Disabled `lookup_user_event_context` as an allowed tool for `consultar_evento_invitado` and updated Spanish node prompts to phrase auth states without deciding auth.
- Added CloudFormation, deploy-script, and README env support for `SINENVOLTURAS_GUEST_AUTH_BASE_URL`.
- Added gateway and agent-service regression tests for unknown email rejection, code request, invalid code, successful token persistence, token reuse, and token failure re-auth.

Reason:
- Event details are user-specific and should not depend on model discretion. Unknown emails must be rejected before code entry, and the model should never decide whether to trust an email, send a code, validate a code, or call authenticated lookup.

Decision:
- Persist guest bearer tokens in the plan until expiry or authenticated lookup failure, using a 24-hour default expiry if the API response does not provide one. Redact tokens from prompt context and trace inputs/outputs while preserving auth status and deterministic tool traces.

Files changed:
- `src/core/plan.ts`
- `src/runtime/provider-gateway.ts`
- `src/runtime/sinenvolturas-gateway.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/prompt-manifest.ts`
- `src/runtime/config.ts`
- `src/lambda/handler.ts`
- `prompts/nodes/consultar_evento_invitado/system.txt`
- `prompts/nodes/consultar_evento_invitado/tool_policy.txt`
- `prompts/nodes/consultar_evento_invitado/response_contract.txt`
- `infra/cloudformation/stack.yaml`
- `scripts/deploy.mjs`
- `README.md`
- `tests/sinenvolturas-gateway.test.ts`
- `tests/agent-service.test.ts`
- `tests/prompt-loader.test.ts`

### Simplify invited event list fields

- Changed invited-event responses to present event information as a simple list with the user-relevant fields: name, URL, place, date, attendance confirmation, and companion indication.
- Added `url` and `place` to the compact event lookup payload. Public event URLs are built from the root slug route (`https://sinenvolturas.com/{slug}`), and place uses the best available location field with country as fallback.
- Removed generic summary instructions that encouraged low-value fields like visibility, amounts, transactions, and country unless the user asks for them explicitly.
- Added tests for URL/place mapping and prompt bundle coverage for the required fields.

Reason:
- The previous "complete summary" output was technically exhaustive but not useful. For event lookup, users need a concise list of practical event details.

Decision:
- Keep pruning in TypeScript and make the model-facing event summary include only user-useful event fields by default. Preserve detailed fields in the compact payload for explicit follow-up questions, but instruct the response prompt not to show them unless asked.

Files changed:
- `src/runtime/provider-gateway.ts`
- `src/runtime/sinenvolturas-gateway.ts`
- `prompts/nodes/consultar_evento_invitado/system.txt`
- `prompts/nodes/consultar_evento_invitado/tool_policy.txt`
- `prompts/nodes/consultar_evento_invitado/response_contract.txt`
- `tests/agent-service.test.ts`
- `tests/sinenvolturas-gateway.test.ts`
- `tests/prompt-loader.test.ts`
- `docs/implementation-log.md`

### Require complete invited-event summaries

- Updated invited-event prompts so answers about a selected event always include a compact event summary, not only the specific field requested.
- Made the token-pruned tool payload contract explicit in the prompt: the model should use the compact summary and not expect raw endpoint JSON.
- Added prompt-loader coverage to lock the event-summary and pruning instructions into the loaded prompt bundle.

Reason:
- Live testing showed event-specific questions could answer only the date/time. Users asking about an event should receive the key available event information in one useful response.

Decision:
- Keep the existing TypeScript pruning layer as the source of truth for model-facing event data, and enforce response completeness at the node prompt contract level.

Files changed:
- `prompts/nodes/consultar_evento_invitado/system.txt`
- `prompts/nodes/consultar_evento_invitado/tool_policy.txt`
- `prompts/nodes/consultar_evento_invitado/response_contract.txt`
- `tests/prompt-loader.test.ts`
- `docs/implementation-log.md`

### Make discovery welcome capabilities dynamic

- Added typed agent feature flags to runtime config, CloudFormation, and deploy parameter wiring.
- Passed feature flags into the OpenAI reply runtime and generated a capability summary from the enabled features.
- Extended `welcome` structured messages with `capability_lines_es` so renderers can show a richer discovery menu without hardcoded prose.
- Updated onboarding prompts to use the runtime-provided enabled capability list instead of a static two-option sentence.
- Added renderer and runtime tests for capability rendering and feature-gated capability summaries.

Reason:
- The first "how can you help me?" reply was too terse and static. It also needed to stay aligned with feature toggles so future capability changes do not require rewriting onboarding copy in multiple places.

Decision:
- Keep flow intent extraction LLM-based, but make capability discovery deterministic from typed runtime configuration. The state-machine welcome path remains responsible for choosing the `welcome` output schema when there is no planning context, while the reply runtime supplies the currently enabled capability surface.

Files changed:
- `src/runtime/config.ts`
- `src/lambda/handler.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/structured-message.ts`
- `src/runtime/message-renderer.ts`
- `infra/cloudformation/stack.yaml`
- `scripts/deploy.mjs`
- `prompts/shared/base_system.txt`
- `prompts/nodes/contacto_inicial/response_contract.txt`
- `prompts/nodes/entrevista/response_contract.txt`
- `tests/message-renderer.test.ts`
- `tests/openai-agent-runtime-token-usage.test.ts`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Tighten invited event lookup follow-ups and payload shape

- Kept `consultar_evento_invitado` as the resume node so event lookup follow-up questions do not fall back to planning interview mode.
- Added a deterministic guard that keeps short invited-event follow-ups in the invited-event route when the extractor mislabels them as provider detail and there is no provider context.
- Replaced the model-facing guest-service output with a compact typed event summary: user id/name/contact, grouped event summaries, RSVP status, host/celebrated metadata, aggregate event fields, and minimal recent-order summaries.
- Removed raw endpoint data, bank accounts, addresses, documents, subscriptions, and unrelated user profile fields from the tool output.
- Clarified prompts for multi-event disambiguation and follow-up matching by event name/slug.
- Added tests for invited-event resume behavior, misclassified follow-up handling, compact email lookup output, and phone lookup URL mapping.

Reason:
- Live terminal testing showed a follow-up like "dame la info de paolo y mariana" routed to `entrevista` as provider detail. The previous tool also exposed the full endpoint payload to the model, wasting tokens and carrying unnecessary sensitive fields.

Decision:
- Keep this mode stateful at the node level and parse the endpoint response in TypeScript before the agent sees it. Email and phone are both supported by the endpoint contract from the pasted notes: email is exact-match and phone matches `phone_number`.

Files changed:
- `src/core/decision-flow.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/provider-gateway.ts`
- `src/runtime/sinenvolturas-gateway.ts`
- `src/evals/targets/offline.ts`
- `prompts/extractors/conflict_resolution.txt`
- `prompts/nodes/consultar_evento_invitado/system.txt`
- `prompts/nodes/consultar_evento_invitado/tool_policy.txt`
- `prompts/nodes/consultar_evento_invitado/response_contract.txt`
- `prompts/nodes/consultar_evento_invitado/transition_policy.txt`
- `tests/agent-service.test.ts`
- `tests/batch4-state-machine.test.ts`
- `tests/decision-flow.test.ts`
- `tests/sinenvolturas-gateway.test.ts`
- `docs/implementation-log.md`

### Add invited event lookup mode

- Added a `consultar_evento_invitado` intent and decision node for questions about events associated with the asking user.
- Added node prompts that require consulting `lookup_user_event_context` before answering event facts and keep provider search out of this mode.
- Added a typed guest-service lookup gateway method for `/user-lookup` by email or phone, plus a dedicated runtime config and CloudFormation parameter for the guest-service base URL.
- Wired the new tool into the OpenAI Agents runtime and allowed it only on the invited-event node.
- Added regression coverage for state-machine routing from every saved node and guest-service URL mapping.

Reason:
- Users can ask about a real Sin Envolturas event they are invited to, which is neither provider planning nor general FAQ. The agent needs to verify event data through the provided endpoint response shape before answering.

Decision:
- Model this as a separate informational node, similar to FAQ, so it preserves the event plan and resumes planning afterward without running provider search. Keep the runtime channel-agnostic and use email/phone identifiers already known by the plan or provided by the user.

Files changed:
- `src/core/decision-nodes.ts`
- `src/core/decision-flow.ts`
- `src/core/plan.ts`
- `src/core/turn-decision.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/config.ts`
- `src/runtime/contracts.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/provider-gateway.ts`
- `src/runtime/sinenvolturas-gateway.ts`
- `src/runtime/prompt-manifest.ts`
- `src/lambda/handler.ts`
- `infra/cloudformation/stack.yaml`
- `scripts/deploy.mjs`
- `prompts/extractors/field_definitions.txt`
- `prompts/extractors/conflict_resolution.txt`
- `prompts/nodes/consultar_evento_invitado/system.txt`
- `prompts/nodes/consultar_evento_invitado/tool_policy.txt`
- `prompts/nodes/consultar_evento_invitado/response_contract.txt`
- `prompts/nodes/consultar_evento_invitado/transition_policy.txt`
- `tests/agent-service.test.ts`
- `tests/prompt-loader.test.ts`
- `tests/sinenvolturas-gateway.test.ts`
- `docs/implementation-log.md`

### Add deterministic turn decisions and session-scoped focus

- Added Zod-validated `DecisionEvidence`, `TurnDecision`, per-need sufficiency, and session-focus schemas.
- Routed single-vs-multi provider search through a decision object before provider tools or reply composition.
- Added turn-decision, presentation-scope, route-kind, session-focus, and invariant-status fields to traces and persisted perf records.
- Added optional `session_id` to Lambda, terminal, and live-eval request bodies; session focus is stored as a companion item in the plans table when adapters provide it.
- Added a compact deterministic state-decision block to reply composition so prompts no longer need to infer the route from broad transition text.
- Added regression coverage proving a stale Catering active need cannot downgrade a current multi-front wedding request into single-category search.

Reason:
- A live conversation produced five structured provider fronts, but the runtime followed stale active Catering state and presented only Catering recommendations.

Decision:
- The model owns structured interpretation; application code owns routing consequences, provider search mode, presentation scope, persistence, and invariant traceability.

Files changed:
- `src/core/turn-decision.ts`
- `src/core/sufficiency.ts`
- `src/core/messages.ts`
- `src/core/trace.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/contracts.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/lambda/handler.ts`
- `src/logs/trace/perf.ts`
- `src/storage/plan-store.ts`
- `src/storage/in-memory-plan-store.ts`
- `src/storage/dynamo-plan-store.ts`
- `src/terminal/client.ts`
- `src/evals/targets/live-lambda.ts`
- `tests/agent-service.test.ts`
- `tests/perf-trace.test.ts`
- `docs/channel-integration.md`
- `docs/implementation-log.md`

### Flatten provider-need retrieval queries

- Replaced the extractor-facing `queryStrings` plus `subQueries` hierarchy with one `queries` list per provider need.
- Capped each provider need to 3 retrieval queries and detailed elicitation to 5 searched needs per turn; additional detailed needs remain in the plan as identified and unsearched.
- Updated elicitation gating so broad category menus do not trigger provider searches just because many generic category queries were extracted.
- Added regression coverage for capped detailed search and retained extra needs.

Reason:
- The previous query/sub-query hierarchy encouraged over-fragmented retrieval, especially during KB-style or broad elicitation turns.

Decision:
- Keep one model-facing query level and ask the extractor to consolidate first, splitting only when components inside the same provider need are genuinely different.

Files changed:
- `src/runtime/extraction-schemas.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `prompts/extractors/field_definitions.txt`
- `evals/cases/multi-need-elicitation-shortlists.yaml`
- `tests/agent-service.test.ts`
- `tests/extraction-schemas.test.ts`
- `docs/implementation-log.md`

### Persist structured traceability summaries in perf telemetry

- Added first-class trace and perf fields for close actions, provider-selection references, contact validation, provider candidate provenance, and FAQ retrieval usage.
- Replaced contact validation trace inference based on operational note text with structured validation over extracted and persisted contact fields.
- Tightened extraction Zod schemas so FAQ queries, provider sub-queries, and close actions use required defaulted fields accepted by live structured outputs.
- Added an OpenAI structured-output schema compatibility validator and regression test that converts every OpenAI-facing output schema in one pass.
- Updated eval trace parsing and regression tests so live Lambda telemetry can be asserted without relying on exact wording.

Reason:
- Batch feedback validation needed more deterministic telemetry in the perf table to explain why close, FAQ, and provider-selection turns took a particular path.

Decision:
- Store compact Zod-validated summaries alongside the existing trace summaries, keeping exact text matching out of critical telemetry decisions.

Files changed:
- `src/core/trace.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/close-flow-schemas.ts`
- `src/runtime/extraction-schemas.ts`
- `src/runtime/openai-structured-schema.ts`
- `src/logs/trace/perf.ts`
- `src/evals/case-schema.ts`
- `tests/agent-service.test.ts`
- `tests/extraction-schemas.test.ts`
- `tests/openai-structured-schema.test.ts`
- `tests/perf-trace.test.ts`
- `docs/implementation-log.md`

### Stabilize close selections and contact validation

- Resolved close-time provider selections from structured `selectedProviderReferences` before checking unresolved shortlists.
- Removed raw `ninguna` text as a critical close mutation path; deferring a pending need now requires structured `closeAction: { type: "defer_need" }`.
- Kept close/contact clarification turns in `crear_lead_cerrar` when extraction emits `closeAction: { type: "clarify" }`, preventing provider search from extension-code questions.
- Reused the typed phone parser in contact normalization and `finish_plan`, requiring supported country codes and complete national numbers before persisting or sending quote requests.
- Updated close-node and extractor prompts to request phone numbers with country code and to handle extension/country-code clarification without relisting providers.
- Added regression coverage for structured close selections, structured defer actions, raw decline non-mutation, incomplete Peru phone rejection, local phone rejection, finish-plan phone splitting, and extension clarification.

Reason:
- Batch 2 perf logs showed selected providers being lost during close, raw decline text mutating unrelated needs, incomplete phones reaching `finish_plan`, and phone-extension questions triggering provider search.

Decision:
- Keep critical close and contact actions driven by Zod-validated structured extraction and service-owned validation, with exact text only allowed as non-critical extraction input.

Files changed:
- `src/runtime/agent-service.ts`
- `src/runtime/finish-plan-tool.ts`
- `src/runtime/openai-agent-runtime.ts`
- `prompts/extractors/normalization_rules.txt`
- `prompts/nodes/crear_lead_cerrar/response_contract.txt`
- `prompts/nodes/crear_lead_cerrar/transition_policy.txt`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Apply locality ranking to hybrid provider search

- Updated vector-only and hybrid provider search results to pass through the same category/location selector used by API search.
- Changed hybrid search to merge API and vector candidates instead of returning vector candidates alone whenever vector hits exist.
- Applied typed category/location selection to vector query-intent results as well.
- Verified the Lurín trace candidates against the live provider API: ids `164` and `173` are Mexico, while ids `132`, `142`, `131`, `133`, and `95` are Peru.
- Added regression coverage where high-scoring Mexico vector hits are omitted when Peru photography providers are available for a Lurín/Lima/Peru plan.
- Added regression coverage that the same external user can resume with a previously selected provider and proceed to contact without a new provider search.

Reason:
- Batch 2 logs showed a Lurín, Peru photography search returning Mexico providers because hybrid search bypassed the location-aware selector.

Decision:
- Treat vector search as candidate retrieval only; final provider presentation must always pass through deterministic category/location selection.

Files changed:
- `src/runtime/sinenvolturas-gateway.ts`
- `tests/sinenvolturas-gateway.test.ts`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Clarify FAQ scope and product-claim support

- Updated shared scope and welcome prompts to state that the assistant helps with Sin Envolturas questions and event-provider planning, but does not design or build external websites.
- Strengthened FAQ prompts so support escalation consistently offers the web chat or `hola@sinenvolturas.com`, without claiming there is no direct number unless the knowledge base says so.
- Inspected the live scraped knowledge base without uploading changes; confirmed relevant facts are present across the `estamos-obligados-a-comprar` and Shop claim articles.
- Updated FAQ policy so gift/product claim questions combine no-obligation gift guidance, configured commission/value framing, direct brand claim handling, and Sin Envolturas help channels.
- Added live eval cases for web-design/support scope and gift/product-claim wording, and included them in the live comprehensive suite.
- Added prompt-loader regression coverage for the new scope and FAQ policy instructions.

Reason:
- Batch 2 feedback showed out-of-scope web-design support copy and gift/product claim answers that were directionally right but unclear and incomplete.

Decision:
- Keep product facts grounded in the knowledge base, but make the FAQ node explicitly combine related KB facts when a user asks a blended support question.

Files changed:
- `prompts/shared/base_system.txt`
- `prompts/shared/domain_scope.txt`
- `prompts/extractors/field_definitions.txt`
- `prompts/nodes/contacto_inicial/response_contract.txt`
- `prompts/nodes/consultar_faq/system.txt`
- `prompts/nodes/consultar_faq/response_contract.txt`
- `prompts/nodes/consultar_faq/tool_policy.txt`
- `evals/cases/live-faq-web-design-support.yaml`
- `evals/cases/live-faq-gift-product-claim.yaml`
- `evals/suites/live_comprehensive.yaml`
- `tests/prompt-loader.test.ts`
- `docs/implementation-log.md`

### Add structured close/contact schema foundations

- Added Zod schemas for close actions and service-owned close flow results, including discriminated unions for close confirmation, need deferral, contact request, abandonment, clarification, and close outcomes.
- Added structured selected provider references and close actions to the extraction schema so later close-flow changes can consume typed extraction instead of exact user-message matching.
- Tightened contact request messages to canonical field IDs and added defensive renderer labels for legacy internal contact field names.
- Added a typed international phone parser that rejects incomplete Peru numbers, requires country codes, and returns structured extension/national-number fields.
- Added schema, renderer, and phone parser regression tests.

Reason:
- Batch 2 feedback exposed close and contact behavior that should be deterministic. Critical plan actions need structured extraction and Zod-validated service objects rather than substring matching.

Decision:
- Establish typed schema foundations first, then use them in the next milestone to refactor close-flow transitions and remove raw text-driven close mutations.

Files changed:
- `src/runtime/close-flow-schemas.ts`
- `src/runtime/phone.ts`
- `src/runtime/extraction-schemas.ts`
- `src/runtime/contracts.ts`
- `src/runtime/structured-message.ts`
- `src/runtime/message-renderer.ts`
- `tests/extraction-schemas.test.ts`
- `tests/message-renderer.test.ts`
- `tests/phone.test.ts`
- `docs/implementation-log.md`

### Add per-sub-query provider retrieval and provenance

- Added Zod-backed provider sub-query, sub-query candidate, and sub-query result models.
- Extended provider needs with optional `sub_query_results` so plans can retain which query found each selected provider.
- Updated multi-need retrieval to search each sub-query independently, rerank per component, and store selected providers per sub-query instead of merging every need into one broad shortlist.
- Added reusable selection helpers for sub-query fit criteria, category filtering, must-have evidence boosting, and no-match reporting.
- Updated multi-need structured messages and renderers to allow multiple providers per need with `match_label_es`.
- Updated extractor and elicitation prompt contracts to ask for sub-queries on complex needs such as sushi plus wedding cake.
- Compact terminal plan output now includes sub-query selected IDs and candidate IDs for debugging.

Reason:
- Provider vector search was working, but complex needs were collapsed into one shortlist. Exact matches like Edo Sushi Bar for sushi could lose to generic wedding caterers because the ranking and presentation operated at the broad need level.

Decision:
- Treat each service component inside a provider need as its own retrieval and ranking unit, while preserving the provider need as the user-facing grouping.

Files changed:
- `src/core/provider-sub-query.ts`
- `src/core/plan.ts`
- `src/runtime/extraction-schemas.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/provider-sub-query-selection.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/structured-message.ts`
- `src/runtime/message-renderer.ts`
- `src/terminal/client.ts`
- `prompts/extractors/field_definitions.txt`
- `prompts/nodes/elicitacion_necesidades/response_contract.txt`
- `tests/extraction-schemas.test.ts`
- `tests/provider-sub-query-selection.test.ts`
- `tests/message-renderer.test.ts`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Compact multi-need kickstart recommendations

- Limited `multi_need_recommendation` to one provider per need so the first plan kickstart stays scannable.
- Changed the multi-need renderer to use compact provider rows instead of full repeated provider cards.
- Kept limitations visible through `caveat_es`, rendered as `Limitación`, while avoiding repeated location/price/promo labels.
- Reduced reply-model provider context for multi-need elicitation to the top provider per need.
- Tightened prompt language so internal concepts such as "activo" or "frente activo" are not surfaced to users.
- Tightened the multi-need intro guidance so the copy says first selection/top recommendation per need instead of implying multiple options are shown per front.

Reason:
- The multi-need kickstart reply became too long and repetitive when it listed every shortlisted provider for every need.

Decision:
- Store full shortlists in the plan, but present only the top choice per need in the initial multi-need summary. Deeper comparison remains available when the user asks to review a specific front.

Files changed:
- `src/runtime/structured-message.ts`
- `src/runtime/message-renderer.ts`
- `src/runtime/openai-agent-runtime.ts`
- `prompts/nodes/elicitacion_necesidades/response_contract.txt`
- `prompts/shared/output_style.txt`
- `tests/message-renderer.test.ts`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Add structured multi-need recommendation rendering

- Added a `multi_need_recommendation` structured message type with grouped needs, provider references, and next-step guidance.
- Refactored message rendering through a shared base renderer so provider-card formatting is reusable while WhatsApp and WebChat keep channel-specific presentation.
- Updated elicitation reply schema selection so `elicitacion_necesidades` returns grouped structured results whenever the plan has stored provider shortlists.
- Added grouped provider context to reply prompts so the model emits provider IDs and rationale while renderers own names, locations, prices, promos, and ficha links.
- Added assistant identity guidance and tightened prompt style away from weak diagnostic openings such as "veo" and "detecté".
- Extended provider explanation extraction with `scope=all_needs` so users can ask for justification across all stored needs without triggering search.

Reason:
- Multi-need elicitation was searching correctly but summarizing provider choices in prose, which made the UX inconsistent and hard to tune per channel.

Decision:
- Make multi-need provider presentation a structured output and renderer concern, with clean schema changes instead of prose compatibility behavior.

Files changed:
- `src/runtime/structured-message.ts`
- `src/runtime/message-renderer.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/contracts.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/extraction-schemas.ts`
- `prompts/shared/base_system.txt`
- `prompts/shared/output_style.txt`
- `prompts/extractors/field_definitions.txt`
- `prompts/extractors/normalization_rules.txt`
- `prompts/nodes/elicitacion_necesidades/response_contract.txt`
- `prompts/nodes/entrevista/response_contract.txt`
- `prompts/nodes/seguir_refinando_guardar_plan/response_contract.txt`
- `tests/message-renderer.test.ts`
- `tests/extraction-schemas.test.ts`
- `tests/agent-service.test.ts`
- `tests/openai-agent-runtime-token-usage.test.ts`
- `docs/implementation-log.md`

### Distinguish no event from event type otro

- Clarified extractor prompt semantics: `eventType=null` means no event was described, while `eventType=otro` means a real event exists but does not fit the known taxonomy.
- Added extractor examples and normalization guidance so generic onboarding like "hola, como puedes ayudarme" uses `intent=null`, `eventType=null`, and no provider query intents.
- Kept runtime defense-in-depth based on absence of structured planning evidence, not on `otro` itself.
- Added regression coverage proving a generic greeting does not create a starter plan, while a real `otro` event with location and guest range still enters elicitation.

Reason:
- Generic onboarding was being misclassified as `elicitar_necesidades` with `eventType=otro`, creating a fake plan. `otro` should remain a valid event type, not a proxy for no-plan.

Decision:
- Make nullability the source of truth for "no event" and reserve `otro` for real out-of-taxonomy events.

Files changed:
- `prompts/extractors/field_definitions.txt`
- `prompts/extractors/normalization_rules.txt`
- `prompts/extractors/domain_knowledge.txt`
- `prompts/extractors/examples.md`
- `src/runtime/agent-service.ts`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Use query strings as detailed elicitation evidence

- Count natural-language `providerQueryIntents.queryStrings` as structured detail for the detailed elicitation gate.
- Keep the gate bounded to small query-intent sets so broad over-expanded extraction still falls back to a starter menu.
- Added explicit missing-field context to reply prompts, including a deterministic instruction not to mention missing requirements when neither plan-level nor per-need missing fields exist.
- Updated regression coverage so detailed multi-need retrieval still triggers when per-need details live in query strings rather than preferences.

Reason:
- Live detailed prompts produced retrieval-ready query intents with rich query strings, but no top-level preferences, so the runtime downgraded them and skipped provider search. The reply then hallucinated missing requirements despite empty state.

Decision:
- Treat query intent query strings as part of the structured retrieval-readiness signal and make missing-field narration state-bound.

Files changed:
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Add dynamic event-type category guidance to prompts

- Added dynamic event-type category context to extractor and reply model inputs, including the starter suggestions and full priority order for the normalized event type.
- Updated extractor and elicitation node prompts to treat event-type categories as the initial suggestion menu while still allowing off-priority categories when explicitly requested by the user.
- Added a regression proving an off-priority category such as `Wedding planners` remains available for a birthday when it is the explicit requested provider category.

Reason:
- Event-type priorities should control what the agent suggests by default, but should not behave like a hard allowlist that blocks user-insisted categories.

Decision:
- Keep the static prompt files as policy and inject the concrete event-type category menu dynamically through runtime prompt input.

Files changed:
- `src/runtime/openai-agent-runtime.ts`
- `prompts/extractors/field_definitions.txt`
- `prompts/nodes/elicitacion_necesidades/response_contract.txt`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Stop broad elicitation from inventing venue missing fields

- Raised the detailed elicitation gate so a small set of extracted categories alone no longer makes a broad event concept search-ready.
- For broad starter elicitation, discard extractor-proposed per-need missing fields such as date or district and keep only the priority-confirmation marker.
- Tightened extractor and elicitation reply prompts so date, date range, zone, and district are not described as missing requirements when a useful location is already present and those fields are not explicit plan missing fields.
- Added regression coverage where the extractor emits `fecha` and `distrito` for broad starter needs and runtime strips them before composing the reply.

Reason:
- The model told the user that Locales needed a date/date range and district even though the plan only knew country/location context and those fields are not required for provider retrieval.

Decision:
- Treat those fields as optional refinements, not default missing requirements, unless the structured plan state explicitly says otherwise.

Files changed:
- `src/runtime/agent-service.ts`
- `prompts/extractors/field_definitions.txt`
- `prompts/nodes/elicitacion_necesidades/response_contract.txt`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Advance from selected providers to the next stored shortlist

- When structured provider-selection operations succeed and another need already has a stored shortlist, the state machine now advances to `recomendar` for that next need instead of stopping in `seguir_refinando_guardar_plan`.
- Added an `existing_plan_shortlist` search strategy trace value for this no-new-search transition.
- Added provider titles to the prompt plan snapshot so multi-need plans can show the top stored choices per need instead of only IDs.
- Updated elicitation and plan-refinement response contracts to show stored top choices when they already exist.
- Added regression coverage for selecting two venue providers and immediately advancing to the Catering shortlist.

Reason:
- After the user said they wanted to quote both venue options and continue with another provider type, the agent acknowledged the edit but did not surface the next need's already stored choices.

Decision:
- Treat stored shortlists as first-class plan state: continuing to another need should present existing options immediately, without requiring another user turn or another search.

Files changed:
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/core/trace.ts`
- `prompts/nodes/elicitacion_necesidades/response_contract.txt`
- `prompts/nodes/seguir_refinando_guardar_plan/response_contract.txt`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Treat detailed query intents as enough for multi-need retrieval

- Updated the detailed elicitation gate to inspect structured `providerQueryIntents`, not only top-level extraction preferences and constraints.
- A turn with at least two retrieval-ready query intents and at least three distinct per-need preferences or constraints now triggers `multi_need_query_intents`.
- Added regression coverage for a detailed wedding request whose useful details live inside query intents: sushi catering, natural wedding photography, live music, and minimalist flowers.

Reason:
- Detailed event prompts were being downgraded to a starter menu when the extractor placed the specifics inside per-need query intents instead of top-level preferences.

Decision:
- Use the structured per-need intent payload as the source of truth for retrieval readiness.

Files changed:
- `src/runtime/agent-service.ts`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Make turn decisions authoritative for provider routing

- Moved post-extraction provider routing to the typed `TurnDecision` surface for multi-need elicitation, stored-shortlist presentation, missing-field clarification, event-context stops, provider selection stops, and single-need search.
- Removed the legacy `shouldRouteProviderSearchToElicitation` override and stopped hiding final decision/current-node mismatches with a fallback decision in the main turn trace.
- Added structured decision evidence for broad provider-menu requests so broad multi-need openings still produce an elicitation menu without relying on a scattered heuristic.
- Stopped loading node `transition_policy.txt` files into conversational prompt bundles; the reply model now receives the deterministic turn decision context instead of broad static graph policy.
- Replaced stale durable active-need wording in reply context with the turn's operative focus and added session-focus routing so a matching `session_id` can narrow an otherwise ambiguous provider search.
- Added regression coverage for the stale-active-need multi-front request and matching-session focus behavior, including assertions that `turn_decision.nextNode` matches the executed node.

Reason:
- The previous implementation logged a structured decision, but legacy branches could still override or reinterpret the route. That preserved part of the old uncoupled behavior and kept unnecessary transition policy clutter in prompts.

Decision:
- Treat `TurnDecision` as the main routing contract after structured extraction and deterministic plan reduction. Keep model work focused on structured interpretation and reply wording; keep routing consequences in application code.

Files changed:
- `src/core/turn-decision.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/prompt-manifest.ts`
- `tests/agent-service.test.ts`
- `tests/prompt-loader.test.ts`
- `docs/implementation-log.md`

### Add feedback regression and live token eval coverage

- Added a feedback coverage matrix that maps batch1 and batch2 failures to expected fixed behavior, regression IDs, and coverage type.
- Added offline feedback regression cases for close/contact loops, invalid phone handling, standalone phone correction, `ninguna` deferral, unresolved shortlist close blocking, zero-result close behavior, selection confirmation, post-error clarification, support-boundary FAQs, gift/product-claim FAQs, location filtering, and stale-focus multi-need routing.
- Added a dedicated live feedback token suite with seeded/mock multi-turn flows and a fresh multi-front request, all asserting real token usage per turn.
- Extended eval case schemas to support optional per-turn `sessionId`, richer fixture extraction fields, trace-field expectations, and a `token_usage_present` aggregate expectation.
- Passed eval `sessionId` through both offline and live targets so session focus can be tested deterministically.
- Added a live-target unit test proving seeded plans and session IDs are sent to the Lambda adapter and non-null token usage is preserved across multiple turns.

Reason:
- Feedback regressions need durable coverage that catches the old broken behavior, not only broad runtime unit tests. Live token-consuming evals are needed for failures that depend on real extraction/reply behavior over many turns.

Decision:
- Keep fast deterministic feedback coverage offline, and isolate slower token-consuming Lambda checks in `live_feedback_token_regression` so they can be run explicitly with `AWS_PROFILE=se-dev`.

Files changed:
- `docs/feedback-test-coverage.md`
- `docs/evaluation-framework.md`
- `docs/implementation-log.md`
- `evals/cases/feedback-*.yaml`
- `evals/cases/live-feedback-token-*.yaml`
- `evals/suites/feedback_regression.yaml`
- `evals/suites/live_feedback_token_regression.yaml`
- `evals/templates/base-live.yaml`
- `src/evals/case-schema.ts`
- `src/evals/runner.ts`
- `src/evals/targets/live-lambda.ts`
- `src/evals/targets/offline.ts`
- `tests/eval-live-target.test.ts`

### Tolerate incidental close-action metadata from structured extraction

- Relaxed close-action validation so non-`defer_need` close actions do not fail the whole turn if the extractor includes an incidental active category.
- Kept deterministic runtime behavior: only `defer_need` uses `closeAction.category`, and runtime trace already projects non-defer categories as null.
- Added extractor prompt guidance that `category` belongs only to `defer_need` and `reason` belongs only to `clarify`.
- Added schema coverage for accepting a non-defer close action with an incidental category.
- Routed standalone contact-field updates and contact validation errors back through `crear_lead_cerrar` when the previous node is the close flow, preventing invalid phone corrections from falling through into provider search.
- Ignored provider-selection references on close-flow contact-field turns so stale or incidental provider references cannot select a pending provider while the user is only sending contact data.
- Adjusted live token eval contact inputs to use explicit country-code phone format and removed an ambiguous final confirmation that could be interpreted as selecting a still-visible provider.
- Converted structured `delete_need` operations into `deferred` when the extractor emits them alongside provider-selection context for an unresolved shortlisted need, matching the close-flow meaning of "no quiero ninguna" without changing explicit standalone deletion.
- Added extractor guidance that declining all options for a recommended need should be `defer_need`, not `delete_need`.

Reason:
- Live token regression exposed an HTTP 500 where the deployed extractor emitted `closeAction.category` for a non-defer close action. It also showed invalid standalone phone corrections could continue into provider search, and a "no quiero ninguna" turn could delete a shortlisted need instead of deferring it.

Decision:
- Preserve strict requirements for critical fields (`defer_need` still requires a category, `clarify` still requires a reason), while treating extra non-authoritative close-action metadata as harmless.
- Treat contact updates and contact validation failures during `crear_lead_cerrar` as close-flow turns even when the extractor does not classify the message as `cerrar`.
- Preserve explicit standalone `delete_need` behavior, but prefer non-destructive deferral when a delete-shaped operation appears as part of selection/close progression over a shortlisted need.

Files changed:
- `src/runtime/close-flow-schemas.ts`
- `src/runtime/agent-service.ts`
- `prompts/extractors/field_definitions.txt`
- `evals/cases/live-feedback-token-contact-correction.yaml`
- `evals/cases/live-feedback-token-selection-defer-close.yaml`
- `evals/cases/live-feedback-token-multifront.yaml`
- `tests/agent-service.test.ts`
- `tests/extraction-schemas.test.ts`
- `docs/implementation-log.md`

### Add observable shuffled live transcript eval

- Added `eval:observable-live`, a terminal-observable live Lambda conversation runner that uses a fresh user/session and no seeded plan.
- The runner shuffles operation blocks on every run while preserving dependency order within each block.
- It prints only the transcript (`you>` and `agent>` replies) and hides plan/trace output by using the channel-style Lambda response.
- Added operation coverage for add, update, delete, select, unselect, replace, defer, reactivate, refine, detail, explain, compare, FAQ/support, and close/contact flow.
- Added unit coverage for the generated script shape and internal block ordering.

Reason:
- A human-readable end-to-end eval is needed to observe the real conversation behavior in terminal without the large plan and trace tables, while still exercising broad supported operations from scratch.

Decision:
- Keep this separate from deterministic YAML suites because the requested shuffle makes it intentionally non-snapshot-like. Use it as an observational live transcript check, not a hard regression gate.

Files changed:
- `package.json`
- `src/evals/live-observable-cli.ts`
- `src/evals/observable-live-script.ts`
- `tests/observable-live-script.test.ts`
- `docs/evaluation-framework.md`
- `docs/implementation-log.md`

### Make observable live eval plan-aware

- Replaced the static observable live transcript script with a stateful turn planner that reads the latest hidden live plan/trace context after every Lambda turn.
- Kept operation order shuffled across eligible blocks while preserving dependency order inside each block.
- Added prerequisites so provider detail, comparison, selection, replacement, deferral, reactivation, and refinement turns only target needs or shortlists that exist in the current plan.
- Switched the observable CLI to request `client_mode=cli` diagnostics internally while continuing to hide raw trace and plan output from the terminal transcript.
- Added unit coverage for shuffled eligible operation ordering, ordered dependent sub-turns, plan-derived provider/need references, fallback behavior without shortlists, and CLI diagnostic request parsing.

Reason:
- The observable live eval was exercising a broad conversation shape, but static follow-up text could drift away from the plan the agent was actually building. That made turn-by-turn observation less representative of real plan-aware conversation behavior.

Decision:
- Keep the runner observational rather than a deterministic scoring target, but make each generated user turn depend on the latest plan state. Preserve shuffled block order so runs still explore different valid operation sequences.

Files changed:
- `src/evals/live-observable-cli.ts`
- `src/evals/observable-live-script.ts`
- `tests/observable-live-script.test.ts`
- `docs/evaluation-framework.md`
- `docs/implementation-log.md`

### Ignore spurious replace operations on plain selections

- Hardened provider-plan operation application so a simple `select_provider` is not blocked by an extra `replace_provider` emitted for the same category when that category has no existing selected provider.
- Based turn-decision replace detection on applied operations instead of raw extractor operations, preventing a shadowed replace from routing a successful selection as an unresolved plan modification.
- Added agent-service regression coverage for selecting EDO Sushi Bar when extraction includes both a valid select operation and an impossible replace operation.

Reason:
- Three exact observable live runs showed one Dynamo perf trace with an operational note on `Selecciona Edo Sushi Bar para Catering.` The provider was selected correctly, but the extractor also emitted a stale replace operation and the runtime surfaced an unnecessary clarification note.

Decision:
- Treat this as extractor noise only when there is no provider to replace in that category and a concrete select operation for the category exists. Keep real replace behavior unchanged when the category already has a selected provider.

Files changed:
- `src/runtime/agent-service.ts`
- `tests/agent-service.test.ts`
- `docs/implementation-log.md`

### Refine architecture report diagrams and prose

- Rewrote the thesis architecture report into broader academic prose sections with fewer nested headings.
- Shortened the report while preserving the implementation, AWS, OpenAI, Notion, and repository evidence gathered for the original version.
- Replaced the previous dense flow diagrams with cleaner TikZ figures.
- Added a dedicated AWS architecture topology figure that shows the channel boundary, runtime stack, sync stacks, OpenAI Agents/Vector Stores, DynamoDB, Secrets Manager, CloudWatch, EventBridge, S3, and Sin Envolturas APIs.
- Validated the revised PDF with a full LaTeX/BibTeX build, LaTeX log checks, and rendered-page visual inspection.

Reason:
- The first report draft was technically complete but read too much like structured notes, and two TikZ diagrams became visually mangled in the compiled PDF.
- The final report needs a more paper-like narrative and an architecture diagram that can later be redrawn with official AWS logos.

Decision:
- Keep the report source and rendered PDF under the copied Sullivan-template report directory.
- Treat the new AWS figure as an implementation-faithful topology rather than a branded final artwork, so it remains easy to replace nodes with official logos later.
- No Lambda redeploy was required because this was documentation-only.

Files changed:
- `docs/thesis/architecture-report/recap-agent-architecture-report.tex`
- `docs/thesis/architecture-report/recap-agent-architecture-report.pdf`
- `analysis/architecture-implementation-report/how-to-repeat.md`
- `analysis/architecture-implementation-report/dates/2026-06-22.md`
- `docs/implementation-log.md`

### Replace internal report bibliography with public sources

- Removed internal Notion/project-document entries from the report bibliography.
- Added public bibliography entries for the UNAM technical-report writing guide, official AWS service documentation, official OpenAI Agents and Retrieval documentation, and selected academic conversational-agent/RAG sources from the provided AF.csv export.
- Replaced direct internal-document citations in the prose with public citations where they support report form, serverless architecture, agent orchestration, retrieval, and production conversational-agent design.
- Removed the internal "Fuentes utilizadas" appendix table so the rendered bibliography contains only public or academic sources.
- Rebuilt the report and resolved bibliography typography warnings.

Reason:
- The report bibliography should be defensible for thesis review and should not cite private project artifacts such as Notion pages, internal implementation logs, or deployment inspection notes as formal references.

Decision:
- Keep internal evidence as the basis for architectural description, but exclude it from formal bibliography.
- Use official AWS/OpenAI documentation for platform claims and academic papers only for broader conversational-agent context.
- No Lambda redeploy was required because this was documentation-only.

Files changed:
- `docs/thesis/architecture-report/recap-agent-architecture-report.tex`
- `docs/thesis/architecture-report/recap-agent-architecture-report.pdf`
- `docs/thesis/architecture-report/sample.bib`
- `docs/implementation-log.md`

### Apply advisor feedback to architecture report

- Removed the "Proyecto de tesis" presentation line from the cover and metadata.
- Added UTEC and Sin Envolturas logo slots to the cover and page header.
- Cleaned the report `Images/` directory and replaced template assets with stable UTEC and Sin Envolturas placeholder PDFs plus a README that documents how to swap in final logos.
- Rewrote the documentary summary, introduction, architecture, conversational model, provider integration, persistence, observability, contracts, and discussion passages according to advisor feedback.
- Reworked the AWS architecture TikZ figure so AWS, OpenAI, and Sin Envolturas API boundaries are visually grouped, boxes are separated, arrows are clearer, and the color legend is explicit.
- Simplified the runtime cycle figure by removing a return-loop arrow that clipped the first node.
- Rebuilt the PDF, checked LaTeX logs, and visually inspected rendered pages for the cover and diagrams.

Reason:
- Advisor feedback requested clearer institutional branding, more formal academic prose, stronger examples, better explanation of state-machine and hybrid-search concepts, explicit contract traceability, and less crowded figures.

Decision:
- Use stable logo filenames under `docs/thesis/architecture-report/Images/` (`utec-logo.pdf` and `sin-envolturas-logo.pdf`) and draw LaTeX placeholder boxes when the final images are not present.
- Keep the AWS architecture as a TikZ topology that can later be redrawn with official service logos.
- No Lambda redeploy was required because this was documentation-only.

Files changed:
- `docs/thesis/architecture-report/recap-agent-architecture-report.tex`
- `docs/thesis/architecture-report/recap-agent-architecture-report.pdf`
- `docs/thesis/architecture-report/Images/README.md`
- `docs/thesis/architecture-report/Images/utec-logo.pdf`
- `docs/thesis/architecture-report/Images/sin-envolturas-logo.pdf`
- `docs/implementation-log.md`
# 2026-07-01

## Begin evidence-driven recommendation optimization

- Preserved the original 150-conversation evaluation as git snapshot `5317d79`
  on `codex/recommendation-metrics-optimization`.
- Added hierarchical location compatibility that distinguishes Lima districts,
  Lima, Ica, generic country-only locations, and cross-country mismatches.
- Changed provider selection to reject contradictory regions/countries and to
  stop falling back to unrelated marketplace categories when a requested
  category has no valid candidate.
- Added qualitative Spanish budget normalization so signals such as `mínimo`,
  `bajo`, `medio`, and `alto` influence provider-fit scoring.
- Expanded the study with location/category/budget constraint satisfaction,
  provider-need coverage, shortlist size, catalog exposure, and concentration
  metrics.
- Documented the metric portfolio, research basis, and non-regression decision
  rule in `analysis/technical-evaluation-study/metric-expansion.md`.

### Reason

The baseline manual audit showed that provider identity provenance was strong,
but only 35% of the reviewed recommendations were both grounded and
constraint-consistent. Code inspection confirmed that country-only location
matching treated Ica as an exact match for Lima and that category selection
could broaden to unrelated providers.

### Decision

Optimize user-relevant suitability rather than raw strict-completion counts.
Treat contradictory locations and categories as hard exclusions, preserve
unknown-granularity providers only when no verified local candidate exists, and
retain reliability, cost, latency, shortlist availability, and catalog
concentration as guardrails.

## Tighten explicit-need and budget propagation after targeted live gate

- Ran six targeted live scenarios after the initial location/category fix.
- Confirmed that contradictory Ica and Mexico providers were removed from all
  targeted Lima/San Isidro/Miraflores results.
- Changed starter-need projection to preserve only query-intent categories that
  the structured extractor marked retrieval-ready; broad event planning still
  receives the normal compact starter menu.
- Filled a missing structured fit-budget amount from the already persisted plan
  budget before both single-need and sub-query ranking.
- Added regression coverage for explicit single/multi-need preservation and
  broad-plan fallback behavior.

### Reason

The targeted gate showed that a direct single-category request could still be
expanded into default event categories and that a qualitative low budget could
be lost when a model-produced fit object left its numeric budget field null.

### Decision

Use structured retrieval readiness as the evidence that a provider category is
an established current need. Deterministic code may complete a missing numeric
budget tier from persisted structured state, but it must not infer new needs
from message text.

## Reject severe fit conflicts from shortlists

- Added a shared provider-eligibility gate after ranking.
- Low and very-low budget plans now exclude candidates tagged with
  `budget_risk` instead of presenting an expensive provider as the only option.
- Candidates with explicit avoid-constraint evidence or a known need mismatch
  are also excluded.
- Applied the same gate to single-need and structured sub-query retrieval.

### Reason

The second targeted live gate correctly identified a high-price music provider
as a budget risk for a minimum-budget request, but still displayed it. An honest
no-match/refinement outcome is more useful than a shortlist that knowingly
violates a strong constraint.

## Add reproducible technical evaluation study

- Completed the previously declared benchmark metrics by calculating latency,
  tool-use, state, trajectory, persistence, token, cache, and node-coverage
  measurements for every evaluation case.
- Added per-case error isolation and a 95-second live-turn timeout so one Lambda
  failure does not terminate a complete benchmark.
- Added a frozen, balanced 50-scenario Spanish corpus with three repetitions,
  stable event-group and route-family metadata, structured terminal criteria,
  and validation enforcing ten scenarios per event group.
- Added dated OpenAI and Lambda pricing, deterministic provider/FAQ grounding
  checks, Wilson confidence intervals, study-level aggregation, CSV exports,
  SVG charts, a stratified manual grounding-audit sample, and an English
  reproducibility dossier under `analysis/technical-evaluation-study/`.
- Added metric, pricing, manifest, reporting, and runner regression coverage.

### Reason

The thesis report described evaluation and telemetry capabilities but did not
contain an executed, repeatable quantitative protocol. The new study produces
traceable evidence for functionality, architecture, grounding, scenario
behavior, and telemetry without making user-study or baseline-comparison claims.

### Decision

Keep research aggregation outside the channel-agnostic runtime. Grade
conversational behavior from typed plans and traces rather than exact response
strings, preserve raw study runs, and price only services with a documented
public rate.

## Execute the 150-conversation technical study

- Deployed the development runtime and provider-sync stacks through
  CloudFormation, then verified the active Node.js 24 Lambda configuration,
  1 GB memory, 90-second timeout, hybrid search, and configured model aliases.
- Executed all 50 frozen scenarios three times, producing 150 conversation
  artifacts and 265 captured turns from 270 planned turns.
- Generated CSV/JSON results, SVG charts, workflow coverage, dated cost
  estimates, a 20-turn manual grounding audit, and a comprehensive findings
  report.
- Correlated the three HTTP 502 responses with CloudWatch and confirmed that
  each request reached the Lambda's 90-second timeout.
- Corrected study-level transition coverage to use adjacent nodes inside the
  structured trace path. Raw run reports were not modified.

### Result

- The strict frozen protocol completed 43/150 conversations, but a post-run
  audit found non-canonical need labels in several hard expectations; the
  findings report preserves the raw number and explicitly rejects interpreting
  it as a general agent-success rate.
- More stable component results include 95.3% event-type persistence, 97.8%
  required-shortlist production, 98.9% turn persistence, 82.4% weighted prompt
  cache use, and USD 1.19 total priced cost.
- Deterministic provider provenance passed for all grounding-required turns,
  while the manual audit exposed location and category suitability as the
  dominant remaining grounding risk.

## Improve semantic event-service fit

- Preserved hybrid-retrieval relevance as the tie-breaker when providers have
  equal structured fit scores.
- Required home-and-decoration candidates to contain evidence that their
  offering is intended for events before they can enter an event shortlist.
- Required structured sub-query must-have evidence when a provider need
  declares explicit must-have constraints.
- Added a bounded fit boost for verified event-service evidence so a relevant
  event decorator can clear the strong-match threshold while ordinary home
  retail remains excluded.
- Added regression coverage for retrieval tie-breaking and event-decoration
  eligibility.

### Reason

The first optimization iteration eliminated known location and category
conflicts, but manual review still found semantically weak providers within
otherwise correct categories, especially home retailers returned for event
decoration needs.

### Decision

Use provider-catalog evidence only after the structured event-plan sub-query has
selected the category. This validation ranks and filters provider suitability;
it does not inspect user wording or decide conversational flow.

## Execute semantic-fit evaluation iteration

- Deployed the semantic service-fit changes to the development Lambda through
  the repository CloudFormation workflow and verified the active Node.js 24,
  1 GB, 90-second configuration and model aliases.
- Executed the frozen 50-scenario manifest three times, producing 150 immutable
  conversation artifacts.
- Added event-service applicability to the generated recommendation-quality
  summary so event-oriented evidence among home-and-decoration recommendations
  is measured directly rather than inferred from category correctness.

### Result

- Location mismatches remained at zero, category satisfaction was 99.87%, and
  budget compatibility remained 100%.
- Event-service evidence among home-and-decoration provider appearances rose
  from 53.03% in iteration one to 54.69% in iteration two.
- Unique provider exposure rose from 54 to 57, flaky scenarios fell from four
  to three, and priced cost fell from USD 1.081 to USD 1.055.
- Need recommendation coverage fell from 86.15% to 83.00%, p95 conversation
  latency rose from 26.4 to 28.2 seconds, and one conversation timed out.

### Decision

Retain the iteration-two snapshot for its targeted semantic improvement, but
do not claim a general quality increase. Treat the coverage and timeout changes
as explicit regressions and require any later iteration to recover coverage
without weakening location, category, budget, or event-service safeguards.

## Restore evidence-ranked provider coverage

- Kept structured sub-query must-have evidence as a positive fit signal and
  warning source, but removed it as a universal hard eligibility requirement.
- Preserved the hard event-service evidence requirement for
  `Hogar y deco` event sub-queries.

### Reason

Iteration two reduced need recommendation coverage from 86.15% to 83.00%.
The missing-needs breakdown grew primarily in `Locales`, `Música`, and
`Florería y papelería`, where marketplace descriptions do not consistently
repeat every structured must-have phrase. Treating incomplete descriptive
metadata as proof of incompatibility created false no-match outcomes.

### Decision

Use must-have catalog evidence to rank candidates unless the constraint has a
domain-specific, independently verifiable safety rule. Continue to reject
home-and-decoration candidates that lack event-service evidence.

## Execute coverage-recovery evaluation iteration

- Deployed the evidence-ranked coverage change through CloudFormation.
- Ran a four-case live gate spanning two multi-need plans and two event
  decoration recovery paths, with all requested needs shortlisted and both
  decoration paths retaining event-service evidence.
- Executed the frozen 50-scenario manifest three times and preserved all 150
  raw conversation artifacts.

### Result

- Known location mismatches remained at zero; category and budget satisfaction
  were both 100%.
- Event-service evidence among home-and-decoration appearances increased to
  57.35%, unique displayed providers increased to 59, and all scenario outcomes
  were stable across repetitions.
- No conversation timed out. P95 conversation latency was 27.30 seconds and
  total priced cost was USD 1.065.
- The final-plan need-coverage ratio fell to 80.29% because observed extracted
  needs increased to 208 while needs with recommendations remained nearly flat
  at 167. This metric does not separate extraction breadth from retrieval.

### Decision

Use iteration three as the preferred semantic and reliability snapshot, while
preserving iteration one as the best observed need-coverage ratio. Leave the
fourth paid iteration unused until a causal improvement and a stable
expected-need denominator are defined.

## Audit publication readiness

- Added a human-readable inventory of all 50 frozen scenarios and their stable
  iteration-three pass/fail outcomes.
- Consolidated the complete functional, recommendation, architecture,
  workflow, cost, and grounding results in the analysis dossier.
- Backfilled the dossier's dated note, source inventory, and durable findings.
- Recorded that the iteration-three manual grounding sample remains unscored.

### Reason

A publication decision requires the negative and incomplete evidence alongside
the successful constraint and reliability metrics. Aggregate charts alone hide
which route families failed and whether human grounding judgments are complete.

### Decision

Do not present the current study as evidence of general recommender efficacy.
It can support a transparent engineering and evaluation case study. Require a
corrected versioned benchmark, genuine behavior fixes, completed manual audit,
and untouched confirmatory run before making performance claims.

## Enforce global search sufficiency for structured query intents

- Intersected extractor-provided retrieval-ready query intents with the
  deterministic per-need sufficiency result before selecting search routes.
- Added a regression test proving that a structured DJ query with guest count
  but no location routes to `aclarar_pedir_faltante` and performs no provider
  search.

### Reason

All five frozen missing-location scenarios searched immediately even though the
plan correctly recorded `location` as missing. Structured query intents could
bypass the same deterministic sufficiency gate applied to plan-based search.

### Decision

Treat structured LLM query intent as search evidence, not authority to waive
required global plan fields. Category, location, and either budget or guest
range remain mandatory before every provider-search mode.

## Normalize corporate auditoriums in structured extraction

- Added explicit Spanish extractor-domain guidance mapping auditoriums,
  convention centers, venues, and event halls to canonical `Locales`.
- Added explicit corporate-event normalization and a structured auditorium
  extraction example.

### Reason

The corporate no-results scenario repeatedly recognized the airport and guest
constraints but left the provider category unset, despite describing an
auditorium. This caused an unnecessary category clarification instead of an
honest constrained search and refinement outcome.

### Decision

Keep this knowledge in the structured extractor prompt rather than adding
runtime keyword routing. The LLM establishes event type and provider need;
deterministic code only validates the resulting typed plan.

## Version the corrected technical-study benchmark

- Preserved the historical v1 manifest and added
  `technical-evaluation-50-v2`.
- Replaced free-form expected provider categories with canonical typed
  marketplace categories in v2.
- Aligned terminal expectations with declared state-machine semantics for
  multi-need presentation, pause/resume, closure, no-results, refinement, and
  recovery routes.
- Switched future technical-study runs to v2 while keeping artifact
  regeneration compatible with v1.
- Split expected-need quality into extraction recall, retrieval coverage given
  extraction, end-to-end coverage, and unexpected extracted needs.

### Reason

The v1 completion rate mixed runtime failures with noncanonical labels and
overly narrow valid-route expectations. Its final-plan need coverage also mixed
extraction breadth with retrieval success.

### Decision

Never rewrite v1 or reinterpret its raw outcomes. Use v2 only for future
confirmatory evidence, validate its categories at load time, and report the
separate expected-need denominators instead of a single ambiguous rate.

## Complete primary review of iteration-three grounding sample

- Scored all 20 reproducibly sampled iteration-three turns for provider
  existence, attribute faithfulness, rationale support, and hard-constraint
  consistency.
- Marked selection and closure rationales `not_applicable` rather than treating
  action confirmations as recommendation explanations.
- Recorded evidence-specific notes for unsupported capacity, event-type,
  decoration, audiovisual, promotion, and location claims.

### Result

- Provider existence: 20/20.
- Attribute faithfulness: 19/20.
- Recommendation rationale support: 6/10 applicable recommendation turns.
- Hard-constraint consistency: 14/20.

### Decision

Treat these as primary-review results only. Publication-quality manual grounding
evidence still requires an independent second reviewer and disagreement
adjudication; do not manufacture reviewer independence within one agent run.

## Prevent cross-category rows in multi-need rendering

- Added a deterministic renderer invariant requiring each provider card to
  match the canonical category of its multi-need section.
- Added regression coverage proving a catering provider cannot render under
  `Locales`, even if a malformed model response places its ID there.

### Reason

The primary grounding review found a wedding response that repeated every
provider under every need and labeled the wrong-category rows “No corresponde a
esta categoría.” The underlying plan was correctly grouped; the structured
reply violated that grouping.

### Decision

Treat the plan/provider category relation as a rendering invariant. The model
may explain and order valid cards, but it cannot move a provider into a
different typed need section.

## Normalize audiovisual production to the catalog taxonomy

- Added explicit structured-extraction normalization from `audiovisuales` and
  `producción audiovisual` to canonical `Fotografía y video`.

### Reason

The primary audit found the generic Sin Envolturas store selected under
`Otros` as audiovisual support. The marketplace has no standalone audiovisual
category; relevant production providers live under `Fotografía y video`.

### Decision

Resolve the semantic-to-catalog mapping in typed extraction so retrieval uses
the correct catalog category. Do not paper over an incorrect need by allowing
cross-category fallback.

## Define baseline and ablation protocol

- Declared immutable historical and pre-confirmatory baseline snapshots.
- Mapped each recommendation-system component to its disabled/enabled commits
  and direct outcome measures.
- Added explicit targeted gates that must pass before the fourth full run.
- Declared the fourth run untouched after execution to prevent test-set tuning.

### Reason

Iteration comparisons alone are not a defensible baseline when the benchmark
grading changed. A publication-ready comparison needs immutable configurations,
comparable metric definitions, and a precommitted confirmatory boundary.

### Decision

Use historical raw traces only for unchanged metrics or separately labeled
retrospective V2 regrading. Never overwrite historical summaries, and do not
spend the confirmatory run until every targeted gate passes.

## Materialize the pre-confirmatory V2 baseline

- Re-evaluated immutable iteration-three final typed plans against canonical V2
  expected needs without changing historical V1 reports or summaries.
- Recorded expected-need extraction, conditional retrieval, end-to-end
  coverage, unexpected-need, missing-location, auditorium, and cross-category
  baselines in a separate JSON artifact.

### Result

- Expected-need extraction recall: 158/165 (95.76%).
- Retrieval coverage given extraction: 144/158 (91.14%).
- End-to-end expected-need coverage: 144/165 (87.27%).
- Missing-location searches: 15/15; intended clarifications: 0/15.
- Corporate auditorium mapped to `Locales`: 0/3.

### Decision

Use this artifact as the direct pre-intervention comparator for the untouched
V2 confirmation. Keep the original V1 grading as historical evidence rather
than silently replacing it.

## Automate confirmatory live gates

- Added a typed live-gate command covering all five missing-location cases plus
  multi-need, pause/resume, no-results, recovery, selection, closure,
  auditorium, audiovisual-taxonomy, and cross-category rendering checks.
- The command exits nonzero if any semantic invariant or V2 hard gate fails and
  preserves its normal evaluation artifacts.

### Reason

The fourth study must not be spent based on informal spot checks. A repeatable
go/no-go command makes the precommitted criteria executable and auditable.

### Decision

Require `npm run eval:confirmatory-gates` to pass against the deployed
development Lambda before starting the untouched 50×3 confirmation.

## Close focused-need sufficiency bypass

- Required focused and session-focused categories to appear in the
  deterministic `readyByPlan` set before selecting single-need search.
- Added a regression test for the exact live failure shape: a focused catering
  need with guest count and budget but no location and no query-intent array.

### Reason

The first confirmatory gate proved the query-intent fix covered only one branch.
When extraction emitted a focused category without query intents, the runtime
still searched despite `location` remaining in global missing fields.

### Decision

Apply one readiness authority to every search entry path. Focus determines
which ready need to search; it cannot make an insufficient need ready.

## Preserve V2 and freeze corrected V3 benchmark

- Preserved the committed V2 manifest unchanged after its first live gate.
- Added V3 with corrected pause/resume and closure telemetry endpoints.
- Changed recovery cases lacking both guest count and budget to expect
  clarification instead of an invalid search.
- Added explicit corporate context to the corporate-auditorium input; the V2
  description had corporate context that its Spanish conversation omitted.
- Switched future study and confirmatory-gate commands to V3.

### Reason

The first V2 gate exposed benchmark errors as well as runtime errors. Rewriting
an already exercised frozen manifest would erase that evidence.

### Decision

Treat every exercised manifest as immutable. Correct semantics only in a new
version, and reserve V3 as the final precommitted confirmatory manifest.

## Preserve shortlist on resume and structured auditorium evidence

- Added an explicit `retomar_plan` decision that presents persisted shortlists
  without repeating provider retrieval.
- Added structured venue evidence from typed fit criteria or provider query
  intents to the implicit-venue guard.
- Added regression tests for zero-search shortlist resume and explicit
  corporate-auditorium preservation.

### Reason

The V3 gate showed pause/resume re-ran marketplace search instead of presenting
the stored shortlist. It also showed the extractor understood `Locales` in its
reply context, but the legacy implicit-venue guard removed the category because
`auditorio` was absent from its lexical cue list.

### Decision

Resume from persisted typed state and avoid a needless external call. Preserve
venue needs using structured LLM evidence rather than extending keyword-based
flow routing.

## Clarify incomplete refinements without a shortlist

- Routed typed provider-plan updates back to `aclarar_pedir_faltante` when
  required event context remains missing and no shortlist exists.
- Added a regression test for a decoration refinement that preserves location
  but still lacks both budget and guest count.

### Reason

The post-deployment V3 gate showed the refinement operation was applied
correctly, but the generic modification branch bypassed sufficiency and ended
at `seguir_refinando_guardar_plan`.

### Decision

An applied refinement does not make a provider need searchable. When it has no
existing shortlist, the same typed sufficiency evidence used by initial search
must determine whether the next action is clarification.

## Freeze V4 as an auditable overlay

- Added a V4 manifest overlay that inherits all 50 frozen V3 scenarios and
  changes only the pause/resume expectation.
- Updated the study CLI and confirmatory gate to materialize V4.
- Added validation for overlay identifiers and a regression test for the
  materialized terminal transition.

### Reason

The V3 gate proved that resuming a saved shortlist should present those
recommendations at `recomendar`, not discard them by returning to a generic
refinement node. V3 had also marked search and shortlist as absent even though
its first turn intentionally creates both.

### Decision

Keep exercised V3 byte-for-byte intact. Represent the narrowly corrected
contract as a versioned overlay so the provenance and exact semantic delta
remain reviewable.

## Add self-contained independent grounding reviewer

- Added a TypeScript generator that resolves every blinded response reference
  to its immutable case trace.
- Generated a standalone HTML reviewer containing the request, response,
  constraints, provider evidence, and raw tool evidence for all 20 sampled
  cases.
- Added browser-local autosave, completion validation, and one-click export to
  the required independent-review CSV schema.

### Reason

The combined response reference was not directly searchable in raw JSON, which
made independent review unnecessarily dependent on navigating large reports.

### Decision

Keep the primary judgments absent from the reviewer and embed only immutable
evidence. Require all four rubric judgments and reviewer notes before allowing
CSV export.

## Preserve complete provider notes in semantic search

- Added normalized `providerNotes` populated from every localized, titled
  provider-information section.
- Added the notes to provider vector documents and deterministic fit evidence.
- Added tests proving nonstandard sections survive API parsing and appear in
  the indexed Markdown.

### Reason

The independent grounding review exposed unsupported capacity, service, and
event-fit rationales. Service and terms highlights were already indexed, but
other potentially decisive provider sections were silently discarded.

### Decision

Index the complete public provider ficha while retaining service and terms as
first-class structured fields. Absence of a fact remains unknown; the runtime
must not infer capacity or service suitability from provider existence alone.

## Serialize provider-index refreshes

- Limited the provider-sync Lambda to one concurrent execution.
- Made stale vector-file cleanup tolerate an already-deleted file.
- Paginated the complete vector-file inventory and delete stale files with
  two-way bounded concurrency that stays within the vector-file API limit.
- Increased the sync timeout to cover indexing plus full-batch replacement.

### Reason

The deployment-triggered scheduled refresh overlapped a manual refresh. One
execution deleted vector files still being polled by the other, producing a
404 and leaving both refreshes without a trustworthy success result. A
follow-up inventory also found 1,985 files across eleven batches because the
old cleanup inspected only the first API page.

### Decision

Provider index replacement is a singleton operation. Serialize executions at
the Lambda boundary, enumerate every page, and keep cleanup idempotent for
stale-list races.

## Tolerate vector-index read-after-write lag

- Treat a 404 while polling a newly created vector-file association as
  transient until the normal indexing timeout expires.

### Reason

The first refresh into a clean vector store created all provider associations,
but OpenAI temporarily returned 404 for one association during the completion
poll. Failing immediately abandoned an otherwise recoverable batch.

### Decision

Creation followed by retrieval is eventually consistent. Keep the association
pending on 404; still fail on explicit `failed`/`cancelled` status or timeout.

## Render the executed manifest in study findings

- Replaced the hardcoded V1 manifest label in generated findings with the
  manifest identifier from the immutable study summary.

### Reason

The final V4 study summary was correct, but its Markdown reproducibility header
still displayed the historical V1 label.

### Decision

Presentation artifacts must derive version labels from study metadata. Raw run
reports remain unchanged; regenerate only derivative tables, charts, and text.

## Add a context-aware frustration and conversation-progress monitor

- Extended the existing native `gpt-5.4-nano` Structured Output with conversation
  health, a typed reason, and the user's response to an outstanding help offer.
- Persisted consecutive non-progress evidence and help-offer state in the event
  plan.
- Added the `ofrecer_agente_humano` state-machine node and a deterministic Spanish
  offer that runs before extraction, provider search, and reply composition.
- Routed structured acceptance through the verified Agent API takeover workflow;
  declines resume the automated flow without immediately repeating the offer.
- Added trace, perf, terminal-demo, unit, service, prompt, and labelled-eval
  coverage for progress, stalls, explicit frustration, acceptance, and decline.
- Made the terminal client exit cleanly when scripted input reaches EOF after a
  demo turn.

### Reason

The assistant needed a low-cost way to notice circular or unresolved interactions
and proactively offer help before user frustration becomes abandonment.

### Decision

Reuse the existing classifier call instead of adding another model request. Offer
human help after one explicit-frustration assessment or two consecutive
non-progress assessments, but never request takeover until the user accepts.

## Enforce reply suppression and bound human handoff silence

- Changed typed runtime, CloudFormation, deployment, examples, and channel docs
  to default `RESPONSE_CLASSIFIER_MODE` to `enforce`.
- Added a persisted `human_escalation.bot_suppressed_until` timestamp set 12
  hours after direct or frustration-monitor handoff requests.
- Kept inbound Agent API logging active while bypassing classifier, extractor,
  search, and reply work during the handoff window.
- Added legacy fallback from `requested_at`, automatic state clearing and normal
  flow resumption after expiry, and trace evidence for that transition.
- Reworked deterministic and prompt copy so users are clearly told that a team
  member will join the chat, without exposing the internal 12-hour window.

### Reason

Once customer support takes ownership, concurrent bot replies can confuse both
the user and the representative. An indefinite pause, however, can permanently
strand conversations if support ownership is never cleared.

### Decision

Enforce classifier suppression now. Give customer support exclusive chat
ownership for a bounded 12-hour internal window, then resume automatically on
the next inbound turn. Keep that duration operational rather than user-facing.

**Validation:** `npm run check` passed with 37 test files and 237 tests. The
development Lambda was deployed with `RESPONSE_CLASSIFIER_MODE=enforce`. A live
Agent API-backed reaction turn returned `message: null`, suppressed delivery,
and no extractor or reply usage. A separate phone-free handoff persisted an
expiration exactly 12 hours after `requested_at`; its confirmation exposed no
duration, and the following inbound turn remained silent with zero model usage.

## Decouple outbound Agent API logging from classification

- Changed sent-message logging to depend on the configured Agent Conversation
  gateway instead of the optional response classifier.
- Kept suppressed deliveries excluded from outbound logs.
- Added service coverage proving a normal generated reply is logged with its
  canonical phone number even when no classifier is configured.

### Reason

Outbound conversation history is a channel integration responsibility. Tying it
to classifier availability could silently omit assistant replies in runtimes or
tests that configure the Agent API gateway independently.

### Decision

Log every generated `send` delivery through the configured Agent Conversation
gateway before returning it. Preserve best-effort behavior so logging failures
never block the user response.

**Validation:** `npm run check` passed with 37 test files and 238 tests. The
development Lambda was redeployed in enforced mode. A scoped live turn recorded
successful inbound and outbound logging calls in its trace, and the production
Agent API history returned the generated assistant reply as `direction:
"outbound"` alongside the corresponding inbound message.

## Protect channel invocation and hydrate WhatsApp phone context

- Added a dedicated `CHANNEL_API_KEY` service credential, Secrets Manager
  publication, least-privilege Lambda secret access, and CloudFormation wiring.
- Added constant-time `X-API-Key` validation before runtime initialization while
  retaining Function URL `NONE` auth so adapters do not need AWS credentials.
- Updated terminal and live-eval callers to authenticate with the channel key.
- Added a typed Lambda request contract that requires valid international
  `contact_phone` context for production and sandbox WhatsApp channels.
- Hydrated normalized channel phone context into the working plan before the
  classifier and extractor run, and added regression coverage proving the first
  extractor turn sees the persisted phone.
- Reworked `docs/channel-integration.md` with authentication, rotation, complete
  delivery behavior, and explicit Meta WhatsApp field mapping.

### Reason

The raw Function URL needed a service-to-service credential without requiring
channel infrastructure to hold AWS IAM credentials. Separately, treating the
WhatsApp sender only as a user id allowed the first model turn to miss trusted
phone context and potentially ask for it again.

### Decision

Use a separate high-entropy application API key in `X-API-Key`, validated before
any expensive work. Require adapters to pass the WhatsApp sender twice with
different semantics: namespaced `user_id` for plan identity and E.164
`contact_phone` for trusted contact context and downstream requests.

**Validation:** `npm run check` passed with 39 test files and 243 tests. The
deployment generated the local channel key without printing it, published
`recap-agent/channel-api-key`, and updated the development Lambda. Live probes
confirmed missing and incorrect keys return `401`, an authenticated WhatsApp
request without phone context returns a field-specific `400`, and a valid first
turn persisted the normalized phone in the plan before extraction. That same
phone appeared in Agent API history retrieval plus inbound and outbound logging,
and the reply asked only for event details rather than the user's phone.

## Document the production WhatsApp webhook server flow

- Added a Mermaid architecture flow covering Meta verification, raw-body
  signature validation, durable idempotency, queue acknowledgement, runtime
  authentication, delivery suppression, Graph API send, retries, and alerts.
- Split webhook responsibilities into a fast HTTP acceptance path and a slower
  queued turn-worker path.
- Added executable-shape TypeScript showing the mandatory delivery-action branch
  before sending through WhatsApp.

### Reason

Calling the synchronous agent runtime directly inside the Meta webhook response
window risks webhook retries, duplicate plans, and duplicate user replies. The
adapter also needs an explicit rule for suppressed turns and human handoff.

### Decision

Verify and enqueue quickly, then process each unique WhatsApp `wamid` in a
worker. Use the same `wamid` as runtime `message_id` across retries and only call
the Graph API when the runtime explicitly returns a send delivery.
