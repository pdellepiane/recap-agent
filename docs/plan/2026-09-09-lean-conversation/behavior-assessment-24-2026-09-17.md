# Support behavioral assessment: 24 cases, 45 turns

## Status and purpose

Proposal audited against e0520ef5 on 2026-09-17. No live run performed. Schema loading, exact case existence, mandatory hard semantic judges, hard structural assertions, and fixture-coverage validator all passed for the selection. These are offline structural checks, not proof of live usability or complete backend isolation. Oracle hardening below remains REQUIRED before running. Do not label this panel fully validated or production-approved yet.

Machine-readable selection: behavior-assessment-24-2026-09-17.json in this directory. It contains exact IDs, source files, versions and current SHA-256 digests. Regenerate digests after the specified repairs; never silently run different case bytes. Keep the full 120-case suite intact. This is a support assessment, not a replacement release gate or evidence about all planning behavior.

## Selection and the question each case answers

All files below are under evals/cases/. Prefix live-behavior- is omitted except the close case.

| # | File suffix (.yaml) | Customer behavior tested |
|---|---|---|
| 1 | support-pending-question-completed | Resolve a reference and answer now; no promise-only response; thanks does not restart |
| 2 | accountless-guest-event | Provide authorized venue/address without unnecessary login |
| 3 | purchase-martha-accountless | Present useful alternatives from multiple purchases |
| 4 | owner-customer-payment-relevance | Unknown balance stays unknown; no unrelated abandoned-cart recital; thanks |
| 5 | current-campaign-order-maria-jose | Current named order versus historical declined record; this does not alone prove implicit campaign inference |
| 6 | customer-event-task-continuity | Ana → Marta action+time → Ana → thanks; exact entity continuity and one write |
| 7 | rsvp-unmatched-named-event-no-mutation | Missing named target never causes mutation of another event |
| 8 | s11-rsvp-durability | Confirmed attendance effect with durable receipt |
| 9 | rsvp-host-set-declining-consistent | Honor authoritative attendance even if host policy changed hasResponded |
| 10 | rsvp-plus-one-not-eligible | Unsupported companion change never becomes false success |
| 11 | host-withdrawal-diana | Role correction, policy limitation, one takeover, event follow-up |
| 12 | otp-terminal-handoff-unknown | Uncertain handoff outcome never silently retried or called successful |
| 13 | auth-refusal-closes-query | Respect refusal; no renewed OTP loop |
| 14 | accountless-event-before-private-auth | Answer public/phone-authorized part without exposing private information |
| 15 | continuity-text-image-same-turn | Image+text in one invocation |
| 16 | image-file-delayed-question | Image first, later text, same retained context |
| 17 | continuity-question-needs-image | Text first, later image resolves pending request; never ask for media |
| 18 | image-expired-reference | Honest unavailable image response, no invented pixels or resend demand |
| 19 | s01-frozen-world-identity | Fixture-bound customer/order identity and pending-payment truth |
| 20 | concurrent-support-turns | Same-chat concurrency preserves context/identity, no duplicate effects |
| 21 | owner-planning-to-faq-transfer | An existing planning context does not hijack customer support |
| 22 | spanish-only | Understand mixed-language input; respond naturally in Spanish |
| 23 | live-feedback-token-close-flow | Shared close path, authorization, effect receipt and delivery integrity |
| 24 | jose-campaign-acknowledgement | Campaign context and acknowledgment without unnecessary action |

No blind repetition: each thread runs once with sequential turns and real shared context. The concurrency case alone deliberately overlaps its specified inputs. Never parallelize turns within other threads. Separate fixture namespaces across cases and configurations.

## Mandatory oracle repairs before this can be called hardened

Evaluator lane owns case YAMLs plus existing evaluator tests; no runtime/prompt fixes mixed into this stage. Preserve R05 version history and previous run results.

1. Confirm repaired cumulative pins remain: continuity0/1/1/1 and Diana0/1/1, with no replays. Preserve same-turn forbidden writes. Offline mutation: changing the last count to2 must fail. Missing ledger evidence is an error, never assumed zero.
2. support-pending-question-completed turn0 must allow either a bounded selection question OR both correctly labeled candidate times. Giving both facts is useful and avoids an unnecessary turn. Turn1 must answer Ana directly regardless of how turn0 responded. The offline runtime twin, rather than a forced live clarification, proves the pending-request branch. Keep no-write and no-event-mixing checks.
3. owner-customer-payment-relevance thanks must accept classifier-suppressed delivery or a brief natural acknowledgment. Neither can restart payment explanation or claim approval. Describe Yape/Plin as a recorded payment method, not evidence the order is paid. Do not require a visible reply solely to make a judge score possible.
4. accountless-event-before-private-auth must stop forbidding all order/gift root reads. Permit only those authorized for the fixture's trusted identity, preserving bans on unauthorized account data, unnecessary authentication and private-field disclosure. Update semantic references to forbidden global lookup consistently. Preserve the existing scoped disclosure policy: this venue/status question need not disclose card method; the rubric must not simultaneously declare that disclosure unrestricted while a hard assertion forbids it. Ground the omission in the requested aspect, not a generic word blacklist. Verify each allowed root against gateway authorization; this is not blanket read permission.
5. Replace selected node_transition, route_kind and previous_node implementation pins with observable behavior assertions: correct facts, identity, action receipts, delivery and absence of prohibited effects. Do not merely drop the only hard structure. In concurrency, remove scheduler-attempt-count>=2 as customer quality; verify overlapping execution and persisted context with existing coordination evidence, not a required retry count. Internal architecture telemetry can remain diagnostic.
6. image-file-delayed-question must assert deliberate first-turn suppression, persisted attachment usability on the next turn and zero unauthorized effects, rather than exact plan_persist_reason=image_file_silence. Same-turn/text-first image cases should judge correct native context use, not a required retired tool name. Preserve native attachment binding proof and digest-bound judge-only pixel ground truth.
7. Remove conversational text_not_contains pins that can reject negation (e.g. 'no está registrado con éxito') or legitimate names/URLs. Preserve the corresponding hard semantic no-false-success/no-resend/no-unrelated-cart rules. Keep deterministic exact checks only for actual protected secrets/IDs and numeric/effect invariants, not ordinary words. Spanish-language quality must not fail solely for the widely understood word email, a brand, or a backend-provided URL.
8. For each selected turn containing an actionable question, verify a hard semantic expectation covers its answer, or deliberately add it. Several long-thread cases currently judge only a final turn. Do not infer whole-thread quality from the final sentence. Control cost by using existing turn expectations; document any additional judge-call budget before execution.
9. A fixture with an unknown fact must not require its invention. A fixture with an available fact must expose it to the judge through the existing evidence projection. For image tests, image truth must remain judge-only and bound to the exact attachment; never inject oracle facts into runtime.
10. Preserve truthful async limits: a takeover receipt proves submission, not eventual human resolution or a promised date. No mandatory questions after an already adequate answer. Acknowledgments without actionable tasks remain valid.

