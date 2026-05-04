# Implementation Plan — Webchat Feedback (Images 1–14)

> Source: `feedback/feedback.md` + `feedback/images/one.jpeg` through `fourteen.jpeg`  
> Scope: runtime orchestration, prompt contracts, provider-gateway data hygiene, perf telemetry  
> Last updated: 2026-04-29

---

## 1. Stylistic / Presentation Issues

### 1.1 Welcome-message punctuation and capitalization (Image 1)
- **Image reference:** `one.jpeg`
- **What the user sees:** Bullets start with lowercase, end with commas, and have no final period.
- **Where it lives:** `prompts/nodes/contacto_inicial/response_contract.txt` and the shared output-style prompt.
- **Decision:** Add an explicit formatting rule in `prompts/shared/output_style.txt` (or a new `prompts/shared/response_formatting.txt`) that applies to **all** lists the agent prints:
  - Capitalize the first word of every bullet.
  - Remove trailing commas at end-of-line.
  - End every bullet with a period.
- **Plan:**
  1. Create `prompts/shared/response_formatting.txt` with the three rules above.
  2. Wire it into `prompt-manifest.ts` so it is loaded for every node bundle.
  3. Update `contacto_inicial/response_contract.txt` to reference the shared formatting file.
  4. Add an offline eval case `style.welcome_message_formatting` that asserts the reply contains properly capitalized, comma-free, period-closed bullets.

### 1.2 Provider-card formatting: bold titles, stray asterisks, alignment (Image 2)
- **Image reference:** `two.jpeg`
- **What the user sees:** Raw Markdown asterisks (`**`) visible in the WhatsApp/webchat render; titles not bold; text misaligned.
- **Where it lives:** `prompts/nodes/recomendar/response_contract.txt` and `prompts/shared/output_style.txt`.
- **Decision:** The agent should **not** emit raw Markdown. WhatsApp/webchat do not render `**` as bold. We need to tell the model to avoid asterisk markup and instead rely on plain-text structure (line breaks, numbering, dashes) because the channel adapter may apply its own formatting.
- **Plan:**
  1. Update `recomendar/response_contract.txt`:
     - Remove any instruction that implies Markdown bold.
     - Replace with: “Escribe los títulos de los proveedores en mayúsculas o entre comillas para destacarlos; no uses asteriscos ni Markdown.”
  2. Update `prompts/shared/output_style.txt` with a global rule: “No uses sintaxis Markdown (asteriscos, guiones bajos, backticks) en las respuestas; el canal no las renderiza.”
  3. Update the terminal client to strip or replace any remaining `**` with channel-appropriate styling, as a defensive sanitization layer.
  4. Add eval case `style.no_raw_markdown_in_recommendations`.

### 1.3 Provider-card layout: “Ficha” should sit next to the link, on its own line (Image 6)
- **Image reference:** `six.jpeg`
- **What the user sees:** “Ficha: https://…” is inline with the description text and breaks readability.
- **Where it lives:** `recomendar/response_contract.txt`.
- **Decision:** Make the link placement deterministic and visually separated.
- **Plan:**
  1. Add to `recomendar/response_contract.txt`: “Coloca el enlace a la ficha de Sin Envolturas en una línea aparte, al final de la tarjeta del proveedor, precedido de la palabra ‘Ficha:’.”
  2. Add eval assertion `style.provider_link_on_own_line`.

### 1.4 Replace “refinar” with “afinar” (Image 2)
- **Image reference:** `two.jpeg`
- **What the user sees:** The agent uses the verb *refinar* (“refinar solo comida para 50 personas…”). Users find it unclear; *afinar* or “ajustar” is preferred.
- **Where it lives:** `refinar_criterios/response_contract.txt`, `recomendar/response_contract.txt`, and shared anti-patterns.
- **Plan:**
  1. Global search-and-replace of the word *refinar* (and conjugations: *refinar*, *refinamos*, *refinado*) across all prompt files under `prompts/`.
  2. Replace with *afinar* or *ajustar* depending on context.
  3. Update `prompts/shared/anti_patterns.txt` (or create it) to list *refinar* as a prohibited term.
  4. Add an eval case `terminology.avoid_refinar`.

