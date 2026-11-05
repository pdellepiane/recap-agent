# Eval Report: eval-2026-11-05T15-44-10-684Z-f3fd08a5

- Generated at: 2026-11-05T15:45:26.100Z
- Total cases: 2
- Passed: 1
- Failed: 1
- Errored: 0
- Skipped: 0
- Average score: 0.889
- Average latency: 32487.0 ms
- Completion: complete
- Resume mode: full
- Makespan: 74329 ms
- Judge calls: 0 (retries=0, rate-limited=0)
- Tokens: input=53849 cached=14244 uncached=39605

## Suite Summary

| Suite | Total | Passed | Failed | Errored | Skipped | Avg score | Avg latency (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| live_behavior_regression | 2 | 1 | 1 | 0 | 0 | 0.889 | 32487.0 |

## Config Summary

| Config | Total | Passed | Failed | Errored | Skipped | Avg score | Avg latency (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| live_lambda | 2 | 1 | 1 | 0 | 0 | 0.889 | 32487.0 |

| Suite | Case | Target | Config | Status | Score | Latency (ms) | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| live_behavior_regression | live_behavior.quote_explicit_send_seeded_contact | live_lambda | live_lambda | passed | 1.000 | 34105.0 | — |
| live_behavior_regression | live_behavior.regression_displayed_second_birthday | live_lambda | live_lambda | failed | 0.778 | 30869.0 | product_fact_completeness |
