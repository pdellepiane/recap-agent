# Recap-agent: corrected architecture assessment and consolidation workplan

Date: 2026-10-23 (Lima). Status: proposed implementation plan; no runtime changes or new validation results are claimed.

## 1. The assessment

Recap-agent is a stateful event-planning and customer-service runtime. The LLM interprets conversational meaning and writes the response. Deterministic code controls authorized access, validates structured requests, executes effects, preserves state, and delivers model-produced content. Planning can contain multiple provider needs; customer assistance includes purchases, invitations/RSVP, authentication and support.

Five concepts explain the conversational core:

1. **State:** durable event-plan, task, ownership and request records. Request identity matters: a parked refund must not park an unrelated event question. State is scoped by channel/external identity; phone identity is an adapter/access concern, not the universal core abstraction.
2. **Evidence:** authorized customer facts, retrieved knowledge, source completeness, pending alternatives and actual outcomes, with provenance. Build the complete available authorized customer profile independently of semantic routing. Minimize instructions and redundant representations, never authorized profile records or fields.
3. **Interpretation:** model-produced structured meaning, task arguments, ambiguity and ownership-transfer proposals. Code validates these structures and established state; it does not infer intent from message keywords.
4. **Execution:** bounded reads and validated effects, including authorization, idempotency, concurrency protection, failure outcomes and receipts. An attempted effect is distinct from a confirmed effect.
5. **Composition:** current-turn model-written Spanish from evidence. Every delivered conversational span must retain model origin; deterministic code cannot append questions, replace prose or manufacture fallback replies.

This is a useful decomposition, not a proof that every implementation responsibility fits into exactly five modules. Concurrency, transport, access policy and recovery remain necessary. A smaller file count alone does not demonstrate simpler ownership.

### What the current code establishes

| Observation | Evidence | Implication |
|---|---|---|
| Customer-assistance eligibility is selected from typed state; planning, RSVP and auth obligations bypass it | `src/runtime/support-lane-flow.ts:isCustomerAssistanceTurn`; `src/runtime/agent-service.ts:handleTurn` | New routing does not own all capabilities |
| Router success handles some support outcomes directly; unavailable results and planning/RSVP outcomes retain older stages | `agent-service.ts`, router handling around lines 944–1080 | Replacement is partial; some turns can encounter both generations |
| Router-selected information explicitly calls extraction | `agent-service.ts:handleSupportInformationTurn` | Support/information is not uniformly extractor-free; nearby comments are stale |
| Three owner values and owner/task fields already exist | `src/core/plan.ts`; `src/runtime/owner-routing.ts` | Reuse existing ownership state; do not introduce a second owner store |
| Owner reconciliation still consumes extraction signals | `agent-service.ts`, call to `applyOwnerForTurn` | Persisting an owner is not equivalent to having the owner handle interpretation |
| Node state still affects executable projection and decisions | `src/runtime/extraction-projection.ts`; `src/core/turn-decision.ts`; `agent-service.ts` | Node deletion requires dependency replacement, not a rename |
| Service is 15,186 lines out of 49,528 runtime lines; review lock contains 130 pending entries | Local inspection on this date | Large maintenance surface; neither duplication nor deadness follows from these numbers alone |

Typical paths include router → composition, router → extraction → information handling → composition, and classifier → extraction → execution → composition. A router-to-planning/RSVP fallthrough can add a stage. Retries, suppression, media, transfers and tool loops change the counts. These are code-path descriptions, not measured deployed call distributions.

The defensible diagnosis is **unfinished responsibility migration**. Multiple semantic entry points remain active, and the service still arbitrates their outcomes. The stronger historical claim that every bug fix landed in the oldest layer is unproven. Safety work and feature growth can also explain some complexity.

### Correct target

An established owner receives the current turn directly and returns one typed result:

- **Respond:** model-written message plus scoped outcome/claims; no additional model stage.
- **Request work:** typed read/effect requests; code validates and executes; the same owner answers from results.
- **Transfer:** semantic target and unresolved task references; code validates at most one ordinary transfer. The recipient can answer, request work or clarify; it cannot start another ordinary transfer chain.
- **Suppress:** a structured semantic delivery decision when no conversational reply should be delivered. Adapter metadata separately enforces mechanical delivery prerequisites.

