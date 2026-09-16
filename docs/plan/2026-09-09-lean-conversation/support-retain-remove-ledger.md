# Support retain/remove ledger

Scope: every dropped resolver, responder, entrevista, recomendar, close,
deteccion and shared instruction section after the compiler migration.
Each row ends in exactly one disposition:

- retain: registry module id, tracked file, and turn applicability.
- remove: reason (duplicate, structural, or provenance).
- evidence-only: projector function and pinning tests (facts travel in the
  model input, never as instruction prose).

Mapping rule: a file counts as mapped only when a registry module loads it
on some applicable turn. Retired node contracts stay on disk for audit
measurement via PromptLoader.loadNodeBundle; their executable tool scope
lives in prompt-manifest.ts allowlists, never in their prose.

## 1. resolver_consultas_informativas/response_contract.txt (retired file)

| Section | Disposition |
|---|---|
| L1 paragraphs_es shape | remove, structural. Output shape is owned by structured-message schemas and model-composition, not prompt prose. |
| L3 completed-only factual source | evidence-only. projectInformationResultForReply projects only completed results; tests/runtime-actual-request.test.ts mixed faq plus purchase turn. |
| L4 FAQ empty-evidence limitation | retain. Input pointer faq_empty_note in openai-agent-runtime.ts buildReplyInputParts, gated on completed FAQ with empty evidence; tests/runtime-actual-request.test.ts faq-empty test. Covers B1 FAQ L4-6 fragment (empty clause). |
| L5 numeric FAQ values verbatim | evidence-only. projectCompletedPurchaseForModel disclosures plus numeric preservation; tests in runtime-relevance.test.ts and live-behavior-coverage preserve-complete-numeric-faq-evidence. Covers B1 FAQ L4-6 fragment (numeric clause). |
| L6 associated_event uses result.events only | evidence-only. Venue projection strips guestStatus and keeps events; tests/runtime-actual-request.test.ts venue facts test. Covers B1 provenance L6 fragment. |
| L7 purchase detail completeness vs explicit single-datum brevity | evidence-only. projectCompletedPurchaseForModel outcome plus permitted aspects; runtime-relevance purchase projection tests. |
| L8 no invented causes for pending/rejected payments | remove, duplicate. Covered by shared/common_anti_patterns.txt (no inventes, no definitive promises) loaded on every turn via shared_invariants. |
| L9 Yape destination only on pending purchase with destinationAccount | evidence-only. Purchase projection carries paymentStatus and destinationAccount; response_contract retired wording not reloaded. |
| L10 shipping only with shippingStatus/sendPhysical | evidence-only. Same purchase projection; live_behavior.nonphysical_purchase_omits_shipping. |
| L11 COD naming, never internal orderId | evidence-only. stripTransactionIdForModel plus reference_status projection; tests/runtime-relevance.test.ts strips-transaction test and live entry transaction-strip-model-request. Covers B1 tx-ID fragment. |
| L12 reference_status and purchase_selection single question | evidence-only. reference_status plus missing_inputs purchase_selection in projectCompletedPurchaseForModel. Covers B1 tx-ID fragment. |
| L13 nextInput single next datum | evidence-only. nextInput/guidance projection; needs_input results carry nextInput. |
| L14 phone-first auth, no email on phone_auth_failed | evidence-only. Auth guidance requirements projection; guidance.requirements rendered from typed state. |
| L15 guidance.requirements all mandatory | evidence-only. Requirements travel in turn evidence; min-disclosure projection in prompt-loader for otp branches. |
| L16-18 otp_sent/otp_resent min-disclosure branch | retain. Unchanged min-disclosure markers in the retired contract measured by audit only; production OTP branches project via guidance.requirements. tests/prompt-loader.test.ts omits-irrelevant-outcome test. |
| L19-20 otp_pending branch | retain, same as L16-18. |
| L22-24 otp_invalid branch | retain, same as L16-18. |
| L25 completed plus blocked ordering | evidence-only. Completed and blocked outcomes compose in turn evidence; reply_support_continuity acknowledges pending seconds; tests/model-request-projector.test.ts handoff-composes test. Covers B1 completed+blocked fragment. |
| L26 all-blocked single next step | evidence-only. guidance/message projection; operational-note omission predicate replyOmitsOperationalNote. Covers B1 completed+blocked fragment. |
| L27 unavailable purchase route single next step | evidence-only. Capability outcome plus handoff outcome projection. |
| L28 ambiguity single question unless evidence resolves | evidence-only plus input pointer ambiguity_note; ambiguityAnsweredByProjectedEvidence. tests cover resolved-image and completed-result exemptions. Covers B1 ambiguity fragment. |
| L29 subtitles only for multi-topic | remove, structural. Brevity shape owned by shared/output_style.txt via shared_invariants. |
| L30 no transaction/bank identifiers unless projected | evidence-only. stripTransactionIdForModel; runtime-relevance strips test. Covers B1 tx-ID fragment. |
| L31 validation_window/payment_status aspect binding | evidence-only plus retain boundary. Requested aspects gate projection via disclosures.permitted_aspects; the receipt guard is retained in approval_limits.txt via reply_approval_boundary (approvalBoundary from requested aspects). tests/runtime-actual-request.test.ts approval test. Covers B1 grounding fragment. |
| L32 abandoned cart state/event/recovery only | evidence-only. Cart/order outcome projection in purchase-reply-projector. Covers B1 cart/order fragment. |
| L33 cart and order are distinct records | evidence-only. outcome_kind order_plus_cart distinction in purchase-reply-projector. Covers B1 cart/order fragment. |
| L34 capability_outcome state plus allowed next step | evidence-only. checkReplyNarrativeClaims plus capability outcome projection. |
| L35 answer current task, acknowledge pending second | evidence-only plus retain continuity. reply_support_continuity carries pending task; multi-request retention covered by actual-request mixed test. Covers B1 multi-request fragment. |
| L36 pending stays pending | retain. support_continuity.txt core paragraph via reply_support_continuity on purchase/venue/rsvp/faq_policy/handoff/auth/image turns. Covers B1 next-step fragment. |
| L37 image no-resend rule with URL alternative | retain, narrowed. Resend/URL ban sentence retained verbatim in image_limits.txt via reply_image_context (image task only); forward-looking resubmission invitation banned per native-context-rsvp-audit-2026-09-14. tests/runtime-actual-request.test.ts image test. Covers B1 image-rules fragment. |
| L38 receipt-is-not-proof plus URL/native/file pixel receipts | retain, split. Receipt core sentence retained verbatim in approval_limits.txt via reply_approval_boundary (purchase validation/payment-status aspects); image-conditional describe rule retained verbatim in image_limits.txt via reply_image_context. Covers B1 image-rules and receipt fragments. |
| L39 URL voucher without question, no unsolicited description | retain. Retained verbatim in image_limits.txt via reply_image_context. Covers B1 image-rules fragment. |
| L40 never disclose image links or access params | retain. Retained verbatim in image_limits.txt via reply_image_context. Covers B1 image-rules fragment. |
| L41 authentication_outcome real access plus human-support result | retain, split. Auth-outcome sentences retained verbatim in auth_limitation.txt via reply_auth_limitation (validated terminal/declined/scoped-miss only); public remainder answered from evidence via faq/purchase modules. Covers B1 auth-terminal framing fragment. |
| L42 total is order total, remaining always null | evidence-only. remaining null plus remainingVerifiable false in purchase projection; runtime-relevance unknown-paid test. Covers B1 unknown-paid L42 fragment. |
| L43 currency only when recorded, method beside amount | evidence-only. amountDisclosure presentation explicit_currency; user-correction framing in projection. |
| L44 cart never carries pending payment or amount | evidence-only. Cart/order recordType distinction in purchase projection. Covers B1 cart/order fragment. |
| L45 customer_context single-use scoping | evidence-only. Single canonical customer_context block; tests/runtime-actual-request.test.ts single-copy test. Covers B1 shape fragment. |
| L46 purchase_selection candidate framing | evidence-only. Selection candidates with event/date/amount/status in projection. |
| L47 user corrections as reported data, no local-time claims | evidence-only. User-reported provenance separate from record facts in purchase projection. Covers B1 grounding fragment. |
| L48 two exact times, registered hour only | evidence-only. Time-alternative framing in projection; no conversion. |
| L49 terminal auth outcome wording | retain. Retained verbatim in auth_limitation.txt via reply_auth_limitation. Covers B1 auth-terminal fragment. |
| L50 declined with no_further_credential_requests wording | retain. Same as L49. Covers B1 auth-terminal fragment. |
| L51 scoped_phone_search_miss wording | retain. Same as L49. Covers B1 auth-terminal fragment. |

