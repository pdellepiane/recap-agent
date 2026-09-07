# Source and evaluation index

Snapshot: 2026-09-04; commit `cce28e3b5c75863b1ff4e952055ba2ce2c7a9d7b`. This index was generated from source and the schema-validated evaluation catalog. Links are portable relative to the repository. Line numbers are search anchors at this snapshot; symbol names are the durable lookup aid. A symbol anchor may point to an invocation before its definition.

## Source map

### Turn orchestration and state

| Source | Symbols and snapshot line anchors |
|---|---|
| [src/runtime/agent-service.ts](../../src/runtime/agent-service.ts) | `handleTurnCore` — line 309; `decideNextTurn` — line 1008; `buildDecisionEvidence` — line 994; `validateTurnDecisionInvariants` — line 6820; `applyExtraction` — line 858; `handleContextualClarification` — line 882 |
| [src/core/plan.ts](../../src/core/plan.ts) | `planSchema` — line 127; `providerNeedSchema` — line 112; `mergePlan` — line 598; `replaceProviderNeeds` — line 555; `normalizeRawPlan` — line 213 |
| [src/core/decision-flow.ts](../../src/core/decision-flow.ts) | `resolveResumeNode` — line 7 |
| [src/core/turn-decision.ts](../../src/core/turn-decision.ts) | `decisionEvidenceSchema` — line 27; `turnDecisionSchema` — line 95 |
| [src/runtime/turn-message-context.ts](../../src/runtime/turn-message-context.ts) | `deriveConversationContinuity` — line 57; `buildTurnMessageContext` — line 168; `buildModelVisibleConversationHistory` — line 199 |
| [src/storage/dynamo-plan-store.ts](../../src/storage/dynamo-plan-store.ts) | `getByExternalUser` — line 37; `getSessionFocus` — line 61; `save` — line 85 |

### Capabilities, models, and prompts

| Source | Symbols and snapshot line anchors |
|---|---|
| [src/runtime/capability-manifest.ts](../../src/runtime/capability-manifest.ts) | `runtimeOperationIds` — line 5; `buildRuntimeCapabilityManifest` — line 149; `mergeRuntimeCapabilityManifests` — line 202; `resolveCapabilityDecision` — line 241 |
| [src/runtime/dynamic-agent-policy.ts](../../src/runtime/dynamic-agent-policy.ts) | `derivePlanCapabilities` — line 53; `deriveDynamicAgentPolicy` — line 89; `resolveDynamicTools` — line 153 |
| [src/runtime/extraction-schemas.ts](../../src/runtime/extraction-schemas.ts) | `providerQueryIntentSchema` — line 37; `providerPlanOperationSchema` — line 51; `createDynamicExtractionSchema` — line 209 |
| [src/runtime/openai-agent-runtime.ts](../../src/runtime/openai-agent-runtime.ts) | `async extract(` — line 170; `async composeReply(` — line 370; `composeExtractorInput` — line 222; `buildExtractorPlanSnapshot` — line 810; `buildReplyTurnEvidence` — line 1005; `resolveOutputSchema` — line 392; `projectInformationResultForReply` — line 1093; `projectPurchaseForReply` — line 2383 |
| [src/runtime/prompt-manifest.ts](../../src/runtime/prompt-manifest.ts) | `conversationPromptFilesForNode` — line 62; `extractorPromptFilesForCapabilities` — line 91; `nodePromptManifest` — line 153 |
| [src/runtime/prompt-loader.ts](../../src/runtime/prompt-loader.ts) | `loadNodeBundle` — line 54; `projectMinimumDisclosure` — line 89 |
| [src/runtime/config.ts](../../src/runtime/config.ts) | `environmentSchema` — line 104; `getConfig` — line 176 |
| [src/runtime/openai-model-defaults.ts](../../src/runtime/openai-model-defaults.ts) | `DEFAULT_GPT_TEXT_MODEL` — line 3; `DEFAULT_PROMPT_CACHE_OPTIONS` — line 5 |

### Provider planning and retrieval

| Source | Symbols and snapshot line anchors |
|---|---|
| [src/runtime/agent-service.ts](../../src/runtime/agent-service.ts) | `selectStarterProviderCategories` — line 166; `applyProviderPlanOperations` — line 959; `resolveProviderSelections` — line 6946; `executeMultiNeedProviderRetrieval` — line 1396; `searchMoreProviders` — line 8710; `hasUnselectedShortlist` — line 1215 |
| [src/core/sufficiency.ts](../../src/core/sufficiency.ts) | `computeSearchSufficiency` — line 9; `computeNeedSearchSufficiency` — line 29 |
| [src/runtime/sinenvolturas-gateway.ts](../../src/runtime/sinenvolturas-gateway.ts) | `searchProvidersHybrid` — line 177; `searchProvidersByQueryIntent` — line 390; `createQuoteRequest` — line 661 |
| [src/runtime/provider-vector-search.ts](../../src/runtime/provider-vector-search.ts) | `buildProviderVectorSearchQueries` — line 63; `parseProviderVectorSearchResult` — line 38 |
| [src/runtime/provider-fit.ts](../../src/runtime/provider-fit.ts) | `parseBudgetAmount` — line 37; `rankProvidersForCriteria` — line 153; `isProviderEligibleForCriteria` — line 173 |
| [src/runtime/provider-sub-query-selection.ts](../../src/runtime/provider-sub-query-selection.ts) | `selectProvidersForSubQuery` — line 39; `providerHasEventServiceEvidence` — line 100 |
| [src/runtime/finish-plan-tool.ts](../../src/runtime/finish-plan-tool.ts) | `executeFinishPlanTool` — line 23 |
| [src/runtime/message-renderer.ts](../../src/runtime/message-renderer.ts) | `renderNeedSection` — line 102; `renderProviderCard` — line 80 |
| [src/provider-sync/sync.ts](../../src/provider-sync/sync.ts) | `runProviderSync` — line 23 |

### FAQ, information, and authentication

| Source | Symbols and snapshot line anchors |
|---|---|
| [src/core/information.ts](../../src/core/information.ts) | `purchaseAspectValues` — line 17; `informationStateSchema` — line 194; `userAuthStateSchema` — line 214; `InformationTaskResult` — line 445 |
| [src/runtime/agent-service.ts](../../src/runtime/agent-service.ts) | `handleInformationFlow` — line 708; `handleSupportAcknowledgment` — line 3955; `handleHostWithdrawalInformation` — line 3973; `resolveInformationAuthenticationCore` — line 5032; `resolveEmailAuthentication` — line 5092; `requestUserCodeForInformation` — line 5357; `verifyUserCodeForInformation` — line 5343; `completeDeclinedInformationAuthentication` — line 4028 |
| [src/runtime/information-orchestrator.ts](../../src/runtime/information-orchestrator.ts) | `async execute(` — line 141; `executeGuestEventRequest` — line 364; `executePhonePurchaseRequest` — line 431; `reconcilePhoneContextResults` — line 231; `filterPurchaseCandidates` — line 543; `projectPurchase` — line 556; `projectCart` — line 1017 |
| [src/runtime/agent-conversation-gateway.ts](../../src/runtime/agent-conversation-gateway.ts) | `getGuestOrdersByPhone` — line 345; `getGuestGiftPurchasesByPhone` — line 350; `authByPhone` — line 355; `getGuestEventsByPhone` — line 356; `getEventDetail` — line 357; `parseGuestOrders` — line 1482 |
| [src/runtime/knowledge-retrieval-gateway.ts](../../src/runtime/knowledge-retrieval-gateway.ts) | `OpenAiKnowledgeRetrievalGateway` — line 34 |
| [src/runtime/purchase-disclosure-policy.ts](../../src/runtime/purchase-disclosure-policy.ts) | `pendingPaymentValidationExpectation` — line 14; `hasPhysicalFulfillment` — line 35 |
| [src/runtime/host-withdrawal-policy.ts](../../src/runtime/host-withdrawal-policy.ts) | `parseHostWithdrawalPolicy` — line 8 |
| [src/knowledge-sync/atc-templates.ts](../../src/knowledge-sync/atc-templates.ts) | `buildAtcTemplateIngestion` — line 72; `formatAtcTemplateAsSupplementalMarkdown` — line 124; `isChatListoRow` — line 73 |
| [src/knowledge-sync/sync.ts](../../src/knowledge-sync/sync.ts) | `runKnowledgeBaseSyncFromDir` — line 20 |

### RSVP, delivery, and human participation

| Source | Symbols and snapshot line anchors |
|---|---|
| [src/core/rsvp.ts](../../src/core/rsvp.ts) | `rsvpPartySchema` — line 15; `rsvpStateSchema` — line 32 |
| [src/runtime/agent-service.ts](../../src/runtime/agent-service.ts) | `handleRsvpFlow` — line 692; `lookupRsvpPhoneEvidence` — line 2098; `projectRsvpPhoneEvidenceForReply` — line 2312; `renderRsvpCurrentStateDeterministically` — line 2193; `renderRsvpMutationResultDeterministically` — line 2256; `reduceConversationHealth` — line 472 |
| [src/runtime/message-response-classifier.ts](../../src/runtime/message-response-classifier.ts) | `classifierOutputSchema` — line 16; `async classify(` — line 134; `private fallback` — line 354 |
| [src/runtime/agent-participation-service.ts](../../src/runtime/agent-participation-service.ts) | `resumeAutomatedAgent` — line 22; `overtakeConversation` — line 51 |
| [src/runtime/capability-boundary-renderer.ts](../../src/runtime/capability-boundary-renderer.ts) | `CapabilityBoundaryRenderer` — line 86 |

### Operations and audit

| Source | Symbols and snapshot line anchors |
|---|---|
| [src/lambda/handler.ts](../../src/lambda/handler.ts) | `async function handleRequest` — line 111; `getSharedRuntimeDeps` — line 514; `getFixtureRuntime` — line 377 |
| [src/lambda/request-contract.ts](../../src/lambda/request-contract.ts) | `channelRequestSchema` — line 41; `agentParticipationRequestSchema` — line 79 |
| [src/lambda/request-route.ts](../../src/lambda/request-route.ts) | `runtimeRequestPaths` — line 1 |
| [src/storage/conversation-turn-coordinator.ts](../../src/storage/conversation-turn-coordinator.ts) | `runWithConversationTurnLease` — line 102 |
| [src/storage/dynamo-conversation-turn-coordinator.ts](../../src/storage/dynamo-conversation-turn-coordinator.ts) | `DynamoConversationTurnCoordinator` — line 25 |
| [src/core/trace.ts](../../src/core/trace.ts) | `RecommendationFunnelTrace` — line 29; `AuthenticationExecutionTrace` — line 18 |
| [src/runtime/artifact-redaction.ts](../../src/runtime/artifact-redaction.ts) | `redactArtifactText` — line 30; `projectSafeTrace` — line 44; `projectSafePlan` — line 84 |
| [src/logs/trace/perf.ts](../../src/logs/trace/perf.ts) | `buildTurnPerfRecord` — line 196 |
| [infra/cloudformation/stack.yaml](../../infra/cloudformation/stack.yaml) | `PlansTable:` — line 228; `PerfTable:` — line 244; `Runtime: nodejs24.x` — line 317 |

### Evaluation

| Source | Symbols and snapshot line anchors |
|---|---|
| [src/evals/loader.ts](../../src/evals/loader.ts) | `loadCatalog` — line 26 |
| [src/evals/case-schema.ts](../../src/evals/case-schema.ts) | `expectationSchema` — line 552; `evalCaseSchema` — line 624 |
| [src/evals/runner.ts](../../src/evals/runner.ts) | `runEvaluation` — line 65 |
| [src/evals/targets/offline.ts](../../src/evals/targets/offline.ts) | `runOfflineCase` — line 40 |
| [src/evals/targets/live-lambda.ts](../../src/evals/targets/live-lambda.ts) | `runLiveLambdaCase` — line 25 |
| [src/evals/scorers/semantic-judge.ts](../../src/evals/scorers/semantic-judge.ts) | `evaluateSemanticJudgeOutcome` — line 11; `runSemanticJudge` — line 29 |
| [src/evals/grounding.ts](../../src/evals/grounding.ts) | `assessGrounding` — line 19 |
| [src/evals/metrics.ts](../../src/evals/metrics.ts) | `computeBenchmarkMetrics` — line 55; `wilsonInterval` — line 39 |
| [src/evals/technical-study.ts](../../src/evals/technical-study.ts) | `REACHABLE_TRANSITIONS_VERSION` — line 29; `runTechnicalStudy` — line 121 |
| [src/evals/study-schema.ts](../../src/evals/study-schema.ts) | `technicalStudyManifestSchema` — line 80 |
| [src/evals/live-behavior-cli.ts](../../src/evals/live-behavior-cli.ts) | `async function main` — line 65 |
| [tests/live-behavior-coverage.test.ts](../../tests/live-behavior-coverage.test.ts) | `maps every registered behavior change` — line 26 |

## Full evaluation catalog

These are configured cases, not observed passes. Hard required semantic counts come from hydrated expectations after templates/imports. An owning suite field and explicit membership in suite manifests are separate concepts. The planned FAQ module adds no case here.