---

## 2. Logic Bugs

### 2.1 Provider-selection continuity: bot asks to “choose a provider” when one is already selected (Image 3)
- **Image reference:** `three.jpeg`
- **What the user sees:** User already confirmed “La Botanería” for catering. In the next turn they say “cerremos” and the bot replies “Aún no puedo cerrar porque falta **elegir un proveedor** para el catering.”
- **Root cause:** The `crear_lead_cerrar` prompt (or the plan snapshot the model receives) does not clearly surface that catering already has `selected_provider_id`. The model hallucinates a missing selection.
- **Plan:**
  1. Update `buildPromptPlanSnapshot` in `src/runtime/openai-agent-runtime.ts` to include an explicit `already_selected_providers` block that lists every need with its selected provider title and ID.
  2. Update `crear_lead_cerrar/system.txt` to state: “Si una necesidad ya tiene `selected_provider_id`, nunca pidas elegir otro proveedor para esa necesidad.”
  3. Update `crear_lead_cerrar/response_contract.txt`: “Antes de pedir datos de contacto, verifica el campo `already_selected_providers`. Si todas las necesidades que el usuario quiere cerrar ya tienen proveedor, salta directamente a solicitar contacto o confirmación.”
  4. Add regression eval `state.close_flow_skips_selection_when_already_selected`.

### 2.2 Cross-need “pending” illusion when no providers exist (Images 8, 9, 14)
- **Image reference:** `eight.jpeg`, `nine.jpeg`, `fourteen.jpeg`
- **What the user sees:**
  - Organization had zero results and the user was told so.
  - Later, when the user tries to close the plan with the selected photography provider, the bot still treats organization as “pending to resume.”
  - Image 14 (detailed WhatsApp feedback): “si un proveedor ya fue descartado por no disponibilidad, no debería volver a mencionarse más adelante con mensajes como ‘cuando quieras retomamos lo otro’.”
- **Root cause:** When `searchProviders` returns zero results, the need stays in status `search_ready` (or `shortlisted` with an empty list). `resolveResumeNode` and `seguir_refinando_guardar_plan` therefore continue to mention it as an open item.
- **Decision:** Introduce a new terminal status `no_providers_available` for needs that have been searched and returned zero results. The agent must treat these as resolved (not pending) and must NOT suggest resuming them.
- **Plan:**
  1. In `src/core/plan.ts`, add `'no_providers_available'` to `providerNeedStatusValues`.
  2. In `AgentService.handleTurn`, when search returns zero results, set the active need status to `no_providers_available` instead of `search_ready`.
  3. Update `mergeProviderNeed` so that `no_providers_available` is preserved across turns and is not overwritten back to `search_ready` by later extractions.
  4. Update `seguir_refinando_guardar_plan/response_contract.txt`: “No ofrezcas retomar necesidades cuyo estado sea `no_providers_available`.”
  5. Update `resolveResumeNode`: do not resume into a need whose status is `no_providers_available`.
  6. Add eval case `state.zero_result_need_not_treated_as_pending`.

### 2.3 Missing post-close contact explanation (Image 4)
- **Image reference:** `four.jpeg`
- **What the user sees:** After closing, the user asks “¿qué pasa a continuación, me van a escribir por este medio?” The bot repeats the generic TTL/cooling message instead of explaining the actual contact flow.
- **Decision:** The close confirmation should explain that Sin Envolturas (or the vendor) will contact the user via the email/phone they provided, typically within 24–48 business hours.
- **Plan:**
  1. Update `crear_lead_cerrar/response_contract.txt`: “Tras confirmar el cierre, explica brevemente que el proveedor se pondrá en contacto directamente por email o teléfono en un plazo aproximado de 24 a 48 horas.”
  2. Update the `finish_plan` tool return payload or prompt context so the model knows the quote requests were sent to the marketplace API.
  3. Update `necesidad_cubierta/response_contract.txt` with the same post-close explanation.
  4. Add eval case `ux.post_close_explains_contact_channel`.

