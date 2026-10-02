# Reporte de tests de comportamiento — recap-agent

> **Historical 5 September 2026 reviewer snapshot.** The current testing contract and results are documented in [Testing and validation](testing.md). This inventory must not be read as the final result or as authorization to run an unfiltered live suite; use [the evaluation framework](evaluation-framework.md) and the [30 September technical report](thesis/architecture-report/recap-agent-architecture-report.pdf).

_Fecha: 2026-09-05 | Repo: recap-agent | Rama de evals: `evals/` + `tests/`_

Documento para revisor externo. Cubre la totalidad de los tests de comportamiento vivos (Lambda real) y sus twins deterministas offline.

## 1. Resumen ejecutivo

- **Suite obligatoria `live_behavior_regression`: 59 casos**, todos `targetModes: [live_lambda]`, todos fail-closed (un hard fallido = caso failed).
- **Ficheros fuente: 59** (54 `live-behavior-*` + 4 `live-feedback-token-*` + 1 `live-faq-from-recommendation`).
- **Registro `live-behavior-coverage.yaml`: 165 behaviorChanges**, cada uno apunta a 1+ liveCaseIds con hard estructural + hard `text_semantic requireJudge:true` (verificado por `tests/live-behavior-coverage.test.ts`).
- **Twins offline (vitest, sin LLM):** `t6-deterministic-twins` (10 its), `deterministic-cart-only-reply` (6), `rsvp-deterministic-current-state` (4), `support-continuity` (3), `offline-twins-wave-c5` (4), `offline-twins-provenance-fixes` (2), mas suites `rsvp-*, purchase-*, otp-*, capability-*`.
- **Comando vivo:** `npm run eval:behavior-live [--case <id>]` (despliega Lambda dev primero). **Comando unit:** `npm run test` / `npm run test tests/live-behavior-coverage.test.ts`.

## 2. Como se ejecutan (metodo)

1. Cada caso YAML define `inputs[]` (1-4 turnos WhatsApp/terminal con `contactPhone`, `sessionId`), `seedPlan` (estado inicial tipado) y opcional `backendFixture.scenario` (respuesta backend simulada determinista).
2. El runner (`src/evals/runner.ts` + `targets/live-lambda`) invoca la Lambda real turno por turno, captura `outputText`, `currentNode`, `trace` (tools, tool_inputs/outputs, prompt_bundle, token_usage, plan) y `plan` persistido.
3. Cada `expectation` se evalua contra el turno indicado (`turnIndex` o ultimo). `hardGatePassed = todos los hard en passed`. `text_semantic` llama al juez LLM con `rubric` + `minScore 0.9/0.95`.
4. `live-behavior-coverage.test.ts` valida: todo `behaviorChange.liveCaseId` existe, esta en la suite, tiene `live_lambda`, tiene >=1 hard estructural (no `budget/text_semantic/token`) y >=1 `text_semantic hard requireJudge:true`. IDs de cambio unicos.

## 3. Que se valora (tipos de expectativa)

| Tipo | Que verifica | Ejemplo tipico |
|---|---|---|
| `node_transition` (hard) | Nodo destino correcto, no reinicio a bienvenida | `-> resolver_consultas_informativas`, `-> responder_invitacion` |
| `tool_usage` (hard) | Llamadas obligatorias y prohibidas | `mustCall lookup_guest_orders_by_phone`, `mustNotCall auth_by_phone, request_user_login_code, verify_user_login_code` |
| `plan_field_equals/subset` (hard) | Estado tipado | `rsvp_state.status=awaiting_event_selection`, `user_auth.status=none`, `selection_attempts=1` |
| `trace_field_*` (hard) | Auditoria: previous_node, prompt_bundle_id, attempts | `previous_node=resolver_consultas_informativas`, `route_kind=information_batch` |
| `text_contains / text_not_contains` (hard) | Guardas literales | debe `12 de septiembre de 2026`; prohibido `RSVP, guest_id, correo, no encontramos ninguna compra` |
| `text_semantic` hard + juez | Respuesta natural en espanol, grounding, no alucinacion | rubric por caso, minScore 0.9 (0.95 solo spanish-only) |
| `token_usage_present / budget_constraints` | Consumo de tokens y maxTurns | `allTurns:true`, `maxTurns:1-4` |

## 4. Indice de los 59 casos (todos)

| # | Case ID | Turnos | Descripcion |
|---|---|---|---|
| 1 | `live_behavior.abandoned_cart_only_sonia` | 1 | Sonia cart-only abandoned checkout is valid phone coverage; purchase not_found must not occur. |
| 2 | `live_behavior.accountless_event_answer_precedes_remaining_private_auth` | 1 | A mixed event and purchase question reuses the phone-enriched event and its scoped purchases without account authentication. |
| 3 | `live_behavior.accountless_guest_event_uses_phone_without_otp` | 1 | An invited WhatsApp guest without an account receives event details through the trusted phone without being pushed into email OTP. |
| 4 | `live_behavior.active_cart_checkout_continuity_alex` | 2 | Alex same-event pending order and active cart stay distinct; checkout continuation does not restart or flatten records. |
| 5 | `live_behavior.ambiguous_confirmation_clarifies` | 1 | An underspecified confirmation over a multi-option shortlist must ask what is being confirmed instead of restarting or choosing arbitrarily. |
| 6 | `live_behavior.authentication_refusal_closes_protected_query` | 1 | An explicit privacy or security refusal must close the protected request without repeating email authentication or forcing human support. |
| 7 | `live_behavior.concurrent_support_turns_preserve_context` | 2 | Claudia's overlapping card-support message and guest details must serialize before plan/history loading. |
| 8 | `live_behavior.current_campaign_order_over_historical_declined_maria_jose` | 2 | Maria Jose current pending Isa and Lu order is selected over old declined AMORCITOS; balance is not recomputed. |
| 9 | `live_behavior.customer_transaction_code_by_phone` | 1 | A customer-facing COD transaction reference is resolved as a phone-scoped purchase request without exposing internal order ids or starting authentication. |
| 10 | `live_behavior.host_support_allows_explicit_rsvp_switch` | 1 | A pending host withdrawal must not prevent an explicitly requested attendance question; the test uses read-only fixture data. |
| 11 | `live_behavior.host_withdrawal_diana_policy_and_support` | 3 | Diana corrects her role, asks about a missing host withdrawal, and supplies her event; answer sourced policy and hand off without buyer or invitation detours. |
| 12 | `live_behavior.host_withdrawal_pending_event_followup` | 1 | Reconstruct the pending withdrawal topic at Diana's event-name follow-up; the name must not start RSVP. |
| 13 | `live_behavior.host_withdrawal_general_policy_only` | 1 | General host withdrawal timing needs sourced FAQ policy, not account lookups or a mandatory handoff. |
| 14 | `live_behavior.mailbox_issue_deferral_and_clarification_preserve_support` | 4 | Reconstruct Maria Isabel's transfer-proof greeting, mailbox-capacity report, deferral and misspelled clarification without a restart or irrelevant purchase search. |
| 15 | `live_behavior.nonphysical_purchase_omits_shipping` | 1 | A nonphysical gift purchase must not create shipment or physical-delivery claims. |
| 16 | `live_behavior.otp_nondelivery_auto_resends_once` | 1 | The first missing-code report must automatically resend once while preserving the protected request and without asking the user to choose another email path. |
| 17 | `live_behavior.otp_not_received_requires_response` | 1 | A repeated missing-code report after one resend must trigger a real handoff and preserve the protected question without another OTP loop. |
| 18 | `live_behavior.otp_number_words_are_verified` | 1 | An OTP written as unambiguous Spanish digit words must be normalized and submitted instead of rejected as prose. |
| 19 | `live_behavior.otp_sent_explains_image_limitation` | 1 | After sending an email code, the assistant asks the user to copy and paste it without the confusing word text. |
| 20 | `live_behavior.payment_destination_requires_pending_purchase` | 1 | A payment destination must not be disclosed before a specific pending purchase is verified. |
| 21 | `live_behavior.pending_balance_validation_luis` | 2 | Luis pending Alejandra order and cart with null currency; balance reported as unknown and validation window applied. |
| 22 | `live_behavior.phone_account_rejection_requests_email` | 1 | An explicit rejection of the current phone account clears phone authentication and requests the registered email. |
| 23 | `live_behavior.phone_confirmation_unclear_requires_yes_or_no` | 1 | A stale imprecise answer after the retired confirmation prompt must use phone-scoped event context directly instead of asking again. |
| 24 | `live_behavior.phone_purchase_missing_hands_off_once` | 2 | Empty trusted-phone orders and carts preserve a purchase query and request human help once, without automatic email verification. |
| 25 | `live_behavior.provider_reference_cheaper_option` | 1 | A comparative reference to the cheaper shortlisted provider must resolve from retained provider evidence. |
| 26 | `live_behavior.provider_reference_miraflores_option` | 1 | A location reference to the Miraflores shortlisted provider must resolve from retained provider evidence. |
| 27 | `live_behavior.purchase_confirmation_carina_request_survives_normalization` | 2 | Reconstruct the repeated payment-confirmation requests after the current-event campaign without silently losing neutral authentication actions. |
| 28 | `live_behavior.purchase_current_pending_over_old_approved` | 1 | Explicit event, amount, date, and status select Victor's current pending gift instead of an older approved purchase. |
| 29 | `live_behavior.purchase_delia_status_by_phone` | 1 | Delia's payment status is answered from phone-scoped order summaries without an account or OTP loop. |
| 30 | `live_behavior.purchase_joaquin_dedication_selection` | 1 | Joaquín's dedication request uses phone-scoped gift details and asks him to select among multiple purchases without authentication. |
| 31 | `live_behavior.purchase_kiara_pending_by_phone` | 1 | Kiara's pending gift status is answered from phone-scoped orders without requesting an OTP that may never arrive. |
| 32 | `live_behavior.purchase_martha_accountless_selection` | 1 | Martha's purchases are found by trusted phone even though she has no account, and multiple records are presented for selection without OTP. |
| 33 | `live_behavior.purchase_pending_transfer_continuity` | 3 | A pending transfer keeps its purchase context, uses the verified validation window, and never invents currency or local time from incomplete backend fields. |
| 34 | `live_behavior.repeated_otp_failure_preserves_gift_query` | 3 | A second rejected, correctly formatted OTP must end the repetitive code loop while preserving the reported gift-deposit query. |
| 35 | `live_behavior.reset_plan_discards_stored_context` | 1 | An explicit request to start over must atomically replace the stored event plan before replying. |
| 36 | `live_behavior.rsvp_ambiguous_event_requires_grounded_selection` | 1 | An underspecified event reference cannot select or mutate one of several persisted RSVP candidates. |
| 37 | `live_behavior.rsvp_state_reversal_ends_confirmed` | 1 | An affirmative attendance request ends in a backend-grounded confirmed state, whether the service changes a previous decline or reports that attendance is already confirmed. |
| 38 | `live_behavior.rsvp_cinthya_campaign_invitation_not_reported_missing` | 1 | A campaign-grounded RSVP for Julisabeth y Andrés must reconcile both phone-scoped reads and must not be reported as a missing invitation. |
| 39 | `live_behavior.rsvp_confirmed_state_is_reported` | 1 | A user-level invitation that already has attendance confirmed is reported via hybrid fragment plus natural tissue without another mutation. |
| 40 | `live_behavior.rsvp_cristian_phone_enriched_confirmation` | 1 | Cristian's completed invitation is resolved via hybrid fragment plus natural tissue without a false missing-invitation answer. |
| 41 | `live_behavior.rsvp_declined_state_offers_one_change` | 1 | A declined invitation reports its current state and offers one clear confirmation to change it to attending. |
| 42 | `live_behavior.rsvp_jose_campaign_invitation_not_reported_missing` | 1 | A campaign-grounded RSVP for Gia Antonella is resolved via hybrid fragment plus natural tissue without claiming a new mutation. |
| 43 | `live_behavior.rsvp_missing_action_requires_explicit_decision` | 1 | An RSVP request without an attendance decision reports the selected invitation state and does not mutate it. |
| 44 | `live_behavior.rsvp_missing_event_identity_is_unavailable` | 1 | Diana's malformed invitation evidence boundary; parsed guest records without event identity cannot become guest-name invitation choices or a global denial. |
| 45 | `live_behavior.rsvp_multi_person_offers_human_help` | 1 | RSVP for more than one additional companion remains a bounded human-review case; the single +1 case is handled separately through POST /guest/rsvp. |
| 46 | `live_behavior.rsvp_paolo_mariana_resolved_single` | 1 | Paolo & Mariana attending invitation reports the already-resolved RSVP result for the named event; it does not ask the user to choose among invitations when one is resolved. |
| 47 | `live_behavior.rsvp_guest_and_plus_one_combined_saved` | 1 | Combined own attendance and plus-one yes in one POST /guest/rsvp mutation. |
| 48 | `live_behavior.rsvp_plus_one_multiple_events_requires_selection` | 1 | Plus-one request with multiple pending invitations requires one bounded event selection before mutation. |
| 49 | `live_behavior.rsvp_plus_one_not_eligible_no_false_success` | 1 | Plus-one not eligible returns saved false and is reported honestly without false success. |
| 50 | `live_behavior.rsvp_plus_one_uses_phone_scoped_mutation` | 1 | A single explicit +1 response uses the trusted-phone RSVP endpoint and reports only the typed saved outcome. |
| 51 | `live_behavior.rsvp_trusted_phone_reports_no_pending` | 1 | A clear RSVP decision uses the trusted channel phone and distinguishes no associated invitations from no pending invitations. |
| 52 | `live_behavior.spanish_only_mixed_language_request` | 1 | A mixed-language request must be understood while every user-visible natural-language word in the reply remains Spanish. |
| 53 | `live_behavior.support_detail_continuity` | 3 | Details supplied after a payment-support answer remain attached to that support thread and do not replace the channel user's identity. |
| 54 | `live_behavior.wedding_planner_location_completes_search` | 4 | A wedding-planner request should collect the remaining search context compactly and search immediately when the location follow-up completes it. |
| 55 | `live.faq_from_recommendation_node` | 1 | A user in a recommendation flow should be able to ask a FAQ and force KB retrieval instead of provider search. |
| 56 | `live_feedback.token_seeded_close_flow` | 4 | Seeded selected-provider close flow should consume model tokens over several live Lambda turns. |
| 57 | `live_feedback.token_seeded_contact_correction` | 3 | Seeded close flow should consume tokens while rejecting and then accepting corrected contact phone. |
| 58 | `live_feedback.token_fresh_multifront_stays_multi_need` | 1 | Fresh multi-front provider request should consume tokens and remain multi-need in live Lambda. |
| 59 | `live_feedback.token_seeded_selection_defer_close` | 4 | Seeded multi-need plan should consume tokens while selecting one need, deferring a need after every option is declined, and entering close flow. |

## 5. Fichas detalladas por caso

### `live_behavior.abandoned_cart_only_sonia`

