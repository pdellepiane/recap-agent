# Complete Metrics, Definitions, and Results

## 1. Study design

The final evaluation used 50 frozen Spanish-language scenarios. Each scenario
was executed three times with an isolated identity against the deployed
development Lambda, producing 150 live conversations.

The manifest contains five event groups with ten distinct scenarios each:
weddings, birthdays, baby showers, corporate events, and other social events.
It also contains ten route families: recommendation, clarification,
multi-need planning, refinement, selection, pause/resume, closure, FAQ,
no-results, and error recovery.

A conversation counted as completed only when all hard typed expectations and
the scenario terminal criterion passed. Receiving an HTTP response alone was
not sufficient.

## 2. Functional outcomes

| Metric | Result | What it measures | How it was measured | Meaning |
| --- | ---: | --- | --- | --- |
| Executed conversations | 150/150 | Whether the entire planned study ran | Count of immutable conversation artifacts | The planned sample was fully executed |
| Distinct scenarios | 50 | Breadth of test cases | Unique stable scenario IDs in V4 | Each scenario was repeated three times |
| Completed conversations | 133/150 | Full technical task success | Every hard assertion and terminal criterion passed | 88.67% of runs satisfied the complete typed contract |
| Completion rate | 88.67% | Proportion of complete runs | `133 / 150` | Strong overall functional result |
| Completion 95% CI | 82.60%–92.80% | Statistical uncertainty around completion | Wilson binomial interval | Expected population performance is plausibly within this range under comparable conditions |
| Failed assertions | 17/150 | Runs that executed but violated a hard expectation | Harness outcome classification | These were behavioral/contract failures, not infrastructure crashes |
| Runtime errors | 0/150 | Unhandled runtime or target failures | Error-classified run outcomes | No operational execution failure occurred |
| Timeouts | 0/150 | Conversations exceeding the configured timeout | Timeout-classified outcomes | No conversation timed out |
| Manual interventions | 0/150 | Runs requiring a person to continue | Outcome classification | The study executed autonomously |

### Outcomes by event group

| Event group | Completed | Total | Rate |
| --- | ---: | ---: | ---: |
| Wedding | 28 | 30 | 93.33% |
| Birthday | 25 | 30 | 83.33% |
| Baby shower | 27 | 30 | 90.00% |
| Corporate | 26 | 30 | 86.67% |
| Social | 27 | 30 | 90.00% |

### Outcomes by route family

| Route family | Completed | Total | Rate | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Recommendation | 15 | 15 | 100% | Direct recommendation paths were reliable |
| Clarification | 15 | 15 | 100% | Missing-data elicitation behaved as expected |
| Multi-need | 15 | 15 | 100% | Multi-provider event-plan paths passed |
| Refinement | 15 | 15 | 100% | Criteria updates passed |
| Selection | 14 | 15 | 93.33% | One persistence assertion failed |
| Pause/resume | 3 | 15 | 20.00% | Primary functional weakness; 12 of all 17 failures |
| Closure | 15 | 15 | 100% | Lead/closure paths passed |
| FAQ | 15 | 15 | 100% | FAQ routes passed |
| No-results | 14 | 15 | 93.33% | One run failed |
| Error recovery | 12 | 15 | 80.00% | Three runs failed |

## 3. Typed expectation results

| Assertion | Passed | Applicable | Rate | Meaning |
| --- | ---: | ---: | ---: | --- |
| Required node path | 138 | 150 | 92.00% | Required workflow nodes appeared |
| Terminal transition | 137 | 150 | 91.33% | Conversation ended through an allowed typed transition |
| Persistence | 149 | 150 | 99.33% | Plan persistence telemetry matched the expectation |
| Search state | 114 | 150 | 76.00% | Search readiness matched the scenario's expected state; this was a soft assertion |
| Shortlist produced | 48 | 48 | 100% | Every scenario requiring provider results obtained at least one |
| Event type | 148 | 150 | 98.67% | Final typed event classification matched |
| Primary need | 129 | 132 | 97.73% | First expected canonical need was present |
| Second need | 15 | 15 | 100% | Second expected need was present when applicable |
| Third need | 12 | 12 | 100% | Third expected need was present when applicable |
| Fourth need | 3 | 3 | 100% | Fourth expected need was present when applicable |
| Token telemetry | 150 | 150 | 100% | Required extraction/reply token fields were recorded |
| Turn budget | 150 | 150 | 100% | Every conversation stayed within its maximum-turn contract |

`Search state` is not equivalent to task completion. It checks whether the
final trace's `search_ready` field matched the expected boolean and is retained
as a diagnostic soft metric.

