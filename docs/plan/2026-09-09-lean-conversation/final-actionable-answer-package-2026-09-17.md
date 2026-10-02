# Final actionable-answer package — 2026-09-17

## Mission and execution boundary

Implement one bounded final round: answer actionable requests with available facts or completed authorized work, instead of ending with a promise to help. Repair the identified evaluator contracts. Enable low reasoning on current production conversational calls. Do not redesign the agent.

Starting evidence: HEAD 95bb6698, runtime c5c714b0; targeted run eval-2026-09-17T14-05-17-481Z-78653526. Verify actual HEAD before editing and preserve newer work. Read AGENTS.md and customer-support-release-work-package-2026-09-16.md. This amendment governs the specific behavior and evaluator changes below; retain the earlier identity, authorization, receipt, and release requirements.

This handoff authorizes implementation, atomic commits, and offline validation only. No deployment, targeted live rerun, full live gate, promotion, paid model call, or baseline run. Return a frozen candidate for the user to deploy. The single full gate remains available afterward. Preserve .gitignore, .ignore and unrelated untracked work.

## Evidence, diagnosis, and limits

1. prompts/nodes/resolver_consultas_informativas/support_continuity.txt explicitly requires saying the same query remains open. That instruction explains the repeated process narration; it is not evidence of a completed external action.
2. prompts/shared/base_system.txt already prohibits claiming unconfirmed work, but does not require actually satisfying a resolvable request before replying. Replace/consolidate that invariant instead of appending examples everywhere.
3. src/runtime/openai-agent-runtime.ts buildModelSettings explicitly sends reasoning.effort=none for GPT-5 extraction/reply calls. src/runtime/message-response-classifier.ts separately sends none and caps output at 128 tokens. This is not an already-enabled low reasoning configuration.
4. The support acknowledgment shortcut uses the current extraction's empty informationRequests/actionIntent. Audit it against a real unresolved pending request, not merely current-node or support_query_open. A fresh detail can complete a pending question without restating that question.
5. Diana's actual turn 0 contains only a role correction, with no seeded pending question. Do not invent an event question or dump event details to make that case look more helpful. A separate seeded pending-question case is necessary.
6. Saved continuity replies correctly answer Ana, confirm Marta and give her time, return to Ana, and suppress thanks. Saved Diana replies make one confirmed handoff. Their effect failures arise from per-turn-zero expectations against cumulative receipt counts, not observed duplicate writes.
7. Acknowledgment can be sufficient when no actionable question is pending. The violation is substituting process narration for work the agent can actually complete now. Reasoning effort may help decisions but cannot repair inaccessible evidence or an early-return bug by itself.

## Binding behavior directive

Use this Spanish instruction once in the shared conversational invariant, replacing/consolidating the existing pending-versus-done line:

> Resuelve lo que puedas de la solicitud con los datos y las herramientas autorizadas antes de responder; entrega la información o el resultado, no solo la intención de ayudar. Si falta algo imprescindible o la acción no está disponible, explica el límite y pide solo el dato necesario. Atribuye cambios o gestiones únicamente a resultados confirmados.

This is model guidance, never a canned customer reply. Do not ban future tense by regex or exact phrases. A real asynchronous handoff may still be pending: report its confirmed registration, not a promised resolution. Do not obtain new consent for already-authorized safe reads; do not treat inference as permission for a write. Never ask for images or URLs.

## Delegated ownership

Use three implementation lanes, with the coordinator integrating afterward. Every worker must be told they share the repository, must not revert others' work, and must remain within their ownership. No worker deploys or invokes live models.

### Lane A — Useful answers and reasoning settings

Own:
- prompts/shared/base_system.txt
- prompts/nodes/resolver_consultas_informativas/support_continuity.txt
- prompts/extractors/information.txt, only if the pending-question extraction test demonstrates missing guidance
- src/runtime/agent-service.ts
- src/runtime/openai-agent-runtime.ts
- src/runtime/message-response-classifier.ts
- src/runtime/config.ts if existing configuration requires propagation
- tests/support-continuity.test.ts
- tests/runtime-actual-request.test.ts
- tests/message-response-classifier.test.ts

