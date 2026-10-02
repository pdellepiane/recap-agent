# Gift fulfillment types and SE campaign context — work package

Status: binding fresh-thread implementation package; gift/campaign changes remain unimplemented.

## Fresh-thread starting point — read first

Audited HEAD: 5cc5020c. Recent commits c011ee89 and 5cc5020c already implement native receipt extraction, authorized receipt discovery and its prepared regression panel. Preserve them. Their reported offline result is 2154 passed / 5 skips; their live panel remains unrun. This is reported prior validation, not a new run by this audit. Do not rebuild the receipt feature, revert its captionless behavior or reuse old fixed suite counts. Read the actual HEAD and registry before editing; incorporate newer unrelated work if HEAD advanced.

This file is self-contained and supersedes the earlier gift/campaign handoff for this scope. Execute A and B1; B2 is a parked backend dependency, not a reason to stop A/B1. No new backend endpoint, campaign schema or request flag is required to complete the actionable work.

Scope: the user-supplied gift item contract plus a read-only audit of the SE conversation-message API. No deployment, model generation, promotion or customer message is authorized by this package. Implement offline and prepare regressions; live validation remains a separately scheduled step.

## Decisions

1. Item `type=se_store` means a physical gift. `type=credit` means the hosts chose to receive its value as account credit, so that item requires no gift shipment. This is a host choice, not a buyer choice or a default chosen by the assistant.
2. Classification is per item. The supplied two-item order is mixed, not wholly physical or wholly credit. Discuss the sheets and honeymoon contribution separately when the question needs that distinction.
3. Account-credit mechanism and actual payment posting are different facts. The user states credit is automatically/immediately deposited into the hosts' account. Represent that as the fulfillment policy, not proof that an individual pending, failed or refunded payment has posted. Do not invent a balance, ledger entry, withdrawal, bank payout or posting time. When needed, explain the automatic account-credit mechanism together with the actual backend payment state.
4. Physical type establishes delivery relevance, not who receives the package, its address, carrier, dispatch date or ETA. The user explicitly did not establish the recipient. Use those details only if the authorized record supplies them.
5. For a shipping question about a physical gift: answer available shipment facts; if the requested detail is absent, offer the existing human-support path for specifics. An offer is not an executed escalation. Execute it only on an explicit request/accepted offer under current authorization/deduplication rules and report its real receipt.
6. A credit item has no gift shipment even when its name describes a physical product. Conversely, a physical item remains physical even when shippingStatus is null. Do not infer type from gift_name.
7. Unknown/missing item type means unknown fulfillment. It does not mean credit, physical, or no shipment. Preserve existing independently grounded physical types, but do not silently classify other codes as credit.
8. `dedication.sendPhysical` concerns a separate physical dedication/card artifact. It must not turn a credit gift into a physical product or erase no-gift-shipment semantics. Explain the separate card only if relevant and evidenced.
9. Keep all conversational text model-authored. Deterministic code maps explicit backend enum facts and validates receipts; it does not choose intent through keywords or inject fixed customer sentences.
10. Campaign metadata is a separate backend-contract integration. Do not infer its shape from the name `campaign`, and do not equate it with the existing source=admin_campaign field. Its observed contract determines the implementation scope below.

## Verified code findings

- Agent gateway purchaseItemSchema accepts gift_name, quantity, amount, row_total and type. Purchase mappers preserve item.type. The transport does not currently lose se_store/credit.
- src/runtime/purchase-disclosure-policy.ts: hasPhysicalFulfillment recognizes physical/product aliases but omits se_store. Direct invocation on se_store-only and the user's mixed se_store+credit shape returns false. This can strip valid shippingStatus in information-orchestrator.ts.
- information-orchestrator.ts projects items only for the summary aspect. A shipping-only request can therefore omit the decisive item types.
- The stored response_contract.txt limits physical-delivery language to shippingStatus or sendPhysical=true; that excludes an se_store gift with unknown shipment status. Inspect actual selected modules before changing prompt text: an unused historical prompt edit is not a fix.
- customer-context.ts stores items and merges them by taking the first nonempty list. Do not rely on a second response to repair missing per-item type without checking this merge. Do not merge line items by gift name or amount.
- Existing physical-fulfillment tests cover cash, product and sendPhysical, not the actual se_store/credit contract. Existing green tests therefore do not establish correct behavior for the supplied payload.

## Implementation ownership

