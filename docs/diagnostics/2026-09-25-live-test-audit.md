# Live-behavior test audit — 2026-09-25

## Scope and decision

All 139 suite entries were reconciled to exactly one YAML case and to the stored result from `eval-2026-09-25T05-52-16-616Z-cc7cd3e6`. This is a **read-only adjudication of existing live evidence** plus eighteen targeted oracle corrections; no new live run, model call, deployment, or promotion occurred. The audit follows the observable-contract and safe-deletion method of the [OpenClaw test-audit skill](https://github.com/openclaw/openclaw/blob/main/.agents/skills/test-audit/SKILL.md); its repo-specific commands are inapplicable here.

The raw 56/82/1 score is not a release-quality measure. It combines real factual failures, architecture-incompatible tool pins, transient infrastructure, internal-node pins, and semantic rubrics that demand phrasing or unsolicited details. The suite must be split into a small release blocker panel and diagnostic coverage. A passing diagnostic case does not establish production usability; a failing wording case does not by itself block promotion.

## What the run proves

- The manifest binds the same deployed artifact before and after the run, so this is a coherent candidate observation. The run used gpt-6-luna for the app and gpt-5.6-luna for judges. It cost $0.424729. No price or timing assertion changes the behavioral verdict.
- 56 passed, 82 failed, and one errored before a turn. Among failures, 45 had only semantic expectation failures, 23 had both semantic and structural failures, and 14 had structural failures only. Therefore “failures spread thin” is false as a diagnosis; the semantic oracle is the largest common failure surface.
- All 139 cases are fixture-backed. Eighty-eight are one-turn; only 48 are tagged `reported-interaction`. The suite overrepresents isolated, prearranged facts compared with real multi-message support.
- Several cases assert `current_node`, tool names, or old evidence paths rather than customer-visible facts. The six gift/order prohibitions corrected in this change contradicted the authorized all-roots customer-profile design. Trace-field pins that require `information_execution_summary.evidence` can fail even when the canonical profile contains the same facts.
- The single error is `token_seeded_contact_correction`, a zero-turn fixture/phone infrastructure failure. It is neither a pass nor evidence of model behavior.

## Product failures that are not oracle noise

1. **Payment destination:** `payment_destination_requires_pending_purchase` delivered Yape/Plin, bank-account and CCI details before identifying a pending purchase. The saved turn shows the KB-backed reply. Keep this blocker if destinations must be scoped to an actual pending purchase.
2. **RSVP identity:** `rsvp_host_set_declining_consistent` called the identified declined invitation unanswered and attributed another guest’s acceptance to this user. It did not call `lookup_rsvp_invitations`. This is an identity/fact error, not a wording miss.
3. **Bare transaction reference:** the three `customer_transaction_*` cases routed an order reference into planning, made no purchase read, and asked what the code meant. This is a common low-input customer-support path worth fixing.
4. **Host withdrawal:** `host_withdrawal_diana_policy_and_support` stayed in the wrong purchase context, discussed failed order/gift reads, and made zero requested handoff writes. The later event name did not repair it.
5. **Unavailable image:** `image_url_unavailable_evidence` requested a resend and claimed no purchases without a completed purchase read. Related unavailable-image cases also request media again. This contradicts the user’s recovery policy.
6. **Combined RSVP reply:** two plus-one cases executed the RSVP write and fresh read but told the customer the companion could not be verified. Inspect the verified receipt and post-write guest fields; if saved, the reply is false uncertainty. Keep the structural write check.
7. **Unknown gift type:** `gift_unknown_type_preserves_uncertainty` correctly withheld a shipping date but called an unknown-type record a gift voucher. The oracle also demanded an optional human offer; the unsupported voucher claim is the real defect.

The run also exposed unsupported cart totals, a digital gift described as shippable, a false global inability to read images after OTP, and invented provider prices. These are observed answer defects even where planning is temporarily lower priority. One purchase-continuity judge claimed the recorded 21:31 was unavailable, but `evals/fixtures/purchase-claudia-085.json` contains `payment.paid_at: 2026-08-30 21:31:00`; that is a judge-evidence defect, not a model time hallucination. Conversely, the terminal OTP cases include a real unsupported “handoff was not managed” claim or an unwanted invitation to retry verification.

## Oracle repairs and retirement decisions

- **Done:** removed six `lookup_guest_orders_by_phone` bans from gift/support tests, retaining the auth, OTP, RSVP, and handoff-effect boundaries. Reading another authorized customer root is compatible with the profile contract. This can remove a structural false failure; it does not make accompanying semantic failures pass.
- **Repair before gating:** replace `trace_field_subset` pins on an obsolete information-summary path with a check against the serialized model input/profile plus a grounded delivered answer. Do not delete factual coverage just because storage moved.
- **Repair before gating:** replace internal node-transition pins with observable authorization, read, effect, and response checks. Do not waive a real missing read or wrong answer in a case that also has a node failure.
- **Redesign:** the receipt-only cases presently demand immediate reconciliation and a reply even with no active task, while the current image-only policy suppresses such a turn. Convert them to silence/persistence plus a later text follow-up, or remove their immediate-answer expectation from the release panel. Keep receipt/image safety, amount matching, ambiguous-order and no-false-approval checks.
- **Done for twelve clear examples:** relaxed semantic requirements for truthful support recap, RSVP thanks, repeated correct event details, visually reasonable dice colors, reminder paraphrases, purchase time, scoped no-match, identity rejection, verified human-review effect, image-not-yet-arrived continuity, credit-gift causality, and optional human-support offers. Authorization, effect, and factual prohibitions remain.
- **Relax wording only elsewhere:** a correct answer must not fail solely for an extra event date, a second empathy sentence, or declining to repeat policy or an already-given card answer. Keep factual distinctions, successful effect receipts, and no invented statuses. `support_detail_continuity` failed because it repeated true card guidance while preserving Roger Abanto and Baby Shower Catalina; that is quality feedback, not a broken interaction.
- **Do not delete safety cases:** payment destination, RSVP guest identity, false mutation receipts, OTP effect, unauthorized access, double writes, blank deliveries and fabricated payment approval remain hard blockers.
- **Planning:** keep five identified planning failures in diagnostic coverage while prioritizing support. `s4-injected-renderer-prose-fails` may be a bad oracle: the saved answer noticed a catering-card/provider-ID mismatch; inspect the fixture identity before ever demanding confirmation.

## Promotion judgment

Do not equate 82 red cases with 82 product failures. Equally, the stable run contains multiple direct support and identity failures that make unconditional promotion unjustified. If time forces release, first fix and verify the narrow factual blocker panel above on the exact release artifact, then use a guarded rollout/rollback decision. The old 139-case aggregate should not be used as the pass threshold. No full live rerun is authorized by this audit.

## Replacement release-risk panel (selected cases only; not run here)

The old aggregate should stay diagnostic. For the next *explicitly authorized* paid check, select these existing support cases individually with `--case` and inspect their actual responses and effect receipts. This panel targets real adversarial paths instead of a generic happy path:

| Case ID | Non-negotiable observation |
|---|---|
| `live_behavior.payment_destination_requires_pending_purchase` | No destination disclosed without a verified pending purchase. |
| `live_behavior.rsvp_host_set_declining_consistent` | Correct guest and declined/attending state are not merged. |
| `live_behavior.customer_transaction_reference_matched` | Bare reference resolves the authorized order without planning detour. |
| `live_behavior.customer_transaction_reference_unavailable_multiple` | Unknown reference does not bind to a convenient order. |
| `live_behavior.host_withdrawal_diana_policy_and_support` | Host withdrawal is answered from its actual source and handoff effect. |
| `live_behavior.image_url_unavailable_evidence` | Unavailable image yields a truthful answer without resend or fabricated purchase absence. |
| `live_behavior.receipt_with_text_together` | Receipt is contextualized against pending backend state without reciting irrelevant operation fields. |
| `live_behavior.nonphysical_purchase_omits_shipping` | Digital/credit gift does not acquire a shipment. |
| `live_behavior.rsvp_plus_one_uses_phone_scoped_mutation` | One write, fresh read, and reply agree on companion state. |
| `live_behavior.otp_sent_explains_image_limitation` | Code is sent and no false universal image incapability is claimed. |
| `live_behavior.concurrent_support_turns_preserve_context` | Overlap retains the card issue and makes no invented review claim. |
| `live_behavior.gift_unknown_type_preserves_uncertainty` | Unknown fulfillment type is not renamed as a voucher or shipment. |

The panel itself still needs oracle repair where identified above. It is a review aid, not an automatic green gate or permission to ship. Do not spend on it or broaden it without a new instruction.

## Complete 139-case disposition ledger

“Keep” means the case is provisionally useful, not that its fixture represents live traffic. “Repair” means its oracle or fixture must change before it can gate. “Fix product” names an observed wrong answer or effect. “Adjudicate” means this run alone does not support deletion or waiver. Each row links to its YAML and stored result under the run ID above.

| Case | Run | Turns | Failed assertions | Disposition |
|---|---:|---:|---|---|
| [`faq_from_recommendation_node`](../../evals/cases/live-faq-from-recommendation.yaml) | passed | 1 | — | Keep; sample pass only |
| [`abandoned_cart_only_sonia`](../../evals/cases/live-behavior-abandoned-cart-sonia.yaml) | failed | 1 | text_semantic | Fix product; keep hard fact/effect check |
| [`accountless_event_answer_precedes_remaining_private_auth`](../../evals/cases/live-behavior-accountless-event-before-private-auth.yaml) | passed | 1 | — | Keep; sample pass only |
| [`accountless_guest_event_uses_phone_without_otp`](../../evals/cases/live-behavior-accountless-guest-event.yaml) | passed | 1 | — | Keep; sample pass only |
| [`active_cart_checkout_continuity_alex`](../../evals/cases/live-behavior-active-cart-checkout-alex.yaml) | failed | 2 | text_semantic | Fix product; keep hard fact/effect check |
| [`ambiguous_confirmation_adversarial_selection`](../../evals/cases/live-behavior-ambiguous-confirmation-adversarial.yaml) | failed | 1 | text_semantic | Fix product; keep hard fact/effect check |
| [`ambiguous_confirmation_clarifies`](../../evals/cases/live-behavior-ambiguous-confirmation.yaml) | passed | 1 | — | Keep; sample pass only |
| [`authentication_refusal_closes_protected_query`](../../evals/cases/live-behavior-auth-refusal-closes-query.yaml) | passed | 1 | — | Keep; sample pass only |
| [`campaign_scope_carryover_override_handoff`](../../evals/cases/live-behavior-campaign-scope-carryover.yaml) | failed | 3 | text_semantic, trace_field_subset | Repair obsolete evidence-path assertion; retain facts |
| [`close_date_provenance_and_completed_retry`](../../evals/cases/live-close-date-provenance-completed-retry.yaml) | passed | 6 | — | Keep; sample pass only |
| [`concurrent_support_turns_preserve_context`](../../evals/cases/live-behavior-concurrent-support-turns.yaml) | failed | 2 | text_semantic | Fix product; keep hard fact/effect check |
| [`continuity_question_needs_image`](../../evals/cases/live-behavior-continuity-question-needs-image.yaml) | failed | 2 | text_semantic | Repair wording/internal-state oracle |
| [`continuity_text_image_same_turn`](../../evals/cases/live-behavior-continuity-text-image-same-turn.yaml) | passed | 1 | — | Keep; sample pass only |
| [`continuity_voucher_then_thanks`](../../evals/cases/live-behavior-continuity-voucher-then-thanks.yaml) | passed | 2 | — | Keep; sample pass only |
| [`current_campaign_order_over_historical_declined_maria_jose`](../../evals/cases/live-behavior-current-campaign-order-maria-jose.yaml) | failed | 2 | text_semantic | Repair timing-completeness oracle; pending fact correct |
| [`customer_event_task_continuity`](../../evals/cases/live-behavior-customer-event-task-continuity.yaml) | passed | 4 | — | Keep; sample pass only |
| [`customer_transaction_code_by_phone`](../../evals/cases/live-behavior-customer-transaction-code-by-phone.yaml) | failed | 1 | node_transition, text_semantic, tool_usage | Fix product; keep hard fact/effect check |
| [`customer_transaction_reference_matched`](../../evals/cases/live-behavior-customer-transaction-reference-matched.yaml) | failed | 1 | node_transition, text_semantic, tool_usage | Fix product; keep hard fact/effect check |
| [`customer_transaction_reference_unavailable_multiple`](../../evals/cases/live-behavior-customer-transaction-reference-unavailable-multiple.yaml) | failed | 1 | node_transition, text_semantic, tool_usage | Fix product; keep hard fact/effect check |
| [`event_context_long_thread`](../../evals/cases/live-behavior-event-context-long-thread.yaml) | passed | 4 | — | Keep; sample pass only |
| [`faq_commission_full_article_citation`](../../evals/cases/live-behavior-faq-commission-full-article.yaml) | passed | 1 | — | Keep; sample pass only |
| [`gift_credit_pending_payment_stays_pending`](../../evals/cases/live-behavior-gift-credit-pending.yaml) | failed | 1 | tool_usage | Oracle tool ban repaired; no semantic failure |
| [`gift_credit_states_host_choice_no_shipment`](../../evals/cases/live-behavior-gift-credit-approved.yaml) | failed | 1 | text_semantic, tool_usage | Oracle tool ban and extra host-choice wording repaired |
| [`gift_credit_with_physical_card_distinguishes`](../../evals/cases/live-behavior-gift-credit-card.yaml) | passed | 1 | — | Keep; sample pass only |
| [`gift_mixed_order_distinguishes_items`](../../evals/cases/live-behavior-gift-mixed-order.yaml) | failed | 3 | text_semantic, trace_field_subset | Repair obsolete evidence-path assertion; retain facts |
| [`gift_sestore_shipped_answers_data`](../../evals/cases/live-behavior-gift-sestore-shipped.yaml) | failed | 1 | tool_usage | Oracle tool ban repaired; no semantic failure |
| [`gift_sestore_unknown_shipping_offers_support`](../../evals/cases/live-behavior-gift-sestore-unknown-shipping.yaml) | failed | 1 | text_semantic, tool_usage | Oracle tool ban and unsolicited offer repaired |
| [`gift_shipping_limitation_accepted_handoff_once`](../../evals/cases/live-behavior-gift-shipping-handoff.yaml) | failed | 3 | text_semantic | Repair wording/internal-state oracle |
| [`gift_unknown_type_preserves_uncertainty`](../../evals/cases/live-behavior-gift-unknown-type.yaml) | failed | 1 | text_semantic, tool_usage | Fix product; obsolete tool ban removed |
| [`host_support_allows_explicit_rsvp_switch`](../../evals/cases/live-behavior-host-support-explicit-rsvp-switch.yaml) | failed | 1 | node_transition, tool_usage | Repair internal-node and irrelevant KB-call pins; answer grounded |
| [`host_withdrawal_diana_policy_and_support`](../../evals/cases/live-behavior-host-withdrawal-diana.yaml) | failed | 3 | fixture_effect_count, plan_field_equals, plan_field_subset, text_semantic, tool_usage | Fix product; keep hard fact/effect check |
| [`host_withdrawal_general_policy_only`](../../evals/cases/live-behavior-host-withdrawal-general.yaml) | passed | 1 | — | Keep; sample pass only |
| [`host_withdrawal_pending_event_followup`](../../evals/cases/live-behavior-host-withdrawal-event-followup.yaml) | passed | 1 | — | Keep; sample pass only |
| [`image_captioned_preserved`](../../evals/cases/live-behavior-image-captioned.yaml) | passed | 1 | — | Keep; sample pass only |
| [`image_conversation_continuity`](../../evals/cases/live-behavior-image-conversation-continuity.yaml) | passed | 2 | — | Keep; sample pass only |
| [`image_conversation_repeat_answered`](../../evals/cases/live-behavior-image-conversation-repeat-answered.yaml) | failed | 2 | text_semantic | Repair wording/internal-state oracle |
| [`image_distractor_history_preserves_current_question`](../../evals/cases/live-behavior-image-distractor-history-preserves-current-question.yaml) | failed | 2 | text_semantic | Redesign image-only sequence oracle |
| [`image_expired_reference_resubmit`](../../evals/cases/live-behavior-image-expired-reference.yaml) | failed | 1 | text_semantic | Fix product; keep hard fact/effect check |
| [`image_file_captioned_persisted`](../../evals/cases/live-behavior-image-file-captioned.yaml) | passed | 1 | — | Keep; sample pass only |
| [`image_file_delayed_question`](../../evals/cases/live-behavior-image-file-delayed-question.yaml) | passed | 2 | — | Keep; sample pass only |
| [`image_file_explicit_describe`](../../evals/cases/live-behavior-image-file-explicit-describe.yaml) | passed | 1 | — | Keep; sample pass only |
| [`image_file_malformed_unavailable`](../../evals/cases/live-behavior-image-file-malformed.yaml) | failed | 1 | text_semantic | Fix product; keep hard fact/effect check |
| [`image_file_unrelated_omits_pixels`](../../evals/cases/live-behavior-image-file-unrelated.yaml) | passed | 2 | — | Keep; sample pass only |
| [`image_multiple_pending_orders_no_select`](../../evals/cases/live-behavior-image-multiple-pending-orders.yaml) | passed | 1 | — | Keep; sample pass only |
| [`image_non_receipt_payment_claim`](../../evals/cases/live-behavior-image-non-receipt-payment-claim.yaml) | failed | 1 | text_semantic | Fix product; keep hard fact/effect check |
| [`image_readable_captionless`](../../evals/cases/live-behavior-image-readable-captionless.yaml) | failed | 2 | text_semantic, tool_usage | Redesign image-only sequence oracle |
| [`image_receipt_ambiguous_digits`](../../evals/cases/live-behavior-image-receipt-ambiguous-digits.yaml) | passed | 1 | — | Keep; sample pass only |
| [`image_receipt_illegible_amount`](../../evals/cases/live-behavior-image-receipt-illegible-amount.yaml) | failed | 1 | text_semantic | Fix product; keep hard fact/effect check |
| [`image_too_large_fallback`](../../evals/cases/live-behavior-image-too-large.yaml) | failed | 1 | text_semantic | Fix product; keep hard fact/effect check |
| [`image_unavailable_captioned`](../../evals/cases/live-behavior-image-unavailable-captioned.yaml) | passed | 1 | — | Keep; sample pass only |
| [`image_url_describe_dice`](../../evals/cases/live-behavior-image-url-describe.yaml) | failed | 1 | text_semantic | Repair wording/internal-state oracle |
| [`image_url_receipt_payment_thread`](../../evals/cases/live-behavior-image-url-receipt-payment.yaml) | failed | 3 | text_semantic | Fix product; keep hard fact/effect check |
| [`image_url_unavailable_evidence`](../../evals/cases/live-behavior-image-url-unavailable.yaml) | failed | 1 | text_semantic | Fix product; keep hard fact/effect check |
| [`jose_campaign_greeting_then_acknowledgement`](../../evals/cases/live-behavior-jose-campaign-acknowledgement.yaml) | passed | 2 | — | Keep; sample pass only |
| [`mailbox_issue_deferral_and_clarification_preserve_support`](../../evals/cases/live-behavior-mailbox-continuity-maria-isabel.yaml) | passed | 4 | — | Keep; sample pass only |
| [`maria_paz_current_reminder_explanation`](../../evals/cases/live-behavior-maria-paz-reminder-explanation.yaml) | failed | 2 | text_semantic | Repair wording/internal-state oracle |
| [`native_image_long_thread`](../../evals/cases/live-behavior-native-image-long-thread.yaml) | passed | 6 | — | Keep; sample pass only |
| [`nonphysical_purchase_omits_shipping`](../../evals/cases/live-behavior-nonphysical-purchase-omits-shipping.yaml) | failed | 1 | text_semantic | Fix product; keep hard fact/effect check |
| [`otp_nondelivery_auto_resends_once`](../../evals/cases/live-behavior-otp-auto-resend-once.yaml) | failed | 1 | plan_field_subset | Repair plan-field pin; verify pending query in follow-up |
| [`otp_not_received_requires_response`](../../evals/cases/live-behavior-otp-not-received.yaml) | passed | 1 | — | Keep; sample pass only |
| [`otp_number_words_are_verified`](../../evals/cases/live-behavior-otp-number-words.yaml) | passed | 1 | — | Keep; sample pass only |
| [`otp_sent_explains_image_limitation`](../../evals/cases/live-behavior-otp-sent-image-guidance.yaml) | failed | 1 | text_semantic | Fix product; keep hard fact/effect check |
| [`otp_terminal_handoff_failed`](../../evals/cases/live-behavior-otp-terminal-handoff-failed.yaml) | passed | 3 | — | Keep; sample pass only |
| [`otp_terminal_handoff_unavailable`](../../evals/cases/live-behavior-otp-terminal-handoff-unavailable.yaml) | failed | 2 | text_semantic | Fix product; terminal reply still invites retry |
| [`otp_terminal_handoff_unknown`](../../evals/cases/live-behavior-otp-terminal-handoff-unknown.yaml) | failed | 3 | text_semantic | Fix product; unknown handoff called not managed |
| [`otp_terminal_missing_trusted_phone`](../../evals/cases/live-behavior-otp-terminal-missing-trusted-phone.yaml) | passed | 2 | — | Keep; sample pass only |
| [`owner_customer_payment_relevance`](../../evals/cases/live-behavior-owner-customer-payment-relevance.yaml) | failed | 2 | text_semantic | Fix product; keep hard fact/effect check |
| [`owner_planning_to_faq_single_transfer`](../../evals/cases/live-behavior-owner-planning-to-faq-transfer.yaml) | failed | 3 | text_semantic | Fix product; keep hard fact/effect check |
| [`payment_destination_requires_pending_purchase`](../../evals/cases/live-behavior-payment-destination-requires-pending.yaml) | failed | 1 | text_semantic | Fix product; keep hard fact/effect check |
| [`pending_balance_validation_luis`](../../evals/cases/live-behavior-pending-balance-luis.yaml) | failed | 2 | text_semantic | Fix product; keep hard fact/effect check |
| [`phone_account_rejection_requests_email`](../../evals/cases/live-behavior-phone-account-rejected.yaml) | failed | 1 | text_semantic | Repair wording/internal-state oracle |
| [`phone_confirmation_unclear_requires_yes_or_no`](../../evals/cases/live-behavior-phone-confirmation-unclear.yaml) | failed | 1 | text_semantic, tool_usage | Fix product; avoid repeat question and unsupported event names |
| [`phone_purchase_missing_hands_off_once`](../../evals/cases/live-behavior-phone-missing-information.yaml) | failed | 2 | text_semantic, tool_usage, trace_field_subset | Fix product; same-phone retry and missed help; oracle paths repaired |
| [`provider_reference_cheaper_option`](../../evals/cases/live-behavior-provider-reference-cheaper.yaml) | failed | 1 | text_semantic | Planning diagnostic; inspect fixture before gating |
| [`provider_reference_miraflores_option`](../../evals/cases/live-behavior-provider-reference-miraflores.yaml) | passed | 1 | — | Keep; sample pass only |
| [`purchase_confirmation_carina_request_survives_normalization`](../../evals/cases/live-behavior-purchase-confirmation-carina.yaml) | failed | 3 | text_semantic, tool_usage, trace_field_equals | Fix product; currency and document/status request conflated |
| [`purchase_currency_pen_symbol`](../../evals/cases/live-behavior-purchase-currency-pen.yaml) | passed | 1 | — | Keep; sample pass only |
| [`purchase_current_pending_over_old_approved`](../../evals/cases/live-behavior-purchase-current-vs-old.yaml) | failed | 1 | trace_field_subset | Repair obsolete evidence-path assertion; retain facts |
| [`purchase_delia_status_by_phone`](../../evals/cases/live-behavior-purchase-delia-phone-orders.yaml) | failed | 1 | trace_field_subset | Repair obsolete evidence-path assertion; retain facts |
| [`purchase_explicit_time_alternatives`](../../evals/cases/live-behavior-purchase-explicit-time.yaml) | failed | 1 | text_semantic | Repair wording/internal-state oracle |
| [`purchase_joaquin_dedication_selection`](../../evals/cases/live-behavior-purchase-joaquin-dedication.yaml) | failed | 1 | node_transition, tool_usage | Repair node/tool pin; answer gives two-record selection |
| [`purchase_kiara_pending_by_phone`](../../evals/cases/live-behavior-purchase-kiara-phone-orders.yaml) | failed | 1 | trace_field_subset | Repair obsolete evidence-path assertion; retain facts |
| [`purchase_martha_accountless_selection`](../../evals/cases/live-behavior-purchase-martha-accountless.yaml) | failed | 1 | text_semantic, trace_field_subset | Repair obsolete evidence-path assertion; retain facts |
| [`purchase_pending_transfer_continuity`](../../evals/cases/live-behavior-purchase-pending-transfer-continuity.yaml) | failed | 3 | text_semantic | Repair judge evidence; fixture contains paid_at 21:31 |
| [`receipt_alone_then_followup_text`](../../evals/cases/live-behavior-receipt-alone-then-followup.yaml) | failed | 2 | text_semantic, tool_usage | Redesign image-only sequence oracle |
| [`receipt_approved_no_pending_story`](../../evals/cases/live-behavior-receipt-approved-state.yaml) | failed | 1 | text_semantic, tool_usage | Redesign image-only sequence oracle |
| [`receipt_dual_same_amount_asks`](../../evals/cases/live-behavior-receipt-dual-same-amount.yaml) | failed | 1 | text_semantic, tool_usage | Redesign image-only sequence oracle |
| [`receipt_explicit_older_target_wins`](../../evals/cases/live-behavior-receipt-explicit-older-target.yaml) | failed | 2 | text_semantic, trace_field_subset | Repair obsolete evidence-path assertion; retain facts |
| [`receipt_gift_only_match`](../../evals/cases/live-behavior-receipt-gift-only-match.yaml) | failed | 1 | text_semantic, tool_usage | Redesign image-only sequence oracle |
| [`receipt_non_receipt_image_no_reads`](../../evals/cases/live-behavior-receipt-non-receipt-image.yaml) | passed | 2 | — | Keep; sample pass only |
| [`receipt_text_pending_then_receipt_alone`](../../evals/cases/live-behavior-receipt-text-pending-then-alone.yaml) | failed | 2 | text_semantic, tool_usage | Redesign image-only sequence oracle |
| [`receipt_with_text_together`](../../evals/cases/live-behavior-receipt-with-text-together.yaml) | failed | 1 | text_semantic | Fix product; keep hard fact/effect check |
| [`repeated_otp_failure_preserves_gift_query`](../../evals/cases/live-behavior-repeated-otp-failure.yaml) | failed | 3 | plan_field_subset | Repair plan-field pin; reply retains pending query |
| [`reset_plan_discards_stored_context`](../../evals/cases/live-behavior-reset-plan.yaml) | failed | 1 | text_semantic | Repair wording/internal-state oracle |
| [`roberto_reminder_invitation_disagreement`](../../evals/cases/live-behavior-roberto-reminder-disagreement.yaml) | failed | 1 | text_semantic | Repair wording/internal-state oracle |
| [`roberto_verified_unique_rsvp_writes_once`](../../evals/cases/live-behavior-roberto-verified-unique.yaml) | passed | 1 | — | Keep; sample pass only |
| [`rsvp_ambiguous_event_requires_grounded_selection`](../../evals/cases/live-behavior-rsvp-ambiguous-event.yaml) | passed | 2 | — | Keep; sample pass only |
| [`rsvp_cinthya_campaign_invitation_not_reported_missing`](../../evals/cases/live-behavior-rsvp-cinthya-campaign.yaml) | passed | 1 | — | Keep; sample pass only |
| [`rsvp_confirmed_state_is_reported`](../../evals/cases/live-behavior-rsvp-confirmed-state.yaml) | passed | 1 | — | Keep; sample pass only |
| [`rsvp_cristian_phone_enriched_confirmation`](../../evals/cases/live-behavior-rsvp-cristian-phone-enriched.yaml) | passed | 1 | — | Keep; sample pass only |
| [`rsvp_declined_state_offers_one_change`](../../evals/cases/live-behavior-rsvp-declined-state.yaml) | passed | 1 | — | Keep; sample pass only |
| [`rsvp_explicit_mutation_targets_requested_event`](../../evals/cases/live-behavior-rsvp-explicit-mutation-targets-requested-event.yaml) | passed | 2 | — | Keep; sample pass only |
| [`rsvp_guest_and_plus_one_combined_saved`](../../evals/cases/live-behavior-rsvp-plus-one-combined.yaml) | failed | 1 | text_semantic | Fix product; keep hard fact/effect check |
| [`rsvp_host_set_declining_consistent`](../../evals/cases/live-behavior-rsvp-host-set-declining-consistent.yaml) | failed | 1 | text_semantic, tool_usage | Fix product; keep hard fact/effect check |
| [`rsvp_host_set_declining_unique_guest`](../../evals/cases/live-behavior-rsvp-host-set-declining-unique-guest.yaml) | passed | 1 | — | Keep; sample pass only |
| [`rsvp_jose_campaign_invitation_not_reported_missing`](../../evals/cases/live-behavior-rsvp-jose-campaign.yaml) | passed | 1 | — | Keep; sample pass only |
| [`rsvp_missing_action_requires_explicit_decision`](../../evals/cases/live-behavior-rsvp-missing-action.yaml) | passed | 1 | — | Keep; sample pass only |
| [`rsvp_missing_event_identity_is_unavailable`](../../evals/cases/live-behavior-rsvp-missing-event-identity.yaml) | failed | 1 | text_semantic | Fix product; keep hard fact/effect check |
| [`rsvp_multi_person_offers_human_help`](../../evals/cases/live-behavior-rsvp-multi-person-human-help.yaml) | failed | 1 | text_semantic | Repair wording/internal-state oracle |
| [`rsvp_paolo_mariana_resolved_single`](../../evals/cases/live-behavior-rsvp-paolo-mariana-resolved-single.yaml) | passed | 1 | — | Keep; sample pass only |
| [`rsvp_plus_one_multiple_events_requires_selection`](../../evals/cases/live-behavior-rsvp-plus-one-multiple-events.yaml) | failed | 1 | node_transition | Repair wording/internal-state oracle |
| [`rsvp_plus_one_not_eligible_no_false_success`](../../evals/cases/live-behavior-rsvp-plus-one-not-eligible.yaml) | failed | 1 | text_semantic | Fix product; keep hard fact/effect check |
| [`rsvp_plus_one_uses_phone_scoped_mutation`](../../evals/cases/live-behavior-rsvp-plus-one.yaml) | failed | 1 | text_semantic | Fix product; keep hard fact/effect check |
| [`rsvp_state_reversal_ends_confirmed`](../../evals/cases/live-behavior-rsvp-attendance-confirmed.yaml) | passed | 1 | — | Keep; sample pass only |
| [`rsvp_tia_niur_ambiguous_clarifies`](../../evals/cases/live-behavior-rsvp-tia-niur-ambiguous-clarifies.yaml) | failed | 1 | node_transition | Repair wording/internal-state oracle |
| [`rsvp_tia_niur_old_target_wins`](../../evals/cases/live-behavior-rsvp-tia-niur-old-target-wins.yaml) | passed | 2 | — | Keep; sample pass only |
| [`rsvp_trusted_phone_reports_no_pending`](../../evals/cases/live-behavior-rsvp-trusted-phone.yaml) | passed | 1 | — | Keep; sample pass only |
| [`rsvp_unmatched_named_event_no_mutation`](../../evals/cases/live-behavior-rsvp-unmatched-named-event-no-mutation.yaml) | failed | 1 | tool_usage | Repair required tool-label pin; answer avoids wrong RSVP |
| [`s01_frozen_kiara_pending_replay`](../../evals/cases/live-behavior-s01-frozen-world-identity.yaml) | failed | 1 | text_semantic, trace_field_subset | Repair obsolete evidence-path assertion; retain facts |
| [`s07_attending_identical_no_write`](../../evals/cases/live-behavior-rsvp-attending-identical-no-write.yaml) | passed | 1 | — | Keep; sample pass only |
| [`s08_kiara_approved_replay`](../../evals/cases/live-behavior-s08-kiara-approved.yaml) | failed | 1 | trace_field_subset | Repair obsolete evidence-path assertion; retain facts |
| [`s11_rsvp_durability_confirms_once`](../../evals/cases/live-behavior-s11-rsvp-durability.yaml) | passed | 1 | — | Keep; sample pass only |
| [`s12_provider_completion_truthful_event_date`](../../evals/cases/live-behavior-s12-provider-completion.yaml) | failed | 1 | tool_usage | Planning diagnostic; inspect fixture before gating |
| [`s2-failed-delivery-preserves-pending`](../../evals/cases/live-behavior-s2-failed-delivery-preserves-pending.yaml) | passed | 2 | — | Keep; sample pass only |
| [`s3-stale-ref-silence-fails`](../../evals/cases/live-behavior-s3-stale-ref-silence-fails.yaml) | failed | 1 | text_semantic | Fix product; keep hard fact/effect check |
| [`s4-injected-renderer-prose-fails`](../../evals/cases/live-behavior-s4-injected-renderer-prose-fails.yaml) | failed | 1 | text_semantic | Planning diagnostic; inspect fixture before gating |
| [`s5-generic-model-failure-not-image`](../../evals/cases/live-behavior-s5-generic-model-failure-not-image.yaml) | passed | 2 | — | Keep; sample pass only |
| [`s7-ambiguous-orders-no-auto-select`](../../evals/cases/live-behavior-s7-ambiguous-orders-no-auto-select.yaml) | passed | 1 | — | Keep; sample pass only |
| [`spanish_only_mixed_language_request`](../../evals/cases/live-behavior-spanish-only.yaml) | failed | 1 | text_not_contains, text_semantic | Fix product; event/planning context lost; RSVP word pin weak |
| [`support_detail_continuity`](../../evals/cases/live-behavior-support-detail-continuity.yaml) | failed | 3 | text_semantic | Repair wording/internal-state oracle |
| [`support_pending_question_completed`](../../evals/cases/live-behavior-support-pending-question-completed.yaml) | passed | 3 | — | Keep; sample pass only |
| [`tito_numbered_name_and_post_rsvp_closure`](../../evals/cases/live-behavior-tito-post-rsvp-closure.yaml) | failed | 2 | text_semantic | Repair wording/internal-state oracle |
| [`wait_followup_no_repeat`](../../evals/cases/live-behavior-wait-followup-no-repeat.yaml) | failed | 3 | text_semantic | Repair wording/internal-state oracle |
| [`wedding_planner_location_completes_search`](../../evals/cases/live-behavior-wedding-planner-location-completes-search.yaml) | failed | 4 | text_semantic | Planning diagnostic; inspect fixture before gating |
| [`wrong_account_handoff_once`](../../evals/cases/live-behavior-wrong-account-handoff.yaml) | passed | 1 | — | Keep; sample pass only |
| [`token_fresh_multifront_stays_multi_need`](../../evals/cases/live-feedback-token-multifront.yaml) | failed | 1 | text_semantic | Planning diagnostic; inspect fixture before gating |
| [`token_seeded_close_flow`](../../evals/cases/live-feedback-token-close-flow.yaml) | passed | 5 | — | Keep; sample pass only |
| [`token_seeded_contact_correction`](../../evals/cases/live-feedback-token-contact-correction.yaml) | errored | 0 | text_semantic, trace_field_equals | Repair fixture; zero-turn error |
| [`token_seeded_selection_defer_close`](../../evals/cases/live-feedback-token-selection-defer-close.yaml) | passed | 4 | — | Keep; sample pass only |

## Evidence and limits

- Source: `.eval-runs/eval-2026-09-25T05-52-16-616Z-cc7cd3e6/report.json`, its manifest, and the case artifacts. The manifest and run report are historical observations; oracle edits above do not rescore them.
- I inspected the saved turns and judge messages for the named blockers and high-confidence oracle examples, and parsed every suite case/expectation for the ledger. The ledger distinguishes proven answer/effect defects from obsolete oracle pins; a one-run failure remains an observation rather than a population failure rate.
- No broad deletion was made. The OpenClaw audit criterion requires surviving coverage for observable behavior before removing a test; this repository has not yet demonstrated that replacement for most of the 139 cases.
