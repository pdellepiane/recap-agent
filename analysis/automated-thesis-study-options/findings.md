# Automated study inventory and decision — 2026-10-26

## Recommendation

After inventory, the user expressed a preference for a new run because the
implementation has changed substantially. Recommend a fresh current-artifact
automated technical study as the main thesis population (design F below), with
July retained as historical context. A zero-call V4 reanalysis remains useful
supporting work, rather than the main evaluation of today's implementation.
Bounded checks and independent fact/effect assertions require no human labeling.
Supplementary enrichment is an optional second experiment, not a prerequisite.
Router on/off compares policies rather than a single gate. All proposed studies
remain unexecuted; preference for a run does not freeze scope or authorize spend.

## Historical population and artifacts

Authoritative root:
`analysis/technical-evaluation-study/artifacts/technical-study-2026-07-03T00-36-35-880Z/`.
The UTC folder date corresponds to an evening start on July 2 in Lima. The
protocol identifies final runtime `c384d80`. This is a documented source identity:
the root has no modern before/after deployment `manifest.json`; a verified July
Lambda ZIP identity must not be invented retrospectively.

V4 overlays immutable V3, changing wedding.06's allowed pause/resume path. Fifty
Spanish synthetic scenarios cover five event groups (ten each) and ten route
families (five each): recommendation, clarification, multi-need, refinement,
selection, pause/resume, closure, FAQ, no-results and recovery. Three fresh-user
repetitions yield 150 conversations and 270 turns. This is a designed corpus,
not a customer sample.

Directly checked retained evidence:

- Three raw reports, each with 50 results: repetition totals 43, 44 and 46
  passed. All 150 per-case JSON files exist, with JSONL duplication.
- All 270 turns retain input, nonempty delivered `outputText`, plan, trace,
  performance and `rawTargetResponse`. Trace fields include candidates,
  results, retrieval source/scores, tool inputs/outputs, paths, selection/close/
  contact outcomes, persistence, timing and tokens. Some tool payloads retain
  prices, promotions, descriptions, services and conditions.
- Six CSVs (conversation, telemetry, grounding, node visits, routes and manual
  audit), summary JSON, raw-artifact index and 11 SVGs exist. Publication files
  include definitions and compact distributable derivatives.
- All 270 telemetry rows identify extractor `gpt-5.4-nano` and reply
  `gpt-5.4-mini`: 270 extraction calls, 270 reply calls and 241 tools. These are
  reported stage counts, not proof of all transport attempts.
- At c384d80 dependency ranges were Agents SDK `^0.8.2`, OpenAI `^6.33.0`;
  exact resolution requires that commit's lockfile.

Preserve these July results:

| Measure | Recorded result | Boundary |
| --- | --- | --- |
| Completion | 133/150; 17 assertion failures | Historical hard assertions plus terminal contract |
| Runtime errors/timeouts | 0/150 each | Observed executions only |
| Repeatability | 42 all-pass, 4 all-fail, 4 mixed / 50 | Three trials per scenario |
| Expected needs | 159/162 extracted; 111/159 recommended conditional on extraction; 111/162 overall | Need instances, not conversations |
| Persistence | 149/150 | Historical trace assertion |
| Grounding provenance | 180/180 required turns | 168 recommendation, 12 FAQ; no prose entailment |
| Provider results | 704 appearances; 21 IDs | Trace population, not validated prose exposure |
| Constraints | 704/704 category; 632 location-compatible, 72 unknown, zero mismatch | Structured compatibility |
| Budget/service | 124/124; 10/10 | Tier/rule checks, not exact affordability |
| Priced cost | $1.054143 | Dated model/Lambda estimate, not total platform expense |

Twelve failures are pause/resume, three recovery, one selection and one
no-results. Stable failed scenarios: study.birthday.10, study.baby_shower.06,
study.corporate.06, study.social.06. Mixed: study.wedding.06, study.wedding.09,
study.birthday.06, study.corporate.05. Preserve failures even where an old terminal
contract seems restrictive. Any revised-contract sensitivity score is a separate
derivative with the original beside it.

**Important construct gap:** technical-study.ts increments `displayedProviders`
over `trace.provider_results`. One sample has 11 trace results but fewer providers
in the reply. An exact-string inventory probe found 372 trace-provider/turn pairs
whose detailUrl occurs in delivered text, versus 704 trace records. This probe
is not a validated display count: name-only mentions and URL formatting differ.
Historical exposure/diversity/shortlist metrics must retain their original
values and names with this limitation; a response-based metric needs a new name.