- **Fichero:** `evals/cases/live-behavior-abandoned-cart-sonia.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, purchase, cart, abandoned, reported-interaction, sonia`
- **Descripcion:** Sonia cart-only abandoned checkout is valid phone coverage; purchase not_found must not occur.
- **Input turno 0:** "Tengo un carrito abandonado de Carlos y Adriana. Quiero saber si puedo pagar por transferencia." (phone `+51965765765`, session `live-abandoned-cart-sonia-session`)
- **Fixture backend:** `scenario=purchase-sonia-765`
- **Que se valora:**
- `abandoned-cart-enters-information` | `node_transition` (hard) -> `resolver_consultas_informativas`
- `abandoned-cart-uses-phone-partitions` | `tool_usage` (hard) debe llamar `lookup_guest_orders_by_phone` | prohibido `auth_by_phone, request_user_login_code, verify_user_login_code`
- `abandoned-cart-recognized` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The trusted phone lookup returns no pending or completed orders and one abandoned cart for Carlos and Adriana. The answer must be concise, natural Latin American Spanish, recognize the abandoned cart as valid phone-scoped coverage, and explain that it can be recovered through the existing recovery path only if that path is present in trusted context, without inventing a link. It must not answer that no purchase exists or that nothing was found solely because orders are empty, must not claim the cart is an approved order, and must not request email or OTP.
- `no-purchase-not-found` | `text_not_contains` (hard) prohibido `no encontramos ninguna compra, no se encontró ningún pedido, no existe`
- `no-correo-channel-claim` | `text_not_contains` (hard) prohibido `correo`
- **BehaviorChanges vinculados (9):** `abandoned-cart-only-sonia, preserve-cart-only-coverage-across-event-name-variants, route-cart-payment-options-through-orders-and-indexed-policy, project-derived-purchase-policies-with-minimum-disclosure, validate-trusted-cart-recovery-path-from-outbound-context, scope-indexed-payment-options-as-general-gift-policy, fix-cart-reply-minimum-disclosure-no-gifts-quantity, fix-cart-reply-explicit-phone-attribution, fix-cart-reply-grounded-transfer-availability`

### `live_behavior.accountless_event_answer_precedes_remaining_private_auth`

- **Fichero:** `evals/cases/live-behavior-accountless-event-before-private-auth.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, associated-event, accountless-guest, mixed-information, phone-first`
- **Descripcion:** A mixed event and purchase question reuses the phone-enriched event and its scoped purchases without account authentication.
- **Input turno 0:** "¿Dónde será la recepción y cuál es el estado de mi compra?" (phone `+51904523314`, session `live-accountless-event-before-private-auth-session`)
- **Que se valora:**
- `routes-to-information` | `node_transition` (hard) -> `resolver_consultas_informativas`
- `reads-and-reuses-phone-enriched-event` | `tool_usage` (hard) debe llamar `lookup_guest_events_by_phone, get_guest_event_detail` | prohibido `auth_by_phone, lookup_guest_orders_by_phone, lookup_guest_gift_purchases_by_phone, request_user_login_code, verify_user_login_code, update_phone, guest_rsvp`
- `keeps-email-auth-ready-for-the-private-query` | `plan_field_equals` (hard) `user_auth.status`
- `answers-event-and-reuses-scoped-purchase` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The trusted WhatsApp number is an invited guest to Julisabeth y Andrés. The phone-enriched event detail contains the verified “Recepción y Fiesta” location at Hacienda Recoveco on Avenida Manuel Valle in Lima and an event-scoped purchase. The answer must be concise, natural, and entirely in Spanish; provide the requested event location and the available purchase status in the same turn. It must not ask for email or an OTP, issue a redundant global purchase lookup, reopen onboarding, or expose sensitive payment data as prohibited by the response contract. Amount/product disclosure beyond status
- `summary-excludes-payment-type` | `text_not_contains` (hard) prohibido `tarjeta de crédito, tarjeta de debito, tipo de tarjeta, con tarjeta`
- **BehaviorChanges vinculados (4):** `approved-purchase-summary-omits-payment-type, answer-accountless-event-data-before-authenticating-remaining-private-queries, reuse-event-scoped-purchases-without-redundant-global-read, payment-type-excluded-from-summary-aspect`

### `live_behavior.accountless_guest_event_uses_phone_without_otp`

- **Fichero:** `evals/cases/live-behavior-accountless-guest-event.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, associated-event, accountless-guest, phone-first, reported-interaction`
- **Descripcion:** An invited WhatsApp guest without an account receives event details through the trusted phone without being pushed into email OTP.
- **Input turno 0:** "Respondí la invitación por WhatsApp. ¿Dónde será la recepción y fiesta?" (phone `+51904523314`, session `live-accountless-guest-event-session`)
- **Que se valora:**
- `routes-to-associated-event-information` | `node_transition` (hard) -> `resolver_consultas_informativas`
- `uses-phone-enriched-event-context-directly` | `tool_usage` (hard) debe llamar `lookup_guest_events_by_phone, get_guest_event_detail` | prohibido `auth_by_phone, request_user_login_code, verify_user_login_code, update_phone, guest_rsvp`
- `leaves-no-authentication-request-pending` | `plan_field_equals` (hard) `user_auth.status`
- `answers-from-the-invited-event-without-otp` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The trusted WhatsApp number has no Sin Envolturas account but is an invited guest to Julisabeth y Andrés. The verified event detail identifies “Recepción y Fiesta” at Hacienda Recoveco on Avenida Manuel Valle in Lima. The answer must be concise, natural, and entirely in Spanish; directly provide that verified reception location, and must not ask for an email, OTP code, account creation, or another turn before answering.
- **BehaviorChanges vinculados (3):** `discover-accountless-event-guests-before-email-otp, read-accountless-guest-event-detail-without-jwt, preserve-event-association-when-enriched-attendance-is-null`

### `live_behavior.active_cart_checkout_continuity_alex`

- **Fichero:** `evals/cases/live-behavior-active-cart-checkout-alex.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 2 | **Tags:** `live, behavior, purchase, cart, continuity, reported-interaction, alex`
- **Descripcion:** Alex same-event pending order and active cart stay distinct; checkout continuation does not restart or flatten records.
- **Input turno 0:** "Quiero continuar el checkout de Luis Raul y Carmen del Rosario. Veo el pedido pendiente y el carrito activo del mismo evento. Que falta para pagar?" (phone `+51982340340`, session `live-active-cart-alex-session`)
- **Input turno 1:** "El carrito sigue activo, no es un pedido nuevo. No me saludes de nuevo como si fuera la primera vez." (phone `+51982340340`, session `live-active-cart-alex-session`)
- **Fixture backend:** `scenario=purchase-alex-340`
- **Que se valora:**
- `active-cart-stays-information` | `node_transition` (hard) -> `resolver_consultas_informativas` turno 0
- `active-cart-uses-phone-partitions` | `tool_usage` (hard) turno 0 debe llamar `lookup_guest_orders_by_phone` | prohibido `auth_by_phone, request_user_login_code, verify_user_login_code`
- `active-cart-continuity-stays-information` | `node_transition` (hard) -> `resolver_consultas_informativas` turno 1
- `active-cart-not-flattened` | `text_semantic` (hard) turno 1 juez minScore=0.9 requireJudge=True
  > Rubrica juez: The trusted phone lookup returns a pending order and an active cart for the same event Luis Raul and Carmen del Rosario. The response must be concise, natural Latin American Spanish, keep the two records distinct, and answer the checkout continuation without flattening cart into order. It must not restart with a generic Sin Envolturas welcome, ask what event the user is planning, claim the cart is a separate new order, or ask for email/OTP. On the second turn it must stay in the same checkout thread and not repeat a generic introduction.
- **BehaviorChanges vinculados (1):** `active-cart-checkout-continuity-alex`

### `live_behavior.ambiguous_confirmation_clarifies`

- **Fichero:** `evals/cases/live-behavior-ambiguous-confirmation.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, ambiguity, clarification, reported-interaction`
- **Descripcion:** An underspecified confirmation over a multi-option shortlist must ask what is being confirmed instead of restarting or choosing arbitrarily.
- **Input turno 0:** "Sí confirmo." (phone `-`, session `live-behavior-ambiguous-confirmation-session`)
- **Seed plan keys:** `current_node, event_type, location, guest_range, active_need_category, vendor_category, provider_needs`
- **Que se valora:**
- `no-provider-selected-without-reference` | `plan_field_subset` () `provider_needs`
- `no-search-on-ambiguous-confirmation` | `tool_usage` () | prohibido `search_providers_from_plan, search_providers_by_query_intent, get_provider_detail`
- `ambiguity-response-is-a-focused-clarification` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user says only "Sí confirmo" while two photography providers remain shortlisted and neither has been identified. Pass only if the response asks one concise Spanish clarification about which provider or what action the user is confirming. It must not choose either provider, close the plan, restart with a welcome, repeat the whole shortlist, or invent missing intent.
- **BehaviorChanges vinculados (4):** `preserve-ambiguous-confirmation-evidence, reject-ungrounded-multi-candidate-confirmations, reject-ungrounded-provider-selection-operations, render-neutral-provider-confirmation-clarification`

### `live_behavior.authentication_refusal_closes_protected_query`

- **Fichero:** `evals/cases/live-behavior-auth-refusal-closes-query.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, authentication, privacy, refusal, reported-interaction`
- **Descripcion:** An explicit privacy or security refusal must close the protected request without repeating email authentication or forcing human support.
- **Input turno 0:** "No doy mis datos personales y no quiero continuar con esta verificación." (phone `$PHONE_FIRST_FALLBACK_CONTACT_PHONE`, session `live-auth-refusal-closes-query-session`)
- **Seed plan keys:** `current_node, user_auth, information_state`
- **Que se valora:**
- `refusal-returns-to-resume-node` | `node_transition` (hard) -> `entrevista`
- `refusal-does-not-call-authentication-or-handoff` | `tool_usage` (hard) | prohibido `auth_by_phone, request_user_login_code, verify_user_login_code, request_human_takeover`
- `protected-request-is-cleared` | `plan_field_equals` (hard) `information_state.pending_requests`
- `refusal-is-respected` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The person explicitly refuses to share personal data or continue verification. Pass only if the response respects that decision in natural Spanish, clearly says it will not ask again for an email or code, and closes the protected query without claiming access to purchase data. It must not force a human handoff, restart authentication, or pressure the person to continue.
- **BehaviorChanges vinculados (2):** `close-protected-request-after-explicit-authentication-refusal, distinguish-phone-association-rejection-from-authentication-refusal`

### `live_behavior.concurrent_support_turns_preserve_context`

- **Fichero:** `evals/cases/live-behavior-concurrent-support-turns.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 2 | **Tags:** `live, behavior, concurrency, continuity, identity, reported-interaction, claudia-roger`
- **Descripcion:** Claudia's overlapping card-support message and guest details must serialize before plan/history loading.
- **Input turno 0:** "Un amigo no puede usar su tarjeta de crédito para comprar un regalo. ¿Hay problemas con tarjetas?" (phone `+51985101461`, session `live-concurrent-support-session`)
- **Input turno 1:** "El nombre del invitado afectado es Roger Abanto. Y el evento es Baby Shower Catalina." (phone `+51985101461`, session `live-concurrent-support-session`)
- **Fixture backend:** `scenario=support-continuity`
- **Que se valora:**
- `first-support-question` | `tool_usage` (hard) turno 0 debe llamar `knowledge_base_search` | prohibido `search_providers_from_plan, auth_by_phone, request_user_login_code`
- `second-turn-actually-contended` | `trace_field_number` (hard) `turn_coordination.attempts` turno 1
- `second-turn-remains-support` | `node_transition` (hard) -> `resolver_consultas_informativas` turno 1
- `second-turn-loads-first-turn-plan` | `trace_field_equals` (hard) `previous_node` turno 1
- `support-detail-acknowledgment-does-not-call-backend` | `tool_usage` (hard) turno 1 | prohibido `lookup_guest_events_by_phone, request_human_takeover, auth_by_phone, request_user_login_code, verify_user_login_code, search_providers_from_plan`
- `support-detail-acknowledgment-is-deterministic` | `trace_field_equals` (hard) `route_kind` turno 1
- `no-restart-or-identity-overwrite-after-overlap` | `text_semantic` (hard) turno 1 juez minScore=0.9 requireJudge=True
  > Rubrica juez: The second reply must continue the same card-payment support conversation in Spanish, acknowledge Roger Abanto as the affected invited purchaser and Baby Shower Catalina as the user-reported event. Briefly acknowledge both supplied references and say that the same support query is being kept for continuation. It must not address the channel user as Roger, restart with a generic welcome, switch to provider planning, repeat the entire payment explanation, perform a backend lookup, request human help, or claim a verified purchase, verified invitation, or email/OTP prerequisite.
- **BehaviorChanges vinculados (4):** `serialize-lambda-conversation-turns-with-consistent-state-and-shared-keys, phone-scoped-misses-request-human-help-without-automatic-otp, history-continuity-prevents-generic-welcome, typed-support-reference-acknowledgement`

### `live_behavior.current_campaign_order_over_historical_declined_maria_jose`

