# Technical Evaluation Findings

## Executive summary

The frozen study attempted 150 conversations (50 scenarios repeated three
times) against the deployed development Lambda and captured 265 of 270 planned
turns. The service returned complete structured evidence for 147 conversations;
three conversations reached the Lambda's 90-second timeout and returned HTTP
502 responses. No conversation required
manual operator intervention and no timeout occurred.

The strict pre-registered completion rule passed 43 of 150 conversations
(28.7%, 95% Wilson CI 22.0%-36.4%). This number must **not** be presented as the
agent's general success rate: the post-run audit found that several hard
expectations used non-canonical provider-need labels (`Local` versus `Locales`,
for example) and that some route expectations were narrower than valid runtime
behavior. The raw value remains preserved as a protocol result. More reliable
component metrics are reported separately below.

The clearest positive results were event-type extraction (143/150, 95.3%),
shortlist production when required (44/45, 97.8%), conversation-level
persistence expectations (145/150, 96.7%), token telemetry availability
(150/150), and FAQ scenarios (15/15 strict completions). The clearest functional
risks were location filtering, provider-category fit, incomplete multi-need
coverage, pause/resume terminal behavior, and three transient HTTP 502 errors.

## Study population and outcomes

- Distinct scenarios: 50.
- Repetitions: 3.
- Attempted conversations: 150.
- Planned turns: 270; captured turns: 265.
- Strict completions: 43 (28.7%).
- Failed assertions: 104 (69.3%).
- Runtime errors other than timeout: 0.
- Lambda timeouts: 3 (2.0%).
- Manual interventions: 0.
- Unique observed outer conversation routes: 17.
- Stable strict completions across all three repetitions: 13 scenarios.
- Stable strict failures: 32 scenarios.
- Flaky scenarios: 5/50 (10.0%).

All 15 FAQ executions completed under the strict rule. Pause/resume and
error-recovery families recorded 0/15 strict completions, although the low
aggregate must be interpreted together with the route-expectation limitations.

By event group, birthday and social-event scenarios each recorded 17/30 strict
completions. Wedding, baby-shower, and corporate groups each recorded 3/30,
with three 90-second Lambda timeouts appearing in the third repetition: one
wedding and two baby-shower cases. CloudWatch `REPORT` records confirmed
`Status: timeout` for all three failed requests.

## Functional measurements

| Measurement | Passed | Total | Rate |
| --- | ---: | ---: | ---: |
| Event type persisted correctly | 143 | 150 | 95.3% |
| Required shortlist produced | 44 | 45 | 97.8% |
| Persistence expectation | 145 | 150 | 96.7% |
| Declared terminal node reached | 95 | 150 | 63.3% |
| Expected node present in evaluated turn | 107 | 150 | 71.3% |
| Search-ready expectation (soft) | 97 | 150 | 64.7% |
| Token usage present | 150 | 150 | 100.0% |
| Turn budget respected | 150 | 150 | 100.0% |

Provider-need expectation rates ranged from 0% to 53.3%. These are not suitable
as extraction-quality estimates because the frozen manifest mixed user-facing
need labels with internal marketplace category labels. The mismatch is a
protocol defect and should be corrected in a version-2 corpus before a new
completion-rate claim is made.

## Architecture and telemetry

| Measurement | Result |
| --- | ---: |
| Mean conversation latency | 17.84 s |
| Median conversation latency | 17.07 s |
| Conversation p95 latency | 29.57 s |
| Mean turn runtime latency | 9.61 s |
| Median turn runtime latency | 10.02 s |
| Turn p95 runtime latency | 15.26 s |
| Extractor model calls | 265 |
| Reply model calls | 265 |
| Total LLM calls | 530 |
| Recorded tool calls | 333 |
| Mean tool calls per turn | 1.26 |
| Total tokens | 5,139,265 |
| Input tokens | 4,956,433 |
| Output tokens | 182,832 |
| Cached input tokens | 4,085,248 |
| Weighted input cache hit rate | 82.4% |
| Persisted turns | 262/265 (98.9%) |
| Estimated OpenAI + Lambda cost | USD 1.19 |
| Mean priced cost per conversation | USD 0.0079 |
| p95 priced cost per conversation | USD 0.0149 |

