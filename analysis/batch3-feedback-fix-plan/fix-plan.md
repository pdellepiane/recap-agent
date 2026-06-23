# Batch 3 Actionable Fix Plan

## Summary

| Classification | Count | Implementation Path |
| --- | ---: | --- |
| Objective mistakes/failures | 12 | Fix directly with tests. |
| Tone changes | 4 | Solve through a shared system-wide personality and response-style prompt included in every node. |
| Approval-gated ambiguous/product changes | 8 | Do not implement until approved one by one. |

## Fix Together: Routing And State Integrity

These issues should be implemented together because they all depend on structured extraction, state-machine transitions, or event-plan/provider-operation consistency.

| ID | Classification | Identified Issue | Evidence | Code References | Expected Fix |
| --- | --- | --- | --- | --- | --- |
| O1 | Objective failure | User problem/help messages repeat generic onboarding instead of routing to support, FAQ, or event lookup. | Screenshots show repeated welcome menus after "tengo un problema con mi evento"; Dynamo session `701ff49783003f6463a0e7be224b83987b86a131d45046d70cf6fc461d466f32` stays in `entrevista` for repeated problem messages before eventual event lookup. | `prompts/extractors/field_definitions.txt:16`, `prompts/extractors/field_definitions.txt:17`, `prompts/nodes/contacto_inicial/response_contract.txt:1`, `prompts/nodes/entrevista/response_contract.txt:1`, `src/runtime/openai-agent-runtime.ts:749`, `src/runtime/message-renderer.ts:49` | Add structured extraction evidence for "help with my event" vs "planning a new event"; route event-specific support to `consultar_evento_invitado` or a support FAQ path; render one clarifying question instead of the generic top-level menu. |
| O3 | Objective failure | "No me llega" after code delivery becomes a dead end that asks for the same code again. | Screenshot and Dynamo session `701ff49783003f6463a0e7be224b83987b86a131d45046d70cf6fc461d466f32` show `No me llega` after email code send; next action note says a code was already sent and asks for it. | `src/runtime/agent-service.ts:1187`, `src/runtime/agent-service.ts:1215`, `prompts/nodes/consultar_evento_invitado/response_contract.txt` if present | Add an auth-code recovery branch: resend code, offer checking spam/email spelling, allow changing email, and expose a clear fallback. Test the "No me llega" turn after `guest_auth_code_sent`. |
| O4 | Objective failure | "Baby Baloo" is incorrectly treated as "Baby Loli". | PDF feedback says Baby Baloo should not become Baby Loli; Dynamo session `7c89e25c2d83f309914e679c881ea84a38a943f0d955b53ccf42c7e609d3784a` logs the assumption "baby baloo corresponde a BABY LOLI" and selected provider IDs including Baby Loli. | `prompts/extractors/field_definitions.txt:74`, `prompts/extractors/field_definitions.txt:130`, `src/runtime/agent-service.ts:2490` | Require provider matching evidence to preserve unknown/ambiguous names instead of coercing to nearest known provider. If no confident catalog match exists, ask a clarification or keep the literal provider hint unresolved. |
| O5 | Objective failure | User rejection does not clear stale selected provider state. | Dynamo session `7c89e25c2d83f309914e679c881ea84a38a943f0d955b53ccf42c7e609d3784a` has `unselect_provider` for "no quiero quedarme con baby loli", but selected provider IDs remain `[53,55,73]` after the turn. | `src/runtime/agent-service.ts:2490`, `src/runtime/agent-service.ts:2580`, `src/runtime/openai-agent-runtime.ts:1592` | Make `unselect_provider` and `defer_provider` mutate selected-provider state consistently, add assertions that rejected provider IDs are absent after operation application, and ensure the prompt snapshot does not reintroduce stale selections. |
| O6 | Objective failure | "Ninguna" does not resolve a close blocker when the assistant asks which provider the user wants. | Dynamo session `7c89e25c2d83f309914e679c881ea84a38a943f0d955b53ccf42c7e609d3784a` shows "cerremos" then "ninguna"; state remains `crear_lead_cerrar` with same next-action note asking about Fotografía. | `prompts/extractors/field_definitions.txt:130`, `src/runtime/agent-service.ts:2490`, `src/runtime/message-renderer.ts:255` | Treat explicit negative answers as resolving or clearing pending provider-selection blockers. Continue closure if contact requirements are met, or ask only the next real missing closure field. |
| O7 | Objective failure | Multi-front requests only advance one service and leave other requested fronts hanging. | PDF feedback asks to handle several service fronts at the same time; Dynamo session logs "floreria y fotografia y video" but the next action focuses on photography while floristry remains only `search_ready`. | `prompts/shared/question_strategy.txt:1`, `src/runtime/openai-agent-runtime.ts:1592`, `src/runtime/agent-service.ts:2490` | Update plan-first behavior to acknowledge all requested fronts in one event plan and either search multiple ready needs or explicitly summarize the queued fronts. Remove the current prompt instruction that discourages solving multiple mentioned services in the same turn. |
| O8 | Objective failure | Contact flow can loop after a valid phone correction. | Dynamo session includes a valid `+51 954779067`, but later notes still report `contact_phone_invalid`. | `src/runtime/agent-service.ts:2243`, `src/runtime/agent-service.ts:2303`, `src/runtime/phone.ts:41`, `src/runtime/message-renderer.ts:238` | Add tests for spaced Peru mobile numbers, phone correction after prior invalid input, and contact-state overwrite semantics. Ensure valid parsed numbers clear invalid-contact blockers. |
| O9 | Objective failure | "How do I see confirmed guests in one place?" is treated as generic FAQ instead of event/account lookup or product support. | Dynamo session `5888aaff88370f074b6ee1e346f7ca6a5645521899dfe08f824c8d6974e3ab36` routes "como veo los confirmados en un solo lugar" from `entrevista` to `consultar_faq`. | `prompts/extractors/field_definitions.txt:16`, `prompts/extractors/field_definitions.txt:17`, `prompts/nodes/consultar_faq/response_contract.txt:1`, `src/runtime/openai-agent-runtime.ts:878` | Split product-help FAQ from user-event lookup. For account/event-specific guest lists, ask for event identification or route to authenticated event lookup instead of answering as generic planning FAQ. |

