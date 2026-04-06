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