## 4. Repeatability

| Metric | Result | Definition | Meaning |
| --- | ---: | --- | --- |
| Stable completed scenarios | 42/50 | Completed in all three repetitions | 84% of scenarios succeeded consistently |
| Stable failed scenarios | 4/50 | Failed in all three repetitions | Four systematic failure cases |
| Flaky scenarios | 4/50 | Outcome differed across repetitions | 8% scenario-level flakiness |
| Flaky rate | 8.00% | `4 / 50` | Some LLM-dependent behavior remains nondeterministic |

Stable failed scenarios were `study.birthday.10`,
`study.baby_shower.06`, `study.corporate.06`, and `study.social.06`.
Flaky scenarios were `study.wedding.06`, `study.wedding.09`,
`study.birthday.06`, and `study.corporate.05`.

## 5. Expected-need recommendation funnel

These are the most important recommendation-system metrics because they
separate understanding from retrieval.

| Metric | Numerator/denominator | Rate | What it means |
| --- | ---: | ---: | --- |
| Expected-need extraction recall | 159/162 | 98.15% | The typed plan contained the canonical provider need expected by the manifest |
| Retrieval coverage given extraction | 111/159 | 69.81% | A correctly extracted need later received at least one recommendation |
| End-to-end expected-need coverage | 111/162 | 68.52% | An expected need was both extracted and recommended |
| Unexpected extracted needs | 42 | — | Canonical needs appeared that were not listed as expected for their scenarios |
| Observed-need recommendation coverage | 130/201 | 64.68% | Any observed typed need—not only manifest-expected needs—received recommendations |

Formulas:

```text
extraction recall =
  expected needs found in typed plans / expected needs

retrieval coverage given extraction =
  extracted expected needs with recommendations / extracted expected needs

end-to-end coverage =
  extracted expected needs with recommendations / all expected needs
```

Interpretation: extraction is strong, while retrieval coverage is materially
lower. The system's main remaining limitation is obtaining suitable providers
for every understood need, not identifying what the event requires.

## 6. Recommendation quality and grounding

### Deterministic provider checks

| Metric | Result | What it measured | Method |
| --- | ---: | --- | --- |
| Displayed provider appearances | 704 | Total provider cards/rows shown | Count across recommendation traces |
| Unique providers | 21 | Catalog diversity in displayed results | Unique provider IDs |
| Mean shortlist size | 4.19 | Average providers per recommendation turn | Displayed appearances divided across recommendation lists |
| Category consistency | 704/704 (100%) | Provider's canonical category matched the active need | Deterministic category comparison |
| Known location satisfaction | 632/704 (89.77%) | Catalog location was compatible with requested location | Typed location classifier |
| Unknown location | 72/704 (10.23%) | Catalog evidence was insufficient to establish exact compatibility | Missing/broad location classification |
| Known location mismatch | 0/704 (0%) | Catalog location contradicted requested location | Typed location classifier |
| Budget compatibility | 124/124 (100%) | Applicable structured price tier did not conflict with budget rules | Deterministic budget-tier comparison |
| Event-service evidence | 10/10 (100%) | Applicable decoration/service recommendations had event-oriented evidence | Description, services, terms, and provider-note evidence |
| Grounding provenance | 180/180 turns (100%) | Grounding-required turns had captured external evidence | Provider IDs and tool outputs in typed traces |

Location's `89.77% strict satisfaction` must be read with the 10.23% unknown
share. Unknown does not mean mismatch, but it also does not prove exact
compatibility.

### Exposure concentration

| Metric | Result | Meaning |
| --- | ---: | --- |
| Top-provider share | 10.23% | The most displayed provider represented about one tenth of appearances |
| Herfindahl-Hirschman Index | 0.0604 | Exposure was distributed, although only 21 unique providers appeared |

The HHI is the sum of squared provider exposure shares. Lower values represent
less concentration. It should be interpreted together with the unique-provider
count and catalog size.

### Independent historical grounding audit

| Dimension | Result | What it measured |
| --- | ---: | --- |
| Provider existence | 20/20 | Every named provider existed in captured evidence |
| Attribute faithfulness | 15/20 | Category, location, price, promotion, and service claims agreed with evidence |
| Rationale support | 1/10 applicable | Every stated reason for fit was supported |
| Hard-constraint consistency | 11/20 | The response did not contradict location, category, budget, or exclusions |
| Fully grounded recommendation turns | 1/10 | Every applicable audit dimension passed |

This was a blinded audit of iteration-3 responses, not the final V4 study.
It identified problems that informed later fixes. It must be reported as
historical development evidence, not as the final study's manual-grounding
rate.