## Offline hardening proof

Use the existing EvalLoader and assertLiveRegressionFixtureCoverage (already checked on all24) plus existing receipt/oracle/manifest tests. Do not build another runner or classifier.

Required fault injections against existing scoring mechanisms:
- A second RSVP or takeover mutation must fail the cumulative effect gate.
- A wrong event/guest ID must fail identity checks even if the prose sounds correct.
- Absent receipt evidence must error, not produce a passing zero.
- Replacing an available answer with promise-only content must be represented as a failing semantic counterexample; mocking a judge proves only packet construction, not real judge agreement.
- Receipt pixels alone must never establish backend payment approval.
- Suppressed thanks must pass when explicitly allowed; unexplained blank delivery on a substantive question must fail.
- A valid answer phrased differently must not be rejected by a text blacklist or node pin.

Inspect fixture source/gateway calls as well as fixture registration. Verify every backend effect is fixture-routed; OpenAI generation/judging remain real on the eventual live run. Live harness AWS transport, deployment authentication and ledger access are real dependencies. Do not claim that mocking business APIs eliminates them.

## One bounded run, only if subsequently authorized

Do not run this now. Before authorization, decide explicitly whether this24-case assessment is an additional paid panel or whether to run the existing full120 gate and report these24 as a predeclared subgroup. The latter avoids spending on duplicate runs and is preferable if the user still intends one full gate. Never substitute24 for the release gate silently.

Freeze runtime artifact SHA, model IDs, effective reasoning settings, case/fixture versions, oracle version, evaluator commit and24 selected IDs before deployment/run. Verify dev artifact identity before and after. STS se-dev/us-east-1/account684516060775. Use existing bounded scheduling, case concurrency4, judge concurrency2, existing deployment/global effect lock1 where applicable; no new queue. No semantic retries or best-of selection. Report transport retries separately under existing policy.

Budget honesty:45 conversation turns, not24 calls. Extraction/reply/classifier plus per-turn judges contribute separately; silence can reduce calls and reasoning adds tokens. Prior panel time/token rates are not a guarantee. Estimate from actual serialized inputs and selected judge expectations before authorizing paid execution; provide no invented minute or dollar guarantee. If the cost exceeds the user's remaining cap, stop before starting rather than truncate and call the panel complete.

## Reporting and acceptance, frozen before the run

Report four independent dimensions for every thread and turn:
1. Integrity: authorization, entity identity, actual effects/receipts, isolation.
2. Usefulness: answered actionable question or completed authorized action; honest specific limitation if impossible.
3. Continuity: correct target, retained context, no unnecessary repeated task/questions.
4. Presentation: readable Spanish, relevant detail, no unnecessary process narration.

Keep original hard gate results. Add evidence-backed adjudication columns product defect / oracle defect / infrastructure error / presentation-only. Every reclassification must cite user text, delivered answer, tool/receipt evidence, and exact expectation. Never relabel this original run green or silently relax a rubric afterward.

Panel recommendation 'usable on tested support journeys' requires all24 completed with0errors/0skips, zero integrity/effect/delivery blockers, and every actionable request satisfactorily addressed. Presentation-only preferences may be described as polish, not hidden as functional failure. An unresolved oracle defect yields inconclusive formal status until repaired; four broad percentages must not conceal one critical violation. Even24/24 does not establish statistical reliability or validate excluded flows.

Explicit exclusions: comprehensive provider planning/search, all OTP branches, all plus-one combinations, arbitrary campaign formats, URL-only media transport, outages/load, repeat-run variance and all remaining full-suite cases. Do not claim these are covered by this panel.

## Handoff

Evaluator owner: implement only oracle repairs and fault-injection tests above; preserve production runtime. Coordinator: independently inspect each selected case/fixture, regenerate JSON versions/digests, record exact offline results, and freeze manifests. Do not run a paid panel. If runtime defects surface during hardening, report exact reproducer separately rather than changing runtime to satisfy a mistaken oracle.
