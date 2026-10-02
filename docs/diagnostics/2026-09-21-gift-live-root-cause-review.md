# Gift/receipt live implementation review — 2026-09-21

Reviewed HEAD 44471dd1 and run eval-2026-09-21T20-04-39-127Z-0bfac000. Evidence: committed source, implementation diff, results.jsonl delivered replies, trace tool lists, execution summaries and request metrics. This audit did not retrieve the complete stored OpenAI request bodies; trace summaries do not establish the exact extracted resource or all available KB text. No deployment or paid calls in this audit. Prior report's full-suite numbers are reported evidence, not independently rerun here.

## Verdict

Corrections improved data projection but did not establish working gift support. The primary break is a conflicting source-selection contract before projection. A separate implicit escalation policy magnifies an empty read into an unwanted write. Fix both, not merely the visible gift answer. Do not treat 16 failures as 16 independent prompt deficiencies.

The earlier package and its serialized tests missed the production trusted-phone path: tests construct authenticated getGiftPurchases reads while live cases use phone-based discovery. This is an integration coverage defect. Offline green proves the corrected downstream component, not the complete customer path.

## Confirmed findings

1. **Source selection disagrees by access method.** information-orchestrator.ts selectPurchasePartition ignores request.resource unless pinnedSource exists and derives gifts solely from dedication/thanks/payment_details. Authenticated lookup uses resolvePurchaseResourceForAspects, which preserves resource absent gift aspects. The same gift shipping question can therefore read different sources depending on authentication. agent-service.ts normalization and openai-agent-runtime.ts also invoke this helper, making resource interpretation distributed.
2. **Receipt fan-out checks labels rather than effective sources.** expandReceiptDiscoveryRequests builds a Set of request.resource, pins only a complementary clone and returns immediately if both labels exist. Later aspect-based routing can invalidate its assumption. In receipt_gift_only_match the live execution contains information-1 and information-1:receipt-discovery, both resource orders, no gift lookup. Two trace entries do not prove two network calls because scoped lookup memoization exists; the proven failure is missing gift coverage.
3. **Independent unauthorized-by-intent escalation.** agent-service.ts around 8064: onlyPhoneScopedMisses + no retained media + Boolean(inbound.contactPhone) can call escalateInformationAuthentication. Possession of a phone authorizes a scoped read, not consent to request human support. Mixed gift T0 executes request_human_takeover and persists information_authentication_terminal_handoff. Correcting source selection alone leaves this latent defect.
4. **Receipt discovery can do zero reads.** receipt_dual_same_amount_asks has support_act_kind provide_detail, no information execution and a receipt transcription. expandReceiptDiscoveryRequests requires a specific support tuple AND an existing unidentified purchase request. The trace does not expose the tuple's topic/detail; inspect the stored extraction before claiming which predicate failed. The structural defect is that recognized receipt assistance and executable purchase discovery are separately optional representations.
5. **Provenance preflight did not enforce the plan.** The report acknowledges deploymentBefore and artifactSha256 null. runner.ts can construct a live manifest after describeDevDeployment returns null. Manual identity evidence can support investigation, but does not make the automated preflight compliant. The run remains diagnostic; do not silently upgrade it to binding acceptance.
6. **New conflict metadata has a completeness edge case.** snapshotsOfPurchase carries alternatives but discards the previous truncated flag. resolveOrderItemSnapshots recomputes truncation from retained alternatives only. Once alternatives were omitted, a subsequent merge can incorrectly claim complete conflict evidence. Preserve the existing partial-coverage marker monotonically until authoritative replacement, without adding another conflict mechanism.

## Reassess the adjudication

- Card: the accusation that “Felicidades” was invented is contradicted by the fixture. However the reply additionally says credit is “para elegir su regalo”; that purpose is not proven by the supplied gift-type contract. Mark the citation accusation as evaluator-defective; do not declare the entire answer grounded without supporting that added purpose.
- Non-receipt image follow-up: the user asks hours and the answer redirects to an article instead of giving them. The trace shows six KB hits, first horarios-y-canales-de-atención.md at 0.9848. Without the actual projected article text, product correctness is unresolved. If hours reached the reply input, failure is real; if omitted during projection, fix projection; if absent from source, the limitation can be valid. A rubric omission alone does not make an unhelpful answer good. This case also used live KB retrieval, so it was not a fully fixed synthetic world.
- receipt_with_text_together: delivered reply identifies Aniversario Lucia, pending state, no image-based approval and up to 72 business hours. Omission of 340.44 alone is not a product defect unless required to answer/disambiguate. Preserve the failed historical score, revise future rubric to relevance-based adequacy, and do not add amount-recital scripts.
- Approved/dual receipts: unsolicited operation/card/date transcription is genuine task-irrelevant disclosure. Keep native pixels; do not solve it with a second OCR pass or generated-text replacement.
- Roberto: inability to verify must not become proof of absence/nonregistration. This is a factual evidence-boundary problem, not just variance. Requesting resubmission also contradicts the agreed behavior.

## Durable implementation packages (sequential integration)

### A — One source contract, used by both access paths

Files: src/runtime/extraction-schemas.ts, src/runtime/openai-agent-runtime.ts, src/runtime/agent-service.ts, src/runtime/information-orchestrator.ts; corresponding schema/service/orchestrator tests.

