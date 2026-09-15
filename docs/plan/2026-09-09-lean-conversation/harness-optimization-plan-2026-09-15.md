# Harness optimization and reproducible iteration — September 15, 2026

Status: implementation specification, not an implemented optimization or release approval.

## Outcome and boundaries

Land one reproducible candidate, then iterate with bounded parallel evaluations, smaller model requests, and unchanged behavioral acceptance. Keep the three owners: planning, faq, customer_assistance. Determinism belongs in evidence identity, effect verification, scheduling and artifact accounting; delivered conversation remains model-written. No scripts that prescribe replies, keyword routing, output replacement, additional conversation judges, new state machine, model migration, image architecture rewrite or campaign integration are included.

This document specifies the optimization work. `landing-plan-2026-09-15.md` specifies the outstanding product corrections. `acceptance-contract.md` remains binding. Historical status documents are evidence, not competing executable instructions. Existing production bytes remain the rollback baseline. A frozen development reference can be red and must be labeled red; “stable” means reproducible, not proven release-ready.

## Verified findings and remaining uncertainty

Repository inspection found:

- `src/evals/runner.ts` awaits each case and its finalization before starting the next. Expectation and scorer loops also await judges serially. Full aggregate artifacts are written after all cases finish.
- The loaded live_behavior_regression catalog contains 117 cases, 186 input turns and 144 text_semantic expectations. These are expectation counts, not measured API calls; optional scorers can add calls. 86 cases reference a fixture at case or turn level; 31 do not. A fixture reference alone does not prove complete isolation.
- Six cases declare RSVP isolation hooks. Two are fixture-backed (`rsvp_state_reversal_ends_confirmed`, `s11_rsvp_durability_confirms_once`); four are not. Production setup helper creates the HTTP gateway without dispatching by fixtureScenario. Its module-global context map is keyed by guest/event-name/phone, not execution. Blind parallelization would be incorrect.
- `src/evals/targets/live-lambda.ts` generates a unique conversation ID, but explicit input IDs override it. Fixture state keys use run/case; configurations must not collide. Ordinary turns are sequential; preserve the intentional concurrent-first-two-turns test.
- Lambda requests currently use a 95-second timeout. `semantic-judge.ts` constructs a client per call unless injected and supplies no explicit per-call timeout/retry policy. Reported turn latency does not include the whole setup/judge/teardown pipeline.
- Runtime already uses implicit prompt caching with a 30-minute TTL. Bundle IDs hash projected content; caching is not absent. Tool definitions, schemas and the actual rendered prefix matter beyond this hash.
- The latest recorded artifact is `188dd6c2eeea02cb9486797fa1b80399718fba24df510fb47c9eaa5f274a9bc8`, Lambda code hash `GI3Wwu7qAsuUhnl/obgDmXGPuiTfUQ+0fJ6qXydKm8g=`. This is a log observation, not a fresh AWS identity check. Latest reviewed 13-case panel was 11/13, with payment-time omission and unperformed-purchase-lookup claim still failing. No full current gate is established.

The audit does not establish project rate limits, Lambda reserved concurrency, longest full-suite case duration or achievable wall time. Do not claim a measured speedup from serial source code alone. Discovery of those values is an explicit preflight deliverable below, not permission to change defaults arbitrarily.

## Fixed execution decisions

1. One coordinator process; configurations sequential. Within a configuration: four case workers total, at most one real/shared-backend case at a time, and two independent semantic-judge requests in flight. Cases are atomic jobs; normal turns never run concurrently. No new distributed queue, service, database or worker framework.
2. Admit only proven fully isolated fixture cases to the parallel lane. All other cases enter the serial external lane, which still consumes one of the four total slots. Any fixture operation capable of falling through to real effects makes the case external. Unknown classification fails closed to external.
3. Case workers release their slot after execution, evidence snapshot and teardown, before semantic judging. A queue of at most eight completed case snapshots applies backpressure. Judge payloads contain only the evaluated case and the permitted turn prefix; never future turns or another case.
4. Preserve fixture histories, thresholds, rubric text, model settings and assertion count during runner changes. Do not merge 144 semantic expectations into one model call, switch judges, cache acceptance verdicts, remove cases or rerun failures until green.
5. Run all selected cases after an ordinary case failure. Global credentials failure, artifact drift, exhausted run deadline or unrecoverable external-state contamination stops new admissions and marks the run incomplete/red. Preserve already collected results and attempt cleanup.
6. Keep current implicit cache mode, 30m TTL, model and stable cache keys. No explicit-breakpoint migration in this batch. No artificial padding to reach cache eligibility, no persistent caching of customer evidence, no image preprocessing pass.
7. Separate runner optimization, evaluator evidence correction, and runtime prompt reduction into atomic changes and distinct manifests. A changed oracle requires matched baseline/candidate evaluation under R05. Scheduling changes must not silently rewrite judge prompts.

