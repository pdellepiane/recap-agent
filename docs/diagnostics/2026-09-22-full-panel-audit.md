# Audit of development run 6fbaa685 — 2026-09-22

## Scope and confidence

Reviewed attachment, HEAD dbe6c4ea, f285a74f/04995bfa/9f0675a8 changes, all 18 case results and 28 delivered turns, tool traces, execution summaries, manifest and source paths. No new deployment, production operations or model generations. The three local stored-response audit files dated September 21 cannot be opened: OS PermissionError. Consequently the exact extraction eventHint and exact truncated KB text are corroborated by the implementation log but not independently reread from raw OpenAI bodies in this audit. Source proves the filtering/truncation mechanisms, and run artifacts prove their failed outcomes. Do not describe this as a complete raw-prompt audit.

## What happened

This is not another transport or fixture-partition collapse. Source routing now works; receipt dual-source discovery and matching pass; unsolicited miss handoffs stopped in this panel. Artifact binding now exists: manifest before/after both liZ4KQmUvjRh0hL/LDHVNchlig0Bq/deyc4QT8u/rd0=, digest 962678290994be3461d212ff2c31d535c8658a0d01abf75ec9ce104fcbbfaddd, verified-aws. This confirms the run's recorded dev identity, not current AWS state or independent source-to-ZIP reproducibility. Production unchanged is reported deployment evidence, not freshly queried here.

The next existing layer strips valid candidates using ambiguous model-generated event/amount selectors. Downstream replies then faithfully describe a fabricated empty result. A separate FAQ projector removes the answer. Several remaining failures are usefulness omissions or brittle judging, not equivalent to false settlement or wrong identity.

Our prior guidance correctly addressed routing but failed to require a full audit of candidate filtering and the actual question semantics in its integration tests. Fixing one boundary at a time explains the repeated live surprises. The previous recommendation to keep synthetic KB evidence fixed was also not completed: the hours case still relies on live retrieval.

## Case-by-case disposition (historical scores unchanged)

| Case | Independent assessment |
| --- | --- |
| campaign_scope_carryover | Tool-label oracle defect is confirmed: unified purchase result exists, semantic passes, only phone-label pin fails. Credit-purpose wording has the same issue as card but is accepted here; rubric inconsistency. Check actual source/access evidence rather than accepting any generic tool label. |
| gift_credit_pending | Real retrieval/selection failure. Gift lookup occurs, but answer claims absent record and requests receipt/code. Wrong context reaches reply. |
| gift_credit_states | Same real selection failure; another prompt example is insufficient. |
| gift_credit_card | Main distinction is correct. Added credit purpose is not established by supplied type facts. send_physical plus preparing can support intended physical sending; it does not support shipped/delivered. Do not classify future intent alone as fabricated dispatch. |
| gift_mixed_order | T0 correctly distinguishes items; T2 gives quantity 1 and amount 150. T1 wrongly says no purchase for 80 despite remembering the contribution. Confirmed conflict between current filtered result and conversation evidence. |
| gift_sestore_shipped | Pass; correct recorded in-transit answer. |
| gift_sestore_unknown | Truthful limitation; missing useful human-support offer is a completeness failure under the agreed business requirement, not factual corruption. Generic physical fulfillment is not automatically a shipment-status claim. |
| gift_shipping_handoff | T0 completeness gap. T1 actual accepted handoff succeeds once. T2 “Ojalá ... pronto ... quién recibió” is not proof of another action or a promise; it does presume receipt of a gift not known delivered. Judge rationale exaggerates the action claim but there is a narrower grounding concern. |
| gift_unknown_type | No invented date or explicit physical claim; next step and applicability uncertainty are insufficiently helpful. Do not require customer-facing technical terminology such as fulfillment type. |
| receipt_alone_then_followup | T0 is a useful pending + 72-hour answer; missing method repetition is overstrict if policy applicability is already grounded. T1 answers “Me confirmas si ya quedo registrado?” with existing registered/pending state. “Ya quedó registrado” is ambiguous, not proof that the agent claims a new write. Review entity semantics (existing order/payment entry vs newly registered transfer), not tense alone. |
| receipt_approved | Pass; approved backend state without receipt transcription. |
| receipt_dual_same_amount | Pass; reads both sources and asks meaningful event discriminator. |
| receipt_explicit_older_target | Pass; correct older context. It still reads both sources on the image turn: outcome passes but unnecessary-read objective is not fully achieved. |
| receipt_gift_only | Pass; gift found, unrelated cart not recited. |
| receipt_non_receipt | Real failure to answer hours. Source projector clips prefixes; exact missing text requires raw-input verification. Retrieval was not mocked into a fixed synthetic world. |
| receipt_text_pending | Correct pending/image distinction but omits useful expected validation window. Completeness gap; do not mandate repeating method already stated in T0. |
| receipt_with_text | Useful pending + 72-hour answer. Sole missing-method qualifier is oracle overconstraint unless it creates incorrect policy scope. |
| roberto | Scoped “No encontré una invitación asociada” is not a global denial. If lookup truly returned empty, this is acceptable factual language. Do not force cannot-verify phrasing reserved for failed/unavailable reads. Preserve campaign-vs-lookup discrepancy and no success claim. |

