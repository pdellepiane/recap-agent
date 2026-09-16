# Support release: actual-prompt relevance and implementation package

## Authority and scope

This is the current support-priority work package. Planning quality can remain red and is reported separately. Authorization, truthful outcomes, customer isolation and duplicate-effect protection remain mandatory across shared code. No new routing model, agent, state machine, keyword matching, canned replies or post-generation text replacement. This document authorizes a design for implementation; no runtime changes or validation runs were performed in this audit. Existing execution holds remain until the coordinator starts implementation/validation explicitly.

Prompt leanness means every included instruction, fact, history item, tool and schema field serves a plausible decision in the current task. A smaller payload that removes an address is worse. A large cached payload containing irrelevant OTP rules is not lean. Useful related facts are allowed; repeated facts, unrelated workflows and forced recitals are not.

## Evidence actually retrieved

Reference full run: eval-2026-09-16T01-31-07-167Z-50f1ccca, deployed artifact ebee77df (use manifest for full digest). Retrieved ten stored requests, extraction and reply for five support conversations, by read-only OpenAI response/input-item retrieval. Index: support-prompt-audit-index-2026-09-16.json. Raw requests remain private in .openai-audits and must not be committed. These are the historical deployed requests, not reconstructed current prompts. Other failure classifications below use full-run conversation artifacts/source, not a claim of inspecting every stored request.

### Verified relevance failures

1. Venue, accountless_guest_event_uses_phone_without_otp, turn 0: extractor correctly emitted event.detail.read and an associated_event request. Reply received 20,068 instruction bytes and no tools. customer_context held a named/dated candidate but invitations was empty. Address absent. Instruction tail included payment time alternatives, terminal OTP, auth refusal and purchase-search-miss behavior. Fix missing detail and branch projection; changing venue phrasing cannot recover an absent fact.
2. Cinthya campaign, turn 0: extractor received 14,472 instruction bytes, planning categories repeated as suggestions and priority, broad planning fields, and history=empty. It emitted an empty delta for “Gracias, confirmo asistencia”. Reply then received 12,939 instruction bytes, planning interview/welcome policy and three category/location tools. This is extraction plus routing failure. Missing campaign history is independently a fixture/context issue; never claim a campaign informed this decision. Pure gratitude and gratitude with an explicit decision must be distinguished by the existing model.
3. Payment balance, owner_customer_payment_relevance, turn 0: same order appears in candidates, purchases and detailedPurchases. Sparse summary has null total while amountDisclosure has 227.76; paid=null. Internal customerTransactionNumber is included despite denied transaction-reference disclosure. Operational note discusses unsolicited time/currency corrections and forbids wider useful detail. Model falsely converted unknown paid amount into a remaining balance equal to total. Retain the necessary unknown-paid invariant, remove duplicates and unrelated notes; relevance work cannot excuse this factual error.
4. Native image thread, turn 5: FAQ result includes full ATC response sample, trigger hints and frontmatter promising emails within 72 business hours. The question is whether image amount proves store approval. Model repeats the email promise. The answer is influenced by supplied template prose; not unexplained hallucination. Replace retrieval-to-prompt content with scoped policy facts, preserving applicability and provenance.
5. Host withdrawal, turn 1: reply has completed FAQ policy maxBusinessHours=72 and unavailable individual status, duplicated in turn_state, plus confirmed handoff. Handoff system says not to continue FAQ and assumes the user requested a human. Input appends planning categories, full capability catalogue and tool names although actual tools=[]; shared anti-patterns discuss provider interviews. The model omits the policy. This is a genuine contradiction between available evidence and response instructions.

## Final design decisions

- Keep current architecture and model calls. Reuse existing owner, capability profiles, prompt manifest, profile projector, information orchestrator and verified executors.
- A first unknown-topic extraction may need compact cross-domain recognition. It does not need vendor priorities or every planning operation. Already-established support turns use the existing support extraction projection. Do not introduce keyword pre-routing to make this possible.
- Support recognition and permission to mutate are separate. A read-only RSVP inquiry does not need an attendance action. Profile/campaign context can resolve a read target; actual writes retain explicit action, scoped IDs, lease and read-back.
- Reply input contains one canonical fact copy per entity, compact identity references elsewhere, completed/requested task status, unresolved material questions, applicable policy and actual outcomes. No broad capability catalogue, empty planning fields or repeated policy facts on support-only turns.
- Keep generation-stage tools empty where the existing architecture completes reads before reply. Remove text implying unavailable tools can be called. Missing information must be fetched in the existing orchestration path, not hidden by a stronger reply instruction.
- Compose facts and outcomes together: valid general policy may accompany an individual-status limitation and actual handoff. A handoff does not erase an answer already available.
- No prompts to narrate null fields, storage, internal IDs or effect machinery. Explicitly relevant unknowns such as remaining balance and unverified payment status stay typed facts.