The ordinary target remains **one model call for an established no-tool answer**, and **two for an ordinary one-round tool-backed answer**. Profile preparation is deterministic I/O, not another model stage; its real latency and backend requests still count. Transfers, recovery and genuinely dependent operations are exceptions whose calls must remain visible.

Entry for an unowned conversation is transient. A Decisions-style router may serve that boundary during migration; it is not a mandatory preflight for every established owner. The target does not require either keeping or replacing that vendor API globally.

The shared lifecycle is: load/fence → prepare authorized profile and scoped task evidence → invoke owner → validate/execute requested work if needed → owner completion if needed → validate claims/model origin → persist/deliver through existing fencing and delivery guarantees. Do not silently change established effect/commit/delivery ordering while extracting this scaffold.

## 2. Execution rules

- Preserve the current dirty/untracked tree. Record HEAD and relevant content hashes; do not reset, pull over changes, apply the historical patch or infer current bytes from an old handoff.
- This plan governs consolidation. The existing supervisor package remains the source for its reported customer interactions and pending final check. Historical plan requirements conflicting with current AGENTS.md are superseded.
- One integrator owns `agent-service.ts`, `openai-agent-runtime.ts`, shared contracts and development deployments. Packages below are sequential; this plan does not request subagents.
- Migrate one capability at a time. Its old semantic path is removed in the same integration change. Unmigrated capabilities may temporarily use their existing path, but a migrated capability cannot silently fall back into it.
- Keep urgent objective correctness fixes possible. A freeze on all behavior fixes until a broad rewrite would create avoidable risk. Each fix still needs its own regression specification and coverage entry.
- Retain complete authorized profile data, native image continuity, mixed reads, event-first planning, authorization, receipts, idempotency, turn fencing and channel-independent delivery throughout.
- Store new model instructions as tracked Spanish text under `prompts/`, mapped to actual flow nodes. Use strict TypeScript without explicit `any`; runtime-written evidence remains facts rather than answer copy.

## 3. Work packages

Each package is a reviewable change with its own implementation-log entry. Split mechanical relocation from behavior changes when possible. No estimate is given until P1 identifies the actual dependency surface.

### P0 — Close the existing support candidate

**Scope:** `docs/plan/2026-10-23-consolidated-supervisor-audit/LOCAL-SESSION-HANDOFF.md`, `final-language-fix.md`, `final-language-check.json`, current runtime/prompt bytes and deployment evidence.

1. Reconcile the local checkout with the handoff by content and history; preserve unrelated work. Establish whether the latest candidate is already deployed and whether the final check already ran.
2. If still outstanding, complete only that package's remaining development deployment and frozen final check under its existing authorization and limits. Its documented extra ceiling is USD0.25 within the original USD1; verify actual prior spend and remaining allowance first.
3. Preserve the earlier failures and distinguish older passing artifacts from the latest candidate. An unsuccessful check is recorded once; no semantic retry, panel expansion or fresh improvement cycle follows automatically.

**Exit:** exact candidate/deployment digest and final targeted results, or an explicit unresolved failure/blocker. Consolidation baseline retains all unresolved findings. P1 and offline planning may proceed if AWS access is unavailable; a blocked final check is not a passing baseline.

### P1 — Establish the migration baseline and removal ledger

**Scope:** service entry points, `owner-routing.ts`, `contracts.ts`, actual request builders, prompt inventory, existing transport metrics, effect/dispatch boundaries.

1. Enumerate production branches for fresh entry, established support, router information, FAQ, purchases, RSVP, authentication, single/multiple provider needs, media, semantic suppression, transfer and failures. Record each branch's current owner, semantic stages, effects, prompt modules and fallback.
2. Capture actual serialized model requests with the existing test transport. Extend existing instrumentation only for missing requests/retries; do not create a parallel accounting framework. Include instructions, input, schemas, tools, loop requests and known/unknown usage.
3. Create a removal ledger with symbol/file, production callers, replacement, protecting tests and deletion package. Separate production, audit-only, archive and orphan prompt consumers. Do not treat 130 pending lock entries as 130 active prompts.
4. Freeze baseline/candidate scenario denominators and offline expected outcomes before changing behavior. Identify customer-profile preservation sentinels and cross-owner pending-task cases.

