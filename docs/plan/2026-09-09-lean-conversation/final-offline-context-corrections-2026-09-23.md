# Final bounded offline correction package — 2026-09-23

## Binding scope and product goal

This supersedes the execution instructions in `complete-customer-context-2026-09-23.md`, including its authorization for deployment and a 12-case paid panel. The user cannot fund another live test. **This package authorizes implementation and network-isolated targeted offline validation only. No deployment, AWS calls, live Lambda calls, paid model/judge calls, unfiltered test command, baseline run, or promotion.** These restrictions override older repository deployment/live-validation requirements. Keep production and development unchanged. Do not ask for funding or silently substitute another paid mechanism.

The product goal remains: one complete authorized customer profile, prepared before extraction and passed to extractor and responder; actual conversational context preserved; the model interprets the question and writes a useful natural answer. Backend facts must not disappear because of extractor resources/aspects or route choices. State controls authorization, capability availability and verified effects. It does not substitute for interpretation. Minimize instructions, duplicated data and orchestration. Do not minimize authorized customer facts. Complete context is for the model, not an instruction to narrate every record to the customer.

This is a correction of the existing implementation, not a new architecture project. Preserve its complete-profile path and remove contradictions in its integration. Do not add agents to the runtime, extra model stages, a memory database, a summarization service, a retry framework, an event state machine, canned wording or post-generation text replacement. Keep current model configuration unchanged. There is no guarantee of live behavior from offline proof; deliver an honestly verified offline candidate, not a claimed production-ready release.

## Starting point and evidence every owner must understand

Audited checkout: `e72b2053`; implementation `49000e34`; coverage `02a2a3fa`. Inspect actual HEAD/status before editing and preserve unrelated modified/untracked files. The deployed candidate ZIP hash recorded in the log is `a659847df81d7c71d8c42e6ba3f18d2e43b54083f1fdfb1c38f49adf360f1555`. Do not infer deployed identity from current HEAD.

Recoverable intended artifacts are under:
`/Users/leonardocandio/.codex/worktrees/complete-customer-context-deploy/recap-agent/.eval-runs/eval-2026-09-23T18-31-04-722Z-cd8df759/`
Read local files only. If relocated, search local worktrees; do not recreate the run. The directory has execution snapshots and result artifacts, no final aggregate. A snapshot saying `passed` describes execution, not completed semantic validation.

The accidental run under `.eval-runs/eval-2026-09-23T18-27-02-719Z-e9c6f9d7/` began on OLD artifact `578fd0d9…`. Development changed during that run, and there is no final deployment check. Exclude its aggregate and case outcomes from claims about candidate quality. It is useful only to explain the CLI/budget incident. Do not spend time rescoring it or diagnosing its old product failures.

The intended run has these usable observations:
- Physical-card reply correctly included the dedication, physical-card preparation and distinction from credit. Its forbidden orders-root assertion conflicts with the new architecture. Preserve the runtime improvement; repair that oracle.
- RSVP s11 records a verified write and delivered confirmation. Preserve executor, authorization, lease and receipt protections.
- Support-detail T0 answers a card-payment issue. T1 asks what problem happened; T2 asks again. T1 history contains one outbound message; T2 contains two outbound messages; the original inbound questions are absent from recorded history. Persisted plan summary is empty. Extractor T2 says the problem was not specified. This is a real user-facing continuity failure and a demonstrated incomplete-history boundary. Exact logging/storage/filter cause remains unproven: reproduce before choosing the patch.
- Pending-event T0 and T1 both show event lookup activity and `not_configured`, despite a fixture containing Ana/Luis and Marta. The original report's claim that follow-up performed no lookup is incorrect. The final thanks is correctly suppressed. A tool name in the trace does not prove a new backend call; trace the underlying prepared read and result reuse.
- Required judges failed with quota exhaustion. Their scores are not judgments of response quality. Seven targeted cases lack model turns; one auth fixture failed setup due to a missing phone variable. Do not invent conclusions for these cases.
- Actual extractor instruction bytes were 7,023 on an entry turn and 5,328 on continuation. The offline proof covered the smaller branch. Raw live serialized model inputs were not retained, so live field conservation is not proven.
- `agent-service-information-flow.test.ts` reported 47 pass / 46 fail. Some assertions expect obsolete zero-root reads; no evidence establishes that all 46 are harmless. They must be individually classified and resolved within the changed context contract.

