# Methodology

## Experimental unit

The experimental unit is one isolated conversation against the development
Lambda. The corpus contains 50 distinct scenarios, with ten scenarios in each
of five event groups: wedding, birthday, baby shower, corporate, and other
social events. Each scenario is repeated three times with a new external user
identifier, yielding 150 conversations.

## Outcome classification

- `completed`: all hard expectations pass and the final node belongs to the
  scenario's declared terminal-node set.
- `failed_assertion`: the Lambda responds, but a hard expectation or terminal
  condition fails.
- `runtime_error`: execution fails for a reason other than the configured
  timeout.
- `timeout`: a turn exceeds 95 seconds or is aborted by the HTTP client.
- `manual_intervention`: reserved for an explicitly recorded operator action;
  it is never inferred from a model response.

Completion rate uses all attempted conversations as its denominator and is
reported with a two-sided 95% Wilson score interval.

## Functional and workflow metrics

Node coverage is the number of unique observed decision nodes divided by the 26
nodes declared in `src/core/decision-nodes.ts`. Transition coverage uses the
versioned reachable-transition registry embedded in the study generator.
Distinct observed routes are complete ordered transition sequences, while route
families are the ten protocol categories in the frozen manifest.

Expectation pass rates are derived from structured plans and traces. Exact
assistant wording is not used to determine flow success.

## Architecture metrics

Latency is measured per turn at the HTTP client and from runtime component
timings. Token usage comes from the model response metadata. Cache hit rate is
cached input tokens divided by input tokens. Model cost uses the dated price
file and prices cached and uncached input separately. Lambda cost uses measured
duration and the configured 1 GB memory allocation. Internal marketplace calls
are counted but are not assigned an invented monetary cost.

## Grounding

Recommendation turns require every presented provider ID to have structured
candidate provenance. Category and location are checked when both the result
and evidence contain the attribute. FAQ turns require a recorded knowledge-base
search with at least one result. Orchestration and action-confirmation turns
are reported separately because external grounding is not inherently required.

Deterministic verification does not establish that every phrase in a generated
rationale follows from the evidence. A stratified manual sample is therefore
produced for review with the companion rubric.