## Packet S0 — freeze scope and reconcile partials

Owner: coordinator. Files: acceptance-contract.md, evaluation manifest/report metadata, implementation-log.md; inspect seven pending files before editing.

Keep image-case partials only when they add verified judge-only image truth or remove requirements conflicting with image/URL bans; examine each diff. Do not blanket-accept all five. Defer provider-miraflores fixture as planning work. Defer runner provider-shortlist evidence expansion unless needed to keep shared evaluation reliable; it is not a support runtime fix. Preserve partials in a named patch/commit, never silently discard another lane's work.

Define support membership from customer jobs, not current pass/fail: purchases, events/RSVP, account access, FAQ, media continuity, handoff/withdrawal and mixed messages containing support. Planning-only cases are diagnostic. Store explicit IDs resolved from the current catalog, with inclusion rationale and no omissions of failing support cases. Shared security/effect tests remain binding. A changed release scope requires a reviewed contract amendment; never label a support pass a full-suite pass. Baseline comparison requirements stay until explicitly amended, not silently waived because artifacts are missing.

Pass: reproducible source/artifact/evaluator identity; no placeholder implementation hashes; clear support denominator and planning report; cancelled partials disposition recorded.

## Packet S1 — support entry and actual context

Owner: runtime worker. Files: src/runtime/agent-service.ts (support/RSVP entry predicates), extraction-projection.ts, extraction-schemas.ts, turn-message-context.ts, openai-agent-runtime.ts extraction input builder; prompts/extractors/base_system.txt, rsvp.txt, information.txt, planning.txt through prompt-manifest.ts.

Trace Cinthya/Jose/Cristian/missing-action through retrieved extraction to entry predicate before edits. Consolidate duplicated RSVP eligibility checks so typed topic/request evidence enables authorized reads independent of rsvpAction. Do not turn null decision into attending. Remove planning welcome fallback for unresolved support intent; preserve task context and grounded clarification. Correct the existing extraction instruction so acknowledgements with substantive requests/decisions are processed; pure thanks remains no new task. No trigger-word list.

Fix campaign fixture/history retrieval so a campaign case actually supplies delivered outbound campaign evidence to extraction. Verify source/direction/conversation/time; no inferred campaign from case title. Keep explicit new target override and old-record access. Route mixed support/planning turns without dropping either request; planning may be deferred clearly but support must be answered.

Use current extraction profiles to omit planning category priority, provider fit schemas and irrelevant plan fields once support context is known. Unknown-topic initial extraction retains compact ability to detect a topic switch, not full planning workflows. No additional model call.

Pass: real prompt capture has campaign evidence for campaign cases; gratitude plus decision does not yield empty delta; pure thanks does not replay effects; invitation state is read without staging a change; support-only replies have no provider tools/category menu. Explicit action still requires verified target before write.

## Packet S2 — profile fact parity and relevance

Owner: same runtime worker. Files: customer-context.ts, information-orchestrator.ts, purchase-reply-projector.ts, reply-evidence-projector.ts, agent-service.ts profile assembly, openai-agent-runtime.ts reply evidence serialization; core/information.ts only if existing types cannot express necessary facts.

Repair venue hydration/projection: preserve the associated_event detail's requested moment/venue/address, not just event date. Verify the exact phone-scoped record selected, and ensure inferred unique targets receive detail. Multiple moments retain labels so ceremony and reception do not mix. Do not use event country as street.

Consolidate each purchase/event once. Candidates carry entity references and distinguishing labels only; resolved detail carries values once. Remove parallel null-valued aliases that contradict populated disclosure fields. Strip transaction identifiers from model-visible profiles when not authorized/needed, not merely from delivered text. Candidate selections retain available labels, amount/currency/status/date. User statements have distinct provenance and cannot become backend facts.

Represent balance as unknown unless authoritative paid/remaining values support it. Reuse amountDisclosure/typed outcome fields; do not create an arithmetic conversation policy engine. Missing paid amount is never zero. Preserve recorded total as total.

Coverage fields distinguish not_requested, failed, unavailable, partial and observed empty. No absence claim from zero reads. Keep scoped lookup reuse, existing expansion bounds, after-write invalidation and freshness needed for mutable status. Do not introduce cross-turn cache policy changes in this release.

