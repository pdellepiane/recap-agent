# System Prompt Audit - Aug 2026 (plan-2026-08-27-rsvp-projection-prompt-audit / T4)

Status: final. Report-only artifact; remediation decisions below are the final scope for T5.
Language: English (body ASCII-only). Verbatim evidence quotes keep their original Spanish accents per the audit brief.
Date: 2026-08-27. Grading rubric: docs/plan/plan-2026-08-27-rsvp-projection-prompt-audit/rubric.md (commit 7907722).

## 1. Inputs and method

- Rubric: R01-R10 with MD1-MD5 mapping (T2, commit 7907722). Scoring per rubric section 4.
- Inventory: docs/prompt-audit/prompt-inventory.json (T3, commit 50df85d). 128 files, 29 nodes, call types classifier(2)/extraction(7 entries covering 5 profiles)/reply(119 entries), zero unmapped files. Verified against src/runtime/prompt-manifest.ts, src/runtime/prompt-loader.ts, src/runtime/openai-agent-runtime.ts, src/runtime/message-response-classifier.ts and src/runtime/agent-service.ts.
- Byte baseline: docs/prompt-audit/per-branch-baseline-78ae24e.json (T3). 38 branches, anchor 78ae24e via git show, method aligned with buildRequestMetrics (src/runtime/openai-agent-runtime.ts:411-423): instructionBytes = Buffer.byteLength(instructions), inputBytes = Buffer.byteLength(input), serializedRequestBytes = byteLength(JSON.stringify(candidate)).
- State-machine awareness: reply assembly per node (composeReply -> loadNodeBundle with informationAuthReasons projection), per-branch RSVP evidence via projectRsvpPhoneEvidenceForReply (three typed states), extraction profiles per capability set, classifier profiles general/campaign_reply, dynamic tool narrowing via resolveDynamicTools (src/runtime/dynamic-agent-policy.ts:149, filter-only, never widens the manifest).
- Current tree audited at: main after commit 50df85d. T1 change set audited at 82d48b0 (see note M2 on the registry pointer).
- Unit of grading: one row per prompt file or file group in the context of its node and call type, per rubric 4.1. Shared files get their own rows (consumed by many nodes). N/A excludes a criterion from the row denominator.

Verbatim-evidence note: quoted Spanish prompt text is preserved exactly, including accents and the original quote characters used in each file.

## 2. Architecture facts the grading relies on (verified in code)

1. Reply instructions per node = shared core (base_system, agent_personality, output_style, common_anti_patterns) + planning trio (domain_scope, domain_knowledge, flow_discipline) for 21 planning nodes + question_strategy for 6 interview/refinement nodes + node files (system, response_contract, tool_policy). src/runtime/prompt-manifest.ts:4-68,139-145.
2. Instruction assembly is state-blind for RSVP: the same node bundle is loaded for all three rsvp_phone_evidence states (prompt-branch-measurement.ts:352-374 mirrors the live loader). Only the input evidence differs per state (sample inputs 1233/1440/1080 bytes; T1 changed instruction bytes by +20 for all three states, 8233 -> 8253).
3. The min-disclosure mechanism is a working typed-discriminator precedent: PromptLoader.projectMinimumDisclosure (src/runtime/prompt-loader.ts:98-112) strips reason-keyed sections; composeReply passes informationAuthReasons derived from needs_input results (src/runtime/openai-agent-runtime.ts:297-303).
4. Reply input evidence is route- and state-conditioned: RSVP branches receive minimal snapshots (history emptied, minimal plan/extraction, rsvp_phone_evidence typed union); resolver_consultas_informativas and responder_invitacion skip capabilities and authorized-tools input lines (openai-agent-runtime.ts:855-915, 940-1000).
5. Tools are attached per node from nodePromptManifest.allowedTools and narrowed by resolveDynamicTools; nothing is filtered by prompt prose. No tool named in prose that is absent from the manifest can be called.
6. Structured contracts: extraction and classifier outputs are zod schemas with closed enums and explicit nullable/default modeling (src/runtime/extraction-schemas.ts:95-125, src/runtime/message-response-classifier.ts:29); schemas and prompts are co-versioned in git.
7. Reply requests carry input and output guardrails (jailbreak input guardrail, support-email output guardrail); user text enters as input JSON, never interpolated into instructions.

