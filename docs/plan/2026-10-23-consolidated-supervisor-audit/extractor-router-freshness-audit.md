# Extractor and router prompt freshness audit

Date: 2026-10-23. Read-only inspection of baseline `8b69c341` and the moving working tree. No runtime or prompt edits, AWS operations, model calls, or paid evaluations were performed by this audit. Findings below distinguish existing design defects from concurrent fixes. The other audit owns reply/shared/node prompt wording.

## Findings

### E1 — The operation advertisement is empty while the schema requests operations

Existing at baseline. `OpenAiAgentRuntime.buildExtractionProjection` always passes `candidateOperations: []`. `projectExtractionOperations` consequently returns an empty array, and `projectExtraction` serializes `Operaciones del dominio: ninguna`. `buildExtractorInputSections` appends `No extraigas acciones fuera de esta lista`. In contrast, `extractors/capability_boundary.txt` asks the model to preserve the requested operation regardless of availability, and `createDynamicExtractionSchema` exposes `requestedOperation` with every user-facing operation from `runtimeOperationIds` (excluding the two internal purchase read operations).

The phrase about the list is ambiguous between action intents and operations. The code cannot claim one operation advertisement/schema source of truth while advertising no operations and accepting all of them. Fix the contract, not by keyword intent matching: distinguish user-requestable operations from executable-now capabilities; generate both relevant enum advertisements from the exact dynamic schema/capability state. Do not suppress an unsupported requested operation merely because execution is unavailable.

### E2 — Static instruction selection and dynamic schema selection use different capability inputs

Existing at baseline. `deriveExtractionCompilerContext` sees the plan and `derivePlanCapabilities`, hardcoding tasks `purchase`, `venue`, `rsvp`, `faq_policy`, and, on transient turns, `planning`. `profileFromManifestAndPlan`, separately, sees the runtime capability manifest and can remove information, RSVP, planning, contact, close, and pause fields from the schema. The static module selector can therefore load instructions for fields the actual schema cannot emit when corresponding feature flags/capabilities are disabled. Established support narrowing is tested, but feature-flag combinations require the same contract.

Fix by deriving module applicability and schema property availability from one typed extraction projection. Preserve only genuinely necessary cross-domain recognition; do not load field-specific instructions when those fields are absent.

### E3 — `destination_account` is a stale extractor output concept

Present in baseline and retained by the working-tree edit. `extractors/information.txt` says a payment-data request is `purchase` with `destination_account`. `openAiInformationRequestSchema` has only `kind`, `query`, `eventHint`, `orderId`, `amount`, `authAction`, and `hostWithdrawal`; it has no `resource`, `aspects`, or `destination_account` selector. `destination_account` is a backend wire field, not an extractor field. It can remain in the natural-language query, but the prompt must not imply an output slot that no longer exists.

Small fix: describe the purchase request and preserved query, with destination/payment data resolved from the complete authorized profile. Do not reintroduce removed resource/aspect output fields merely to satisfy stale prose.

### E4 — The close/pause prompt forbids an advertised supported action

Existing at baseline. `extractors/close_pause.txt` says `jamás actionIntent=pausar ni pauseRequested=true`. The dynamic schema includes `pauseRequested` when the pause capability is available, and intent projection can allow `pausar` for an active plan. This is a global prohibition inside a module used for both close and pause, not a typed branch-specific instruction about a known close turn.

Small fix: keep close and explicit pause distinct. Select a close-specific module only for a known close branch, or provide compact noncontradictory extraction rules for both supported actions. Never infer a pause from buying a gift or implicitly closing.

### R1 — Router request identity cannot address a retained older request

Existing at baseline; unchanged by concurrent edits. `currentOpenRequest` returns the last list element. `openRequestDigest` projects only that element, and `same_open_request.txt` only permits comparison against `solicitud_actual`. The lane and policy then operate on that same last element. Keeping three stored records does not let the model select an older parked one.

Concrete failure path: refund becomes `with_person`; unrelated date answer creates a new record; refund follow-up is now `new` relative to the date, and the guard for `current.state === with_person` cannot protect the original request. The smallest durable correction is a validated structured selected request key (or new-request discriminator), projected with the minimal retained request identity/state evidence, then used consistently by policy and record updates. A conversation-wide already-escalated flag alone cannot determine which topic to pause.

### R2 — Settlement is requested before the router has the evidence to decide it

Existing at baseline; the working-tree route edit broadens this mismatch. `request_settled.txt` defines settled as a complete answer from authorized records, but router input contains only purchase/cart digests, recent message previews, capabilities, and the last request. It contains no authorized event facts or coverage, FAQ answer evidence, or effects from the future turn. Purchase digests omit payment detail and source completeness. The router can therefore route an event or public FAQ question, but cannot reliably declare that the eventual turn settled it. Current working-tree `route.txt` permits FAQ/public guidance while `request_settled.txt` still describes record-only completeness.

Plan: route using capabilities and current evidence; settle from the actual request-scoped outcome after information/effect execution. If a structured model settlement decision is still required, give that decision the actual relevant typed outcomes, not a prediction from an incomplete digest. No deterministic code should infer intent from wording.