## Ownership, sequence and limits

Use TWO implementing sub-agents and one coordinator (the parent). Each must read this entire document, not just its packet. Tell each explicitly that other owners share the checkout: never revert another owner's changes. Owners may communicate but do not spawn additional agents.

1. Coordinator records baseline source/status, confirms network-denied offline test execution and assigns ownership.
2. A and B work concurrently in disjoint files. Each first writes a failing offline reproduction, then the smallest source correction, then passes the reproduction. No speculative production patch for an unreproduced symptom.
3. Coordinator integrates A/B, reconciles legacy assertions, checks payload/prompt coverage and runs the bounded combined offline panel.
4. Commit coherent changes, update log/coverage, publish final evidence and STOP. No deploy or paid run is the next automatic step.

A owns evaluation CLI/scoring/runner/preflight and their tests. B owns conversation/profile runtime, fixture gateway/state, handler wiring and their tests. Coordinator owns prompt/request-size refinements, live-case YAML contracts, coverage/log and cross-packet regression reconciliation. If a discovered fix crosses ownership, transfer that exact file before editing; do not create a duplicate helper to avoid coordination.

## Packet A — prevent repeat spending and preserve truthful partial results

Files: `src/evals/live-behavior-cli.ts`, relevant existing selection helpers, `src/evals/runner.ts`, `src/evals/scorers/semantic-judge.ts`, `src/runtime/openai-retry.ts` (A owns this shared retry utility), `tests/live-behavior-cli.test.ts`, `tests/semantic-judge.test.ts`, `tests/openai-retry.test.ts`, `tests/eval-preflight-fixture-coverage.test.ts`, corresponding existing runner/manifest tests. Change package entry wiring only if required for an import-safe entrypoint.

A1. Remove import-time execution controlled by `VITEST`. Export pure selection/preflight logic from an import-safe module. The executable entrypoint calls it only on actual CLI execution. Never require callers to set a test environment variable to avoid spending. Reject missing/empty case selection; the behavior CLI must no longer default to the full suite. A typo, unsupported flag, unmatched ID or repeated invalid selector fails before any network operation.

A2. One selected-case object must drive both preflight and execution; do not parse selection again on a separate path. Before creating clients/starting workers, validate all selected fixtures, phone placeholders, scenario files and required configuration. Missing `PHONE_FIRST_FALLBACK_CONTACT_PHONE` must fail the whole preflight with zero dispatches. For the existing auth refusal fixture, replace environment dependence with its declared synthetic fixture identity where isolation permits; never use a real customer phone. Reuse existing run coordination to reject overlapping execution against the same development target. If coordination is only checkout-local, key the existing lock to target identity in a shared local location so a second worktree cannot bypass it. No new lock service.

A3. Distinguish permanent quota exhaustion from temporary 429 throttling in the existing shared error classifier. Prefer provider code/type; support the observed no-credits diagnostic when structured fields are absent. This is infrastructure error classification, not conversational keyword routing. Reuse this classification in judge handling instead of treating every 429 as transient. Permanent quota exhaustion gets no retry and stops dequeuing new paid work. Do not continue from an unavailable classifier into extraction/reply when the cause is exhausted quota; B wires this boundary using A's classification. Do not change normal transient retry policy or introduce nested retries.

A4. Persist partial run termination using existing result/manifest formats. Retain finished artifacts; cases never dispatched are explicitly incomplete/not run; unavailable judges are evaluation errors/unjudged, not customer-semantic failures. Emit no successful-gate claim and do not manufacture pass/fail results for unfinished cases. On cancellation, stop queue dispatch and settle/cancel in-flight work through existing cancellation mechanisms; do not launch more work to finalize a report.

Offline acceptance:
- Importing selector/preflight modules in a subprocess with no VITEST produces zero runner invocations and zero network attempts.
- Missing selector, unmatched ID and missing selected-case phone dependency dispatch zero cases.
- Frozen selection executes exactly the requested IDs once in a fake runner.
- Two worktrees/processes targeting the same mock target cannot both acquire execution authorization; stale-lock handling uses existing policy.
- Permanent quota in fake classifier/judge stops new dispatch, no retry, preserves partial artifacts; transient throttle still follows existing bounded retry policy.
- A judge failure never appears as semantic disapproval; execution snapshots remain distinct from finalized results.

## Packet B — repair context continuity and prepared event reads