Two implementation packages plus coordinator verification. Workers share the tree, must preserve other edits, and must not deploy or run paid calls. Package A owns gift data/evidence and scoped guidance; package B owns existing campaign event-scope corrections now; only ingestion of a new structured campaign field waits for its observed contract. Coordinator owns regression fixtures, semantic requirements, real coverage commit hashes and shared-file integration. Do not add another router, cache, customer profile, handoff executor or global disclosure prompt.

## A — Gift evidence from backend to actual model input

Fixed data contract for the local change: keep raw item.type and derive one optional model-facing `fulfillment` object per canonical item, containing `kind: physical | host_credit | unknown`, `chosenBy: host | null`, and `giftShipmentApplicable: boolean | null`. `se_store` maps to physical/null/true; `credit` maps to host_credit/host/false; an unrecognized/null code maps to unknown/null/null. Existing independently supported physical aliases map to physical/null/true. This object is computed from the current record, not a new persisted state machine. Share the credit mechanism as one scoped policy fact when relevant rather than duplicating explanatory prose per item. No fact named credited=true may be derived from type.


Files to inspect/edit:

- src/core/information.ts: purchase item and model-facing fulfillment fact types.
- src/runtime/agent-conversation-gateway.ts: preserve the supplied item fields; do not change endpoint request semantics for this fix.
- src/runtime/purchase-disclosure-policy.ts: single pure fulfillment mapper.
- src/runtime/information-orchestrator.ts: projection for summary/shipping/dedication and authorized source selection.
- src/runtime/customer-context.ts: canonical item representation and conflict-safe merge.
- src/runtime/purchase-reply-projector.ts and reply-evidence-projector.ts: whichever is actually consumed on the relevant reply path.
- src/runtime/openai-agent-runtime.ts and prompt-manifest.ts: only to connect scoped evidence/module selection to production serialization.
- prompts/nodes/resolver_consultas_informativas/: change the selected shipping/fulfillment guidance, not every prompt file.

Required edits:

1. Centralize `se_store -> physical`, `credit -> host_credit`, other unrecognized/null -> unknown in purchase-disclosure-policy.ts. Reuse that mapper wherever fulfillment is projected. Retain known existing physical aliases as supported observed types, without creating alternate mapping tables.
2. Extend the existing canonical item evidence with minimal facts: fulfillment kind; host choice for credit; gift-shipment applicability. Keep raw type for provenance. Treat applicability as true/false/unknown, not a Boolean that collapses missing data into no shipment. Do not add a persistent gift lifecycle.
3. Compute any aggregate mixed/physical/credit/unknown view from item evidence when needed. Do not store both a full duplicate item array and a separately maintained fulfillment profile. Reuse canonical references in the existing profile.
4. Expose the relevant item names/types/fulfillment facts on shipping-only requests even without summary. Include quantity/amount only if useful for distinguishing items or requested. Currency comes from the record, not Spanish language or the example numbers.
5. Preserve available order shipment status for applicable physical fulfillment. Never attach a whole-order shipment status to a particular line if the endpoint does not establish that scope. For credit-only gifts, don't invent shipping from stale order metadata; retain/report a source conflict if necessary.
6. Keep physical dedication/card evidence separate from gift fulfillment. Reuse the existing dedication representation; do not reinterpret sendPhysical as product type.
7. For repeated snapshots with same authorized order identity: enrich missing item data only when stable line identity or an exact unambiguous correspondence exists. The supplied payload has no line ID: do not fabricate one or union by name/amount. Preserve unresolved source conflict/partial coverage rather than silently dropping or duplicating gifts. No broad merge rewrite beyond the fields needed here.
8. On a shipping question, send the model the classification, available shipment facts, missing requested specifics and actual human-support availability/outcome. Replace the old implication that no shippingStatus means no physical gift. For unrelated payment, FAQ, image or RSVP turns, omit this guidance unless the answer needs fulfillment information.
9. Make credit policy factual evidence: choice made by host, fulfillment through account credit, no gift shipment. Do not put an entire suggested answer into evidence. Preserve paymentStatus independently. Model wording must not assert already credited from type alone.
10. Human support: keep requestHumanTakeover and current typed handoff outcomes unchanged. An unsupported shipping detail allows an offer; no automatic request merely because a value is missing. If the customer explicitly asks for a person, execute once and report requested/failed/unknown/skipped truthfully. No assigned-team, accepted-case or promised-contact claim without evidence.

Serialized proof, not just unit objects:

- Parse the exact two-item payload through the gateway, execute a shipping-only request with mocked authorized gateways, assemble canonical profile, and build the real reply request. Assert both item types and distinct physical/no-gift-shipment facts survive in spec.input.
- Pure se_store plus null shippingStatus still exposes physical relevance and missing shipping details.
- Pure credit plus an explicit shipping question exposes host choice and no gift shipment. A pending payment remains pending; no credited-now fact is manufactured.
- Credit plus physical dedication shows two separate facts, not contradictory product shipping.
- Unknown type stays unknown. A physical-sounding name with credit stays credit.
- Conflicting/missing type across snapshots never merges distinct gifts or hides uncertainty.
- No irrelevant shipping directions appear in imageless payment-status, RSVP or general FAQ serialized requests.

## B — SE message campaign audit and integration boundary

Current request and normalized contract:

- GET /conversations/messages?phone_number=<trusted conversation phone>.
- Authentication is the existing X-Agent-Key header, never printed.
- No campaign flag, field selection, pagination cursor or limit is requested by getRecentMessages.
- Current mapped fields: id, direction, source, body, status, whatsapp_message_id, sent_at, created_at.
- AgentConversationMessage and messageSchema omit campaign. The explicit mapper discards it even if returned by the backend.
- Existing campaign behavior derives context from outbound direction + reminder-family source, message body, server time and delivery state. It already uses campaign text; it does not use a structured campaign property.
- Normalized tool traces record counts/directions/sources, so the absence of campaign there cannot establish raw endpoint absence.

Live observation, 2026-09-21 16:17:26–55 UTC: two read-only GETs to the real SE endpoint returned HTTP 200 and five outbound messages for an existing audited conversation. Sources included admin_campaign, frontend_followup and external. All five messages had exactly id:number, direction:string, source:string, body:string, status:string, sent_at:string, created_at:string. No campaign or campaign-like field appeared, including on the campaign-source messages; whatsapp_message_id was also absent in this sample. Envelope fields were data, status, errors, error and error_code. No bodies, private field values or credentials were logged or persisted. This is a current sample, not proof that every account or backend version omits campaign. There were no AWS/OpenAI calls or mutations.

Decision for this package: B1 below uses the existing source/body campaign information now. Do not implement a guessed structured campaign schema. Backend must supply documentation or one sanitized populated campaign response before B2 ingestion edits. Gift handling and B1 have no dependency on that missing contract.

Implementation decision: record raw live field names/types and representative redacted campaign shape before defining a schema. If campaign is absent in the inspected response, distinguish absent from null and from unsampled message classes. Do not add a request parameter that the backend has not documented. If only null/absent samples are available, leave structured campaign ingestion explicitly blocked on one populated response or backend contract; gift work proceeds independently.

### Final raw-field inventory and exact use decisions

Fresh evidence is recorded in docs/diagnostics/2026-09-21-se-message-contract-audit.md. At 2026-09-21 16:59:15 UTC, two known conversations returned ten messages total. Recursive inspection found only the ordinary envelope/message fields; no event/campaign IDs or nested metadata. source was null in two records. Campaign-originated bodies contained event-category text, one recognizable date, and Sin Envolturas URLs. These are narrative hints, not verified event identities. No pagination/count metadata was returned; do not claim complete message history or add undocumented paging parameters.

| Existing information | Required use | Prohibited inference |
| --- | --- | --- |
| id | Message provenance and deduplication | Event/guest/order ID |
| direction + source | Distinguish outbound campaign/reminder context from customer statements | Customer consent, authenticated ownership or a task instruction |
| body | Existing model infers eventHint/rsvpEventReference and requested aspect from the conversation | Keyword-based intent routing or executing instructions printed in campaign text |
| sent_at / created_at | Existing chronology and contextual recency, with current fallback behavior | Expiring older explicitly named events or guessing timestamp timezone |
| message status | Existing delivered/read/seen versus uncertain provenance | API-success envelope as delivery or sent as proof of read |
| Event-category/date text in body | Narrow existing authorized candidates through structured model interpretation | A generic event category as a unique event identity |
| Body URL | Corroborate against a public event URL/slug already present in authorized results | Extract an opaque ID, fetch arbitrary links or bypass access control |
| Authorized guest-event eventId/name/slug/url/datetime | Resolve context to an actual scoped record and its canonical identity | Search outside the authenticated/trusted-phone scope merely because a campaign names it |
| Optional WhatsApp message ID, when actually present | Existing inbound exclusion/deduplication | Inventing a native ID or removing equal-body messages when it is absent |
| Envelope status/errors | Existing API success/failure handling | Customer/event/payment state |