No revised aggregate is offered: these are diagnostic classifications, not rescoring. 5/18 remains the recorded result. Scores alone substantially understate progress but do not clear the real candidate/KB defects.

## P0: replace semantic candidate erasure, not expand special cases

Files: src/runtime/information-orchestrator.ts filterPurchaseCandidates and callers; src/core/information.ts selection evidence; src/runtime/extraction-schemas.ts and prompts/extractors/information.txt only for coherent reference semantics; canonical profile/reply projector tests.

Confirmed source:
- eventHint is matched only against eventName; any nonempty hint is later called hasExplicitSelector.
- amount tests only grandTotal/payment.amount, not item values.
- failed soft match with existing authorized purchases becomes failureKind:not_found and loses candidates.
- special single-pending/current-payment override can select a record despite other unresolved context.

Decision: distinguish authorized retrieval coverage from conversational reference resolution. Backend missing/empty and unresolved model hint are different outcomes. Keep existing authorized candidates and provenance available when soft references do not resolve. Do not expose records outside the established account/phone scope. Stable record IDs and exact customer references can constrain identity; an LLM-generated hint is not a verified ID and must not become authoritative merely because populated.

Remove the pending-order shortcut and the event+amount exception tree when replacing soft filtering; do not add “single candidate => use it” or “search item amount too => select” patches. Give the answering model the relevant authorized candidates with item amounts/quantities and the current request/history so it can resolve natural references or ask a meaningful distinction. Numeric equality is candidate evidence, never unique identity by itself. A verified explicit target stays preserved; if absent, represent the target mismatch without silently selecting a different record. Deterministic validation continues to protect IDs/auth/mutations.

For reads, a single reply can interpret the retained candidates without an extra model pass. For mutations, require validated structured target selection before executing, never infer a write target from answer prose. Correct extractor guidance that confuses item descriptions with event names, but make retrieval robust to imperfect hints rather than depending on perfect extraction.

Tests: route real production service with model extraction stubs that emit eventHint='luna de miel' against a valid honeymoon item under Boda Lucía y Marco; verify record and pending/credit facts reach spec.input. Amount=80 in 230 order remains visible; equal-priced items across two events remain ambiguous. Explicit unknown ID never defaults to sole/pending record. Date and pending shortcuts cannot erase an explicit older target. Change old tests that require erasure, with documented contract revisions.

## P1: evidence budgeting must preserve answer-bearing content

File: src/runtime/openai-agent-runtime.ts projectFaqEvidenceForReply (around 4675), knowledge-retrieval-gateway.ts and existing KB evidence tests.

Current budget is first three excerpts, max 1800 characters split equally, 1200 for one. Three hits reduce top article to 600 characters regardless of where facts occur. This is loss of evidence, not prompt leanness.