| Case ID and file | Description | Owning suite | Eligible targets | Turns | Hard required semantic expectations |
|---|---|---|---|---:|---:|
| [clarification.missing_location_for_active_need](../../evals/cases/clarification-missing-location.yaml) | The agent should ask for location when the active need is known but location is missing. | clarification | offline | 1 | 0 |
| [domain.guest_range_boundary_100](../../evals/cases/domain-guest-range-boundary.yaml) | Explicit guest count of 100 should map to the inclusive 51-100 range. | domain_knowledge | offline, live_lambda | 1 | 0 |
| [domain.local_solo_espacio_no_category_reask](../../evals/cases/domain-local-solo-espacio.yaml) | Once Locales is the active need, "solo el espacio" should not trigger a re-ask about what Locales means. | domain_knowledge | offline | 1 | 0 |
| [entrypoint.event_known_no_active_need](../../evals/cases/entrypoint-planning-event-known.yaml) | Event is known but no provider search should run before the agent clarifies planning needs. | entrypoint_planning | offline, live_lambda | 1 | 0 |
| [feedback.close_selected_provider_does_not_reask](../../evals/cases/feedback-close-selected-provider.yaml) | Closing a plan with an already selected provider should ask for contact context, not reopen provider selection. | feedback_regression | offline | 1 | 0 |
| [feedback.faq_gift_product_claim_clear_next_steps](../../evals/cases/feedback-faq-gift-claim.yaml) | Gift/product claim questions should explain optional gifts, value received, brand claims, and support. | feedback_regression | offline | 1 | 0 |
| [feedback.faq_web_design_support_boundary](../../evals/cases/feedback-faq-web-design-support.yaml) | Web design support requests should stay in FAQ/support scope and not trigger provider search. | feedback_regression | offline | 1 | 0 |
| [feedback.invalid_phone_rejected_immediately](../../evals/cases/feedback-invalid-phone-immediate.yaml) | A too-short phone number should be rejected in the same turn and not persisted. | feedback_regression | offline | 1 | 0 |
| [feedback.location_filtering_avoids_mexico_for_lurin](../../evals/cases/feedback-location-filtering-lurin.yaml) | Peru/Lima location requests should not present Mexico providers when Peru matches are available. | feedback_regression | offline | 1 | 0 |
| [feedback.multi_need_request_not_downgraded_by_stale_focus](../../evals/cases/feedback-multi-need-stale-focus.yaml) | A fresh multi-front request should route multi-need even if the saved plan has stale active Catering focus. | feedback_regression | offline | 1 | 0 |
| [feedback.none_defers_need_and_allows_close](../../evals/cases/feedback-none-defers-need.yaml) | Responding ninguna for a pending shortlist should defer that need instead of trapping the close flow. | feedback_regression | offline | 1 | 0 |
| [feedback.phone_correction_updates_single_field](../../evals/cases/feedback-phone-correction.yaml) | A standalone corrected phone with country code should update only the phone while preserving name and email. | feedback_regression | offline | 1 | 0 |
| [feedback.post_error_clarification_does_not_relist](../../evals/cases/feedback-post-error-no-relist.yaml) | After an error or confusion, clarification should not relist providers as if the prior selection failed. | feedback_regression | offline | 1 | 0 |
| [feedback.selection_confirmation_does_not_relist](../../evals/cases/feedback-selection-no-new-list.yaml) | Confirming a provider should persist the selection and not show another recommendation list in the same turn. | feedback_regression | offline | 1 | 0 |
| [feedback.unselected_shortlist_blocks_close_until_deferred](../../evals/cases/feedback-unselected-shortlist-blocks-close.yaml) | Close flow should ask for explicit select/defer when a real shortlist remains unselected. | feedback_regression | offline | 1 | 0 |
| [feedback.zero_result_need_not_treated_as_pending](../../evals/cases/feedback-zero-result-not-pending.yaml) | A searched need with zero providers should become no_providers_available and not be resumed as pending. | feedback_regression | offline | 1 | 0 |
| [live_behavior.abandoned_cart_only_sonia](../../evals/cases/live-behavior-abandoned-cart-sonia.yaml) | Sonia cart-only abandoned checkout is valid phone coverage; purchase not_found must not occur. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.accountless_event_answer_precedes_remaining_private_auth](../../evals/cases/live-behavior-accountless-event-before-private-auth.yaml) | A mixed event and purchase question reuses the phone-enriched event and its scoped purchases without account authentication. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.accountless_guest_event_uses_phone_without_otp](../../evals/cases/live-behavior-accountless-guest-event.yaml) | An invited WhatsApp guest without an account receives event details through the trusted phone without being pushed into email OTP. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.active_cart_checkout_continuity_alex](../../evals/cases/live-behavior-active-cart-checkout-alex.yaml) | Alex same-event pending order and active cart stay distinct; checkout continuation does not restart or flatten records. | live_behavior_regression | live_lambda | 2 | 1 |
| [live_behavior.ambiguous_confirmation_clarifies](../../evals/cases/live-behavior-ambiguous-confirmation.yaml) | An underspecified confirmation over a multi-option shortlist must ask what is being confirmed instead of restarting or choosing arbitrarily. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.authentication_refusal_closes_protected_query](../../evals/cases/live-behavior-auth-refusal-closes-query.yaml) | An explicit privacy or security refusal must close the protected request without repeating email authentication or forcing human support. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.concurrent_support_turns_preserve_context](../../evals/cases/live-behavior-concurrent-support-turns.yaml) | Claudia's overlapping card-support message and guest details must serialize before plan/history loading. | live_behavior_regression | live_lambda | 2 | 1 |
| [live_behavior.current_campaign_order_over_historical_declined_maria_jose](../../evals/cases/live-behavior-current-campaign-order-maria-jose.yaml) | Maria Jose current pending Isa and Lu order is selected over old declined AMORCITOS; balance is not recomputed. | live_behavior_regression | live_lambda | 2 | 2 |
| [live_behavior.customer_transaction_code_by_phone](../../evals/cases/live-behavior-customer-transaction-code-by-phone.yaml) | A customer-facing COD transaction reference is resolved as a phone-scoped purchase request without exposing internal order ids or starting authentication. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.host_support_allows_explicit_rsvp_switch](../../evals/cases/live-behavior-host-support-explicit-rsvp-switch.yaml) | A pending host withdrawal must not prevent an explicitly requested attendance question; the test uses read-only fixture data. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.host_withdrawal_diana_policy_and_support](../../evals/cases/live-behavior-host-withdrawal-diana.yaml) | Diana corrects her role, asks about a missing host withdrawal, and supplies her event; answer sourced policy and hand off without buyer or invitation detours. | live_behavior_regression | live_lambda | 3 | 2 |
| [live_behavior.host_withdrawal_general_policy_only](../../evals/cases/live-behavior-host-withdrawal-general.yaml) | General host withdrawal timing needs sourced FAQ policy, not account lookups or a mandatory handoff. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.host_withdrawal_pending_event_followup](../../evals/cases/live-behavior-host-withdrawal-event-followup.yaml) | Reconstruct the pending withdrawal topic at Diana's event-name follow-up; the name must not start RSVP. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.mailbox_issue_deferral_and_clarification_preserve_support](../../evals/cases/live-behavior-mailbox-continuity-maria-isabel.yaml) | Reconstruct Maria Isabel's transfer-proof greeting, mailbox-capacity report, deferral and misspelled clarification without a restart or irrelevant purchase search. | live_behavior_regression | live_lambda | 4 | 3 |
| [live_behavior.nonphysical_purchase_omits_shipping](../../evals/cases/live-behavior-nonphysical-purchase-omits-shipping.yaml) | A nonphysical gift purchase must not create shipment or physical-delivery claims. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.otp_nondelivery_auto_resends_once](../../evals/cases/live-behavior-otp-auto-resend-once.yaml) | The first missing-code report must automatically resend once while preserving the protected request and without asking the user to choose another email path. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.otp_not_received_requires_response](../../evals/cases/live-behavior-otp-not-received.yaml) | A repeated missing-code report after one resend must trigger a real handoff and preserve the protected question without another OTP loop. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.otp_number_words_are_verified](../../evals/cases/live-behavior-otp-number-words.yaml) | An OTP written as unambiguous Spanish digit words must be normalized and submitted instead of rejected as prose. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.otp_sent_explains_image_limitation](../../evals/cases/live-behavior-otp-sent-image-guidance.yaml) | After sending an email code, the assistant asks the user to copy and paste it without the confusing word text. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.payment_destination_requires_pending_purchase](../../evals/cases/live-behavior-payment-destination-requires-pending.yaml) | A payment destination must not be disclosed before a specific pending purchase is verified. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.pending_balance_validation_luis](../../evals/cases/live-behavior-pending-balance-luis.yaml) | Luis pending Alejandra order and cart with null currency; balance reported as unknown and validation window applied. | live_behavior_regression | live_lambda | 2 | 2 |
| [live_behavior.phone_account_rejection_requests_email](../../evals/cases/live-behavior-phone-account-rejected.yaml) | An explicit rejection of the current phone account clears phone authentication and requests the registered email. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.phone_confirmation_unclear_requires_yes_or_no](../../evals/cases/live-behavior-phone-confirmation-unclear.yaml) | A stale imprecise answer after the retired confirmation prompt must use phone-scoped event context directly instead of asking again. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.phone_purchase_missing_hands_off_once](../../evals/cases/live-behavior-phone-missing-information.yaml) | Empty trusted-phone orders and carts preserve a purchase query and request human help once, without automatic email verification. | live_behavior_regression | live_lambda | 2 | 1 |
| [live_behavior.provider_reference_cheaper_option](../../evals/cases/live-behavior-provider-reference-cheaper.yaml) | A comparative reference to the cheaper shortlisted provider must resolve from retained provider evidence. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.provider_reference_miraflores_option](../../evals/cases/live-behavior-provider-reference-miraflores.yaml) | A location reference to the Miraflores shortlisted provider must resolve from retained provider evidence. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.purchase_confirmation_carina_request_survives_normalization](../../evals/cases/live-behavior-purchase-confirmation-carina.yaml) | Reconstruct the repeated payment-confirmation requests after the current-event campaign without silently losing neutral authentication actions. | live_behavior_regression | live_lambda | 2 | 2 |
| [live_behavior.purchase_current_pending_over_old_approved](../../evals/cases/live-behavior-purchase-current-vs-old.yaml) | Explicit event, amount, date, and status select Victor's current pending gift instead of an older approved purchase. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.purchase_delia_status_by_phone](../../evals/cases/live-behavior-purchase-delia-phone-orders.yaml) | Delia's payment status is answered from phone-scoped order summaries without an account or OTP loop. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.purchase_joaquin_dedication_selection](../../evals/cases/live-behavior-purchase-joaquin-dedication.yaml) | Joaquín's dedication request uses phone-scoped gift details and asks him to select among multiple purchases without authentication. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.purchase_kiara_pending_by_phone](../../evals/cases/live-behavior-purchase-kiara-phone-orders.yaml) | Kiara's pending gift status is answered from phone-scoped orders without requesting an OTP that may never arrive. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.purchase_martha_accountless_selection](../../evals/cases/live-behavior-purchase-martha-accountless.yaml) | Martha's purchases are found by trusted phone even though she has no account, and multiple records are presented for selection without OTP. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.purchase_pending_transfer_continuity](../../evals/cases/live-behavior-purchase-pending-transfer-continuity.yaml) | A pending transfer keeps its purchase context, uses the verified validation window, and never invents currency or local time from incomplete backend fields. | live_behavior_regression | live_lambda | 3 | 2 |
| [live_behavior.repeated_otp_failure_preserves_gift_query](../../evals/cases/live-behavior-repeated-otp-failure.yaml) | A second rejected, correctly formatted OTP must end the repetitive code loop while preserving the reported gift-deposit query. | live_behavior_regression | live_lambda | 3 | 1 |
| [live_behavior.reset_plan_discards_stored_context](../../evals/cases/live-behavior-reset-plan.yaml) | An explicit request to start over must atomically replace the stored event plan before replying. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.rsvp_ambiguous_event_requires_grounded_selection](../../evals/cases/live-behavior-rsvp-ambiguous-event.yaml) | An underspecified event reference cannot select or mutate one of several persisted RSVP candidates. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.rsvp_cinthya_campaign_invitation_not_reported_missing](../../evals/cases/live-behavior-rsvp-cinthya-campaign.yaml) | A campaign-grounded RSVP for Julisabeth y Andrés must reconcile both phone-scoped reads and must not be reported as a missing invitation. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.rsvp_confirmed_state_is_reported](../../evals/cases/live-behavior-rsvp-confirmed-state.yaml) | A user-level invitation that already has attendance confirmed is reported via hybrid fragment plus natural tissue without another mutation. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.rsvp_cristian_phone_enriched_confirmation](../../evals/cases/live-behavior-rsvp-cristian-phone-enriched.yaml) | Cristian's completed invitation is resolved via hybrid fragment plus natural tissue without a false missing-invitation answer. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.rsvp_declined_state_offers_one_change](../../evals/cases/live-behavior-rsvp-declined-state.yaml) | A declined invitation reports its current state and offers one clear confirmation to change it to attending. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.rsvp_guest_and_plus_one_combined_saved](../../evals/cases/live-behavior-rsvp-plus-one-combined.yaml) | Combined own attendance and plus-one yes in one POST /guest/rsvp mutation. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.rsvp_jose_campaign_invitation_not_reported_missing](../../evals/cases/live-behavior-rsvp-jose-campaign.yaml) | A campaign-grounded RSVP for Gia Antonella is resolved via hybrid fragment plus natural tissue without claiming a new mutation. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.rsvp_missing_action_requires_explicit_decision](../../evals/cases/live-behavior-rsvp-missing-action.yaml) | An RSVP request without an attendance decision reports the selected invitation state and does not mutate it. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.rsvp_missing_event_identity_is_unavailable](../../evals/cases/live-behavior-rsvp-missing-event-identity.yaml) | Diana's malformed invitation evidence boundary; parsed guest records without event identity cannot become guest-name invitation choices or a global denial. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.rsvp_multi_person_offers_human_help](../../evals/cases/live-behavior-rsvp-multi-person-human-help.yaml) | RSVP for more than one additional companion remains a bounded human-review case; the single +1 case is handled separately through POST /guest/rsvp. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.rsvp_paolo_mariana_resolved_single](../../evals/cases/live-behavior-rsvp-paolo-mariana-resolved-single.yaml) | Paolo & Mariana attending invitation reports the already-resolved RSVP result for the named event; it does not ask the user to choose among invitations when one is resolved. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.rsvp_plus_one_multiple_events_requires_selection](../../evals/cases/live-behavior-rsvp-plus-one-multiple-events.yaml) | Plus-one request with multiple pending invitations requires one bounded event selection before mutation. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.rsvp_plus_one_not_eligible_no_false_success](../../evals/cases/live-behavior-rsvp-plus-one-not-eligible.yaml) | Plus-one not eligible returns saved false and is reported honestly without false success. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.rsvp_plus_one_uses_phone_scoped_mutation](../../evals/cases/live-behavior-rsvp-plus-one.yaml) | A single explicit +1 response uses the trusted-phone RSVP endpoint and reports only the typed saved outcome. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.rsvp_state_reversal_ends_confirmed](../../evals/cases/live-behavior-rsvp-attendance-confirmed.yaml) | An affirmative attendance request ends in a backend-grounded confirmed state, whether the service changes a previous decline or reports that attendance is already confirmed. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.rsvp_trusted_phone_reports_no_pending](../../evals/cases/live-behavior-rsvp-trusted-phone.yaml) | A clear RSVP decision uses the trusted channel phone and distinguishes no associated invitations from no pending invitations. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.spanish_only_mixed_language_request](../../evals/cases/live-behavior-spanish-only.yaml) | A mixed-language request must be understood while every user-visible natural-language word in the reply remains Spanish. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_behavior.support_detail_continuity](../../evals/cases/live-behavior-support-detail-continuity.yaml) | Details supplied after a payment-support answer remain attached to that support thread and do not replace the channel user's identity. | live_behavior_regression | live_lambda | 3 | 1 |
| [live_behavior.wedding_planner_location_completes_search](../../evals/cases/live-behavior-wedding-planner-location-completes-search.yaml) | A wedding-planner request should collect the remaining search context compactly and search immediately when the location follow-up completes it. | live_behavior_regression | live_lambda | 4 | 1 |
| [live_feedback.token_fresh_multifront_stays_multi_need](../../evals/cases/live-feedback-token-multifront.yaml) | Fresh multi-front provider request should consume tokens and remain multi-need in live Lambda. | live_behavior_regression | live_lambda | 1 | 1 |
| [live_feedback.token_seeded_close_flow](../../evals/cases/live-feedback-token-close-flow.yaml) | Seeded selected-provider close flow should consume model tokens over several live Lambda turns. | live_behavior_regression | live_lambda | 4 | 1 |
| [live_feedback.token_seeded_contact_correction](../../evals/cases/live-feedback-token-contact-correction.yaml) | Seeded close flow should consume tokens while rejecting and then accepting corrected contact phone. | live_behavior_regression | live_lambda | 3 | 2 |
| [live_feedback.token_seeded_selection_defer_close](../../evals/cases/live-feedback-token-selection-defer-close.yaml) | Seeded multi-need plan should consume tokens while selecting one need, deferring a need after every option is declined, and entering close flow. | live_behavior_regression | live_lambda | 4 | 1 |
| [live.catering_missing_location_clarifies](../../evals/cases/live-catering-missing-location.yaml) | Catering ask without location should stay in clarification/planning envelope. | live_comprehensive | live_lambda | 1 | 0 |
| [live.close_request_temporal_save](../../evals/cases/live-close-request.yaml) | Generic close intent should remain a temporal save branch. | live_comprehensive | live_lambda | 1 | 0 |
| [live.event_plan_then_catering_search](../../evals/cases/live-event-plan-then-catering.yaml) | Event-first planning should persist context and use it for a follow-up Catering search. | live_comprehensive | live_lambda | 2 | 0 |
| [live.event_plan_then_two_needs](../../evals/cases/live-event-plan-then-two-needs.yaml) | A follow-up with two provider needs should preserve the event plan and represent multiple needs. | live_comprehensive | live_lambda | 2 | 0 |
| [live.faq_commission_uses_kb](../../evals/cases/live-faq-commission-uses-kb.yaml) | FAQ questions should enter KB mode, call knowledge_base_search, and answer with commission details from the knowledge base. | live_comprehensive | live_lambda | 1 | 0 |
| [live.faq_from_recommendation_node](../../evals/cases/live-faq-from-recommendation.yaml) | A user in a recommendation flow should be able to ask a FAQ and force KB retrieval instead of provider search. | live_behavior_regression | live_lambda | 1 | 1 |
| [live.faq_gift_product_claim](../../evals/cases/live-faq-gift-product-claim.yaml) | Gift/product claim questions should combine KB facts about optional gift purchase, received value, brand claims, and support channels. | live_comprehensive | live_lambda | 1 | 0 |
| [live.faq_kb_sources_official_and_atc](../../evals/cases/live-faq-kb-sources-official-and-atc.yaml) | FAQ retrieval should answer from both official Tawk.to FAQ content and ATC suggested-response/template snippets without provider search. | live_faq_kb_sources | live_lambda | 1 | 0 |
| [live.faq_reask_then_planning](../../evals/cases/live-faq-reask-then-planning.yaml) | Consecutive FAQ turns should each consult KB, then a planning request should leave FAQ mode and search providers. | live_comprehensive | live_lambda | 3 | 0 |
| [live.faq_web_design_support](../../evals/cases/live-faq-web-design-support.yaml) | Out-of-scope web design requests should stay in FAQ/support mode, not provider search. | live_comprehensive | live_lambda | 1 | 0 |
| [live.local_space_only_request](../../evals/cases/live-local-space-only.yaml) | Local/venue-only phrasing should stay in venue planning/search envelope. | live_comprehensive | live_lambda | 1 | 0 |
| [live.multi_need_message_envelope](../../evals/cases/live-multi-need-message.yaml) | Mixed need message should preserve planning continuity and avoid crashes. | live_comprehensive | live_lambda | 1 | 0 |
| [live.pause_request_temporal_close](../../evals/cases/live-pause-request.yaml) | Pause intent should route to temporal close in live runtime. | live_comprehensive | live_lambda | 1 | 0 |
| [live.photography_with_location_search_path](../../evals/cases/live-photography-with-location.yaml) | Photography ask with event and location should move into recommend/clarify search envelope. | live_comprehensive | live_lambda | 1 | 0 |
| [live.refine_after_recommendation_preserves_need](../../evals/cases/live-refine-after-recommendation.yaml) | Refining after a recommendation should preserve the active venue need instead of reopening category ambiguity. | live_comprehensive | live_lambda | 2 | 0 |
| [live.selection_without_shortlist_fallback](../../evals/cases/live-selection-without-shortlist.yaml) | Direct provider selection without shortlist context should trigger clarification/planning fallback. | live_comprehensive | live_lambda | 1 | 0 |
| [live.trace_tooling_envelope](../../evals/cases/live-trace-tooling-envelope.yaml) | Live trace should show a valid node transition and bounded tool usage for a direct search ask. | live_comprehensive | live_lambda | 1 | 0 |
| [live.vague_provider_request_no_search](../../evals/cases/live-vague-provider-request.yaml) | A vague provider ask should gather event/category/location context before searching. | live_comprehensive | live_lambda | 1 | 0 |
| [multi_need.detailed_elicitation_populates_shortlists](../../evals/cases/multi-need-elicitation-shortlists.yaml) | Event-level elicitation should populate multiple provider needs with independent shortlists in one turn. | multi_need | offline | 1 | 0 |
| [multi_need.select_photography_and_open_catering](../../evals/cases/multi-need-carlos-plus-catering.yaml) | Confirm one provider on photography while opening Catering in the same turn. | multi_need_planning | offline | 1 | 0 |
| [multi_need.select_two_caterings_and_open_music](../../evals/cases/multi-need-two-caterings-plus-music.yaml) | Confirm two Catering providers while opening Música in the same turn. | multi_need_planning | offline | 1 | 0 |
| [recommendation.default_four_results_with_links](../../evals/cases/recommendation-default-four-results.yaml) | Recommendation output should keep four results when available and include detail links and differentiators. | recommendation | offline | 1 | 0 |
| [search_error.provider_failure_moves_to_retry_node](../../evals/cases/search-error-goes-to-retry-node.yaml) | Provider search errors should route to informar_error_reintento and persist that node. | search_failure_modes | offline | 1 | 0 |
| [search_failure.no_results_venue](../../evals/cases/search-failure-no-results-venue.yaml) | Zero-result venue searches should move to refinement without reopening settled terminology. | search_failure_modes | offline | 1 | 0 |
| [selection.choose_edo_from_shortlist](../../evals/cases/selection-edo.yaml) | Choosing EDO from a Catering shortlist should persist the selection and continue from the saved-plan branch. | selection_continuity | offline, live_lambda | 1 | 0 |
| [selection.choose_multiple_catering_from_shortlist](../../evals/cases/selection-multiple-catering.yaml) | Choosing two Catering providers from one shortlist should persist both selections on the same need. | selection_continuity | offline | 1 | 0 |
| [state.close_intent_saves_temporal_node](../../evals/cases/state-close-intent-temporal-save.yaml) | A close intent without finish tool execution should persist temporal close state. | state_and_resume | offline | 1 | 0 |
| [state.finished_plan_short_circuits_turn](../../evals/cases/state-finished-plan-short-circuit.yaml) | A finished plan must short-circuit extraction and keep closed state semantics. | state_and_resume | offline, live_lambda | 1 | 0 |
| [state.pause_request_persists_closure_node](../../evals/cases/state-pause-and-resume.yaml) | Pause requests should store the temporal-close node. | state_and_resume | offline | 1 | 0 |
| [state.resume_from_temporal_close_goes_to_entrevista](../../evals/cases/state-resume-from-temporal-close.yaml) | A saved temporary-close node should resume in entrevista instead of re-closing. | state_and_resume | offline | 1 | 0 |
| [trace.search_tool_outputs_exposed](../../evals/cases/trace-observability-search.yaml) | Search traces should expose tool outputs and provider results for debugging. | trace_observability | offline | 1 | 0 |

