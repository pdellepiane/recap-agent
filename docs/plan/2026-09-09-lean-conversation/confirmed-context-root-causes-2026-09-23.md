# Confirmed context root causes and final offline corrections

## Binding scope

This document replaces the exploratory implementation directions in `final-offline-context-corrections-2026-09-23.md` and all deploy/live-test permissions in earlier packages. Implement the decided corrections below; do not delegate open-ended diagnosis or redesign.

**Offline only. No deployment, AWS calls, live Lambda, paid model/judge calls, full gates or promotion.** Explicit affected offline test files, mocked external clients, typecheck and changed-file lint are authorized. Preserve unrelated working-tree changes. No runtime prompt rewrite, additional model call, new memory system, retry framework or state machine. The user's current restriction overrides older repository deployment requirements.

Product invariant: complete authorized customer profile before extraction, same canonical facts to extractor and responder, actual conversation history retained. State validates access, capabilities and effects. The model interprets and answers. Do not fix missing evidence with more instructions or canned responses. Keep model configuration unchanged.

## Audited state and evidence limits

Audited HEAD: `e72b2053`; implementation `49000e34`; coverage `02a2a3fa`. Inspect current state before editing; never overwrite newer unrelated work.

Candidate deployment recorded in the log: artifact `a659847df81d7c71d8c42e6ba3f18d2e43b54083f1fdfb1c38f49adf360f1555`, CodeSha256 `plmEffgdfHHYxC5ro/GNLkO1QIPx/fscOPSa3zYPFVU=`.

Intended run artifacts:
`/Users/leonardocandio/.codex/worktrees/complete-customer-context-deploy/recap-agent/.eval-runs/eval-2026-09-23T18-31-04-722Z-cd8df759/`

The accidental run `e9c6f9d7` began on OLD artifact `578fd0d9…`; deployment changed during execution at 18:29:30. No final deployment check exists. Do not attribute its aggregate or individual product results to the new implementation without per-invocation identity. This correction package excludes those outcomes from candidate assessment.

The intended run has incomplete artifacts and no successful semantic judges. A snapshot marked passed is execution status, not semantic acceptance. Quota failures and missing setup are not evidence of poor generated answers. No raw serialized live request bodies were retained, so field-by-field live conservation remains unproven.

The audit used source inspection and read-only local Node/tsx probes of existing classes with local fixtures. No model calls, AWS calls, source edits or test-suite execution were used to obtain the two reproductions below. This is not a claim that every code path or all 46 reported compatibility failures was audited.

## Finding 1 — inbound messages are corrupted when read from Dynamo fixtures

**Confirmed and locally reproduced.**

Files/boundaries:
- `src/runtime/eval-fixture-state.ts`: `FixtureMessageDelivery` includes `received`; `DynamoEvalFixtureStateStore.toLoggedMessage`, around lines 577–579, does not accept it.
- `src/runtime/eval-fixture-gateway.ts`: `logMessage` records inbound as `received`; `mergeFixtureHistory` admits only `received` and `sent`.
- `src/runtime/agent-service.ts`: history is read, then the current inbound is logged for subsequent turns.

Causal chain:
1. The customer message is stored with `delivery: received`.
2. Dynamo deserialization recognizes sent/suppressed/failed/unverified only and defaults received to unverified.
3. History merging correctly rejects the resulting unverified record.
4. Subsequent requests retain assistant replies but lose original customer questions.

Read-only probe: passing a valid stored inbound row with `delivery: received` through the actual Dynamo decoder returned `unverified`.

Live match: support-detail T1 history contains one outbound message; T2 contains two outbound messages; the persisted plan summary is empty. The extractor eventually states that the customer has not specified the problem and the responder re-asks it. This is a concrete mechanism consistent with the observed failure, not a measured guarantee that this single repair eliminates every possible re-ask.

Scope: this decoder is in the evaluation fixture store. It does not prove production's separate message endpoint loses messages. Do not alter production conversation behavior to compensate for a fixture corruption.

### Decided correction

Accept `received` in `toLoggedMessage` alongside the other valid delivery values. Keep unknown-value fallback unchanged. Do not admit genuinely unverified records in `mergeFixtureHistory`, change keys, weaken isolation, add summary memory or add a prompt instruction.

### Required offline proof

Use the public Dynamo store read path with a mocked document client, not only direct access to the decoder:
- received and sent survive; unverified/suppressed/failed remain excluded by history merge;
- in-memory and Dynamo-backed fixture stores produce equivalent histories;
- prior inbound question and actual outbound reply enter the next turn; current inbound appears once;
- duplicate message IDs do not duplicate history; run/case/conversation/customer isolation holds;
- the actual three-turn support-detail lifecycle reaches serialized extractor and reply inputs with the original card issue and later names intact. Do not inject ideal history directly into a request-builder test.