- **Fichero:** `evals/cases/live-behavior-current-campaign-order-maria-jose.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 2 | **Tags:** `live, behavior, purchase, selection, campaign, reported-interaction, maria-jose`
- **Descripcion:** Maria Jose current pending Isa and Lu order is selected over old declined AMORCITOS; balance is not recomputed.
- **Input turno 0:** "Consulta por Isa y Lu. El monto pendiente es 63.85 por transferencia del 28 de agosto. No me hables de AMORCITOS." (phone `+51987554554`, session `live-maria-jose-current-vs-declined-session`)
- **Input turno 1:** "Ya pague los 3.85 que faltaban. Confirmame que ya esta aprobado." (phone `+51987554554`, session `live-maria-jose-current-vs-declined-session`)
- **Fixture backend:** `scenario=purchase-maria-jose-554`
- **Que se valora:**
- `current-order-enters-information` | `node_transition` (hard) -> `resolver_consultas_informativas` turno 0
- `current-order-uses-phone-partitions` | `tool_usage` (hard) turno 0 debe llamar `lookup_guest_orders_by_phone` | prohibido `auth_by_phone, request_user_login_code, verify_user_login_code`
- `current-pending-suppresses-historical-declined` | `text_semantic` (hard) turno 0 juez minScore=0.9 requireJudge=True
  > Rubrica juez: The phone lookup returns a current pending Isa and Lu order for 63.85 via transfer, a same-event active cart, and an old declined AMORCITOS order. The user's explicit Isa and Lu evidence grounds the current thread. The response must be concise, natural Latin American Spanish, report the current pending Isa and Lu order, and suppress AMORCITOS entirely. It must not expose the declined record, calculate a balance, claim the amount matched, or ask for email/OTP.
- `shortfall-remains-pending` | `text_semantic` (hard) turno 1 juez minScore=0.9 requireJudge=True
  > Rubrica juez: After the user reports paying the shortfall for the same Isa and Lu order, the backend still reports the order as pending and provides no received-amount or balance fields; only a 72 business hour policy for transfer/Yape/Plin applies. The answer must be concise, natural Latin American Spanish, say the order remains pending and that validation can take up to 72 business hours, without claiming approval, denying receipt, calculating currency, or inventing a balance. It must not attribute user-reported or campaign-reported amounts to the order registry. It must not mention AMORCITOS or restart w
- **BehaviorChanges vinculados (5):** `current-campaign-order-over-historical-declined-maria-jose, selector-guard-single-pending-amount-as-payment-evidence, declarative-pending-amount-extraction-example, event-matching-bidirectional-and-amount-payment-evidence-with-declined-guard, payment-report-provenance-and-voucher-fragment`

### `live_behavior.customer_transaction_code_by_phone`

- **Fichero:** `evals/cases/live-behavior-customer-transaction-code-by-phone.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, purchase, phone-orders, customer-transaction-code, reported-interaction`
- **Descripcion:** A customer-facing COD transaction reference is resolved as a phone-scoped purchase request without exposing internal order ids or starting authentication.
- **Input turno 0:** "COD301816" (phone `+51990027179`, session `live-customer-transaction-code-session`)
- **Que se valora:**
- `transaction-code-enters-information` | `node_transition` (hard) -> `resolver_consultas_informativas`
- `transaction-code-uses-phone-orders` | `tool_usage` (hard) debe llamar `lookup_guest_orders_by_phone` | prohibido `auth_by_phone, request_user_login_code, verify_user_login_code`
- `transaction-code-is-handled-as-purchase-reference` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user sent the customer-facing transaction reference COD301816 in an abandoned-cart and purchase conversation. The response must treat it as a purchase reference and be entirely in natural Spanish. If the backend exposes transaction number 301816, answer from that matched purchase and identify it as COD301816. If the phone-scoped backend omits customer transaction numbers, clearly say that the code could not be linked directly, present the available purchases using event/date/amount/status rather than opaque internal ids, and ask the user to select one. It must not ask generically what the 
- **BehaviorChanges vinculados (2):** `normalize-customer-transaction-codes-by-phone, withhold-opaque-order-ids-when-customer-reference-is-unavailable`

### `live_behavior.host_support_allows_explicit_rsvp_switch`

- **Fichero:** `evals/cases/live-behavior-host-support-explicit-rsvp-switch.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, rsvp, host-withdrawal, boundary`
- **Descripcion:** A pending host withdrawal must not prevent an explicitly requested attendance question; the test uses read-only fixture data.
- **Input turno 0:** "Ahora cambio de tema. Quiero consultar mi asistencia a Michelle & Jorge. ¿Ya está confirmada? No cambies mi respuesta." (phone `+51942633292`, session `-`)
- **Fixture backend:** `scenario=rsvp-plus-one-saved`
- **Seed plan keys:** `current_node, information_state`
- **Que se valora:**
- `explicit-switch-enters-rsvp` | `node_transition` (hard) -> `responder_invitacion`
- `explicit-state-query-is-read-only` | `tool_usage` (hard) debe llamar `lookup_rsvp_invitations, lookup_guest_events_by_phone` | prohibido `guest_rsvp, knowledge_base_search, request_human_takeover, auth_by_phone, request_user_login_code`
- `current-request-not-old-pending-topic` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user explicitly switched from withdrawal support to asking about attendance at Michelle & Jorge, with no authorization to change it. The fixture attendance has not been answered. State that attendance is pending/not yet confirmed for that event, without claiming a mutation. Do not answer the old withdrawal question, initiate human handoff, ask for OTP, or discuss another event.
- `read-only-query-does-not-stage-a-future-mutation` | `plan_field_equals` (hard) `rsvp_state.pending_action`
- **BehaviorChanges vinculados (3):** `attendance-state-query-clears-old-mutations-and-does-not-offer-new-ones, personal-attendance-state-has-one-extraction-route, pending-information-event-reference-does-not-start-rsvp`

### `live_behavior.host_withdrawal_diana_policy_and_support`

- **Fichero:** `evals/cases/live-behavior-host-withdrawal-diana.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 3 | **Tags:** `live, behavior, faq, host-withdrawal, continuity, reported-interaction, diana`
- **Descripcion:** Diana corrects her role, asks about a missing host withdrawal, and supplies her event; answer sourced policy and hand off without buyer or invitation detours.
- **Input turno 0:** "Hola, no hice ningún regalo. Yo soy la novia." (phone `+51985101461`, session `live-host-withdrawal-diana`)
- **Input turno 1:** "Hice un retiro de dinero de mi evento y aun no lo recibo." (phone `+51985101461`, session `live-host-withdrawal-diana`)
- **Input turno 2:** "Evento: Diana y Fernando" (phone `+51985101461`, session `live-host-withdrawal-diana`)
- **Fixture backend:** `scenario=support-continuity`
- **Que se valora:**
- `role-correction-is-not-a-buyer-lookup` | `tool_usage` (hard) turno 0 | prohibido `lookup_guest_orders_by_phone, lookup_rsvp_invitations, request_user_login_code`
- `acknowledges-role-without-generic-reset` | `text_semantic` (hard) turno 0 juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user corrected an assumption: she did not buy a gift and is the bride. Acknowledge that correction and ask at most one relevant question about what she needs. Do not restart with a generic introduction, offer a provider menu, assert verified ownership, or discuss an unrelated gift purchase.
- `policy-and-human-support-without-unrelated-api-work` | `tool_usage` (hard) turno 1 debe llamar `knowledge_base_search, request_human_takeover` | prohibido `lookup_guest_orders_by_phone, lookup_guest_gift_purchases_by_phone, lookup_guest_events_by_phone, lookup_rsvp_invitations, guest_rsvp, auth_by_phone, request_user_login_code, verify_user_login_code`
- `withdrawal-topic-retained` | `plan_field_subset` (hard) `information_state.pending_requests` turno 1
- `supported-policy-not-invented-withdrawal-status` | `text_semantic` (hard) turno 1 juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user is asking about funds withdrawn from her own event, not a gift she bought. Explain that the general host-withdrawal processing policy is up to 72 business hours. State that the particular withdrawal status/receipt cannot be checked with the available information and that human support was requested (the fixture succeeds). Do not assert its actual status, blame a bank, promise an arrival date, introduce fees or card-fund eligibility periods, ask for OTP, or list purchases or invitations. Reply concisely in Spanish.
- `handoff-is-persisted` | `plan_field_equals` (hard) `human_escalation.status` turno 1
- `later-event-message-stays-with-human-team` | `trace_field_equals` (hard) `prompt_bundle_id` turno 2
- `no-repeated-takeover-or-rsvp` | `tool_usage` (hard) turno 2 | prohibido `request_human_takeover, lookup_rsvp_invitations, guest_rsvp, knowledge_base_search, request_user_login_code`
- **BehaviorChanges vinculados (2):** `host-withdrawal-policy-and-individual-status-support, reported-event-role-does-not-force-welcome-schema`

### `live_behavior.host_withdrawal_pending_event_followup`

- **Fichero:** `evals/cases/live-behavior-host-withdrawal-event-followup.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, faq, host-withdrawal, continuity, reported-interaction, diana`
- **Descripcion:** Reconstruct the pending withdrawal topic at Diana's event-name follow-up; the name must not start RSVP.
- **Input turno 0:** "Evento: Diana y Fernando" (phone `+51985101461`, session `-`)
- **Fixture backend:** `scenario=support-continuity`
- **Seed plan keys:** `current_node, conversation_summary, information_state`
- **Que se valora:**
- `event-name-continues-withdrawal-support` | `tool_usage` (hard) debe llamar `knowledge_base_search, request_human_takeover` | prohibido `lookup_rsvp_invitations, lookup_guest_events_by_phone, guest_rsvp, lookup_guest_orders_by_phone, request_user_login_code`
- `event-anchor-preserved` | `plan_field_subset` (hard) `information_state.pending_requests`
- `pending-topic-not-invitations` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: Continue the pending host-withdrawal question for Diana y Fernando. Acknowledge the supplied event name and explain the sourced processing policy (up to 72 business hours) and human review of the particular withdrawal. Do not restart, offer providers, list invitations/guest names, claim attendance or a withdrawal status, or ask for email/OTP. The fixture takeover succeeds.
- **BehaviorChanges vinculados (1):** `pending-information-event-reference-does-not-start-rsvp`

### `live_behavior.host_withdrawal_general_policy_only`

- **Fichero:** `evals/cases/live-behavior-host-withdrawal-general.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, faq, host-withdrawal, boundary`
- **Descripcion:** General host withdrawal timing needs sourced FAQ policy, not account lookups or a mandatory handoff.
- **Input turno 0:** "En general, ¿cuánto demoran en procesarse las solicitudes de retiro de fondos de un evento? No estoy consultando un retiro particular." (phone `+51985101461`, session `-`)
- **Fixture backend:** `scenario=support-continuity`
- **Que se valora:**
- `only-general-policy-work` | `tool_usage` (hard) debe llamar `knowledge_base_search` | prohibido `request_human_takeover, lookup_guest_orders_by_phone, lookup_guest_events_by_phone, lookup_rsvp_invitations, auth_by_phone, request_user_login_code`
- `no-handoff-required` | `plan_field_equals` (hard) `human_escalation.status`
- `sourced-general-window` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: Explain in Spanish the general policy of up to 72 business hours for processing host withdrawal requests. Do not claim to have verified an individual withdrawal, require account information, request human help, discuss guest payment validation, or introduce unrelated fees or specific arrival deadlines.
- **BehaviorChanges vinculados (1):** `host-withdrawal-policy-and-individual-status-support`

### `live_behavior.mailbox_issue_deferral_and_clarification_preserve_support`

- **Fichero:** `evals/cases/live-behavior-mailbox-continuity-maria-isabel.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 4 | **Tags:** `live, behavior, reported-interaction, support, continuity, maria-isabel`
- **Descripcion:** Reconstruct Maria Isabel's transfer-proof greeting, mailbox-capacity report, deferral and misspelled clarification without a restart or irrelevant purchase search.
- **Input turno 0:** "Hola" (phone `+51900000302`, session `-`)
- **Input turno 1:** "Tengo un problema de capacidad en mi gmail registrado" (phone `+51900000302`, session `-`)
- **Input turno 2:** "Lo voy a enviar luego" (phone `+51900000302`, session `-`)
- **Input turno 3:** "Esta lkeno" (phone `+51900000302`, session `-`)
- **Fixture backend:** `scenario=mailbox-continuity-maria-isabel`
- **Seed plan keys:** `conversation_summary`
- **Que se valora:**
- `report-enters-support` | `node_transition` (hard) -> `resolver_consultas_informativas` turno 1
- `deferral-does-not-fetch-or-authenticate` | `tool_usage` (hard) turno 2 | prohibido `lookup_guest_orders_by_phone, lookup_guest_gift_purchases_by_phone, knowledge_base_search, auth_by_phone, request_user_login_code, verify_user_login_code`
- `clarification-stays-in-support` | `node_transition` (hard) -> `resolver_consultas_informativas` turno 3
- `acknowledge-mailbox-not-welcome` | `text_semantic` (hard) turno 1 juez minScore=0.9 requireJudge=True
  > Rubrica juez: Concise Spanish acknowledgment of the reported capacity problem in the registered mailbox, optionally one relevant clarification. Do not give a generic welcome, ask what the user needs, select a historical purchase, claim to inspect the image, verify payment receipt or ask for email OTP. Do not invent a mailbox-specific company policy.
- `acknowledge-deferral-without-inventing-referent` | `text_semantic` (hard) turno 2 juez minScore=0.9 requireJudge=True
  > Rubrica juez: An empty assistant response is fully correct when the response classifier suppresses this simple deferral/acknowledgment. If a response is sent, continue the support topic in Spanish and briefly acknowledge that the person will send something later. Do not reset the conversation, repeat the introduction, claim payment approval, or confidently invent what the ambiguous 'lo' refers to.
- `understand-full-mailbox-clarification` | `text_semantic` (hard) turno 3 juez minScore=0.9 requireJudge=True
  > Rubrica juez: Understand 'Esta lkeno' as clarification that the mailbox discussed earlier is full. Briefly acknowledge it in Spanish without asking again whether the mailbox is full, restarting with a welcome, listing unrelated purchases, asking for OTP, or claiming payment/proof validation or document delivery.
- **BehaviorChanges vinculados (4):** `typed-mailbox-support-act-preserves-conversation-continuity, compact-established-support-extractor-omits-planning-context, deterministic-support-acknowledgment-avoids-reply-model-and-lookups, typed-support-anchor-preserves-ambiguous-followup-lane`

### `live_behavior.nonphysical_purchase_omits_shipping`

- **Fichero:** `evals/cases/live-behavior-nonphysical-purchase-omits-shipping.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, purchase, shipping, disclosure`
- **Descripcion:** A nonphysical gift purchase must not create shipment or physical-delivery claims.
- **Input turno 0:** "Compré un regalo digital para una boda. ¿Cuándo lo despachan y en qué fecha llega?" (phone `-`, session `-`)
- **Que se valora:**
- `enters-information-flow` | `node_transition` () -> `resolver_consultas_informativas`
- `does-not-use-provider-tools` | `tool_usage` () | prohibido `search_providers_from_plan, search_providers_by_keyword, search_providers_by_category_location, get_provider_detail`
- `nonphysical-purchase-has-no-shipping-claim` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user explicitly says the purchased gift is digital, so there is no verified physical product to ship. Pass only if the response does not state or imply a dispatch date, delivery date, shipment status, courier process, tracking process, or physical delivery. It may explain that shipment does not apply to a nonphysical purchase or request the next authentication detail needed to inspect other purchase facts, but it must not create physical-fulfillment expectations. The response must be natural and entirely in Spanish except for literal addresses, codes, numbers, URLs, and proper names.
- `tokens-present` | `token_usage_present` ()
- **BehaviorChanges vinculados (3):** `omit-shipping-for-nonphysical-purchases, omit-cash-gift-shipping-fields-from-reply-model, withhold-blocked-information-intent-from-authentication-replies`

### `live_behavior.otp_nondelivery_auto_resends_once`

- **Fichero:** `evals/cases/live-behavior-otp-auto-resend-once.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, authentication, otp, nondelivery, reported-interaction`
- **Descripcion:** The first missing-code report must automatically resend once while preserving the protected request and without asking the user to choose another email path.
- **Input turno 0:** "No me llega ningún código." (phone `$PHONE_FIRST_FALLBACK_CONTACT_PHONE`, session `live-otp-nondelivery-auto-resend-session`)
- **Seed plan keys:** `current_node, contact_email, user_auth, information_state`
- **Que se valora:**
- `remains-in-information-flow-after-single-resend` | `node_transition` (hard) -> `resolver_consultas_informativas`
- `first-nondelivery-dispatches-exactly-the-resend-path` | `tool_usage` (hard) debe llamar `request_user_login_code` | prohibido `verify_user_login_code, request_human_takeover`
- `one-resend-is-recorded` | `plan_field_equals` (hard) `user_auth.otp_non_delivery_reports`
- `protected-query-remains-pending-after-resend` | `plan_field_subset` (hard) `information_state.pending_requests`
- `automatic-resend-language-has-no-choice-loop` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: This is the first report that the one-time code did not arrive during a protected purchase query. Pass only if the assistant says in natural Spanish that it resent a code to the known email and asks the person to paste it if it arrives. It must not ask whether to resend, request another email, claim authentication succeeded, lose the pending purchase question, or say that human support was already requested.
- **BehaviorChanges vinculados (1):** `automatically-resend-first-reported-otp-nondelivery`

### `live_behavior.otp_not_received_requires_response`

- **Fichero:** `evals/cases/live-behavior-otp-not-received.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, authentication, otp, reported-interaction`
- **Descripcion:** A repeated missing-code report after one resend must trigger a real handoff and preserve the protected question without another OTP loop.
- **Input turno 0:** "No me ha llegado" (phone `$PHONE_FIRST_FALLBACK_CONTACT_PHONE`, session `otp-not-received-session`)
- **Seed plan keys:** `current_node, contact_email, user_auth, information_state`
- **Que se valora:**
- `enters-human-handoff` | `node_transition` (hard) -> `solicitar_agente_humano`
- `challenge-and-question-remain-pending` | `plan_field_subset` (hard) `information_state.pending_requests`
- `missing-code-report-hands-off-without-another-code-operation` | `tool_usage` (hard) debe llamar `request_human_takeover` | prohibido `request_user_login_code, verify_user_login_code`
- `handoff-is-persisted` | `plan_field_equals` (hard) `human_escalation.status`
- `ends-code-delivery-loop` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user reports for a second time that the one-time code has not arrived after the system already resent it once. Pass only if the assistant confirms in natural Spanish that human support has now been requested and leaves the conversation with that team. It must not ask for another email or code, repeat inbox instructions, claim authentication succeeded, or invent an answer to the protected event question.
- **BehaviorChanges vinculados (4):** `respond-to-missing-otp-reports, preserve-associated-event-otp-nondelivery-action, hand-off-after-exhausted-otp-nondelivery-recovery, hand-off-after-terminal-auth-service-failures`

### `live_behavior.otp_number_words_are_verified`

- **Fichero:** `evals/cases/live-behavior-otp-number-words.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, authentication, otp, reported-interaction`
- **Descripcion:** An OTP written as unambiguous Spanish digit words must be normalized and submitted instead of rejected as prose.
- **Input turno 0:** "Uno cuatro siete cinco uno cinco" (phone `+51959307414`, session `live-behavior-otp-number-words-session`)
- **Seed plan keys:** `current_node, contact_email, contact_phone, user_auth, information_state`
- **Que se valora:**
- `word-code-is-submitted` | `tool_usage` (hard) debe llamar `verify_user_login_code`
- `word-code-is-not-rejected-for-format` | `text_not_contains` (hard) prohibido `escríbelo como números, sin palabras, no pude leer el código`
- `word-code-receives-correct-outcome` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user supplied a six-digit one-time code as an unambiguous sequence of Spanish digit words. Pass only if the agent treats it as a code and attempts verification. The response may report the backend verification result, but it must not ask the user to rewrite the same code using digits or claim that number words are unreadable. It must not invent a purchase result before authentication succeeds, and it must remain entirely in Spanish except for literal addresses, codes, numbers, URLs, and proper names.
- **BehaviorChanges vinculados (1):** `accept-otp-expressed-as-spanish-digit-words`

### `live_behavior.otp_sent_explains_image_limitation`

- **Fichero:** `evals/cases/live-behavior-otp-sent-image-guidance.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, authentication, otp, image-limitation`
- **Descripcion:** After sending an email code, the assistant asks the user to copy and paste it without the confusing word text.
- **Input turno 0:** "Mi correo registrado es regression-image-code@example.invalid." (phone `-`, session `otp-sent-image-guidance-session`)
- **Fixture backend:** `scenario=otp-sent-image-guidance`
- **Seed plan keys:** `current_node, information_state`
- **Que se valora:**
- `requests-email-code-without-phone-lookup` | `tool_usage` (hard) debe llamar `request_user_login_code` | prohibido `auth_by_phone, verify_user_login_code`
- `code-challenge-persists` | `plan_field_equals` (hard) `user_auth.status`
- `post-send-image-guidance` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: Pass only if the assistant responds naturally and entirely in Spanish that a one-time code was sent to the provided email, explicitly explains that it cannot read images or screenshots, and directly asks the user to copy and paste the code here. It must not use the word “texto” as an instruction, ask for the WhatsApp number, or claim that the protected event question has already been answered.
- **BehaviorChanges vinculados (5):** `explain-image-limitation-after-sending-otp, request-email-code-by-copy-and-paste-without-text-wording, consolidate-resolver-otp-email-duplication, text-plus-image-never-claims-content-access, fixture-local-email-otp-outcomes`

### `live_behavior.payment_destination_requires_pending_purchase`

- **Fichero:** `evals/cases/live-behavior-payment-destination-requires-pending.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, purchase, payment, disclosure`
- **Descripcion:** A payment destination must not be disclosed before a specific pending purchase is verified.
- **Input turno 0:** "Quiero pagar un regalo por Yape o transferencia. Pásame el número de la cuenta." (phone `-`, session `-`)
- **Que se valora:**
- `enters-information-flow` | `node_transition` () -> `resolver_consultas_informativas`
- `does-not-use-provider-tools` | `tool_usage` () | prohibido `search_providers_from_plan, search_providers_by_keyword, search_providers_by_category_location, get_provider_detail`
- `payment-destination-requires-pending-purchase` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user asks for a Yape or bank-transfer destination but no authenticated, specific pending purchase has been established. Pass only if the response does not disclose or invent any phone number, account number, CCI, bank destination, or payment destination, and does not imply that a pending purchase has already been found. It may request only the next necessary account-verification detail before looking up purchases; once authenticated, a destination may be disclosed only for the identified purchase when its status is pending. The response must be natural and entirely in Spanish except for li
- `tokens-present` | `token_usage_present` ()
- **BehaviorChanges vinculados (1):** `withhold-payment-destination-without-pending-purchase`

### `live_behavior.pending_balance_validation_luis`

- **Fichero:** `evals/cases/live-behavior-pending-balance-luis.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 2 | **Tags:** `live, behavior, purchase, balance, validation, reported-interaction, luis`
- **Descripcion:** Luis pending Alejandra order and cart with null currency; balance reported as unknown and validation window applied.
- **Input turno 0:** "Consulta por Alejandra. El pedido figura pendiente por Yape. Cuanto me falta?" (phone `+51938389389`, session `live-pending-balance-luis-session`)
- **Input turno 1:** "Ya envié los 13.76 que faltaban, tengo el voucher." (phone `+51938389389`, session `live-pending-balance-luis-session`)
- **Fixture backend:** `scenario=purchase-luis-389`
- **Que se valora:**
- `pending-balance-enters-information` | `node_transition` (hard) -> `resolver_consultas_informativas` turno 0
- `pending-balance-uses-phone-partitions` | `tool_usage` (hard) turno 0 debe llamar `lookup_guest_orders_by_phone` | prohibido `auth_by_phone, request_user_login_code, verify_user_login_code`
- `balance-unknown-no-currency` | `text_semantic` (hard) turno 0 juez minScore=0.9 requireJudge=True
  > Rubrica juez: The phone lookup returns a pending Alejandra order for 227.76 via Yape and a same-event active cart; currency is null and no balance-due or amount-received fields exist. The backend method enum is Yape_o_Plin (combined name from the real API); rendering "Yape o Plin" or naming the registered method family is grounded, covered by the indexed validation-window policy. The answer must be concise, natural Latin American Spanish, report the pending total with method without adding a currency symbol, state that the remaining balance cannot be confirmed from the available record, and explain that Yap