## Explicit suite membership

Suite counts overlap. Do not add these counts to obtain a sample size.

### benchmark_full

Comprehensive matrix-oriented benchmark suite. (10 explicit cases.)

- [entrypoint.event_known_no_active_need](../../evals/cases/entrypoint-planning-event-known.yaml)
- [clarification.missing_location_for_active_need](../../evals/cases/clarification-missing-location.yaml)
- [domain.guest_range_boundary_100](../../evals/cases/domain-guest-range-boundary.yaml)
- [selection.choose_edo_from_shortlist](../../evals/cases/selection-edo.yaml)
- [multi_need.select_photography_and_open_catering](../../evals/cases/multi-need-carlos-plus-catering.yaml)
- [domain.local_solo_espacio_no_category_reask](../../evals/cases/domain-local-solo-espacio.yaml)
- [search_failure.no_results_venue](../../evals/cases/search-failure-no-results-venue.yaml)
- [recommendation.default_four_results_with_links](../../evals/cases/recommendation-default-four-results.yaml)
- [state.pause_request_persists_closure_node](../../evals/cases/state-pause-and-resume.yaml)
- [trace.search_tool_outputs_exposed](../../evals/cases/trace-observability-search.yaml)

### dev_regression

Medium-sized offline regression suite for active development. (12 explicit cases.)

- [entrypoint.event_known_no_active_need](../../evals/cases/entrypoint-planning-event-known.yaml)
- [clarification.missing_location_for_active_need](../../evals/cases/clarification-missing-location.yaml)
- [domain.guest_range_boundary_100](../../evals/cases/domain-guest-range-boundary.yaml)
- [multi_need.select_photography_and_open_catering](../../evals/cases/multi-need-carlos-plus-catering.yaml)
- [multi_need.select_two_caterings_and_open_music](../../evals/cases/multi-need-two-caterings-plus-music.yaml)
- [multi_need.detailed_elicitation_populates_shortlists](../../evals/cases/multi-need-elicitation-shortlists.yaml)
- [selection.choose_multiple_catering_from_shortlist](../../evals/cases/selection-multiple-catering.yaml)
- [domain.local_solo_espacio_no_category_reask](../../evals/cases/domain-local-solo-espacio.yaml)
- [search_failure.no_results_venue](../../evals/cases/search-failure-no-results-venue.yaml)
- [recommendation.default_four_results_with_links](../../evals/cases/recommendation-default-four-results.yaml)
- [state.pause_request_persists_closure_node](../../evals/cases/state-pause-and-resume.yaml)
- [trace.search_tool_outputs_exposed](../../evals/cases/trace-observability-search.yaml)

### feedback_regression

Deterministic offline regression suite covering batch1 and batch2 feedback fixes. (12 explicit cases.)

- [feedback.close_selected_provider_does_not_reask](../../evals/cases/feedback-close-selected-provider.yaml)
- [feedback.invalid_phone_rejected_immediately](../../evals/cases/feedback-invalid-phone-immediate.yaml)
- [feedback.phone_correction_updates_single_field](../../evals/cases/feedback-phone-correction.yaml)
- [feedback.none_defers_need_and_allows_close](../../evals/cases/feedback-none-defers-need.yaml)
- [feedback.unselected_shortlist_blocks_close_until_deferred](../../evals/cases/feedback-unselected-shortlist-blocks-close.yaml)
- [feedback.zero_result_need_not_treated_as_pending](../../evals/cases/feedback-zero-result-not-pending.yaml)
- [feedback.selection_confirmation_does_not_relist](../../evals/cases/feedback-selection-no-new-list.yaml)
- [feedback.post_error_clarification_does_not_relist](../../evals/cases/feedback-post-error-no-relist.yaml)
- [feedback.faq_web_design_support_boundary](../../evals/cases/feedback-faq-web-design-support.yaml)
- [feedback.faq_gift_product_claim_clear_next_steps](../../evals/cases/feedback-faq-gift-claim.yaml)
- [feedback.location_filtering_avoids_mexico_for_lurin](../../evals/cases/feedback-location-filtering-lurin.yaml)
- [feedback.multi_need_request_not_downgraded_by_stale_focus](../../evals/cases/feedback-multi-need-stale-focus.yaml)

### live_behavior_regression

Fail-closed live Lambda regressions reconstructed from concrete interaction feedback, with mandatory semantic judging. (59 explicit cases.)

