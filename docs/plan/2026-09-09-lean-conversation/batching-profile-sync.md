# Backend batching and customer-context enrichment — sync decisions

## Binding correction: no package protocol

Read [inbound-continuity-correction.md](inbound-continuity-correction.md) first. Backend batching is invisible: Lambda keeps text + optional image. Earlier ordered-parts/package-schema implementation directions are withdrawn. No timer or batch state. Answer current requests, persist supplemental images quietly, and respond to later questions without repeating resolved explanations.

## Current execution contract

[lean-image-execution-contract.md](lean-image-execution-contract.md) is authoritative for implementation: five-day native image retention, existing mutex reuse, no description model pass, bounded profile enrichment, atomic file ownership and strict acceptance. Earlier 30-day retention is superseded for new uploads.

2026-09-11. Planning amendment only; preserve active implementation. Supersedes conflicting image-only acknowledgement defaults in persistent-image-context.md. Storage choice remains OpenAI Files for base64, with existing documented limits. Campaign integration is deferred until the backend supplies its contract.

## Current evidence

Current AgentService has production calls to assembleCustomerContext and projectCustomerContext. The earlier absence finding is historical, not current. This does not prove enrichment completeness or relevance. The implementation log records the handoff fix and full c09505d1 gate: effect restored, strict gate still red (36 failures plus one error). No new live verification or deployment in this amendment. Another client's live activity is not observable from the available task list; do not assume exclusive runtime ownership.

## Message-package contract and three cases

Backend owns its approximately eight-second batching window, including the reported delay after image arrival. Treat a received package as complete for that invocation; do not add another eight-second Lambda sleep, local debounce or competing grouping service. The exact upstream array/envelope, message identity, order, delivery retries, and window-reset/max-duration rules still need confirmation from docs. Do not invent wire fields. Plan support now, implement adapter schema changes only against the actual contract.

Normalize a package into ordered user content parts preserving supplied text/image association, IDs and timestamps; keep core channel-agnostic. Do not concatenate all text and append all images in a way that destroys their relationship. Persist image references with the existing conversation coordination and render at most one coherent conversational response per package. Transport acknowledgement and user-facing chat output are separate: a successful package can carry a typed suppress disposition.

1. Text then image: within one package, the question and image form one turn. Across packages, preserve any unresolved question; the image can fulfill it without asking the user to repeat. Do not guess unseen image contents while waiting.
2. Image with text: include both as native input in the same turn. Answer the supplied question; no automatic image inventory or extra acknowledgement message.
3. Image then text: within the backend window, answer the combined package once. If the text arrives after the package has already been dispatched, persist the image first; the later invocation reloads its reference and answers from original pixels. Multiple image parts preserve their individual linkage. Existing image count/size limits must produce explicit availability evidence rather than silently dropping needed content.

A package containing only images receives NO conversational reply by default. Persist the attachment and return a successful typed transport acknowledgement/suppression. Exception: if an image supplies evidence for an already outstanding request or task that needs a response, the established owner continues that task. This is not a blanket image-suppression rule. The existing owner/extraction path decides semantic relevance; code may recognize content types but must not decide intent by keywords. Do not add a model call solely to acknowledge an attachment. No scheduled clarification if the expected next text never arrives.

Do not claim to have read an image simply because upload succeeded. No unsolicited OCR, receipt narration or canned acknowledgement. If image access fails on a question-bearing turn, the model reports the limitation and offers the useful recovery. A failed upload cannot masquerade as successful durable storage; preserve retryable transport behavior. Legitimate image-only silence must be distinct from missing generation and model-origin failure in acceptance evidence.

## Profile expansion: comprehensive available evidence, compact model view

The goal is a well-populated authorized profile that can answer in the first useful turn. It is not an indiscriminate dump of every record. Reuse the single information orchestrator, normalized domain models, caches and existing customer-context assembly; no second profile agent/database.

Start independent authorized summary reads together. Expand the detail of relevant candidates proactively rather than asking the user for information that can be read. Hydrate typed relationships such as order -> payment/items/event, invitation -> event, or event -> venue when real APIs support those reads. Include all useful returned fields in the typed internal snapshot with provenance, freshness and availability; keep tokens, credentials and fields outside the permitted access scope out. Unknown, not requested, unavailable and empty are different states.