- `voucher-does-not-confirm` | `text_semantic` (hard) turno 1 juez minScore=0.9 requireJudge=True
  > Rubrica juez: This is the same Alejandra thread; the user reports sending the shortfall with a voucher image. The answer must stay on that pending order, acknowledge the report, restate that receipt cannot be confirmed from an image and the order remains pending pending backend validation, and repeat the 72 business hour window. It must not restart with a generic welcome, claim the payment was validated, or present a currency that the backend did not supply.
- **BehaviorChanges vinculados (7):** `pending-balance-validation-luis, selector-guard-single-pending-amount-as-payment-evidence, declarative-pending-amount-extraction-example, classifier-active-information-thread-evidence, payment-report-provenance-and-voucher-fragment, null-currency-remains-uninferred, server-event-timestamps-validated-without-conversion`

### `live_behavior.phone_account_rejection_requests_email`

- **Fichero:** `evals/cases/live-behavior-phone-account-rejected.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, authentication, phone-first, email-fallback`
- **Descripcion:** An explicit rejection of the current phone account clears phone authentication and requests the registered email.
- **Input turno 0:** "Esa no es mi cuenta ni el número que tengo registrado." (phone `$TERMINAL_CONTACT_PHONE`, session `phone-account-rejected-session`)
- **Seed plan keys:** `current_node, user_auth, information_state`
- **Que se valora:**
- `rejected-phone-is-not-retried` | `tool_usage` (hard) | prohibido `auth_by_phone, request_user_login_code, verify_user_login_code`
- `phone-authentication-is-cleared` | `plan_field_equals` (hard) `user_auth.status`
- `protected-question-remains-pending` | `plan_field_subset` (hard) `information_state.pending_requests`
- `requests-registered-email-after-rejection` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user explicitly says the current phone/account is not theirs. The response must ask in natural Spanish for the email registered in Sin Envolturas so the protected event question can continue. It must not retry phone authentication, send a code before receiving an email, or claim authentication succeeded.
- **BehaviorChanges vinculados (3):** `fall-back-after-explicit-phone-account-rejection, disable-phone-scoped-guest-access-after-explicit-phone-rejection, distinguish-phone-association-rejection-from-authentication-refusal`

### `live_behavior.phone_confirmation_unclear_requires_yes_or_no`

- **Fichero:** `evals/cases/live-behavior-phone-confirmation-unclear.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, authentication, phone-first, reported-interaction`
- **Descripcion:** A stale imprecise answer after the retired confirmation prompt must use phone-scoped event context directly instead of asking again.
- **Input turno 0:** "Este" (phone `$TERMINAL_CONTACT_PHONE`, session `phone-confirmation-unclear-session`)
- **Seed plan keys:** `current_node, user_auth, information_state`
- **Que se valora:**
- `stale-confirmation-is-cleared` | `plan_field_equals` (hard) `user_auth.awaiting_phone_confirmation`
- `current-phone-event-context-is-read-directly` | `tool_usage` (hard) debe llamar `lookup_guest_events_by_phone, get_guest_event_detail` | prohibido `auth_by_phone, request_user_login_code, verify_user_login_code`
- `no-account-authentication-persists` | `plan_field_equals` (hard) `user_auth.status`
- `does-not-repeat-retired-confirmation` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user answered only “Este” in a conversation seeded from the retired phone-confirmation flow. Pass if the response continues the preserved event question naturally in Spanish using the trusted phone's event context. It must not ask for another yes/no confirmation, ask the user to repeat the known question, authenticate an account, or request an email or one-time code.
- **BehaviorChanges vinculados (5):** `remove-stale-retired-confirmation-summary, recover-retired-phone-confirmation-state, clear-retired-phone-confirmation-ambiguity, clarify-imprecise-phone-confirmation-answers, preserve-resolved-information-query-in-reply-evidence`

### `live_behavior.phone_purchase_missing_hands_off_once`

- **Fichero:** `evals/cases/live-behavior-phone-missing-information.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 2 | **Tags:** `live, behavior, purchase, phone, human-handoff, reported-interaction`
- **Descripcion:** Empty trusted-phone orders and carts preserve a purchase query and request human help once, without automatic email verification.
- **Input turno 0:** "Quiero consultar si mi compra está confirmada. No tengo una cuenta registrada." (phone `+51985101461`, session `live-phone-missing-purchase`)
- **Input turno 1:** "Gracias, espero al equipo." (phone `+51985101461`, session `live-phone-missing-purchase`)
- **Fixture backend:** `scenario=support-continuity`
- **Que se valora:**
- `scoped-lookup-and-handoff` | `tool_usage` (hard) turno 0 debe llamar `lookup_guest_orders_by_phone, request_human_takeover` | prohibido `auth_by_phone, request_user_login_code, verify_user_login_code`
- `manual-help-requested` | `plan_field_equals` (hard) `human_escalation.status` turno 0
- `purchase-query-retained` | `plan_field_subset` (hard) `information_state.pending_requests` turno 0
- `no-repeat-handoff-or-otp` | `tool_usage` (hard) turno 1 | prohibido `request_human_takeover, request_user_login_code, verify_user_login_code, lookup_guest_orders_by_phone`
- `scoped-missing-data-handoff-not-account-login` | `text_semantic` (hard) turno 0 juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user asks whether their purchase is confirmed and has no registered account. The trusted-phone fixture has no orders or carts, and human takeover succeeds. Reply in Spanish that the requested information was not found associated with this number and human support was requested to continue the purchase query. Do not ask for email or OTP, globally deny that a purchase exists, claim a payment status, or promise a guaranteed response time. Preserve the user's purchase question.
- **BehaviorChanges vinculados (1):** `phone-scoped-misses-request-human-help-without-automatic-otp`

### `live_behavior.provider_reference_cheaper_option`

- **Fichero:** `evals/cases/live-behavior-provider-reference-cheaper.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, provider-selection, reference, price`
- **Descripcion:** A comparative reference to the cheaper shortlisted provider must resolve from retained provider evidence.
- **Input turno 0:** "Quiero la opción más económica." (phone `-`, session `live-behavior-provider-cheaper-session`)
- **Seed plan keys:** `current_node, event_type, location, guest_range, active_need_category, vendor_category, preferences, hard_constraints, provider_needs`
- **Que se valora:**
- `cheaper-provider-selected` | `plan_field_subset` () `provider_needs`
- `selection-operation-recorded` | `trace_field_subset` () `selection_resolution_summary.provider_plan_operation_types`
- `no-new-provider-search` | `tool_usage` () | prohibido `search_providers_from_plan, search_providers_by_query_intent`
- `cheaper-reference-response` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The retained shortlist shows Opción Esencial as cheaper than EDO Sushi Bar. Pass only if the response selects or clearly confirms Opción Esencial from that evidence, preserves the catering need and the user's budget criteria, and does not ask which option is cheaper, run a new search, or select the more expensive provider. The response must be natural and entirely in Spanish except for proper names, literal values, URLs, addresses, numbers, and codes.
- **BehaviorChanges vinculados (1):** `resolve-provider-price-references`

### `live_behavior.provider_reference_miraflores_option`

- **Fichero:** `evals/cases/live-behavior-provider-reference-miraflores.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, provider-selection, reference, location`
- **Descripcion:** A location reference to the Miraflores shortlisted provider must resolve from retained provider evidence.
- **Input turno 0:** "Quiero la opción que está en Miraflores." (phone `-`, session `live-behavior-provider-miraflores-session`)
- **Seed plan keys:** `current_node, event_type, location, guest_range, active_need_category, vendor_category, preferences, hard_constraints, provider_needs`
- **Que se valora:**
- `miraflores-provider-selected` | `plan_field_subset` () `provider_needs`
- `location-selection-operation-recorded` | `trace_field_subset` () `selection_resolution_summary.provider_plan_operation_types`
- `no-new-provider-search` | `tool_usage` () | prohibido `search_providers_from_plan, search_providers_by_query_intent`
- `miraflores-reference-response` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The retained shortlist shows Opción Esencial in Miraflores and EDO Sushi Bar in Barranco. Pass only if the response selects or clearly confirms Opción Esencial from the location reference, preserves the catering need, and does not ask which provider is in Miraflores, run a new search, or select the Barranco provider. The response must be natural and entirely in Spanish except for proper names, literal values, URLs, addresses, numbers, and codes.
- **BehaviorChanges vinculados (1):** `resolve-provider-location-references`

### `live_behavior.purchase_confirmation_carina_request_survives_normalization`

- **Fichero:** `evals/cases/live-behavior-purchase-confirmation-carina.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 2 | **Tags:** `live, behavior, reported-interaction, purchase, normalization, carina`
- **Descripcion:** Reconstruct the repeated payment-confirmation requests after the current-event campaign without silently losing neutral authentication actions.
- **Input turno 0:** "Me podrían mandar una conformidad de pago" (phone `+51900000301`, session `-`)
- **Input turno 1:** "Quisiera que me manden una conformidad de pago, compré un regalo" (phone `+51900000301`, session `-`)
- **Fixture backend:** `scenario=purchase-confirmation-carina`
- **Seed plan keys:** `conversation_summary`
- **Que se valora:**
- `ambiguous-request-clarifies-before-lookup` | `trace_field_equals` (hard) `capability_decision` turno 0
- `ambiguous-request-does-not-choose-an-operation` | `trace_field_equals` (hard) `requested_operation` turno 0
- `ambiguous-request-no-external-call` | `tool_usage` (hard) turno 0 | prohibido `lookup_guest_orders_by_phone, lookup_guest_gift_purchases_by_phone, request_user_login_code, verify_user_login_code, auth_by_phone, request_human_takeover`
- `asks-one-status-or-document-question` | `text_semantic` (hard) turno 0 juez minScore=0.9 requireJudge=True
  > Rubrica juez: Ask exactly one concise clarification in Spanish distinguishing a request to consult the recorded payment status from a request to have a payment confirmation document sent. Do not look up either purchase, start authentication, greet generically, select the old Micaela & Gonzalo purchase, assume currency, expose internal IDs, or claim that a document was sent. The clarification should not assert that the current order is approved before the user identifies the desired operation.