Files: `src/runtime/agent-service.ts`, `src/runtime/eval-fixture-gateway.ts`, `src/runtime/eval-fixture-state.ts`, `src/runtime/customer-context.ts`, `src/runtime/information-orchestrator.ts`, `src/lambda/handler.ts`, relevant message-context helpers discovered by imports; existing fixture/context/service tests. Preserve one profile builder; do not restore the deleted purchase-reply projector.

B1. Reconstruct support-detail's three turns through the actual service and fixture gateway, with a shared fixture store and mocked models. Use original question, Roger detail and Baby Shower detail from the case. Follow `loadTurnMessageContext` through inbound log, store write, query, phone/run/case/conversation key matching, merge, current-message exclusion and serialized requests. Compare in-memory and Dynamo-adapter behavior using a mocked document client, not AWS. Check rejected writes and duplicate IDs; do not assume all outbound-only history is a prompt defect.

Correct the first reproduced divergence at its owning boundary. History must retain previous inbound messages and actual delivered replies in order. Current inbound appears once via the current turn; retrying a message ID does not duplicate it. A logging failure is explicit typed evidence, never silently presented as complete history. Preserve run/case/customer isolation and chat lock ordering. Do not make fixture history richer than production by secretly injecting ideal past turns.

Verify the extractor and responder receive the original issue and supplied details on T1/T2. A name detail cannot erase the earlier question or change authenticated identity. Use actual production request builders with a scripted model capture; do not assert canned generated responses. Preserve the existing concise continuity instruction. No additional reminder paragraph is authorized merely because a model once re-asked.

B2. Load `rsvp-plus-one-multiple-pending.json` through the same fixture dependency assembly used by Lambda. Call the actual pre-extraction `prepareCustomerContext` with the case's trusted synthetic phone. Follow capability manifest, guest-event gateway response, event detail hydration, `assembleCustomerContext`, then `eventResultFromPreparedContext` on T0/T1. Assert Ana/Luis and Marta reach both actual serialized requests, correctly distinguished, with timestamp provenance. No mutation occurs.

Fix the earliest reproduced failure. If fixture wiring is wrong, fix fixture wiring; do not enable unavailable production capabilities globally. If normalization loses facts, fix normalization once; do not special-case event names. The prepared-result path must preserve source failure code/retryability instead of relabeling every unavailable section `not_configured`. Add only the minimal typed origin/reason fields needed in the existing coverage representation; no parallel error framework. Test disabled capability, unauthorized scope, empty successful lookup and failed lookup as distinct outcomes. No retry loop is warranted by the two failed live turns.

B3. Wire permanent-quota propagation from A so an exhausted classification call does not cascade into more paid stages. Preserve existing fallback behavior for unrelated classifier failures. This does not authorize canned customer-facing error prose.

B4. Preserve complete-profile guarantees while repairing these paths: all authorized roots, all returned known details, no first-N cutoff, no aspect-based deletion, explicit partial coverage, no auth bypass, one canonical customer record representation. Physical card and credit remain distinct. Do not claim exhaustive pagination when gateway contract provides no cursor/completeness data.

Offline acceptance:
- Exact three-turn service lifecycle retains original inbound issue and new details in both serialized model stages; no duplicate/current-message replay and no cross-run/customer history.
- Simulated inbound write failure is observable; outbound-only history is not called complete.
- Event fixture yields both events before extraction; follow-up target leaves both records in profile; typed result refers to correct event; no RSVP effect.
- Disabled/failed/empty/unauthorized sources remain distinguishable through reply evidence.
- Existing identity-refusal and verified RSVP/OTP tests remain green; model proposals cannot authorize new reads or writes.

## Coordinator — integrate, simplify, and finish the evidence

C1. Reconcile all 46 reported failures in `tests/agent-service-information-flow.test.ts`. Record test name, old assertion, new contract, and disposition. Replace obsolete assertions that forbid authorized prefetch or pin deleted internal modules with assertions about authorized facts, calls deduplicated within the turn, requested effects and delivered-request inputs. Preserve negative authorization/mutation/identity checks. A real regression gets a source fix assigned to its owner; do not skip, quarantine, reduce thresholds or delete a test merely to turn the suite green. Limit migration to the changed complete-context contract, not unrelated planning improvements.

