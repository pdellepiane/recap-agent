# Sources

| Name | Path or URL | Type | Date Checked | Why It Matters | Caveats |
| --- | --- | --- | --- | --- | --- |
| Repository constraints | AGENTS.md | Instructions | 2026-10-26 | Profiles, disclosure, model prose, deployment and selected-only validation | No new execution authorization |
| July protocol | analysis/technical-evaluation-study/{methodology,ablation-protocol,confirmatory-gate-results}.md | Protocol | 2026-10-26 | Population, historical source snapshots, outcome definitions | Older unrestricted rerun commands superseded |
| Frozen scenarios | evals/studies/technical-evaluation-50-v{3,4}.json | JSON | 2026-10-26 | V4 overlay and V3 base | Oracle differs from V1/V2 |
| July raw evidence | analysis/technical-evaluation-study/artifacts/technical-study-2026-07-03T00-36-35-880Z/ | JSON/JSONL/CSV | 2026-10-26 | 150 case files, three reports, 270 delivered turns | No modern deployment manifest; candidate/result fields share transforms |
| Publication derivatives | analysis/technical-evaluation-study/publication-package-2026-07-03/ | CSV/Markdown/archive | 2026-10-26 | Metric package and provenance | Displayed-provider label is trace based |
| Historical review | analysis/technical-evaluation-study/artifacts/independent-review-summary.json | JSON | 2026-10-26 | Prior manual evidence | Iteration three, not final V4; no new manual review |
| Research synthesis | docs/thesis/thesis-evidence-handoff-2026-10-04.md; analysis/current-capabilities-paper-brief-2026-09-04/report.md | Documentation | 2026-10-26 | Prior inventory, constructs and limitations | Checked against selected raw artifacts/current source |
| Historical scoring | src/evals/{technical-study,grounding,study-schema,metrics,pricing}.ts | TypeScript | 2026-10-26 | Denominators and limitations; unsafe in-place historical regeneration | Current schema/source differs from July |
| Harness | src/evals/{case-schema,loader,runner,reporting,run-manifest,live-behavior-cli}.ts; src/evals/targets/ | TypeScript | 2026-10-26 | Cases, facts/effects, isolation, artifact identities | Read only; no harness execution against Lambda |
| Current inventory | evals/suites/live_behavior_regression.yaml; evals/cases/; evals/fixtures/; evals/live-behavior-coverage.yaml | YAML/JSON | 2026-10-26 | Hydrated counts, assertion families and fixture support | Counts do not establish passes |
| Runtime controls | src/runtime/{config,agent-service,openai-agent-runtime,sinenvolturas-gateway,fixture-provider-gateway,decisions-router-lane,capability-manifest}.ts; src/lambda/handler.ts; src/storage/plan-store.ts | TypeScript | 2026-10-26 | Real intervention boundaries | Defaults are not verified deployed config |
| Current model defaults/dependencies | src/runtime/openai-model-defaults.ts; package.json; git show c384d80:package.json | TypeScript/JSON/Git | 2026-10-26 | Current/historical SDK ranges and model identities | Lockfiles needed for exact installed dependencies |
| Current policy and recorded validations | docs/{testing,evaluation-framework,implementation-log}.md | Documentation | 2026-10-26 | Selected-case policy, later passes and failures | Documentation cutoff differs from current suite |
| Recent raw runs | .eval-runs/eval-2026-10-23T21-27-05-005Z-23782365/; .eval-runs/eval-2026-10-23T22-07-57-263Z-e7cf88a8/ | JSON | 2026-10-26 | Verified recorded deployment IDs, 9/15 and 6/6 outcomes | Distinct artifacts; no present AWS query |
| Pending candidate | docs/plan/2026-10-23-consolidated-supervisor-audit/final-language-check.json; final-language-fix.md | JSON/Markdown | 2026-10-26 | Built but undeployed candidate and frozen pending checks | No budget carried forward |
| Supervised findings | evals/e2e-supervision/ledgers/2026-10-23-supervision-*.md | Ledgers | 2026-10-26 | Preserved public-search failure/findings | Separate manually reviewed population |
| Judge | src/evals/scorers/semantic-judge.ts | TypeScript | 2026-10-26 | Existing score/reason contract and evidence controls | Not a validated human judge |
| Historical pricing | evals/studies/pricing-2026-07-01.json; pricing-2026-09-25.json | JSON | 2026-10-26 | Reproduce reported estimates | Model-keyed accounting needs endpoint check for Decisions |
| Official current pricing | https://developers.openai.com/api/docs/pricing | Official documentation | 2026-10-26 | Standard response/cache assumptions | Tier/context/region changes apply |
| Decisions pricing | https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability | Official documentation | 2026-10-26 | Input/cache billing, output free | Endpoint-specific |

Machine-readable counts and SHA-256 input inventory: [artifacts/inventory.json](artifacts/inventory.json).

| Current follow-up | `analysis/master-thesis-study-followup-2026-10-27/{frozen-master.json,master-summary.json,results.md,artifacts/}` | Frozen protocol and raw run | 2026-10-27 | 36 scenarios, 108 executions, identity and hard results | Designed cases; three OTP errors remain in primary denominator |
| Calculator targeted validation | `analysis/targeted-calculator-followup-2026-10-27/{protocol.md,artifacts/}` | Separate live targeted validation | 2026-10-27 | 3/3 source-published link checks | Separate artifact and population; not a regrade |
| Current thesis handoff | `docs/thesis/current-study-evidence-2026-10-27.md` | Derived evidence note | 2026-10-27 | Main current-artifact study, interpretation and residual July coverage | Does not claim like-for-like replication |
| Expanded study | `analysis/expanded-current-study-2026-10-27/{README.md,frozen-master.json,july-scenario-mapping.json,execution.log}` | New, separately frozen protocol and run | 2026-10-27 | 84 scenarios including all 50 July-derived prompts | Running when this entry was created; do not claim outcomes before the report exists |