- `clarified-request-looks-up-current-order` | `tool_usage` (hard) turno 1 debe llamar `lookup_guest_orders_by_phone` | prohibido `request_user_login_code, verify_user_login_code, auth_by_phone, request_human_takeover`
- `answer-current-payment` | `text_semantic` (hard) turno 1 juez minScore=0.9 requireJudge=True
  > Rubrica juez: Respond in concise Spanish to the clarified payment-status request for the current ANDREA & RODRIGO purchase. State that the current order is approved and report its recorded amount without inventing a currency. Do not select the old Micaela & Gonzalo purchase, expose internal IDs, claim a document was sent, inspect an uploaded voucher, or start an OTP flow. Continue the conversation rather than sending a generic welcome.
- **BehaviorChanges vinculados (7):** `preserve-neutral-auth-purchase-extraction-instead-of-welcome, confirmation-document-checks-canonical-status-and-hands-off-once, rejected-purchase-extraction-cannot-fall-through-to-welcome, phone-scoped-human-handoff-uses-only-trusted-channel-phone, unsupported-document-safe-read-and-single-handoff, extractor-emits-requested-operation-without-availability, gateway-capability-manifest-intersection`

### `live_behavior.purchase_current_pending_over_old_approved`

- **Fichero:** `evals/cases/live-behavior-purchase-current-vs-old.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, purchase, selection, contradiction, reported-interaction, victor`
- **Descripcion:** Explicit event, amount, date, and status select Victor's current pending gift instead of an older approved purchase.
- **Input turno 0:** "Revisa el regalo de S/ 80 para Samuel Josué que hice por Yape el 29 de agosto de 2026. ¿Ya está aprobado o sigue pendiente?" (phone `+51981056171`, session `live-purchase-current-vs-old-session`)
- **Fixture backend:** `scenario=purchase-victor-171`
- **Que se valora:**
- `current-purchase-enters-information` | `node_transition` (hard) -> `resolver_consultas_informativas`
- `current-purchase-uses-phone-orders` | `tool_usage` (hard) debe llamar `lookup_guest_orders_by_phone` | prohibido `auth_by_phone, request_user_login_code, verify_user_login_code`
- `current-pending-wins-over-old-approved` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The phone lookup returns two purchases: a current Samuel Josué purchase for 80 created on 2026-08-29 with pending status and null currency (recorded_method_no_currency), and an older Josué y Paola purchase for 88.18 with approved status. The user's explicit event, amount, date, and requested status identify the current Samuel Josué purchase. The backend method enum is Yape_o_Plin (combined name from the real API); rendering "Yape o Plin" or naming the registered method family is grounded, covered by the indexed validation-window policy. The response must be concise, natural, and entirely in Sp
- **BehaviorChanges vinculados (2):** `current-pending-over-historical-completed, payment-identifier-reply-exclusion-and-constancia-anchor-rewording`

### `live_behavior.purchase_delia_status_by_phone`

- **Fichero:** `evals/cases/live-behavior-purchase-delia-phone-orders.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, purchase, phone-orders, reported-interaction, delia`
- **Descripcion:** Delia's payment status is answered from phone-scoped order summaries without an account or OTP loop.
- **Input turno 0:** "Ya pagué el regalo para Caroline & Jason. ¿Mi pago está aprobado?" (phone `+51962983263`, session `live-purchase-delia-phone-orders-session`)
- **Que se valora:**
- `delia-enters-information` | `node_transition` (hard) -> `resolver_consultas_informativas`
- `delia-uses-order-summary-only` | `tool_usage` (hard) debe llamar `lookup_guest_orders_by_phone` | prohibido `lookup_guest_gift_purchases_by_phone, auth_by_phone, request_user_login_code, verify_user_login_code`
- `delia-approved-payment-is-reported` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The phone-scoped order lookup contains Delia's approved gift purchase for Caroline & Jason. The answer must be concise, natural, and entirely in Spanish; clearly say the payment is approved. It must not ask for email, an OTP, account registration, or a payment receipt, and must not expose private payment identifiers or gateway data.
- **BehaviorChanges vinculados (3):** `route-phone-purchase-summary-without-account-auth, reconcile-phone-purchase-sources-with-minimum-disclosure, scope-information-domain-to-route`

### `live_behavior.purchase_joaquin_dedication_selection`

- **Fichero:** `evals/cases/live-behavior-purchase-joaquin-dedication.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, purchase, gift-detail, selection, reported-interaction, joaquin`
- **Descripcion:** Joaquín's dedication request uses phone-scoped gift details and asks him to select among multiple purchases without authentication.
- **Input turno 0:** "Quisiera cambiar la dedicatoria de un regalo que hice para Chiara Vittoria." (phone `+51926857444`, session `live-purchase-joaquin-dedication-session`)
- **Que se valora:**
- `joaquin-enters-information` | `node_transition` (hard) -> `resolver_consultas_informativas`
- `joaquin-uses-detailed-gift-read` | `tool_usage` (hard) debe llamar `lookup_guest_gift_purchases_by_phone` | prohibido `lookup_guest_orders_by_phone, auth_by_phone, request_user_login_code, verify_user_login_code`
- `joaquin-is-asked-to-select-one-purchase` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The phone-scoped gift-purchase lookup finds more than one purchase for Chiara Vittoria. The answer must be concise, natural, and entirely in Spanish; present compact distinguishing information for the matching purchases and ask Joaquín in one question which purchase he means. It must not claim that the dedication was already changed, ask for email or a code, or disclose sensitive payment or bank data.
- **BehaviorChanges vinculados (2):** `route-phone-gift-detail-without-account-auth, reconcile-phone-purchase-sources-with-minimum-disclosure`

### `live_behavior.purchase_kiara_pending_by_phone`

- **Fichero:** `evals/cases/live-behavior-purchase-kiara-phone-orders.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, purchase, phone-orders, reported-interaction, kiara`
- **Descripcion:** Kiara's pending gift status is answered from phone-scoped orders without requesting an OTP that may never arrive.
- **Input turno 0:** "Hice la compra para Suki Sofía pero no me llegó confirmación. ¿Cuál es el estado?" (phone `+51999927635`, session `live-purchase-kiara-phone-orders-session`)
- **Que se valora:**
- `kiara-enters-information` | `node_transition` (hard) -> `resolver_consultas_informativas`
- `kiara-uses-order-summary-only` | `tool_usage` (hard) debe llamar `lookup_guest_orders_by_phone` | prohibido `lookup_guest_gift_purchases_by_phone, auth_by_phone, request_user_login_code, verify_user_login_code`
- `kiara-pending-status-is-reported` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The phone-scoped order result for Suki Sofía is pending. The answer must be concise, natural, and entirely in Spanish; explain that the payment or gift is still pending or being verified, without calling it approved or failed. It must not ask for email, an OTP, another registration, or a screenshot.
- **BehaviorChanges vinculados (1):** `route-phone-purchase-summary-without-account-auth`

### `live_behavior.purchase_martha_accountless_selection`

- **Fichero:** `evals/cases/live-behavior-purchase-martha-accountless.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, purchase, phone-orders, accountless, selection, reported-interaction, martha`
- **Descripcion:** Martha's purchases are found by trusted phone even though she has no account, and multiple records are presented for selection without OTP.
- **Input turno 0:** "No me registré ni tengo cuenta. Quiero saber qué pasó con el regalo que intenté pagar." (phone `+51922701221`, session `live-purchase-martha-accountless-session`)
- **Que se valora:**
- `martha-enters-information` | `node_transition` (hard) -> `resolver_consultas_informativas`
- `martha-uses-phone-orders-without-auth` | `tool_usage` (hard) debe llamar `lookup_guest_orders_by_phone` | prohibido `lookup_guest_gift_purchases_by_phone, auth_by_phone, request_user_login_code, verify_user_login_code, request_human_takeover`
- `martha-is-given-purchase-selection` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The trusted phone has multiple historical order records but no associated guest event. The answer must be concise, natural, and entirely in Spanish; show compact distinguishing information for the available orders and ask Martha which one she means. It must not say no information was found, infer an invitation or event association, ask for email or a code, require account creation, or expose sensitive payment data.
- **BehaviorChanges vinculados (1):** `resolve-accountless-phone-purchases-without-otp-loop`

### `live_behavior.purchase_pending_transfer_continuity`

- **Fichero:** `evals/cases/live-behavior-purchase-pending-transfer-continuity.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 3 | **Tags:** `live, behavior, purchase, transfer, timezone, currency, continuity, reported-interaction`
- **Descripcion:** A pending transfer keeps its purchase context, uses the verified validation window, and never invents currency or local time from incomplete backend fields.
- **Input turno 0:** "El pago por transferencia para Claudia & Luis Felipe figura en proceso. ¿Cuándo sabré que ya se validó?" (phone `+51957212085`, session `live-pending-transfer-continuity-session`)
- **Input turno 1:** "¿Recibiré una constancia? El monto es en dólares, no en soles." (phone `+51957212085`, session `live-pending-transfer-continuity-session`)
- **Input turno 2:** "Además, lo hice el 30 de agosto a las 9:31 p. m.; el registro sin zona horaria parece decir 31 a las 2:31 a. m." (phone `+51957212085`, session `live-pending-transfer-continuity-session`)
- **Fixture backend:** `scenario=purchase-claudia-085`
- **Que se valora:**
- `pending-transfer-stays-information` | `node_transition` (hard) -> `resolver_consultas_informativas` turno 0
- `pending-transfer-uses-phone-detail` | `tool_usage` (hard) turno 0 debe llamar `lookup_guest_orders_by_phone` | prohibido `auth_by_phone, request_user_login_code, verify_user_login_code`
- `pending-transfer-explains-window` | `text_semantic` (hard) turno 0 juez minScore=0.9 requireJudge=True
  > Rubrica juez: The trusted-phone purchase evidence identifies the Claudia & Luis Felipe gift as pending and paid by bank transfer. The answer must be concise, natural, and entirely in Spanish; explain that validation for a pending non-card/non-PayPal payment can take up to 72 business hours. It must not claim an exact approval time, ask for email or an OTP, or expose payment identifiers, bank data, or an internal order id.
- `currency-correction-stays-information` | `node_transition` (hard) -> `resolver_consultas_informativas` turno 1
- `ambiguous-backend-time-does-not-reset` | `node_transition` (hard) -> `resolver_consultas_informativas` turno 2
- `currency-time-claims-remain-grounded` | `text_semantic` (hard) turno 2 juez minScore=0.9 requireJudge=True
  > Rubrica juez: This is a contextual correction to the same Claudia & Luis Felipe purchase, not a new event-planning conversation. The available purchase response does not supply a currency and its paid_at value has no time-zone offset. The answer must remain on that purchase, acknowledge the user's correction, and avoid claiming that the backend independently verifies USD or an exact Lima date/time. It may explain that those two details cannot be confirmed from the available record. It must not greet the user as a new conversation, ask what event they are planning, repeat a generic Sin Envolturas introductio
- **BehaviorChanges vinculados (12):** `purchase-pending-transfer-currency-time-continuity, reconcile-event-conjunctions-in-phone-purchase-selection, preserve-primary-purchase-across-derived-policy-continuations, project-derived-purchase-policies-with-minimum-disclosure, classify-receipt-and-currency-corrections-as-purchase-continuations, preserve-reextracted-purchase-identity-across-corrections, project-unverifiable-purchase-currency-and-time-as-typed-limits, constancia-anchor-cod-reference-conditional, payment-identifier-reply-exclusion-and-constancia-anchor-rewording, currency-correction-grounding-in-purchase-replies, runtime-capability-manifest-bounds-unsupported-actions, server-timestamps-preserve-upstream-values`

### `live_behavior.repeated_otp_failure_preserves_gift_query`

- **Fichero:** `evals/cases/live-behavior-repeated-otp-failure.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 3 | **Tags:** `live, behavior, authentication, purchase, reported-interaction`
- **Descripcion:** A second rejected, correctly formatted OTP must end the repetitive code loop while preserving the reported gift-deposit query.
- **Input turno 0:** "753994" (phone `-`, session `live-behavior-repeated-otp-session`)
- **Input turno 1:** "753994" (phone `-`, session `live-behavior-repeated-otp-session`)
- **Input turno 2:** "Ese es el código que me llegó" (phone `-`, session `live-behavior-repeated-otp-session`)
- **Seed plan keys:** `current_node, contact_email, contact_phone, user_auth, information_state`
- **Que se valora:**
- `first-code-verified-once` | `tool_usage` () turno 0 debe llamar `verify_user_login_code`
- `second-code-verified-once` | `tool_usage` () turno 1 debe llamar `verify_user_login_code, request_human_takeover`
- `prose-follow-up-does-not-reverify` | `tool_usage` () turno 2 | prohibido `verify_user_login_code`
- `failed-attempts-are-bounded` | `plan_field_equals` () `user_auth.failed_code_attempts`
- `repeated-failure-persists-human-handoff` | `plan_field_equals` (hard) `human_escalation.status`
- `gift-query-remains-pending` | `plan_field_subset` () `information_state.pending_requests`
- `no-copy-blame-or-email-loop-after-second-failure` | `text_not_contains` () turno 1 prohibido `cópialo completo, sin espacios adicionales, correo no deseado, bandeja principal`
- `correct-repeated-code-recovery` | `text_semantic` (hard) turno 1 juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user entered the same correctly formatted six-digit code twice after it was rejected by the verification service. Pass only if the response says in natural Spanish that human support has now been requested, does not ask for another code attempt or repeat inbox instructions, and preserves the pending question about whether the gift deposit reached the couple. It must not claim that the payment succeeded or failed because no authenticated purchase result exists.
- **BehaviorChanges vinculados (5):** `stop-repeated-verification-loops, persist-sanitized-authentication-execution-diagnostics, distinguish-otp-transport-failures-from-invalid-codes, preserve-original-protected-query-through-authentication-continuations, name-the-pending-query-in-terminal-authentication-handoffs`

### `live_behavior.reset_plan_discards_stored_context`