- [live_behavior.mailbox_issue_deferral_and_clarification_preserve_support](../../evals/cases/live-behavior-mailbox-continuity-maria-isabel.yaml)
- [live_behavior.purchase_confirmation_carina_request_survives_normalization](../../evals/cases/live-behavior-purchase-confirmation-carina.yaml)
- [live_behavior.host_withdrawal_diana_policy_and_support](../../evals/cases/live-behavior-host-withdrawal-diana.yaml)
- [live_behavior.host_withdrawal_general_policy_only](../../evals/cases/live-behavior-host-withdrawal-general.yaml)
- [live_behavior.host_withdrawal_pending_event_followup](../../evals/cases/live-behavior-host-withdrawal-event-followup.yaml)
- [live_behavior.rsvp_missing_event_identity_is_unavailable](../../evals/cases/live-behavior-rsvp-missing-event-identity.yaml)
- [live_behavior.host_support_allows_explicit_rsvp_switch](../../evals/cases/live-behavior-host-support-explicit-rsvp-switch.yaml)
- [live_behavior.concurrent_support_turns_preserve_context](../../evals/cases/live-behavior-concurrent-support-turns.yaml)
- [live_behavior.phone_purchase_missing_hands_off_once](../../evals/cases/live-behavior-phone-missing-information.yaml)
- [live_feedback.token_seeded_close_flow](../../evals/cases/live-feedback-token-close-flow.yaml)
- [live_feedback.token_seeded_contact_correction](../../evals/cases/live-feedback-token-contact-correction.yaml)
- [live_feedback.token_seeded_selection_defer_close](../../evals/cases/live-feedback-token-selection-defer-close.yaml)
- [live_feedback.token_fresh_multifront_stays_multi_need](../../evals/cases/live-feedback-token-multifront.yaml)
- [live_behavior.spanish_only_mixed_language_request](../../evals/cases/live-behavior-spanish-only.yaml)
- [live_behavior.repeated_otp_failure_preserves_gift_query](../../evals/cases/live-behavior-repeated-otp-failure.yaml)
- [live_behavior.purchase_delia_status_by_phone](../../evals/cases/live-behavior-purchase-delia-phone-orders.yaml)
- [live_behavior.purchase_kiara_pending_by_phone](../../evals/cases/live-behavior-purchase-kiara-phone-orders.yaml)
- [live_behavior.purchase_joaquin_dedication_selection](../../evals/cases/live-behavior-purchase-joaquin-dedication.yaml)
- [live_behavior.purchase_martha_accountless_selection](../../evals/cases/live-behavior-purchase-martha-accountless.yaml)
- [live_behavior.customer_transaction_code_by_phone](../../evals/cases/live-behavior-customer-transaction-code-by-phone.yaml)
- [live_behavior.rsvp_cristian_phone_enriched_confirmation](../../evals/cases/live-behavior-rsvp-cristian-phone-enriched.yaml)
- [live_behavior.accountless_guest_event_uses_phone_without_otp](../../evals/cases/live-behavior-accountless-guest-event.yaml)
- [live_behavior.accountless_event_answer_precedes_remaining_private_auth](../../evals/cases/live-behavior-accountless-event-before-private-auth.yaml)
- [live_behavior.phone_account_rejection_requests_email](../../evals/cases/live-behavior-phone-account-rejected.yaml)
- [live_behavior.payment_destination_requires_pending_purchase](../../evals/cases/live-behavior-payment-destination-requires-pending.yaml)
- [live_behavior.nonphysical_purchase_omits_shipping](../../evals/cases/live-behavior-nonphysical-purchase-omits-shipping.yaml)
- [live_behavior.ambiguous_confirmation_clarifies](../../evals/cases/live-behavior-ambiguous-confirmation.yaml)
- [live_behavior.provider_reference_cheaper_option](../../evals/cases/live-behavior-provider-reference-cheaper.yaml)
- [live_behavior.provider_reference_miraflores_option](../../evals/cases/live-behavior-provider-reference-miraflores.yaml)
- [live.faq_from_recommendation_node](../../evals/cases/live-faq-from-recommendation.yaml)
- [live_behavior.phone_confirmation_unclear_requires_yes_or_no](../../evals/cases/live-behavior-phone-confirmation-unclear.yaml)
- [live_behavior.otp_not_received_requires_response](../../evals/cases/live-behavior-otp-not-received.yaml)
- [live_behavior.otp_nondelivery_auto_resends_once](../../evals/cases/live-behavior-otp-auto-resend-once.yaml)
- [live_behavior.authentication_refusal_closes_protected_query](../../evals/cases/live-behavior-auth-refusal-closes-query.yaml)
- [live_behavior.otp_sent_explains_image_limitation](../../evals/cases/live-behavior-otp-sent-image-guidance.yaml)
- [live_behavior.otp_number_words_are_verified](../../evals/cases/live-behavior-otp-number-words.yaml)
- [live_behavior.rsvp_missing_action_requires_explicit_decision](../../evals/cases/live-behavior-rsvp-missing-action.yaml)
- [live_behavior.rsvp_trusted_phone_reports_no_pending](../../evals/cases/live-behavior-rsvp-trusted-phone.yaml)
- [live_behavior.rsvp_jose_campaign_invitation_not_reported_missing](../../evals/cases/live-behavior-rsvp-jose-campaign.yaml)
- [live_behavior.rsvp_cinthya_campaign_invitation_not_reported_missing](../../evals/cases/live-behavior-rsvp-cinthya-campaign.yaml)
- [live_behavior.rsvp_ambiguous_event_requires_grounded_selection](../../evals/cases/live-behavior-rsvp-ambiguous-event.yaml)
- [live_behavior.rsvp_confirmed_state_is_reported](../../evals/cases/live-behavior-rsvp-confirmed-state.yaml)
- [live_behavior.rsvp_declined_state_offers_one_change](../../evals/cases/live-behavior-rsvp-declined-state.yaml)
- [live_behavior.rsvp_state_reversal_ends_confirmed](../../evals/cases/live-behavior-rsvp-attendance-confirmed.yaml)
- [live_behavior.wedding_planner_location_completes_search](../../evals/cases/live-behavior-wedding-planner-location-completes-search.yaml)
- [live_behavior.reset_plan_discards_stored_context](../../evals/cases/live-behavior-reset-plan.yaml)
- [live_behavior.rsvp_paolo_mariana_resolved_single](../../evals/cases/live-behavior-rsvp-paolo-mariana-resolved-single.yaml)
- [live_behavior.rsvp_multi_person_offers_human_help](../../evals/cases/live-behavior-rsvp-multi-person-human-help.yaml)
- [live_behavior.rsvp_plus_one_uses_phone_scoped_mutation](../../evals/cases/live-behavior-rsvp-plus-one.yaml)
- [live_behavior.purchase_pending_transfer_continuity](../../evals/cases/live-behavior-purchase-pending-transfer-continuity.yaml)
- [live_behavior.support_detail_continuity](../../evals/cases/live-behavior-support-detail-continuity.yaml)
- [live_behavior.purchase_current_pending_over_old_approved](../../evals/cases/live-behavior-purchase-current-vs-old.yaml)
- [live_behavior.active_cart_checkout_continuity_alex](../../evals/cases/live-behavior-active-cart-checkout-alex.yaml)
- [live_behavior.abandoned_cart_only_sonia](../../evals/cases/live-behavior-abandoned-cart-sonia.yaml)
- [live_behavior.current_campaign_order_over_historical_declined_maria_jose](../../evals/cases/live-behavior-current-campaign-order-maria-jose.yaml)
- [live_behavior.pending_balance_validation_luis](../../evals/cases/live-behavior-pending-balance-luis.yaml)
- [live_behavior.rsvp_guest_and_plus_one_combined_saved](../../evals/cases/live-behavior-rsvp-plus-one-combined.yaml)
- [live_behavior.rsvp_plus_one_multiple_events_requires_selection](../../evals/cases/live-behavior-rsvp-plus-one-multiple-events.yaml)
- [live_behavior.rsvp_plus_one_not_eligible_no_false_success](../../evals/cases/live-behavior-rsvp-plus-one-not-eligible.yaml)

### live_comprehensive

Comprehensive live Lambda benchmark with diverse non-seeded cases and no skip paths. (19 explicit cases.)

- [entrypoint.event_known_no_active_need](../../evals/cases/entrypoint-planning-event-known.yaml)
- [domain.guest_range_boundary_100](../../evals/cases/domain-guest-range-boundary.yaml)
- [live.pause_request_temporal_close](../../evals/cases/live-pause-request.yaml)
- [live.close_request_temporal_save](../../evals/cases/live-close-request.yaml)
- [live.catering_missing_location_clarifies](../../evals/cases/live-catering-missing-location.yaml)
- [live.photography_with_location_search_path](../../evals/cases/live-photography-with-location.yaml)
- [live.local_space_only_request](../../evals/cases/live-local-space-only.yaml)
- [live.multi_need_message_envelope](../../evals/cases/live-multi-need-message.yaml)
- [live.selection_without_shortlist_fallback](../../evals/cases/live-selection-without-shortlist.yaml)
- [live.trace_tooling_envelope](../../evals/cases/live-trace-tooling-envelope.yaml)
- [live.faq_commission_uses_kb](../../evals/cases/live-faq-commission-uses-kb.yaml)
- [live.faq_reask_then_planning](../../evals/cases/live-faq-reask-then-planning.yaml)
- [live.faq_from_recommendation_node](../../evals/cases/live-faq-from-recommendation.yaml)
- [live.faq_web_design_support](../../evals/cases/live-faq-web-design-support.yaml)
- [live.faq_gift_product_claim](../../evals/cases/live-faq-gift-product-claim.yaml)
- [live.event_plan_then_catering_search](../../evals/cases/live-event-plan-then-catering.yaml)
- [live.event_plan_then_two_needs](../../evals/cases/live-event-plan-then-two-needs.yaml)
- [live.refine_after_recommendation_preserves_need](../../evals/cases/live-refine-after-recommendation.yaml)
- [live.vague_provider_request_no_search](../../evals/cases/live-vague-provider-request.yaml)

### live_faq_kb_sources

Focused live FAQ knowledge-base suite validating official Tawk.to FAQ and ATC suggested-response/template retrieval. (1 explicit cases.)

- [live.faq_kb_sources_official_and_atc](../../evals/cases/live-faq-kb-sources-official-and-atc.yaml)

### live_feedback_token_regression

Live Lambda feedback regression suite that consumes model tokens over seeded and multi-turn conversations. (4 explicit cases.)

- [live_feedback.token_seeded_close_flow](../../evals/cases/live-feedback-token-close-flow.yaml)
- [live_feedback.token_seeded_contact_correction](../../evals/cases/live-feedback-token-contact-correction.yaml)
- [live_feedback.token_seeded_selection_defer_close](../../evals/cases/live-feedback-token-selection-defer-close.yaml)
- [live_feedback.token_fresh_multifront_stays_multi_need](../../evals/cases/live-feedback-token-multifront.yaml)

### live_smoke

Curated low-cost live Lambda validation suite. (3 explicit cases.)

- [entrypoint.event_known_no_active_need](../../evals/cases/entrypoint-planning-event-known.yaml)
- [domain.guest_range_boundary_100](../../evals/cases/domain-guest-range-boundary.yaml)
- [selection.choose_edo_from_shortlist](../../evals/cases/selection-edo.yaml)

### smoke

Small, stable suite for fast sanity checks. (3 explicit cases.)

- [entrypoint.event_known_no_active_need](../../evals/cases/entrypoint-planning-event-known.yaml)
- [domain.guest_range_boundary_100](../../evals/cases/domain-guest-range-boundary.yaml)
- [selection.choose_edo_from_shortlist](../../evals/cases/selection-edo.yaml)

## Behavior-change registry

Source: [evals/live-behavior-coverage.yaml](../../evals/live-behavior-coverage.yaml). Each entry records a change and its registered implementation reference. These references are reproduced as registry metadata, not independently audited commit ancestry. Reusing a case does not create an independent experiment.

