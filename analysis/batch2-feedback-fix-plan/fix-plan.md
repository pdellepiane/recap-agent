# Batch 2 Feedback Fix Plan

Investigation date: 2026-05-20

## Executive Summary

The batch is not a collection of unrelated copy bugs. Most screenshots point to four system issues:

1. Close flow state is not deterministic once a user has selected or declined providers.
2. Contact collection allows ambiguous copy and weak phone validation.
3. Provider search can surface out-of-location results, especially in vector/hybrid paths.
4. FAQ/scope answers need clearer support escalation and product-specific wording.

The highest-risk workstream is the close flow because it affects `finish_plan`, persisted provider selections, and structured output parsing.

## Determinism Principles

These rules are mandatory for every workstream in this plan:

- Critical plan actions must be driven by structured extraction and typed service state, not exact word matching. This includes selecting providers, deferring needs, closing a plan, abandoning a plan, validating contact details, and deciding whether to call quote/contact tools.
- Use Zod schemas for all new structured inputs, outputs, and intermediate action payloads. Prefer discriminated unions for action results, for example `close_action: "confirm" | "defer_need" | "request_contact" | "abandon"`.
- Exact text matching may only support non-critical convenience hints, such as improving provider alias resolution after a structured intent is already present. It must not be the sole condition for mutating plan state or calling external tools.
- Runtime code should consume typed extraction objects such as `providerPlanOperations`, `selectedProviderHints`, `secondaryIntents`, contact fields, and explicit lifecycle/action fields. If extraction is ambiguous, the service should ask a clarifying question instead of guessing from a substring.
- Prompt changes should teach the extractor to emit structured objects; service changes should validate those objects and enforce deterministic transitions.

## Perf Log Validation

Checked on 2026-05-20 through DynamoDB table `recap-agent-runtime-perf` using AWS profile `se-dev`.

User correlation:

- Channel: `web_chat`
- External user id shape: bare number `954779067`
- Hash prefix: `4a6e0c8e80e4`
- Direct GSI query for `CHANNEL_USER#web_chat#sha256("954779067")` returned 44 turns on 2026-05-15.
- The screenshot export date is 2026-05-18, but the matching runtime traces are from 2026-05-15.

Validated trace facts:

- At `2026-05-15T19:08:00.869Z`, close was blocked with the operational note asking whether to choose Catering or respond "ninguna", while Fotografia already had selected provider id `168`.
- At `2026-05-15T19:12:26.498Z`, the user said Kisu for catering; extraction had selected hint `Kisu` and one provider operation, but the plan still had Catering shortlisted with no selected id. This confirms provider operation/reference resolution is too brittle.
- At `2026-05-15T19:13:54.591Z`, an incomplete phone `95477906` reached the close node and `finish_plan` was called despite unresolved provider state. This strengthens the need for typed close preconditions and phone parsing.
- At `2026-05-15T19:16:11.310Z`, "que es un codigo de extension" routed from close to `recomendar` and called `search_providers_from_plan`, confirming contact clarification needs its own structured action.
- At `2026-05-15T19:21:42.479Z`, "ninguna" changed both Fotografia and Catering back to shortlisted/no selection and triggered search. This confirms raw decline handling can erase selected providers.
- A second correlated user hash `5b8dd4cf18f7` validates the Rebel path: Rebel selected provider id `95` at `2026-05-15T19:39:23.029Z`, then "que?" at `2026-05-15T19:42:25.104Z` routed to `recomendar`, cleared selection, and searched again.
- The Lurin search at `2026-05-15T19:35:12.974Z` returned provider ids `142,132,164,173,95,131,133`; this supports the locality workstream, though provider locations need gateway/detail inspection to prove which ids were Mexico.
- A third correlated user hash `f6b10567e6b5` validates FAQ/scope turns for web design, support contact, gift issue, and brand contact questions.

Plan impact:

- Workstream A5 is now higher priority inside Milestone 2: structured provider references/operations must be consumed deterministically before any close blocking.
- Workstream C2 should enforce phone validity before `finish_plan` can be called; the current system let an incomplete local phone reach close tooling.
- Workstream C3 should be implemented as a typed close/contact clarification action, not a FAQ/search fallback.
- Workstream D1 remains valid but should inspect provider ids from the trace before changing search ranking assumptions.

## Implementation Progress

Updated on 2026-05-20:

- Milestone 1 is complete: Zod schemas now cover close actions, close-flow results, provider references, canonical contact fields, and typed phone parsing.
- Milestone 2 is complete and tested: close-time selections now consume structured `selectedProviderReferences`; unresolved shortlist deferral requires structured `closeAction: { type: "defer_need" }`; raw `ninguna` text no longer mutates plan state; reply parsing reuses the same output schema selected before model/tool execution.
- Milestone 3 is complete for C1/C2/C3 and tested: contact request rendering uses canonical fields, phone validation requires complete supported international numbers, `finish_plan` splits phone/country code through the parser, and extension/country-code clarification stays in `crear_lead_cerrar` without provider search.
- Milestone 4 is complete for D1/D2 and tested: hybrid/vector results now pass through deterministic category/location selection, hybrid search merges API and vector candidates, cross-country vector hits are suppressed when same-country providers are available, and same-external-user resume preserves selected providers through contact-close entry.
- Development deployment completed after Lambda-impacting runtime and prompt changes using AWS profile `se-dev`.

## Evidence Map

| Feedback lines | Screenshot index | Exported image file | Issue summary |
| --- | --- | --- | --- |
| `dump.md:4` | 01 | `18.39.57 (1).jpeg` | Contact request says only "Envíame..." and exposes raw contact field names in nearby screenshots. |
| `dump.md:8-14` | 02-05 | `18.39.57 (2-4).jpeg`, `18.39.57.jpeg` | Closing says one provider was saved, then blocks on catering and asks for contact with little context. |
| `dump.md:16-24` | 06-08 | `18.39.58 (1-3).jpeg` | Close still claims catering is missing; extension-code answer drags in catering shortlist; short phone accepted. |
| `dump.md:26-38` | 09-13 | `18.39.58 (4).jpeg`, `18.39.58.jpeg`, `18.39.59 (1-3).jpeg` | "ninguna" and forced exit keep looping through confirmation instead of cleanly omitting catering or ending. |
| `dump.md:40-44` | 14-16 | `18.39.59 (4-5).jpeg`, `18.39.59.jpeg` | New chat with same number still does not recognize Filomena as selected and keeps asking to define needs. |
| `dump.md:46-48` | 17-18 | `18.40.00 (1-2).jpeg` | Lurin photography query shows providers in Mexico. |
| `dump.md:50-54` | 19-20 | `18.40.00 (3).jpeg`, `18.40.00.jpeg` | Selecting Rebel triggers confirmation plus another provider list; next turn shows red schema error and then repeats options. |
| `dump.md:56-58` | 21 | `18.40.01 (1).jpeg` | Out-of-scope web-design answer should set expectations and offer real support contact. |
| `dump.md:60-68` | 22, 24 | `18.40.01 (2).jpeg`, `18.40.02.jpeg` | Gift/brand-support wording is confusing and should proactively explain direct brand claims plus SE help channel. |
| implicit after error | 23 | `18.40.01.jpeg` | After red error, "que?" returns a photo list, confusing current selection state. |

## Workstream A - Close Flow State Machine

Can be fixed together: close blocking, need-decline semantics, repeated confirmation, post-error rerouting, selection persistence.

### A1. Make close intent resolve selection before blocking on unselected shortlists

Problem: in `AgentService.handleTurn`, close intent enters `hasUnselectedShortlist()` before resolving fresh selection hints from the same turn. A message like "si quiero cerrar con Filomena" can still be blocked by another shortlist, and later turns can feel like the selected provider vanished.

Code references:

- `src/runtime/agent-service.ts:387-468`: close branch checks `hasUnselectedShortlist()` and currently treats raw text containing `ninguna` as a decline.
- `src/runtime/agent-service.ts:1521-1588`: `tryResolveSelection()` can mutate the plan with selected provider IDs, but it is reached in the general search branch, not before close blocking.
- `src/runtime/agent-service.ts:2576-2584`: `hasUnselectedShortlist()` only sees `shortlisted` needs with no selected providers.
- `src/core/plan.ts:232-290`: `mergeProviderNeed()` preserves or clears selections depending on explicit empty updates.
- `src/runtime/extraction-schemas.ts:33-52`: `ProviderPlanOperation` is already the structured place to represent need/provider mutations.

Action plan:

- Before the `extraction.intent === 'cerrar'` block checks `hasUnselectedShortlist()`, apply structured selection and provider-plan operations from extraction: `selectedProviderHints`, `secondaryIntents`, and `providerPlanOperations`.
- Do not inspect raw user text to decide close actions. If extraction does not provide a structured selection/deferral and there is an unresolved shortlisted need, ask a typed clarification through the close node.
- Recompute `unselected` after selection resolution.
- Add a regression test where an existing plan has Fotografia selected and Catering shortlisted; user says "cierro con Filomena y ninguna de catering"; expected plan keeps Filomena selected, marks Catering deferred, and enters `crear_lead_cerrar` without another recommendation search.
- Add a second test where user confirms a provider by name and asks to close in the same turn; expected no provider search and no duplicate shortlist response.

### A2. Replace raw decline detection with explicit provider-decline operations

Problem: `userDeclinedShortlist = inbound.text.toLowerCase().includes('ninguna')` is global and ambiguous. It cannot tell whether "ninguna" applies to catering, photography, or a general exit.

Code references:

- `src/runtime/agent-service.ts:387-388`: raw string detection.
- `src/runtime/extraction-schemas.ts:33-52`: `ProviderPlanOperation` already supports `defer_need`.
- `prompts/extractors/normalization_rules.txt:41-42`: operation extraction exists but needs stronger rules for "ninguna" in close flow.
- `prompts/extractors/field_definitions.txt:10`: `modificar_plan_proveedores` is the intended path for add/change/delete/defer.

Action plan:

- Update extractor prompts so decline language produces `providerPlanOperations: [{ type: "defer_need", category: ... }]` when a pending need is identifiable, and produces a distinct typed abandon/pause signal when the user wants to stop the whole flow.
- Add a Zod-validated close intent/action schema, either by extending `extractionSchema` or adding a nested object such as:

```ts
closeAction: z.discriminatedUnion('type', [
  z.object({ type: z.literal('confirm_close') }),
  z.object({ type: z.literal('defer_need'), category: providerCategorySchema }),
  z.object({ type: z.literal('request_contact') }),
  z.object({ type: z.literal('abandon_plan') }),
  z.object({ type: z.literal('clarify'), reason: z.string().min(1) }),
]).nullable()
```

- In close flow, consume applied `defer_need` operations before checking `hasUnselectedShortlist()`.
- Remove `userDeclinedShortlist` and any substring-based close mutation. If exactly one unselected shortlist exists but extraction is ambiguous, return a clarification message instead of mutating state.
- Add tests for "ninguna de catering", "no quiero ningun catering", and "no quiero seguir con nada" where assertions inspect the structured extraction fixture/action object and the resulting plan state.

### A3. Stop showing recommendation lists after a successful selection

Problem: screenshot 19 shows provider confirmation plus another list; screenshot 20 then repeats the list after an error. The current general flow can route to search when `shouldContinueWithAnotherNeed()` thinks the active need is still unresolved.

Code references:

- `src/runtime/agent-service.ts:720-821`: if selection resolution is not the final active need, the flow can continue into provider search.
- `src/runtime/agent-service.ts:2552-2574`: `shouldContinueWithAnotherNeed()` continues when the selected category differs from the active category.
- `prompts/nodes/seguir_refinando_guardar_plan/response_contract.txt:2-8`: this node can confirm saved progress without rendering another shortlist.

Action plan:

- When structured extraction includes `confirmar_proveedor` and `cerrar`, route to `crear_lead_cerrar` after selection resolution instead of recommendation search.
- When structured extraction is only `confirmar_proveedor`, prefer `seguir_refinando_guardar_plan` confirmation unless extraction also contains a structured provider-search or need-change action.
- Add a test for "seguimos con este proveedor" after a shortlist; expected current node `seguir_refinando_guardar_plan`, selected provider present, and no `search_providers_from_plan` call.

### A4. Add a true user-abandon/end state for forced exits

Problem: screenshots 12-13 show the user trying to stop, but the system keeps insisting on unresolved providers. The project currently has only active/finished lifecycle states, and `guardar_cerrar_temporalmente` means saved for later rather than abandoned.

Code references:

- `src/core/plan.ts:40-44`: lifecycle states are only `active` and `finished`.
- `src/runtime/agent-service.ts:313-382`: pause handling routes to `guardar_cerrar_temporalmente`.
- `prompts/shared/flow_discipline.txt:7`: says pause or close should confirm temporary save without more data.

Action plan:

- Decide whether to add lifecycle state `abandoned` or keep `active` with `current_node: guardar_cerrar_temporalmente`. Since the repo avoids backwards-compat shims during active development, adding `abandoned` is acceptable if it simplifies behavior.
- Add a structured extraction signal for full-flow abandonment; do not infer abandonment from exact phrases in `AgentService`.
- For full-flow abandonment, do not ask for provider confirmations. Send a short closure message and prevent immediate re-entry into stale close prompts.
- Add plan lifecycle tests and a terminal/WhatsApp behavior test for forced exit.

### A5. Make provider reference resolution structured-first

Problem: provider selection currently depends on a mix of extractor-provided hints and local alias matching. Alias matching is useful, but it should not be the critical path when the extractor can provide `providerId`, `providerTitle`, and `category`.

Code references:

- `src/runtime/extraction-schemas.ts:9-14`: `providerReferenceSchema` already supports structured provider identity.
- `src/runtime/agent-service.ts:1479-1513`: `resolveProviderReference()` can consume structured provider references for plan operations.
- `src/runtime/agent-service.ts:1521-1588`: `tryResolveSelection()` currently accepts only string hints.
- `src/runtime/agent-service.ts:2358-2394`: provider aliases are substring-oriented helper logic.

Action plan:

- Extend selection resolution to accept `ProviderReference[]` from structured extraction, not only `selectedProviderHints: string[]`.
- Prefer exact `providerId + category` matches, then canonical provider title/category matches, then alias matching only as a non-critical disambiguation aid.
- If more than one provider matches an alias or hint, ask for clarification instead of selecting.
- Add tests for provider ID selection, provider title selection across multiple needs, ambiguous alias selection, and no raw-text-only selection.

## Workstream B - Structured Close Output and Tool Error Handling

Can be fixed together: red schema error, `finish_plan` success result, partial failures, plan persistence after tool mutation.

### B1. Freeze output schema for a turn or model close as a two-phase runtime action

Problem: `OpenAiAgentRuntime.composeReply()` resolves output schema before the run, but parses with `this.resolveOutputSchema(request)` again after the run. `finish_plan` mutates `request.plan.lifecycle_state` to `finished`, so the post-run parse can expect `close_result` even if the agent was originally constructed with `close_confirmation`, or vice versa. Screenshot 19 shows a JSON schema error consistent with this instability.

Code references:

- `src/runtime/openai-agent-runtime.ts:669-698`: `resolveOutputSchema()` returns `contact_request`, `close_confirmation`, or `close_result` from mutable plan state.
- `src/runtime/openai-agent-runtime.ts:104-119`: schema is chosen for the Agent before tool execution.
- `src/runtime/openai-agent-runtime.ts:161-166`: schema is re-resolved after tool execution.
- `src/runtime/openai-agent-runtime.ts:1358-1372`: `finish_plan` tool mutates the same plan object through `executeFinishPlanTool()`.
- `src/runtime/finish-plan-tool.ts:114-122`: successful tool execution mutates lifecycle to `finished`.

Action plan:

- Store `const parseSchema = outputSchema` before `run()` and use that exact schema after the run.
- Better: split close into deterministic service logic. Let the model produce `close_confirmation`; after explicit user confirmation and contact validation, call `executeFinishPlanTool()` in `AgentService`, then render a service-owned `close_result` message. This removes reliance on the model to call `finish_plan` and hit the right structured schema in the same turn.
- Represent service-owned close outcomes with a Zod discriminated union, for example `CloseFlowResult = success | partial | missing_contact | no_selected_providers | invalid_contact | needs_clarification`.
- Add a regression test where `finish_plan` succeeds and the final outbound is a close result, not a red schema error.
- Add a test for partial quote failure; expected message lists successful and failed providers without marking plan finished unless product accepts partial finish.

### B2. Make internal tool errors user-safe and sticky enough to avoid misleading recovery

Problem: after the red error, the next "??" or "que?" returns a provider list, hiding the failure and confusing whether Rebel stayed selected.

Code references:

- `src/runtime/agent-service.ts:798-820`: provider search exceptions route to `informar_error_reintento`; close-tool parse errors currently bubble from runtime and are not normalized here.
- `prompts/nodes/informar_error_reintento/tool_policy.txt:5`: says to communicate the error first.
- `src/runtime/openai-agent-runtime.ts:1363-1371`: records `finish_plan` output but does not guard output parse failures.

Action plan:

- Catch structured output parse failures around close flow and return a typed `CloseFlowResult`/`informar_error_reintento` fallback that preserves selected providers.
- Persist a short operational note/last error in trace or plan metadata only if needed; avoid resetting active need to recommendation.
- Add a test where a runtime compose failure during close preserves `selected_provider_ids` and does not call search on the next clarification.

## Workstream C - Contact Copy and Validation

Can be fixed together: raw field names, missing context, country code guidance, incomplete phone acceptance.

### C1. Replace raw field names and add close context in contact requests

Problem: screenshots 01, 03, and 05 show copy like "Envíame tu contact_name, contact_email, contact_phone" or a contextless "Envíame tu nombre...". The renderer only knows `full_name`, `email`, and `phone`, so raw schema fields leak when the model returns them.

Code references:

- `src/runtime/message-renderer.ts:229-244`: renders contact request from `intro_es` and `requested_fields_es`.
- `src/runtime/message-renderer.ts:302-312`: maps only `full_name`, `email`, `phone`.
- `prompts/nodes/crear_lead_cerrar/response_contract.txt:3-5`: asks for missing fields but does not prescribe canonical field keys.
- `prompts/nodes/crear_lead_cerrar/system.txt:11-14`: requests contact information but does not require explaining why.
- `src/runtime/structured-message.ts:71-75`: `requested_fields_es` is untyped `string[]`.

Action plan:

- Change `contactRequestMessageSchema.requested_fields_es` to an enum array: `full_name | email | phone`.
- Add compatibility mapping in renderer for `contact_name`, `contact_email`, `contact_phone` while prompts are updated.
- Update `crear_lead_cerrar` response contract to require an intro like: "Si quieres cerrar el plan con los proveedores seleccionados, necesito tus datos de contacto para enviarles la solicitud."
- Include "teléfono con código de país" in the phone label.
- Make missing contact fields a service-computed typed list, not model-inferred free text. The model may phrase the intro, but the renderer should receive canonical field IDs.
- Add renderer tests for canonical and legacy contact fields.

### C2. Strengthen phone validation and extension splitting

Problem: screenshot 08 accepts `+51 95477906`, which is missing a digit for a Peru mobile number. Current validation accepts any 6-15 digit string, and `splitPhoneExtension()` only supports country codes `52`, `51`, and `1`.

Code references:

- `src/runtime/agent-service.ts:2598-2607`: phone validation is length-only.
- `src/runtime/agent-service.ts:2614-2628`: phone inference accepts the same weak shape.
- `src/runtime/agent-service.ts:2631-2641`: invalid phone message is generic.
- `src/runtime/finish-plan-tool.ts:27-35`: country-code split fallback can send empty `phoneExtension`.
- `src/runtime/provider-gateway.ts:56-66` and `src/runtime/sinenvolturas-gateway.ts:446-468`: quote endpoint requires separate `phone` and `phoneExtension`.