- **Fichero:** `evals/cases/live-behavior-reset-plan.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, planning, reset, state-machine, reported-interaction`
- **Descripcion:** An explicit request to start over must atomically replace the stored event plan before replying.
- **Input turno 0:** "No no, quisiera empezar de nuevo, ¿podemos?" (phone `+51973296571`, session `live-behavior-reset-plan-session`)
- **Seed plan keys:** `current_node, lifecycle_state, intent, event_type, vendor_category, active_need_category, location, guest_range, contact_name, contact_email, contact_phone, preferences, provider_needs, recommended_provider_ids, selected_provider_ids, conversation_summary, last_user_goal`
- **Que se valora:**
- `reset-is-a-native-state-transition` | `node_transition` (hard) -> `reset_plan`
- `reset-route-is-explicit` | `trace_field_equals` (hard) `route_kind`
- `fresh-plan-is-persisted` | `trace_field_equals` (hard) `plan_persisted`
- `old-event-is-cleared` | `plan_field_equals` (hard) `event_type`
- `old-location-is-cleared` | `plan_field_equals` (hard) `location`
- `old-contact-email-is-cleared` | `plan_field_equals` (hard) `contact_email`
- `old-provider-needs-are-cleared` | `plan_field_equals` (hard) `provider_needs`
- `reset-does-not-search-or-close` | `tool_usage` (hard) | prohibido `search_providers_from_plan, search_providers_by_query_intent, create_quote_request, finish_plan`
- `reset-response-confirms-completed-state-and-continues` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: This case reconstructs the reported WhatsApp reset request over a stored wedding plan. Pass only if the Spanish response clearly says the previous plan has already been discarded or that the conversation is now starting from zero, then asks one concise open question about the new event or what the person needs. It must not merely promise to reset later, retain or mention the old wedding, Lima, guest count, contact data, Carla Muñoz, or wedding planners, search providers, present a step-by-step process, or ask the person to repeat the reset request.
- **BehaviorChanges vinculados (2):** `support-native-structured-plan-reset, discard-all-stored-planning-context-on-reset`

### `live_behavior.rsvp_ambiguous_event_requires_grounded_selection`

- **Fichero:** `evals/cases/live-behavior-rsvp-ambiguous-event.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, rsvp, attendance, ambiguity, reported-interaction`
- **Descripcion:** An underspecified event reference cannot select or mutate one of several persisted RSVP candidates.
- **Input turno 0:** "Ese." (phone `+12025550100`, session `live-rsvp-ambiguous-event-session`)
- **Seed plan keys:** `current_node, intent, rsvp_state`
- **Que se valora:**
- `remains-in-rsvp-node` | `node_transition` (hard) -> `responder_invitacion`
- `preserves-event-selection-state` | `plan_field_equals` (hard) `rsvp_state.status`
- `records-one-ambiguous-attempt` | `plan_field_equals` (hard) `rsvp_state.selection_attempts`
- `does-not-mutate-an-ungrounded-candidate` | `tool_usage` (hard) | prohibido `guest_rsvp, auth_by_phone, request_user_login_code, verify_user_login_code`
- `asks-which-persisted-event` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The guest says only “Ese” while two invitation candidates are pending: Matrimonio de Ana y Luis on 12 September 2026 and Cumpleaños de Marta on 19 September 2026. The response must not choose either event or claim that attendance was registered. It must identify the two available events with their dates (12 September 2026 and 19 September 2026) in natural Spanish and ask which one the guest means, without requesting email or an authentication code.
- `projection-carries-candidate-dates` | `text_contains` (hard) contiene `12 de septiembre de 2026, 19 de septiembre de 2026`
- `no-rsvp-vocabulary` | `text_not_contains` (hard) prohibido `RSVP, rsvp`
- **BehaviorChanges vinculados (5):** `persist-multiple-pending-rsvp-candidates, reject-ungrounded-rsvp-event-selection, keep-pending-rsvp-followups-unsuppressed, parse-documented-rsvp-pending-guests-envelope, needs-event-selection-projection-carries-candidate-dates`

### `live_behavior.rsvp_state_reversal_ends_confirmed`

- **Fichero:** `evals/cases/live-behavior-rsvp-attendance-confirmed.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, rsvp, attendance, backend-contract, state-reversal, idempotency`
- **Descripcion:** An affirmative attendance request ends in a backend-grounded confirmed state, whether the service changes a previous decline or reports that attendance is already confirmed.
- **Input turno 0:** "Sí, cámbiala para confirmar que asistiré." (phone `+51973296571`, session `live-rsvp-attendance-confirmed-session`)
- **Seed plan keys:** `current_node, intent, rsvp_state`
- **Que se valora:**
- `remains-in-rsvp-node` | `node_transition` (hard) -> `responder_invitacion`
- `reads-authoritative-rsvp-state` | `tool_usage` (hard) debe llamar `lookup_rsvp_invitations` | prohibido `auth_by_phone, request_user_login_code, verify_user_login_code`
- `reports-confirmed-final-state` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user has explicitly confirmed that they want to attend guest invitation 584353 for Otra celebración prueba. The authoritative final state says the guest will attend: the production endpoint may have changed a previous decline, or the invitation may already be confirmed on a repeated run. The response must be natural and entirely in Spanish, clearly say that attendance is confirmed or was changed successfully, and must not claim that the invitation remains declined, ask for email or a code, expose internal fields, or offer human support as if the operation failed.
- `no-rsvp-vocabulary` | `text_not_contains` (hard) prohibido `RSVP, rsvp`
- **BehaviorChanges vinculados (5):** `reject-false-rsvp-success-from-already-responded-envelope, report-rsvp-state-only-after-explicit-backend-confirmation, accept-backend-confirmed-rsvp-state-reversal, apply-explicit-rsvp-reversals-in-one-turn, treat-will-attend-as-authoritative-rsvp-final-state`

### `live_behavior.rsvp_cinthya_campaign_invitation_not_reported_missing`

- **Fichero:** `evals/cases/live-behavior-rsvp-cinthya-campaign.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, rsvp, attendance, reported-interaction, campaign-context, concurrent-read`
- **Descripcion:** A campaign-grounded RSVP for Julisabeth y Andrés must reconcile both phone-scoped reads and must not be reported as a missing invitation.
- **Input turno 0:** "Gracias, confirmo asistencia" (phone `+51904523314`, session `live-rsvp-cinthya-campaign-session`)
- **Que se valora:**
- `enters-rsvp-node` | `node_transition` (hard) -> `responder_invitacion`
- `reads-user-level-state-without-account-auth` | `tool_usage` (hard) debe llamar `lookup_rsvp_invitations, lookup_guest_events_by_phone, get_guest_event_detail` | prohibido `guest_rsvp, auth_by_phone, request_user_login_code, verify_user_login_code`
- `preserves-campaign-grounded-invitation` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The reconciled phone evidence establishes that this number is associated with Julisabeth y Andrés, and the phone-enriched attendance says the guest has responded and will attend. The answer must remain entirely in Spanish, clearly say that attendance is already confirmed, thank the person, and say that no additional change was needed. It must not deny the invitation, ask for email or a code, or claim that a new RSVP mutation was made.
- `no-rsvp-vocabulary` | `text_not_contains` (hard) prohibido `RSVP, rsvp`
- **BehaviorChanges vinculados (9):** `preserve-campaign-grounded-rsvp-when-no-mutation-is-pending-cinthya, keep-first-turn-rsvp-decision-out-of-acknowledgement-suppression, require-structured-extraction-before-suppressing-campaign-replies, anchor-conversation-context-to-newest-campaign, fall-back-to-trusted-phone-event-association-for-rsvp, concurrently-read-rsvp-record-and-event-association-by-phone, project-one-minimal-reconciled-rsvp-phone-evidence-object, enrich-rsvp-state-through-phone-scoped-event, rsvp-resolved-single-thanks-no-change`

### `live_behavior.rsvp_confirmed_state_is_reported`

- **Fichero:** `evals/cases/live-behavior-rsvp-confirmed-state.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, rsvp, attendance, current-state, trusted-phone`
- **Descripcion:** A user-level invitation that already has attendance confirmed is reported via hybrid fragment plus natural tissue without another mutation.
- **Input turno 0:** "¿Mi asistencia a Otra celebración prueba ya está confirmada?" (phone `+51973296571`, session `live-rsvp-confirmed-state-session`)
- **Seed plan keys:** `current_node, intent, rsvp_state`
- **Que se valora:**
- `remains-in-rsvp-node` | `node_transition` (hard) -> `responder_invitacion`
- `reads-user-level-invitation-state` | `tool_usage` (hard) debe llamar `lookup_rsvp_invitations` | prohibido `guest_rsvp, auth_by_phone, request_user_login_code, verify_user_login_code`
- `clears-completed-rsvp-state` | `plan_field_equals` (hard) `rsvp_state.status`
- `reports-existing-confirmation-naturally` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The response must contain the deterministic attending fragment elements — polarity "figura que asistirás", confirmation "ya está confirmada", no-change clause "No fue necesario hacer otro cambio" and "no se realizó un nuevo registro", Spanish date "19 de agosto de 2026", event name "Otra celebración prueba", and natural Spanish conversational tissue (thanks, closing). Element presence is required, order is not evaluated. Must be entirely in Spanish, natural, must not imply a new mutation was made, must not ask for email or a code, must not mention internal states or tools, and must not invert 
- `fragment-attending-polarity-event-date-no-change` | `text_contains` (hard) contiene `figura que asistirás, Otra celebración prueba, 19 de agosto de 2026, No fue necesario hacer otro cambio, no se realizó un nuevo registro, ya está confirmada`
- `fragment-not-inverted` | `text_not_contains` (hard) prohibido `Figura que no asistirás`
- `no-rsvp-vocabulary` | `text_not_contains` (hard) prohibido `RSVP, rsvp`
- **BehaviorChanges vinculados (3):** `read-complete-user-level-rsvp-state-before-mutation, report-confirmed-rsvp-state-without-redundant-mutation, rsvp-current-state-reported-via-hybrid-fragment`

### `live_behavior.rsvp_cristian_phone_enriched_confirmation`

- **Fichero:** `evals/cases/live-behavior-rsvp-cristian-phone-enriched.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, rsvp, phone-enrichment, reported-interaction, cristian`
- **Descripcion:** Cristian's completed invitation is resolved via hybrid fragment plus natural tissue without a false missing-invitation answer.
- **Input turno 0:** "Hola buen día, ya confirmé, gracias" (phone `+51942633292`, session `live-rsvp-cristian-phone-enriched-session`)
- **Que se valora:**
- `cristian-enters-rsvp` | `node_transition` (hard) -> `responder_invitacion`
- `cristian-reconciles-both-phone-reads` | `tool_usage` (hard) debe llamar `lookup_rsvp_invitations, lookup_guest_events_by_phone, get_guest_event_detail` | prohibido `guest_rsvp, auth_by_phone, request_user_login_code, verify_user_login_code`
- `cristian-existing-confirmation-is-reported` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The response must contain the deterministic attending fragment elements — polarity "figura que asistirás", confirmation "ya está confirmada", no-change clause "No fue necesario hacer otro cambio" and "no se realizó un nuevo registro", event name "Michelle & Jorge", date "10/10/2026 20:15" (slash fallback via formatRsvpSpanishDate), and natural Spanish conversational tissue. Element presence is required, order is not evaluated. Must be entirely in Spanish, natural, must not imply a new mutation was made, must not ask for email or a code, must not mention internal states or tools, and must not i
- `fragment-attending-polarity-event-date-no-change` | `text_contains` (hard) contiene `figura que asistirás, Michelle & Jorge, 10/10/2026 20:15, No fue necesario hacer otro cambio, no se realizó un nuevo registro, ya está confirmada`
- `fragment-not-inverted` | `text_not_contains` (hard) prohibido `Figura que no asistirás`
- `no-rsvp-vocabulary` | `text_not_contains` (hard) prohibido `RSVP, rsvp`
- **BehaviorChanges vinculados (4):** `enrich-rsvp-state-through-phone-scoped-event, rsvp-resolved-single-thanks-no-change, rsvp-tissue-bounded-to-one-closing-sentence, tighten-responder-invitacion-contract-dedupe`

### `live_behavior.rsvp_declined_state_offers_one_change`

- **Fichero:** `evals/cases/live-behavior-rsvp-declined-state.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, rsvp, attendance, current-state, confirmation`
- **Descripcion:** A declined invitation reports its current state and offers one clear confirmation to change it to attending.
- **Input turno 0:** "¿Cómo figura mi asistencia a Otra celebración prueba?" (phone `+51973296571`, session `live-rsvp-declined-state-session`)
- **Seed plan keys:** `current_node, intent, rsvp_state`
- **Que se valora:**
- `remains-in-rsvp-node` | `node_transition` (hard) -> `responder_invitacion`
- `reads-state-without-premature-mutation` | `tool_usage` (hard) debe llamar `lookup_rsvp_invitations` | prohibido `guest_rsvp, auth_by_phone, request_user_login_code, verify_user_login_code`
- `waits-for-one-change-confirmation` | `plan_field_equals` (hard) `rsvp_state.status`
- `preserves-attending-change` | `plan_field_equals` (hard) `rsvp_state.pending_action`
- `reports-decline-and-offers-change` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The selected invitation currently says the guest will not attend. The answer must be natural and entirely in Spanish, clearly report that current state, and ask one concise question offering to change it so attendance is confirmed. It must not claim that a change already succeeded, ask for email or a code, or expose internal fields.
- `deterministic-declining-offers-explicit-question` | `text_contains` (hard) contiene `Figura que no asistirás, ¿Deseas que confirme tu asistencia?`
- `deterministic-declining-omits-no-change` | `text_not_contains` (hard) prohibido `No fue necesario hacer otro cambio`
- `no-rsvp-vocabulary` | `text_not_contains` (hard) prohibido `RSVP, rsvp`
- **BehaviorChanges vinculados (4):** `read-complete-user-level-rsvp-state-before-mutation, rsvp-declining-offer-asks-explicit-question, rsvp-tissue-bounded-to-one-closing-sentence, tighten-responder-invitacion-contract-dedupe`

### `live_behavior.rsvp_jose_campaign_invitation_not_reported_missing`

- **Fichero:** `evals/cases/live-behavior-rsvp-jose-campaign.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, rsvp, attendance, reported-interaction, campaign-context`
- **Descripcion:** A campaign-grounded RSVP for Gia Antonella is resolved via hybrid fragment plus natural tissue without claiming a new mutation.
- **Input turno 0:** "Si confirmamos la asistencia" (phone `+51941438449`, session `live-rsvp-jose-campaign-session`)
- **Que se valora:**
- `enters-rsvp-node` | `node_transition` (hard) -> `responder_invitacion`
- `reads-user-level-state-without-account-auth` | `tool_usage` (hard) debe llamar `lookup_rsvp_invitations` | prohibido `guest_rsvp, auth_by_phone, request_user_login_code, verify_user_login_code`
- `preserves-campaign-grounded-invitation` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The response must contain the deterministic attending fragment elements — polarity "figura que asistirás", confirmation "ya está confirmada", no-change clause "No fue necesario hacer otro cambio" and "no se realizó un nuevo registro", event name "Gia Antonella", date "15/08/2026 22:00" (rendered via fallback for slash input), and natural Spanish conversational tissue. Element presence is required, order is not evaluated. Must be entirely in Spanish, natural, must not deny the invitation, must not restart onboarding, must not request email authentication or a code, must not invent guest details
- `fragment-attending-polarity-event-date-no-change` | `text_contains` (hard) contiene `figura que asistirás, Gia Antonella, 15/08/2026 22:00, No fue necesario hacer otro cambio, no se realizó un nuevo registro, ya está confirmada`
- `fragment-not-inverted` | `text_not_contains` (hard) prohibido `Figura que no asistirás`
- `no-rsvp-vocabulary` | `text_not_contains` (hard) prohibido `RSVP, rsvp`
- **BehaviorChanges vinculados (3):** `preserve-campaign-grounded-rsvp-when-no-mutation-is-pending-jose, tighten-rsvp-party-detection-precision, rsvp-tissue-bounded-to-one-closing-sentence`

### `live_behavior.rsvp_missing_action_requires_explicit_decision`