| Registered change | Implementation reference | Required live cases |
|---|---|---|
| approved-purchase-summary-omits-payment-type | `53483659` | [live_behavior.accountless_event_answer_precedes_remaining_private_auth](../../evals/cases/live-behavior-accountless-event-before-private-auth.yaml) |
| preserve-neutral-auth-purchase-extraction-instead-of-welcome | `4dce9960` | [live_behavior.purchase_confirmation_carina_request_survives_normalization](../../evals/cases/live-behavior-purchase-confirmation-carina.yaml) |
| typed-mailbox-support-act-preserves-conversation-continuity | `ff9e1491` | [live_behavior.mailbox_issue_deferral_and_clarification_preserve_support](../../evals/cases/live-behavior-mailbox-continuity-maria-isabel.yaml) |
| compact-established-support-extractor-omits-planning-context | `ff9e1491` | [live_behavior.mailbox_issue_deferral_and_clarification_preserve_support](../../evals/cases/live-behavior-mailbox-continuity-maria-isabel.yaml) |
| deterministic-support-acknowledgment-avoids-reply-model-and-lookups | `ff9e1491` | [live_behavior.mailbox_issue_deferral_and_clarification_preserve_support](../../evals/cases/live-behavior-mailbox-continuity-maria-isabel.yaml) |
| typed-support-anchor-preserves-ambiguous-followup-lane | `297974f4` | [live_behavior.mailbox_issue_deferral_and_clarification_preserve_support](../../evals/cases/live-behavior-mailbox-continuity-maria-isabel.yaml) |
| confirmation-document-checks-canonical-status-and-hands-off-once | `ff9e1491` | [live_behavior.purchase_confirmation_carina_request_survives_normalization](../../evals/cases/live-behavior-purchase-confirmation-carina.yaml) |
| typed-policy-support-act-requires-indexed-faq-evidence | `ff9e1491` | [live_behavior.support_detail_continuity](../../evals/cases/live-behavior-support-detail-continuity.yaml) |
| rejected-purchase-extraction-cannot-fall-through-to-welcome | `ff9e1491` | [live_behavior.purchase_confirmation_carina_request_survives_normalization](../../evals/cases/live-behavior-purchase-confirmation-carina.yaml) |
| phone-scoped-human-handoff-uses-only-trusted-channel-phone | `ff9e1491` | [live_behavior.purchase_confirmation_carina_request_survives_normalization](../../evals/cases/live-behavior-purchase-confirmation-carina.yaml) |
| attendance-state-query-clears-old-mutations-and-does-not-offer-new-ones | `202e75cc` | [live_behavior.host_support_allows_explicit_rsvp_switch](../../evals/cases/live-behavior-host-support-explicit-rsvp-switch.yaml) |
| personal-attendance-state-has-one-extraction-route | `21234610` | [live_behavior.host_support_allows_explicit_rsvp_switch](../../evals/cases/live-behavior-host-support-explicit-rsvp-switch.yaml) |
| host-withdrawal-policy-and-individual-status-support | `01ea7d53` | [live_behavior.host_withdrawal_diana_policy_and_support](../../evals/cases/live-behavior-host-withdrawal-diana.yaml); [live_behavior.host_withdrawal_general_policy_only](../../evals/cases/live-behavior-host-withdrawal-general.yaml) |
| pending-information-event-reference-does-not-start-rsvp | `01ea7d53` | [live_behavior.host_withdrawal_pending_event_followup](../../evals/cases/live-behavior-host-withdrawal-event-followup.yaml); [live_behavior.host_support_allows_explicit_rsvp_switch](../../evals/cases/live-behavior-host-support-explicit-rsvp-switch.yaml) |
| guest-record-name-is-not-event-identity | `01ea7d53` | [live_behavior.rsvp_missing_event_identity_is_unavailable](../../evals/cases/live-behavior-rsvp-missing-event-identity.yaml) |
| reported-event-role-does-not-force-welcome-schema | `01ea7d53` | [live_behavior.host_withdrawal_diana_policy_and_support](../../evals/cases/live-behavior-host-withdrawal-diana.yaml) |
| remove-stale-retired-confirmation-summary | `2f0d313` | [live_behavior.phone_confirmation_unclear_requires_yes_or_no](../../evals/cases/live-behavior-phone-confirmation-unclear.yaml) |
| preserve-complete-numeric-faq-evidence | `56dc2e0` | [live.faq_from_recommendation_node](../../evals/cases/live-faq-from-recommendation.yaml) |
| state-explicit-numeric-faq-values | `181f0e0` | [live.faq_from_recommendation_node](../../evals/cases/live-faq-from-recommendation.yaml) |
| route-faq-from-active-planning-nodes | `4e45fcb` | [live.faq_from_recommendation_node](../../evals/cases/live-faq-from-recommendation.yaml) |
| preserve-ambiguous-confirmation-evidence | `112015f` | [live_behavior.ambiguous_confirmation_clarifies](../../evals/cases/live-behavior-ambiguous-confirmation.yaml) |
| reject-ungrounded-multi-candidate-confirmations | `f99d6a2` | [live_behavior.ambiguous_confirmation_clarifies](../../evals/cases/live-behavior-ambiguous-confirmation.yaml) |
| reject-ungrounded-provider-selection-operations | `20cbb0e` | [live_behavior.ambiguous_confirmation_clarifies](../../evals/cases/live-behavior-ambiguous-confirmation.yaml) |
| render-neutral-provider-confirmation-clarification | `9284b0e` | [live_behavior.ambiguous_confirmation_clarifies](../../evals/cases/live-behavior-ambiguous-confirmation.yaml) |
| resolve-provider-price-references | `112015f` | [live_behavior.provider_reference_cheaper_option](../../evals/cases/live-behavior-provider-reference-cheaper.yaml) |
| resolve-provider-location-references | `112015f` | [live_behavior.provider_reference_miraflores_option](../../evals/cases/live-behavior-provider-reference-miraflores.yaml) |
| enforce-spanish-only-output | `dab4c2b` | [live_behavior.spanish_only_mixed_language_request](../../evals/cases/live-behavior-spanish-only.yaml) |
| preserve-close-phone-correction-context | `b4fe8f1` | [live_feedback.token_seeded_contact_correction](../../evals/cases/live-feedback-token-contact-correction.yaml) |
| preserve-multi-need-event-plans | `3063ebe` | [live_feedback.token_fresh_multifront_stays_multi_need](../../evals/cases/live-feedback-token-multifront.yaml) |
| preserve-deferred-provider-needs-at-close | `cf43147` | [live_feedback.token_seeded_selection_defer_close](../../evals/cases/live-feedback-token-selection-defer-close.yaml) |
| stop-repeated-verification-loops | `82be35d` | [live_behavior.repeated_otp_failure_preserves_gift_query](../../evals/cases/live-behavior-repeated-otp-failure.yaml) |
| render-completed-submissions-as-final | `26893ff` | [live_feedback.token_seeded_close_flow](../../evals/cases/live-feedback-token-close-flow.yaml) |
| recover-retired-phone-confirmation-state | `bbe5ca6` | [live_behavior.phone_confirmation_unclear_requires_yes_or_no](../../evals/cases/live-behavior-phone-confirmation-unclear.yaml) |
| clear-retired-phone-confirmation-ambiguity | `4266f35` | [live_behavior.phone_confirmation_unclear_requires_yes_or_no](../../evals/cases/live-behavior-phone-confirmation-unclear.yaml) |
| fall-back-after-explicit-phone-account-rejection | `14e0e65` | [live_behavior.phone_account_rejection_requests_email](../../evals/cases/live-behavior-phone-account-rejected.yaml) |
| persist-sanitized-authentication-execution-diagnostics | `14e0e65` | [live_behavior.repeated_otp_failure_preserves_gift_query](../../evals/cases/live-behavior-repeated-otp-failure.yaml) |
| clarify-imprecise-phone-confirmation-answers | `de67a04` | [live_behavior.phone_confirmation_unclear_requires_yes_or_no](../../evals/cases/live-behavior-phone-confirmation-unclear.yaml) |
| respond-to-missing-otp-reports | `de67a04` | [live_behavior.otp_not_received_requires_response](../../evals/cases/live-behavior-otp-not-received.yaml) |
| explain-image-limitation-after-sending-otp | `7b14756` | [live_behavior.otp_sent_explains_image_limitation](../../evals/cases/live-behavior-otp-sent-image-guidance.yaml) |
| accept-otp-expressed-as-spanish-digit-words | `7332063` | [live_behavior.otp_number_words_are_verified](../../evals/cases/live-behavior-otp-number-words.yaml) |
| preserve-resolved-information-query-in-reply-evidence | `ce63c1f` | [live_behavior.phone_confirmation_unclear_requires_yes_or_no](../../evals/cases/live-behavior-phone-confirmation-unclear.yaml) |
| withhold-payment-destination-without-pending-purchase | `d08aac3` | [live_behavior.payment_destination_requires_pending_purchase](../../evals/cases/live-behavior-payment-destination-requires-pending.yaml) |
| omit-shipping-for-nonphysical-purchases | `d08aac3` | [live_behavior.nonphysical_purchase_omits_shipping](../../evals/cases/live-behavior-nonphysical-purchase-omits-shipping.yaml) |
| route-rsvp-through-structured-extraction | `5dd22c4` | [live_behavior.rsvp_missing_action_requires_explicit_decision](../../evals/cases/live-behavior-rsvp-missing-action.yaml) |
| require-explicit-rsvp-action-before-mutation | `5dd22c4` | [live_behavior.rsvp_missing_action_requires_explicit_decision](../../evals/cases/live-behavior-rsvp-missing-action.yaml) |
| use-trusted-channel-phone-for-rsvp-without-account-auth | `5dd22c4` | [live_behavior.rsvp_trusted_phone_reports_no_pending](../../evals/cases/live-behavior-rsvp-trusted-phone.yaml) |
| report-only-backend-confirmed-rsvp-outcomes | `5dd22c4` | [live_behavior.rsvp_trusted_phone_reports_no_pending](../../evals/cases/live-behavior-rsvp-trusted-phone.yaml) |
| persist-multiple-pending-rsvp-candidates | `5dd22c4` | [live_behavior.rsvp_ambiguous_event_requires_grounded_selection](../../evals/cases/live-behavior-rsvp-ambiguous-event.yaml) |
| reject-ungrounded-rsvp-event-selection | `5dd22c4` | [live_behavior.rsvp_ambiguous_event_requires_grounded_selection](../../evals/cases/live-behavior-rsvp-ambiguous-event.yaml) |
| keep-pending-rsvp-followups-unsuppressed | `5dd22c4` | [live_behavior.rsvp_ambiguous_event_requires_grounded_selection](../../evals/cases/live-behavior-rsvp-ambiguous-event.yaml) |
| route-development-lambda-to-production-agent-api | `570be47` | [live_behavior.rsvp_trusted_phone_reports_no_pending](../../evals/cases/live-behavior-rsvp-trusted-phone.yaml) |
| preserve-campaign-grounded-rsvp-when-no-mutation-is-pending-jose | `6a9bbe6` | [live_behavior.rsvp_jose_campaign_invitation_not_reported_missing](../../evals/cases/live-behavior-rsvp-jose-campaign.yaml) |
| preserve-campaign-grounded-rsvp-when-no-mutation-is-pending-cinthya | `e0557c3` | [live_behavior.rsvp_cinthya_campaign_invitation_not_reported_missing](../../evals/cases/live-behavior-rsvp-cinthya-campaign.yaml) |
| keep-first-turn-rsvp-decision-out-of-acknowledgement-suppression | `c900d91` | [live_behavior.rsvp_cinthya_campaign_invitation_not_reported_missing](../../evals/cases/live-behavior-rsvp-cinthya-campaign.yaml) |
| require-structured-extraction-before-suppressing-campaign-replies | `7ee8bdc` | [live_behavior.rsvp_cinthya_campaign_invitation_not_reported_missing](../../evals/cases/live-behavior-rsvp-cinthya-campaign.yaml) |
| render-selected-and-deferred-close-outcomes-accurately | `b82d28e` | [live_feedback.token_seeded_selection_defer_close](../../evals/cases/live-feedback-token-selection-defer-close.yaml) |
| read-complete-user-level-rsvp-state-before-mutation | `6a9bbe6` | [live_behavior.rsvp_confirmed_state_is_reported](../../evals/cases/live-behavior-rsvp-confirmed-state.yaml); [live_behavior.rsvp_declined_state_offers_one_change](../../evals/cases/live-behavior-rsvp-declined-state.yaml) |
| report-confirmed-rsvp-state-without-redundant-mutation | `6a9bbe6` | [live_behavior.rsvp_confirmed_state_is_reported](../../evals/cases/live-behavior-rsvp-confirmed-state.yaml) |
| reject-false-rsvp-success-from-already-responded-envelope | `c132b28` | [live_behavior.rsvp_state_reversal_ends_confirmed](../../evals/cases/live-behavior-rsvp-attendance-confirmed.yaml) |
| distinguish-no-associated-invitations-from-no-pending-invitations | `c132b28` | [live_behavior.rsvp_trusted_phone_reports_no_pending](../../evals/cases/live-behavior-rsvp-trusted-phone.yaml) |
| request-email-code-by-copy-and-paste-without-text-wording | `c132b28` | [live_behavior.otp_sent_explains_image_limitation](../../evals/cases/live-behavior-otp-sent-image-guidance.yaml) |
| distinguish-otp-transport-failures-from-invalid-codes | `dee1d45` | [live_behavior.repeated_otp_failure_preserves_gift_query](../../evals/cases/live-behavior-repeated-otp-failure.yaml) |
| report-rsvp-state-only-after-explicit-backend-confirmation | `dee1d45` | [live_behavior.rsvp_state_reversal_ends_confirmed](../../evals/cases/live-behavior-rsvp-attendance-confirmed.yaml) |
| accept-backend-confirmed-rsvp-state-reversal | `dee1d45` | [live_behavior.rsvp_state_reversal_ends_confirmed](../../evals/cases/live-behavior-rsvp-attendance-confirmed.yaml) |
| preserve-associated-event-otp-nondelivery-action | `dee1d45` | [live_behavior.otp_not_received_requires_response](../../evals/cases/live-behavior-otp-not-received.yaml) |
| omit-cash-gift-shipping-fields-from-reply-model | `dee1d45` | [live_behavior.nonphysical_purchase_omits_shipping](../../evals/cases/live-behavior-nonphysical-purchase-omits-shipping.yaml) |
| withhold-blocked-information-intent-from-authentication-replies | `0280883` | [live_behavior.nonphysical_purchase_omits_shipping](../../evals/cases/live-behavior-nonphysical-purchase-omits-shipping.yaml) |
| combine-critical-provider-search-questions | `f9232c8` | [live_behavior.wedding_planner_location_completes_search](../../evals/cases/live-behavior-wedding-planner-location-completes-search.yaml) |
| focus-single-retrieval-ready-follow-up-query | `f9232c8` | [live_behavior.wedding_planner_location_completes_search](../../evals/cases/live-behavior-wedding-planner-location-completes-search.yaml) |
| support-native-structured-plan-reset | `f9232c8` | [live_behavior.reset_plan_discards_stored_context](../../evals/cases/live-behavior-reset-plan.yaml) |
| discard-all-stored-planning-context-on-reset | `f9232c8` | [live_behavior.reset_plan_discards_stored_context](../../evals/cases/live-behavior-reset-plan.yaml) |
| discover-accountless-event-guests-before-email-otp | `f9232c8` | [live_behavior.accountless_guest_event_uses_phone_without_otp](../../evals/cases/live-behavior-accountless-guest-event.yaml) |
| read-accountless-guest-event-detail-without-jwt | `f9232c8` | [live_behavior.accountless_guest_event_uses_phone_without_otp](../../evals/cases/live-behavior-accountless-guest-event.yaml) |
| answer-accountless-event-data-before-authenticating-remaining-private-queries | `370e41b` | [live_behavior.accountless_event_answer_precedes_remaining_private_auth](../../evals/cases/live-behavior-accountless-event-before-private-auth.yaml) |
| apply-explicit-rsvp-reversals-in-one-turn | `f9232c8` | [live_behavior.rsvp_state_reversal_ends_confirmed](../../evals/cases/live-behavior-rsvp-attendance-confirmed.yaml) |
| parse-documented-rsvp-pending-guests-envelope | `f9232c8` | [live_behavior.rsvp_ambiguous_event_requires_grounded_selection](../../evals/cases/live-behavior-rsvp-ambiguous-event.yaml) |
| treat-will-attend-as-authoritative-rsvp-final-state | `f9232c8` | [live_behavior.rsvp_state_reversal_ends_confirmed](../../evals/cases/live-behavior-rsvp-attendance-confirmed.yaml) |
| anchor-conversation-context-to-newest-campaign | `f9232c8` | [live_behavior.rsvp_cinthya_campaign_invitation_not_reported_missing](../../evals/cases/live-behavior-rsvp-cinthya-campaign.yaml) |
| automatically-resend-first-reported-otp-nondelivery | `ae90190` | [live_behavior.otp_nondelivery_auto_resends_once](../../evals/cases/live-behavior-otp-auto-resend-once.yaml) |
| hand-off-after-exhausted-otp-nondelivery-recovery | `ae90190` | [live_behavior.otp_not_received_requires_response](../../evals/cases/live-behavior-otp-not-received.yaml) |
| hand-off-after-terminal-auth-service-failures | `ae90190` | [live_behavior.otp_not_received_requires_response](../../evals/cases/live-behavior-otp-not-received.yaml) |
| close-protected-request-after-explicit-authentication-refusal | `ae90190` | [live_behavior.authentication_refusal_closes_protected_query](../../evals/cases/live-behavior-auth-refusal-closes-query.yaml) |
| fall-back-to-trusted-phone-event-association-for-rsvp | `ae90190` | [live_behavior.rsvp_cinthya_campaign_invitation_not_reported_missing](../../evals/cases/live-behavior-rsvp-cinthya-campaign.yaml) |
| concurrently-read-rsvp-record-and-event-association-by-phone | `121e3b7` | [live_behavior.rsvp_cinthya_campaign_invitation_not_reported_missing](../../evals/cases/live-behavior-rsvp-cinthya-campaign.yaml) |
| project-one-minimal-reconciled-rsvp-phone-evidence-object | `121e3b7` | [live_behavior.rsvp_cinthya_campaign_invitation_not_reported_missing](../../evals/cases/live-behavior-rsvp-cinthya-campaign.yaml) |
| preserve-original-protected-query-through-authentication-continuations | `56390b5` | [live_behavior.repeated_otp_failure_preserves_gift_query](../../evals/cases/live-behavior-repeated-otp-failure.yaml) |
| name-the-pending-query-in-terminal-authentication-handoffs | `56390b5` | [live_behavior.repeated_otp_failure_preserves_gift_query](../../evals/cases/live-behavior-repeated-otp-failure.yaml) |
| disable-phone-scoped-guest-access-after-explicit-phone-rejection | `56390b5` | [live_behavior.phone_account_rejection_requests_email](../../evals/cases/live-behavior-phone-account-rejected.yaml) |
| distinguish-phone-association-rejection-from-authentication-refusal | `5403a10` | [live_behavior.phone_account_rejection_requests_email](../../evals/cases/live-behavior-phone-account-rejected.yaml); [live_behavior.authentication_refusal_closes_protected_query](../../evals/cases/live-behavior-auth-refusal-closes-query.yaml) |
| route-phone-purchase-summary-without-account-auth | `aff284b` | [live_behavior.purchase_delia_status_by_phone](../../evals/cases/live-behavior-purchase-delia-phone-orders.yaml); [live_behavior.purchase_kiara_pending_by_phone](../../evals/cases/live-behavior-purchase-kiara-phone-orders.yaml) |
| route-phone-gift-detail-without-account-auth | `aff284b` | [live_behavior.purchase_joaquin_dedication_selection](../../evals/cases/live-behavior-purchase-joaquin-dedication.yaml) |
| resolve-accountless-phone-purchases-without-otp-loop | `aff284b` | [live_behavior.purchase_martha_accountless_selection](../../evals/cases/live-behavior-purchase-martha-accountless.yaml) |
| enrich-rsvp-state-through-phone-scoped-event | `6a9bbe6` | [live_behavior.rsvp_cristian_phone_enriched_confirmation](../../evals/cases/live-behavior-rsvp-cristian-phone-enriched.yaml); [live_behavior.rsvp_cinthya_campaign_invitation_not_reported_missing](../../evals/cases/live-behavior-rsvp-cinthya-campaign.yaml) |
| preserve-event-association-when-enriched-attendance-is-null | `aff284b` | [live_behavior.accountless_guest_event_uses_phone_without_otp](../../evals/cases/live-behavior-accountless-guest-event.yaml) |
| reuse-event-scoped-purchases-without-redundant-global-read | `aff284b` | [live_behavior.accountless_event_answer_precedes_remaining_private_auth](../../evals/cases/live-behavior-accountless-event-before-private-auth.yaml) |
| reconcile-phone-purchase-sources-with-minimum-disclosure | `aff284b` | [live_behavior.purchase_delia_status_by_phone](../../evals/cases/live-behavior-purchase-delia-phone-orders.yaml); [live_behavior.purchase_joaquin_dedication_selection](../../evals/cases/live-behavior-purchase-joaquin-dedication.yaml) |
| normalize-customer-transaction-codes-by-phone | `78ae24e` | [live_behavior.customer_transaction_code_by_phone](../../evals/cases/live-behavior-customer-transaction-code-by-phone.yaml) |
| withhold-opaque-order-ids-when-customer-reference-is-unavailable | `78ae24e` | [live_behavior.customer_transaction_code_by_phone](../../evals/cases/live-behavior-customer-transaction-code-by-phone.yaml) |
| project-rsvp-phone-evidence-as-three-state | `82d48b0` | [live_behavior.rsvp_paolo_mariana_resolved_single](../../evals/cases/live-behavior-rsvp-paolo-mariana-resolved-single.yaml) |
| rsvp-resolved-single-thanks-no-change | `e1820df2` | [live_behavior.rsvp_cristian_phone_enriched_confirmation](../../evals/cases/live-behavior-rsvp-cristian-phone-enriched.yaml); [live_behavior.rsvp_cinthya_campaign_invitation_not_reported_missing](../../evals/cases/live-behavior-rsvp-cinthya-campaign.yaml) |
| rsvp-unavailable-never-claim-confirmation | `4c4a56a` | [live_behavior.rsvp_trusted_phone_reports_no_pending](../../evals/cases/live-behavior-rsvp-trusted-phone.yaml) |
| needs-event-selection-projection-carries-candidate-dates | `1620bc3` | [live_behavior.rsvp_ambiguous_event_requires_grounded_selection](../../evals/cases/live-behavior-rsvp-ambiguous-event.yaml) |
| rsvp-current-state-reported-via-hybrid-fragment | `6a9bbe6` | [live_behavior.rsvp_confirmed_state_is_reported](../../evals/cases/live-behavior-rsvp-confirmed-state.yaml) |
| payment-type-excluded-from-summary-aspect | `8172732` | [live_behavior.accountless_event_answer_precedes_remaining_private_auth](../../evals/cases/live-behavior-accountless-event-before-private-auth.yaml) |
| rsvp-action-extracted-only-from-current-message | `6e6d6d7` | [live_behavior.rsvp_missing_action_requires_explicit_decision](../../evals/cases/live-behavior-rsvp-missing-action.yaml) |
| rsvp-declining-offer-asks-explicit-question | `b5eed76` | [live_behavior.rsvp_declined_state_offers_one_change](../../evals/cases/live-behavior-rsvp-declined-state.yaml) |
| rsvp-mutation-requires-current-message-decision-source | `f937265` | [live_behavior.rsvp_missing_action_requires_explicit_decision](../../evals/cases/live-behavior-rsvp-missing-action.yaml) |
| rsvp-multi-person-references-offer-human-help | `afda04bd` | [live_behavior.rsvp_multi_person_offers_human_help](../../evals/cases/live-behavior-rsvp-multi-person-human-help.yaml) |
| rsvp-single-plus-one-phone-scoped-mutation | `377386c1` | [live_behavior.rsvp_plus_one_uses_phone_scoped_mutation](../../evals/cases/live-behavior-rsvp-plus-one.yaml) |
| rsvp-multiple-companions-remain-bounded-human-review | `377386c1` | [live_behavior.rsvp_multi_person_offers_human_help](../../evals/cases/live-behavior-rsvp-multi-person-human-help.yaml) |
| tighten-rsvp-party-detection-precision | `d81c760b` | [live_behavior.rsvp_jose_campaign_invitation_not_reported_missing](../../evals/cases/live-behavior-rsvp-jose-campaign.yaml); [live_behavior.rsvp_multi_person_offers_human_help](../../evals/cases/live-behavior-rsvp-multi-person-human-help.yaml) |
| rsvp-tissue-bounded-to-one-closing-sentence | `eb20f19c` | [live_behavior.rsvp_cristian_phone_enriched_confirmation](../../evals/cases/live-behavior-rsvp-cristian-phone-enriched.yaml); [live_behavior.rsvp_jose_campaign_invitation_not_reported_missing](../../evals/cases/live-behavior-rsvp-jose-campaign.yaml); [live_behavior.rsvp_declined_state_offers_one_change](../../evals/cases/live-behavior-rsvp-declined-state.yaml); [live_behavior.rsvp_missing_action_requires_explicit_decision](../../evals/cases/live-behavior-rsvp-missing-action.yaml) |
| consolidate-resolver-otp-email-duplication | `6411cc7e` | [live_behavior.otp_sent_explains_image_limitation](../../evals/cases/live-behavior-otp-sent-image-guidance.yaml) |
| consolidate-classifier-corporate-reception | `008d0b50` | [live_behavior.rsvp_missing_action_requires_explicit_decision](../../evals/cases/live-behavior-rsvp-missing-action.yaml) |
| scope-information-domain-to-route | `d6bb8f08` | [live_behavior.purchase_delia_status_by_phone](../../evals/cases/live-behavior-purchase-delia-phone-orders.yaml) |
| tighten-responder-invitacion-contract-dedupe | `5e0698f5` | [live_behavior.rsvp_declined_state_offers_one_change](../../evals/cases/live-behavior-rsvp-declined-state.yaml); [live_behavior.rsvp_cristian_phone_enriched_confirmation](../../evals/cases/live-behavior-rsvp-cristian-phone-enriched.yaml) |
| purchase-pending-transfer-currency-time-continuity | `2090c12b` | [live_behavior.purchase_pending_transfer_continuity](../../evals/cases/live-behavior-purchase-pending-transfer-continuity.yaml) |
| support-subject-identity-continuity | `377386c1` | [live_behavior.support_detail_continuity](../../evals/cases/live-behavior-support-detail-continuity.yaml) |
| current-pending-over-historical-completed | `377386c1` | [live_behavior.purchase_current_pending_over_old_approved](../../evals/cases/live-behavior-purchase-current-vs-old.yaml) |
| active-cart-checkout-continuity-alex | `377386c1` | [live_behavior.active_cart_checkout_continuity_alex](../../evals/cases/live-behavior-active-cart-checkout-alex.yaml) |
| abandoned-cart-only-sonia | `377386c1` | [live_behavior.abandoned_cart_only_sonia](../../evals/cases/live-behavior-abandoned-cart-sonia.yaml) |
| current-campaign-order-over-historical-declined-maria-jose | `2090c12b` | [live_behavior.current_campaign_order_over_historical_declined_maria_jose](../../evals/cases/live-behavior-current-campaign-order-maria-jose.yaml) |
| pending-balance-validation-luis | `2090c12b` | [live_behavior.pending_balance_validation_luis](../../evals/cases/live-behavior-pending-balance-luis.yaml) |
| rsvp-guest-and-plus-one-combined-saved | `377386c1` | [live_behavior.rsvp_guest_and_plus_one_combined_saved](../../evals/cases/live-behavior-rsvp-plus-one-combined.yaml) |
| rsvp-plus-one-multiple-events-requires-selection | `377386c1` | [live_behavior.rsvp_plus_one_multiple_events_requires_selection](../../evals/cases/live-behavior-rsvp-plus-one-multiple-events.yaml) |
| rsvp-plus-one-not-eligible-no-false-success | `377386c1` | [live_behavior.rsvp_plus_one_not_eligible_no_false_success](../../evals/cases/live-behavior-rsvp-plus-one-not-eligible.yaml) |
| reconcile-event-conjunctions-in-phone-purchase-selection | `03f617cb` | [live_behavior.purchase_pending_transfer_continuity](../../evals/cases/live-behavior-purchase-pending-transfer-continuity.yaml) |
| preserve-cart-only-coverage-across-event-name-variants | `03f617cb` | [live_behavior.abandoned_cart_only_sonia](../../evals/cases/live-behavior-abandoned-cart-sonia.yaml) |
| route-cart-payment-options-through-orders-and-indexed-policy | `1e7f6ab9` | [live_behavior.abandoned_cart_only_sonia](../../evals/cases/live-behavior-abandoned-cart-sonia.yaml) |
| preserve-primary-purchase-across-derived-policy-continuations | `1e7f6ab9` | [live_behavior.purchase_pending_transfer_continuity](../../evals/cases/live-behavior-purchase-pending-transfer-continuity.yaml) |
| project-derived-purchase-policies-with-minimum-disclosure | `1e7f6ab9` | [live_behavior.abandoned_cart_only_sonia](../../evals/cases/live-behavior-abandoned-cart-sonia.yaml); [live_behavior.purchase_pending_transfer_continuity](../../evals/cases/live-behavior-purchase-pending-transfer-continuity.yaml) |
| classify-receipt-and-currency-corrections-as-purchase-continuations | `a8baf5ce` | [live_behavior.purchase_pending_transfer_continuity](../../evals/cases/live-behavior-purchase-pending-transfer-continuity.yaml) |
| preserve-reextracted-purchase-identity-across-corrections | `a8baf5ce` | [live_behavior.purchase_pending_transfer_continuity](../../evals/cases/live-behavior-purchase-pending-transfer-continuity.yaml) |
| project-unverifiable-purchase-currency-and-time-as-typed-limits | `a8baf5ce` | [live_behavior.purchase_pending_transfer_continuity](../../evals/cases/live-behavior-purchase-pending-transfer-continuity.yaml) |
| validate-trusted-cart-recovery-path-from-outbound-context | `eda1c694` | [live_behavior.abandoned_cart_only_sonia](../../evals/cases/live-behavior-abandoned-cart-sonia.yaml) |
| scope-indexed-payment-options-as-general-gift-policy | `eda1c694` | [live_behavior.abandoned_cart_only_sonia](../../evals/cases/live-behavior-abandoned-cart-sonia.yaml) |
| fix-cart-reply-minimum-disclosure-no-gifts-quantity | `28d77337` | [live_behavior.abandoned_cart_only_sonia](../../evals/cases/live-behavior-abandoned-cart-sonia.yaml) |
| fix-cart-reply-explicit-phone-attribution | `975c7dbf` | [live_behavior.abandoned_cart_only_sonia](../../evals/cases/live-behavior-abandoned-cart-sonia.yaml) |
| fix-cart-reply-grounded-transfer-availability | `c692e885` | [live_behavior.abandoned_cart_only_sonia](../../evals/cases/live-behavior-abandoned-cart-sonia.yaml) |
| selector-guard-single-pending-amount-as-payment-evidence | `e9001af2` | [live_behavior.pending_balance_validation_luis](../../evals/cases/live-behavior-pending-balance-luis.yaml); [live_behavior.current_campaign_order_over_historical_declined_maria_jose](../../evals/cases/live-behavior-current-campaign-order-maria-jose.yaml) |
| constancia-anchor-cod-reference-conditional | `e9001af2` | [live_behavior.purchase_pending_transfer_continuity](../../evals/cases/live-behavior-purchase-pending-transfer-continuity.yaml) |
| support-continuity-preserve-context-and-skip-faq-reprojection | `e9001af2` | [live_behavior.support_detail_continuity](../../evals/cases/live-behavior-support-detail-continuity.yaml) |
| declarative-pending-amount-extraction-example | `e9001af2` | [live_behavior.pending_balance_validation_luis](../../evals/cases/live-behavior-pending-balance-luis.yaml); [live_behavior.current_campaign_order_over_historical_declined_maria_jose](../../evals/cases/live-behavior-current-campaign-order-maria-jose.yaml) |
| event-matching-bidirectional-and-amount-payment-evidence-with-declined-guard | `f045a579` | [live_behavior.current_campaign_order_over_historical_declined_maria_jose](../../evals/cases/live-behavior-current-campaign-order-maria-jose.yaml) |
| classifier-active-information-thread-evidence | `f045a579` | [live_behavior.pending_balance_validation_luis](../../evals/cases/live-behavior-pending-balance-luis.yaml) |
| support-note-continuity-effectiveness | `f045a579` | [live_behavior.support_detail_continuity](../../evals/cases/live-behavior-support-detail-continuity.yaml) |
| payment-identifier-reply-exclusion-and-constancia-anchor-rewording | `2b40848e` | [live_behavior.purchase_current_pending_over_old_approved](../../evals/cases/live-behavior-purchase-current-vs-old.yaml); [live_behavior.purchase_pending_transfer_continuity](../../evals/cases/live-behavior-purchase-pending-transfer-continuity.yaml) |
| payment-report-provenance-and-voucher-fragment | `2b40848e` | [live_behavior.current_campaign_order_over_historical_declined_maria_jose](../../evals/cases/live-behavior-current-campaign-order-maria-jose.yaml); [live_behavior.pending_balance_validation_luis](../../evals/cases/live-behavior-pending-balance-luis.yaml) |
| support-note-effectiveness-and-no-menu-continuation | `2b40848e` | [live_behavior.support_detail_continuity](../../evals/cases/live-behavior-support-detail-continuity.yaml) |
| currency-correction-grounding-in-purchase-replies | `b7d775d2` | [live_behavior.purchase_pending_transfer_continuity](../../evals/cases/live-behavior-purchase-pending-transfer-continuity.yaml) |
| serialize-lambda-conversation-turns-with-consistent-state-and-shared-keys | `02ed1c4b` | [live_behavior.concurrent_support_turns_preserve_context](../../evals/cases/live-behavior-concurrent-support-turns.yaml) |
| phone-scoped-misses-request-human-help-without-automatic-otp | `576a381c` | [live_behavior.concurrent_support_turns_preserve_context](../../evals/cases/live-behavior-concurrent-support-turns.yaml); [live_behavior.phone_purchase_missing_hands_off_once](../../evals/cases/live-behavior-phone-missing-information.yaml) |
| history-continuity-prevents-generic-welcome | `cecd8ac4` | [live_behavior.concurrent_support_turns_preserve_context](../../evals/cases/live-behavior-concurrent-support-turns.yaml) |
| empty-extraction-with-history-uses-contextual-clarification | `cecd8ac4` | [live_behavior.support_detail_continuity](../../evals/cases/live-behavior-support-detail-continuity.yaml) |
| runtime-capability-manifest-bounds-unsupported-actions | `cecd8ac4` | [live_behavior.purchase_pending_transfer_continuity](../../evals/cases/live-behavior-purchase-pending-transfer-continuity.yaml) |
| unsupported-document-safe-read-and-single-handoff | `cecd8ac4` | [live_behavior.purchase_confirmation_carina_request_survives_normalization](../../evals/cases/live-behavior-purchase-confirmation-carina.yaml) |
| text-plus-image-never-claims-content-access | `cecd8ac4` | [live_behavior.otp_sent_explains_image_limitation](../../evals/cases/live-behavior-otp-sent-image-guidance.yaml) |
| server-timestamps-preserve-upstream-values | `cecd8ac4` | [live_behavior.purchase_pending_transfer_continuity](../../evals/cases/live-behavior-purchase-pending-transfer-continuity.yaml) |
| null-currency-remains-uninferred | `cecd8ac4` | [live_behavior.pending_balance_validation_luis](../../evals/cases/live-behavior-pending-balance-luis.yaml) |
| rsvp-plus-one-write-remains-capability-gated | `cecd8ac4` | [live_behavior.rsvp_plus_one_not_eligible_no_false_success](../../evals/cases/live-behavior-rsvp-plus-one-not-eligible.yaml) |
| extractor-emits-requested-operation-without-availability | `cecd8ac4` | [live_behavior.purchase_confirmation_carina_request_survives_normalization](../../evals/cases/live-behavior-purchase-confirmation-carina.yaml) |
| fixture-local-email-otp-outcomes | `a904613e` | [live_behavior.otp_sent_explains_image_limitation](../../evals/cases/live-behavior-otp-sent-image-guidance.yaml) |
| typed-support-reference-acknowledgement | `a904613e` | [live_behavior.support_detail_continuity](../../evals/cases/live-behavior-support-detail-continuity.yaml); [live_behavior.concurrent_support_turns_preserve_context](../../evals/cases/live-behavior-concurrent-support-turns.yaml) |
| gateway-capability-manifest-intersection | `a904613e` | [live_behavior.purchase_confirmation_carina_request_survives_normalization](../../evals/cases/live-behavior-purchase-confirmation-carina.yaml); [live_behavior.rsvp_plus_one_not_eligible_no_false_success](../../evals/cases/live-behavior-rsvp-plus-one-not-eligible.yaml) |
| server-event-timestamps-validated-without-conversion | `a904613e` | [live_behavior.pending_balance_validation_luis](../../evals/cases/live-behavior-pending-balance-luis.yaml); [live_behavior.rsvp_plus_one_not_eligible_no_false_success](../../evals/cases/live-behavior-rsvp-plus-one-not-eligible.yaml) |