Inter-reviewer agreement with the primary audit was 20/20 for provider
existence, 16/20 for attribute faithfulness, 17/20 for rationale support, and
17/20 for hard-constraint consistency.

## 7. Workflow coverage

| Metric | Result | Definition |
| --- | ---: | --- |
| Declared decision nodes | 26 | Versioned workflow denominator |
| Observed nodes | 18 | Unique decision nodes appearing in traces |
| Node coverage | 69.23% | `18 / 26` |
| Reachable transition registry | 49 | Versioned reachable-transition denominator |
| Observed registered transitions | 32 | Unique observed transitions present in registry |
| Transition coverage | 65.31% | `32 / 49` |
| Unique complete observed routes | 17 | Distinct transition sequences across conversations |

Coverage is structural testing breadth, not correctness. A node or transition
is covered when observed at least once, regardless of whether the conversation
ultimately passed.

## 8. Architecture and performance

### Conversation latency

| Statistic | Result |
| --- | ---: |
| Mean | 16.61 s |
| Median | 16.55 s |
| p95 | 26.29 s |
| Minimum | 5.04 s |
| Maximum | 35.37 s |

Latency is end-to-end elapsed time for a complete simulated conversation. p95
is the nearest-rank 95th percentile: 95% of conversations completed at or below
approximately 26.29 seconds.

### Latency by final node

| Node | Visits | Mean | p95 |
| --- | ---: | ---: | ---: |
| `recomendar` | 87 | 11.47 s | 15.79 s |
| `aclarar_pedir_faltante` | 49 | 6.54 s | 8.78 s |
| `elicitacion_necesidades` | 19 | 15.21 s | 19.77 s |
| `seguir_refinando_guardar_plan` | 38 | 6.53 s | 9.60 s |
| `guardar_cerrar_temporalmente` | 15 | 6.01 s | 14.75 s |
| `crear_lead_cerrar` | 15 | 6.77 s | 8.37 s |
| `consultar_faq` | 15 | 7.59 s | 8.46 s |
| `refinar_criterios` | 15 | 10.98 s | 13.07 s |
| `entrevista` | 17 | 9.78 s | 12.33 s |

This table assigns each turn's observed latency to its resulting node. It
describes where time was spent operationally; it does not establish that the
node alone caused the latency.

### Token consumption

| Statistic | Tokens per conversation |
| --- | ---: |
| Mean | 34,268.63 |
| Median | 33,953 |
| p95 | 64,037 |
| Minimum | 16,084 |
| Maximum | 71,954 |

Tokens include typed extraction and reply generation input/output usage as
reported by the model API. Cached input tokens remain represented in detailed
turn telemetry and are priced using the cached-input rate.

### Tool calls

| Statistic | Calls per conversation |
| --- | ---: |
| Mean | 1.61 |
| Median | 1 |
| p95 | 5 |
| Minimum | 0 |
| Maximum | 8 |

Tool calls include captured marketplace, vector-search, knowledge, persistence,
and other instrumented external operations. Detailed breakdowns are in
`turn-telemetry.csv` and the tool charts.

### Cost

| Statistic | Priced cost per conversation |
| --- | ---: |
| Mean | $0.007028 |
| Median | $0.006056 |
| p95 | $0.013716 |
| Minimum | $0.002094 |
| Maximum | $0.017880 |
| Total study | $1.054143 |

Cost combines estimated OpenAI token charges and AWS Lambda execution using
the dated `pricing-2026-07-01.json` configuration. Internal marketplace APIs
without an official unit price are reported as call counts and are not assigned
an invented cost.

## 9. Failure concentration

Seventeen conversations failed hard assertions:

- pause/resume: 12;
- error recovery: 3;
- selection: 1;
- no-results: 1.

Pause/resume therefore accounts for 70.59% of failed conversations. Several
incomplete plans resumed to clarification instead of the manifest's expected
generic resume endpoint. These results are preserved without post-hoc
regrading.

## 10. What may and may not be claimed

Supported:

- strong live technical completion under the frozen scenario protocol;
- zero runtime errors and timeouts in 150 runs;
- high structured need extraction;
- perfect observed canonical category consistency;
- no known location mismatch among displayed providers;
- low per-conversation priced infrastructure/model cost;
- retrieval coverage as the main measured limitation.

Not supported:

- user satisfaction or usability;
- superiority over another commercial recommender;
- causal claims from non-randomized engineering ablations;
- a claim that all final free-text rationales were manually verified;
- generalization outside the tested Spanish event-planning scenarios and live
  marketplace snapshot.