**Deliverables:** one branch/removal ledger and one baseline measurement artifact beside this document. No new mandatory live run merely to collect an architectural baseline.

**Validation:** extend `tests/runtime-actual-request.test.ts`, `tests/prompt-contracts.test.ts`, model-origin tests and request-accounting tests as needed. Existing fixtures must drive real builders rather than parallel mock prompt assembly.

**Exit:** every intended deletion has a known production caller and replacement; hidden retries/tool calls and incomplete source data remain observable.

### P2 — Introduce the owner turn contract and migrate support

**Scope:** `src/runtime/contracts.ts`, `openai-agent-runtime.ts`, `owner-routing.ts`, `agent-service.ts`, `support-lane-flow.ts`, request/receipt state and scoped support prompts.

1. Add a discriminated owner result for respond/request-work/transfer/suppress. Reuse current message, claim, task and receipt types. Do not introduce a second persisted transcript, plan or request registry.
2. Build each owner request from one capability projection that selects matching schema, tools and prompt modules. The model can express an unavailable request without acquiring permission to execute it.
3. Implement support's direct respond/suppress/transfer decisions and validated human-help work. Preserve request identity, returned parked topics, partial-source facts, financial report attribution and confirmed/failed/unknown handoff outcomes.
4. Remove the standalone Decisions/classifier/extractor participation for migrated support turns. Keep any transient entry router limited to entry; do not run it before an established support owner. A failed owner call produces typed operational failure/bounded side-effect-free recovery, never a second semantic stack or canned prose.
5. Reuse current output-origin and claim validation. Persist request settlement from actual evidence and delivered outcome; do not settle an undelivered generated response or repeat an effect when composition fails.

**Deliverables:** working support vertical slice, production caller integration and deletion of replaced support branches. New runtime helpers are justified only by real callers.

**Offline acceptance:** ordinary established support response/suppression uses one model call; a new confirmed handoff uses one request-work round plus completion; replay never repeats the confirmed handoff; failure/unknown receipts stay distinct; unrelated questions do not inherit refund state. Origin, budgets and internal transitions are offline checks only.

**Live selection candidates:** `question_after_takeover_is_answered`, `returned_refund_stays_with_person`, `unrelated_answer_isolates_money`, `derivation_accept_executes_takeover` (all prefixed `live_behavior.`). P6 rules apply before execution.

### P3 — Move FAQ and information tasks into owner work requests

**Scope:** `agent-service.ts:handleSupportInformationTurn`, `information-orchestrator.ts`, extraction projection/schemas, request builders, information/FAQ prompts and existing customer-context assembly.

1. Replace router → global extraction recovery with owner-emitted typed information tasks, including the actual user query and grounded target alternatives. Reuse concurrent independent task execution and partial-success merging.
2. Migrate public FAQ to the FAQ owner. A public policy read required to complete an active customer task remains work within that owner; a genuine topic switch may transfer. Mixed public/protected requests preserve each task and its access outcome.
3. Keep complete-profile assembly independent of owner/tool selection. Reuse prepared evidence and extend it when authorization changes or work returns new facts; do not freeze a stale snapshot merely to claim assembly happened once.
4. Preserve distinctions among withdrawal policy, gift commissions, public event search, private association failure, order totals, received funds and verified balances.
5. Delete `handleSupportInformationTurn`'s global extraction hop and migrated FAQ/information classifier participation. Keep extraction machinery only for explicitly unmigrated capabilities.

**Offline acceptance:** ordinary cached-evidence answer uses one call; one information-task batch plus answer uses two; source failures are preserved alongside ready facts; unauthorized tasks cannot disclose/write; planning → FAQ → planning preserves selections and pending questions. Existing `information-orchestrator`, customer-context and actual-request tests provide the foundation.