## 3. Byte table (all 38 branches, anchor 78ae24e vs current)

Serialized per buildRequestMetrics semantics; input bytes are branch-sample evidence, not user payloads. Deltas other than 0 are listed with cause. Full table: docs/prompt-audit/per-branch-baseline-78ae24e.json (`delta`, 38 rows; totals: instructions 355068 -> 353844, inputs 35449 unchanged, serialized 406190 -> 404959).

| Branch | Call | Instr 78ae24e | Instr now | Delta | Cause |
|---|---|---|---|---|---|
| accion_final_exitosa | reply | 9427 | 9427 | 0 | none |
| aclarar_pedir_faltante | reply | 11287 | 11287 | 0 | none |
| anadir_a_proveedores_recomendados | reply | 9578 | 9578 | 0 | none |
| buscar_proveedores | reply | 9859 | 9859 | 0 | none |
| busqueda_exitosa | reply | 9315 | 9315 | 0 | none |
| classifier | classifier | 9334 | 9334 | 0 | none |
| classifier:campaign_reply | classifier | 2343 | 2343 | 0 | none |
| contacto_inicial | reply | 6938 | 6938 | 0 | none |
| continua | reply | 9301 | 9301 | 0 | none |
| crear_lead_cerrar | reply | 13998 | 13998 | 0 | none |
| deteccion_intencion | reply | 6247 | 6247 | 0 | none |
| elicitacion_necesidades | reply | 14703 | 14703 | 0 | none |
| entrevista | reply | 13518 | 13518 | 0 | none |
| existe_plan_guardado | reply | 9631 | 9631 | 0 | none |
| extractor:active_plan | extraction | 11982 | 11982 | 0 | none |
| extractor:conversation_only | extraction | 2069 | 2069 | 0 | none |
| extractor:initial_planning_information | extraction | 8992 | 8992 | 0 | none |
| extractor:rsvp | extraction | 3661 | 3661 | 0 | none |
| extractor:shortlist | extraction | 11982 | 11982 | 0 | none |
| guardar_cerrar_temporalmente | reply | 9386 | 9386 | 0 | none |
| guardar_seleccion_reintentar_luego | reply | 9365 | 9365 | 0 | none |
| hay_resultados | reply | 9428 | 9428 | 0 | none |
| informar_error_reintento | reply | 6012 | 6012 | 0 | none |
| minimos_para_buscar | reply | 10585 | 10585 | 0 | none |
| necesidad_cubierta | reply | 9609 | 9609 | 0 | none |
| ofrecer_agente_humano | reply | 5825 | 5825 | 0 | none |
| recomendar | reply | 10974 | 10974 | 0 | none |
| refinar_criterios | reply | 12138 | 12138 | 0 | none |
| reintentar | reply | 9628 | 9628 | 0 | none |
| reset_plan | reply | 9832 | 9832 | 0 | none |
| resolver_consultas_informativas | reply | 14743 | 13459 | -1284 | measurement artifact, see M1; prompt files unchanged since 78ae24e |
| responder_invitacion:needs_event_selection | reply | 8233 | 8253 | +20 | T1 typed-state guidance (justified, logged) |
| responder_invitacion:resolved_single | reply | 8233 | 8253 | +20 | T1 typed-state guidance (justified, logged) |
| responder_invitacion:unavailable | reply | 8233 | 8253 | +20 | T1 typed-state guidance (justified, logged) |
| seguir_refinando_guardar_plan | reply | 11295 | 11295 | 0 | none |
| solicitar_agente_humano | reply | 6785 | 6785 | 0 | none |
| usuario_elige_proveedor | reply | 9898 | 9898 | 0 | none |
| usuario_responde | reply | 10701 | 10701 | 0 | none |

Real prompt-content deltas since the anchor are exactly T1's: prompts/nodes/responder_invitacion/system.txt 1367 -> 1345 (-22) and response_contract.txt 1242 -> 1284 (+42), net +20 per branch, justified and logged in docs/implementation-log.md. Net direction across all branches: -1224 bytes, of which -1284 is the M1 artifact; real direction is +60 instructions, justified by the three-state guidance replacing a broad rule that produced the Paolo & Mariana defect.