## Complete test-file inventory

Presence is coverage intent, not proof that the file passed in this report. Only the registry test was executed here.

- [tests/agent-conversation-gateway.test.ts](../../tests/agent-conversation-gateway.test.ts)
- [tests/agent-participation-service.test.ts](../../tests/agent-participation-service.test.ts)
- [tests/agent-service-information-flow.test.ts](../../tests/agent-service-information-flow.test.ts)
- [tests/agent-service-rsvp.test.ts](../../tests/agent-service-rsvp.test.ts)
- [tests/agent-service.test.ts](../../tests/agent-service.test.ts)
- [tests/artifact-redaction.test.ts](../../tests/artifact-redaction.test.ts)
- [tests/atc-template-ingestion.test.ts](../../tests/atc-template-ingestion.test.ts)
- [tests/attempt3-provider-stub.test.ts](../../tests/attempt3-provider-stub.test.ts)
- [tests/attempt3-typed-state.test.ts](../../tests/attempt3-typed-state.test.ts)
- [tests/auth-observability.test.ts](../../tests/auth-observability.test.ts)
- [tests/batch4-state-machine.test.ts](../../tests/batch4-state-machine.test.ts)
- [tests/bearer-auth.test.ts](../../tests/bearer-auth.test.ts)
- [tests/canary-fixes.test.ts](../../tests/canary-fixes.test.ts)
- [tests/canonical-normalization.test.ts](../../tests/canonical-normalization.test.ts)
- [tests/capability-boundary-routing.test.ts](../../tests/capability-boundary-routing.test.ts)
- [tests/capability-boundary.test.ts](../../tests/capability-boundary.test.ts)
- [tests/cart-amount-not-volunteered.test.ts](../../tests/cart-amount-not-volunteered.test.ts)
- [tests/cart-attribution-phone-hedge.test.ts](../../tests/cart-attribution-phone-hedge.test.ts)
- [tests/class1-fixes.test.ts](../../tests/class1-fixes.test.ts)
- [tests/conversation-turn-coordinator.test.ts](../../tests/conversation-turn-coordinator.test.ts)
- [tests/decision-flow.test.ts](../../tests/decision-flow.test.ts)
- [tests/deployment-endpoint-defaults.test.ts](../../tests/deployment-endpoint-defaults.test.ts)
- [tests/deployment-target-safety.test.ts](../../tests/deployment-target-safety.test.ts)
- [tests/deterministic-cart-only-reply.test.ts](../../tests/deterministic-cart-only-reply.test.ts)
- [tests/development-isolation.test.ts](../../tests/development-isolation.test.ts)
- [tests/dynamic-agent-policy.test.ts](../../tests/dynamic-agent-policy.test.ts)
- [tests/eval-concurrent-turns.test.ts](../../tests/eval-concurrent-turns.test.ts)
- [tests/eval-fixture-gateway.test.ts](../../tests/eval-fixture-gateway.test.ts)
- [tests/eval-grounding.test.ts](../../tests/eval-grounding.test.ts)
- [tests/eval-live-target.test.ts](../../tests/eval-live-target.test.ts)
- [tests/eval-loader.test.ts](../../tests/eval-loader.test.ts)
- [tests/eval-local-fixtures.test.ts](../../tests/eval-local-fixtures.test.ts)
- [tests/eval-metrics.test.ts](../../tests/eval-metrics.test.ts)
- [tests/eval-offline-target.test.ts](../../tests/eval-offline-target.test.ts)
- [tests/eval-pricing.test.ts](../../tests/eval-pricing.test.ts)
- [tests/eval-reporting.test.ts](../../tests/eval-reporting.test.ts)
- [tests/eval-rsvp-hooks.test.ts](../../tests/eval-rsvp-hooks.test.ts)
- [tests/eval-runner-case-ids.test.ts](../../tests/eval-runner-case-ids.test.ts)
- [tests/eval-runner-judge-context.test.ts](../../tests/eval-runner-judge-context.test.ts)
- [tests/eval-runner.test.ts](../../tests/eval-runner.test.ts)
- [tests/eval-study-manifest.test.ts](../../tests/eval-study-manifest.test.ts)
- [tests/event-provider-priorities.test.ts](../../tests/event-provider-priorities.test.ts)
- [tests/extraction-schemas.test.ts](../../tests/extraction-schemas.test.ts)
- [tests/host-withdrawal-policy.test.ts](../../tests/host-withdrawal-policy.test.ts)
- [tests/information-auth-guidance.test.ts](../../tests/information-auth-guidance.test.ts)
- [tests/information-orchestrator.test.ts](../../tests/information-orchestrator.test.ts)
- [tests/knowledge-retrieval-gateway.test.ts](../../tests/knowledge-retrieval-gateway.test.ts)
- [tests/knowledge-sync-atc-cleanup.test.ts](../../tests/knowledge-sync-atc-cleanup.test.ts)
- [tests/lambda-handler-observability.test.ts](../../tests/lambda-handler-observability.test.ts)
- [tests/lambda-request-contract.test.ts](../../tests/lambda-request-contract.test.ts)
- [tests/lambda-request-route.test.ts](../../tests/lambda-request-route.test.ts)
- [tests/lambda-turn-coordination.test.ts](../../tests/lambda-turn-coordination.test.ts)
- [tests/live-behavior-cli.test.ts](../../tests/live-behavior-cli.test.ts)
- [tests/live-behavior-coverage.test.ts](../../tests/live-behavior-coverage.test.ts)
- [tests/local-aws-profile.test.ts](../../tests/local-aws-profile.test.ts)
- [tests/location-compatibility.test.ts](../../tests/location-compatibility.test.ts)
- [tests/message-renderer.test.ts](../../tests/message-renderer.test.ts)
- [tests/message-response-classifier.test.ts](../../tests/message-response-classifier.test.ts)
- [tests/no-atc-trigger-routing.test.ts](../../tests/no-atc-trigger-routing.test.ts)
- [tests/observable-live-script.test.ts](../../tests/observable-live-script.test.ts)
- [tests/offline-twins-provenance-fixes.test.ts](../../tests/offline-twins-provenance-fixes.test.ts)
- [tests/offline-twins-wave-c5.test.ts](../../tests/offline-twins-wave-c5.test.ts)
- [tests/openai-agent-runtime-retry.test.ts](../../tests/openai-agent-runtime-retry.test.ts)
- [tests/openai-agent-runtime-token-usage.test.ts](../../tests/openai-agent-runtime-token-usage.test.ts)
- [tests/openai-audit-client.test.ts](../../tests/openai-audit-client.test.ts)
- [tests/openai-model-defaults.test.ts](../../tests/openai-model-defaults.test.ts)
- [tests/openai-retry.test.ts](../../tests/openai-retry.test.ts)
- [tests/openai-stage-execution.test.ts](../../tests/openai-stage-execution.test.ts)
- [tests/openai-structured-schema.test.ts](../../tests/openai-structured-schema.test.ts)
- [tests/order-reference.test.ts](../../tests/order-reference.test.ts)
- [tests/otp-normalization.test.ts](../../tests/otp-normalization.test.ts)
- [tests/perf-trace.test.ts](../../tests/perf-trace.test.ts)
- [tests/phone.test.ts](../../tests/phone.test.ts)
- [tests/plan-lifecycle.test.ts](../../tests/plan-lifecycle.test.ts)
- [tests/private-audit-file.test.ts](../../tests/private-audit-file.test.ts)
- [tests/prompt-audit.test.ts](../../tests/prompt-audit.test.ts)
- [tests/prompt-branch-measurement.test.ts](../../tests/prompt-branch-measurement.test.ts)
- [tests/prompt-loader.test.ts](../../tests/prompt-loader.test.ts)
- [tests/provider-fit.test.ts](../../tests/provider-fit.test.ts)
- [tests/provider-sub-query-selection.test.ts](../../tests/provider-sub-query-selection.test.ts)
- [tests/provider-sync.test.ts](../../tests/provider-sync.test.ts)
- [tests/provider-vector-search.test.ts](../../tests/provider-vector-search.test.ts)
- [tests/purchase-disclosure-policy.test.ts](../../tests/purchase-disclosure-policy.test.ts)
- [tests/purchase-prompt-policy.test.ts](../../tests/purchase-prompt-policy.test.ts)
- [tests/request-observability.test.ts](../../tests/request-observability.test.ts)
- [tests/rsvp-deterministic-current-state.test.ts](../../tests/rsvp-deterministic-current-state.test.ts)
- [tests/rsvp-handoff-multi-person.test.ts](../../tests/rsvp-handoff-multi-person.test.ts)
- [tests/rsvp-mutation-authorization.test.ts](../../tests/rsvp-mutation-authorization.test.ts)
- [tests/rsvp-offer-fragment-only.test.ts](../../tests/rsvp-offer-fragment-only.test.ts)
- [tests/rsvp-party-precision.test.ts](../../tests/rsvp-party-precision.test.ts)
- [tests/rsvp-party.test.ts](../../tests/rsvp-party.test.ts)
- [tests/rsvp-schema.test.ts](../../tests/rsvp-schema.test.ts)
- [tests/rsvp-seeded-candidate-fallback.test.ts](../../tests/rsvp-seeded-candidate-fallback.test.ts)
- [tests/rsvp-three-state-projection.test.ts](../../tests/rsvp-three-state-projection.test.ts)
- [tests/semantic-judge.test.ts](../../tests/semantic-judge.test.ts)
- [tests/server-timestamp.test.ts](../../tests/server-timestamp.test.ts)
- [tests/sinenvolturas-gateway.test.ts](../../tests/sinenvolturas-gateway.test.ts)
- [tests/starter-provider-categories.test.ts](../../tests/starter-provider-categories.test.ts)
- [tests/static-prompt-comparison.test.ts](../../tests/static-prompt-comparison.test.ts)
- [tests/sufficiency.test.ts](../../tests/sufficiency.test.ts)
- [tests/support-continuity.test.ts](../../tests/support-continuity.test.ts)
- [tests/t6-deterministic-twins.test.ts](../../tests/t6-deterministic-twins.test.ts)
- [tests/turn-message-context.test.ts](../../tests/turn-message-context.test.ts)
- [tests/user-auth-token.test.ts](../../tests/user-auth-token.test.ts)
- [tests/vector-store-separation.test.ts](../../tests/vector-store-separation.test.ts)