## 2. resolver_consultas_informativas/system.txt (retired file)

| Section | Disposition |
|---|---|
| L1-6 single-turn read-only objective, sources, no reclassification | remove, structural. Compiler ownership (deriveReplyCompilerContext plus selectReplyModules) replaces node self-description; lane identity travels in turn evidence. |
| L7 phone-confirmation question shape | evidence-only. phoneConfirmation typed extraction plus guidance requirements. Covers B1 node-specifics fragment. |
| L8 email/code as fallback after negative response | evidence-only. Auth guidance reason machine (email_required, email_change_required). |
| L9 guidance.requirements mandatory content | evidence-only. Same as contract L15. |
| L10 email wording must keep la información de tu cuenta | evidence-only. Requirement content travels in guidance.requirements facts. |
| L11 no advance full order/selection walkthrough | remove, duplicate. Minimum-disclosure projection (one next step) plus shared/flow_discipline.txt via reply_planning_owner on planning turns. |
| L12 automatic phone auth, email only when no account or explicit rejection | evidence-only. Auth control decision in extraction_information (auth_control.txt) plus orchestrator. |
| L13 no promos inbox, no provider guessing | remove, duplicate. Shared anti-patterns via shared_invariants. |
| L14 order number never substitutes email verification | evidence-only. Auth decision projection; never a credential. |
| L15 no technical words, fixed Spanish phrasings | remove, structural. shared/output_style.txt owns voice; model-written invariant forbids canned sentences. |
| L16 completed first, one next step | evidence-only. Same as contract L25-26. |
| L17 no provider recommendations or plan edits | evidence-only. Tool scoping (support turns expose no tools) plus selectReplyTools; B5 tool-guidance regression pins scopedTools empty on support turns. |
| L18 no invented purchase/payment/dedication/shipping/delivery states | remove, duplicate. Shared anti-patterns via shared_invariants. |
| L19 gifts allowed after auth, never a general refusal | evidence-only. Capability boundary plus auth outcome projection. |
| L20 host modifications, withdrawals, host finance, ownership disputes are not reads | evidence-only. hostWithdrawalPolicy projection (policy plus individualStatus not_available) plus human_support next action. Covers B1 host-modification fragment. |
| L21 order data only from kind=purchase | evidence-only. Source-tagged projections; event payload order data ignored. |
| L22 no internal names (capabilities, JSON, tools, vector stores) | remove, duplicate. shared/output_style.txt via shared_invariants. |
| L23 user data only from visible turn record, explicit target wins, never mix events | evidence-only. Turn evidence plus customer_context scoping. Covers B1 grounding fragment. |
| L24 72h window kept when projected | evidence-only. informationValidationPolicyRequestId projection (maxBusinessHours 72, source indexed_knowledge_base); general timing never proves individual arrival per host-withdrawal parser. Covers B1 email fragment. |
| L25 multi-request advancement | evidence-only. Same as contract L35. Covers B1 multi-request fragment. |