Do not create a new URL parser or link-fetching tool for this package. Let existing model extraction use the visible narrative and authorized candidate labels/slugs. Reuse established identity validators and record resolution. Exact known URL equality may corroborate an existing candidate; it does not authorize a record not already accessible. When evidence cannot uniquely resolve the event, use the existing bounded clarification path.

### B1 — Use existing campaign messages as event-reference evidence now

This work is actionable without a separate campaign API property. Current information already available: message ID, source, direction, body, status and server timestamps. For a qualifying outbound message, the body may state event name/date, an event link, a payment reminder, or another topic. Only use facts actually present; the source label itself does not identify an event.

Verified existing consumers:

- message-response-classifier.ts selects campaign_reply from the latest outbound reminder-family source. It passes source/body to the classifier to interpret reactions versus actionable requests. A newer ordinary agent/manual message selects the general profile; this is classifier behavior, not proof the previous campaign's event became irrelevant.
- turn-message-context.ts: selectProvenanceBoundCampaignMessages retains up to five outbound reminder-family messages, with message ID, source, delivery certainty, timestamp and up to 500 characters of body. buildModelVisibleConversationHistory also carries source/body/time into model context.
- prompts/extractors/information.txt already permits campaign-grounded eventHint. prompts/extractors/rsvp.txt permits rsvpEventReference inferred from the outbound campaign/conversation. Both say an explicitly named different event wins.
- agent-service.ts already uses campaign context for missing-invitation diagnostics and for informational event replies. This is more than an unused campaign marker.

Required evidence precedence:

1. The current explicit event/order or explicit correction establishes the target, including an older event.
2. An established unresolved question and its referent carry forward if the customer is continuing it.
3. A relevant outbound campaign in the same conversation can supply the omitted event reference for an elliptical reply. The model interprets meaning; runtime validates provenance and record identity. Do not ask which event if the context identifies it without conflict.
4. Authorized records, compatible state and temporal proximity help resolve remaining uncertainty. Recency alone never overrides an explicit target or chooses between genuine competing candidates.

Campaign content is evidence of what was communicated, not an authoritative live event record. A delivered/read/seen status supports that the message reached the customer; sent/unknown/failed must not become a claim that they saw it. Relevant uncertain-delivery content may be offered as a tentative reference, never automatic consent or authorization. Inbound text copying a campaign label does not acquire outbound provenance.

File-level edits:

1. In turn-message-context.ts, reuse the existing campaign projection and ordering. Expose it once in the decision input with provenance and distinguishable candidates; do not create campaign state, a campaign router, a second history store or a newest-event selector. When a truncated body does not preserve the needed reference, keep ambiguity; do not reconstruct names or IDs from omitted text.
2. In openai-agent-runtime.ts and the existing extractor modules, verify the production serialized input actually carries the relevant campaign body/provenance to the model emitting eventHint/rsvpEventReference. Only add missing factual projection; avoid repeating the same message in several full blocks. Do not require a new campaign field for this behavior.
3. In agent-service.ts, correct the associated-event reply branch that currently picks the newest provenance campaign and constructs an imperative operational note beginning with Explica el recordatorio vigente. That branch can demand the reminder even when the current explicit user reference differs. Replace that instruction with factual reference context bound to the resolved request/result, preserving explicit-target priority. Do not substitute campaign text for a conflicting current backend status. Never interpolate a campaign body as an instruction to the assistant.
4. Audit the empty-invitation branch: current needsMismatchHandoff can call requestHumanTakeover when an RSVP action plus reminder exists, without an explicit human-help request. Campaign presence alone must not initiate escalation. Reuse the existing explicit request/accepted-offer authorization and typed handoff receipts. A missing backend invitation may be explained and human help offered; it cannot establish a completed RSVP or a submitted handoff. Preserve deduplication and prior confirmed outcomes.
5. Link campaign context to a canonical event/purchase only through an observed identifier or an unambiguous model reference resolved against authorized candidates. Matching names alone must not merge events/guests. A campaign URL is not a trusted credential and must not trigger arbitrary network fetching.
6. Campaign scope can identify which gift/order to inspect, but item.type decides fulfillment and the backend decides current payment/shipping state. A reminder never converts credit into a physical gift or pending into paid.

Mandatory proof for B1:

