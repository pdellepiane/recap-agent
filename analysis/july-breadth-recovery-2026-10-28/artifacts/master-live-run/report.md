# Eval Report: eval-2026-10-28T13-25-45-964Z-aaee23b6

- Generated at: 2026-10-28T14:25:57.400Z
- Total cases: 150
- Passed: 106
- Failed: 4
- Errored: 40
- Skipped: 0
- Average score: 0.729
- Average latency: 21423.7 ms
- Completion: INCOMPLETE (suite coordinator deadline stopped admissions; report is incomplete)
- Resume mode: full
- Makespan: 3609725 ms
- Judge calls: 0 (retries=0, rate-limited=0)
- Tokens: input=2919286 cached=1717346 uncached=1201940

## Suite Summary

| Suite | Total | Passed | Failed | Errored | Skipped | Avg score | Avg latency (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| live_behavior_regression | 150 | 106 | 4 | 40 | 0 | 0.729 | 21423.7 |

## Config Summary

| Config | Total | Passed | Failed | Errored | Skipped | Avg score | Avg latency (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| live_lambda | 150 | 106 | 4 | 40 | 0 | 0.729 | 21423.7 |

| Suite | Case | Target | Config | Status | Score | Latency (ms) | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| live_behavior_regression | live_behavior.july_breadth_corporate_01_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 28592.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_03_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 27640.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_10_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 26550.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_09_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 22696.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_10_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 35012.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_02_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 10482.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_04_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 34952.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_10_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 29113.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_05_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 30899.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_06_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 30811.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_03_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 24970.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_07_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 39886.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_08_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 21797.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_08_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 21695.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_02_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 15715.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_03_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 23056.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_09_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 16666.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_02_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 12521.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_10_phonefixed.master_r1 | live_lambda | live_lambda | failed | 0.833 | 33037.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.july_breadth_birthday_08_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 22894.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_01_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 17453.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_03_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 21222.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_05_phonefixed.master_r1 | live_lambda | live_lambda | failed | 0.857 | 35241.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.july_breadth_birthday_06_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 38386.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_06_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 30939.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_01_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 18092.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_10_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 28443.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_01_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 18066.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_09_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 18206.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_02_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 13130.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_08_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 20528.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_05_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 33583.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_03_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 39084.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_07_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 43165.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_09_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 14255.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_04_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 36536.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_08_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 27202.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_07_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 49028.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_07_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 39335.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_07_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 39485.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_04_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 30953.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_06_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 29282.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_05_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 41924.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_05_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 26800.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_06_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 50160.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_04_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 37361.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_04_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 38955.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_01_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 20030.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_09_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 12113.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_02_phonefixed.master_r1 | live_lambda | live_lambda | passed | 1.000 | 13700.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_01_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 16853.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_05_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 25721.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_06_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 32991.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_08_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 19424.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_10_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 28855.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_03_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 25671.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_05_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 32605.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_05_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 56030.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_05_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 51166.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_01_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 27678.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_08_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 43754.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_09_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 21010.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_10_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 36918.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_07_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 63023.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_01_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 19961.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_06_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 44659.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_02_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 16020.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_08_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 26117.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_03_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 27361.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_09_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 23200.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_03_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 33048.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_07_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 61266.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_09_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 19470.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_01_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 22093.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_02_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 14805.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_08_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 26001.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_01_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 26205.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_10_phonefixed.master_r2 | live_lambda | live_lambda | failed | 0.833 | 43810.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.july_breadth_corporate_04_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 35189.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_10_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 24741.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_04_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 39268.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_09_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 13594.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_09_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 16936.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_07_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 41687.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_02_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 15521.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_02_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 15998.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_03_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 28566.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_06_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 30485.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_04_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 36569.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_04_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 34702.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_02_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 11772.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_08_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 24627.0 | — |
| live_behavior_regression | live_behavior.july_breadth_wedding_06_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 49496.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_07_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 46210.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_05_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 27589.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_06_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 32663.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_03_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 23348.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_07_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 46587.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_04_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 44249.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_10_phonefixed.master_r2 | live_lambda | live_lambda | passed | 1.000 | 30623.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_07_phonefixed.master_r3 | live_lambda | live_lambda | passed | 1.000 | 45422.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_02_phonefixed.master_r3 | live_lambda | live_lambda | passed | 1.000 | 13768.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_04_phonefixed.master_r3 | live_lambda | live_lambda | passed | 1.000 | 32868.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_01_phonefixed.master_r3 | live_lambda | live_lambda | passed | 1.000 | 17285.0 | — |
| live_behavior_regression | live_behavior.july_breadth_social_10_phonefixed.master_r3 | live_lambda | live_lambda | passed | 1.000 | 29844.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_09_phonefixed.master_r3 | live_lambda | live_lambda | passed | 1.000 | 13509.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_01_phonefixed.master_r3 | live_lambda | live_lambda | passed | 1.000 | 16399.0 | — |
| live_behavior_regression | live_behavior.july_breadth_birthday_10_phonefixed.master_r3 | live_lambda | live_lambda | failed | 0.833 | 34858.0 | product_fact_completeness |
| live_behavior_regression | live_behavior.july_breadth_social_05_phonefixed.master_r3 | live_lambda | live_lambda | passed | 1.000 | 33055.0 | — |
| live_behavior_regression | live_behavior.july_breadth_corporate_05_phonefixed.master_r3 | live_lambda | live_lambda | passed | 1.000 | 28775.0 | — |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_03_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_02_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_corporate_08_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_birthday_09_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_wedding_08_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_corporate_02_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_social_03_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_birthday_04_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_social_01_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_wedding_02_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_corporate_10_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_birthday_08_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_social_08_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_wedding_03_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_birthday_05_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_10_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_06_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_birthday_06_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_08_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_birthday_01_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_09_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_corporate_07_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_birthday_07_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_wedding_09_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_wedding_06_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_social_02_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_social_06_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_wedding_07_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_social_04_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_social_07_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_corporate_06_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_wedding_05_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_wedding_10_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_birthday_03_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_wedding_04_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_corporate_03_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_baby_shower_05_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_wedding_01_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_social_09_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
| live_behavior_regression | live_behavior.july_breadth_corporate_04_phonefixed.master_r3 | live_lambda | live_lambda | errored | 0.000 | 0.0 | infrastructure_error |