## 4. Grading matrix

Criteria per rubric R01-R10. R08 is graded only where an extraction/classifier contract exists; R09 only for prompts changed since the anchor. "tp-group" is the 24 transition_policy.txt files treated as one row because none is consumed by any loader.

| Row (files) | Node(s)/call | R01 | R02 | R03 | R04 | R05 | R06 | R07 | R08 | R09 | R10 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| shared/base_system.txt | all reply | pass | pass | N/A | pass | N/A | pass | pass | N/A | N/A | partial |
| shared/agent_personality.txt | all reply | pass | pass | N/A | pass | N/A | pass | pass | N/A | N/A | pass |
| shared/domain_scope.txt | all reply | pass | partial | N/A | partial | N/A | pass | pass | N/A | N/A | pass |
| shared/domain_knowledge.txt | 21 planning nodes | pass | pass | N/A | pass | N/A | pass | pass | N/A | N/A | pass |
| shared/output_style.txt | all reply | pass | pass | N/A | pass | N/A | pass | pass | N/A | N/A | partial |
| shared/flow_discipline.txt | 21 planning nodes | pass | pass | N/A | pass | N/A | pass | pass | N/A | N/A | pass |
| shared/question_strategy.txt | 6 question nodes | pass | pass | N/A | pass | N/A | pass | pass | N/A | N/A | pass |
| shared/common_anti_patterns.txt | all reply | pass | pass | N/A | pass | N/A | pass | pass | N/A | N/A | pass |
| deteccion_intencion/response_classifier.txt | classifier general | pass | pass | N/A | pass | pass | pass | pass | pass | N/A | partial |
| deteccion_intencion/response_classifier_campaign.txt | classifier campaign | pass | pass | N/A | pass | pass | pass | pass | pass | N/A | pass |
| extractors/base_system.txt | 5 profiles | pass | pass | N/A | pass | N/A | pass | pass | pass | N/A | pass |
| extractors/planning.txt | planning/shortlist profiles | pass | pass | N/A | pass | N/A | pass | pass | pass | N/A | pass |
| extractors/information.txt | information profiles | pass | pass | pass | pass | N/A | pass | pass | pass | N/A | pass |
| extractors/rsvp.txt | rsvp profile | pass | pass | pass | pass | N/A | pass | pass | pass | N/A | pass |
| extractors/provider_management.txt | provider profiles | pass | pass | N/A | pass | N/A | pass | pass | pass | N/A | pass |
| extractors/contact.txt | contact-enabled profiles | pass | pass | N/A | pass | N/A | pass | pass | pass | N/A | pass |
| extractors/close_pause.txt | close/pause profiles | pass | pass | N/A | pass | N/A | pass | pass | pass | N/A | pass |
| nodes/contacto_inicial/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | partial |
| nodes/deteccion_intencion node files | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/existe_plan_guardado/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/reset_plan/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/entrevista/* | reply | pass | pass | N/A | pass | partial | pass | pass | N/A | N/A | partial |
| nodes/elicitacion_necesidades/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/minimos_para_buscar/* | reply | pass | partial | N/A | pass | pass | pass | pass | N/A | N/A | partial |
| nodes/aclarar_pedir_faltante/* | reply | pass | pass | N/A | pass | partial | pass | pass | N/A | N/A | pass |
| nodes/usuario_responde/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/buscar_proveedores/* | reply | pass | pass | N/A | pass | partial | pass | pass | N/A | N/A | pass |
| nodes/busqueda_exitosa/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/hay_resultados/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/recomendar/* | reply | pass | pass | N/A | pass | partial | pass | pass | N/A | N/A | pass |
| nodes/refinar_criterios/* | reply | pass | pass | N/A | pass | partial | pass | pass | N/A | N/A | pass |
| nodes/usuario_elige_proveedor/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/anadir_a_proveedores_recomendados/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/seguir_refinando_guardar_plan/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/continua/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/accion_final_exitosa/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/necesidad_cubierta/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/crear_lead_cerrar/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/guardar_seleccion_reintentar_luego/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/guardar_cerrar_temporalmente/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/ofrecer_agente_humano/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/solicitar_agente_humano/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/informar_error_reintento/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/reintentar/* | reply | pass | pass | N/A | pass | pass | pass | pass | N/A | N/A | pass |
| nodes/resolver_consultas_informativas/* | reply (3 auth branches) | pass | pass | pass | pass | pass | pass | pass | N/A | N/A | partial |
| nodes/responder_invitacion/* | reply (3 rsvp states) | pass | pass | fail | pass | pass | pass | pass | N/A | partial | partial |
| 24 transition_policy.txt (unwired) | none | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | fail |

R03 on extractors/information.txt and extractors/rsvp.txt: pass because the enumerated branches (authentication_status actions, plan.rsvp_state awaiting_action/awaiting_event_selection) are all reachable at extraction time and keyed on typed state already present in the extraction input; no branch is unreachable from the profile.
R09 on responder_invitacion: partial. Byte before/after recorded (T1 log, +20), live case live_behavior.rsvp_paolo_mariana_resolved_single registered with hard structural + text_semantic requireJudge:true, offline twin tests/rsvp-three-state-projection.test.ts exists; a per-branch instruction-content absence regression (resolved_single instructions must not contain selection guidance) does not exist yet and cannot pass until F1 lands; T5's AC already mandates it.

Node roll-up (rubric 4.3: node needs fix if >=1 fail or >=2 partials): needs fix = responder_invitacion (1 fail, 1 partial), entrevista (2 partials). All other graded units carry at most one partial. Overall: 46 rows graded, 31 pass, 13 partial, 2 fail.

## 5. Findings and remediation decisions

Categories: duplicate | conflict | irrelevant | underspecified | bloat. Findings that would require RSVP redesign or reopening paths closed in 78ae24e: none (checked explicitly; F1/F8 edit only reply-prompt text and assembly of already-typed state, no projection redesign, no parser/gateway/COD/phone-scoped-retrieval changes).

### F1 (fail; R03; category: irrelevant) responder_invitacion reply, all 3 states

Evidence (prompts/nodes/responder_invitacion/system.txt:5, current):
"Usa exclusivamente rsvp_phone_evidence.state. Si es resolved_single, informa solo ese evento y su estado y no pidas elegir entre invitaciones. Si es needs_event_selection, presenta solo los candidatos de ese estado y formula una sola pregunta. Si es unavailable, explica el estado sin inventar una actualización."
Evidence (prompts/nodes/responder_invitacion/response_contract.txt:12):
"Si rsvp_phone_evidence.state es needs_event_selection, enumera solo los candidatos de ese estado y formula una sola pregunta. Si es resolved_single, no enumeres otros eventos."
Bytes: instruction bytes identical across the three states (8253 each), so resolved_single still receives selection guidance for a branch its typed state excludes, and unavailable still receives enumeration guidance. Input evidence is correctly split (candidates exist only in needs_event_selection; tests/rsvp-three-state-projection.test.ts:22,61). This is exactly the rubric R03 exemplar violation: "resolved_single carries no candidate array and no selection instruction". T1 replaced two broad lines with two lines that still enumerate all three states in prose.
Decision: route-specific section. Deterministic per-state section selection keyed on rsvp_phone_evidence.state in assembly, mirroring the existing informationAuthReasons mechanism (prompt-loader.ts:98-112 + openai-agent-runtime.ts:297-303). Note for T5r: this requires passing the rsvp projection state into PromptLoadContext in composeReply; it is prompt-assembly wiring for an existing typed state, not a state-machine change and not new evidence.
Bytes: the three-state spans are 315 B (system line) + 177 B (contract line); per-state single-clause versions save ~118 B per branch, ~-354 B total. Net reduction; no global rule added.
Eval linkage: behavior-affecting; covered by the 12-case RSVP gate-2 re-validation subset; T5 registers its own entry per plan decision (reuse of live_behavior.rsvp_paolo_mariana_resolved_single is acceptable only with exact coverage of the new per-state guidance; otherwise a new case ID is required). Offline twin: extend the relevance regression to assert instruction content per state.

### F2 (partial; R10; category: duplicate) resolver_consultas_informativas, OTP/email guidance duplicated across system.txt and response_contract.txt

Evidence pairs (system.txt vs response_contract.txt, near-verbatim):
- otp_sent: "Cuando `guidance.reason` sea `otp_sent` u `otp_resent`, di de forma directa: "Te envié un código a [correo]. Cópialo y pégalo aquí". Explica brevemente que no puedes leer imágenes ni capturas." vs "Si acabas de enviar o reenviar el código (`otp_sent` u `otp_resent`), responde de forma breve: "Te envié un código a [correo]. Cópialo y pégalo aquí". Di que no puedes leer imágenes ni capturas." (min-disclosure blocks 345 B vs 348 B)
- otp_pending: 218 B vs 217 B blocks, same instruction ("pide el código ... bandeja principal o en correo no deseado").
- email_required: 414 B vs 414 B lines, same rule including the "la información de tu cuenta" verbatim-quote requirement.
- bandeja: "Nunca menciones una bandeja de promociones ni supongas que la persona usa Gmail u otro proveedor específico." (111 B) vs "No menciones promociones, Gmail, Outlook ni ninguna bandeja o función propia de un proveedor de correo." (106 B).
Bytes: when an auth reason fires, the fired guidance is sent twice. Measured duplication: otp_sent -565 B, otp_pending -437 B, otp_invalid -156 B, email path -414 B, bandeja -106 B.
Decision: deletion. Keep each rule once; recommended home: response_contract.txt keeps the three min-disclosure OTP blocks (they are output-shaping), system.txt keeps the email_required and bandeja rules; delete the duplicated twins. Net reduction, no behavior change intended; verify with the offline min-disclosure projection test and one live OTP-path case.
Eval linkage: behavior-affecting when OTP reasons fire; register an entry and rely on existing OTP-path live coverage only with exact coverage; otherwise a new case ID.

### F3 (partial; R05; category: irrelevant) tool_policy.txt files forbid tools that are not attached

Evidence:
- nodes/entrevista/tool_policy.txt: "no uses search_providers_from_plan, search_providers_by_keyword ni search_providers_by_category_location en este nodo." (120 B) while manifest allowedTools = [list_categories, get_category_by_slug, list_locations].
- nodes/aclarar_pedir_faltante/tool_policy.txt: same pattern (107 B).
- nodes/refinar_criterios/tool_policy.txt: same pattern (156 B).
- nodes/buscar_proveedores/tool_policy.txt: "no uses list_categories ni list_locations para improvisar entrevista aquí." (77 B) while those tools are not attached.
- nodes/recomendar/tool_policy.txt: "no lances una nueva búsqueda desde este nodo" (~50 B) while no search tool is attached.
Bytes: ~-510 B total. MD2: instructions for tool calls that cannot occur.
Decision: deletion. Not behavior-affecting (the model cannot call unattached tools; resolveDynamicTools only narrows). Keep the usage-rule lines for attached tools; keep the dynamic input line "Herramientas autorizadas en este nodo" (it reflects the runtime-resolved surface, which can be narrower than the manifest; not redundant).

### F4 (fail; R10; category: irrelevant) 24 transition_policy.txt files are wired to nothing

Evidence: src/audit/prompt-inventory.ts:150-160 records them as "orphaned: not in nodePromptManifest"; no reference outside src/audit and tests; nodePromptManifest buildNodeFiles includes only system.txt, response_contract.txt, tool_policy.txt (prompt-manifest.ts:139-145). 24 files, 4755 B on disk, 0 B in any serialized request. Their content duplicates live rules elsewhere (example: nodes/deteccion_intencion/transition_policy.txt "Una frase sobre haber enviado un regalo no abre ni cierra un plan." duplicates live rules in response_classifier.txt and extractors/information.txt and extractors/close_pause.txt) and will drift.
Decision: deletion. Zero runtime byte impact; no eval implications (never sent to a model); repo hygiene only. Note: the inventory marks these rows isOrphaned:false while labeling their transition "(orphaned: not in nodePromptManifest)"; if T5 keeps any as design docs they must be moved out of prompts/, otherwise the inventory's zero-unmapped claim stays true but misleading.

### F5 (partial; R02/R04; category: irrelevant) shared/domain_scope.txt carries information-route scope in a file shipped to all 29 reply bundles

Evidence (shared/domain_scope.txt, included for every reply node):
"consultar eventos asociados a la cuenta después de verificar primero el número actual de WhatsApp o, como respaldo, el correo con código de un solo uso;" (158 B)
"consultar órdenes recientes o una orden específica después de verificar primero el número actual de WhatsApp o, como respaldo, el correo con código de un solo uso;" (171 B)
"consultar detalles de regalos comprados, incluidos pago, dedicatoria, tarjeta física, envío y agradecimiento, cuando esos datos estén disponibles;" (152 B)
plus purchase-specific exclusions ("modificar órdenes, pagos, dedicatorias, envíos o agradecimientos;" 70 B, "resolver retiros, finanzas del anfitrión o disputas de propiedad;" 69 B, "cerrar pagos o contratos;" 28 B).
These routes are unreachable at non-information nodes: the classifier routes information queries to resolver_consultas_informativas, whose node files carry the full auth/scope contract. ~734 B of route-specific text ships in every bundle; ~-19 KB aggregate across the 27 non-information-route branches.
Decision: route-specific section. Move the information-route scope lines into a section consumed only by resolver_consultas_informativas (and only where the resolver bundle needs them), reusing the min-disclosure-style gating or a dedicated shared file wired to that node. Eval linkage: behavior-affecting on many nodes; register an entry with a live case exercising a mid-plan information request to prove routing is unchanged.

### F6 (partial; R10; category: duplicate) response_classifier.txt restates the corporate-reception rule

Evidence: the high-confidence generic corporate reception is defined twice; the second restatement ("Para esa recepción corporativa genérica posterior a un mensaje `outbound`, devuelve obligatoriamente `action: suppress_automated_response`, `reason: automated_response` y `automation_confidence: high`. No devuelvas `respond` solo porque la plantilla termina con una pregunta genérica; contestarla iniciaría una conversación bot-a-bot.", 289 B span) repeats what the first paragraph plus decision-priority item 2 already mandate.
Decision: deletion. Merge the non-redundant clause (no reply to generic closing questions) into the first definition and priority item. Behavior-affecting (classifier suppression); register an entry; the campaign classifier is unaffected.

### F7 (partial; R10; category: duplicate) welcome contract duplicated between contacto_inicial and entrevista

Evidence: nodes/contacto_inicial/response_contract.txt (943 B) and the welcome branch of nodes/entrevista/response_contract.txt (720 B) specify the same type=welcome shape with the same word limits ("greeting_es ... hasta 12 palabras", "scope_es ... hasta 18 palabras", "ask_es ... hasta 8 palabras") in paraphrased wording.
Decision: keep-with-reason. A single shared welcome section would require wiring a new shared file into prompt-manifest for two nodes, which exceeds T5's stated runtime-code scope ("runtime code changes only where a typed-state replacement requires new projected evidence"); the duplication is bounded, the per-node wording already differs intentionally (first contact vs re-opening), and drift risk is low. Typed state cannot carry it: the welcome shape is an output contract, not runtime evidence.

### F8 (partial; R10; category: duplicate) pending-state question duplicated inside responder_invitacion

Evidence: system.txt "Si la invitación está pendiente y la persona aún no indicó una decisión, pregunta de forma breve si desea confirmar su asistencia." vs response_contract.txt "Si la invitación está pendiente, dilo claramente y, si todavía no expresó su decisión, pregunta si desea confirmar su asistencia." (~150 B contract line, ~80% overlap).
Decision: deletion. Drop the contract line and keep the system rule (which fully covers the pending question); fold into F1's edit of the same files and gate subset. ~-150 B per RSVP branch.

### F9 (partial; R02/R10; category: underspecified) minimos_para_buscar contract wording

Evidence: nodes/minimos_para_buscar/response_contract.txt: "si se hablara con el usuario, enfocarse solo en el faltante crítico." Grammatically off and vague about when this node produces user-visible text. Same node rarely surfaces user-facing prose (internal validation step), so impact is bounded.
Decision: keep-with-reason. Cosmetic-only edit; low value relative to the churn of registering a behavior-change entry; revisit only if this node's replies surface in live traces. Typed state cannot carry it: whether the node produces user text is not currently a typed discriminator.

### M1 (measurement artifact; not a prompt finding) -1284 bytes on resolver_consultas_informativas is not a real change

Evidence: prompts/nodes/resolver_consultas_informativas/system.txt and response_contract.txt are byte-identical between 78ae24e and HEAD (git diff 78ae24e..HEAD -- prompts/ touches only responder_invitacion). The measured -1284 equals exactly the min-disclosure OTP blocks (system 563 B + contract 721 B): the current-side measurement loads the bundle with an empty informationAuthReasons set (prompt-branch-measurement.ts measureCurrentBranches -> loadNodeBundle with no context), stripping all gated sections, while the historical side reconstructs raw git-show content with all gated sections present. Correct comparison: 14743 raw vs 14743 raw (0 real delta).
Required T5 action (not one of the four prompt decisions): make measureHistoricalBranches apply the same projection (or measure both sides raw) and add a parity test, so T5's after-table is honest.

### M2 (registry traceability; not a prompt finding) implementedBy points to a commit not on main

Evidence: evals/live-behavior-coverage.yaml entry project-rsvp-phone-evidence-as-three-state has implementedBy: "86a5b3a"; 86a5b3a is a dangling sibling of 82d48b0 (same parent 3a1b116, same message, differs only by the registry line itself and one eslint comment) and is not an ancestor of main. The mainline T1 commit is 82d48b0.
Required T5 action: point implementedBy at 82d48b0 during T5's registry pass. Not behavior-affecting.

### Categorization check required by the brief (RSVP branches)

The three typed states are properly projected in evidence (resolved_single carries a single event and omits candidate arrays; candidates only in needs_event_selection; unavailable carries reason; records without event identity rejected; deterministic sort; verified in contracts.ts:86-121, agent-service.ts T1 change, and the offline twin). What remains is residual conditional instruction guidance duplicating what typed state now carries (F1, F8), which is exactly the class T5 exists to remove. No conflict-category finding was found anywhere in prompts/ (cross-file normalized duplicate scan found one benign shared line "Responde usando paragraphs_es para el contenido principal" in 3 files; within-file contradiction scan found none).

## 6. Node roll-up and overall pass rate

- Nodes needing fix: responder_invitacion, entrevista. All other graded units pass the roll-up rule.
- Criterion pass rates over applicable cells (excluding N/A): R01 46/46, R02 44/45, R03 4/5, R04 44/45, R05 36/40 (4 partial via F3/F6-class prose, classifier rows pass by code-level filtering), R06 46/46, R07 46/46, R08 8/8, R09 0/1 (partial), R10 31/46.
- Overall verdict: warning. Two material items (F1 behavioral, F4 hygiene), all with concrete remediations and no blockers for the T5 batch.

## 7. Ordered remediation backlog for T5 (high-value / low-risk first)

| # | Item | Decision | Target files | Est. bytes | Registry / live-case implication |
|---|---|---|---|---|---|
| 1 | F4 delete dead transition_policy files | deletion | 24 prompts/nodes/*/transition_policy.txt | 0 runtime (-4755 B repo) | none (never sent) |
| 2 | F2 resolver OTP/email dedupe | deletion | resolver_consultas_informativas system.txt + response_contract.txt | -437..-565 per fired OTP reason; -414 email path | behavior-affecting when OTP fires; new/exact-coverage entry; offline projection twin |
| 3 | F1 + F8 RSVP per-state sections | route-specific section + deletion | responder_invitacion system.txt, response_contract.txt, prompt-loader.ts, openai-agent-runtime.ts (assembly context) | -504 total (-168/branch incl. F8) | covered by gate-2 12-case RSVP re-validation; register T5 entry with exact coverage check |
| 4 | F3 remove forbids of unattached tools | deletion | entrevista, aclarar_pedir_faltante, refinar_criterios, buscar_proveedores, recomendar tool_policy.txt | ~-510 | not behavior-affecting (tools uncallable) |
| 5 | F5 information-route scope out of shared file | route-specific section | shared/domain_scope.txt (+ gating or new shared file for resolver_consultas_informativas) | ~-734 B per non-information branch (~-19 KB aggregate) | behavior-affecting; new entry + live mid-plan information request case |
| 6 | F6 classifier consolidation | deletion | deteccion_intencion/response_classifier.txt | ~-289 | behavior-affecting (classifier); new entry |
| 7 | M1 fix historical projection parity in tooling | tooling fix | src/audit/prompt-branch-measurement.ts + tests | n/a | none |
| 8 | M2 registry implementedBy pointer | metadata fix | evals/live-behavior-coverage.yaml | n/a | none |
| 9 | F7 welcome dedupe | keep-with-reason (documented) | none | 0 | none |

