# Eval Report: eval-2026-10-27T22-19-42-463Z-78589b85

- Generated at: 2026-10-27T22:55:37.939Z
- Total cases: 108
- Passed: 100
- Failed: 5
- Errored: 3
- Skipped: 0
- Average score: 0.978
- Average latency: 16253.2 ms
- Completion: complete
- Resume mode: full
- Makespan: 2154073 ms
- Judge calls: 0 (retries=0, rate-limited=0)
- Tokens: input=1767570 cached=777439 uncached=990131

## Suite Summary

| Suite | Total | Passed | Failed | Errored | Skipped | Avg score | Avg latency (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| live_behavior_regression | 108 | 100 | 5 | 3 | 0 | 0.978 | 16253.2 |

## Config Summary

| Config | Total | Passed | Failed | Errored | Skipped | Avg score | Avg latency (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| live_lambda | 108 | 100 | 5 | 3 | 0 | 0.978 | 16253.2 |

| Suite | Case | Target | Config | Status | Score | Latency (ms) | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| live_behavior_regression | live_behavior.master_faq_support_hours.master_r1 | live_lambda | live_lambda | passed | 1.000 | 14806.0 | — |
| live_behavior_regression | live_behavior.master_faq_paypal_example.master_r1 | live_lambda | live_lambda | passed | 1.000 | 11654.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_catering.master_r1 | live_lambda | live_lambda | passed | 1.000 | 37985.0 | — |
| live_behavior_regression | live_behavior.provider_reference_miraflores_option.master_r1 | live_lambda | live_lambda | passed | 1.000 | 39679.0 | — |
| live_behavior_regression | live_behavior.gift_mixed_order_distinguishes_items.master_r1 | live_lambda | live_lambda | passed | 1.000 | 8630.0 | — |
| live_behavior_regression | live_behavior.rsvp_explicit_mutation_targets_requested_event.master_r1 | live_lambda | live_lambda | passed | 1.000 | 41762.0 | — |
| live_behavior_regression | live_behavior.master_v2_otp_number_words.master_r1 | live_lambda | live_lambda | errored | 0.667 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.master_v2_rsvp_durability.master_r1 | live_lambda | live_lambda | passed | 1.000 | 48588.0 | — |
| live_behavior_regression | live_behavior.master_v2_auth_refusal.master_r1 | live_lambda | live_lambda | passed | 1.000 | 17971.0 | — |
| live_behavior_regression | live_behavior.purchase_current_pending_over_old_approved.master_r1 | live_lambda | live_lambda | passed | 1.000 | 7064.0 | — |
| live_behavior_regression | live_behavior.master_faq_support_contact.master_r1 | live_lambda | live_lambda | passed | 1.000 | 12969.0 | — |
| live_behavior_regression | live_behavior.customer_transaction_reference_matched.master_r1 | live_lambda | live_lambda | passed | 1.000 | 7257.0 | — |
| live_behavior_regression | live_behavior.master_public_search_followup.master_r1 | live_lambda | live_lambda | passed | 1.000 | 25549.0 | — |
| live_behavior_regression | live_behavior.master_faq_validation_window.master_r1 | live_lambda | live_lambda | passed | 1.000 | 15233.0 | — |
| live_behavior_regression | live_behavior.master_v2_provider_completion.master_r1 | live_lambda | live_lambda | failed | 0.600 | 28101.0 | product_effect_identity |
| live_behavior_regression | live_behavior.provider_decimal_budget_excludes_expensive_candidates.master_r1 | live_lambda | live_lambda | passed | 1.000 | 14004.0 | — |
| live_behavior_regression | live_behavior.unrelated_answer_isolates_money.master_r1 | live_lambda | live_lambda | passed | 1.000 | 11813.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_venues.master_r1 | live_lambda | live_lambda | passed | 1.000 | 15465.0 | — |
| live_behavior_regression | live_behavior.master_faq_additional_transfer.master_r1 | live_lambda | live_lambda | passed | 1.000 | 9502.0 | — |
| live_behavior_regression | live_behavior.master_faq_calculator.master_r1 | live_lambda | live_lambda | failed | 0.800 | 9844.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.master_provider_no_results.master_r1 | live_lambda | live_lambda | passed | 1.000 | 14050.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_selection.master_r1 | live_lambda | live_lambda | passed | 1.000 | 13425.0 | — |
| live_behavior_regression | live_behavior.question_after_takeover_is_answered.master_r1 | live_lambda | live_lambda | passed | 1.000 | 8313.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_photography.master_r1 | live_lambda | live_lambda | passed | 1.000 | 19347.0 | — |
| live_behavior_regression | live_behavior.master_faq_card_example.master_r1 | live_lambda | live_lambda | passed | 1.000 | 8825.0 | — |
| live_behavior_regression | live_behavior.rsvp_confirmed_state_is_reported.master_r1 | live_lambda | live_lambda | passed | 1.000 | 28402.0 | — |
| live_behavior_regression | live_behavior.reset_plan_discards_stored_context.master_r1 | live_lambda | live_lambda | passed | 1.000 | 32536.0 | — |
| live_behavior_regression | live_behavior.pending_total_dispute_is_reviewed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 24521.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_multi_need.master_r1 | live_lambda | live_lambda | passed | 1.000 | 18838.0 | — |
| live_behavior_regression | live_behavior.otp_terminal_handoff_failed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 40646.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_wedding_planner.master_r1 | live_lambda | live_lambda | passed | 1.000 | 17781.0 | — |
| live_behavior_regression | live_behavior.unassociated_event_has_public_search.master_r1 | live_lambda | live_lambda | passed | 1.000 | 10772.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_details.master_r1 | live_lambda | live_lambda | passed | 1.000 | 11699.0 | — |
| live_behavior_regression | live_behavior.returned_refund_stays_with_person.master_r1 | live_lambda | live_lambda | passed | 1.000 | 7358.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_category_catalog.master_r1 | live_lambda | live_lambda | passed | 1.000 | 18663.0 | — |
| live_behavior_regression | live_behavior.master_faq_transfer_example.master_r1 | live_lambda | live_lambda | passed | 1.000 | 9891.0 | — |
| live_behavior_regression | live_behavior.master_faq_paypal_example.master_r2 | live_lambda | live_lambda | passed | 1.000 | 9085.0 | — |
| live_behavior_regression | live_behavior.master_v2_provider_completion.master_r2 | live_lambda | live_lambda | passed | 1.000 | 24367.0 | — |
| live_behavior_regression | live_behavior.gift_mixed_order_distinguishes_items.master_r2 | live_lambda | live_lambda | passed | 1.000 | 7826.0 | — |
| live_behavior_regression | live_behavior.master_faq_support_contact.master_r2 | live_lambda | live_lambda | passed | 1.000 | 13693.0 | — |
| live_behavior_regression | live_behavior.master_v2_otp_number_words.master_r2 | live_lambda | live_lambda | errored | 0.667 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.master_provider_live_multi_need.master_r2 | live_lambda | live_lambda | passed | 1.000 | 22509.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_venues.master_r2 | live_lambda | live_lambda | passed | 1.000 | 14011.0 | — |
| live_behavior_regression | live_behavior.unrelated_answer_isolates_money.master_r2 | live_lambda | live_lambda | passed | 1.000 | 8094.0 | — |
| live_behavior_regression | live_behavior.master_faq_additional_transfer.master_r2 | live_lambda | live_lambda | passed | 1.000 | 8172.0 | — |
| live_behavior_regression | live_behavior.pending_total_dispute_is_reviewed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 11182.0 | — |
| live_behavior_regression | live_behavior.otp_terminal_handoff_failed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 43171.0 | — |
| live_behavior_regression | live_behavior.master_faq_validation_window.master_r2 | live_lambda | live_lambda | passed | 1.000 | 8978.0 | — |
| live_behavior_regression | live_behavior.rsvp_explicit_mutation_targets_requested_event.master_r2 | live_lambda | live_lambda | passed | 1.000 | 45292.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_category_catalog.master_r2 | live_lambda | live_lambda | passed | 1.000 | 23612.0 | — |
| live_behavior_regression | live_behavior.customer_transaction_reference_matched.master_r2 | live_lambda | live_lambda | passed | 1.000 | 6776.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_details.master_r2 | live_lambda | live_lambda | passed | 1.000 | 11541.0 | — |
| live_behavior_regression | live_behavior.purchase_current_pending_over_old_approved.master_r2 | live_lambda | live_lambda | passed | 1.000 | 5585.0 | — |
| live_behavior_regression | live_behavior.master_v2_auth_refusal.master_r2 | live_lambda | live_lambda | passed | 1.000 | 8833.0 | — |
| live_behavior_regression | live_behavior.provider_reference_miraflores_option.master_r2 | live_lambda | live_lambda | passed | 1.000 | 33603.0 | — |
| live_behavior_regression | live_behavior.master_faq_card_example.master_r2 | live_lambda | live_lambda | passed | 1.000 | 10222.0 | — |
| live_behavior_regression | live_behavior.question_after_takeover_is_answered.master_r2 | live_lambda | live_lambda | passed | 1.000 | 7168.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_photography.master_r2 | live_lambda | live_lambda | passed | 1.000 | 17463.0 | — |
| live_behavior_regression | live_behavior.master_faq_support_hours.master_r2 | live_lambda | live_lambda | passed | 1.000 | 8528.0 | — |
| live_behavior_regression | live_behavior.master_faq_calculator.master_r2 | live_lambda | live_lambda | failed | 0.800 | 8843.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.master_provider_live_selection.master_r2 | live_lambda | live_lambda | passed | 1.000 | 8908.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_wedding_planner.master_r2 | live_lambda | live_lambda | passed | 1.000 | 21691.0 | — |
| live_behavior_regression | live_behavior.reset_plan_discards_stored_context.master_r2 | live_lambda | live_lambda | passed | 1.000 | 17942.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_catering.master_r2 | live_lambda | live_lambda | passed | 1.000 | 30220.0 | — |
| live_behavior_regression | live_behavior.provider_decimal_budget_excludes_expensive_candidates.master_r2 | live_lambda | live_lambda | passed | 1.000 | 11756.0 | — |
| live_behavior_regression | live_behavior.master_provider_no_results.master_r2 | live_lambda | live_lambda | passed | 1.000 | 10950.0 | — |
| live_behavior_regression | live_behavior.rsvp_confirmed_state_is_reported.master_r2 | live_lambda | live_lambda | passed | 1.000 | 26817.0 | — |
| live_behavior_regression | live_behavior.master_public_search_followup.master_r2 | live_lambda | live_lambda | passed | 1.000 | 18156.0 | — |
| live_behavior_regression | live_behavior.master_v2_rsvp_durability.master_r2 | live_lambda | live_lambda | passed | 1.000 | 29650.0 | — |
| live_behavior_regression | live_behavior.master_faq_transfer_example.master_r2 | live_lambda | live_lambda | passed | 1.000 | 8182.0 | — |
| live_behavior_regression | live_behavior.unassociated_event_has_public_search.master_r2 | live_lambda | live_lambda | passed | 1.000 | 9214.0 | — |
| live_behavior_regression | live_behavior.returned_refund_stays_with_person.master_r2 | live_lambda | live_lambda | passed | 1.000 | 5103.0 | — |
| live_behavior_regression | live_behavior.master_faq_additional_transfer.master_r3 | live_lambda | live_lambda | passed | 1.000 | 6886.0 | — |
| live_behavior_regression | live_behavior.otp_terminal_handoff_failed.master_r3 | live_lambda | live_lambda | passed | 1.000 | 32764.0 | — |
| live_behavior_regression | live_behavior.master_v2_rsvp_durability.master_r3 | live_lambda | live_lambda | passed | 1.000 | 42756.0 | — |
| live_behavior_regression | live_behavior.master_faq_support_hours.master_r3 | live_lambda | live_lambda | passed | 1.000 | 7703.0 | — |
| live_behavior_regression | live_behavior.master_v2_auth_refusal.master_r3 | live_lambda | live_lambda | passed | 1.000 | 11957.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_multi_need.master_r3 | live_lambda | live_lambda | passed | 1.000 | 19286.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_category_catalog.master_r3 | live_lambda | live_lambda | passed | 1.000 | 11128.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_wedding_planner.master_r3 | live_lambda | live_lambda | passed | 1.000 | 15642.0 | — |
| live_behavior_regression | live_behavior.unassociated_event_has_public_search.master_r3 | live_lambda | live_lambda | passed | 1.000 | 9103.0 | — |
| live_behavior_regression | live_behavior.master_public_search_followup.master_r3 | live_lambda | live_lambda | passed | 1.000 | 18974.0 | — |
| live_behavior_regression | live_behavior.master_v2_provider_completion.master_r3 | live_lambda | live_lambda | failed | 0.600 | 26497.0 | product_effect_identity |
| live_behavior_regression | live_behavior.master_faq_paypal_example.master_r3 | live_lambda | live_lambda | passed | 1.000 | 8654.0 | — |
| live_behavior_regression | live_behavior.unrelated_answer_isolates_money.master_r3 | live_lambda | live_lambda | passed | 1.000 | 10882.0 | — |
| live_behavior_regression | live_behavior.master_v2_otp_number_words.master_r3 | live_lambda | live_lambda | errored | 0.667 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.master_provider_live_selection.master_r3 | live_lambda | live_lambda | passed | 1.000 | 11066.0 | — |
| live_behavior_regression | live_behavior.provider_reference_miraflores_option.master_r3 | live_lambda | live_lambda | passed | 1.000 | 34992.0 | — |
| live_behavior_regression | live_behavior.master_faq_validation_window.master_r3 | live_lambda | live_lambda | passed | 1.000 | 9899.0 | — |
| live_behavior_regression | live_behavior.returned_refund_stays_with_person.master_r3 | live_lambda | live_lambda | passed | 1.000 | 7828.0 | — |
| live_behavior_regression | live_behavior.master_faq_calculator.master_r3 | live_lambda | live_lambda | failed | 0.800 | 8544.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.master_provider_live_photography.master_r3 | live_lambda | live_lambda | passed | 1.000 | 17095.0 | — |
| live_behavior_regression | live_behavior.reset_plan_discards_stored_context.master_r3 | live_lambda | live_lambda | passed | 1.000 | 17443.0 | — |
| live_behavior_regression | live_behavior.master_faq_card_example.master_r3 | live_lambda | live_lambda | passed | 1.000 | 7851.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_catering.master_r3 | live_lambda | live_lambda | passed | 1.000 | 32192.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_venues.master_r3 | live_lambda | live_lambda | passed | 1.000 | 13520.0 | — |
| live_behavior_regression | live_behavior.customer_transaction_reference_matched.master_r3 | live_lambda | live_lambda | passed | 1.000 | 7224.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_details.master_r3 | live_lambda | live_lambda | passed | 1.000 | 9994.0 | — |
| live_behavior_regression | live_behavior.question_after_takeover_is_answered.master_r3 | live_lambda | live_lambda | passed | 1.000 | 6418.0 | — |
| live_behavior_regression | live_behavior.master_faq_transfer_example.master_r3 | live_lambda | live_lambda | passed | 1.000 | 7891.0 | — |
| live_behavior_regression | live_behavior.master_provider_no_results.master_r3 | live_lambda | live_lambda | passed | 1.000 | 10543.0 | — |
| live_behavior_regression | live_behavior.master_faq_support_contact.master_r3 | live_lambda | live_lambda | passed | 1.000 | 9036.0 | — |
| live_behavior_regression | live_behavior.purchase_current_pending_over_old_approved.master_r3 | live_lambda | live_lambda | passed | 1.000 | 6795.0 | — |
| live_behavior_regression | live_behavior.provider_decimal_budget_excludes_expensive_candidates.master_r3 | live_lambda | live_lambda | passed | 1.000 | 13109.0 | — |
| live_behavior_regression | live_behavior.rsvp_confirmed_state_is_reported.master_r3 | live_lambda | live_lambda | passed | 1.000 | 23486.0 | — |
| live_behavior_regression | live_behavior.rsvp_explicit_mutation_targets_requested_event.master_r3 | live_lambda | live_lambda | passed | 1.000 | 42887.0 | — |
| live_behavior_regression | live_behavior.gift_mixed_order_distinguishes_items.master_r3 | live_lambda | live_lambda | passed | 1.000 | 7175.0 | — |
| live_behavior_regression | live_behavior.pending_total_dispute_is_reviewed.master_r3 | live_lambda | live_lambda | passed | 1.000 | 8036.0 | — |