Separate requested subject/source from requested answer aspects. Preserve structured resource orders/gift_purchases unchanged across normalization and execution. Delete aspect-based source overrides from all three callers and the phone-specific selector; do not add shipping or summary to the gift-aspect list. Aspects control which facts answer the question, not which backend owns the record. For this migration keep the current source enum and use two ordinary explicit requests for unidentified receipt discovery; do not add another router or classifier. Delete pinnedSource once both access paths honor resource; remove its schema/tests rather than leaving a compatibility bypass.

Established authorized record source wins for a follow-up to that record. A structured recognized receipt-assistance task with no established record uses the existing executor to read both available authorized sources once each, including when the extractor did not separately emit a purchase request. Build those requests from the existing typed receipt task, not text keywords, attachment presence alone or OCR values. Do not infer receipt intent for every image. Ensure current explicit target is preserved; no unrelated-source fan-out for a verified record. If the existing extraction tuple does not reliably represent recognition, simplify that existing schema and instruction to one coherent typed receipt-assistance contract, with no additional model call. Inspect the failing stored extraction to document the exact discrepancy before editing it.

Resolve access per source using existing capability/auth checks; no broader access via receipt names, numbers or campaign references. Keep unavailable/not-read/empty distinct in typed source coverage. Deduplicate reads by actual source + authorization scope + record filter. A missing source is not an empty source. Preserve separate carts and completed/pending purchases; an unrelated cart cannot stand in for a missing receipt match. Do not auto-select by amount alone; use the model's structured interpretation with validated candidate IDs.

### B — Read outcomes do not authorize writes

Files: src/runtime/agent-service.ts phone miss branch and existing handoff tests.

Remove phone-presence and authentication-status as reasons to auto-escalate a not_found read. Return scoped miss evidence to the normal shared reply. Execute handoff only through existing explicit human-help/accepted-offer semantics and existing idempotent executor. Do not remove legitimate explicit human requests or authentication error handling globally. A genuine miss can produce a helpful limitation/offer, never a fictitious record-absence claim outside searched coverage. Ensure a prior unsolicited handoff is not seeded into new fixtures to make this test pass.

### C — Truthful evidence and task-relevant replies

Files: existing receipt/gift scoped prompts, purchase evidence projection, KB projection and eval judge evidence path; tests/eval-judge-evidence-projection.test.ts and current receipt/gift YAMLs.

Keep all authorized item amounts/quantities and native image context. Preserve existing type-to-meaning data. Replace overlapping receipt-transcription directions with one scoped intent: use receipt observations to identify the relevant purchase and answer with backend status; only disclose observations useful to that task. No prescribed phrases, no global prompt growth, no post-generation replacement. Preserve verified payment policy but never fabricate it from method/type.

Expose dedication text to judge only if it was available to the responder; keep privacy rules. For hours, inspect actual retrieved content and spec.input and fix the earliest lost-data boundary if any. Mock KB through the existing fixture/retrieval test mechanism for this synthetic case; do not invent hours. Version rubrics before another run. Allow semantically adequate amount omission; still fail invented settlement, source mixing, unnecessary code/account recital and omission of facts explicitly requested.

### D — Preserve conflict coverage and enforce run identity

Files: src/runtime/customer-context.ts, tests/l4-customer-context.test.ts, src/evals/runner.ts and existing manifest/preflight tests.

Carry itemSourceConflict.truncated forward with logical OR of incoming/current truncation and new resolution truncation. Add a limit+1 alternatives → another merge test; it must remain partial. Do not clear without evidence of an authoritative replacement contract.

For non-dry live runs, reject missing deployment identity or artifact digest before fixture invocations/model calls. Resolve identity using existing development deployment configuration, se-dev/us-east-1, and actual ZIP digest mapping. Do not supply a fabricated hash or copy HEAD as artifact identity. At completion compare before/after identity; mismatch invalidates acceptance. Keep dry-run/offline behavior intact. This is a small invariant in the existing runner, not a new deployment framework.

## Tests and completion

Reuse existing eight gift cases, campaign/Roberto and eight receipt cases; no new paid case IDs. Add offline full-service tests for both trusted-phone and authenticated access, not just constructed ComposeReplyRequest objects. Matrix: both resources × shipping/status/amount/payment_details; resource remains unchanged. For receipt discovery, both source labels with arbitrary aspects must yield one actual read per authorized source; a recognized unbound receipt with no separate purchase request must discover candidates; non-receipt image must not. Known explicit older target stays selected; dual equal amounts retain ambiguity; gift-only match ignores cart. Empty and unavailable coverage differ and cause zero unsolicited writes. Existing accepted-handoff thread still writes once.

Test through extraction output → service normalization → orchestrator lookup → canonical profile → actual serialized reply input, with mocked model output and backend methods. Prove 150/80 survive the phone path. Add scoped prompt absence and size checks. Record separate integration tests for the card/KB judge evidence and preflight zero-calls-on-missing-identity. No tests should require exact Spanish sentences.

Do not reclassify historical scores as green. Finish code/offline corrections before proposing a new frozen development deployment and single affected-panel run; the earlier authorized single invocation has already been spent. This audit does not authorize another paid invocation or production promotion. Present the final scope/case manifest for renewed execution authorization. No source change or model generation was performed in this audit.