## 3. resolver satellite files

| File | Disposition |
|---|---|
| auth_control.txt | retain. extraction_information module via OpenAiAgentRuntime.extract (extraction-decision guidance only). |
| image_inspection.txt | retain. loadImageBundle via inspectImage explicit-describe-only fallback (production image model call, never the reply call). |
| tool_policy.txt (no conversational tools; reads already executed) | remove, structural. Rule restated executably: selectReplyTools exposes no generation-stage tools off planning lanes; node allowlists in prompt-manifest.ts remain the tool-scope source. |
| support_continuity.txt (continuity paragraphs only) | retain. reply_support_continuity on purchase/venue/rsvp/faq_policy/handoff/auth/image turns with customer_assistance or unknown owner. |
| auth_limitation.txt (new, verbatim L49-51 equivalent) | retain. reply_auth_limitation on validated terminal/declined/scoped-miss outcomes only. |
| image_limits.txt (new, verbatim resend/URL/description/link bans) | retain. reply_image_context on image task only. |
| approval_limits.txt (new, verbatim receipt sentence) | retain. reply_approval_boundary on purchase validation/payment-status aspects only. |

## 4. responder_invitacion (retired contracts)

| Section | Disposition |
|---|---|
| system L3-5 phone-scoped RSVP, projected state only | evidence-only. projectRsvpPhoneEvidenceForReply plus rsvpPhoneEvidence state machine; no email/code on RSVP reads. |
| system L7 full model-written reply from evidence, mutation honesty | evidence-only. RSVP evidence states (resolved_single, needs_event_selection, unavailable) in turn evidence; branch measurement covers the three RSVP reply branches. |
| system L8-16 per-state RSVP rules (unavailable, mutation, companion, campaign reminder) | evidence-only. Same RSVP projection plus record_checks; campaign reminder recognition without verification claims. |
| system L17 Spanish only, no internals | remove, duplicate. shared/output_style.txt via shared_invariants. |
| response_contract L3-8 brevity, declining reads, campaign context, failure next step, no English words | evidence-only for state rules; remove duplicate for brevity/Spanish (shared files). |

## 5. entrevista (retired contracts)

