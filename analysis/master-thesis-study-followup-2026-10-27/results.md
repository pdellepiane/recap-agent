# Follow-up results — 27 October 2026

Run `eval-2026-10-27T22-19-42-463Z-78589b85` finished with the frozen development deployment unchanged. All 108 conversations were attempted: 100 passed every hard assertion, five failed, and three errored; none were skipped. The errored cases ended before their first completed turn, so 228 of 237 planned turns were observed. They remain in the primary denominator. Original reports, case traces and checksums are retained in `artifacts/`, and the frozen schedule and inputs are recorded in `frozen-master.json`.

| Stratum | Passed / scheduled |
| --- | ---: |
| Provider | 36 / 36 |
| FAQ and customer service | 33 / 36 |
| Continuity, authentication and effects | 31 / 36 |
| Overall | 100 / 108 (92.6%) |

Thirty-three of 36 scenarios passed all three repetitions, one was mixed, and two had no passing repetitions. The prespecified scenario-cluster bootstrap interval is 83.3%–100.0%, reflecting sensitivity to the designed scenario set, not a confidence interval for real customers.

The eight nonpassing conversations were:

* **OTP number words:** 0/3. All three returned HTTP 500 with `Invalid output type: final assistant output did not match the expected schema` before a completed turn was recorded. The report classifies them as errors; the retained evidence does not establish the underlying cause. No OTP verification should be inferred from the missing traces.
* **Provider quote completion:** 1/3. In two conversations `finish_plan` and the expected per-provider/date receipts were absent; the responses stated that the quotes had not been sent. One conversation met both receipt assertions. These are simulated writes.
* **FAQ calculator:** 0/3 failed the exact Spanish-path text assertion. The retained diagnostics redact the generated link, so the observable artifact alone does not establish which URL was sent or whether it was useful. Earlier recovered responses in the first study used a source-listed English path in two cases; that does not prove the follow-up did. Do not regrade these results without verified delivered-text evidence.

All three repetitions of the multi-need public-provider scenario, support-contact link, protected-request refusal, repeated RSVP case, mixed-gift follow-up and question after takeover met their objective assertions. This is bounded scenario evidence, not proof that the underlying problems are eliminated in all conversations. The provider stratum includes 24 live public-read and 12 controlled-fixture conversations. Customer reads and all SE effects were mocked. Across the run, 81 automatically detected provider URL spans matched a same-turn retained provider trace; this checks those URLs only and does not establish that other response claims are correct.

The harness estimates $0.174678 in OpenAI usage and $0.029301 in Lambda cost, $0.203979 total, using its dated rate table. This is an estimate, not an invoice. The three HTTP-500 cases produced no completed-turn token telemetry; model usage associated with those errors may not be included. Median conversation latency was 11.73 seconds and the 95th percentile was 41.76 seconds.

The earlier current-system study reported 70/90, but it used different scenario and fixture definitions and an earlier implementation. This follow-up is post-fix and expanded, so the difference is descriptive, not a controlled causal improvement. July V4 remains separate. These designed cases do not measure user satisfaction, naturalness, business impact or complete factual faithfulness; human evaluation remains future work.