`src/evals/grounding.ts` matches result IDs to candidate audits and checks category/
location when both fields exist. Missing attributes can pass. FAQ grounding means
a successful nonempty KB retrieval. Neither evaluates prose claims or prices.
Candidate audit and provider result can share an upstream transform, so agreement
is not independent truth. Rich source payload availability must be checked per
turn; a normalized result is not necessarily an archived raw API response.

The existing independent human audit concerns iteration three, not final V4:
provider existence 20/20, attribute faithfulness 15/20, rationale support 1/10
applicable, hard constraints 11/20, fully grounded recommendation turns 1/10.
It cannot be transferred to V4. Historical V1, iterations, gates and the V2
retrospective baseline stay separate. V2 used 165 expected needs versus V4's
162. Protocol snapshots 5317d79, a37103f, f371f99, 68badde, ed0458e, 2559335 and
c384d80 are engineering iterations, not randomized component comparisons.

## Current implementation and later validation populations

Inventory HEAD is `8b69c341f6a8e50e965fa16afbc0fb427b0a8c6f` with substantial
tracked/untracked changes. Current package ranges are Agents SDK `^0.21.0`,
OpenAI `^7.43.0`; source model defaults are `gpt-6-luna`, not verified AWS values.
Current implementation adds complete authorized multi-root profiles, purchase/
authentication, RSVP/effect receipts, request ownership/continuity and Decisions
routing while retaining classifier/extractor paths. The owner-consolidation
workplan is future work, not an implemented architecture.

Read-only catalog hydration found 103 cases overall. Current mandatory suite:
**60 backend-fixture-backed cases, 232 scripted turns, 410 hard assertions and
only expectation-pass-rate scorers**. Assertion families include plan/trace facts,
numeric trace checks, delivered values, tool boundaries and per-turn effect
counts. These are inventory counts, not a measured pass rate. docs/testing.md
retains an older 52-case cutoff.

Directly inspected later runs:

| Run | ZIP SHA prefix | Outcome | Retained estimated cost |
| --- | --- | --- | --- |
| eval-2026-10-23T21-27-05-005Z-23782365 | 76d21632 | 9/15 passed, 6 failed | $0.068251 |
| eval-2026-10-23T22-07-57-263Z-e7cf88a8 | a38b7f5a | 6/6 passed | $0.012434 |

Both manifests retain dirty source digests and verified deployment provenance.
The latter ZIP is
`a38b7f5a4554110e6c4c7419a3f508a6a7df67f8e7a808f04e9158e103154fdf`.
The other nine were not rerun on it. Neither 15/15 nor 60/60 is established.
Four subsequent supervised synthetic objectives retain one public-search failure
(including no delivered reply after schema failure), two passes with findings
and one pass. They are a distinct manually reviewed population.

The next local wording/follow-up candidate ZIP
`a054effc4de3373c2f21530246bb707efeff1bf530413b954379bda31af66f27`
was built but **not deployed**, per the final log and final-language-check.json.
Prompt-freshness review remains blocked. Prior passes do not validate it. No live
AWS state was queried in this inventory. Older September/October selected gates,
including the 46-case baseline, invalid interrupted run and seven-case pass,
remain distinct. No pooled July/current score is meaningful.

## Existing controls and minimum interventions

| Component | Existing controls | Minimum credible comparison / caveat |
| --- | --- | --- |
| Retrieval | PROVIDER_SEARCH_MODE api/vector/hybrid; result/score/search limits; gateway interface | Freeze catalog/index and query semantics. Query-intent search uses vector whenever configured and mode is not api: hybrid is not a uniform three-way treatment across methods. Static provider fixtures bypass retrieval and cannot measure vector recall. |
| Enrichment | AgentService.enrichProviders; vector-ID hydration; model detail tools | No clean off switch. PROVIDER_DETAIL_LOOKUP_LIMIT is positive and caps model calls only; service still enriches every result. Add typed supplementary-enrichment control after common selection, with later detail-tool rescue controlled. |
| Routing | AGENT_FEATURE_DECISIONS_ROUTER | Off invokes existing classifier path. Compare policies, including continuity/effects, not a single condition. Record router success/unavailable/fallback; no keyword routing. |
| Persistence | PlanStore, Dynamo/in-memory stores, seeds and sessions | No general off switch. In-memory across turns still persists. Add restricted planning-state reload seam; preserve authorized profiles, authentication, effects, receipts and concurrency. |
| FAQ | KB_ENABLED, score/result/full-article limits; no-op and fixture gateways | KB off removes factual capability. Correct unavailability is a different endpoint from answer accuracy. |
| Harness | Case models, reasoning, prompt labels, env, function URLs; run manifests | Confirm actual Lambda wiring: declaring local env is not proof deployed configuration changed. |

