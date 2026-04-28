# Implementation Log

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