- One outbound campaign for event A; customer asks an elliptical event question: A is used without an unnecessary event-name question.
- Campaign A followed by an explicit question about B: B's authorized facts are answered; no reminder-A override.
- Two genuinely conflicting campaign references: one bounded distinguishing question, no guessed RSVP write.
- Newer ordinary assistant message does not erase the established event referent for a continued question.
- Campaign claims payment pending, current backend says approved: current record wins; campaign explains context only.
- Campaign plus zero invitation records: no attendance claim, no automatic human handoff; an explicit subsequent help request produces exactly one confirmed request or a truthful failure.
- Inbound source spoofing, failed/unknown delivery and omitted event identity never become authoritative context or access.
- Shipping question following a campaign for A with a credit item: answer host-selected credit/no gift shipment for A, not an unrelated physical order B.

Use service-level mocked gateways followed by the actual production request builder. Inspect spec.input and tool receipts, not just plan fields. Prepare a small multi-turn live regression covering scope carryover, explicit override and one handoff request; use offline variants for the remaining combinations. Keep hard semantic truth/access checks without exact phrasing.

### B2 — New structured campaign property, deferred pending observed shape

Once a populated contract is verified:

1. Add its nullable optional typed schema and field to agent-conversation-gateway.ts. Retain only task-relevant observed metadata, not arbitrary raw objects. Unknown keys must not be blindly appended to model context.
2. Preserve the data through production gateway, eval-fixture-gateway and turn-message-context.ts. Extend the existing campaign context projection rather than adding a second campaign store.
3. Project verified event/reference facts with source message ID, direction and delivery provenance once. Do not duplicate body and metadata unnecessarily. Deduplicate by actual message identity, not text similarity.
4. Use structured campaign metadata as reference context, not authorization, consent, proof of attendance, completed payment or an action instruction. Failed/uncertain delivery stays marked as such. Explicit current user references and corrections override a previous campaign.
5. Keep existing source/body context for historical messages without structured metadata; this is legitimate coexistence of endpoint records, not a new compatibility service. Do not decide conversational intent by campaign-name keyword matching.
6. Update buildModelVisibleConversationHistory, selectProvenanceBoundCampaignMessages and message-response-classifier.ts only where the verified metadata materially improves the current decision. Keep unrelated messages free of campaign policy sections.
7. Test raw message -> gateway normalized object -> history/classifier/extractor/reply serialized evidence. A new TypeScript property with no final consumer is incomplete.

## Regression and validation contract

Extend existing tests: purchase-disclosure-policy.test.ts, s09-purchase-reply-projector.test.ts, information-orchestrator.test.ts, l4-customer-context*.test.ts, runtime-actual-request.test.ts; gateway and campaign/turn-message-context suites for package B. No parallel test harness.

Prepare these permanent live cases with synthetic identities and hard structural + hard requireJudge semantic assertions:

1. se_store shipment question, no shipping detail: physical nature retained; offer real support, no ETA/recipient invention.
2. credit shipment question: host chose value as credit; no gift shipment; no unsupported posting claim.
3. Mixed example: answer about the specified item; for an order-wide question distinguish both items, no whole-order no-shipping claim.
4. Pending credit payment: host-credit policy and pending payment coexist without fabricated settlement.
5. Physical gift with real shipping data: answer that data, no unnecessary handoff.
6. Credit plus physical card/dedication: distinguish products from the separate card.
7. Unknown type: preserve uncertainty, no type inference from gift name.
8. Accepted human-support offer after physical-shipping limitation: exactly one real handoff receipt, truthful result, no repeated escalation on thanks.
9. Existing campaign source/body scope and explicit-reference override: prepare the B1 multi-turn case now. Structured campaign populated/absent/null coverage is B2 and waits for the actual field contract; preserve separate labels so the entire campaign work is not mistakenly deferred.

Judge meaning, not prescribed wording. Requiring shipping details that the fixture does not provide is a harness defect; claiming shipped/delivered/credited or human help requested without evidence is a product failure. Host choice is a required factual distinction when explaining credit. Credit does not mean the giver chose cash or the bank has paid the hosts.

Run typecheck, affected offline suites and coverage registry. Run the full offline suite once when implementation settles. Measure changed serialized instructions/input bytes: no global prompt growth for unrelated turns, no duplicate full profile, no extra model stage. Record actual commit identities in live-behavior-coverage.yaml, not placeholders. Update implementation-log with exact evidence and unrun live cases. No deploy/live spend is part of this planning request.

## Definition of done and handoff result