| Section | Disposition |
|---|---|
| system L1-4 requirement lifting, event-first clarification, greeting discipline | remove, structural. Planning lanes keep guidance through reply_planning_owner (domain_scope, domain_knowledge, flow_discipline, question_strategy) instead of node self-description. |
| response_contract L1-5 welcome shape (greeting/scope/ask word caps) | remove, structural. Model-written invariant forbids canned shapes; planning owner module carries scope. |
| response_contract L7-13 elicitation order and category list | evidence-only for category inventory (interview_categories part on entrevista node); remove for question-count discipline (shared/question_strategy.txt via reply_planning_owner). |
| response_contract L15-19 must-not list | remove, duplicate. Tool scoping (entrevista exposes exactly list_categories, get_category_by_slug, list_locations; B5 regression pins this) plus shared anti-patterns. |

## 6. recomendar (retired contracts)

| Section | Disposition |
|---|---|
| system shortlist objective, vigente results first, contact/quote reroute, selection capture | remove, structural. Planning owner module plus recommendation funnel trace carry this; provider facts travel in providerResults, not prose. |
| response_contract intro/rationale/caveat shapes and must-not list | remove, structural. Structured recommendation message schemas own the shape; no-availability-promises duplicated in shared anti-patterns. |

## 7. close nodes (retired contracts)

| File | Disposition |
|---|---|
| crear_lead_cerrar, necesidad_cubierta, guardar_seleccion_reintentar_luego, guardar_cerrar_temporalmente, accion_final_exitosa (system/response_contract) | remove, structural. Close policy travels in close continuity facts (closeContinuityFacts, close eligible needs, contact completeness) plus planning owner module on planning lanes. test close-completed-evidence pins compiler identity shared_invariants+reply_planning_owner with the old node bundle absent. Executable scope (finish_plan gating on proceed_confirmed) stays in resolveDynamicTools. |

## 8. deteccion and entry infrastructure (retired contracts)

| File | Disposition |
|---|---|
| deteccion_intencion/system plus response_contract (intent identification, one-phrase reflection, no full interview, no early recommendation) | remove, structural. Classifier bundles (response_classifier.txt, response_classifier_campaign.txt) remain the live classifier path; reply never loads deteccion prose. |
| contacto_inicial, ofrecer_agente_humano, solicitar_agente_humano (system/response_contract, except handoff outcome pair), informar_error_reintento, reintentar (system/response_contract) | remove, structural, except the handoff outcome pair retained in reply_handoff_outcome (solicitar_agente_humano/system.txt plus response_contract.txt on handoff task). test agent-service pins compiler identity shared_invariants on the stalled-offer path with the old bundle absent. |

## 9. shared (retained)

| File | Disposition |
|---|---|
| shared/base_system.txt, agent_personality.txt, output_style.txt, common_anti_patterns.txt | retain. shared_invariants on every extraction and reply call. |
| shared/domain_scope.txt, domain_knowledge.txt, flow_discipline.txt, question_strategy.txt | retain. reply_planning_owner on planning-owner planning tasks; question_strategy additionally on interview nodes via conversationPromptFilesForNode audit path. |

## 10. extractors (retained)

| File | Disposition |
|---|---|
| extractors/base_system.txt, capability_boundary.txt | retain. extraction_cross_domain on every extraction call. |
| extractors/information.txt plus resolver auth_control.txt | retain. extraction_information on unknown plus information lanes. |
| extractors/rsvp.txt | retain. extraction_rsvp on unknown plus RSVP lanes. |
| extractors/planning.txt | retain. extraction_planning on unknown plus planning lanes with progress gating. |
| extractors/contact.txt, provider_management.txt, close_pause.txt | retain. Gated extraction modules (contact on support lanes or transient planning detail; provider/close only on transient planning detail). Coverage entry contact-extraction-gating. |
| extractors/image_reference.txt | retain. Conditional follow-up linkage only while the plan stores image attachments. |

## B1 fragment cross-reference

FAQ L4-6: table 1 L4, L5. Provenance L6: table 1 L6.
Unknown-paid L42: table 1 L42. Tx-ID: table 1 L11, L12, L30.
Cart/order: table 1 L32, L33, L44. Completed+blocked: table 1 L25, L26.
Auth-terminal: table 1 L41, L49, L50, L51. Image rules: table 1 L37, L38, L39, L40.
Grounding: table 1 L31, L43, L47 plus table 2 L23. Next-step: table 1 L36.
Multi-request: table 1 L35 plus table 2 L25. Email: table 2 L24.
Ambiguity: table 1 L28. Shape: table 1 L1, L29 (removed structural).
Host-modification: table 2 L20. Node specifics: table 2 L7.