## Packet O0 — freeze identity and establish one source of truth

Owner: evaluation implementer. Files: existing `src/evals/runner.ts`, `src/evals/reporting.ts`, `src/evals/case-schema.ts`, `src/evals/live-behavior-cli.ts`; new `src/evals/run-manifest.ts`; tracked reference `docs/plan/2026-09-09-lean-conversation/optimization-reference.json` created during implementation.

Before changing runtime, record the current dev code SHA and deployment identity using se-dev/us-east-1 and the mandated STS account check. Preserve the available artifact and SHA; do not rebuild it and call that the same baseline. Use the current recorded reference only if verified. If live dev moved, pin its observed artifact separately and retain the older identity; never substitute silently.

Write a manifest before dispatch containing: schema version, run ID, reference/candidate label, source commit plus dirty patch digest and untracked-source content digest, artifact SHA and Lambda CodeSha256/version, lockfile and prompt digests, evaluator commit/content digest, exact ordered case IDs and expanded case/fixture/rubric digests, model IDs and all explicitly configured settings, requested concurrency, timeout/retry configuration, start time and environment identity. Record returned provider model identity when available. An alias is not a guaranteed immutable model snapshot; do not invent a snapshot ID or claim sampling reproducibility.

Record deployment identity before and after the run. Reject mixed-artifact evidence. Prefer existing per-turn version/code evidence where available; pre/post checks alone cannot exclude an intervening deployment. Establish one named deployment coordinator for the gate; any observed deploy during the window invalidates it. No Lambda infrastructure rewrite solely for this plan.

Preflight must resolve credentials without printing secrets, judge availability, selected count, duplicate IDs, complete fixtures, disk writability, deployed identity, current SDK versions, and configured service limits. Where usable limits are lower than four active cases/two judges, stop with an explicit capacity deficiency; do not silently change the acceptance configuration. Initial admission can be configured downward in the manifest for environments with known smaller limits, but benchmark comparisons must use that identical declared configuration.

Pass: manifest exists before first invocation; tampering with a fixture, rubric or artifact is detected; zero selected cases fails; every configuration/case pair has unique identity. Dirty trees are preserved and fully fingerprinted, not mislabeled as HEAD bytes. No release-ready claim is attached to the red reference.

## Packet O1 — isolation before concurrency

Files: `src/evals/targets/live-lambda.ts`, `src/evals/rsvp-isolation.ts`, `src/evals/runner.ts`, `src/runtime/eval-fixture-state.ts`, `src/runtime/eval-fixture-gateway.ts`, `src/evals/case-schema.ts`; tests `tests/eval-runner.test.ts`, `tests/eval-fixture-gateway.test.ts`, and new `tests/eval-execution-isolation.test.ts`.

Create one execution identity from run/config/case. Give fixture runId a config-scoped value while preserving the logical run ID in reports. Keep case IDs stable. Map each logical input conversation ID to a unique physical ID within this execution; repeated logical IDs map identically, distinct IDs remain distinct. Rewrite seed/read/invoke/history references consistently. Do not rewrite business phone numbers, guest IDs, event IDs, tokens or expected business facts. Cases depending on a literal external ID must be explicitly placed in the external lane until their identity assertion is expressed against the mapping.

Remove the module-global isolation-context map. Setup returns an explicit context that teardown receives. Fixture-backed setup must initialize the same fixture world used by Lambda and must never invoke the real HTTP RSVP gateway. Verify the fixture gateway implements every operation used by that case; marker presence is insufficient. Preserve explicit fixture prior/target state. Real-backend setup requires a known restorable prior state and verified setup state before a mutating test starts. Unavailable gateway, failed write, ambiguous identity or inconclusive verification is setup error, never successful no-op. Teardown verifies restoration; failed cleanup stops further external cases. Do not invent a pending state by substituting declining.

Use one external lane rather than adding per-entity lock machinery. Obtain a single-host exclusive runner lock under the run directory parent for external cases. Record PID/run/start, refuse a second active owner; never steal based only on elapsed time. This is not cross-host protection: external evaluations are restricted to the named coordinator host for this batch. Existing chat mutex/RSVP effect lease remains untouched; it guards production operations, not the entire test setup/restore transaction.

