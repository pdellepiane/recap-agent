# Bounded evidence simplification — binding work package

Baseline reviewed: dbe6c4ea. Scope: offline implementation and verification only. No deployment, paid calls, live rerun or promotion. Preserve unrelated files. Read AGENTS.md and docs/diagnostics/2026-09-22-full-panel-audit.md. Earlier snapshots naming 03c19a1e are historical requirements, not instructions to restore old code.

## Objective

Deliver one coherent, authorized backend context to the existing reply model. Remove semantic filtering and evidence clipping that prevent it from answering. Preserve deterministic identity, authorization and effect validation. One customer reply may follow multiple necessary reads; no additional classifier, model pass, orchestrator, persistent cache, state machine, output template or string replacement.

## Preserve verified current wiring

information-orchestrator.executePhonePurchaseRequest starts lookupPhonePurchase before awaiting seededRootPromise. withLinked carries root evidence. customer-context assembles linkedEvents through the existing event mapper. Host withdrawal supplies typed handoffOutcome; skipped cases no longer depend on errorMessage. withCompletedRsvp preserves a non-null handoffOutcome. Do not reimplement these old fixes. Prove image/RSVP composition through existing service tests; repair only a demonstrated missing fact.

## Work 1 — Remove soft-reference erasure

Primary files: src/runtime/information-orchestrator.ts; src/core/information.ts; existing purchase projection in src/runtime/customer-context.ts and src/runtime/openai-agent-runtime.ts only if needed. Existing tests: tests/information-orchestrator.test.ts and tests/agent-service-information-flow.test.ts.

1. In filterPurchaseCandidates separate exact validated IDs/customer references from unverified eventHint/amount/date hints. Keep exact identity constraints and access scope. Stop using populated hints as proof of explicit validated selection.
2. For descriptive hints, retain the already-authorized candidate records and their items for the existing reply model. Do not transform hint mismatch into backend not_found. Represent unresolved reference and actual read coverage independently, reusing existing result fields where their semantics fit. If one field is necessary, add one typed reference-resolution result, not another persisted state.
3. Remove the single-pending/current-payment and event+amount exception branches that infer conversational identity. Do not replace them with item-name keyword matching, amount-only identity or sole-candidate fallback. An item amount is evidence available to the model, not a backend ID. Do not trim item facts to make prompt measurements green.
4. Exact explicit target absent: retain mismatch/coverage honestly; never silently retarget. Preserve established verified target/source across receipt follow-ups. No mutation target may be derived from generated reply prose.
5. Keep source routing from f285a74f and existing access-scoped read reuse. Fetch detail within the same turn only if the verified endpoint supplies necessary missing fields. Do not add read stages when the root already has the answer.
6. Inspect prompts/extractors/information.txt for conflicting eventHint guidance. Replace ambiguity-causing wording within the existing instruction; do not append examples for each failing gift. Runtime must tolerate a bad descriptive hint without erasing authorized data.

Required proof: feed the actual service mocked extraction with eventHint='luna de miel' and a valid honeymoon item under Boda Lucía y Marco; assert pending/type/item facts survive in production spec.input. Repeat amount=80 against mixed 150+80 order total230. Two equal-value items under different events retain both candidates; exact nonexistent ID never becomes a valid selected record. An old explicit record remains distinct from a newer pending one. Assert no new handoff/auth/write, no extra model call, no cross-scope data.

## Work 2 — Preserve answer-bearing FAQ evidence

Primary file: src/runtime/openai-agent-runtime.ts projectFaqEvidenceForReply. Existing retrieval/projector tests; extend tests/runtime-actual-request.test.ts if no focused test exists.

Delete the equal-prefix allocation (three hits =>600 characters each). Use ranked deduplicated complete retrieved passages under a bounded total budget. For this package use 6000 text characters total, matching the existing per-hit gateway ceiling; include complete passages in rank order that fit. This is a bounded factual-data allowance, not instruction growth. If a higher-ranked passage does not fit the remaining budget, mark coverage incomplete rather than silently clipping its meaning. Existing gateway limits remain; do not fetch full articles or add summarization. Preserve source filenames and do not duplicate evidence elsewhere in input.

Prove with a controlled passage whose schedule occurs after character600, plus two distractor hits. Schedule and source must survive spec.input. Add duplicate and over-budget passage variants; incomplete evidence must be explicit. No test may assert an exact response sentence. Do not modify production KB indexing in this package. Report if the raw retrieved passage itself lacks the answer; projection cannot repair absent retrieval.

## Work 3 — Align existing acceptance contracts, no suite expansion

Edit existing affected gift/receipt/campaign YAMLs only. No new live IDs or paid evaluations. Version changed contracts and document R05 reasons.

- Campaign: assert actual authorized purchase resource/evidence, not a phone-only trace label. Do not allow a generic read of the wrong partition to pass.
- Receipt: require grounded pending/approved state and applicable timing when useful; do not require repeating Yape if the same applicable policy is already clear. Preserve amount/currency/unknown-paid safety.
- Record state versus new action: judge semantic effect claims, not past-tense wording alone.
- Gift shipping: physical intent/preparing is distinct from shipped/delivered. Credit purpose must be grounded consistently across campaign and card.
- Unknown shipping: useful help remains a completeness requirement; missing offer is not classified as an unauthorized effect. Thanks must not invent delivery, but a courteous hope is not itself a tool action.
- Empty lookup: allow scoped no-match language; unavailable lookup must not become nonexistence.

Do not loosen structural safety, lower global thresholds, waive historical scores or add customer scripts. Freeze a mocked KB answer for the existing hours case through current fixture facilities. If no fixture facility exists, report that exact gap and implement only the small typed read-fixture seam needed by this case; no parallel evaluator framework.

## Existing-root and handoff verification — tests, not architectural rewrite

In the existing service test file reuse fixtures for root event+venue+attendance, event order A and purchase root A+B with one optional hydration failure. Assert actual spec.input retains A/B, stable event identity and partial coverage. No name/date merging.

Reuse image and completed-RSVP fixtures to prove missing-phone and unavailable-capability handoff outcomes remain distinguishable in spec.input, independent of operational notes, with one final composition and no attempted skipped write. If tests already prove the exact combination, cite them rather than duplicate them.

## Verification gates and stop conditions

Before changing code, add failing offline counterexamples for hint erasure and late FAQ facts. Run them on the baseline and record the failures. After implementation run the same tests; passing on constructed objects alone is insufficient—assert the production serialized request and mocked gateway counts.

Run typecheck, affected suites, coverage registry and the full offline suite once after integration. Fix the observed eval-run-manifest dry-run test failure by examining its actual preflight reasons; keep live fail-closed identity checks. Make fixture/config dependencies explicit rather than weakening preflight assertions.

Measure actual instructions/input bytes and backend counts for gift, mixed follow-up, FAQ, unrelated RSVP and image-only cases. Gift evidence must not duplicate canonical records; FAQ increase must consist of source content, not additional guidance. Model-call count must not increase. Do not claim latency improvement without measuring it.

Completion: baseline failures reproduced; counterexamples pass through real paths; root/handoff preservation verified; offline checks pass; source-selection branches and equal-prefix clipping removed; no new orchestration layer; updated log/coverage with real commit identities. Return exact commits, deletions, test evidence and remaining limitations. No live success claim. If fixing an issue requires a new model stage or backend contract, stop that part and report the demonstrated dependency rather than building a workaround.