Pass: venue answer input contains actual reception address; amount selection input retains available amounts and labels; no duplicate record payloads or unauthorized transaction reference; unknown-paid arithmetic cannot produce asserted remaining balance; conflicting guest identities stay separate. Actual sent prompt parity, not helper-only tests, is required.

## Packet S3 — outcome-specific instructions and factual FAQ evidence

Owner: runtime worker, after S1/S2. Files: prompt-manifest.ts, prompt-loader.ts, openai-agent-runtime.ts, agent-service.ts operational-note construction; prompts/shared/common_anti_patterns.txt, output_style.txt, resolver system/response_contract, solicitar_agente_humano system/response_contract; existing knowledge retrieval/projection modules located through knowledge_base_search consumers.

Build a retain/remove ledger for every instruction section loaded in support replies. Select existing prompt fragments from validated outcome facts using current manifest/projection machinery. Add a fragment only when no existing fragment can express the invariant; delete superseded global copies in the same change. Avoid one fragment per fixture or question wording.

Venue read: omit OTP failure, payment corrections, image recovery, provider planning and mutation outcome prose. Purchase read: include record semantics and requested/related payment facts; omit inactive OTP and image failure instructions. Human handoff: include requested support task, completed relevant policy and actual handoff result; omit catalogue, planning missing fields and “user requested human” assertion when escalation was automatic. Terminal auth: only applicable auth limitation and actual handoff result; no entire recovery decision tree. Preserve necessary broad truthfulness/privacy invariants once.

Convert knowledge-base customer-service samples into factual policy evidence using the existing ingestion/retrieval pipeline. Do not pass frontmatter, trigger hints, response scripts or bracketed method alternatives as if they were transaction-specific facts. Prefer authored source-backed structured policy content; no new per-turn LLM summarizer. Preserve sources and conditions. General validation timing is not proof a particular customer's email was sent or will arrive. Receipt amount does not establish approval.

Remove operational-note prose duplicating facts or conflicting with useful completeness. Do not replace it with another global ban paragraph. Keep native image context and earlier user question when relevant; neither describe images unsolicited nor ask for new images/URLs.

Pass: five audited prompt families show only applicable instructions; source policy remains usable alongside handoff; no duplicated 72h fact; actual tools match tool guidance; receipt-only approval answer makes no unsupported email promise; unrelated null outcomes and planning fields absent. Cache reuse is measured, never obtained by padding irrelevant text.

## Packet S4 — support continuity and effect truth

Owner: runtime worker. Files: agent-service.ts escalation/auth continuity, rsvp-effect-executor.ts only if receipt composition is wrong, reply-evidence-projector.ts and relevant existing outcome types.

Keep human handoff idempotent. A later event-name/detail message enriches the existing support request; it must not resubmit a takeover or restart planning. Show successful companion outcome independently from unrelated unknown self-attendance; expose partial failure only if that operation was actually requested/attempted. An image question without pixels is not automatically an empty purchase lookup requiring takeover. Use existing pending-task and media availability facts.

Unavailable URL generation failure remains operationally visible; do not accept blank required response or convert failure into legitimate silence. Investigate native-input failure separately from wrong image_url_context tool-name expectations. Do not build URL fetch/rehosting workarounds or request customer URLs.

Pass: no duplicate takeover/write, outcome-bound success claims, accurate partial outcomes, preserved unresolved task, and honest response or explicit operational failure for inaccessible media. No new fallback prose.

## Packet E1 — evaluator repair independent of runtime

Owner: evaluation worker. Files: src/evals/runner.ts existing canonical evidence builder, evaluation-state.ts, scorers/semantic-judge.ts only as needed for evidence; evals/cases image/OTP/RSVP/payment support cases; existing fixture gateways and integrity tests.

Judge must see candidate-visible relevant facts plus separately labeled fixture truth. Bind manually verified synthetic image text/amount to image digest, judge-only; no OCR model pass and no expected answer leakage. “How much?” requires correct amount, not the literal word Monto. Remove stale URL/image-request expectations. Score full utterance, not isolated phrase.

Keep genuine factual failure: invented balance, unknown time presented as backend fact, false confirmation, wrong entity, dropped requested topic, unreadable URL blank output. Distinguish unsupported handoff promises from concise omission of unnecessary internal detail. Replace node/tool-name pins when they merely prescribe an implementation, retaining independent read/effect evidence. Keep mandatory semantic judges and factual mutation controls.