## Complete prompt-file inventory

Files are listed for traceability; node/profile projection means they are not all sent on every call. Inline runtime messages and judge instructions are additional surfaces described in the report.

- [prompts/extractors/base_system.txt](../../prompts/extractors/base_system.txt)
- [prompts/extractors/capability_boundary.txt](../../prompts/extractors/capability_boundary.txt)
- [prompts/extractors/close_pause.txt](../../prompts/extractors/close_pause.txt)
- [prompts/extractors/contact.txt](../../prompts/extractors/contact.txt)
- [prompts/extractors/information.txt](../../prompts/extractors/information.txt)
- [prompts/extractors/planning.txt](../../prompts/extractors/planning.txt)
- [prompts/extractors/provider_management.txt](../../prompts/extractors/provider_management.txt)
- [prompts/extractors/rsvp.txt](../../prompts/extractors/rsvp.txt)
- [prompts/nodes/accion_final_exitosa/response_contract.txt](../../prompts/nodes/accion_final_exitosa/response_contract.txt)
- [prompts/nodes/accion_final_exitosa/system.txt](../../prompts/nodes/accion_final_exitosa/system.txt)
- [prompts/nodes/accion_final_exitosa/tool_policy.txt](../../prompts/nodes/accion_final_exitosa/tool_policy.txt)
- [prompts/nodes/aclarar_pedir_faltante/response_contract.txt](../../prompts/nodes/aclarar_pedir_faltante/response_contract.txt)
- [prompts/nodes/aclarar_pedir_faltante/system.txt](../../prompts/nodes/aclarar_pedir_faltante/system.txt)
- [prompts/nodes/aclarar_pedir_faltante/tool_policy.txt](../../prompts/nodes/aclarar_pedir_faltante/tool_policy.txt)
- [prompts/nodes/anadir_a_proveedores_recomendados/response_contract.txt](../../prompts/nodes/anadir_a_proveedores_recomendados/response_contract.txt)
- [prompts/nodes/anadir_a_proveedores_recomendados/system.txt](../../prompts/nodes/anadir_a_proveedores_recomendados/system.txt)
- [prompts/nodes/anadir_a_proveedores_recomendados/tool_policy.txt](../../prompts/nodes/anadir_a_proveedores_recomendados/tool_policy.txt)
- [prompts/nodes/buscar_proveedores/response_contract.txt](../../prompts/nodes/buscar_proveedores/response_contract.txt)
- [prompts/nodes/buscar_proveedores/system.txt](../../prompts/nodes/buscar_proveedores/system.txt)
- [prompts/nodes/buscar_proveedores/tool_policy.txt](../../prompts/nodes/buscar_proveedores/tool_policy.txt)
- [prompts/nodes/busqueda_exitosa/response_contract.txt](../../prompts/nodes/busqueda_exitosa/response_contract.txt)
- [prompts/nodes/busqueda_exitosa/system.txt](../../prompts/nodes/busqueda_exitosa/system.txt)
- [prompts/nodes/busqueda_exitosa/tool_policy.txt](../../prompts/nodes/busqueda_exitosa/tool_policy.txt)
- [prompts/nodes/contacto_inicial/response_contract.txt](../../prompts/nodes/contacto_inicial/response_contract.txt)
- [prompts/nodes/contacto_inicial/system.txt](../../prompts/nodes/contacto_inicial/system.txt)
- [prompts/nodes/contacto_inicial/tool_policy.txt](../../prompts/nodes/contacto_inicial/tool_policy.txt)
- [prompts/nodes/continua/response_contract.txt](../../prompts/nodes/continua/response_contract.txt)
- [prompts/nodes/continua/system.txt](../../prompts/nodes/continua/system.txt)
- [prompts/nodes/continua/tool_policy.txt](../../prompts/nodes/continua/tool_policy.txt)
- [prompts/nodes/crear_lead_cerrar/response_contract.txt](../../prompts/nodes/crear_lead_cerrar/response_contract.txt)
- [prompts/nodes/crear_lead_cerrar/system.txt](../../prompts/nodes/crear_lead_cerrar/system.txt)
- [prompts/nodes/crear_lead_cerrar/tool_policy.txt](../../prompts/nodes/crear_lead_cerrar/tool_policy.txt)
- [prompts/nodes/deteccion_intencion/response_classifier.txt](../../prompts/nodes/deteccion_intencion/response_classifier.txt)
- [prompts/nodes/deteccion_intencion/response_classifier_campaign.txt](../../prompts/nodes/deteccion_intencion/response_classifier_campaign.txt)
- [prompts/nodes/deteccion_intencion/response_contract.txt](../../prompts/nodes/deteccion_intencion/response_contract.txt)
- [prompts/nodes/deteccion_intencion/system.txt](../../prompts/nodes/deteccion_intencion/system.txt)
- [prompts/nodes/deteccion_intencion/tool_policy.txt](../../prompts/nodes/deteccion_intencion/tool_policy.txt)
- [prompts/nodes/elicitacion_necesidades/response_contract.txt](../../prompts/nodes/elicitacion_necesidades/response_contract.txt)
- [prompts/nodes/elicitacion_necesidades/system.txt](../../prompts/nodes/elicitacion_necesidades/system.txt)
- [prompts/nodes/elicitacion_necesidades/tool_policy.txt](../../prompts/nodes/elicitacion_necesidades/tool_policy.txt)
- [prompts/nodes/entrevista/response_contract.txt](../../prompts/nodes/entrevista/response_contract.txt)
- [prompts/nodes/entrevista/system.txt](../../prompts/nodes/entrevista/system.txt)
- [prompts/nodes/entrevista/tool_policy.txt](../../prompts/nodes/entrevista/tool_policy.txt)
- [prompts/nodes/existe_plan_guardado/response_contract.txt](../../prompts/nodes/existe_plan_guardado/response_contract.txt)
- [prompts/nodes/existe_plan_guardado/system.txt](../../prompts/nodes/existe_plan_guardado/system.txt)
- [prompts/nodes/existe_plan_guardado/tool_policy.txt](../../prompts/nodes/existe_plan_guardado/tool_policy.txt)
- [prompts/nodes/guardar_cerrar_temporalmente/response_contract.txt](../../prompts/nodes/guardar_cerrar_temporalmente/response_contract.txt)
- [prompts/nodes/guardar_cerrar_temporalmente/system.txt](../../prompts/nodes/guardar_cerrar_temporalmente/system.txt)
- [prompts/nodes/guardar_cerrar_temporalmente/tool_policy.txt](../../prompts/nodes/guardar_cerrar_temporalmente/tool_policy.txt)
- [prompts/nodes/guardar_seleccion_reintentar_luego/response_contract.txt](../../prompts/nodes/guardar_seleccion_reintentar_luego/response_contract.txt)
- [prompts/nodes/guardar_seleccion_reintentar_luego/system.txt](../../prompts/nodes/guardar_seleccion_reintentar_luego/system.txt)
- [prompts/nodes/guardar_seleccion_reintentar_luego/tool_policy.txt](../../prompts/nodes/guardar_seleccion_reintentar_luego/tool_policy.txt)
- [prompts/nodes/hay_resultados/response_contract.txt](../../prompts/nodes/hay_resultados/response_contract.txt)
- [prompts/nodes/hay_resultados/system.txt](../../prompts/nodes/hay_resultados/system.txt)
- [prompts/nodes/hay_resultados/tool_policy.txt](../../prompts/nodes/hay_resultados/tool_policy.txt)
- [prompts/nodes/informar_error_reintento/response_contract.txt](../../prompts/nodes/informar_error_reintento/response_contract.txt)
- [prompts/nodes/informar_error_reintento/system.txt](../../prompts/nodes/informar_error_reintento/system.txt)
- [prompts/nodes/informar_error_reintento/tool_policy.txt](../../prompts/nodes/informar_error_reintento/tool_policy.txt)
- [prompts/nodes/minimos_para_buscar/response_contract.txt](../../prompts/nodes/minimos_para_buscar/response_contract.txt)
- [prompts/nodes/minimos_para_buscar/system.txt](../../prompts/nodes/minimos_para_buscar/system.txt)
- [prompts/nodes/minimos_para_buscar/tool_policy.txt](../../prompts/nodes/minimos_para_buscar/tool_policy.txt)
- [prompts/nodes/necesidad_cubierta/response_contract.txt](../../prompts/nodes/necesidad_cubierta/response_contract.txt)
- [prompts/nodes/necesidad_cubierta/system.txt](../../prompts/nodes/necesidad_cubierta/system.txt)
- [prompts/nodes/necesidad_cubierta/tool_policy.txt](../../prompts/nodes/necesidad_cubierta/tool_policy.txt)
- [prompts/nodes/ofrecer_agente_humano/response_contract.txt](../../prompts/nodes/ofrecer_agente_humano/response_contract.txt)
- [prompts/nodes/ofrecer_agente_humano/system.txt](../../prompts/nodes/ofrecer_agente_humano/system.txt)
- [prompts/nodes/ofrecer_agente_humano/tool_policy.txt](../../prompts/nodes/ofrecer_agente_humano/tool_policy.txt)
- [prompts/nodes/recomendar/response_contract.txt](../../prompts/nodes/recomendar/response_contract.txt)
- [prompts/nodes/recomendar/system.txt](../../prompts/nodes/recomendar/system.txt)
- [prompts/nodes/recomendar/tool_policy.txt](../../prompts/nodes/recomendar/tool_policy.txt)
- [prompts/nodes/refinar_criterios/response_contract.txt](../../prompts/nodes/refinar_criterios/response_contract.txt)
- [prompts/nodes/refinar_criterios/system.txt](../../prompts/nodes/refinar_criterios/system.txt)
- [prompts/nodes/refinar_criterios/tool_policy.txt](../../prompts/nodes/refinar_criterios/tool_policy.txt)
- [prompts/nodes/reintentar/response_contract.txt](../../prompts/nodes/reintentar/response_contract.txt)
- [prompts/nodes/reintentar/system.txt](../../prompts/nodes/reintentar/system.txt)
- [prompts/nodes/reintentar/tool_policy.txt](../../prompts/nodes/reintentar/tool_policy.txt)
- [prompts/nodes/reset_plan/response_contract.txt](../../prompts/nodes/reset_plan/response_contract.txt)
- [prompts/nodes/reset_plan/system.txt](../../prompts/nodes/reset_plan/system.txt)
- [prompts/nodes/reset_plan/tool_policy.txt](../../prompts/nodes/reset_plan/tool_policy.txt)
- [prompts/nodes/resolver_consultas_informativas/capability_boundary.txt](../../prompts/nodes/resolver_consultas_informativas/capability_boundary.txt)
- [prompts/nodes/resolver_consultas_informativas/host-withdrawal.json](../../prompts/nodes/resolver_consultas_informativas/host-withdrawal.json)
- [prompts/nodes/resolver_consultas_informativas/response_contract.txt](../../prompts/nodes/resolver_consultas_informativas/response_contract.txt)
- [prompts/nodes/resolver_consultas_informativas/system.txt](../../prompts/nodes/resolver_consultas_informativas/system.txt)
- [prompts/nodes/resolver_consultas_informativas/tool_policy.txt](../../prompts/nodes/resolver_consultas_informativas/tool_policy.txt)
- [prompts/nodes/responder_invitacion/response_contract.txt](../../prompts/nodes/responder_invitacion/response_contract.txt)
- [prompts/nodes/responder_invitacion/system.txt](../../prompts/nodes/responder_invitacion/system.txt)
- [prompts/nodes/responder_invitacion/tool_policy.txt](../../prompts/nodes/responder_invitacion/tool_policy.txt)
- [prompts/nodes/seguir_refinando_guardar_plan/response_contract.txt](../../prompts/nodes/seguir_refinando_guardar_plan/response_contract.txt)
- [prompts/nodes/seguir_refinando_guardar_plan/system.txt](../../prompts/nodes/seguir_refinando_guardar_plan/system.txt)
- [prompts/nodes/seguir_refinando_guardar_plan/tool_policy.txt](../../prompts/nodes/seguir_refinando_guardar_plan/tool_policy.txt)
- [prompts/nodes/solicitar_agente_humano/response_contract.txt](../../prompts/nodes/solicitar_agente_humano/response_contract.txt)
- [prompts/nodes/solicitar_agente_humano/system.txt](../../prompts/nodes/solicitar_agente_humano/system.txt)
- [prompts/nodes/solicitar_agente_humano/tool_policy.txt](../../prompts/nodes/solicitar_agente_humano/tool_policy.txt)
- [prompts/nodes/usuario_elige_proveedor/response_contract.txt](../../prompts/nodes/usuario_elige_proveedor/response_contract.txt)
- [prompts/nodes/usuario_elige_proveedor/system.txt](../../prompts/nodes/usuario_elige_proveedor/system.txt)
- [prompts/nodes/usuario_elige_proveedor/tool_policy.txt](../../prompts/nodes/usuario_elige_proveedor/tool_policy.txt)
- [prompts/nodes/usuario_responde/response_contract.txt](../../prompts/nodes/usuario_responde/response_contract.txt)
- [prompts/nodes/usuario_responde/system.txt](../../prompts/nodes/usuario_responde/system.txt)
- [prompts/nodes/usuario_responde/tool_policy.txt](../../prompts/nodes/usuario_responde/tool_policy.txt)
- [prompts/shared/agent_personality.txt](../../prompts/shared/agent_personality.txt)
- [prompts/shared/base_system.txt](../../prompts/shared/base_system.txt)
- [prompts/shared/common_anti_patterns.txt](../../prompts/shared/common_anti_patterns.txt)
- [prompts/shared/domain_knowledge.txt](../../prompts/shared/domain_knowledge.txt)
- [prompts/shared/domain_scope.txt](../../prompts/shared/domain_scope.txt)
- [prompts/shared/flow_discipline.txt](../../prompts/shared/flow_discipline.txt)
- [prompts/shared/output_style.txt](../../prompts/shared/output_style.txt)
- [prompts/shared/question_strategy.txt](../../prompts/shared/question_strategy.txt)

## Reproduction and checks

- Load `new EvalLoader("evals").loadCatalog()` using the repository TypeScript runtime to reproduce the hydrated case inventory.
- Run `npx vitest run tests/live-behavior-coverage.test.ts` to validate registered mandatory structural/semantic coverage.
- Inspect `source-snapshot.json` in this directory for source SHA-256 fingerprints and package versions.
- Do not run deployment or live evaluations merely to read this dossier. Future execution must follow repository development-environment and write-isolation conventions.
- Historical study manifests and baselines describe their recorded versions. Check raw artifacts and configuration before using any number in a paper.