Live fixture gateways preserve LLM execution while simulating backend effects;
offline extraction/reply/router fixtures prove contracts only. Vector IDs require
detail hydration and missing details drop candidates; disabling this changes
eligibility, so cannot isolate optional enrichment. Summary records can already
be rich: measure field availability and model input bytes to verify treatment
actually differs. Remove no authorized customer profile records.

## Study designs

### A. V4 reanalysis — recommended core

Population: all 50 scenarios × three repetitions, no variants/new calls.
Primary outcomes: original completion/all 150 attempts, scenario pass counts 0–3,
stable/mixed fractions/50, failures by assertion and route. Secondary: expected
need extraction, conditional recommendation, overall coverage, latency/cost and
missingness. Keep hard and soft failures separate: 36 search-state failures are
soft, not 36 failed conversations. Preserve overlapping failed assertions rather
than inventing one causal root cause per case.

Score original verdicts and historical typed plans under their original oracle.
Report exact finite-corpus values first. Predeclare a fixed-seed 10,000-resample
scenario-cluster bootstrap retaining all three repetitions per sampled scenario;
event-group stratification is reasonable if declared. Recompute ratios of sums
for need coverage. Give five-scenario route cells descriptive counts and explicit
imprecision. Retain the old conversation-level Wilson interval as historical,
not cluster-adjusted. Scenario bootstrap describes sensitivity to this designed
corpus, not uncertainty for a random customer population. Three repeats poorly
characterize within-scenario randomness.

Effort: 1–2 days, analysis-only reader/reconciliation/report. Cost: $0, no
deployment. Claim: reliability and failure distribution of July's system on this
frozen corpus; no causal, current-system, satisfaction or business-impact claim.

### B. Bounded response-field consistency — optional zero-call extension

Population: scan all 270 replies; separately report 168 trace-classified
recommendation turns and other turns with provider mentions. Eligibility is
field-specific. No new generation; retain the existing repetitions.

Map canonical provider URLs/slugs/IDs and unambiguous names to contemporaneous
source evidence. Parse explicit labeled category/location/price values only when
a narrow grammar binds them to a provider. Numeric prices need currency, units,
range and qualifiers. Price tiers are not exact quotes; office location is not
service coverage. Do not use model-written rationale as independent truth, later
turns as evidence, or today's catalog as historical truth.

Report supported, contradictory, source-unknown and ambiguous/unparsed findings;
mapped references/all detected references; contradictions/adjudicable bounded
assertions; adjudicable/all detected bounded assertions; requested facts delivered/
required fixture facts where such a denominator exists. Zero checked claims is
not a grounded pass. Undetected free-text claims remain outside the construct.
Use upstream/tool payloads first; candidate audit supports only its retained
fields. Explicitly label shared-transform and missing-raw-source limitations.

Validate parser using wrong ID/price/category/location, negation, unrelated money,
missing evidence and multi-provider attribution negative controls. Ambiguous
syntax stays unassessed. Measurement string matching never controls runtime flow.
Use scenario-cluster intervals for consistency and coverage together, provider
breakdowns and leave-one-provider-out sensitivity (only 21 IDs). Do not treat
704 appearances as independent or use their zero errors to bound all prose.

Effort: 2–4 days. $0 model calls/deployment if evidence suffices. Claim: bounded
field agreement at reported coverage, not complete faithfulness. A prospective
LLM-generated assertion companion can omit/disagree with prose and would need
runtime/schema work, deployment and validation; it does not solve this gap.

### C. Supplementary provider enrichment comparison

Population proposal: 12 prespecified one-turn fixture scenarios covering prices,
locations, categories, detail-only fields, missing/contradictory detail, promotion
conditions and no-results controls. Two arms × three repeats = 72 conversations.
Full versus summary-only supplementary evidence after identical candidate
selection/ranking. Same customer profile, prompts, models and supported actions;
prevent or explicitly include later detail-tool rescue. No disabling vector-ID
hydration. Include summary-available/detail-only/absent-in-both strata.