Host-declining fixture: separate unique guest/host-set state from genuine multi-event ambiguity. Same-name ambiguity must offer distinguishable facts; do not require a particular date format or answer from an unselected record. Campaign fixtures must actually include intended history; FAQ fixtures must contain the policy the judge demands. Every fixture revision states provenance and changes baseline/candidate conditions identically.

Pass: correct image amounts pass, wrong amounts fail; meaning-preserving paraphrases pass while state flips fail; no-mutation assertions derive from receipts; support case inclusion is independent of results. Preserve historical verdicts, version oracle changes, no threshold reduction or retry-until-green.

## Validation and completion sequence

Two workers: runtime S1→S2→S3→S4; evaluation E1. Coordinator owns S0 and integration. One runtime writer, one evaluator writer, one deploy owner. Each packet includes atomic implementation identity, new coverage registration and implementation-log entry. Do not extend scope to planning quality.

1. Offline: relevant extraction/routing/profile/projection/auth/handoff/image/evidence tests, typecheck/lint, coverage registry and fixture isolation. Test both relevance absence and required fact presence. No exact-byte equality as behavioral acceptance.
2. Capture matched actual requests for the five audited cases plus OTP, multi-candidate selection, companion update, URL failure and mixed request. Record stage, task, included sections, required missing facts, irrelevant sections, instruction/input/tool/schema bytes, model calls, and cache usage. Trace/store inspection is not a new conversation model call.
3. Freeze one candidate and reviewed support/evaluator manifests; deploy dev exact bytes using se-dev/us-east-1 and account guard. Run complete support suite once through existing bounded runner. Planning report is diagnostic; shared protection failures still block. Do not substitute another handpicked panel for breadth.
4. Classify every red as product, evaluator, fixture or infrastructure with actual input/output evidence. No automatic promotion from audited reinterpretation. Required baseline comparison needs recovered/reproducibly deployable artifact under same evaluator; absent baseline stays an explicit blocker unless contract is expressly changed.
5. Release only exact accepted artifact under authorized procedure with rollback identity and health verification. Full gate remains red historically; scoped support acceptance must be labeled accurately.

Definition of done: customer support succeeds across the agreed job set; required facts survive projection; inactive guidance/tools are absent from actual payloads; no extra decision pass; effects remain verified; all support hard expectations/errors/skips resolved; planning failures separately disclosed; reproducible release evidence complete. Prompt reduction is a result of relevance, not its substitute.


## Architecture amendment — generic prompt construction across all owners

Latest user authorization permits larger architecture changes. This amendment replaces the earlier restriction to local support-only prompt assembly changes. Support remains first in validation priority, but the construction mechanism must serve planning, faq and customer_assistance. Do not create a support-specific second builder.

### Decision: one typed request compiler, no new decision model

Create `src/runtime/model-request-projector.ts` as the single pure construction boundary for existing extraction and reply calls. It consumes existing typed runtime evidence and returns instructions, input, applicable tools, output schema, prompt identity and a local relevance manifest. It neither interprets raw user text nor chooses conversational intent or effect authorization. The existing model/execution machinery retains those responsibilities.

Use a stage-discriminated input: extraction receives current message, authorized context/history, current owner/capabilities and existing state; reply receives extracted tasks, completed facts/outcomes and unresolved alternatives. Extraction must not require knowledge that only its own output can provide. For an unknown initial owner, include a compact cross-domain extraction schema/profile sufficient to detect support, planning, mixed requests and topic switches. Do not add a preliminary router call.

Reuse contracts.ts and existing extraction/profile types; do not mirror the whole plan into a new schema hierarchy. Keep prompt text in tracked Spanish files. Extend prompt-manifest.ts into a registry of composable instruction modules with explicit typed applicability and evidence dependencies. prompt-loader.ts remains immutable text loading/cache only. The compiler replaces inline concatenation and projected-string patching in openai-agent-runtime.ts, not another wrapper around those paths.

### Shared request contents

Each constructed request has:
- Small shared conversational invariants once.
- Applicable task/capability instructions, with no competing node instructions.
- Canonical authorized entity facts, policy facts, user assertions and effect outcomes with distinct provenance.
- Relevant chronological history, active questions and campaign references.
- Only executable tools for that stage and the necessary schema/profile.

Mixed tasks compose applicable modules; they do not select one task and discard the others. Human escalation is an outcome attached to a task, not a reason to suppress an already-completed answer. Workflow node names may remain telemetry/state-machine details but stop determining the whole conversational instruction bundle.

