# 02 — Work Packages (execute in order)

Each WP is one atomic commit-sized unit. Do not start a WP until
the previous WP's done-criteria pass. Surfaces named are the
verified owners; if a surface moved, find the current owner of the
same responsibility — do not invent a parallel one.

## WP0 — Trace artifact (3–4 h)

Objective: turn 00-context §Trace recheck into a committed
per-turn table so every later assertion cites turn ids.

Steps:
1. From DynamoDB perf records + Agent API messages for the 4
   phones/windows in 00, emit one row per turn: trace/turn id, UTC
   time, user preview, reply preview, classifier health/reason,
   extraction informationRequests + routing fields, tools called,
   per-source backend status/count, orderIds, paymentStatuses,
   referencePresent, thanksPresent, route/next node.
2. Add backend then-vs-now columns from the live guest endpoints.
3. Commit as `../artifacts/turn-table-2026-10-20.md` (or CSV +
   summary). No secrets, no raw payloads, redacted previews only.

Done: 32/32 turns accounted (A7 B9 C12 D4); every number in
00-context traceable to a row.

## WP1 — Capability truth + node/tool snapshot (3–5 h)

Objective: make the capability and node/tool maps machine-checked
so routing can trust them.

Steps:
1. Build operation→consumer map: for every id in
   `runtimeOperationIds` (capability-manifest.ts) record consumer
   class: gateway method (runtimeGatewayOperationMap), compose
   tool (runtimeToolOperationMap), model_review (payment_proof.
   verify, media.image.inspect), or none+not_implemented.
2. Add a committed snapshot test over `nodePromptManifest`
   (prompt-manifest.ts): every DecisionNode has system/
   response_contract/tool_policy files on disk, every allowedTool
   has an operation mapping, every operation has a consumer or
   not_implemented. FAQ allowedTools=[] is recorded as design.
3. Produce the capability digest builder (operation id, available,
   reason, class) consumed by WP2. Pure function + unit tests.

Done: snapshot test green and fails when a node file, tool
mapping, or operation consumer is removed (mutation-check by
temporarily breaking one entry in test).

## WP2 — Decisions router (8–12 h)

Objective: one Decisions call replacing classifier routing on the
customer-assistance lane, behind a config flag.

Steps:
1. Client for POST /v1/decisions (questions exactly as in
   01 Decision 1). Typed errors; timeout aligned with existing
   stage execution (openai-stage-execution.ts patterns).
2. Deterministic router-input builder (fields exactly as in 01).
   Outcome signature + repeatCount persisted on plan (plan.ts
   schema addition, monotonic merge rules like auth recovery).
3. Policy module implementing 01 Decision 2 constants verbatim.
4. Perf recording: new stage `router` in timing/token/openai_calls
   equivalents; route + probabilities stored redacted.
5. Config flag: router on/off for the lane; on API failure,
   fallback to existing classifier path for that turn.

Done: unit tests for every policy branch (each escalation
condition, offer-only-at-2, backstop override, fallback);
typecheck + lint green.

## WP3 — Lane rewiring + merged compose (10–14 h)

Objective: support lane runs router → reads → one compose;
extractor no longer invoked there.

Steps:
1. Single router entry covering text, image, and media-only
   turns (close the preflight bypass at handleTurn ~:801).
   Existing human_escalation soft-pause short-circuit stays
   before the router.
2. On this lane, replace extractor-produced informationRequests
   with deterministic requests derived from route + plan state
   (purchase_discovery / last-completed replay, mirroring
   handleInformationFlow merge rules). Orchestrator unchanged.
3. Compose output schema gains sidecar {generatedMessage,
   citedOrderIds, reportedPayment?} on this lane only; validate
   citedOrderIds ⊆ profile; persist sidecar outcome into next
   turn's signature input. Message delivery path unchanged.
4. Delete on this lane: supportAct veto, isExplicitHumanRequest
   gate, extractor humanHelpIntent + routing actionIntent
   (schema + guards, no shim). Classifier preflight no longer
   runs on this lane when router flag is on.
5. Escalate path reuses requestHumanTakeoverWithTrace + dedupe;
   offer path sets typed help_offer_status same turn.

Done: offline twins (03) for A–D pass; perf records on replayed
support turns show stages ⊆ {router, reply} (or {router} +
takeover on escalate); no extraction stage; typecheck/lint green.

## WP4 — Evidence fixes (5–8 h, parallel with WP3 after its step 2)

Objective: judges and replies see the facts that already exist.

Steps:
1. projectPurchaseEvidenceItems (information-orchestrator.ts:287):
   add payment summary (method, status, paidAt, gateway outcome),
   thanksPresent/isThanked, and COD presence consistent with
   authorization rules. Keep private dedication redaction.
2. Money labels in reply evidence: each amount tagged
   charged_total | gift_value | reported_amount with currency.
   Evidence only; no prose prescription.
3. Mirta host-receipt: thanks/is_thanked projected as first-class
   receipt fact at the same rank as paymentStatus.

Done: C offline twin asserts host-receipt fact in judge evidence;
amount labels present in evidence fixtures for A/C/D pairs.

## WP5 — Derivation truth (3–5 h, parallel with WP4)

Objective: an offered derivation is a real, acceptable offer;
a claimed derivation is a real effect.

Steps:
1. FAQ/support replies that may offer manual review set typed
   help_offer_status='offered' the same turn (existing health
   state field; do not add a new store).
2. Accept on a later turn executes takeover immediately via the
   existing accept path (agent-service.ts ~:944).
3. Claim gating: derivation-success language requires in-turn
   gateway success receipt via reply-evidence-projector claim
   checks; otherwise the turn resolves without that claim.

Done: twin replaying C turns 4–5 executes takeover on accept;
twin with gateway failure shows no success claim.

## WP6 — Live cases, release, measurement (8–12 h)

Objective: repo-law validation and rollout.

Steps:
1. One live_behavior_regression case per dossier case +
   deterministic offline twins (already built in WP3–WP5) +
   one multi-purchase ambiguity twin (router chose
   ask_clarification ⇒ no purchase-specific claim composed).
2. Register one entry per behavior change in
   evals/live-behavior-coverage.yaml (never reuse older entries).
3. Redeploy Lambda (Lambda-impacting change).
4. Run targeted evals only:
   `npm run eval:behavior-live -- --case <id>` per case;
   `npx vitest run tests/live-behavior-coverage.test.ts`.
   Never run an unfiltered/full live gate.
5. Record run/artifact ids + decisions in
   docs/implementation-log.md.
6. Within 7 days post-deploy, sample perf records: escalation
   rate on purchase-support threads, unresolved money loops
   >3 turns, takeover success rate. Report in the dossier dates/.

Done: coverage test green; all targeted live cases green with
failures visible (none hidden); implementation log updated.