The user's item codes survive gateway -> canonical profile -> actual model input; se_store physical fulfillment no longer disappears; credit correctly represents the hosts' choice without fabricated posting; mixed orders/card artifacts retain their distinctions; support offers and completed handoffs remain separate. Campaign findings state what was requested, what was observed raw, what was dropped and what reaches the model, including sample limitations. Return scoped commits/files, offline tests, serialized proof, prompt-size deltas and the prepared live panel. Do not call this production-validated without a later authorized run.

## Audit validation performed

Existing purchase-disclosure-policy and s09-purchase-reply-projector suites: 20/20 passed, no network/model calls. These suites lack the actual se_store/credit cases; their passing result is not proof the requested behavior exists. A direct execution of the current fulfillment helper returned false for se_store-only, credit-only and mixed se_store+credit records, confirming the physical-type omission. No application code or prompts were changed during this planning audit.

## 2026-09-21 clarification

The existing campaign source/body is already used and can establish an inferred event reference. B1 is now explicitly actionable; only the absent structured campaign-property integration (B2) remains deferred. This package update changes no runtime code and makes no new live-validation claim.

## Execution order and finish protocol for the fresh thread

1. Read this package, AGENTS.md and the newest implementation-log tail. Inspect git status. Preserve .gitignore/.ignore and unrelated plan/audit files; never reset the tree. Confirm the receipt commits are present or superseded, not missing by assumption.
2. Start A with raw-item mapping and physical/credit/unknown tests. Then connect shipping-only projection and canonical profile consumption. Complete actual serialized-input proof before modifying conversational instructions.
3. Implement B1 against the existing message contract. First protect explicit-reference precedence and eliminate the unconditional newest-reminder imperative; then ensure factual campaign context survives in the real model input. Preserve the current bounded message window and no-extra-call behavior.
4. Correct the campaign-mismatch automatic handoff path by using the existing explicit request/accepted-offer evidence. Never substitute a string operational note for typed handoff outcome. Test zero effects without consent and one receipt with consent. Do not loosen identity or verified-RSVP constraints.
5. Coordinator integrates source edits before the evaluator owner changes affected oracles. Every changed old expectation gets an R05 note identifying the invalid assumption; old reports remain untouched. Do not revise an oracle just to reward a candidate's chosen wording.
6. Prepare mandatory live cases for the new behavior. Use the existing mock gateways/fixtures; no calls to real customer accounts in tests, no new framework. Add behavior-change coverage with actual implementation hashes in the established commit sequence.
7. Run offline typecheck and affected suites, coverage registry, then the full offline suite once after integration. Record pre-existing failures separately with evidence, not an unsupported historical label. No skipped new cases.
8. Measure serialized prompts for physical, credit, mixed, campaign-scope, explicit-override and unrelated FAQ/RSVP turns. Native receipt transport/call counts must remain intact. No new model pass or blanket gift/campaign instructions on unrelated turns.
9. Commit scoped implementation/evaluator/log changes. Return the exact hashes, file list, tests, captured-input proof and prepared case IDs. Keep paid runs and deployments HELD. Report B2 as contract-deferred, A/B1 as complete only if their proofs pass.

Do not add automation, perform production promotion or request backend changes on the user's behalf. The package is an offline implementation authorization. It does not authorize messages to team members.

## Copyable fresh-thread assignment

Implement packages A and B1 in this file on the current repository, preserving receipt commits c011ee89/5cc5020c and all subsequent unrelated work. Read the source and the dated SE audit to confirm the starting point. The decisions in this package are binding: per-item physical/host-credit/unknown evidence; existing campaign source/body as scoped reference evidence; explicit user target over newest campaign; no inferred action consent; no invented backend campaign schema. B2 remains deferred and must not delay A/B1.

Use two implementation owners if delegating, with sequential integration for shared runtime files and a coordinator-owned proof/test pass. Implement rather than returning another plan. Complete offline validation, actual serialized-input/SDK-wire evidence and the prepared mandatory live cases; record real implementation hashes and update the log. No deploy, paid call or production claim. Return precise completed work, tests, byte/call deltas and remaining limitations. No decisions are delegated about extra architecture, new API endpoints, release scope or model changes.

## Implementation review amendment — c771f280

Follow gift-campaign-review-and-dev-gate-2026-09-21.md before deployment. User clarified that authorized quantity/unit amount/row total must remain available on shipping-only model inputs; omission from customer prose is separate. Positional item merging is rejected: reordered lists and three-snapshot conflicts reproduce data loss/false resolution. Internal type codes remain useful evidence but must not be cited as schema labels to customers. The review package defines the correction and frozen development-gate handoff.