Primary: required fixture facts correctly delivered/all required facts and
contradictions/adjudicable assertions, with missingness and coverage. Common hard
outcomes/all 36 attempts per arm, zero unauthorized effects, latency, bytes,
tokens and cost are secondary. Detail-only expectations are treatment-dependent
outcomes, not universal gates. Use scenario-paired mean differences and paired
cluster bootstrap retaining repeats in both arms. Twelve scenarios support a
small exploratory experiment, not equivalence or general superiority.

A compose-only replay isolates evidence availability but requires a new execution
seam and supports only a compose-stage claim. An end-to-end intervention before
ranking includes ranking effects and needs that different estimand declared.
Never imply both from one comparison. A treatment leaving already-rich summary
fields unchanged may be a null intervention.

Effort: 3–5 days, typed control, fixtures, evidence instrumentation, offline
controls, coverage registration and development deployment. Forecast 144–288
model calls, roughly $0.5–3 variable model/Lambda cost plus explicitly selected
validation. Claim: the measured effect/tradeoff of supplementary evidence in
these tasks. No comprehensive recommendation-quality claim.

### D. Router on/off

Proposal: 20 prespecified two-turn-on-average fixture conversations, two per ten
common behavior groups: facts, ambiguity, auth, requested handoff, unexecutable
action, unrelated post-handoff question, same-request continuation, public missing
record, recovery and planning controls. Freeze exact IDs; do not choose only six
recent repaired cases. Two policies × three repeats = 120 conversations, roughly
240 turns and 480–960 model calls.

Primary: common external hard obligations/all attempts, required delivered facts,
entity-correct exactly-once effects and no new writes on read turns. Secondary:
latency/cost/bytes, silence and router availability/fallback. Keep fact/effect
assertions; internal-node and router-only state-schema pins are not neutral
primary endpoints. Retain old scores rather than rewriting old tests to create
comparability. Analyze intention-to-treat including fallback and separate
adherence diagnostics; routing checks are research diagnostics, not live gates.

Pair by scenario/repetition block, counterbalance arm order, freeze models/worlds
and bootstrap paired scenario means. Repetition labels do not share a model
random seed. Nonsignificance is not equivalence. Effort: 2–4 days after current
candidate blockers, config isolation and stage accounting; roughly $2–10 plus
selected validation. Claim: policy-level technical performance in selected
support tasks, not a universal benefit from one routing condition.

### E. Restricted planning persistence

Proposal: 12 resume/correction/multi-need/selection/reload scenarios, two arms ×
three repeats = 72 conversations, 144–288 turns, about 288–1,152 calls, $1–10 plus
validation. New PlanStore decorator/seam; declare exactly what reload/history is
removed. Full backend history may reconstruct removed plans; removing both
changes a larger memory bundle. Preserve auth/customer records/effect ledger/
idempotency/leases. In-memory storage alone does not establish durability loss.

Score recovered planning facts/expected facts, retained selected IDs, subsequent
task completion/all attempts, extra clarifications and wrong/duplicate effects.
Original persistence assertions become manipulation checks, not a neutral success
criterion when deliberately disabled. Use scenario-paired cluster analysis.
Effort: 4–7 days; highest capability/task-confounding risk. Claim limited to the
specified memory channel on continuity tasks. Not the smallest useful study.

### F. Fresh current-artifact technical study — revised recommendation

Question: how reliably and efficiently does a frozen current implementation meet
its declared recommendation/support obligations? This directly addresses current
capabilities; it does not need a component ablation to be a useful undergraduate
technical evaluation.

Suggested small balanced corpus: **24 explicit scenarios × three repetitions =
72 conversations**, with eight scenarios assigned to each of three strata:

- Provider planning: direct recommendation, missing input, multiple needs,
  refinement, selection, detail inquiry, no-results and retrieval failure.
- Customer support: authorized event/purchase fact, pending/failed outcome,
  missing/ambiguous record, policy/calculator boundary, OTP and scoped access,
  requested handoff and unsupported action with real handoff outcome.
- Multi-turn integrity: resume/correction, independent request after handoff,
  same-request follow-up, preserved parked request, read-after-write/no duplicate,
  wrong-entity ambiguity, unavailable source and reply-generation failure.

These are scenario slots, not yet frozen case IDs. Map existing cases where
they supply the full context and objective oracle; add only uncovered slots.
Existing tests are selected by capability/obligation coverage before outputs,
not recent pass status. Treat this explicitly as a designed, regression-informed
corpus with limited external validity; preferably reserve a few newly composed
fixture variations unseen during tuning and identify them as a separate stratum.
The proposed 24 is a budget/coverage compromise, not a power-derived sample size.
An exact ID list and overlap/de-duplication review are the next decision artifact.