## Finding 2 — classifier time consumes the entire customer-profile budget

**Confirmed by source, recorded timing and local reproduction.**

Files/boundaries:
- `src/runtime/agent-service.ts`: profile calls pass `handleTurnStartedAt + 7000`, including around line 1453 and other preparation call sites.
- `src/runtime/information-orchestrator.ts::prepareCustomerContext`: when that deadline has elapsed, returns zero reads, purchases failed/source deadline, and phone invitations unavailable/source deadline.
- `eventResultFromPreparedContext`, around line 1221: unavailable becomes not_configured.

Causal chain:
1. Classification happens before profile preparation.
2. Targeted pending-event classification took 9,277 ms on T0 and 10,124 ms on T1.
3. The seven-second deadline measured from turn start is already expired.
4. Preparation skips all customer reads.
5. The event result reports not_configured even though the actual cause is deadline exhaustion.

Read-only local probes with `rsvp-plus-one-multiple-pending.json`:
- Valid preparation budget: both Ana/Luis and Marta, their details, and five backend reads (guest events, two details, orders, gifts), peak concurrency two.
- Expired budget: event source deadline/status unavailable, totalReads zero; prepared result failed/not_configured/retryable false.

Correction to the prior report: a lookup tool name appears on both live question turns, but this does NOT prove a fresh backend call. The prepared-result path can report the lookup without executing the gateway. Final thanks suppression is appropriate and requires no repair.

### Decided correction

Create the seven-second customer-read deadline centrally at the start of `prepareCustomerContextForTurn`, rather than accepting a deadline computed from turn start. Remove that obsolete caller argument from its call sites. Share the deadline across all reads in that preparation; never reset it per record. Preserve current overall Lambda timeout and lock boundaries; do not raise function timeout.

When successful OTP grants a genuinely new account scope, give preparation of those new roots a fresh bounded read budget. Reuse already prepared phone roots. Do not re-fetch all roots or restart a budget on every task result.

For preparation deadline exhaustion, mark BOTH purchase and event sections failed with source deadline, independent of authentication scope. The resulting task is a retrieval failure, not missing configuration or empty success. Preserve real authorization/configuration failures. Do not enable capabilities globally or modify event fixture records to hide this defect.

### Required offline proof

With a controlled clock:
- classifier elapsed time exceeds seven seconds before preparation; preparation still reads the fixture roots;
- expiry inside the preparation budget produces explicit failure/partial coverage and no fabricated absence or not_configured;
- both events/details reach the canonical profile and actual serialized model requests; follow-up preserves both records and does not mutate RSVP;
- prepared results reuse roots, concurrency remains bounded, post-auth scope extension does not duplicate phone reads;
- identity refusal and existing effect-verification tests remain green.

## Finding 3 — importing preflight can launch a full paid evaluation

**Confirmed source defect and recorded incident.**

`src/evals/live-behavior-cli.ts` calls main whenever VITEST is absent (around line 243). Selection omitted at line 217 becomes undefined, selecting the full suite. An import intended for local preflight therefore launched 138 cases.

### Decided correction

Separate import-safe reusable selection/preflight logic from actual executable startup, or use the repository's verified direct-entry convention. The behavior CLI must reject missing/empty explicit selectors before network work, never default to full selection. Use one resolved selection for validation and dispatch. Validate ALL selected fixture/configuration prerequisites before dispatch, including required phone placeholders. Do not use setting VITEST as the fix.

Mocked tests: import without VITEST invokes neither runner nor network; missing selectors/invalid IDs/missing selected fixture dependency dispatch zero cases; valid explicit selection dispatches exactly those IDs. Never invoke the real evaluator to verify this.

## Finding 4 — permanent quota errors are treated as recoverable at multiple boundaries

**Confirmed source defects; not every recorded attempt can be attributed to the same error shape.**

- `src/runtime/openai-retry.ts` recognizes several permanent codes but generic 429 remains retryable. Its field search returns the first code/errorCode/type string, so an outer unrelated type can mask a nested permanent code; add a focused nested-error regression when updating normalization.
- `src/runtime/message-response-classifier.ts`, around line 317, catches all failures and returns classifier_unavailable, allowing later model stages to proceed.
- `src/evals/scorers/semantic-judge.ts::isTransientJudgeError` treats every HTTP 429 as transient.

### Decided correction

Reuse the existing shared retry classification. Detect permanent quota/billing codes before generic throttling and recognize the observed no-credits diagnostic when structured fields are absent. Ensure nested permanent codes are not masked by unrelated wrapper fields. This is infrastructure error normalization, not conversational keyword routing.