### R3 — Router input describes customer claims as verified facts

Existing at baseline. `router/input_template.txt` declares every field a previously verified fact. The same template inserts `mensaje_actual` and prior message bodies/previews, which can include unverified payment claims, supplied names, or a wrong venue. The prompt should distinguish authoritative runtime metadata from quoted customer reports. This matters especially when a report of full payment must coexist with a pending backend order.

### R4 — Conversation money state can contaminate another request's settlement

Existing at baseline. `agent-service.ts` passes `plan.support_outcome.unresolved_money` into `nextOpenRequestState` regardless of whether the selected current turn is a purchase/refund request. A factual unrelated date answer can remain unresolved solely because another request has disputed money. The correct invariant is request-scoped settlement, preserving the older disputed request independently.

### R5 — Response parser accepts answer-set drift

Existing at baseline. `parseRouterAnswers` requires seeing the three known names but ignores unknown extra choice answers and permits duplicate answers to overwrite prior values. Refusal names are cast to the union without checking membership. Probability entries are bounded individually but their names/cardinality and chosen-value presence are not validated. Probability values do not drive effects, so a choice/probability discrepancy is an observability contract defect rather than an excuse to introduce thresholds.

Small fix: require exactly one answer for each requested question, no extra/unknown names, no duplicate names, and a coherent allowed probability key set when probabilities are supplied. Preserve explicit refusals rather than inventing certainty.

### E5 — Extraction guidance still exists outside tracked prompt files

Existing at baseline. `buildExtractorInputSections` appends instruction text to allowed actions; `buildExtractorCampaignReferenceContext` appends provenance/consent rules; `buildExtractorContinuityEvidence` appends a long imperative branch (`extrae`, `devuelve`, `No saludes...`). These are instruction-bearing Spanish strings inside runtime TypeScript, outside `prompts/`. Their provenance may be visible as an input section, but changing the prompt bundle's text files alone does not inventory the effective instructions.

Move the branch guidance into tracked exact-node/module prompt files selected by typed evidence. Keep the input sections factual. This should reduce duplication and allow semantic ownership and schema-reference checks.

## Automated freshness contracts beyond byte budgets

1. **Schema/module matrix:** enumerate representative typed states (fresh, established support, RSVP pending, active provider plan, shortlist, close-ready, paused) across capability flags. Build the actual production request and dynamic schema with a fake transport. Every loaded module declares required output paths and permissible enum references. Assert paths exist in that request's schema; assert field-specific modules disappear when paths do. Retain explicit declarations for cross-domain recognition rather than an implicit exemption.
2. **Operation consistency:** compare the actual serialized action-intent enum and requested-operation enum to typed textual advertisements. Explicitly distinguish requested operations from available execution operations. Test unsupported user requests remain expressible while execution stays blocked. Fail when `candidateOperations=[]` yields an advertisement inconsistent with the active requested-operation contract.
3. **Tracked instruction inventory:** record every instruction source, its module/node, applicability, schema/evidence dependencies, serialized bytes and content hash in the request manifest. Require runtime factual input builders to return typed data or tracked templates. Add an offline AST/static check for new instruction-bearing model-input strings outside tracked prompt loaders; review exceptions explicitly.
4. **Router template keys:** parse template placeholders and require exact equality with the typed renderer's supported keys; reject unknown placeholders, unresolved placeholders, and unintended unused values. Assert reported-source provenance for user text versus authoritative metadata.
5. **Router answer-set tests:** fake responses with duplicate names, unknown names, missing names, refusal/choice duplication, invalid choices, missing selected probability entries and duplicate probability keys must reject safely. Test all valid choices and refusal outcomes against the requested question schema.
6. **Request identity invariants:** scripted offline transcripts select stable keys through parked-refund → date → refund and multiple unresolved requests. Validate unknown selected keys are rejected, new requests cannot inherit unrelated state, and same-request updates do not overwrite another record. The mandatory live case should assert one successful takeover, the available backend date, and continued correct behavior; avoid internal-node or wording pins.
7. **Post-outcome settlement contract:** assert a successful unrelated factual answer is independent of another request's unresolved money. Assert pending status alone does not imply a verified deficit or payment failure. A failed lookup or unconfirmed effect cannot settle a request just because the pre-router predicted it could.
8. **Schema enum freshness:** generate compact enum lists from the same exported typed registries used by the SDK schema (event type, categories, close action, RSVP source/action), or annotate the tracked module with enum dependencies and compare exact sets. Mutation tests should demonstrate that removing/renaming an output field or enum value makes the freshness test fail.
9. **Non-vacuity and mutation tests:** deliberately omit a required module, add a ghost output path such as `destination_account`, disable RSVP while retaining its instructions, and change the operation advertisement. Each must fail its structural contract. Byte limits remain a secondary resource check, not proof of semantic freshness.

## Validation boundary

This document proposes implementation and tests; it does not certify model behavior or a deployed artifact. No new paid panel should run until development deployment succeeds. Then select only the explicitly approved targeted cases, keep failures visible, and use the repository supervision rubric for delivered Spanish. The current-working-tree fixes require reconciliation with this audit before acceptance.