Pass: two cases sharing business phone have disjoint chat/history/effect state; two matrix configurations cannot share fixture counters; fixture RSVP setup performs zero real HTTP writes; real restoration uses fresh same-guest/same-event evidence. willAttend precedence remains valid even when hasResponded is false. Concurrent-first-two-turns still exercises exactly its intended overlap. No duplicate effect or hidden cleanup error can score green.

## Packet O2 — bounded runner pipeline and durable progress

Files: `src/evals/runner.ts`, `src/evals/reporting.ts`, `src/evals/case-schema.ts`, `src/evals/cli.ts`, `src/evals/live-behavior-cli.ts`; new small `src/evals/scheduler.ts`; tests `tests/eval-runner.test.ts`, `tests/eval-runner-case-ids.test.ts`, `tests/live-behavior-cli.test.ts`, new `tests/eval-scheduler.test.ts`.

Extract the existing per-case body without changing turn behavior. Use an async bounded worker pool, not unbounded Promise.all. Schedule ready fixture jobs in manifest order, alongside the single external lane. Keep configurations sequential. Add strict CLI options `--case-concurrency` (default 4, supported 1..4) and `--judge-concurrency` (default 2, supported 1..2). Reject unknown flags and missing/invalid values; keep repeatable --case. The unfiltered command selects the complete current manifest, never a hardcoded 117.

Lifecycle: queued → setup → running → snapshot → teardown → awaiting_judge → finalized. Teardown belongs in finally. Capture immutable private turn evidence before teardown can alter backend state. Redacted public artifacts are written atomically per case at snapshot and finalization; one coordinator writes progress records and the final aggregate in manifest order. Crash recovery preserves unfinished/error states; a diagnostic resume is labeled diagnostic and cannot turn an interrupted release run into a clean full gate.

Report running/queued/completed/error counts, current phase and elapsed time at most every ten seconds; retain partial report on SIGINT or deadline. SIGINT stops new admissions, drains bounded in-flight work and attempts teardown. An aborted HTTP request does not prove Lambda stopped: mark uncertain execution, do not immediately retry or restore over an active mutation. Wait for existing trace/lock evidence to establish completion before restoration; if unavailable mark contaminated and stop the external lane. Do not forcibly break chat locks.

Keep the existing 95-second per-turn request bound. Do not impose a 95-second whole-conversation bound. Set a 60-minute suite coordinator deadline; on expiry produce an incomplete red report and allow up to five minutes for bounded drain/cleanup, reporting unresolved effects explicitly. This bounds local orchestration, not remote execution. No retry of an entire conversation after a timeout.

Pass: controlled deferred-promise tests prove exactly four maximum cases, one external case, two judges, eight queued snapshots, sequential normal turns, backpressure, cleanup on failure and deterministic report ordering. Test overlapping completion, thrown judge/setup/teardown, SIGINT, deadline and artifact drift. Do not rely on flaky millisecond sleep assertions.

## Packet O3 — judge throughput and honest measurements

Files: `src/evals/scorers/semantic-judge.ts`, `src/evals/runner.ts`, `src/evals/metrics.ts`, `src/evals/reporting.ts`, `src/evals/case-schema.ts`; tests `tests/semantic-judge.test.ts`, `tests/eval-runner-judge-context.test.ts`, `tests/artifact-redaction.test.ts`.

Inject one OpenAI client per credential/configuration for judging. Keep request contents and sampling unchanged. Set explicit 60-second request timeout and SDK maxRetries=0. One runner-owned retry is allowed only for transient transport/429/5xx judge failures, using the identical payload hash, after Retry-After up to 30 seconds or a two-second delay when absent. Longer Retry-After fails the attempt rather than violating the run bound. Never retry a semantic fail, parse failure, missing evidence or low score. Record both attempts and final disposition. A terminal judge error remains a failed gate; a documented recovered transport attempt is not silently erased. Retain any stricter binding retry rule in the existing acceptance contract.

Acquire the judge semaphore per API request, not per complete case. Run independent expectations through that shared limiter while retaining result order. Do not invoke a duplicate optional scorer when it is proven to be the identical request, rubric, threshold and evaluation role of a mandatory judge; first inventory duplicates, then reuse the same in-run result with explicit references. This deduplication is a separately reviewed evaluator change, disabled during scheduler equivalence validation. No cross-run verdict cache.

Record wall-clock makespan, queue wait, setup, turn, snapshot, teardown, judge wait/API duration, report write, model call count, retry count, rate-limit count, tokens and SDK/provider usage. Preserve runtime latency as a distinct field. Aggregate cached/input tokens by summed counts, with separate cache writes and uncached tokens; never average percentages or count missing usage as zero. Report by runtime stage/model/bundle and judge separately.