Action plan:

- Add a typed phone parser with Zod-validated return shape, for example a discriminated union of `{ status: "valid", digits, countryCode, nationalNumber }` and `{ status: "invalid", reason }`.
- For Peru, require `+51` plus 9 national digits. For Mexico, require `+52` plus 10 national digits. For US/Canada, require `+1` plus 10 national digits. For unknown codes, either reject with "incluye código de país y número completo" or allow only if 10-14 total digits after the country code can be safely split.
- Persist only valid normalized international digits.
- Update contact error copy to ask only for corrected phone and explicitly mention country code.
- Add tests for `+51 95477906` rejected, `+51 954779067` accepted and split into `phoneExtension: "+51", phone: "954779067"`, and no-extension local number rejected in close flow.

### C3. Answer phone-extension questions without reintroducing provider lists

Problem: screenshot 07 asks "que es un codigo de extension" and receives an answer plus catering options. This is a contact clarification, not provider recommendation.

Code references:

- `prompts/extractors/field_definitions.txt:16`: FAQ intent covers product questions but not contact-form clarifications.
- `src/runtime/agent-service.ts:1074-1079`: `consultar_faq` and missing-field routing are separate.
- `prompts/nodes/crear_lead_cerrar/transition_policy.txt:3`: contact edits stay in close node.

Action plan:

- Add extractor rule: if current node is `crear_lead_cerrar` and user asks about a requested contact field, emit a structured contact-clarification action rather than provider search or FAQ.
- Add a prompt rule in `crear_lead_cerrar`: answer what extension/country code means in one sentence, then ask only for the missing contact field.
- Add a test from close node with user asking "que es codigo de extension"; expected no provider list and no search tool call.

## Workstream D - Provider Search Locality and Selection Quality

Can be fixed together: Mexico results for Lurin, vector results not location-scoped, selection confirmation plus extra list.

### D1. Enforce location scoring after vector search

Problem: screenshot 17 shows Mexican providers for a Lurin, Peru wedding. API search has `selectProvidersForPlan()` location scoring, but vector/hybrid paths return vector-enriched providers directly.

Code references:

- `src/runtime/sinenvolturas-gateway.ts:140-153`: dispatches API/vector/hybrid.
- `src/runtime/sinenvolturas-gateway.ts:196-205`: API path filters/ranks through `selectProvidersForPlan()`.
- `src/runtime/sinenvolturas-gateway.ts:210-245`: vector and hybrid paths return vector providers directly and do not call `selectProvidersForPlan()`.
- `src/runtime/sinenvolturas-gateway.ts:510-557`: category/location ranking logic exists but is not reused for vector.
- `src/runtime/provider-vector-search.ts` and `tests/provider-vector-search.test.ts`: vector filters should also be checked for location/country attributes.

Action plan:

- Apply `selectProvidersForPlan()` to vector-enriched and hybrid-merged candidates before slicing.
- In hybrid mode, merge API and vector candidates with `mergeProviderCandidates()` instead of returning vector-only when vector results exist.
- If exact country match exists, suppress cross-country providers from the rendered shortlist. If only cross-country results exist, show a no-local-results/refine message instead of presenting them as valid options.
- Keep locality decisions based on normalized provider/location fields and typed fit criteria, not on matching city/country words in generated prose.
- Add tests for a Lurin/Lima/Peru query where vector returns Mexico and Peru; expected Peru first and Mexico omitted when enough Peru results exist.

### D2. Preserve selected provider identity across new chats with same number

Problem: screenshots 14-16 show the user starts again with the same number and Filomena is still not recognized as selected. This may be desired if a new WhatsApp number is used later, but same external user should load the saved plan.

Code references:

- `src/runtime/agent-service.ts:84-91`: plan loaded by `channel` and `externalUserId`.
- `src/runtime/agent-service.ts:107-132`: finished plans may reset on planning intent.
- `src/core/decision-flow.ts:37`: selected provider can resume close flow.
- `src/terminal/client.ts:728-732` and `src/terminal/client.ts:850-871`: terminal debug can show selected providers.

Action plan:

- Reproduce with an in-memory plan: select Filomena, start a new turn with same external user, ask "me ayudas a contactar proveedores"; expected plan has selected provider and response can proceed to close/contact data.
- If the bug only appears after a failed close parse, fix B2 first and add a regression test combining close failure plus same-user resume.
- If the bug appears without failure, inspect plan store persistence and conversation ID handling.

## Workstream E - Scope, Support, and FAQ Wording

Can be fixed together: initial boundaries, support contact, gift/brand-problem copy.

### E1. Clarify assistant scope at welcome and out-of-scope turns

Problem: screenshot 21 shows the user asks for website design and then asks for support contact. The bot correctly says it does not create a website, but initial copy may overpromise and support escalation says there is no direct number.

Code references:

- `prompts/shared/base_system.txt:4-5`: public identity says it handles service questions and provider plans.
- `prompts/shared/domain_scope.txt:12-17`: out-of-scope rules are broad and do not specify support escalation.
- `prompts/nodes/contacto_inicial/response_contract.txt:4`: requested fields for planning but no scope boundary.
- `prompts/nodes/consultar_faq/response_contract.txt:4`: fallback support email is `hola@sinenvolturas.com`; mentions WhatsApp generically.

Action plan:

- Update welcome copy to say the assistant helps with Sin Envolturas questions and event-provider planning, not external web design/build work.
- Add a support fallback that consistently gives `hola@sinenvolturas.com` and the official WhatsApp/social channel if the product team provides it. Do not claim "no direct number" unless that is confirmed policy.
- Add FAQ prompt tests/evals for "me haces mi web" and "contacto por este error".

### E2. Improve gift/product-claim FAQ answer in the knowledge base or FAQ prompt

Problem: screenshots 22 and 24 show the gift answer is directionally correct but confusing. The desired behavior is to say gifts are not mandatory, Sin Envolturas transfers the configured net amount, product purchase claims go directly to the brand, and SE can help connect by chat/email.

Code references:

- `prompts/nodes/consultar_faq/system.txt:3-13`: FAQ node must use KB and offer support if unavailable.
- `prompts/nodes/consultar_faq/tool_policy.txt:13-16`: FAQ must use file search, no provider tools.
- `prompts/nodes/consultar_faq/response_contract.txt:1-9`: concise answer rules and support fallback.
- Knowledge source is managed by `src/knowledge-sync/*`; inspect the source KB before changing conversational content.

Action plan:

- Locate the KB article/file used for gift list and product-claim answers.
- Update the KB text, not just the prompt, so file search returns the desired policy language.
- Add an eval where the user asks "problema con regalo de mi web" and expected answer includes: not mandatory to buy, payout/commission framing, direct brand claim, and SE help contact.

## Suggested Implementation Order

1. Add/adjust Zod schemas for close actions, provider references, contact requests, phone parsing, and service-owned close results.
2. B1 plus A1/A2/A5: stabilize close schema and close-state transitions using structured extraction and typed service actions.
3. C1/C2/C3: fix contact request and validation while close flow is already under test.
4. D1/D2: fix locality and selection persistence after close no longer corrupts state.
5. E1/E2: update FAQ/scope copy and KB-backed answers.

## Verification Checklist

- Unit tests for `AgentService` close flows using structured extraction fixtures: selected provider plus pending need, explicit defer-need action, close after contact, close parse failure recovery.
- Schema tests for new/changed Zod objects and discriminated unions.
- Unit tests for phone parsing and `executeFinishPlanTool()` payload splitting.
- Gateway tests for hybrid/vector search locality.
- Prompt-loader or eval cases for contact request wording, extension clarification, out-of-scope support, and gift/product claim FAQ.
- Manual terminal run using WhatsApp-emulated client for the exact screenshot path: select photo provider, decline catering, provide contact, confirm close, then ask a follow-up.