The recorded tools were: provider plan search (142), query-intent search (57),
provider detail (57), provider reviews (40), FAQ file search (15), finish-plan
(14), related providers (7), and category listing (1). These are tool
invocations, not a guarantee of one HTTP request per call; internal marketplace
calls remain intentionally unpriced.

## Workflow coverage

- Observed decision nodes: 18/26 (69.2%).
- Observed registered transitions: 35/49 (71.4%).
- Most visited nodes: `recomendar` (211), `minimos_para_buscar` (148),
  `contacto_inicial` (147), `deteccion_intencion` (147),
  `buscar_proveedores` (142), `busqueda_exitosa` (142), and
  `hay_resultados` (142).
- The most frequent outer route was
  `contacto_inicial->recomendar` (41 conversations).

The corpus did not exercise all authentication, explicit retry, terminal
success, and invited-event branches. Node and transition coverage therefore
describe this provider-planning study rather than total application coverage.

## Grounding

The full-population deterministic check classified 245 turns as requiring
external grounding and verified structured provenance for all 245. This means
that provider identifiers and the compared structured category/location fields
were traceable to captured evidence; it does not mean that every generated
sentence was faithful.

A single-auditor stratified review of 20 recommendation-related turns found:

| Manual dimension | Passed | Applicable | Rate |
| --- | ---: | ---: | ---: |
| Provider existence | 20 | 20 | 100.0% |
| Attribute faithfulness | 18 | 20 | 90.0% |
| Rationale support | 13 | 16 | 81.3% |
| Hard-constraint consistency | 7 | 20 | 35.0% |
| Fully grounded and constraint-consistent | 7 | 20 | 35.0% |

The dominant issue was not invented provider identity. It was recommending
real providers that did not satisfy location or service-category constraints.
Examples included venues in Ica or Mexico for Lima/San Isidro requests and
home/interior-design vendors used as event-decoration substitutes. The agent
often disclosed these mismatches, which improves transparency but does not make
the recommendation constraint-consistent. The audit also found unsupported
style claims in photography rationales and one provider-name rendering error.

## Defensible claims

The current evidence supports the following statements:

1. The deployed architecture executed 147/150 conversations without an HTTP
   failure and emitted typed token telemetry for every attempted case result.
2. Event type was persisted correctly in 95.3% of the frozen executions.
3. A non-empty shortlist was produced in 97.8% of scenarios that explicitly
   required one.
4. Runtime turn persistence was recorded in 98.9% of captured turns.
5. The system's recommendation identities were fully traceable to structured
   provider evidence in this run.
6. Traceable provider identity did not ensure recommendation suitability:
   only 35% of the manually reviewed sample satisfied all evaluated constraints.
7. The study observed 18 of 26 workflow nodes and 35 of 49 registered
   transitions.
8. Mean priced model/Lambda cost was approximately USD 0.0079 per conversation
   under the dated pricing assumptions.

The evidence does **not** support claims about user satisfaction, conversion,
superiority to marketplace browsing, or an overall 96% grounded-answer rate.

## Priorities before publication

1. Make location and provider-category compatibility hard filters before
   shortlist presentation.
2. Separate event-service decoration from home/interior retail categories.
3. Preserve multiple requested needs through retrieval and report uncovered
   needs explicitly.
4. Correct the version-2 evaluation manifest to use canonical internal category
   values and broaden valid route envelopes without changing terminal intent.
5. Investigate the three 90-second Lambda timeouts and add bounded retry
   telemetry.
6. Repeat the frozen study after fixes, then add a baseline and user study only
   if comparative effectiveness claims are required.

## Artifact map

- `summary.json`: machine-readable aggregate.
- `conversations.csv`: one row per attempted conversation.
- `turn-telemetry.csv`: per-turn model, latency, token, cache, tool, and
  persistence measurements.
- `grounding.csv`: deterministic grounding classification for all captured
  turns.
- `manual-grounding-audit.csv`: completed 20-turn manual audit.
- `manual-grounding-audit-summary.json`: audit rates and limitations.
- `node-visits.csv` and `routes.csv`: workflow distributions.
- `runs/`: immutable per-repetition reports and case artifacts.
- SVG files: publication-ready charts generated from the same aggregate data.
