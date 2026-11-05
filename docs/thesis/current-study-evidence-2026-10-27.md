# Current Recap Agent technical evaluation: thesis evidence handoff

This document identifies the 27 October 2026 follow-up as the primary available automated study of the current development implementation. It does not overwrite, pool, or retroactively revise the July V4 results. July remains an earlier and broader provider-scenario study; its protocol and results answer questions about the July artifact, not the October artifact.

## Study and artifact

The follow-up tested development Lambda artifact `1fPqh+TphFEzVMMnyfXz6I2Emsw1u8Ej0gPl9sgbqzg=` (ZIP SHA-256 `d5f3ea87e4e984513354c327c9f5f3e88d849acc35bbc123d203e5f6c81bab38`). The deployment code and configuration identities matched before and after the run. The frozen protocol specifies 36 designed scenarios, three isolated repetitions each, 108 scheduled conversations, and 531 objective hard assertions. There was no semantic judge. Twenty-four provider conversations used live public provider reads; the other twelve in that stratum used controlled fixtures. Private customer data and SE mutations were mocked. Public FAQ retrieval used the development knowledge base. Live provider catalog data is not a fixed snapshot and may change.

Source: [`frozen-master.json`](../../analysis/master-thesis-study-followup-2026-10-27/frozen-master.json), [`master-summary.json`](../../analysis/master-thesis-study-followup-2026-10-27/master-summary.json), and [`results.md`](../../analysis/master-thesis-study-followup-2026-10-27/results.md). Raw reports and case artifacts, with checksums, are retained under [`artifacts`](../../analysis/master-thesis-study-followup-2026-10-27/artifacts/).

## Observed outcomes

| Predefined stratum | Passes | Scheduled conversations |
| --- | ---: | ---: |
| Provider | 36 | 36 |
| FAQ and customer service | 33 | 36 |
| Continuity, authentication and effects | 31 | 36 |
| Overall | 100 | 108 |

Five conversations failed and three errored; none were skipped. All 108 were attempted, but the three errors ended before their first completed turn, so 228 of 237 scripted turns were observed. Thirty-three scenarios passed all three repetitions, one was mixed, and two had no passing repetitions. The prespecified stratified scenario-cluster bootstrap interval is 83.3%–100.0% around the 92.6% observed conversation pass rate. This describes sensitivity to the designed benchmark, not a randomly sampled user population.

The three errors occurred in the OTP number-word scenario and reported HTTP 500 and a final-output-schema error. The user subsequently judged OTP out of scope; the prespecified primary result remains 100/108. A separately labeled, post-hoc descriptive view excluding these three OTP conversations is 100/105; it retains all other original failures. Two quote-completion conversations failed to produce the required simulated provider receipts; one passed. Three calculator-link checks failed against the original exact Spanish-path oracle, with the delivered URL obscured by diagnostics. These results remain unchanged.

A later targeted run tested a source-published calculator URL with updated diagnostic visibility: 3/3 passed without recorded customer-side effects. This is a separate artifact and a narrower validation, not a replacement of the three master outcomes. See [`targeted calculator protocol and result`](../../analysis/targeted-calculator-followup-2026-10-27/protocol.md).

The harness estimated $0.203979 in model and Lambda cost, not an invoice. Usage from errored turns may be missing. Median conversation latency was 11.73 seconds and the 95th percentile 41.76 seconds. The check detected 81 delivered provider URL spans, all matched to a same-turn provider trace; this checks those URLs only, not all provider statements, attributes, prices, or the factual correctness of prose.

## Writing and claim boundaries

A defensible main claim is: the identified development artifact met all specified hard obligations in 100 of 108 synthetic conversations in the declared automated benchmark, with results and errors varying across scenarios. If OTP is excluded as a later scope decision, explicitly label 100/105 post hoc and retain the prespecified 100/108 alongside it. Separately state the 3/3 targeted calculator result and its different code/configuration identity.

The benchmark does not establish satisfaction, naturalness, business impact, comprehensive factual faithfulness, or a causal improvement over July. Its failure-sensitive assertions are not interchangeable with July's historical assertions. A planned human study is future work, not a precondition for reporting this technical benchmark.

## July coverage that is not replaced by the current study

July V4 used 50 scenarios, 150 conversations and five event groups (wedding, birthday, baby shower, corporate and other social events), organized over ten route families. It retained recommendation-need extraction/coverage and structured category, budget and location analyses. The October provider stratum is smaller and focuses substantially on wedding cases, with birthday fixture cases and other scoped tasks. It cannot by itself reproduce July's five-event-group breadth or its need-level metrics. Historical candidate records and actual delivered provider mentions are distinct quantities; July's 704 provider appearances are trace records, not validated response mentions. See [`inventory and comparison`](../../analysis/automated-thesis-study-options/findings.md) and [`July methodology`](../../analysis/technical-evaluation-study/methodology.md).

Do not describe replacing July as a broader like-for-like replication unless a separately identified current-artifact study actually tests those missing populations and outcomes. Keep all existing raw results and prior thesis-evidence handoff intact.
