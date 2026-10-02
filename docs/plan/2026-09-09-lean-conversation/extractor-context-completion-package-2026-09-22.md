# Extractor and context completion — binding implementation package

## Objective, baseline and authority

Finish the contradictions identified in docs/diagnostics/2026-09-22-stored-request-promotion-audit.md. Baseline e534064a and run8a0dac96; inspect current HEAD before editing and accommodate intervening changes. The audit retrieved74 stored model calls (19 classifier,28 extractor,27 reply), not hypothetical prompts. Private evidence index: .openai-audits/review-8a0dac96/index.json. Read AGENTS.md and the audit first.

Outcome: structured extraction identifies the request without guessing backend ownership; the existing executor obtains necessary authorized facts; one organized context reaches a single final reply. Runtime validates access, exact IDs and effects, not conversational wording. No new agent, classifier, model stage, generic execution loop, persistent cache, state machine, fallback prose or output replacement. Keep low reasoning and existing model configuration. No model/provider migration.

This package authorizes offline implementation/testing/commits only. Earlier single paid runs have been consumed. Prepare the next dev deployment and frozen live panel, but execute neither without new authorization. No production promotion. Offline completion and live acceptance are separate statuses; never claim the former proves the latter.

## Decisions fixed before delegation

1. Source and aspect are independent. Shipping/payment/amount never select a backend partition by themselves.
2. Distinguish unresolved source from an empty source. Add request-only resource `purchase_discovery` alongside existing orders/gift_purchases. Keep backend/result PurchaseResource limited to the two real sources; use a separate request-resource union. Do not add confidence floats, parallel source flags or a second source-selection object.
3. Discovery is expanded by the existing executor to at most one read per available authorized source. Preserve the originating request ID plus deterministic child IDs and per-source coverage. Known verified record/source uses a single-source refresh. No speculative both-source read on unrelated FAQ, RSVP, thanks or non-receipt images.
4. Multiple authorized records do not prove unresolved conversational reference. The reply model may resolve read-only references from explicit text/history. A write still needs a validated structured target before execution.
5. Support availability, consent and result are different facts. Offering an available action is not executing it; a read miss never authorizes handoff.
6. Backend unknown differs from omitted/not requested. Preserve authorized useful record facts; sensitive-field disclosure remains enforced. No gift-type-only settlement, delivery or recipient claims.
7. Correct semantics, not sentence matching, defines success. Existing case IDs stay; no larger live suite for this package.

## Ownership and integration order

Use two implementation subagents and one verification subagent. They share a tree and must not revert each other's work. Coordinator owns integration, shared-file ordering, commits, coverage SHAs and final validation. Never edit a shared file concurrently.