Single current-system arm. Three fresh-identity repetitions. Freeze models,
prompts, fixture worlds, tool surface, execution order, cache policy and one
development ZIP/config identity. Expected 144–288 scripted turns and roughly
288–1,152 model calls; forecast $1–10 variable model/Lambda cost under the stated
token assumptions, with separately selected development validation. A frozen
turn/call ceiling replaces this wide forecast before paid authorization.

Primary: all common observable hard obligations met/all 72 scheduled attempts.
Also report scenario 0–3 pass counts, all three-pass fraction/24, strata/24
attempts each, assertion-family outcomes, errors/timeouts/missing replies and
invalid-identity executions. Functional failures and invalid measurements remain
visible separately; never drop either from the execution accounting. Grounding:
required fact delivery/all fixture-required facts, contradiction/adjudicable
bounded claims and check coverage. Recommendation funnel: extracted expected
needs/expected needs, recommended expected needs/expected needs, and actual
response references separately. Effects: target/polarity correctness, confirmed
success receipts, zero unrequested/duplicate effects. Capability-control tasks
must have objective expected abstention/unavailability outcomes.

Keep turn/prompt/call/token/cost measurements diagnostic, separate from live hard
behavior acceptance. Record stage and HTTP-client latency, per-conversation
median/p95, priced model/Lambda cost, instruction/input bytes, cached/uncached
usage and attempts/fallback. Three repeats do not make p95 precise: report its
sample size and cluster-bootstrap uncertainty. Bootstrap scenario clusters for
primary rates/ratios and efficiency distributions; preserve repeats. No human
review or semantic judges. Reuse external fact/effect assertions, audit oracle
coverage with injected violations, and add missing response-value checks rather
than treating correct plan state as correct prose.

Engineering estimate: 2–5 days to freeze the current candidate, map the corpus,
complete fixture/oracle gaps, instrument missing counters and produce artifacts.
New Lambda-impacting work requires development deployment and selected validation.
Current undeployed language fixes and pending prompt freshness must be resolved
or explicitly excluded in the frozen artifact. No paid tuning/retry after study
outputs; later repairs become a new version/population.

Strongest claim: the identified current artifact satisfied X/Y predefined
observable obligations on this corpus, with stated scenario stability, bounded
field consistency, latency and cost. It does not prove that optimization caused
improvement, universal factuality, satisfaction or business impact. July/current
values may be shown side by side with different artifacts/tasks/models labeled;
causal efficiency gains need a newly controlled matched baseline on the same
tasks/evidence/oracles. A second arm should be added only if that causal claim is
central enough to justify extra engineering and calls.

## Pricing and optional judges

Official OpenAI documentation checked during inventory confirms Standard
gpt-6-luna rates per million short-context tokens: $0.10 input, $0.01 cache-read,
$0.50 output, $0.125 30-minute cache-write ($0.25 12-hour write). Decisions calls
charge input/cache rates and no output tokens. Tier/region/context multipliers
apply. See https://developers.openai.com/api/docs/pricing and
https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability.

Forecasts assume 20k–60k input and 1k–3k output tokens per generation call without
cache savings: $0.0025–0.0075/call, rounded upward for cache writes and Lambda.
Router calls are cheaper under these output assumptions. Lambda uses repository
estimate 1 GB × seconds × $0.0000166667 plus $0.0000002/request. Storage/index and
unpriced external services are excluded; frozen backend fixtures avoid marketplace
retrieval charges. Tool continuations/retries can increase calls. Existing October
costs are context, not a ceiling. Extra targeted validation is separately budgeted.
The CLI reports spend but does not enforce dollar admission. These estimates
are not authorization or invoice totals.

The price file is model-keyed; check endpoint/stage accounting before claiming
tiny router cost differences. Decisions output must not receive the ordinary
response output rate. Preserve historic reported estimates rather than silently
repricing them.

No LLM judge is recommended for the core. A separate exploratory appendix could
make one call per 180 historical grounding-required turns. Inputs: delivered
reply, user context, contemporaneous source/tool/FAQ evidence and explicit rubric.
Output: claim spans, provider/field attribution, source pointers, supported/
contradictory/insufficient-evidence and reason. Existing `text_semantic` score/
reason scorer needs a new analysis-only schema for this. The mandatory live gate
forbids semantic judges.