Edits:
1. Install the single shared directive above. Remove the mandatory support_query_open recital from support_continuity.txt. Keep reported identity distinct from verified identity; preserve user-supplied names without forcing every name to be repeated.
2. Check handleInformationFlow/handleSupportAcknowledgment using a pending event-detail question followed by a role correction or event reference. An unresolved request plus sufficient newly supplied context must reach the existing information executor before composition. Reuse existing pending_requests and structured extraction; no keyword routing, new state machine, or new intent type for this fix.
3. Preserve pure role corrections, thanks, and context-only updates as lightweight turns. support_query_open alone is not an actionable task. Do not repeat a fully answered policy just because new metadata arrived.
4. Ensure the production serialized reply receives the relevant resolved facts/outcomes. Do not pass every unrelated profile fact as a narration instruction. A failed lookup must produce an honest limitation, not fabricated details or a promise of invisible background work.
5. Current explicit none becomes low for production extractor, reply, and delivery-classifier calls. Preserve model identities and low text verbosity. If the current tree has a real effective low/medium override, retain it; high/xhigh/max becomes medium. Resolve this statically through the existing typed configuration path, not a per-turn adaptive effort policy. Do not change judge reasoning or judge model.
6. The classifier's 128-token output cap must not remain with enabled reasoning: set its total output allowance to 2048, keeping its existing small structured answer schema. This is an engineering budget, not a guarantee of completion; retain explicit incomplete-response handling and test it. Do not compensate with extra retries or model passes. Leave extractor/reply caps unchanged unless demonstrably incompatible.
7. Audit src/audit/prompt-audit.ts, prompt-branch-measurement.ts and static-prompt-comparison.ts for hardcoded none in request-construction fixtures. Align representative production settings where relevant; do not mistake synthetic audit metadata for the live runtime or add another config surface.
8. Preserve stable prompt prefixes/cache keys. Do not add timestamps, customer identifiers, or dynamic task descriptions to shared instructions. Record actual extraction/reply/classifier request settings, not just a manifest declaration.

Required offline scenarios:
- Pending venue question + later event reference: lookup/read reuse and actual venue/address in serialized reply input; no acknowledgment-only shortcut.
- Pending event-time question + role correction: answer known scoped time; no invented ownership.
- No pending task + bare role correction: no forced lookup or event-information dump; no required question.
- Already answered card-policy question + supplied guest/event names: preserve context without identity substitution, duplicate action, or policy recital.
- Requested action: verified success, failure, unknown result and missing authorization remain distinct; no success claim from an attempt alone.
- Pure thanks remains eligible for suppression.
- Serialized extraction/reply/classifier requests carry the effective reasoning value. Incomplete classifier output stays an explicit failure path, never a fabricated successful decision.

Do not assert customer wording in deterministic tests. Assert effects, facts, request settings, and branch behavior; semantic wording belongs in live cases.

### Lane B — Evaluator repairs and actionable-answer regression cases

Own:
- evals/cases/live-behavior-customer-event-task-continuity.yaml
- evals/cases/live-behavior-host-withdrawal-diana.yaml
- evals/cases/live-behavior-concurrent-support-turns.yaml
- evals/cases/live-behavior-support-detail-continuity.yaml
- new evals/cases/live-behavior-support-pending-question-completed.yaml
- evals/suites/live_behavior_regression.yaml
- tests/eval-snapshot-fixture-effects.test.ts and existing receipt assertion tests
- tests/f3-oracle-revision-mutations.test.ts
- src/evals/runner.ts, existing shared semantic-judge clauses only

Decisions:
1. Keep the existing cumulative-from-case-baseline ledger semantics. Do not globally reinterpret turnIndex as a per-turn delta. For continuity: cumulative RSVP attempts/successes/replays = 0/0/0, 1/1/0, 1/1/0, 1/1/0. For Diana: cumulative handoff = 0/0/0, 1/1/0, 1/1/0. Preserve per-turn forbidden mutation checks and the final total.
2. Audit every multi-turn fixture_effect_count case. The read-only audit identified seven YAMLs with later-turn pins, with definite corrections in continuity and Diana; do not bulk-change coherent OTP/mutation cases. Missing receipt evidence never means zero. Concurrent cases retain their existing shared boundary semantics.
3. Diana role-correction rubric: relevant acknowledgment is sufficient without a pending task; a question is optional. Preserve hard no-reset, no-identity-claim, no-unrelated-gift, no-provider-menu constraints. No threshold reduction.
4. concurrent-support-turns currently requires saying the query is kept open. Remove that recital requirement. Preserve identity/context retention and its no-unnecessary-lookup/no-mutation checks. Rename misleading deterministic acknowledgment expectation IDs if appropriate; do not prescribe internal implementation as customer quality.
5. support-detail-continuity remains an acknowledgment-positive counterexample because the policy was already answered. Do not convert its added names into an unrequested account lookup.
6. Add exactly one multi-turn live regression for the actionable pending-question distinction. Seed a genuine unresolved venue/time question with existing fixture support, then supply the missing event reference, then thanks. Expected: actual grounded answer in the same turn, no extra question when evidence resolves it, no write, and no restarted task on thanks. Use existing mocks and fixture IDs; inspect fixture facts instead of inventing addresses. If an exact existing case already reconstructs this sequence, extend it and document equivalence rather than duplicate it.
7. Every behavior case retains hard structural assertions and hard text_semantic with requireJudge=true. Describe successful outcomes, not exact wording, required verbosity, or internal node names.
8. Replace, rather than append to, the existing shared judge clauses in src/evals/runner.ts near 2636/2640. The unanswered-topic clause must distinguish an actionable pending question from a bare role correction/thanks. The handoff clause must say a confirmed takeover proves request submission only; it never licenses a guaranteed human resolution, date or arrival without separate evidence. Diana turn 2 can retain the event in conversational context; do not require a claim that an external team record was updated without a receipt.
9. Keep existing positive/negative controls: live-behavior-host-withdrawal-event-followup.yaml (pending task plus identifier), live-behavior-phone-missing-information.yaml (genuine limitation), live-behavior-jose-campaign-acknowledgement.yaml (no-task acknowledgment). Read these for alignment; edit only contradictory expectations. Keep wedding-planner-location-completes-search diagnostic, without new planning runtime work.
10. Version changed oracles with R05 reasons. Preserve old artifacts. Add offline counterexamples: a real second write fails cumulative total checks; truthful role acknowledgment passes without a question; promise-only output fails when an actionable answer is available; honest limitation is not penalized when access/evidence is unavailable. Do not simulate a semantic judge with a banned-word list. Mocked judge tests establish packet construction, not real semantic performance. Extend tests/customer-event-task-continuity.test.ts only for changed registration/oracle assumptions; coordinate with the coordinator if another lane touches it.