C2. Update the existing physical-card live case's forbidden orders-read expectation. All-root prefetch is permitted only in authorized scope; unauthorized operations and effects remain forbidden. Preserve semantic acceptance for physical card versus gift, preparing versus shipped and no invented settlement. Do not require exact wording or mention of every field. Fix auth fixture dependency through a synthetic fixture identity and local validation. Version changed oracle contracts and record rationale. Do not run these cases live.

C3. Expand `tests/complete-customer-context-serialized.test.ts` to cover real service entry and continuation, including the original 7,023-byte branch. Measure instructions, schema, dynamic input and canonical-profile bytes separately for both extraction and reply. Inspect the loaded prompt files and schema for duplicated instructions and irrelevant backend source/aspect choices. Remove redundant guidance using current builders; do not remove authorized profile data or move rules into input to fake savings. Keep the earlier 6,000-byte established-support extractor instruction target; explicitly report entry versus continuation. Do not apply that size target to customer records.

The same tests must prove the original full-profile invariant under empty/wrong extraction proposals, more than four details, older records, partial failures and a post-auth scope change. Any newly modified customer projection must be exercised through actual `spec.input`, not a hand-built ideal object. No production raw-message logging or new telemetry service is needed for this proof.

C4. Run typecheck, lint on changed TypeScript, coverage registry test and an explicit list of touched/related offline test files. The list includes CLI/import/preflight/quota/partial-results, message fixture/state, complete-context serialization, the full information-flow test FILE, and the existing relevant auth/RSVP/effect suites. Inspect setup first and deny external network for tests; cloud SDK clients must be mocked. Do not invoke bare `npm test`, repository-wide `check`, any live evaluator, a build script that uploads, or a helper whose import can execute a CLI. Broaden only to a directly affected offline dependency test and document why.

C5. Update `docs/implementation-log.md`, coverage entries with actual commits, and a short completion ledger `docs/diagnostics/final-offline-context-corrections-2026-09-23.md`. Record source and exact commands, baseline and final failures, reproduction-to-fix evidence, byte/read measurements and remaining uncertainty. Keep historic run artifacts unchanged. Commit by coherent responsibility after integration; preserve unrelated work. No placeholders posing as commit hashes.

## Definition of done and stopping rule

Implementation is complete only when:
1. CLI imports cannot run evaluations, explicit selection is mandatory, fixture validation precedes dispatch, and overlapping target runs are rejected offline.
2. Exhausted quota neither retries nor cascades into later stages; partial/unjudged results remain truthful.
3. Real fixture/service lifecycle preserves inbound conversation and complete customer profile through serialized extractor/reply inputs.
4. Pending-event fixture resolves through the real prepared-context path, with correct provenance and no mutation; original failure categories survive projection.
5. All 46 compatibility failures have documented, justified resolutions; touched offline suites, typecheck, lint and coverage checks pass with zero network/model calls.
6. Physical-card improvement and auth/effect safeguards remain; no new response templates, case routing, memory subsystem or duplicate projector.
7. Entry/continuation prompt measurements and field conservation are published, commits are reviewable, and deployment/live verification is explicitly marked NOT PERFORMED.

Do not describe an offline candidate as proven production-ready. If a source defect cannot be reproduced or fixed within these boundaries, finish independent packets and record its exact unresolved counterexample; do not speculate, add a workaround or spend money. Stop after the offline handoff. There is no automatic next test/deploy/promotion step.

## Fresh-thread delegation prompt

Implement `docs/plan/2026-09-09-lean-conversation/final-offline-context-corrections-2026-09-23.md` fully, OFFLINE ONLY. Read the whole document and current AGENTS.md before delegating. The package supersedes all earlier deploy/live-test instructions: zero AWS/network/paid model calls, zero live gates, zero promotion. Use two sub-agents with the exact A/B ownership and parent coordinator responsibilities. Give each the entire goal/evidence/constraints, not only their file list; they share the checkout and must preserve others' work. Retain complete authorized profile before extraction. Correct import-triggered evaluation, selection/preflight/quota handling, missing inbound continuity, prepared-event fixture/result propagation and stale contract assertions. Reproduce each defect offline before fixing its first causal boundary. Do not add prompt exceptions, another memory system or canned prose. Do not use the accidental mixed-deployment run to judge the new candidate. Complete the explicit targeted offline proofs, resolve the 46 information-flow failures honestly, measure real serialized entry/continuation inputs, update coverage/log, commit coherent corrections and stop with the completion ledger and remaining live uncertainty. Do not ask for another funded test or silently perform one.