## Fix Together: Output Hygiene And User-Facing Rendering

These can be centralized in prompt output contracts plus renderer/sanitizer code.

| ID | Classification | Identified Issue | Evidence | Code References | Expected Fix |
| --- | --- | --- | --- | --- | --- |
| O2 | Objective failure | Internal field names leak to the user, such as `event type` and `budget_or_guest_range`. | PDF feedback flags these as confusing internal language. | `src/core/sufficiency.ts:13`, `src/runtime/openai-agent-runtime.ts:1592`, `src/runtime/message-renderer.ts:299`, `prompts/shared/output_style.txt:1` | Add a user-facing missing-field label map and enforce it in prompt snapshots and renderers. Never expose internal snake_case or implementation field names. |
| O10 | Objective failure | `filecite turn1 file 0` style citation artifacts leak in assistant output. | PDF feedback includes the citation artifact complaint. | `src/runtime/openai-agent-runtime.ts:878`, `src/runtime/openai-agent-runtime.ts:1000`, `src/runtime/agent-service.ts:4021` | Add a final output sanitizer for OpenAI citation artifacts, and add regression tests around FAQ/file-search responses. Keep source grounding internal unless the channel intentionally supports citations. |
| O11 | Objective failure | FAQ answers miss obvious expected answers for Shop, benefits, livestream, gift-list customization, event duration, and list type questions. | PDF feedback marks these as expected knowledge answers. Dynamo `faq-shop-benefits-turns.json` confirms multiple FAQ turns use file search. | `prompts/nodes/consultar_faq/response_contract.txt:1`, `src/runtime/openai-agent-runtime.ts:878`, FAQ/source documents used by file search | Audit FAQ source coverage and response contract. If the source already contains the answer, tighten retrieval/answer instructions. If not, update the FAQ source content after product approval for any policy-like claims. |