Registry applicability uses existing structured tasks/outcomes and authorization. It must not inspect customer keywords, fixture IDs, event names or desired reply strings. Modules express reusable invariants such as scoped purchase facts or verified action outcomes, not one rule per failing case. Unsupported operation facts remain visible when needed to explain the actual request; unrelated catalogue entries disappear.

Canonical facts use existing stable IDs/access scopes. References may repeat; full values do not. Conflicting values retain provenance rather than last-write-wins. Stage-specific representation can differ, but a single stage must not receive the same full profile through multiple paths. FAQ content is source-backed policy data; backend state, user claims and response examples cannot be collapsed into it.

### Relevance manifest and validation

Return a local audit manifest alongside the request, not inside model input. For each included module/tool/fact group record its source, typed applicability reason, required dependencies and serialized bytes. Use source field paths or opaque IDs; do not create a second log of customer payloads. A declared reason is not proof of relevance: tests must exercise removal/addition under changed tasks.

One module cannot load contradictory alternatives merely because they share a node. Inapplicable recovery branches are absent. A missing required fact is reported as missing/unavailable evidence, never filled with sample prose. Keep exact-prefix stability through fixed module/tool ordering and stable invariants first, dynamic context last. Do not add irrelevant modules to improve cache hits.

### File-level migration and deletion

G1 — Shared contract/compiler: model-request-projector.ts (new); contracts.ts, prompt-manifest.ts, prompt-loader.ts. Runtime worker owns these. Add tests/model-request-projector.test.ts for module applicability, mixed tasks, no duplicate facts, authorization and required fact retention. No live behavior switched until its consumers migrate.

G2 — Extraction integration: replace extraction input concatenation in openai-agent-runtime.ts with the compiler; reuse extraction-projection.ts/extraction-schemas.ts. Remove repeated category priorities and full inactive planning state from established support/FAQ extraction. Preserve compact switch recognition and invitation decisions within gratitude. Test actual serialized requests, not just module selectors.

G3 — Reply integration: replace buildReplyInput/buildReplyTurnEvidence ad hoc append paths and loadNodeBundle conversational composition with compiler output across all owners. Migrate reply-evidence-projector.ts responsibilities into or under that boundary; no two independent projectors deciding content. Keep the transport adapter in openai-agent-runtime.ts. Remove broad capability catalogues, operational-note instructions, duplicate state serialization and node-level prompt text made unreachable by migration. Retain structured operational outcomes. Module text stays mapped to exact consumers in prompt-manifest.

G4 — Domain fact adapters: S2 profile parity and S3 FAQ policy cleanup feed the shared compiler. Planning provider facts follow the same source/provenance/relevance rules, though repairing planning-specific behaviors is deferred. Do not remove provider evidence globally to make support lean.

G5 — Relevance tests across owners: current support regression matrix plus planning search/selection/close and FAQ examples. Add metamorphic checks: adding unrelated planning state must not add planning instructions/tools to support; changing event ID preserves instruction module identity; changing handoff requested→failed changes outcome facts and only applicable outcome guidance; a mixed FAQ+purchase request retains both; unrelated OTP state cannot change a venue answer's instructions; switching topic exposes the newly applicable capabilities. Same-ID/different-guest facts never merge. Use paired actual payload captures to validate integration.

No runtime dual-write, feature-flag matrix, persistent compatibility layer or additional model call. Implement in an isolated candidate, migrate all callers, remove the old builder paths and run offline integration checks before dev deployment. Frozen artifact rollback is the migration fallback; do not retain two prompt architectures indefinitely.

### Execution order and release criteria adjustment

S0 and evidence collection first; G1→G2→G3 with S1 recognition corrections; S2/S3 factual repairs through G4; S4 continuity; E1 evaluator review independently; G5 integration. Runtime has one owner across shared files. Coordinator resolves integration and freezes once. This is larger than the previous local fix round and must not be described as a one-line optimization or guaranteed green release.

Support gates and shared protections remain mandatory. Planning behavior failures may be diagnostic as authorized, but schema/transport failures, broken construction, authorization leaks or duplicate effects on planning paths are not acceptable collateral damage. Measure relevant fact retention, irrelevant section absence, model-call count and total instruction/input/tool/schema usage. No universal percentage byte-reduction target. No claim of relevance based solely on cheaper requests.

Implementation is done when all existing model-call sites use the shared compiler, old append paths are deleted, all three owners pass construction/integrity checks, support behavior meets the reviewed acceptance contract, and actual-request evidence demonstrates applicability. Keep full diagnostic results and required release comparison/provenance conditions. No execution or promotion is implied by this architecture amendment alone.