### Coordinator — Integration, independent review, and frozen handoff

Own docs/implementation-log.md, evals/live-behavior-coverage.yaml, the support-gate manifest and the binding work-package update. Resolve shared test changes sequentially.

1. Integrate both lanes, then independently inspect service execution through production buildReplyRequestSpec/spec.input. Stub extraction only where testing deterministic execution; label that limitation. A mocked extractor does not prove live reference inference.
2. Register each behavior change against actual implementation commits and mandatory live coverage. Do not point new behavior at an old commit or use placeholder hashes.
3. If the one new case is added, suite becomes 120 = 112 support + 8 planning diagnostics. Otherwise retain 119/111/8 and document the existing equivalent. Calculate IDs from the suite and committed support manifest; do not handwave denominator changes.
4. Run typecheck, touched suites, coverage registry, and one full offline suite after integration. Existing skips must remain explained; no quarantines, blanket snapshot acceptance or test deletion to make green.
5. Capture before/after serialized instruction/input/tool/schema bytes for role correction, pending event question, mixed RSVP/read, handoff+image, and ordinary payment. New shared prompt text must replace obsolete instruction, not create duplicated rules. Preserve complete relevant factual evidence.
6. Record production effective reasoning settings and classifier cap in the candidate manifest. Test actual request serialization; configuration text alone is insufficient.
7. Freeze implementation SHA, evaluator/fixture versions, support IDs, model IDs and artifact build recipe. No dev deployment or live execution in this handoff. Existing c5c714b0 live results do not validate these new bytes.
8. On the user's later deployment, use the exact candidate, se-dev/us-east-1, STS account 684516060775, capture before/after identity, and run the single full gate only under that authorization. Planning quality may be diagnostic; cross-domain authorization, entity identity, effect truth, duplicates and delivery failures remain release blockers. Do not waive support failures or lower thresholds after seeing results.

## Completion report and stop rules

Return: exact commits/files, offline test results, concrete serialized-input evidence for the pending-question case, reasoning settings, oracle version changes, final suite/support ID counts, byte deltas, and remaining limitations. Explicitly say whether runtime/evaluator are frozen and whether deployment/live gate remain unrun.

No more architectural expansion, no new global response scripts, no automatic second-pass evaluator/model, no rolling targeted panels, no promise of guaranteed full-suite success. If a factual blocker remains, give its exact reproducer and owning file rather than labeling the work complete.

## Resume capsule — reread after context loss

We are fixing promise-only replies by removing a mandatory open-query recital and ensuring an existing actionable request reaches its normal executor. We are not making bare role corrections invent work. Current reasoning was none, so production conversational calls become low. Old targeted reds include cumulative-ledger oracle mistakes, not duplicate effects. Preserve complete profile facts, typed receipts, separated RSVP identity evidence, no image/URL requests, no canned sentences. Two implementation lanes plus coordinator; offline only; one later full gate; user deploys.

## Documentation reference

OpenAI reasoning guide checked on 2026-09-17: https://developers.openai.com/api/docs/guides/reasoning . Effort support is model-dependent; low is appropriate for bounded customer-support reasoning. Output budgets must account for reasoning as well as visible output. Do not upgrade models or SDK merely for this change; validate against the repo's adopted types and configured model.