Propagate permanent quota exhaustion from classifier catch; do not continue to extraction/reply. Preserve normal fallback for unrelated classifier failures. Judge permanent quota errors receive no retry. Runner stops scheduling new paid work, preserves completed artifacts and records unfinished/unjudged outcomes without fabricating customer-semantic failures. Keep existing transient retry bounds; no new retry layer.

Mocked tests must prove permanent errors cause zero downstream calls/retries, transient throttle retains its existing bounded behavior, and partial results remain readable. No live verification.

## Additional findings and decisions

### Physical-card result improved; its structural oracle is stale

The targeted reply included the dedication “Felicidades,” physical-card preparation and not-yet-shipped state, while distinguishing the credit gift. Preserve this behavior. The case's prohibition on `lookup_guest_orders_by_phone` contradicts authorized all-root preparation. Remove only that obsolete prohibition; retain authorization, identity and effect checks and semantic distinction between physical card/product and credit. Do not require exact wording.

### RSVP evidence is positive but bounded

s11 records a verified write and delivered confirmation. Keep executor/lease/receipt protections. Unavailable judging does not justify claiming complete semantic acceptance or rewriting RSVP.

### Prompt measurements covered different branches

Observed extractor instructions were 7,023 bytes on entry versus 5,328 on continuation. The smaller offline example did not prove the entry branch. Record both through actual service-built requests; retain field conservation. Do not launch another prompt rewrite in this correction pass: the reproduced failures arise before reasoning, not from missing directions. Keep instruction-size shortfall explicitly recorded if still present.

### Forty-six compatibility failures remain unclassified

The information-flow test file reported 47 pass / 46 fail. Some expect obsolete zero-root calls or removed projections. Do not label all harmless or blanket-delete them. Run that explicit offline FILE, classify each failed assertion against the new profile contract, and update only obsolete expectations. Genuine auth/effect/identity/field-loss regressions need corrections; do not skip or weaken them to obtain green. Report unresolved failures individually. This is a bounded integration obligation, not permission to fix unrelated planning quality.

### Harness overlap and missing final reports

Both runs were incomplete and overlapped. Do not introduce a new distributed lock system in this pass. Preserve existing coordination and cancellation; the import-safe fail-closed CLI removes the confirmed trigger. Report any remaining concurrency limitation honestly rather than claiming it solved. Future execution authorization is outside this offline package.

### Evidence that remains unavailable

No reliable dollar cost or complete judge-token accounting exists. No successful semantic judgment exists for the intended run. No raw live input permits full field conservation reconstruction. Do not manufacture those measurements, rescore via paid models, or describe an offline candidate as validated in production.

## Bounded ownership and validation

If delegated, use two owners and give BOTH this entire document:
- Runtime/fixture owner: findings 1–2 and their focused existing tests. Own fixture state/gateway, service/profile timing and orchestrator mapping. Do not touch prompts or evaluation CLI.
- Evaluation/error owner: findings 3–4 and tests. Own CLI/preflight, shared retry utility, classifier quota catch, judge and runner handling. Coordinate the classifier file explicitly; do not alter normal conversational classification.
- Parent integrates, updates the existing card oracle, reconciles information-flow assertions, measures entry/continuation requests, updates coverage/log and reviews the final diff. No further subagents or open-ended exploration.

All owners preserve unrelated work and each other's edits. Keep implementation small and causal: decode one valid state, correct one budget origin and failure mapping, prevent import-side execution, and propagate permanent errors through existing handling. No extractor rewrite, new memory store, case-specific routing, response templates or extra model stages.

Use explicit affected offline test paths, mocked external clients, typecheck, changed-file lint and `tests/live-behavior-coverage.test.ts`. Include the complete information-flow test file, existing customer-context serialized proof and relevant auth/RSVP/effect tests. Do not invoke a bare full-suite command, deploy/build-upload helper or live evaluator. Preserve all historic run artifacts.

Commit coherent corrections, update `docs/implementation-log.md` and applicable coverage entries with actual commit IDs. Record exact reproduction/test commands, results and remaining limitations. Definition of done: confirmed fixes and associated integration proofs pass offline, every reported compatibility failure has a justified disposition, safeguards remain intact, and the handoff explicitly states NO DEPLOYMENT OR LIVE VALIDATION. If any obligation fails, report incomplete rather than hide it or spend money.

## Short fresh-thread handoff

Implement `docs/plan/2026-09-09-lean-conversation/confirmed-context-root-causes-2026-09-23.md`. It supersedes earlier exploratory packages. The root causes and edits are decided: preserve received inbound messages, start profile-read deadlines at preparation, prevent import-triggered evaluations, and stop permanent-quota cascades. Follow its bounded ownership and offline proofs; preserve complete customer context and auth/effect safeguards. No prompt rewrite, deployment, network/AWS, paid calls, live tests or promotion. Finish with reviewable commits, targeted offline results and explicit unresolved limitations.