- **Fichero:** `evals/cases/live-behavior-rsvp-missing-action.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, rsvp, attendance, explicit-decision`
- **Descripcion:** An RSVP request without an attendance decision reports the selected invitation state and does not mutate it.
- **Input turno 0:** "Quiero responder mi invitación." (phone `+51973296571`, session `live-rsvp-missing-action-session`)
- **Seed plan keys:** `current_node, intent, rsvp_state`
- **Que se valora:**
- `enters-rsvp-node` | `node_transition` (hard) -> `responder_invitacion`
- `preserves-awaiting-action-state` | `plan_field_equals` (hard) `rsvp_state.status`
- `preserves-attending-change` | `plan_field_equals` (hard) `rsvp_state.pending_action`
- `does-not-mutate-without-decision` | `tool_usage` (hard) debe llamar `lookup_rsvp_invitations` | prohibido `guest_rsvp, auth_by_phone, request_user_login_code, verify_user_login_code`
- `asks-for-explicit-rsvp-decision` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The guest wants to manage the selected invitation but has not stated a new attendance decision. The current user-level state says the guest will not attend. The response must naturally and entirely in Spanish report that current state and ask one clear question offering to change it to attending. It must not mutate the invitation, ask for email or an authentication code, or claim that any new response was registered.
- `no-rsvp-vocabulary` | `text_not_contains` (hard) prohibido `RSVP, rsvp`
- **BehaviorChanges vinculados (6):** `route-rsvp-through-structured-extraction, require-explicit-rsvp-action-before-mutation, rsvp-action-extracted-only-from-current-message, rsvp-mutation-requires-current-message-decision-source, rsvp-tissue-bounded-to-one-closing-sentence, consolidate-classifier-corporate-reception`

### `live_behavior.rsvp_missing_event_identity_is_unavailable`

- **Fichero:** `evals/cases/live-behavior-rsvp-missing-event-identity.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, rsvp, minimum-disclosure, reported-interaction, diana`
- **Descripcion:** Diana's malformed invitation evidence boundary; parsed guest records without event identity cannot become guest-name invitation choices or a global denial.
- **Input turno 0:** "¿Puedes verificar el estado de mi invitación?" (phone `+51985101461`, session `-`)
- **Fixture backend:** `scenario=rsvp-missing-event-identity`
- **Seed plan keys:** `current_node, rsvp_state`
- **Que se valora:**
- `read-only-invitation-check` | `tool_usage` (hard) debe llamar `lookup_rsvp_invitations, lookup_guest_events_by_phone` | prohibido `guest_rsvp, auth_by_phone, request_user_login_code`
- `incomplete-evidence-is-not-no-invitation` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The lookup contains a guest record but cannot identify its event. Say that the invitation information could not be checked and offer a retry or human help. Do not claim no invitation exists, enumerate people as event names, report attendance as verified, ask for email/OTP, or claim an attendance change. Reply in natural concise Spanish.
- **BehaviorChanges vinculados (1):** `guest-record-name-is-not-event-identity`

### `live_behavior.rsvp_multi_person_offers_human_help`

- **Fichero:** `evals/cases/live-behavior-rsvp-multi-person-human-help.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, rsvp, multi-person, human-help, spanish`
- **Descripcion:** RSVP for more than one additional companion remains a bounded human-review case; the single +1 case is handled separately through POST /guest/rsvp.
- **Input turno 0:** "Hola, confirmo mi asistencia y la de Maria y Carlos para el evento del sabado" (phone `+51941438449`, session `live-rsvp-multi-person-human-help-session`)
- **Fixture backend:** `scenario=rsvp-plus-one-saved`
- **Que se valora:**
- `enters-rsvp-node` | `node_transition` (hard) -> `responder_invitacion`
- `no-mutation` | `tool_usage` (hard) | prohibido `guest_rsvp, lookup_rsvp_invitations, lookup_guest_events_by_phone, get_guest_event_detail, auth_by_phone, request_user_login_code, verify_user_login_code`
- `handoff-registered` | `tool_usage` (hard) debe llamar `request_human_takeover`
- `multi-person-offers-human-help` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user asks to confirm attendance for themselves and two additional people, Maria and Carlos. The current API supports only one +1, so the response must be entirely in natural Latin American Spanish, acknowledge the request, and state that human support will help. It must NOT silently truncate the request to one companion, enumerate events, ask to select an event, claim any attendance was already registered, or call the RSVP mutation. The reply must be one concise code-composed handoff sentence.
- `no-overclaim-apply-confirmation` | `text_not_contains` (hard) prohibido `aplicar la confirmación, aplicar la confirmacion`
- `no-rsvp-vocabulary` | `text_not_contains` (hard) prohibido `RSVP, rsvp`
- **BehaviorChanges vinculados (3):** `rsvp-multi-person-references-offer-human-help, rsvp-multiple-companions-remain-bounded-human-review, tighten-rsvp-party-detection-precision`

### `live_behavior.rsvp_paolo_mariana_resolved_single`

- **Fichero:** `evals/cases/live-behavior-rsvp-paolo-mariana-resolved-single.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, rsvp, paolo-mariana, resolved-single, projection`
- **Descripcion:** Paolo & Mariana attending invitation reports the already-resolved RSVP result for the named event; it does not ask the user to choose among invitations when one is resolved.
- **Input turno 0:** "Hola, quisiera confirmar el estado de mi invitacion a Otra celebración prueba" (phone `+51973296571`, session `live-rsvp-paolo-mariana-resolved-single-session`)
- **Seed plan keys:** `current_node, intent, rsvp_state`
- **Que se valora:**
- `enters-rsvp-node` | `node_transition` (hard) -> `responder_invitacion`
- `projects-resolved-single-without-candidate-list` | `tool_usage` (hard) debe llamar `lookup_rsvp_invitations` | prohibido `guest_rsvp, auth_by_phone, request_user_login_code, verify_user_login_code`
- `reports-already-resolved-invitation-for-named-event` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user asked about the invitation to Otra celebración prueba and the canonical phone evidence has that event as attending (Paolo & Mariana pattern: resolved_single). The response must be natural and entirely in Spanish, report that attendance is already confirmed for that named event and wish the guest well, without asking the user to choose among invitations, without listing other candidate events as alternatives, without asking for email or a code, and without claiming a new mutation was made.
- `no-rsvp-vocabulary` | `text_not_contains` (hard) prohibido `RSVP, rsvp`
- **BehaviorChanges vinculados (1):** `project-rsvp-phone-evidence-as-three-state`

### `live_behavior.rsvp_guest_and_plus_one_combined_saved`

- **Fichero:** `evals/cases/live-behavior-rsvp-plus-one-combined.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, rsvp, plus-one, combined, minimum-disclosure, spanish`
- **Descripcion:** Combined own attendance and plus-one yes in one POST /guest/rsvp mutation.
- **Input turno 0:** "Confirmo que sí asistiré a Michelle & Jorge y que mi acompañante también asistirá" (phone `+51942633292`, session `live-rsvp-plus-one-combined-session`)
- **Fixture backend:** `scenario=rsvp-plus-one-saved`
- **Que se valora:**
- `enters-rsvp-node` | `node_transition` (hard) -> `responder_invitacion`
- `combined-mutation-single-call` | `tool_usage` (hard) debe llamar `lookup_rsvp_invitations, guest_rsvp` | prohibido `request_human_takeover, auth_by_phone, request_user_login_code, verify_user_login_code`
- `combined-saved` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user explicitly confirms own attendance and that one companion will also attend Michelle & Jorge. The backend receives a single POST /guest/rsvp with action attending, guest_id, and plus_one_response yes; plus_one.saved true makes it successful. The answer must be concise, natural Latin American Spanish, confirm both the guest and the companion as registered when saved is true, and must never claim separate calls were needed, never request email or OTP, never expose guest_id or raw fields, and never restart with a generic welcome.
- `no-raw-rsvp-fields` | `text_not_contains` (hard) prohibido `guest_id, plus_one, saved=true, saved=false`
- **BehaviorChanges vinculados (1):** `rsvp-guest-and-plus-one-combined-saved`

### `live_behavior.rsvp_plus_one_multiple_events_requires_selection`

- **Fichero:** `evals/cases/live-behavior-rsvp-plus-one-multiple-events.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, rsvp, plus-one, selection, spanish`
- **Descripcion:** Plus-one request with multiple pending invitations requires one bounded event selection before mutation.
- **Input turno 0:** "Confirmo que mi acompañante asistirá al evento del sábado" (phone `+51941438999`, session `live-rsvp-plus-one-multi-event-session`)
- **Fixture backend:** `scenario=rsvp-plus-one-multiple-pending`
- **Que se valora:**
- `enters-rsvp-node` | `node_transition` (hard) -> `responder_invitacion`
- `no-premature-mutation` | `tool_usage` (hard) | prohibido `guest_rsvp, request_human_takeover, auth_by_phone, request_user_login_code, verify_user_login_code`
- `requires-event-selection` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user wants to confirm one companion but multiple pending invitations exist and no specific event is grounded. The answer must be concise, natural Latin American Spanish, ask one bounded question to choose which event the plus-one applies to, list the candidate events, and must not guess an event, call POST /guest/rsvp, silently truncate companions, or request email or OTP.
- **BehaviorChanges vinculados (1):** `rsvp-plus-one-multiple-events-requires-selection`

### `live_behavior.rsvp_plus_one_not_eligible_no_false_success`

- **Fichero:** `evals/cases/live-behavior-rsvp-plus-one-not-eligible.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, rsvp, plus-one, eligibility, spanish`
- **Descripcion:** Plus-one not eligible returns saved false and is reported honestly without false success.
- **Input turno 0:** "Quiero llevar a mi acompañante a Michelle & Jorge" (phone `+51942633292`, session `live-rsvp-plus-one-not-eligible-session`)
- **Fixture backend:** `scenario=rsvp-plus-one-not-eligible`
- **Que se valora:**
- `enters-rsvp-node` | `node_transition` (hard) -> `responder_invitacion`
- `phone-scoped-mutation-attempted` | `tool_usage` (hard) debe llamar `lookup_rsvp_invitations, guest_rsvp` | prohibido `request_human_takeover, auth_by_phone, request_user_login_code, verify_user_login_code`
- `not-eligible-reported-honestly` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The trusted-phone RSVP mutation returns plus_one.saved false with a reason, meaning the companion cannot be added for this guest or event. The answer must be concise, natural Latin American Spanish, clearly state that the companion response was not saved, give the sanitized reason, and offer human support as an option. It must never claim the companion was registered, never imply success, never expose guest_id or raw API fields, and never request email or OTP.
- `no-false-success` | `text_not_contains` (hard) prohibido `registrado con éxito, acompañante registrado, saved=true`
- **BehaviorChanges vinculados (4):** `rsvp-plus-one-not-eligible-no-false-success, rsvp-plus-one-write-remains-capability-gated, gateway-capability-manifest-intersection, server-event-timestamps-validated-without-conversion`

### `live_behavior.rsvp_plus_one_uses_phone_scoped_mutation`

- **Fichero:** `evals/cases/live-behavior-rsvp-plus-one.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, rsvp, plus-one, minimum-disclosure, spanish`
- **Descripcion:** A single explicit +1 response uses the trusted-phone RSVP endpoint and reports only the typed saved outcome.
- **Input turno 0:** "También asistirá mi acompañante a Michelle & Jorge" (phone `+51942633292`, session `live-rsvp-plus-one-phone-session`)
- **Fixture backend:** `scenario=rsvp-plus-one-saved`
- **Que se valora:**
- `enters-rsvp-node` | `node_transition` (hard) -> `responder_invitacion`
- `phone-scoped-plus-one-mutation` | `tool_usage` (hard) debe llamar `lookup_rsvp_invitations, guest_rsvp` | prohibido `request_human_takeover, auth_by_phone, request_user_login_code, verify_user_login_code`
- `saved-outcome-only` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user explicitly says that one companion will attend Michelle & Jorge. The fixture guarantees POST /guest/rsvp returns plus_one.saved true with the documented shape (200, saved true). The answer must be concise, natural Latin American Spanish, explicitly confirm that the companion was registered as attending (for example "tu acompañante fue registrado", "acompañante confirmado", or similar success confirmation with the event name), and reflect only the typed saved outcome. It must not say the companion was not saved, must not offer a vague pending state, must never claim success without sav
- `no-raw-rsvp-fields` | `text_not_contains` (hard) prohibido `guest_id, plus_one, saved=true, saved=false`
- **BehaviorChanges vinculados (1):** `rsvp-single-plus-one-phone-scoped-mutation`

### `live_behavior.rsvp_trusted_phone_reports_no_pending`

- **Fichero:** `evals/cases/live-behavior-rsvp-trusted-phone.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, rsvp, attendance, trusted-phone, agent-api`
- **Descripcion:** A clear RSVP decision uses the trusted channel phone and distinguishes no associated invitations from no pending invitations.
- **Input turno 0:** "Sí, confirmo que asistiré a la invitación pendiente." (phone `+12025550100`, session `live-rsvp-trusted-phone-session`)
- **Que se valora:**
- `enters-rsvp-node` | `node_transition` (hard) -> `responder_invitacion`
- `reads-user-level-invitations-without-auth` | `tool_usage` (hard) debe llamar `lookup_rsvp_invitations` | prohibido `guest_rsvp, auth_by_phone, request_user_login_code, verify_user_login_code`
- `records-rsvp-route` | `trace_field_equals` (hard) `route_kind`
- `reports-no-associated-invitation-outcome` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: This case uses a reserved synthetic phone number for which the user-level lookup has no associated invitations at all. The response must say naturally and entirely in Spanish that no invitation is associated with the current number. It must not use the misleading statement that there are merely no pending invitations, request email or a one-time code, expose internal values, or claim that attendance was registered. It may offer human help if the guest expected an invitation.
- `no-rsvp-vocabulary` | `text_not_contains` (hard) prohibido `RSVP, rsvp`
- **BehaviorChanges vinculados (5):** `use-trusted-channel-phone-for-rsvp-without-account-auth, report-only-backend-confirmed-rsvp-outcomes, route-development-lambda-to-production-agent-api, distinguish-no-associated-invitations-from-no-pending-invitations, rsvp-unavailable-never-claim-confirmation`

### `live_behavior.spanish_only_mixed_language_request`

- **Fichero:** `evals/cases/live-behavior-spanish-only.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, behavior, language, spanish-only`
- **Descripcion:** A mixed-language request must be understood while every user-visible natural-language word in the reply remains Spanish.
- **Input turno 0:** "Necesito catering para un baby shower en Miraflores. Please send the RSVP link by email." (phone `-`, session `live-behavior-spanish-only-session`)
- **Que se valora:**
- `tokens-present` | `token_usage_present` ()
- `no-known-english-product-terms` | `text_not_contains` () prohibido `RSVP, email, chat, web, link, catering, baby shower, feedback, marketplace, delivery, app, login`
- `correct-behavior-and-spanish-only` | `text_semantic` (hard) juez minScore=0.95 requireJudge=True
  > Rubrica juez: Pass only if the response retains the user's celebration in Miraflores and food-service request in the plan, advances or clarifies the next missing search field naturally, and uses Spanish for every user-visible natural-language word. The reply does not need to repeat already retained context such as the event type or location. The runtime cannot send a confirmation link by email, and its one-question planning policy may defer that separate request; do not fail solely because the reply does not address it, but fail if the reply falsely claims it was sent. Allow only official proper names, prov
- **BehaviorChanges vinculados (1):** `enforce-spanish-only-output`

### `live_behavior.support_detail_continuity`