- Owner A: extractor/source contract. Owns src/core/information.ts, src/runtime/extraction-schemas.ts, src/runtime/information-orchestrator.ts, prompts/extractors/* and corresponding schema/orchestrator tests. Owns source normalization/receipt expansion portions of agent-service.ts by coordinator reservation.
- Owner B: reply evidence and prompt composition. Owns src/runtime/purchase-reply-projector.ts, src/runtime/customer-context.ts, src/runtime/reply-evidence-projector.ts, prompt registry/compiler/loader, applicable reply prompts and related tests. Owns operational-note/continuity portions of agent-service.ts and model-request construction in openai-agent-runtime.ts by reservation.
- Owner C: independent verification/evals. Owns existing affected YAMLs, fixtures and evaluator tests only. Review A/B changes independently. No runtime fixes or threshold changes. Can inspect artifacts and prepare expectation revisions while A/B implement.

Wave0 coordinator: freeze baseline fixtures/test outputs; define request/resource types and source discovery expansion interface with A, then notify B/C. Wave1 A implements backend contract while B implements reply/context changes in disjoint files and C revises contracts. Wave2 coordinator reserves shared files sequentially, integrates actual extraction/reply construction and all tests. Wave3 C reviews integrated implementation and counterexamples; coordinator fixes findings and runs the full offline checks. No lane may call its work complete on object-level tests alone.

## A — Give the extractor a coherent job

### A1 Source contract and normalization

Trace openAiInformationRequestSchema → normalization → pending information request → executor. Add purchase_discovery to request-only resource types; update every exhaustive consumer, schema and persisted request validator cleanly. No compatibility shim. Keep source-specific result types and capability checks.

In prompts/extractors/information.txt replace the conflicting aspect-based source paragraph and examples with one subject-based contract: established shop order/cart uses orders; established gift purchase uses gift_purchases; unknown ownership uses purchase_discovery. Gift names, shipping questions and amounts are not unique record IDs. Preserve explicit event references as context, without treating populated eventHint as validated identity. RequestedOperation and resource must agree: add purchase.read as the generic read operation in the existing capability registry for discovery; it grants no new access and expands into existing per-source reads. Do not default missing source to orders. Do not expose backend source choice to the customer.

Remove semantic branch instructions elsewhere that contradict this contract. Inspect capability_boundary.txt, extraction schemas/descriptions, runtime normalization and available-operation input. A domain operation list saying 'none' must not contradict a request to identify a domain operation; distinguish allowed actions from recognized requested operations using existing typed capability data.

### A2 Read execution

Use existing request execution, scoped promise maps, bounds/deadlines and capability checks. Resolve purchase_discovery before single-source gateway invocation; independent source reads run together. Authorization unavailable for one source becomes source coverage, not an attempt to bypass access. Do not infer identity from receipt pixels/campaign phone strings. Known record/source read skips irrelevant source; details follow within the turn only where endpoint contract adds needed facts. Do not reintroduce redundant filtered list reads.

Remove receipt-only parallel source logic now replaced by generic discovery expansion. Recognized receipt assistance can create one discovery request even without a separately emitted purchase question. Preserve thanks/non-receipt behavior. Stop after bounded execution; no reflexive broad retries after an empty lookup.

### A3 Extractor prompt cleanup through existing compiler

Coordinator/B implements file selection; A owns semantic prompt text. Extraction emits JSON and does not need customer persona, stylistic examples, vocabulary substitution lists, punctuation rules or provider-display prose. Exclude shared/agent_personality.txt, shared/output_style.txt and conversational shared/common_anti_patterns.txt from extractor bundles. Replace shared conversational base with existing extractor/base_system invariants where needed: structured extraction, context, no invented facts, task changes versus acknowledgements. Do not duplicate entire system prompts.

Keep compact cross-domain recognition on new/unknown turns so genuine planning requests still work. Include detailed planning extraction only with established planning capability/state; do not use keywords to choose modules or lock support sessions against topic changes. Include auth/image/RSVP detailed instructions only when applicable existing typed context requires them, while retaining enough recognition to detect a new request. No new classifier call.

## B — Evidence supports reasoning; it must not predetermine conversation

### B1 Remove count-driven selection

Update filterPurchaseCandidates, selectPurchaseReplyOutcome and their consumers together. Delete needsSelection=length>1 as a semantic assertion and the independent length>1 selection override. Keep candidate count as factual metadata. Retain genuine validated-reference mismatch/explicit unresolved selection facts separately; never force a match.

Delete the operational note requiring a question solely because several purchases exist. Delete forced select_purchase/missing purchase_selection evidence for multiplicity alone. A read answer may use the model's interpretation of the authorized candidate facts and explicit user reference without an extra model call. Do not persist a selected ID from free-form prose or use it for a later mutation. Keep structured target validation for effects.

### B2 Available help without unintended action

Expose existing handoff capability availability and missing prerequisites as typed reply facts, independent of actual handoffOutcome. Reuse capability projection; add no new support service. Never claim availability when runtime configuration disallows it. Offers need no mutation; execution requires existing humanHelpIntent/accepted-offer logic and verified receipt.

Remove the generic purchase 'permitted_next_action:none' framing if it incorrectly implies no help is available. Preserve actual prohibited actions and auth boundaries. Delete 'Responde solo con los campos solicitados' and unsupported operational-note directions. A scoped task instruction may say to help with an unresolved question using available capabilities; no exact offer phrase or required question form.

### B3 Canonical factual record and provenance

Keep one complete authorized record body in detailedPurchases; purchases/candidates should carry only useful references/selection facts, not duplicate null-heavy financial summaries. Remove contradictions such as totalAvailability:available beside grandTotal:null where a known total was only projected away. Preserve known paymentStatus, item quantities/amounts/rowTotals, event identity, shipment state, currency missingness and relevant policy. Preserve sensitive-field protections and source conflicts.

Do not conflate approved purchase/payment state with host-credit posting, availability or bank withdrawal. Keep existing chosenBy:host and fulfillment meaning. An unspecified recipient stays unknown. No arbitrary addition of a withdrawal policy that was not retrieved or verified. Unknown source facts must not be replaced with inferred business defaults.

### B4 Relevance and continuity

Delete currency/time-correction instructions from turns that contain no such correction; use existing facts instead of conditional prose. Omit planning/provider display advice from customer-support reply bundles through the existing compiler. Keep channel rendering and essential truthfulness/access invariants.

continuity_has_prior_answer must derive from actual prior delivered context, not a completed lookup in the current turn. Include support_continuity only for real continuation; first-turn questions must not be labeled supplied details. Preserve actual history and current explicit question. Do not shrink evidence to game prompt-byte checks.

## C — Existing test/oracle redesign and independent review

Use existing18-case panel. No new live IDs. Add explicit-older T0 semantic and structural evidence checks in its current case: user already names event, so no forced question or unrelated-target answer. Mixed T0/T1 must find authorized gift records with no user-provided backend ID. Use source/resource evidence rather than exclusive tool-name pins; a generic tool label alone is insufficient.

Fix these oracle contradictions before freezing:
- Supported approved status is not host-credit settlement; judge must inspect actual facts.
- Known amount used to identify a gift is permitted. Remove 'no unsolicited monetary claims' as a blanket ban; keep invented amount/currency/balance/settlement prohibitions.
- Approved receipt need not repeat amount if event/context identifies the record adequately.
- Generic credit mechanism differs from confirmed account posting. Explicit host choice matters; discretionary-use/recipient claims require supporting evidence.
- Missing useful help is completeness, not an unauthorized effect. Keep useful next-step requirement where capability is actually available.
- Apply consistent receipt timing policy without requiring the word Yape on every turn. Keep relevant72-hour policy where supported.
- Preserve truthful unavailable/empty distinctions, no re-requested image/URL, no receipt transcription dump, no fabricated effect.

Keep historical results and version/R05 notes. No global threshold reduction or post-run rescoring. Frozen KB fixture stays. Keep real integration checks separately identified. Use positive and negative rubric examples for review only; do not claim they prove live judge consistency.

## Required deterministic integration matrix

Extend existing tests/extraction-schemas.test.ts, tests/prompt-loader.test.ts, tests/runtime-actual-request.test.ts, tests/information-orchestrator.test.ts, tests/agent-service-information-flow.test.ts, tests/s09-purchase-reply-projector.test.ts, tests/gift-fulfillment-serialized.test.ts and tests/campaign-reference-context.test.ts. Reuse helpers; no additional harness.

| Scenario | Required proof at actual boundary |
| --- | --- |
| Mixed gift shipping with unresolved backend source | Both authorized roots once, gift details150/80 reach spec.input, no account-wide absence, no extra user turn/mutation |
| Known gift/order source | Only needed source read; aspects cannot change it; no redundant detail read |
| One unauthorized/unavailable discovery source | Not called or failure represented honestly; partial coverage; accessible facts retained |
| Explicit named old event plus newer record | Both facts retained if useful; no forced-select instruction; explicit context intact; mutation IDs not inferred |
| Same amounts across events, genuinely unclear question | Alternatives visible, useful discriminator possible; no amount-only ID inference |
| Exact unmatched ID/reference | No silent retarget; mismatch preserved separately from record multiplicity |
| Physical gift, no shipping details | Typed support availability/missing prerequisites visible, no handoff attempt; accepted follow-up writes once |
| Credit approved/pending and physical card | Separate host choice, posting unknown, payment status and card preparation; known amounts preserved |
| Fresh question vs continuation | Empty-history prior-answer false; true delivered history retained; no irrelevant continuation directive |
| FAQ schedule late in passage | Existing complete-passage fix preserved; no clipped answer; unrelated gift instructions absent |
| RSVP+image+skipped handoff and root A+B | Existing serialized proof preserved, one reply, no lost facts or duplicated effects |
| Genuine planning request/topic switch | Planning capability remains recognized; do not disable planning to reduce support prompt size |

Tests must capture real production spec.instructions/spec.input and mocked gateway invocations. Stub extraction to test executor invariants, but label that proof accurately: it does not prove model extraction accuracy. Actual extractor prompt content/schema/relevance gets separate production-spec assertions; live existing mixed case verifies semantic extraction after deployment.

## Verification and finish

1. Before changes, reproduce mandatory selection despite explicit event and contradictory support availability in actual serialized specs; record baseline failing assertions. Capture current source-selection/byte metrics.
2. Implement A/B/C and pass the same tests. Mutation/negative controls: replacing discovery with orders must fail mixed proof; reintroducing count=>selection must fail old-target proof; dropping support availability must fail offer-context proof; restoring masked known facts must fail parity proof. Controls are deterministic inputs or temporary isolated patches, not extra model generations.
3. Measure actual serialized instructions/input bytes and schema bytes for initial mixed purchase, established purchase, FAQ, RSVP, native image and planning. Extractor must contain no customer-writing style modules. Support instructions must remove irrelevant planning and conditional-note prose. Instruction bytes must decrease for affected extraction/support paths; factual inputs may grow only for documented recovered facts. Report actual values, not arbitrary padding reductions. Keep static instructions ordered before changing context and existing cache keys; no customer IDs in cache keys, no broad cache rewrite. Cache-hit improvement requires live metrics, not a claim from smaller prompts.
4. Run typecheck, changed-line lint, affected offline suites, coverage registry, then full offline suite once after integration. Keep historical skips and truthful failures; no quarantines. Record real commit SHAs using repo coverage sequencing.
5. C reviews final diff and actual serialized counterexamples independently. Coordinator resolves every material finding within scope. Shared safety proof must include no cross-identity disclosure, unchanged effect deduplication/auth, no fixed replies, no additional model stage.
6. Track this package and audit summary in git with scoped commits; preserve unrelated dirt. Update implementation log with exact tests, backend-call counts, measurements, unresolved issues and no-live status. Do not include private raw audit files in commits.

## Definition of done and live handoff

OFFLINE DONE only when all three lanes are integrated; no obsolete forced-selection/only-requested-fields consumers remain; source uncertainty has an executable bounded contract; canonical facts/available actions are coherent; extractor no longer carries customer-style instruction dump; tests and independent review pass. Return commit list, changed/deleted files, baseline-to-fixed proof table, prompt sizes, call counts, updated oracle versions and frozen case manifest.

LIVE READY is a prepared dev deploy + one existing18-case invocation with ordered IDs, versions, expected turn counts, fixture/judge identities and budget estimate. Derive counts from parsed files. Current authorization does not execute it. Procedure: deploy exact validated artifact using existing workflow, se-dev/us-east-1/STSacct684516060775; fail before paid calls on missing/mismatched provenance; sequential turns per case, existing bounded concurrency; no automatic semantic retries. Inspect raw requests and every delivered turn on the new run. No production promotion included.

LIVE ACCEPTED requires the runtime changes work on the bound artifact: mixed gift discovery succeeds without user ID; explicit old target answered without redundant clarification; support limitation includes an actually available useful next step; no invented recipient/purpose/settlement; all required deliveries/effects truthful. Separate oracle/harness defects from product defects without waiving failed scores. Any later runtime edit invalidates the tested identity. A green targeted panel is not a full-suite or matched-production comparison.

Stop only for a demonstrated external blocker, exhausted explicit authorization, or a change outside these contracts—not because a lane delivered partial code. Do not launch another architecture proposal. If backend endpoint semantics prevent a requirement, document the exact contract and complete unaffected work. Do not silently invent a workaround or declare done.