### 2.4 Phone validation happens too late and accepts invalid input (Images 10, 11, 12)
- **Image reference:** `ten.jpeg`, `eleven.jpeg`, `twelve.jpeg`
- **What the user sees:**
  - User sends a 3-digit phone (`967`).
  - Bot accepts it without immediate complaint.
  - Only at the very end of the close flow (when `finish_plan` tries to call the quote endpoint) does the bot say the phone must have at least 6 digits.
  - The validation should happen the moment the phone is extracted.
- **Root cause:** `executeFinishPlanTool` checks presence but not format. `AgentService.applyExtraction` does not validate contact fields.
- **Plan:**
  1. Add a deterministic runtime validator in `AgentService.applyExtraction` (or a new private method `validateContactFields`):
     - `contact_phone`: minimum 6 digits, strip non-numeric characters before counting.
     - `contact_email`: must contain `@` and a domain.
  2. If validation fails, set `current_node` to `crear_lead_cerrar` (or keep it there) and inject an `operational_note` into the compose-reply context so the model knows exactly which field is invalid and why.
  3. Update `crear_lead_cerrar/response_contract.txt`: “Si el teléfono tiene menos de 6 dígitos o el email no parece válido, recházalo inmediatamente y pide el dato de nuevo antes de continuar.”
  4. Update `extractors/field_definitions.txt` to include validation rules for phone/email so the extractor itself flags obvious garbage.
  5. Add eval cases:
     - `validation.phone_3_digits_rejected_immediately`
     - `validation.email_without_at_rejected_immediately`

### 2.5 Phone-update friction: system keeps old invalid phone (Image 13)
- **Image reference:** `thirteen.jpeg`
- **What the user sees:** After providing a bad phone, the user sends a correct phone (`954779071`) in a standalone message. The bot replies: “Todavía no se pudo enviar: el sistema sigue teniendo registrado el teléfono anterior.” It then asks the user to resubmit the phone **plus** a confirmation sentence.
- **Root cause:** The extractor may not update `contact_phone` when the user sends only a phone number without name/email. Or the runtime merge logic treats a single-field update as incomplete and discards it.
- **Plan:**
  1. Strengthen extractor guidance in `extractors/field_definitions.txt`: “Si el usuario corrige solo uno de los datos de contacto (por ejemplo, solo el teléfono), actualiza solo ese campo y conserva los demás.”
  2. In `AgentService.applyExtraction`, ensure that a non-null `contactPhone` from extraction always overwrites the plan value, even when `contactName` or `contactEmail` are null in the same extraction.
  3. Update `crear_lead_cerrar/response_contract.txt`: “Si el usuario envía solo el teléfono para corregirlo, acepta la corrección sin pedir nombre y email de nuevo.”
  4. Add eval case `state.partial_contact_update_overwrites_phone`.

### 2.6 Missing provider link for Maria Bashi (Image 7)
- **Image reference:** `seven.jpeg`
- **What the user sees:** “Ficha: no disponible en los resultados visibles” for Maria Bashi.
- **Root cause:** `toProviderSummary` builds the detail URL from `slug`. If the API returns `slug: null`, the URL is null. The enrich step (`getProviderDetail`) might return a slug, but we need to verify.
- **Plan:**
  1. In `SinEnvolturasGateway.toProviderSummary`, if `slug` is null, attempt to build a fallback URL from `id`: `https://sinenvolturas.com/proveedores/${id}` (if the marketplace supports ID-based routing). If not, keep null.
  2. In `enrichProviders`, after fetching detail, explicitly merge `detailUrl` back into the provider summary (verify that `normalizeProviderSummary` preserves it; if not, fix the merge).
  3. If the marketplace genuinely has no page for Maria Bashi, update `recomendar/response_contract.txt` so the model says “Ficha no disponible en este momento” instead of the awkward “no disponible en los resultados visibles.”
  4. Add a gateway unit test for `detailUrl` fallback behavior.