## Fix Together: Turn Observability For Output Regressions

This is a scalable fix for the current investigation gap: DynamoDB perf logs validate routing/state/tool behavior, but they do not preserve enough final assistant-output evidence to validate wording regressions without screenshots or PDFs.

| ID | Classification | Identified Issue | Evidence | Code References | Expected Fix |
| --- | --- | --- | --- | --- | --- |
| O12 | Objective failure | Runtime logs cannot validate final assistant wording, so repeated menus, command-like prompts, citation leaks, and tone regressions require external screenshots/PDFs. | `recap-agent-runtime-perf` stores `user_message_preview`, `user_message_hash`, state, tools, and plan summaries, but no outbound assistant preview/hash. This blocked Dynamo-only validation for repeated menu copy, "Compárteme/Envíame" wording, and `filecite` leakage. | `src/lambda/handler.ts:65`, `src/logs/trace/perf.ts:5`, `src/logs/trace/perf.ts:113`, `src/runtime/agent-service.ts:245`, `src/runtime/agent-service.ts:4021`, `src/storage/dynamo-perf-store.ts:13`, `src/runtime/config.ts:47` | Extend turn perf records with privacy-aware outbound observability: `assistant_message_length`, `assistant_message_hash`, `assistant_message_preview_redacted`, `assistant_message_quality_flags`, and `structured_message_kind`. Build this after `response.outbound.text` is finalized, run deterministic redaction for emails, phones, codes, and URLs, gate preview capture behind config, keep TTL retention, and keep full text out of perf logs unless an explicit short-retention debug mode is enabled. Add regression queries/tests that can detect repeated menu templates, command-like contact phrases, leaked citation artifacts, and empty/near-duplicate replies at scale. |

## Fix Together: System-Wide Tone And Personality

These should be solved by adding a shared assistant personality prompt that is included in every node, then lightly adjusting renderers where they hard-code cold wording.

| ID | Classification | Identified Issue | Evidence | Code References | Expected Fix |
| --- | --- | --- | --- | --- | --- |
| T1 | Tone/system-wide | Assistant feels cold, robotic, and not service-oriented enough. | PDF feedback asks for warmer, clearer, more useful responses. | `prompts/shared/output_style.txt:1`, all node response contracts | Create `prompts/shared/personality.txt` in Spanish and include it in every response node. It should define warmth, practical help, concise explanations, and proactive next-step framing. |
| T2 | Tone/system-wide | Welcome/menu structure feels isolated and mechanical. | Screenshots show repeated top-level menu blocks. | `src/runtime/openai-agent-runtime.ts:749`, `src/runtime/message-renderer.ts:49`, `prompts/nodes/contacto_inicial/response_contract.txt:1` | Update welcome response shape to greet, briefly say how it can help, present options only when useful, and include a natural closing question. Avoid repeating the same menu after the user already gave intent. |
| T3 | Tone/system-wide | Contact prompts sound command-like: "Compárteme..." / "Envíame...". | Screenshots and PDF feedback. | `src/runtime/message-renderer.ts:238`, `src/runtime/message-renderer.ts:299` | Change hard-coded contact request wording to warmer, optional-sounding Spanish while still collecting required fields. |
| T4 | Tone/system-wide | Repeated menus make the assistant feel stuck rather than adaptive. | Screenshots show similar welcome menus repeated in a short exchange. | `src/runtime/message-renderer.ts:49`, `prompts/shared/question_strategy.txt:1`, `src/runtime/openai-agent-runtime.ts:749` | Add a "no repeat menu after intent evidence" rule to shared style/question strategy and make renderers prefer contextual clarifying questions. |

