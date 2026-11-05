# Eval Report: eval-2026-10-29T15-41-52-334Z-da34b91f

- Generated at: 2026-10-29T15:53:54.356Z
- Total cases: 24
- Passed: 9
- Failed: 15
- Errored: 0
- Skipped: 0
- Average score: 0.803
- Average latency: 26099.5 ms
- Completion: complete
- Resume mode: full
- Makespan: 720906 ms
- Judge calls: 0 (retries=0, rate-limited=0)
- Tokens: input=640423 cached=394160 uncached=246263

## Suite Summary

| Suite | Total | Passed | Failed | Errored | Skipped | Avg score | Avg latency (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| live_behavior_regression | 24 | 9 | 15 | 0 | 0 | 0.803 | 26099.5 |

## Config Summary

| Config | Total | Passed | Failed | Errored | Skipped | Avg score | Avg latency (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| live_lambda | 24 | 9 | 15 | 0 | 0 | 0.803 | 26099.5 |

| Suite | Case | Target | Config | Status | Score | Latency (ms) | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| live_behavior_regression | live_behavior.bounded_fixture_details_r1 | live_lambda | live_lambda | passed | 1.000 | 17649.0 | — |
| live_behavior_regression | live_behavior.bounded_fixture_details_r2 | live_lambda | live_lambda | passed | 1.000 | 14795.0 | — |
| live_behavior_regression | live_behavior.bounded_fixture_details_r3 | live_lambda | live_lambda | passed | 1.000 | 11903.0 | — |
| live_behavior_regression | live_behavior.bounded_quote_one_r1 | live_lambda | live_lambda | passed | 1.000 | 25444.0 | — |
| live_behavior_regression | live_behavior.bounded_quote_one_r2 | live_lambda | live_lambda | failed | 0.571 | 33251.0 | product_effect_identity |
| live_behavior_regression | live_behavior.bounded_quote_one_r3 | live_lambda | live_lambda | failed | 0.571 | 31688.0 | product_effect_identity |
| live_behavior_regression | live_behavior.bounded_quote_two_r1 | live_lambda | live_lambda | failed | 0.571 | 24368.0 | product_effect_identity |
| live_behavior_regression | live_behavior.bounded_quote_two_r2 | live_lambda | live_lambda | passed | 1.000 | 27478.0 | — |
| live_behavior_regression | live_behavior.bounded_quote_two_r3 | live_lambda | live_lambda | passed | 1.000 | 26261.0 | — |
| live_behavior_regression | live_behavior.bounded_second_baby_shower_r1 | live_lambda | live_lambda | failed | 0.667 | 25914.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.bounded_second_baby_shower_r2 | live_lambda | live_lambda | failed | 0.667 | 24042.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.bounded_second_baby_shower_r3 | live_lambda | live_lambda | failed | 0.667 | 28792.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.bounded_second_birthday_r1 | live_lambda | live_lambda | passed | 1.000 | 31668.0 | — |
| live_behavior_regression | live_behavior.bounded_second_birthday_r2 | live_lambda | live_lambda | failed | 0.889 | 32680.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.bounded_second_birthday_r3 | live_lambda | live_lambda | passed | 1.000 | 30952.0 | — |
| live_behavior_regression | live_behavior.bounded_second_corporate_r1 | live_lambda | live_lambda | failed | 0.667 | 22317.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.bounded_second_corporate_r2 | live_lambda | live_lambda | failed | 0.667 | 27381.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.bounded_second_corporate_r3 | live_lambda | live_lambda | failed | 0.667 | 25592.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.bounded_second_social_r1 | live_lambda | live_lambda | failed | 0.667 | 27082.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.bounded_second_social_r2 | live_lambda | live_lambda | failed | 0.667 | 25353.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.bounded_second_social_r3 | live_lambda | live_lambda | failed | 0.667 | 27718.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.bounded_second_wedding_r1 | live_lambda | live_lambda | failed | 0.778 | 29208.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.bounded_second_wedding_r2 | live_lambda | live_lambda | passed | 1.000 | 27784.0 | — |
| live_behavior_regression | live_behavior.bounded_second_wedding_r3 | live_lambda | live_lambda | failed | 0.889 | 27068.0 | product_fact_completeness |
