# Recommendation Optimization: Iteration 3

Date: 2026-07-02

## Scope

Iteration 3 retained the hard event-service rule for event decoration but
returned ordinary must-have evidence to a ranking signal rather than treating
missing catalog text as proof of incompatibility. The frozen 50-scenario study
was executed three times against the deployed development Lambda.

## Evidence

| Metric | Iteration 1 | Iteration 2 | Iteration 3 |
| --- | ---: | ---: | ---: |
| Executed conversations | 150 | 150 | 150 |
| Location mismatch rate | 0.00% | 0.00% | 0.00% |
| Category satisfaction | 100.00% | 99.87% | 100.00% |
| Budget compatibility | 100.00% | 100.00% | 100.00% |
| Event-service evidence, `Hogar y deco` | 53.03% | 54.69% | 57.35% |
| Observed provider needs | 195 | 200 | 208 |
| Needs with recommendations | 168 | 166 | 167 |
| Need recommendation coverage | 86.15% | 83.00% | 80.29% |
| Displayed provider appearances | 796 | 763 | 790 |
| Unique displayed providers | 54 | 57 | 59 |
| Flaky-scenario rate | 8.00% | 6.00% | 0.00% |
| Timeout conversations | 0 | 1 | 0 |
| Conversation p95 latency | 26.42 s | 28.18 s | 27.30 s |
| Total priced cost | USD 1.081 | USD 1.055 | USD 1.065 |

## Interpretation

Iteration 3 improved the targeted event-service measure, restored perfect
category satisfaction, increased catalog breadth, and produced fully stable
outcomes across the three repetitions without a timeout.

The existing need-coverage ratio did not recover. Its denominator is the number
of needs present in each run's final extracted plan, which increased from 195
to 208, while the absolute count with recommendations remained effectively
flat. The metric therefore combines extraction breadth with retrieval coverage
and cannot establish that shortlist retrieval itself regressed by 5.86 points.
Both counts must be reported whenever this rate is cited.

## Decision

Use iteration 3 as the preferred semantic/reliability snapshot. Preserve
iteration 1 as the best observed final-plan need-coverage ratio. Do not spend
the fourth allowed full run without a new causal hypothesis and a denominator
that separates expected-need extraction from retrieval success.

Raw evidence:

- Iteration 1: `artifacts/technical-study-2026-07-02T04-41-32-379Z/`
- Iteration 2: `artifacts/technical-study-2026-07-02T05-39-57-869Z/`
- Iteration 3: `artifacts/technical-study-2026-07-02T06-40-49-761Z/`
