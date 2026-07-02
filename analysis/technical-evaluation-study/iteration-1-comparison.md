# Iteration 1 Comparison

## Decision

Accept iteration 1 as a substantive recommendation-quality improvement and keep
it as rollback snapshot `2613b9f`. Do not treat raw strict completion as an
optimization target until the manifest category/route defects are corrected.

## Baseline versus iteration 1

| Metric | Baseline | Iteration 1 | Direction |
| --- | ---: | ---: | --- |
| Contradictory-location rate | 4.1% | 0.0% | Improved |
| Strict verified-location satisfaction | 30.1% | 86.9% | Improved |
| Canonical category satisfaction | 96.2% | 100.0% | Improved |
| Provider-need recommendation coverage | 84.6% | 86.2% | Improved |
| Required-shortlist expectation | 97.8% | 100.0% | Improved |
| Event-type persistence | 95.3% | 95.3% | Stable |
| Timeouts | 3 | 0 | Improved |
| Conversation p95 latency | 29.57 s | 26.42 s | Improved |
| Total priced cost | USD 1.19 | USD 1.08 | Improved |
| Mean shortlist size | 7.75 | 3.52 | More selective |
| Unique providers exposed | 71 | 54 | Reduced |
| Top-provider exposure share | 4.1% | 9.5% | Increased concentration |
| Strict protocol completion | 28.7% | 23.3% | Not interpretable |

## Interpretation

The top provider appeared 74 times in the baseline and 76 times in iteration 1.
The exposure share rose mainly because invalid providers were removed from the
denominator, not because one provider suddenly displaced the catalog. Padding
lists with unknown or mismatched providers would improve the concentration
ratio while harming users, so iteration 2 must pursue semantic service fit and
quality-aware tie breaking instead.

The remaining automated metrics cannot distinguish event-service decoration
from home/interior retail when both use the canonical `Hogar y deco` category.
Iteration 2 therefore targets evidence that a provider actually serves events,
plus stronger enforcement of structured `mustHave` evidence.