Bound graph traversal: two relationship edges from root summaries per enrichment pass, four concurrent read requests, a visited set keyed by resource type + stable ID + access scope, and the existing per-turn deadline. These are initial runtime bounds, not domain filters. Cache identical reads within the turn. Pagination and continuation remain explicit; hitting a bound cannot claim a complete profile. The same owner can perform a focused deeper read when the current question needs it, without user confirmation for authorized read-only work. Do not recurse through arbitrary URLs or every relationship on every historical record. Measure and revise limits from real endpoint latency, retaining the same behavior tests.

Project relevant detailed facts plus concise candidate summaries into the actual owner request; irrelevant fields stay outside model context. Unexpanded older records remain discoverable through the summary/index and bounded retrieval, even if they are not in this prompt. Never truncate a collection silently or label an unexhausted pagination result complete. There is no automatic age cutoff. If APIs already filter or cap history, record that coverage limitation rather than claiming older records remain fully available.

## Selecting likely records without discarding history

Use structured model interpretation of the question, explicit references, existing conversation links, payment/order state, event relationships and timestamps together. Recency is a prior, not an authorization or unique identity rule. Pending status plus a voucher can make an order a plausible target; it does not prove the voucher belongs to it. Keep observed backend state, user-reported payment and inferred target association separately typed with provenance.

Prefer explicit historical references over recent records. Preserve unresolved candidates when multiple records fit. Read additional authorized detail before asking the user; clarify only if ambiguity materially affects the answer/action. Never ask confirmation merely to expand readable details. Never execute effects, expose another person's record, or mark payment approved based solely on recency, pending status, an image or an inferred association. Use current authoritative effect preconditions. Include the current date and source timestamps where time interpretation matters; distinguish event date, order date and payment date.

## Campaign parameter — deferred

Record planned sibling metadata alongside image/text at the adapter boundary, but implement no new field, parsing, prompt, routing or behavior until backend documentation arrives. Unknowns: type and meaning, package versus individual-message scope, relationship to historical campaign messages, trust/provenance, and conflict semantics. Campaign metadata must not be assumed to represent current user intent, identity, authorization or payment state. Do not hard-code a campaign schema now.

## Atomic implementation packets after contract verification

A. Message package adapter + image continuity: own real inbound contract normalization, ordered content linkage, persistence and one-response/suppress behavior. Integrate the three cases through the existing owner path. No extra batching service. Do not alter the deferred campaign surface.
B. Profile enrichment + model projection: own orchestrator traversal/cache bounds, availability/completeness metadata, candidate interpretation and production model projection. Keep the separate attachment storage path intact. Coordinate shared AgentService edits serially with A.
C. Acceptance reconciliation: own full-context cases and evidence for A/B; preserve the separate-reviewed evaluator repair process. Do not restore retired inspect tools or canned replies to appease obsolete expectations.

Mandatory scenarios: all three image/text orders within and across packages; later text beyond eight seconds; question before image; image-only silence; outstanding request fulfilled by image; duplicate/reordered/concurrent packages; unavailable/malformed image; multiple images and ambiguous references; one chat reply per package; original image available after cold start/owner transfer. Use simulated time locally and real separate invocations live, without production sleeps.

Profile pairs: recent pending order + voucher; multiple pending orders; newest approved order but explicit older pending target; explicitly years-old event; question with no date; past/current records sharing event name; old-record pagination; detail reveals different target; cyclic relationships; read failure/deadline; no redundant confirmation; irrelevant history excluded from prompt but still retrievable; effect target ambiguous -> no write. Preserve current full-context payment/cart scenario and its hard semantic/structural checks.

Register each behavioral change independently, run service-to-model integration tests and request-size measurements, deploy current dev bytes under verified se-dev/us-east-1 account 684516060775, then run the complete mandatory live suite. Record actual completion separately from this plan. Preserve existing release gates and other active repairs. No runtime/prompt/deployment change was made by this sync note.