---

## 3. Flow / UX Bugs

### 3.1 Remove the 24-hour cooling period (TTL) for voluntarily finished plans (Images 4, 5)
- **Image reference:** `four.jpeg`, `five.jpeg`
- **What the user sees:** “Cuando expire el período de enfriamiento de 24 horas podrás iniciar un plan nuevo desde cero.”
- **Explicit stakeholder decision:** The `enfriamiento`/TTL mechanism is to be **removed** for voluntary plan deletion after closing. The user should be able to start a new plan immediately.
- **Plan:**
  1. In `src/core/plan.ts`, set `FINISHED_PLAN_TTL_SECONDS = 0` (or remove the constant entirely).
  2. In `DynamoPlanStore`, when `ttlEpochSeconds` is `0` or `undefined`, do **not** write the TTL attribute to DynamoDB.
  3. In `AgentService.handleTurn`, remove the cooling-period sentence from the finished-plan short-circuit reply.
  4. Update `finish-plan-tool.ts` so `ttl_epoch_seconds` is `0` and the plan lifecycle is still set to `finished`, but the row does **not** expire.
  5. Update `docs/channel-integration.md` to document that finished plans are retained until explicitly deleted by the user or an admin purge.
  6. Update `necesidad_cubierta/response_contract.txt` to remove the 24-hour reference.
  7. Add eval case `state.finished_plan_no_ttl_blocks_new_plan`.

### 3.2 Close flow should not be blocked by “pending” needs that the user explicitly wants to drop (Images 8, 9, 14)
- **Image reference:** `eight.jpeg`, `nine.jpeg`, `fourteen.jpeg`
- **What the user sees:** After selecting photography, the user wants to close. The bot forces them to address organization (which had no results) before entering the close flow.
- **Root cause:** The `cerrar` intent branch does not distinguish between “close everything selected” and “close only if every need is selected.” The current `finish_plan` tool sends quotes for every need that has `selected_provider_id`; it already supports partial closure. The blocker is conversational, not technical.
- **Decision:** When the user says they want to close, the bot should:
  1. List the needs that **will** be closed (those with selected providers).
  2. List the needs that **will not** be closed (those without selected providers, or with `no_providers_available`).
  3. Ask for explicit confirmation: “¿Confirmas que enviemos solicitudes para fotografía y dejemos organización sin proveedor?”
  4. Proceed to contact collection and `finish_plan`.
- **Plan:**
  1. Update `crear_lead_cerrar/system.txt` to authorize partial closure.
  2. Update `crear_lead_cerrar/response_contract.txt` with the explicit two-list + confirmation pattern.
  3. Update `finish-plan-tool.ts` so it already iterates only over needs with `selected_provider_id`; no code change needed there, but verify the error message `no_selected_providers` is not triggered when at least one need is selected.
  4. Add eval case `flow.partial_close_with_explicit_acknowledgment`.