## Approval-Gated Ambiguous Or Product Changes

Do not implement these until approved one by one. Some may require source-of-truth updates outside the assistant runtime.

| ID | Classification | Identified Issue | Evidence | Code References | Expected Fix If Approved |
| --- | --- | --- | --- | --- | --- |
| A1 | Approval-gated ambiguous | OXXO handling. | User explicitly said OXXO belongs in the ambiguous bucket. | FAQ/source documents, `prompts/nodes/consultar_faq/response_contract.txt:1` | Confirm the exact OXXO policy and update FAQ/source content plus tests. |
| A2 | Approval-gated ambiguous | Payment validation timing and post-payment behavior. | PDF feedback discusses payment validation expectations. | FAQ/source documents, closure/payment-related prompts if present | Confirm business policy, then encode answer in FAQ/source content and any closure guidance. |
| A3 | Approval-gated ambiguous | Benefits/discounts, Shop, live transmission, event duration, gift-list steps, customization, and list types may require product truth updates. | PDF feedback expects specific answers. | FAQ/source documents, `prompts/nodes/consultar_faq/response_contract.txt:1`, file-search configuration | Approve each product answer, then update source documents and add FAQ regression cases. |
| A4 | Approval-gated ambiguous | Rename user-facing "Bebés" category label. | PDF feedback flags label wording. | Provider/category seed data or catalog source, renderer labels | Approve replacement label and update catalog/display mapping. |
| A5 | Approval-gated ambiguous | Combine the first three top-level capabilities/options. | PDF feedback suggests menu restructuring. | `src/runtime/openai-agent-runtime.ts:749`, `src/runtime/message-renderer.ts:49` | Approve target IA, then update welcome/menu rendering and tests. |
| A6 | Approval-gated ambiguous | Ask location and budget at the start by default. | PDF feedback suggests collecting these earlier. | `src/core/sufficiency.ts:13`, `prompts/shared/question_strategy.txt:1`, node response contracts | Approve whether this should be global. If yes, update sufficiency priority and question strategy without hard keyword matching. |
| A7 | Approval-gated ambiguous | Fully handle multiple fronts at once, including potentially multiple simultaneous searches. | PDF feedback requests multi-front support. | `src/runtime/openai-agent-runtime.ts:1592`, `src/runtime/agent-service.ts:2490`, search tool orchestration | Approve UX and cost boundaries. Objective fix O7 can acknowledge/queue all fronts; simultaneous multi-search may need separate approval. |
| A8 | Approval-gated ambiguous | Distinguish "buscar/comprar marketplace" from "planificar evento" in the assistant positioning. | PDF feedback implies different expectations for marketplace shopping vs event planning. | `prompts/extractors/field_definitions.txt:16`, `prompts/extractors/field_definitions.txt:17`, welcome/menu prompts | Approve product framing, then adjust intent taxonomy, welcome copy, and FAQ/product source text. |

## DynamoDB Validation Notes

- `recap-agent-runtime-perf` had 413 rows at scan time.
- `recap-agent-runtime-plans` had 117 rows at scan time.
- Most relevant turn artifact: `artifacts/dynamo/web-chat-2026-06-17-turns.md`.
- Current perf logs validate internal routing and state problems but not exact assistant wording.
- Fix O12 should make future investigations Dynamo-first for both state regressions and output-quality regressions without depending on screenshots for every case.

## Suggested Test Coverage

- Extractor tests for event-help vs new-event planning, product FAQ vs authenticated event lookup, unknown provider names, explicit unselect/defer, and negative closure answers.
- State-machine tests for provider selection mutation, pending blocker clearing, and contact phone correction.
- Renderer tests for missing-field labels, citation artifact removal, welcome menu repetition, and contact request wording.
- Perf/observability tests for redacted outbound previews, stable outbound hashes, quality flags, TTL retention, and config-gated capture.
- FAQ regression tests for all approved product answer claims.
