# Metric Expansion for Recommendation Optimization

## Principle

Optimization must not target strict scenario completion alone. The baseline
showed that a recommendation can be traceable to a real provider while still
being unsuitable. Each iteration therefore uses a metric portfolio with
guardrails: improve constraint satisfaction and need coverage without
regressing reliability, latency, cost, provenance, or catalog exposure.

This follows recommender-system evaluation guidance that practical utility is
multi-dimensional rather than reducible to prediction accuracy. RecSys work on
evaluation beyond RMSE explicitly highlights ranking quality, novelty, and
diversity; conversational work reports task completion together with turns to
completion; and recent explanation research measures feature hallucination in
addition to text quality.

## Added automated metrics

1. **Strict location satisfaction**: displayed providers whose location is an
   exact or hierarchical match to the requested location / all displayed
   providers with a location requirement.
2. **Location mismatch rate**: providers in a contradictory region or country /
   all displayed providers with a location requirement. Unknown-granularity
   locations are reported separately and never counted as exact.
3. **Category satisfaction**: providers whose canonical marketplace category
   matches the owning provider need / providers with a resolvable owning need.
4. **Budget compatibility**: providers without a structured `budget_risk` /
   providers shown when the plan contains a budget signal.
5. **Need recommendation coverage**: provider needs receiving at least one
   recommendation / all provider needs represented in final plans.
6. **Mean shortlist size**: detects empty results and uncontrolled candidate
   flooding.
7. **Catalog exposure**: number of unique exposed providers, top-provider
   exposure share, and Herfindahl-Hirschman concentration. These guard against
   improving precision by recommending the same few providers everywhere.
8. **Reliability and efficiency guardrails**: timeout rate, turn and
   conversation latency, calls, tokens, cache use, and priced cost.
9. **Explanation faithfulness sample**: provider existence, attribute
   faithfulness, rationale support, feature hallucination, and hard-constraint
   consistency.
10. **Conversational efficiency**: turns to first valid shortlist and turns to
    terminal action, reported only for scenarios where those outcomes are
    applicable.

## Iteration decision rule

An iteration is accepted only if it:

- reduces location mismatch and category mismatch;
- does not reduce required-shortlist production or event-type extraction by
  more than two percentage points;
- does not increase timeout rate;
- does not increase p95 latency or priced cost by more than 15% without a
  documented quality gain;
- does not increase top-provider exposure concentration by more than 20%; and
- has no new hard-constraint regression in targeted tests.

Strict scenario completion is reported, but it is not an optimization target
until the version-2 manifest uses canonical internal categories and valid route
envelopes.

## Research basis

- RecSys' evaluation workshop notes that users receive ranked item lists and
  that practical effectiveness requires ranking, novelty, diversity, and other
  dimensions beyond numeric prediction error:
  <https://recsys.acm.org/recsys12/rue/>.
- Amazon's conversational recommendation work reports task completion and
  turns to completion together, showing that dialogue efficiency is a material
  outcome rather than incidental telemetry:
  <https://recsys.acm.org/recsys21/session-6/>.
- CRS-Que extends the ResQue user-centric framework with conversational
  understanding and response-quality constructs; these remain future user-study
  measures rather than claims from simulated evaluation:
  <https://recsys.acm.org/recsys24/posters-3/>.
- RecSys 2024 explanation research introduces feature hallucination as a
  complement to explanation text quality:
  <https://recsys.acm.org/recsys24/accepted-contributions/>.
- FairMatch demonstrates why aggregate catalog exposure should be measured
  alongside relevance when post-processing recommendation lists:
  <https://arxiv.org/abs/2005.01148>.
