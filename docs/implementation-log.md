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