**Live selection candidates:** `unassociated_event_has_public_search`, `withdrawal_fee_policy_and_calculator`, `pending_total_dispute_is_reviewed`, `customer_event_task_continuity`. Do not assume one-turn cases cover follow-ups; add permanent full-context cases where existing assertions do not cover the change.

### P4 — Migrate remaining customer capabilities, then planning

**Scope:** existing auth state machine, RSVP executors/effect store, provider planning/search/completion executors, owner request builders and their current service branches.

Execute separate atomic subpackages in this order:

| Subpackage | Move into owner requests | Preserve and demonstrate | Remove in the same change |
|---|---|---|---|
| P4a Purchases/auth | Purchase targets, clarification and authentication actions | Refusal, pending phone confirmation, OTP retry limits, terminal outcomes, changed access scope; no secrets in prompts | Corresponding global extraction and semantic classifier branches |
| P4b RSVP | Read/write attendance requests and grounded event selection | Explicit authorized mutation, ambiguity, party data, durable receipts, replay, foreign-number restrictions | RSVP extractor participation and old semantic arbitration |
| P4c Planning | Event facts, multiple provider needs, search, selection, modification and completion | Event-first multi-need behavior, ambiguous references, retained shortlist/selection, dates and truthful completion | Planning extractor/classifier participation and replaced decision branches |

Authentication and RSVP stay capabilities of Customer assistance, not new owners. Planning retains its own owner. Preserve media attachments through owner calls without adding an image-description stage. Move argument interpretation; keep proven deterministic validators/executors in place.

**Validation:** use existing auth, RSVP authorization/durability, provider-selection, plan-completion, continuity and fencing tests. Add full cross-owner scenarios for planning → FAQ → selection, support → RSVP → support and purchase ambiguity → RSVP → purchase clarification. Register each behavior change separately.

**Live selection candidates:** P4a `authentication_refusal_closes_protected_query`, `otp_terminal_handoff_failed`; P4b `rsvp_ambiguous_event_requires_grounded_selection`, `s11_rsvp_durability_confirms_once`; P4c `provider_reference_miraflores_option`, `s12_provider_completion_truthful_event_date`. Add missing multi-need/transfer contexts to the mandatory suite before freezing a package; existing narrow cases are not equivalent coverage.

**Exit per subpackage:** capability has one semantic owner, removed legacy production callers, preserved access/effects/context and package-specific targeted evidence. Do not batch all three into one unreviewable rewrite.

### P5 — Complete the shared lifecycle and remove obsolete machinery

**Dependencies:** all P4 subpackages have migrated; the removal ledger is current.

**Scope:** `agent-service.ts`, `decision-flow.ts`, `decision-nodes.ts`, `turn-decision.ts`, extraction/classifier modules, prompt loading/inventory and audit consumers.

1. Consolidate duplicated preparation, accounting, failure recording and completion into the shared lifecycle using the behavior-equivalent code identified during migration. Keep effect ordering, fencing and delivery contracts intact.
2. Replace remaining node-dependent projection/branching with typed owner/task/execution facts. Trace labels may be derived temporarily, but cannot remain an alternate decision engine. Remove `current_node`/`DecisionNode` only after all production dependencies are replaced, including session focus and prompt selection.
3. Retire the global extractor and semantic classifier once no production capability depends on them. Delete obsolete Decisions routing if transient entry no longer uses it; otherwise retain only that bounded responsibility. Remove old branch fallbacks, prompts, tests and manifests together.
4. Delete unreachable prompts and audit-only assemblers that certify retired production paths. Preserve historical evaluation artifacts and evidence. Update real consumer mappings, hashes and semantic reviews for retained prompts; never mark pending reviews approved merely to clear CI.
5. Apply any persisted-schema change explicitly and atomically; preserve existing authorized state. No silent reset, compatibility shim or unbounded migration layer. Document and validate how extant development plans are handled before deployment.

**Exit:** production dispatch follows owner/task state; each semantic responsibility has one active owner; every remaining prompt has an actual consumer or explicit archive purpose; the removal ledger is closed. Report reduced stage count and request bytes on matched scenarios. File length and prompt count are secondary observations, not acceptance thresholds.