Pass: judge packet hashes and rubrics are unchanged by scheduler work, each result is traceable to its own immutable evidence, all 144 expected semantic checks remain accounted for, missing usage is explicitly unknown, public reports contain no new raw customer data.

## Packet O4 — shorten the runtime harness and preserve cache reuse

Owner: runtime implementer, serialized after runner validation. Files: `src/runtime/prompt-loader.ts`, `src/runtime/prompt-manifest.ts`, `src/runtime/openai-agent-runtime.ts`, `src/runtime/message-response-classifier.ts`, `src/runtime/openai-model-defaults.ts`, `src/runtime/agent-service.ts`; existing shared prompts and resolver prompt files; `src/audit/prompt-audit.ts`, `src/audit/openai-transport-capture.ts`. Tests: `tests/prompt-loader.test.ts`, existing branch/projection tests, new focused prompt-prefix regression only if existing tests cannot express it.

First land the three corrections in landing-plan: requested payment-time evidence, absence of unperformed lookup claims, removal of invented native clarification. Do not solve these by a new generic disclosure paragraph. Then audit actual sent requests for purchase status, payment time, FAQ, RSVP read, RSVP write receipt, unavailable image, native multi-turn and planning closure.

Build a removal ledger for each loaded instruction: file, consumer, invariant, whether already enforced in tool/schema/evidence, whether irrelevant on this branch, replacement evidence and regression coverage. Delete duplicate conversational guidance from shared/common_anti_patterns, question_strategy and resolver response_contract where the remaining invariant is already covered. Preserve facts such as real manual-check policy only when relevant and grounded; never require a stock 72-hour sentence. Keep auth, same-entity verification, effect receipts, lease/replay fencing and disclosuyre authorization. Do not delete safety of effects to satisfy a line-count target.

Arrange actual model input as stable shared invariants, stable owner/tool/schema definitions in consistent order, then the smallest applicable branch section and dynamic conversation/evidence tail. Stable order means canonical order within the applicable tool set, not exposing every tool to every owner for caching. Do not move timestamps, customer values, event labels or run IDs into the stable prefix. Canonicalize unordered maps only; preserve chronology and ranked candidate order. Preserve reused native image references and prior messages without repeatedly rebuilding image descriptions. Compact old context only at the already established horizon; this batch does not change retention.

Prompt loader may cache immutable raw file contents per process; projected bundles must remain keyed by their complete disclosure context. Never memoize a whole customer-bearing request or reuse a bundle from an incompatible branch. Avoid a new routing registry parallel to prompt-manifest. Remove unreachable image_outcomes.json or old prompt helpers only after repository-wide call-site verification, updating tests that intentionally inspect them. Historical audit evidence stays archived.

Measure actual serialized instructions, tool schemas and inputs before/after on identical scenario denominators. Adoption requires no increase in model calls per successful turn, lower aggregate instruction bytes, and no branch increase unless a documented missing factual requirement explains it. Record total relevant input and uncached tokens separately: lower instruction bytes does not justify dropping needed event/payment facts. Byte counts are measurements, not exact constants embedded per fixture.

Cache decision: retain current implicit/30m settings and keys. Current OpenAI documentation says GPT-5.6+ routes caches automatically; keys are optional accounting boundaries, not a guarantee of hits. Exact prefixes still matter; minimum cacheable prefix is 1,024 visible tokens. Do not enlarge a lean prompt to reach it. Measure naturally repeated requests after a cold first call; do not run artificial billable warm-up conversations. Explicit breakpoints are deferred until transport evidence demonstrates a repeatable cost/latency problem that stable-prefix ordering does not solve.

Pass: relevant-content absence tests, complete facts on requested topics, no fixed delivered prose, no irrelevant tools, correct native-image continuity, same-event/guest factual receipts, no global status recital for an hour-only request. Cache hit ratio is observational, not a flaky CI pass condition. Runtime changes require dev redeploy, new coverage registry entries and full live acceptance.

## Packet O5 — remove evaluator duplication without weakening tests

Files: `src/evals/runner.ts`, `src/evals/scorers/semantic-judge.ts`, `src/evals/evaluation-state.ts`, existing evidence/projection helpers, `evals/live-behavior-coverage.yaml`, `evals/suites/live_behavior_regression.yaml`, and their existing tests.

Keep one typed evidence adapter shared by both evaluation branches. Project purchase facts from their real typed outcomes; remove the score-as-purchase-total and filename-as-event-label bridge once both branches use the typed projection. Preserve provenance, independent effects and the exact turn-visible evidence boundary. No “named datum” requirement when the backend was not read or yielded no such datum. This is a reviewed oracle change, not a prompt repair.