Batchability: all items fit one deploy. F1/F8 and F5 both touch responder_invitacion's bundle but are gated by the same 12-case RSVP subset, so no live-case masking; F5 and F2 both touch resolver's bundle, likewise gated together. No item requires RSVP redesign or reopens 78ae24e paths (parser/gateway incl. optional increment_id, COD301816 normalization, phone-scoped retrieval all untouched). Every proposed change reduces bytes; no new global rules; no keyword-matching fixes; conversational additions/removals stay Spanish.

Net expected delta per call type if the backlog lands: classifier ~-289 B; extraction 0 B; reply: -168 B/RSVP branch, -437..-565 B on OTP-firing information turns (plus -414 B email path), ~-510 B across 5 planning branches, ~-734 B per non-information branch (F5). Direction: net reduction on every changed call; no increase proposed.

## 8. Per-branch relevance proof status

- Input evidence per RSVP state: proven by tests/rsvp-three-state-projection.test.ts (resolved_single has no candidates; candidates only in needs_event_selection; deterministic ordering; identity rejection) and minimal snapshot assembly (openai-agent-runtime.ts:940-1000).
- Instruction-side per-state relevance: not yet provable; F1 is the prerequisite, and T5's relevance regression must assert, per state, absence of the other states' guidance and presence of its own.
- min-disclosure per-reason projection: proven by tests/prompt-loader.test.ts:141-184 for otp_sent/otp_resent/otp_invalid/otp_pending selection and stripping.