### 3.3 Prevent closing if there are genuine unconfirmed requests (Image 9)
- **Image reference:** `nine.jpeg`
- **What the user sees:** One tester (Carolina flow) notes that the system allowed closing even though organization was still “pending.” She suggests adding a message that says you cannot close if a request still needs confirmation.
- **Decision:** This seems to conflict with 3.2, but it can be reconciled. The rule should be:
  - **Allow** closing with partial selections if the user explicitly acknowledges the skipped needs.
  - **Block** closing only if there is an active need that has **shortlisted providers but no selection yet** (i.e., the user has options to choose from but hasn't picked one). In that case, the bot should say: “Todavía tienes opciones de organización por revisar. Si no quieres ninguna, dime ‘ninguna’ para dejarla sin proveedor y cerrar.”
- **Plan:**
  1. In `AgentService.handleTurn`, before entering the `cerrar` branch, check if any need (other than the active one) has status `shortlisted` with a non-empty `recommended_providers` list and no `selected_provider_id`.
  2. If such a need exists, short-circuit to a new transient node (or keep in `crear_lead_cerrar` with an `operational_note`) that forces the user to explicitly opt out of the pending shortlist.
  3. Update `crear_lead_cerrar/response_contract.txt` with the opt-out wording.
  4. Add eval case `flow.close_blocked_when_unselected_shortlist_exists`.

---

## 4. Provider Filtering / Data Quality

### 4.1 Low-budget event should not show high-end providers (Image 2)
- **Image reference:** `two.jpeg`
- **What the user sees:** User specified a low budget (S/ 1,000) for a birthday. The recommendations include **Paola Puerta Catering**, whose description says “catering para matrimonios y eventos” with a high price level (`$$$$`).
- **Root cause:** The gateway search does not filter by budget or event type; it only ranks by category and location. The model is then expected to decide whether to show the provider, but the prompt does not explicitly tell it to hide mismatched providers.
- **Decision:** Do **not** add hard budget filtering in the gateway (the marketplace API may not support it reliably). Instead, teach the model to skip providers that are clearly mismatched to the event type or budget signal, and to explain *why* it skipped them if the user asks.
- **Plan:**
  1. Update `recomendar/response_contract.txt`:
     - “Si un proveedor tiene un nivel de precio claramente superior al presupuesto indicado por el usuario, no lo incluyas en la shortlist salvo que no haya otras opciones.”
     - “Si un proveedor está especializado en matrimonios y el usuario planea un cumpleaños, prioriza proveedores con experiencia en cumpleaños; si no hay, menciona la especialidad pero no lo presentes como la opción principal.”
  2. Ensure `buildPromptPlanSnapshot` surfaces `budget_signal` and `event_type` prominently so the model sees them.
  3. Add eval case `filter.high_price_provider_hidden_for_low_budget`.

---

## 5. Perf-Table / Telemetry Expansion

### 5.1 Expand `TurnPerfRecord` so a single row can reconstruct the conversation
- **Requirement:** Maintain model conversations / user prompts in the most stripped way possible, but enough to recreate the turn.
- **Current gaps in `src/logs/trace/perf.ts`:**
  - Only `user_message_preview` (160 chars) is kept; full user text is hashed, not stored.
  - The outbound reply text is **not** persisted at all.
  - The extraction result is summarized, not stored in full.
  - The plan snapshot is summarized, not stored in full.
  - There is no turn index / sequence number per conversation.
- **Plan:**
  1. Add fields to `TurnPerfRecord`:
     ```ts
     user_message: string;                           // full inbound text
     outbound_text: string;                          // bot reply text
     extraction_json: string;                        // compact JSON of ExtractionResult
     plan_snapshot_json: string;                     // compact JSON of PlanSnapshot (pruned)
     conversation_turn_index: number;                // 0-based sequence within conversation
     model_reply_id: string | null;                  // OpenAI response.id if available
     prompt_tokens_total: number | null;             // denormalized for quick queries
     ```
  2. In `buildTurnPerfRecord`, populate the new fields:
     - `user_message`: full `args.userMessage`.
     - `outbound_text`: pull from the `HandleTurnResponse.outbound.text` (requires passing it into `buildTurnPerfRecord`).
     - `extraction_json`: `JSON.stringify(args.trace.extraction_summary)` — or better, store the full `ExtractionResult` from the runtime. This requires threading the full extraction object through to the perf builder.
     - `plan_snapshot_json`: store a pruned plan snapshot (remove `recommended_providers` raw blobs, keep IDs and statuses; keep `provider_needs` statuses and selected IDs; keep contact fields; drop `raw` objects). Target < 4 KB.
     - `conversation_turn_index`: query DynamoDB for the previous turn with the same `pk` and increment, or compute from the number of existing rows. For simplicity, use a monotonic integer computed in `AgentService` (store `turnIndex` on the plan or derive from message count).
  3. Update `DynamoPerfStore` / `PerfStore` interface if needed (no change; `PutCommand` accepts the extra fields automatically).
  4. Update the CLI `toCliPerfSummary` to **exclude** the heavy JSON fields from terminal rendering (they are for persistence only).
  5. Update `tests/perf-trace.test.ts` to assert the new fields are populated and within size limits.
  6. Document in `docs/channel-integration.md` that perf rows contain enough data to replay a conversation offline.

---

## 6. Evaluation Additions

For every item above, add at least one eval case. Suggested new cases:

| Eval case ID | Target | Suite |
|--------------|--------|-------|
| `style.welcome_message_formatting` | offline | `dev_regression` |
| `style.no_raw_markdown_in_recommendations` | offline | `dev_regression` |
| `style.provider_link_on_own_line` | offline | `dev_regression` |
| `terminology.avoid_refinar` | offline | `dev_regression` |
| `state.close_flow_skips_selection_when_already_selected` | offline | `dev_regression` |
| `state.zero_result_need_not_treated_as_pending` | both | `dev_regression` |
| `ux.post_close_explains_contact_channel` | offline | `dev_regression` |
| `validation.phone_3_digits_rejected_immediately` | offline | `dev_regression` |
| `validation.email_without_at_rejected_immediately` | offline | `dev_regression` |
| `state.partial_contact_update_overwrites_phone` | offline | `dev_regression` |
| `state.finished_plan_no_ttl_blocks_new_plan` | both | `dev_regression` |
| `flow.partial_close_with_explicit_acknowledgment` | offline | `dev_regression` |
| `flow.close_blocked_when_unselected_shortlist_exists` | offline | `dev_regression` |
| `filter.high_price_provider_hidden_for_low_budget` | offline | `benchmark_full` |

---

## 7. Implementation Order (Recommended)

1. **Perf expansion (#5)** — Do this first so every subsequent test run captures full conversational context.
2. **Remove TTL (#3.1)** — Small, high-impact change that affects the close flow for all tests.
3. **Phone validation (#2.4, #2.5)** — deterministic runtime fixes with clear user value.
4. **Zero-result need status (#2.2)** — fixes the “phantom pending” problem that poisons several other flows.
5. **Partial close flow (#3.2, #3.3)** — builds on #2.2 and #2.4.
6. **Selection continuity (#2.1)** — prompt + snapshot changes.
7. **Stylistic fixes (#1.1–#1.4)** — prompt-only, low risk.
8. **Provider filtering (#4.1)** — prompt-only, but may affect live search behavior; validate carefully.
9. **Missing links (#2.6)** — gateway data fix.
10. **Eval cases** — add as each feature is implemented.

---

## 8. Files That Will Change

- `src/core/plan.ts`
- `src/core/decision-flow.ts`
- `src/runtime/agent-service.ts`
- `src/runtime/openai-agent-runtime.ts`
- `src/runtime/finish-plan-tool.ts`
- `src/runtime/sinenvolturas-gateway.ts`
- `src/logs/trace/perf.ts`
- `src/storage/dynamo-plan-store.ts` (TTL handling)
- `prompts/shared/output_style.txt`
- `prompts/shared/response_formatting.txt` *(new)*
- `prompts/nodes/contacto_inicial/response_contract.txt`
- `prompts/nodes/recomendar/response_contract.txt`
- `prompts/nodes/refinar_criterios/response_contract.txt`
- `prompts/nodes/crear_lead_cerrar/system.txt`
- `prompts/nodes/crear_lead_cerrar/response_contract.txt`
- `prompts/nodes/seguir_refinando_guardar_plan/response_contract.txt`
- `prompts/nodes/necesidad_cubierta/response_contract.txt`
- `prompts/extractors/field_definitions.txt`
- `docs/implementation-log.md`
- `docs/channel-integration.md`
- `tests/perf-trace.test.ts`
- `tests/agent-service.test.ts`
- `tests/decision-flow.test.ts`
- `evals/suites/dev_regression.yaml`
- `evals/cases/` *(new regression cases)*
