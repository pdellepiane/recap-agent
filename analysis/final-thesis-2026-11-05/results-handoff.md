# Technical results handoff — 5 November 2026

This is an evidence and interpretation note, not thesis prose. The writing agent should inspect the linked raw reports and protocol before drafting. Run `eval-2026-11-05T16-01-27-136Z-2eace95d`, study `final-thesis-2026-11-05`: one execution from 16:01:27 to 17:54:50 UTC, 87 deliberately selected scenarios × three repetitions, 261/261 observed, 510/510 scripted turns. The deployed development artifact and configuration were unchanged across execution (CodeSha256 `9T2zBS+ZO1CkCGU8rTb52kAeOrYOuyfijNfpdcZPvgs=`). No semantic judge; assertions are predeclared objective checks. Private customer reads and SE effects were fixture-backed; designated public provider reads were live. Five no-result scenarios use empty fixtures and do not prove the live catalog has no matches. OTP-specific cases were excluded before freezing.

## First-level outcomes

253/261 conversations passed all hard assertions (96.93%); 8 failed, 0 errored, 0 skipped. 81/87 scenarios passed all three repetitions; 6 had mixed outcomes. Scenario-cluster bootstrap, 10,000 resamples with seed 27102650: 94.25%–99.23%. This describes sensitivity to these designed scenarios; it is not a confidence interval for real customers or independent samples of users. The study is regression-informed, not held out.

| Prespecified stratum | Passes / scheduled |
|---|---:|
| Provider | 42/45 |
| FAQ/customer service | 36/36 |
| Continuity/authentication/effects | 30/30 |
| July-derived wedding | 30/30 |
| July-derived birthday | 27/30 |
| July-derived baby shower | 28/30 |
| July-derived corporate | 30/30 |
| July-derived social | 30/30 |

FAQ 36/36 means only that all specified assertions for those cases passed: it is not a comprehensive semantic assessment of FAQ answers. Likewise route labels identify scenario intentions, not exhaustive verification of each capability. Do not pool or compare scores causally with the historical July V4 study or the earlier 244/252 reconstructed three-phase study. This final run's July-derived cases are new executions against a changed artifact and include corrected synthetic contact phones.

## Eight failed conversations

- `july_breadth_baby_shower_06_phonefixed` repetitions 1 and 2: requested provider needs not retained.
- `july_breadth_birthday_10_phonefixed` repetitions 1 and 2: requested provider needs not retained.
- `july_breadth_birthday_03_phonefixed` repetition 1: no candidates observed and required provider link absent.
- `final_second_wedding_r1` repetition 1: selection was not recorded; comparison to displayed second provider reported `not_selected`.
- `master_provider_live_catering` repetition 3: required provider source-link containment failed.
- `provider_reference_miraflores_option` repetition 3: expected provider selection and its later persistence were absent.

Names above omit prefix `live_behavior.` and suffix `.master_rN` for readability. These are assertion outcomes, not established root causes. The four requested-needs failures occur in two scenario types; repeated outcomes are not independent scenarios. Preserve all failures, including any failures in earlier runs.

## Other measured facts and limits

- Median end-to-end conversation latency 20.744 s; p95 42.798 s, n=261. Median turn latency 11.6405 s; p95 21.334 s, n=510. These reflect this run and environment, not a user-population latency guarantee.
- 401 delivered provider URL spans detected; 400 match a same-turn normalized trace candidate URL. One does not; it may have other seed/history evidence and is not automatically a hallucination. URL matching does not check the truth of all statements, prove actual marketplace accuracy, or prove complete response grounding. Trace records are not an independent authoritative audit.
- 36 delivered-empty turns are recorded; do not interpret them as failures without examining delivery actions and case expectations.
- Estimated usage-based cost: OpenAI $0.517118 plus modeled Lambda $0.099326 = $0.616445, rates dated 2026-09-25. This is not a billing statement and excludes unmodeled costs.
- The designed population and three repetitions demonstrate behavior on scripted tasks; they do not measure satisfaction, naturalness, external quote delivery, business impact, comprehensive correctness, or causal improvement. A human study is future work.
- A final-study executor override sets a four-hour deadline; the generic run manifest still displays its legacy one-hour default. Use the explicit override and run timing as the operational evidence.

## Evidence map

- `frozen.json`, `frozen.json.started.json`, `frozen.json.finished.json`: prespecified protocol, schedule, input/deployment fingerprints and final identity comparison.
- `master-summary.json`, `master-conversations.json`, `master-provider-references.json`: reproducible aggregate, per-conversation outcomes and URL matches.
- `artifacts/report.json`, `artifacts/results.jsonl`, `artifacts/artifacts/live_lambda/`: full results, assertions and per-case traces; `artifact-index.json` hashes the retained run files.
- `execution.log`, `exit-status.txt`, `analysis.log`, `execute.py`: execution and analysis record. The execution exit status is 1 because hard-gated cases failed; all 261 results are present, and the analysis completed.
- `evals/studies/final-thesis-2026-11-05.json`: exact scenario population. `src/evals/master-study-cli.ts` documents analysis and bootstrap implementation.
- Earlier phases and historical failures: `analysis/expanded-current-study-2026-10-27/` and `analysis/bounded-outcome-validation-2026-10-29/`. The targeted post-repair validation is `analysis/confirmation-repair-2026-11-05/` and is not part of the 261-case result.