At 10k–30k input plus 0.5k–1k output per judge call, 180 gpt-6-luna calls cost
about $0.23–0.63 before cache writes/retries (plan $0.3–1). Stronger independent
models cost more at their own prices. Retain errors, no retry of low scores.
Risks: generator/judge correlated errors, missed claims, wrong attribution,
negation/temporal mistakes, prompt injection and mistaking retrieval for support.
Without human labels, judge precision/recall/agreement are unknown. Call this
model-assessed support, never validated human judgment or complete faithfulness.

## Reproducible implementation/execution plan after scope selection

1. Freeze protocol, endpoints and selected population. For historical work use
   exactly the three indexed V4 run IDs and immutable V4+V3 manifests; hash all
   raw reports/cases, historical evaluator, lockfile and dated prices. Identify
   the new analysis commit/digest separately. Do not relabel current results July.
2. Implement analysis-only strict TypeScript reading historical JSON as unknown
   with explicit versioned types. Current schemas use redacted plan summaries and
   may reject/drop old full-plan fields. Avoid runtime compatibility shims. Add
   independent count/ratio reconciliation and corrupted negative controls.
3. Output only to a new dated derivative directory: scenario/repetition table,
   hard/soft overlapping failures, funnel, missingness and clustered intervals.
   Preserve all 17 failures and 162 expected needs. Do not invoke current
   regenerateTechnicalStudyArtifacts on the historical root: it overwrites CSVs/
   summaries using today's evaluator. Record source pointer/parser for every row.
4. For bounded checks, first report source-availability and grammar coverage;
   freeze syntax and unknown handling before scoring. Save claim spans, source
   values and dispositions. Do not tune parsing to erase particular failures.
5. For new comparisons isolate from the dirty shared checkout, freeze an artifact
   and resolve or explicitly freeze current blockers. Add only the chosen typed
   seam/world/instrumentation; no authorized profile deletion or fixed prose.
   Keep prompts Spanish under prompts/, strict types, no explicit any, register
   behavior changes and offline twins, measure instruction/input bytes and update
   docs/implementation-log.md for code/prompt changes.
6. Run appropriate offline/coverage/prompt checks. Deploy Lambda-impacting changes
   only to development using CloudFormation, se-dev/us-east-1 and fail-closed STS
   account 684516060775. Prefer one artifact with a validated treatment selector;
   otherwise record both ZIP/config identities and counterbalance arm order.
7. Before paid dispatch freeze exact IDs, repetitions, limits, dollar ceiling,
   worlds, oracle and randomization seed. Live CLI has explicit case selection,
   not arbitrary treatment/repetition flags: use versioned arm/repetition cases
   or a narrow runner extension. Run only explicit `eval:behavior-live -- --case`
   selections after deployment; never the old full-study command/unfiltered gate.
   Keep research mechanism measures outside hard objective live acceptance.
8. Fresh identities per arm/scenario/repeat; stable fixture business IDs, isolated
   effects. Capture source/candidate/enriched/model-visible evidence, field
   availability, delivered text, attempt-level calls/tokens, fallback and receipts.
   Freeze evidence/index versions and cache/warmup policy; no real customer writes.
9. Verify deployment/config identity before/after. Retain manifests, snapshots,
   JSONL/reports and all failed/interrupted attempts. Dollar enforcement requires
   admission headroom or bounded batches, not just progress reporting. No semantic
   retry/panel expansion. Uncertain mutations need completion evidence before
   replay. Invalid identity stays invalid.
10. Report all scheduled attempts/errors/missingness, adherence and paired effects.
    Unknown root causes remain unknown. Later repair validation is a separate
    population. No automated design here measures satisfaction, naturalness,
    business impact or unrestricted factual truth. Human study remains future
    work, not a prerequisite for bounded technical evidence.

## 2026-10-27 current primary evidence handoff

The current 36-scenario follow-up completed with 100/108 primary passes, five failures and three errors; a later, separate calculator-link validation passed 3/3. The thesis-ready evidence handoff is `docs/thesis/current-study-evidence-2026-10-27.md`. OTP exclusion was a later user scope decision, so 100/105 is a descriptive post-hoc subset rather than a replacement for the frozen denominator. July V4 remains broader in provider event and route coverage; the current study is more relevant to the later artifact and includes more explicit customer-service and effect checks. No causal comparison or pooling is warranted.