## 9. Spanish-language check

All conversational prompt content in prompts/ is Spanish. English tokens are limited to typed field and enum names (rsvp_phone_evidence.state, attending, declining, guest_id, orderId, guidance.reason, etc.), which output_style.txt explicitly authorizes ("los campos semánticos internos (acciones, tipos de mensaje) usan enums en inglés"). No finding. Cosmetic note: T1 normalized smart quotes to straight quotes in responder_invitacion/response_contract.txt while older files keep curly quotes; harmless and not tracked as a finding.

## 10. What could not be verified, and why

1. Live-equivalent serialized instruction bytes per informationAuthReason (otp_sent/otp_resent/otp_pending/otp_invalid) for the current tree: the offline tooling measures only the empty-reason projection; per-reason totals were computed analytically from block sizes (563+721 B raw; 345/218/0 and 348/217/156 B per block) and can be confirmed only by extending M1's tooling or from live request metrics on the deployed Lambda.
2. Which SHA the author intended for implementedBy (82d48b0 assumed correct since it is the mainline commit; intent itself is unverifiable from the repo).
3. Whether transition_policy.txt files were consumed by any loader at any point in history (out of bounded scope; the current and anchor states were verified unwired, which is what the rubric grades).
4. Semantic model behavior after remediation (F1/F2/F5/F6): static grading per rubric only; live gate 2 validates behavior.
5. docs/implementation-log.md T3 entry states the unavailable RSVP sample input as 1180 bytes; the committed artifact records 1080. The artifact (committed measurement) was trusted; the log line appears to be a typo. No audit conclusion depends on it.

## 11. Out-of-scope flags (per plan decision; not planned)

- Any change to the RSVP projection contract itself (three states, candidate omission, identity rejection) beyond prompt-assembly wiring of the existing state: would be an RSVP redesign.
- Any change touching paths closed in 78ae24e: parser/gateway (including optional increment_id), COD301816 normalization, phone-scoped retrieval.
- Renaming any state-machine node.