- **Fichero:** `evals/cases/live-behavior-support-detail-continuity.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 3 | **Tags:** `live, behavior, faq, support, continuity, identity, reported-interaction, claudia-roger`
- **Descripcion:** Details supplied after a payment-support answer remain attached to that support thread and do not replace the channel user's identity.
- **Input turno 0:** "Un amigo no puede usar su tarjeta de crédito para comprar un regalo. ¿Hay problemas con tarjetas?" (phone `+51985101461`, session `live-support-detail-continuity-session`)
- **Input turno 1:** "El nombre del invitado afectado es Roger Abanto." (phone `+51985101461`, session `live-support-detail-continuity-session`)
- **Input turno 2:** "Y el evento es Baby Shower Catalina." (phone `+51985101461`, session `live-support-detail-continuity-session`)
- **Fixture backend:** `scenario=support-continuity`
- **Que se valora:**
- `support-question-uses-kb` | `tool_usage` (hard) turno 0 debe llamar `knowledge_base_search` | prohibido `search_providers_from_plan, auth_by_phone, request_user_login_code`
- `guest-name-stays-support` | `node_transition` (hard) -> `resolver_consultas_informativas` turno 1
- `event-detail-stays-support` | `node_transition` (hard) -> `resolver_consultas_informativas` turno 2
- `support-details-do-not-reset-or-rename` | `text_semantic` (hard) turno 2 juez minScore=0.9 requireJudge=True
  > Rubrica juez: Baby Shower Catalina is the event supplied for the same card-payment support thread. The final answer must be a concise, natural, entirely Spanish acknowledgment that preserves this support context and does not restart the conversation. It must use the event name exactly as supplied, must not greet or address the channel user as Roger, switch to provider planning, repeat the full card-payment explanation, perform a lookup, or claim that an account or purchase was verified. The previous Roger Abanto detail need not be repeated when the final turn supplies only the event reference.
- **BehaviorChanges vinculados (7):** `typed-policy-support-act-requires-indexed-faq-evidence, support-subject-identity-continuity, support-continuity-preserve-context-and-skip-faq-reprojection, support-note-continuity-effectiveness, support-note-effectiveness-and-no-menu-continuation, empty-extraction-with-history-uses-contextual-clarification, typed-support-reference-acknowledgement`

### `live_behavior.wedding_planner_location_completes_search`

- **Fichero:** `evals/cases/live-behavior-wedding-planner-location-completes-search.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 4 | **Tags:** `live, behavior, planning, provider-search, reported-interaction`
- **Descripcion:** A wedding-planner request should collect the remaining search context compactly and search immediately when the location follow-up completes it.
- **Input turno 0:** "Hola!" (phone `-`, session `live-behavior-wedding-planner-location-session`)
- **Input turno 1:** "Estoy buscando un proveedor para mi matrimonio, ¿qué opciones tienes? O mejor, dime los wedding planners que tengas." (phone `-`, session `live-behavior-wedding-planner-location-session`)
- **Input turno 2:** "Entre 100-200 aprox" (phone `-`, session `live-behavior-wedding-planner-location-session`)
- **Input turno 3:** "En Lima Perú" (phone `-`, session `live-behavior-wedding-planner-location-session`)
- **Que se valora:**
- `explicit-need-asks-location` | `text_contains` () turno 1 contiene `ciudad, zona, ubicación, dónde`
- `explicit-need-asks-scale-or-budget-in-same-turn` | `text_contains` () turno 1 contiene `invitados, presupuesto`
- `no-search-before-required-context` | `tool_usage` () turno 1 | prohibido `search_providers_from_plan, search_providers_by_query_intent`
- `final-turn-search-ready` | `trace_field_equals` () `search_ready` turno 3
- `final-turn-routes-to-recommendations` | `node_transition` () -> `recomendar` turno 3
- `final-turn-searches-now` | `tool_usage` () turno 3 debe llamar `search_providers_from_plan`
- `final-turn-has-provider-options` | `provider_result_count` () turno 3
- `final-response-advances-without-an-empty-extra-step` | `text_semantic` (hard) turno 3 juez minScore=0.9 requireJudge=True
  > Rubrica juez: This case reconstructs a reported WhatsApp interaction. The user explicitly asks for wedding planners, then supplies a 100-to-200 guest estimate and finally Lima, Peru. Pass only if the final Spanish response immediately presents or clearly recommends actual available wedding-planner options grounded in the completed search. It must not merely acknowledge the location, say the context is ready, promise that options will appear in a later step, ask the user to request the search again, or repeat a field already supplied. The earlier wedding-planner request must remain the active need.
- **BehaviorChanges vinculados (2):** `combine-critical-provider-search-questions, focus-single-retrieval-ready-follow-up-query`

### `live.faq_from_recommendation_node`

- **Fichero:** `evals/cases/live-faq-from-recommendation.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, faq, knowledge-base, state-machine`
- **Descripcion:** A user in a recommendation flow should be able to ask a FAQ and force KB retrieval instead of provider search.
- **Input turno 0:** "antes de elegir, ¿qué comisión cobra Sin Envolturas por los regalos?" (phone `-`, session `-`)
- **Seed plan keys:** `current_node, intent, event_type, vendor_category, active_need_category, location, guest_range, conversation_summary`
- **Que se valora:**
- `recommendation-to-faq` | `node_transition` () -> `resolver_consultas_informativas`
- `faq-knowledge-retrieval-called` | `tool_usage` () debe llamar `knowledge_base_search` | prohibido `search_providers_from_plan, search_providers_by_keyword, search_providers_by_category_location, get_provider_detail`
- `no-provider-results-in-faq` | `provider_result_count` ()
- `commission-answer` | `text_semantic` (hard) juez minScore=0.9 requireJudge=True
  > Rubrica juez: The user asks in Spanish what commission Sin Envolturas charges for gifts while an unrelated provider recommendation is active. Pass only if the response answers the commission question from retrieved knowledge, remains entirely in natural Spanish except for proper names, numbers, URLs, or literal technical identifiers, and does not continue the provider-selection flow or invent unsupported fees. A concise explanation of the relevant card or transfer fee distinction is acceptable.
- `no-missing-kb-fallback` | `text_not_contains` () prohibido `No tengo esa información específica en mi base de conocimiento`
- `one-turn-budget` | `budget_constraints` ()
- **BehaviorChanges vinculados (3):** `preserve-complete-numeric-faq-evidence, state-explicit-numeric-faq-values, route-faq-from-active-planning-nodes`

### `live_feedback.token_seeded_close_flow`

- **Fichero:** `evals/cases/live-feedback-token-close-flow.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 4 | **Tags:** `live, feedback, token, seeded-plan, close`
- **Descripcion:** Seeded selected-provider close flow should consume model tokens over several live Lambda turns.
- **Input turno 0:** "quiero cerrar este plan" (phone `-`, session `live-feedback-close-session`)
- **Input turno 1:** "mi nombre es Carolina" (phone `-`, session `live-feedback-close-session`)
- **Input turno 2:** "mi correo es carolina@example.com" (phone `-`, session `live-feedback-close-session`)
- **Input turno 3:** "mi teléfono es 51954779071" (phone `-`, session `live-feedback-close-session`)
- **Seed plan keys:** `current_node, event_type, location, guest_range, active_need_category, vendor_category, provider_needs`
- **Que se valora:**
- `tokens-all-turns` | `token_usage_present` ()
- `selected-provider-preserved` | `plan_field_subset` () `provider_needs`
- `no-provider-search` | `tool_usage` () turno 0 | prohibido `search_providers_from_plan, search_providers_by_query_intent`
- `correct-close-behavior` | `text_semantic` (hard) turno 3 juez minScore=0.85 requireJudge=True
  > Rubrica juez: The final response must correctly complete or confirm the close-flow submission after the user supplied a name, email address, valid phone number, and explicit confirmation. It must preserve the selected photography provider, avoid restarting provider search, and communicate the outcome clearly in Spanish.
- **BehaviorChanges vinculados (1):** `render-completed-submissions-as-final`

### `live_feedback.token_seeded_contact_correction`

- **Fichero:** `evals/cases/live-feedback-token-contact-correction.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 3 | **Tags:** `live, feedback, token, seeded-plan, contact`
- **Descripcion:** Seeded close flow should consume tokens while rejecting and then accepting corrected contact phone.
- **Input turno 0:** "mi teléfono es 967" (phone `-`, session `live-feedback-contact-session`)
- **Input turno 1:** "perdón, mi teléfono con código es +51 954779071" (phone `-`, session `live-feedback-contact-session`)
- **Input turno 2:** "mi nombre es Carolina y mi correo es carolina@example.com" (phone `-`, session `live-feedback-contact-session`)
- **Seed plan keys:** `current_node, event_type, location, guest_range, active_need_category, vendor_category, provider_needs`
- **Que se valora:**
- `tokens-all-turns` | `token_usage_present` ()
- `first-phone-invalid` | `trace_field_equals` () `contact_validation_summary.status` turno 0
- `corrected-phone-final` | `trace_field_equals` () `contact_validation_summary.plan_contact_fields_present.phone` turno 1
- `correct-contact-correction-behavior` | `text_semantic` (hard) turno 1 juez minScore=0.85 requireJudge=True
  > Rubrica juez: After rejecting the incomplete phone number, the response must accept the corrected Peruvian number without asking for the same correction again, preserve the existing close-flow context, and request only genuinely missing contact information. The response must be clear and natural in Spanish.
- `correct-final-close-behavior` | `text_semantic` (hard) turno 2 juez minScore=0.85 requireJudge=True
  > Rubrica juez: After the corrected phone number, name, and email address are all present, the response must complete or clearly continue submission for Carlos Schult without asking for any of those same fields again and without restarting provider search. It must communicate the outcome naturally in Spanish.
- **BehaviorChanges vinculados (1):** `preserve-close-phone-correction-context`

### `live_feedback.token_fresh_multifront_stays_multi_need`

- **Fichero:** `evals/cases/live-feedback-token-multifront.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 1 | **Tags:** `live, feedback, token, multi-need`
- **Descripcion:** Fresh multi-front provider request should consume tokens and remain multi-need in live Lambda.
- **Input turno 0:** "Quiero planear una boda moderna y elegante en Lima para 120 personas. Necesito catering con sushi, fotografía y video natural, música en vivo elegante, florería" (phone `-`, session `live-feedback-multifront-session`)
- **Que se valora:**
- `tokens-all-turns` | `token_usage_present` ()
- `multi-node` | `node_transition` () -> `elicitacion_necesidades`
- `multi-strategy` | `trace_field_equals` () `search_strategy`
- `correct-multifront-behavior` | `text_semantic` (hard) juez minScore=0.85 requireJudge=True
  > Rubrica juez: The response must retain the request as one event plan with all five provider needs: food service with sushi, photography and video, elegant live music, floral service, and a sophisticated nighttime venue. It must not collapse the request to only one provider category. The response does not need to repeat every preference when it presents the retained category. If retrieval has no exact live-music or white-and-green match, stating that limitation honestly without inventing a match is correct. It must respond naturally in Spanish.
- **BehaviorChanges vinculados (1):** `preserve-multi-need-event-plans`

### `live_feedback.token_seeded_selection_defer_close`

- **Fichero:** `evals/cases/live-feedback-token-selection-defer-close.yaml` | **Suite:** `live_behavior_regression` | **Turnos:** 4 | **Tags:** `live, feedback, token, seeded-plan, multi-need`
- **Descripcion:** Seeded multi-need plan should consume tokens while selecting one need, deferring a need after every option is declined, and entering close flow.
- **Input turno 0:** "confirmo Carlos Schult para foto" (phone `-`, session `live-feedback-multineed-session`)
- **Input turno 1:** "para catering no quiero ninguna" (phone `-`, session `live-feedback-multineed-session`)
- **Input turno 2:** "ahora cerremos el plan" (phone `-`, session `live-feedback-multineed-session`)
- **Input turno 3:** "soy Carolina, carolina@example.com, teléfono +51 954779071" (phone `-`, session `live-feedback-multineed-session`)
- **Seed plan keys:** `current_node, event_type, location, guest_range, active_need_category, vendor_category, provider_needs`
- **Que se valora:**
- `tokens-all-turns` | `token_usage_present` ()
- `photography-selected` | `plan_field_subset` () `provider_needs`
- `catering-defer-recorded` | `trace_field_subset` () `selection_resolution_summary.provider_plan_operation_types` turno 1
- `catering-deferred` | `plan_field_subset` () `provider_needs`
- `correct-selection-defer-close-behavior` | `text_semantic` (hard) turno 3 juez minScore=0.85 requireJudge=True
  > Rubrica juez: The response must preserve Carlos Schult as the selected photography provider, preserve catering as intentionally left without a provider after the user declined every option, and complete or continue the close flow using the contact details just provided. It must not ask the user to choose a catering option again or restart provider search. A compact confirmation naming the selected provider is allowed; it must communicate the close-flow outcome clearly in Spanish.
- **BehaviorChanges vinculados (2):** `preserve-deferred-provider-needs-at-close, render-selected-and-deferred-close-outcomes-accurately`

## 6. Twins offline (deterministas, sin Lambda)

- `tests/t6-deterministic-twins.test.ts` (10 its, mock `fetch` gateway): Alex pending/cart distintos; Sonia cart-only sin purchase_not_found; Isa-Lu pendiente vs AMORCITOS declined; Luis currency=null preservado; Samuel vs Josue y Paola; paidAt sin offset preservado byte a byte; plus_one saved true/false/combined/multiple_pending. Valora parsing sin aplanar ni inventar moneda/zona.
- `tests/deterministic-cart-only-reply.test.ts` (6): clausula cart con atribucion telefono + disponibilidad condicionada a politica indexada, sin `72h`, sin canal email; gemelos de registro.
- `tests/rsvp-deterministic-current-state.test.ts` (4): fragmentos attending/declining byte-identicos, merge hibrido fragment+modelo.
- `tests/support-continuity.test.ts` (3), `tests/offline-twins-wave-c5.test.ts` (4), `tests/offline-twins-provenance-fixes.test.ts` (2): nota soporte sin menu, `constancia` sin `COD`, sin `guest_id/transactionNumber`, sin llaves `email:null`.
- `tests/rsvp-party*.test.ts`, `rsvp-handoff-multi-person`, `rsvp-mutation-authorization`, `rsvp-three-state-projection`, `host-withdrawal-policy`, `purchase-disclosure-policy`, `otp-normalization`, `phone`, `capability-boundary*`, `message-response-classifier`: schemas, autorizacion de mutacion, precision de party, handoff acotado.

## 7. Meta-tests (gates)

- `tests/live-behavior-coverage.test.ts`: exige hard estructural + hard text_semantic requireJudge por cada liveCaseId referenciado; IDs unicos; pertenencia a suite; target live_lambda.
- `tests/live-behavior-cli.test.ts`: parseo `--case` simple/repetido/`=`/mixto, `--help` sin cargar runner.
- `tests/eval-runner*.test.ts`, `eval-loader`, `eval-grounding`, `semantic-judge`, `eval-metrics/pricing/reporting`: hardGate, contexto del juez, fixture gateway, turnos concurrentes.

## 8. Reproduccion para el revisor

```bash
npm run test tests/live-behavior-coverage.test.ts  # gate sin costo
npm run test                                       # 105 ficheros vitest offline
npm run eval:behavior-live                         # 59 casos Lambda viva (requiere Lambda dev desplegada)
npm run eval:behavior-live -- --case live_behavior.rsvp_ambiguous_event_requires_grounded_selection
```