## 4. Validation and deployment protocol (P6, applied to every runtime package)

### Offline and review

Run typecheck, lint and relevant existing deterministic tests, then the full offline suite at integration boundaries. Run `tests/live-behavior-coverage.test.ts` before every behavior-changing handoff. Add a distinct coverage entry per new behavior change even when reusing a case. No registry entries are added for this planning document alone.

Capture before/after serialized instructions, input, output schema, tools and all requests/retries at the actual outgoing boundary. Preserve complete authorized profile sentinels and incomplete-source status. Demonstrate model-origin delivery and no fixed reply injection. Keep these architectural checks outside the live behavior gate.

Review freshness remains an honest, separate status: list pending/invalidated entries and findings. Pruning obsolete prompts and maintaining contracts can proceed during migration; do not postpone all governance until deletion finishes or represent a generated lock as semantic approval.

### Development and targeted live checks

1. Freeze a per-package manifest before implementation/paid execution: exact full case IDs, scenario/context and fixture/assertion hashes, expected case/turn denominator, settings, maximum executions, prior spend, paid ceiling and stop conditions. The lists above are proposed selections, not authorization to expand an existing frozen panel.
2. Reuse existing paid authorization only within its scope. The historical USD1 package and USD0.25 final-check allowance are not a fresh budget for consolidation. Establish the consolidation package's user-authorized allowance before paid work; offline implementation can proceed meanwhile. Once selected, do not broaden the panel or retry semantic failures without a new user instruction.
3. Build and deploy every Lambda-impacting package to development before live validation. Use only `se-dev`, `us-east-1`; mutating scripts must fail closed unless STS confirms `684516060775`. Refresh backing login with `aws login --profile se-signin` if needed. Record the deployed code/config digest. Infrastructure changes, if necessary, use CloudFormation. No production promotion is included.
4. Execute only explicitly selected IDs using `npm run eval:behavior-live -- --case <full-id> ...`. Never invoke an unfiltered/full live gate. Use existing cost reporting and operator admission; the CLI does not enforce a dollar ceiling. Count unknown cost as unknown, not zero. Freeze one execution per case and zero semantic-judge calls.
5. Hard live assertions cover authorized/backend facts, effect counts, failure outcomes and receipts. They exclude semantic/style judges, wording pins, prompt budgets, internal transitions and required read-tool calls. Persist/reload checks may assert externally relevant continuity rather than internal list positions.
6. Preserve every failed/error run, case ID, run/artifact identity and expected-versus-executed denominator. If deployment is blocked, describe offline-only validation; do not use an older live pass to close the new package. After a semantic failure, stop paid validation and report it before any proposed retry or broader panel.

Any qualitative language supervision is separately labeled and authorized, uses synthetic fixtures, and cannot silently become a semantic live gate or replace hard assertions.

## 5. Completion evidence and immediate next action

Consolidation is complete only when the following are inspectable:

- One current-turn owner per capability; transient entry only when ownership is unestablished; at most one ordinary transfer.
- One model call on an ordinary established no-tool continuation; two on an ordinary one-round tool answer. Exceptions, failures, retries, backend reads and unavailable usage are accounted for.
- Full authorized customer-profile preservation, scoped instructions and schema/tool parity; no intent keyword branching or deterministic conversational prose.
- No legacy semantic fallback for migrated capabilities, no node-driven parallel engine, and no duplicated plan/owner store.
- Preserved event-first multi-need behavior, access restrictions, auth/RSVP flows, request identity, mixed reads, effect receipts, fencing and model-origin delivery.
- Matching before/after scenario measurements, closed removal ledger, honest prompt-review status and separate targeted development evidence for each behavioral package. Missing evidence remains incomplete.

**Next executable step:** reconcile and close P0, then produce P1's branch/removal ledger from the actual local tree. The first architecture code change is P2's established-support vertical slice. Do not begin with mass file splitting, a universal router replacement, bulk prompt approval or deletion by filename.
