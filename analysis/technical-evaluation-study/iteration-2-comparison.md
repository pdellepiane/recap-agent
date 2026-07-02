# Recommendation Optimization: Iteration 2

Date: 2026-07-02

## Scope

Iteration 2 added semantic event-service evidence for `Hogar y deco`
sub-queries and used retrieval relevance to break equal structured-fit scores.
The frozen 50-scenario study was executed three times against the deployed
development Lambda.

## Evidence

| Metric | Baseline | Iteration 1 | Iteration 2 |
| --- | ---: | ---: | ---: |
| Executed conversations | 150 | 150 | 150 |
| Location mismatch rate | 4.11% | 0.00% | 0.00% |
| Strict location satisfaction | 30.13% | 86.91% | 86.02% |
| Category satisfaction | 96.23% | 100.00% | 99.87% |
| Budget compatibility | 100.00% | 100.00% | 100.00% |
| Need recommendation coverage | 84.58% | 86.15% | 83.00% |
| Event-service evidence, `Hogar y deco` | 18.83% | 53.03% | 54.69% |
| Unique displayed providers | 71 | 54 | 57 |
| Mean shortlist size | 7.75 | 3.52 | 3.39 |
| Flaky-scenario rate | — | 8.00% | 6.00% |
| Timeout conversations | 3 | 0 | 1 |
| Conversation p95 latency | 29.57 s | 26.42 s | 28.18 s |
| Total priced cost | USD 1.190 | USD 1.081 | USD 1.055 |

## Interpretation

The targeted semantic measure improved modestly from iteration 1, and a live
gate confirmed that event-oriented catalog evidence retained Nina Creativa
while excluding a generic furniture provider. The iteration also broadened
unique provider exposure and reduced measured flakiness and cost.

The result is not a general quality improvement. Need recommendation coverage
fell by 3.15 percentage points, strict location satisfaction fell by 0.89
points because more locations remained unknown, one category mismatch appeared,
and one conversation timed out. The strict frozen completion rate remains
unsuitable for a general success claim because the manifest contains audited
noncanonical need labels and overly narrow route expectations.

## Decision

Keep commit `85cbc70` as a reproducible iteration-2 snapshot. Any subsequent
optimization must recover need coverage and preserve the hard safeguards:
zero known location mismatches, near-perfect category fit, full budget
compatibility, and at least the iteration-2 event-service evidence rate.

Raw evidence:

- Baseline: `artifacts/technical-study-2026-07-02T00-51-03-191Z/`
- Iteration 1: `artifacts/technical-study-2026-07-02T04-41-32-379Z/`
- Iteration 2: `artifacts/technical-study-2026-07-02T05-39-57-869Z/`
