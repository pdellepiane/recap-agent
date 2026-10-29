# Eval Report: eval-2026-10-27T05-31-20-436Z-edb558f3

- Generated at: 2026-10-27T06:02:04.120Z
- Total cases: 90
- Passed: 70
- Failed: 20
- Errored: 0
- Skipped: 0
- Average score: 0.955
- Average latency: 17337.3 ms
- Completion: complete
- Resume mode: full
- Makespan: 1842290 ms
- Judge calls: 0 (retries=0, rate-limited=0)
- Tokens: input=1380419 cached=572496 uncached=807923

## Suite Summary

| Suite | Total | Passed | Failed | Errored | Skipped | Avg score | Avg latency (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| live_behavior_regression | 90 | 70 | 20 | 0 | 0 | 0.955 | 17337.3 |

## Config Summary

| Config | Total | Passed | Failed | Errored | Skipped | Avg score | Avg latency (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| live_lambda | 90 | 70 | 20 | 0 | 0 | 0.955 | 17337.3 |

| Suite | Case | Target | Config | Status | Score | Latency (ms) | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| live_behavior_regression | live_behavior.master_provider_live_category_catalog.master_r1 | live_lambda | live_lambda | passed | 1.000 | 18213.0 | — |
| live_behavior_regression | live_behavior.returned_refund_stays_with_person.master_r1 | live_lambda | live_lambda | passed | 1.000 | 8711.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_details.master_r1 | live_lambda | live_lambda | passed | 1.000 | 12836.0 | — |
| live_behavior_regression | live_behavior.otp_number_words_are_verified.master_r1 | live_lambda | live_lambda | failed | 0.667 | 11769.0 | product_effect_identity |
| live_behavior_regression | live_behavior.pending_total_dispute_is_reviewed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 6395.0 | — |
| live_behavior_regression | live_behavior.rsvp_explicit_mutation_targets_requested_event.master_r1 | live_lambda | live_lambda | passed | 1.000 | 47948.0 | — |
| live_behavior_regression | live_behavior.gift_mixed_order_distinguishes_items.master_r1 | live_lambda | live_lambda | failed | 0.667 | 10812.0 | product_effect_identity |
| live_behavior_regression | live_behavior.master_faq_additional_transfer.master_r1 | live_lambda | live_lambda | passed | 1.000 | 9036.0 | — |
| live_behavior_regression | live_behavior.master_public_search_followup.master_r1 | live_lambda | live_lambda | passed | 1.000 | 22101.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_multi_need.master_r1 | live_lambda | live_lambda | failed | 0.500 | 14329.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.unrelated_answer_isolates_money.master_r1 | live_lambda | live_lambda | passed | 1.000 | 10545.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_wedding_planner.master_r1 | live_lambda | live_lambda | passed | 1.000 | 20657.0 | — |
| live_behavior_regression | live_behavior.master_faq_validation_window.master_r1 | live_lambda | live_lambda | passed | 1.000 | 10395.0 | — |
| live_behavior_regression | live_behavior.otp_terminal_handoff_failed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 35608.0 | — |
| live_behavior_regression | live_behavior.s12_provider_completion_truthful_event_date.master_r1 | live_lambda | live_lambda | failed | 0.750 | 33635.0 | product_effect_identity |
| live_behavior_regression | live_behavior.master_provider_live_catering.master_r1 | live_lambda | live_lambda | passed | 1.000 | 38875.0 | — |
| live_behavior_regression | live_behavior.s11_rsvp_durability_confirms_once.master_r1 | live_lambda | live_lambda | passed | 1.000 | 47635.0 | — |
| live_behavior_regression | live_behavior.master_faq_support_contact.master_r1 | live_lambda | live_lambda | failed | 0.800 | 10197.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.master_faq_transfer_example.master_r1 | live_lambda | live_lambda | passed | 1.000 | 10628.0 | — |
| live_behavior_regression | live_behavior.provider_decimal_budget_excludes_expensive_candidates.master_r1 | live_lambda | live_lambda | passed | 1.000 | 14478.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_selection.master_r1 | live_lambda | live_lambda | passed | 1.000 | 8257.0 | — |
| live_behavior_regression | live_behavior.master_faq_calculator.master_r1 | live_lambda | live_lambda | failed | 0.800 | 9734.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.master_provider_no_results.master_r1 | live_lambda | live_lambda | passed | 1.000 | 13759.0 | — |
| live_behavior_regression | live_behavior.master_faq_card_example.master_r1 | live_lambda | live_lambda | passed | 1.000 | 14727.0 | — |
| live_behavior_regression | live_behavior.question_after_takeover_is_answered.master_r1 | live_lambda | live_lambda | passed | 1.000 | 6610.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_photography.master_r1 | live_lambda | live_lambda | passed | 1.000 | 21285.0 | — |
| live_behavior_regression | live_behavior.master_faq_support_hours.master_r1 | live_lambda | live_lambda | passed | 1.000 | 9772.0 | — |
| live_behavior_regression | live_behavior.authentication_refusal_closes_protected_query.master_r1 | live_lambda | live_lambda | failed | 1.000 | 7633.0 | product_effect_identity |
| live_behavior_regression | live_behavior.master_faq_paypal_example.master_r1 | live_lambda | live_lambda | passed | 1.000 | 10582.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_venues.master_r1 | live_lambda | live_lambda | passed | 1.000 | 19371.0 | — |
| live_behavior_regression | live_behavior.master_faq_paypal_example.master_r2 | live_lambda | live_lambda | passed | 1.000 | 10187.0 | — |
| live_behavior_regression | live_behavior.unrelated_answer_isolates_money.master_r2 | live_lambda | live_lambda | passed | 1.000 | 11292.0 | — |
| live_behavior_regression | live_behavior.pending_total_dispute_is_reviewed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 11765.0 | — |
| live_behavior_regression | live_behavior.question_after_takeover_is_answered.master_r2 | live_lambda | live_lambda | failed | 0.800 | 9377.0 | product_effect_identity |
| live_behavior_regression | live_behavior.s11_rsvp_durability_confirms_once.master_r2 | live_lambda | live_lambda | failed | 1.000 | 44600.0 | product_effect_identity |
| live_behavior_regression | live_behavior.master_provider_live_category_catalog.master_r2 | live_lambda | live_lambda | passed | 1.000 | 13011.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_wedding_planner.master_r2 | live_lambda | live_lambda | passed | 1.000 | 22041.0 | — |
| live_behavior_regression | live_behavior.gift_mixed_order_distinguishes_items.master_r2 | live_lambda | live_lambda | failed | 0.667 | 9490.0 | product_effect_identity |
| live_behavior_regression | live_behavior.master_faq_support_contact.master_r2 | live_lambda | live_lambda | failed | 0.800 | 10029.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.master_faq_card_example.master_r2 | live_lambda | live_lambda | passed | 1.000 | 13228.0 | — |
| live_behavior_regression | live_behavior.returned_refund_stays_with_person.master_r2 | live_lambda | live_lambda | passed | 1.000 | 8601.0 | — |
| live_behavior_regression | live_behavior.s12_provider_completion_truthful_event_date.master_r2 | live_lambda | live_lambda | failed | 0.750 | 32912.0 | product_effect_identity |
| live_behavior_regression | live_behavior.master_public_search_followup.master_r2 | live_lambda | live_lambda | passed | 1.000 | 25548.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_catering.master_r2 | live_lambda | live_lambda | passed | 1.000 | 35100.0 | — |
| live_behavior_regression | live_behavior.master_faq_transfer_example.master_r2 | live_lambda | live_lambda | passed | 1.000 | 10719.0 | — |
| live_behavior_regression | live_behavior.master_faq_support_hours.master_r2 | live_lambda | live_lambda | passed | 1.000 | 9946.0 | — |
| live_behavior_regression | live_behavior.otp_number_words_are_verified.master_r2 | live_lambda | live_lambda | failed | 0.667 | 16359.0 | product_effect_identity |
| live_behavior_regression | live_behavior.provider_decimal_budget_excludes_expensive_candidates.master_r2 | live_lambda | live_lambda | passed | 1.000 | 17032.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_photography.master_r2 | live_lambda | live_lambda | passed | 1.000 | 20450.0 | — |
| live_behavior_regression | live_behavior.authentication_refusal_closes_protected_query.master_r2 | live_lambda | live_lambda | failed | 1.000 | 6504.0 | product_effect_identity |
| live_behavior_regression | live_behavior.master_faq_calculator.master_r2 | live_lambda | live_lambda | passed | 1.000 | 10901.0 | — |
| live_behavior_regression | live_behavior.otp_terminal_handoff_failed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 36133.0 | — |
| live_behavior_regression | live_behavior.master_provider_no_results.master_r2 | live_lambda | live_lambda | passed | 1.000 | 13616.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_multi_need.master_r2 | live_lambda | live_lambda | passed | 1.000 | 21059.0 | — |
| live_behavior_regression | live_behavior.rsvp_explicit_mutation_targets_requested_event.master_r2 | live_lambda | live_lambda | passed | 1.000 | 54718.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_selection.master_r2 | live_lambda | live_lambda | passed | 1.000 | 8958.0 | — |
| live_behavior_regression | live_behavior.master_faq_validation_window.master_r2 | live_lambda | live_lambda | passed | 1.000 | 10576.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_venues.master_r2 | live_lambda | live_lambda | passed | 1.000 | 16735.0 | — |
| live_behavior_regression | live_behavior.master_faq_additional_transfer.master_r2 | live_lambda | live_lambda | passed | 1.000 | 11352.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_details.master_r2 | live_lambda | live_lambda | passed | 1.000 | 11885.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_details.master_r3 | live_lambda | live_lambda | passed | 1.000 | 10765.0 | — |
| live_behavior_regression | live_behavior.master_public_search_followup.master_r3 | live_lambda | live_lambda | passed | 1.000 | 25388.0 | — |
| live_behavior_regression | live_behavior.provider_decimal_budget_excludes_expensive_candidates.master_r3 | live_lambda | live_lambda | passed | 1.000 | 15703.0 | — |
| live_behavior_regression | live_behavior.master_faq_paypal_example.master_r3 | live_lambda | live_lambda | passed | 1.000 | 11416.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_venues.master_r3 | live_lambda | live_lambda | passed | 1.000 | 16648.0 | — |
| live_behavior_regression | live_behavior.master_faq_calculator.master_r3 | live_lambda | live_lambda | failed | 0.800 | 10912.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.master_faq_card_example.master_r3 | live_lambda | live_lambda | passed | 1.000 | 11487.0 | — |
| live_behavior_regression | live_behavior.master_faq_transfer_example.master_r3 | live_lambda | live_lambda | passed | 1.000 | 10339.0 | — |
| live_behavior_regression | live_behavior.pending_total_dispute_is_reviewed.master_r3 | live_lambda | live_lambda | passed | 1.000 | 10168.0 | — |
| live_behavior_regression | live_behavior.rsvp_explicit_mutation_targets_requested_event.master_r3 | live_lambda | live_lambda | passed | 1.000 | 57901.0 | — |
| live_behavior_regression | live_behavior.otp_number_words_are_verified.master_r3 | live_lambda | live_lambda | failed | 1.000 | 11716.0 | product_effect_identity |
| live_behavior_regression | live_behavior.master_faq_support_contact.master_r3 | live_lambda | live_lambda | failed | 0.800 | 10291.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.master_provider_live_category_catalog.master_r3 | live_lambda | live_lambda | passed | 1.000 | 15648.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_catering.master_r3 | live_lambda | live_lambda | passed | 1.000 | 35889.0 | — |
| live_behavior_regression | live_behavior.master_provider_no_results.master_r3 | live_lambda | live_lambda | passed | 1.000 | 14236.0 | — |
| live_behavior_regression | live_behavior.question_after_takeover_is_answered.master_r3 | live_lambda | live_lambda | passed | 1.000 | 7881.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_wedding_planner.master_r3 | live_lambda | live_lambda | passed | 1.000 | 22150.0 | — |
| live_behavior_regression | live_behavior.s12_provider_completion_truthful_event_date.master_r3 | live_lambda | live_lambda | passed | 1.000 | 26038.0 | — |
| live_behavior_regression | live_behavior.gift_mixed_order_distinguishes_items.master_r3 | live_lambda | live_lambda | passed | 1.000 | 8740.0 | — |
| live_behavior_regression | live_behavior.master_faq_additional_transfer.master_r3 | live_lambda | live_lambda | passed | 1.000 | 9917.0 | — |
| live_behavior_regression | live_behavior.otp_terminal_handoff_failed.master_r3 | live_lambda | live_lambda | passed | 1.000 | 31255.0 | — |
| live_behavior_regression | live_behavior.unrelated_answer_isolates_money.master_r3 | live_lambda | live_lambda | passed | 1.000 | 9442.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_photography.master_r3 | live_lambda | live_lambda | passed | 1.000 | 21383.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_selection.master_r3 | live_lambda | live_lambda | passed | 1.000 | 9538.0 | — |
| live_behavior_regression | live_behavior.master_faq_support_hours.master_r3 | live_lambda | live_lambda | passed | 1.000 | 11963.0 | — |
| live_behavior_regression | live_behavior.s11_rsvp_durability_confirms_once.master_r3 | live_lambda | live_lambda | failed | 1.000 | 38464.0 | product_effect_identity |
| live_behavior_regression | live_behavior.master_faq_validation_window.master_r3 | live_lambda | live_lambda | passed | 1.000 | 12228.0 | — |
| live_behavior_regression | live_behavior.authentication_refusal_closes_protected_query.master_r3 | live_lambda | live_lambda | failed | 1.000 | 4144.0 | product_effect_identity |
| live_behavior_regression | live_behavior.returned_refund_stays_with_person.master_r3 | live_lambda | live_lambda | passed | 1.000 | 9112.0 | — |
| live_behavior_regression | live_behavior.master_provider_live_multi_need.master_r3 | live_lambda | live_lambda | failed | 0.500 | 18934.0 | product_fact_completeness |