Maintain one primary reason for each failure: product effect/identity, product fact/completeness, unnecessary interaction, evaluator defect, or infrastructure error. Keep numerical scores as diagnostic details. Contradictory time, invented absence, wrong-event write and false success are product defects even when prose is understandable. Missing a preferred sentence is not a product defect if the required facts and useful behavior hold; revise that rubric through R05 rather than adding the sentence to runtime.

Consolidate common fixture setup and report builders; retain all permanent interaction histories and hard checks. Move duplicated command-wrapper logic into the existing runner API, preserve CLI entry points that have callers, and delete dead wrappers only with call-site proof. Do not merge independent conversations or remove hard judges to shorten wall time. Archive old narrative status instead of deleting evidence. One release manifest plus brief implementation-log entries replaces repeated copied status tables.

Pass: adversarial evidence mutations (wrong event ID, wrong guest, no read, stale receipt, duplicate write, unsupported approval) still fail; meaning-preserving paraphrases do not fail solely on preferred words. Both candidate and frozen baseline are freshly evaluated with the same reviewed evaluator. Coverage registry validation passes; fixture count reductions are not part of this packet.

## Validation order, speed objective and finish

Sequence: O0 → O1 → O2/O3 implementation as one reviewed harness release → serial/parallel equivalence → outstanding product fixes → O4 → O5 if needed → full candidate gate and matched comparison. O2 and O3 share runner.ts: use one editor. No simultaneous shared-file changes. Finish each packet with a short atomic commit and implementation-log entry; do not stage unrelated dirty files.

Use a fixed diagnostic panel selected from existing cases: both fixture RSVP-hook cases, all four real RSVP-hook cases, native multi-turn, payment time, stale image, explicit target mutation, unmatched event and token close. Resolve exact IDs from the catalog into the manifest before either run. Run it once serially and once at 4/2 on identical artifact/evaluator settings. Compare request/evidence isolation and structural behavior; stochastic semantic output need not be byte-identical. Preserve all outcomes and investigate changed verdicts; do not declare variance merely because source bytes match. Use offline controlled scheduler tests for concurrency correctness and the live panel for integration.

Performance acceptance: at least 2x throughput improvement for the isolated lane against its serial panel when not externally throttled, no increased duplicate effects or terminal transport errors, bounded memory queue, and complete timing accounting. Full-suite operational objective is under 45 minutes, with a 60-minute admission deadline. This is a measured objective, not an already proven estimate. Report the limiting bound from sum of fixture execution times divided by available slots, external-lane total, longest sequential conversation and judge work divided by two. These bounds overlap; do not simply add all phase totals. If external waits dominate, report that cause and stop adding concurrency or deleting tests. Any further capacity increase is a new measured change after this stable runner version.

Run targeted offline tests for touched modules, typecheck/lint, and `tests/live-behavior-coverage.test.ts`. Run required full offline checks at integrated candidate. After every Lambda-impacting change deploy development per repository rules. The unfiltered `npm run eval:behavior-live` must execute every case in the current frozen manifest with zero hard failures/errors/skips and mandatory judges. A targeted pass, dry run, resumed diagnostic or deadline-aborted run cannot authorize promotion.

Finish deliverables: immutable runner version; reference/candidate manifests; exact source/artifact identities; serial/parallel benchmark and token report; removal ledger; complete full-suite report; separately reviewed oracle changes and matched baseline result; no unresolved effect identity/cleanup failures. Promote only the exact accepted artifact through the existing authorized release process, preserving rollback and verifying deployment identity/health. No rebuild after the gate. This planning task itself performs no deployment or promotion.

## Implementer handoff

Read this document, landing-plan-2026-09-15.md, acceptance-contract.md and AGENTS.md before editing. Execute the packets in the stated order. Use the specified concurrency, queue, retry, cache and ownership decisions. Do not change model, response wording contracts, image retention, agent count or backend wire protocol. Preserve other contributors' changes. Return per packet: exact files changed, deleted machinery, identity manifest, tests/run IDs, timing/token evidence and remaining blocker. If a required capability is absent, report the precise conflict; do not replace the design with another wrapper or relax a gate. Implementation is complete only when the full current suite and identity-preserving release requirements above are satisfied.

## Documentation source

OpenAI prompt caching guide, checked September 15, 2026: https://developers.openai.com/api/docs/guides/prompt-caching . Supports exact-prefix reuse, GPT-5.6+ automatic routing, optional accounting keys, 30m TTL and 1,024-token minimum. SDK support is already evidenced by the repository's typed implicit cache configuration; no API migration is required by this plan.