Decision: remove equal prefix clipping. Reuse ranked bounded retrieved passages, deduplicate, and budget complete passages using the existing retrieval limits; give the top ranked passage its full bounded content before lower-ranked passages. Do not silently cut mid-passage; expose incomplete coverage if limits exclude content. Preserve multiple relevant passages when budget allows. If a single article chunk exceeds the budget, fix indexing/chunk boundaries at headings/paragraphs instead of adding schedule-specific string searches or a summarizer model pass. Set bounds from measured existing chunk sizes, record before/after bytes, and test the answer late in the top passage with competing irrelevant hits. Do not claim a complete answer if the required source passage was never retrieved.

Freeze the hours fact using the existing fixture mechanism, or add the smallest typed fixture retrieval result path if absent. Keep a separate explicitly labeled integration check for live KB health. Do not make the 18-case behavioral panel nondeterministically depend on production KB contents.

## P1: fix semantic oracles before another run

Existing receipt/gift/campaign YAMLs, purchase evidence adapter, existing expectation schemas.

- Campaign validates authorized purchase evidence with actual resource/source and resulting facts; do not merely widen mustCall to any purchase label, which could hide the original wrong-source bug.
- Payment timing requires correct applicable policy, not explicit recital of a payment-method word every turn. Preserve pending/approved distinction and unknown-paid safety.
- Distinguish current recorded state from claimed new action. A fabricated new effect requires actual semantic assertion of doing it, not a tense blacklist.
- Card physical intent/preparing differs from dispatch/delivery. Gift credit purpose must use documented policy; apply the same rule across campaign and card.
- Missing human-help offer is completeness, actual unrequested handoff is an effect violation. Both can remain failed acceptance, with different severity/classification.
- Scope empty lookup language to the lookup; do not require one fixed failure phrase.
- Thanks safety rejects unsupported facts or commitments, not every courteous hope. No fixed acknowledgement template.

Version changed oracles, record reasons and positive/negative examples offline, retain historical scores. Do not lower global thresholds, run repeated semantic retries or claim validated judge behavior from hand-authored examples.

## P2: complete tool-efficiency proof

Source now removes redundant authenticated exact-order reread where filtered endpoint returns identical shape, uses shared lookup promises and bounded same-turn gift detail. These are sound directions. Report physical backend invocations separately from trace tool labels. Existing code still serializes purchase work behind all nonpurchase work when any associated_event request exists; only genuine dependency should block that read, but do not introduce a generic scheduler for this release.

Known-target receipt case still performs both source reads. Carry established authorized record source/ID through receipt enrichment so that a verified target needs only its relevant refresh; unresolved receipts still need dual discovery. Add deterministic source-count tests and access-scope controls. Do not add a user turn for an ID already available. No global fetch-everything behavior.

## Completion and scope

Implement selectors/coverage and KB evidence fixes before new prompt tweaks. Use existing cases and integration tests. Run typecheck, affected suites, coverage and full offline suite once after integration. Freeze oracle and artifact identities before any new paid invocation. This audit is read-only except this document; no new deploy/test-spend/promotion authorization is inferred. Keep production untouched. Retrieve inaccessible raw input evidence through the existing read-only audit path in the implementing environment before making raw-prompt-specific claims.

## Independent offline validation this audit

Ran tests/information-orchestrator.test.ts, tests/gift-fulfillment-serialized.test.ts and tests/eval-run-manifest.test.ts: 101 passed / 1 failed. Failure: run manifest identity (O0) / keeps dry-run and offline preflight intact without identity, line 302, dry.preflight.passed was false. Root cause is not yet isolated; do not label it a runtime regression or credentials issue without inspecting the preflight reasons. The claimed offline-green state is not reproduced in this environment. Before handoff completion, make this test hermetic with explicit configuration and verify the specific identity exemption independently of unrelated preflight requirements; do not bypass live provenance checks. git diff --check passed.
