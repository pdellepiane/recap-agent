# Binding acceptance contract and exact edit checklist

Added 2026-09-09 at the user's request. Applies to every package in [the implementation plan](plan.md). This is a proposed implementation/test specification, not a claim that these controls already exist.

**Current testing amendment (30 September 2026):** the user's hard-assertion redesign and targeted-only execution rule supersede mandatory semantic judges, full live-suite execution and preference-based prompt/wording gates in the original checklist. [Testing and validation](../../testing.md) is the current test contract. E01-E11 and effect/output-origin invariants remain applicable; E12 and old judge adversarial tests are historical/research tooling rather than live acceptance requirements. The complete-authorized-profile directive also supersedes any older instruction to omit authorized records merely because a task is unrelated.

Purpose: make superficial compliance and evaluation gaming detectable without replacing conversation with more deterministic dialogue logic. These controls belong primarily in tests and release verification, not an additional runtime supervisor model. No prompt can make an optimizing implementation agent or a semantic judge immune to reward hacking; evidence and independent enforcement must carry the guarantee.

## A. Exact edits and evidence required

Locations are symbol-based because concurrent work moves line numbers. Each change must list the old caller removed and the new production caller exercised; adding an unused helper is incomplete.

| ID | Edit target | Required change | Acceptance evidence |
| --- | --- | --- | --- |
| E01 | `src/runtime/reply-evidence-projector.ts`: `ReplyMode`, `projectReply`, `resolveReplyText` | Remove deterministic mode, `deterministicText`, and fallback-to-template behavior. Project facts/outcomes for model generation; preserve legitimate suppression | `tests/s10-model-projection.test.ts` rejects fixed-text results on every capability/auth/handoff branch |
| E02 | `src/runtime/agent-service.ts`: `enforcePurchaseReplyDeterministic`; `src/runtime/purchase-reply-projector.ts`: `renderPurchaseReplyDeterministic`, `resolvePurchaseReplyText`, prose-producing `render*` exports | Remove their text replacement responsibilities and callers. Retain factual projection, reconciliation, field disclosure and reference matching | Rewrite `tests/f3-purchase-truthfulness.test.ts` and `tests/s09-purchase-reply-projector.test.ts` to assert evidence plus model-output delivery, with original live behavior expectations |
| E03 | `agent-service.ts`: RSVP `deterministicReplyText` construction and merge block; `renderRsvp*Deterministically` | Delete deterministic prose and merging after generation. Feed state/target/receipt into the model before its response | Existing RSVP authorization/durability tests remain; new output-origin assertions cover state reads, selection, successful writes and failed writes |
| E04 | `agent-service.ts`: `enforceFaqAmbiguityReply`, `enforceMissingFieldReply`, `enforceAmbiguousProviderConfirmationReply`, `completeContactConfirmation`, prose branches of `enforceContactRequestFields` | Delete generated-text rewrites. Pass missing fields or unresolved alternatives to model. Preserve schema and contact validation | `tests/f3-ambiguous-confirmation.test.ts`, close tests, and new output-origin tests verify no questions get inserted after generation |
| E05 | `src/runtime/close-submission-summary.ts`: `buildCloseSubmissionSummary`, `applyCloseSubmissionToText`; `agent-service.ts`: `renderOutbound` | Replace sentence generation/insertion with typed receipt projection before generation. Keep explicit date validation and outcome parsing | `tests/f4-close-submission-summary.test.ts` tests receipt data; five-turn close live case checks no early send, exactly one authorized send, correct dated response |
| E06 | `capability-outcome-renderer.ts`, `capability-boundary-renderer.ts`, support/auth/image fixed branches, `prompts/capability/turn_outcomes.txt` and outcome message maps | Retire message dictionaries and sentence-producing defaults. Reuse existing typed outcomes and generate the response | Tests cover success, failed, unknown, unavailable and already-completed separately; missing identity cannot claim help was requested |
| E07 | `src/runtime/message-renderer.ts`, `structured-message.ts`, `agent-service.ts`: `sanitizeAssistantOutput` | Audit each output variant. Remove prose authoring and semantic cleanup. Publish the exact permitted layout transformations; remove unsolicited final-punctuation deletion | `tests/message-renderer.test.ts` checks generated language is preserved and only declared formatting/data placement occurs |
| E08 | `agent-service.ts`: `normalizeInformationExtractionAmbiguity`, other ambiguity-clearing and intent-changing guards | Remove blanket semantic overrides. Invalid or conflicting output produces unresolved evidence; it cannot become a different executable request | Carina raw extraction → normalized state → model input comparison preserves ambiguity until new user evidence resolves it |
| E09 | `openai-agent-runtime.ts`: `extract`, `composeExtractorInput`, `composeConversationInput`; `extraction-projection.ts`, `prompt-manifest.ts` | Single actual request builder selects profile, fields, instructions and tools. No planning fields/priorities on established purchase/support/RSVP calls | Real-request capture tests, not hand-constructed branch samples; domain-invariance tests described below |
| E10 | `openai-agent-runtime.ts`: `buildRequestMetrics`, `extractOpenAiCallRef`; `contracts.ts`; `src/audit/*` | Capture all underlying model requests, not only last response ID. Count schema/tool bytes and retry/tool-loop requests at the outgoing request boundary; retain per-request IDs/hashes | Compare test transport capture with trace totals; a deliberate hidden second call must fail accounting |
| E11 | `src/evals/targets/live-lambda.ts`, `case-schema.ts`, `runner.ts`, `reporting.ts` | Trace raw candidate provenance, wire-delivered output, transformation version and failed generation separately. Missing evidence stays missing; no silent empty-to-pass conversion | `tests/eval-live-target.test.ts`, runner/reporting tests and new `tests/model-output-origin.test.ts` |
| E12 | `src/evals/runner.ts`: `buildSemanticJudgeContext`; `scorers/semantic-judge.ts` | Separate candidate, allowed evidence, prior context, expected behavior and independent effect evidence. No future turns or unobserved fixture facts presented as candidate knowledge | Extend `tests/eval-runner-judge-context.test.ts` and `tests/f4-judge-close-evidence.test.ts`; add counterfactual judge tests |

Existing helpers with mixed responsibilities must be split before deletion. Do not delete currency normalization, auth rejection, effect deduplication, or exact reference resolution just because their file also contains deterministic prose. Track every `deterministic:` return, but also inspect unlabelled return branches and renderers. A name-based search alone is insufficient.

## B. Requirements that cannot be satisfied by a claim or a renamed template

### R01 — Prove output origin by content

For plain text, the delivered text must equal the selected current-turn model output after the declared transport transformation. For structured messages, every conversational span must map to a model-produced field; mechanical data elements map to disclosed source fields. Keep this mapping as a small test/trace structure, not a new dialogue schema.

The test transport independently captures model outputs and the outbound boundary captures delivered content. Do not accept `generatedByModel=true`, non-null token usage, or a response ID as proof. Exercise two different valid sentinel responses through the same state; both must survive to delivery. Bypass, replacement and appended canned questions must fail. For live samples verify stored model output against the returned message, not merely trace metadata. Keep sensitive raw content in private audit storage; publish hashes, classifications and mismatch locations.

### R02 — A model echoing a template is still a violation

Output origin alone is necessary but insufficient. Inspect every model-visible instruction, tool result and evidence block. Reject runtime-authored complete answers, exact-reply fields, sentence dictionaries, “say exactly” directives, and example answers selected by case/state. Renaming `deterministicText` to `verifiedFact`, base64 encoding it, or retrieving it from a local file does not change its status.

Domain facts and actual retrieved knowledge may legitimately be natural language. Require a source and purpose for them; distinguish backend/knowledge evidence from application-authored response copy. Use targeted review and tests for new prompt/input text, not a universal sentence detector that blocks useful language. Do not reward artificial wording diversity: two genuinely generated replies may legitimately be identical.

### R03 — Observe real requests; refuse denominator tricks

Capture instructions, all messages, tools, output schema, and every loop/retry request after SDK serialization. Report total serialized request bytes and component bytes. Moving instructions into tool descriptions, schemas, user messages or tool results must not reduce the reported burden. UTF-8 bytes are not token counts; report both when available.

Compare matched complete scenarios with the same model, settings and fixture world. Report per-domain and per-case results, not only an aggregate median. No cost win from silently suppressing replies, skipping protected tasks, truncating pending questions, dropping turns or excluding expensive failures. Include failed runs and repair calls. Baseline and candidate must have identical requested-case denominators.

### R04 — Minimum disclosure must preserve useful evidence

Use paired context tests: hold the current purchase task fixed while changing unrelated planning/RSVP state. The emitted purchase request must remain byte-identical after declared volatile metadata is removed. Change a relevant purchase amount, ambiguity, entity or receipt: the corresponding projection must change. These tests catch both context leakage and a constant empty projector that “wins” on size.

Sentinel facts in inactive domains must never enter model input or output. Removing a required pending question or authorized fact must fail a preservation assertion. Whitelist only genuinely variable metadata; do not normalize away task content to manufacture equality.

### R05 — Fix the evaluator without grading your own answer

Freeze, before candidate implementation, a manifest of case IDs, inputs, fixture worlds, hard expectations, thresholds, judge configuration, relevant prompt/schema hashes, test code and deployment baseline. Digests expose drift; they are not a security boundary.

A candidate change cannot silently lower thresholds, change hard to soft, remove cases, change selected turns, redact away a disputed phrase, substitute expected output, or rewrite a rubric around its observed answer. Do not silently delete coverage to improve totals. User-authorized retirement records the original scope and reason without claiming equivalent replacement coverage.

If the evaluator is wrong, document the concrete contradiction using independently retrieved evidence. Repair it in a separate reviewed change, then rerun both baseline and candidate against the same revised contract. Preserve both old and revised results. This allows valid fixes such as giving the judge purchase facts actually visible to the candidate, without allowing score-driven rubric changes.

### R06 — Separate three kinds of evidence

The judge packet contains (1) candidate-visible facts, (2) independent backend/state/effect truth, and (3) evaluation expectations. Label them separately. Backend truth can prove that a write happened, but cannot excuse an earlier response inventing a fact it had not observed. A tool name alone is not a receipt. Candidate-produced claim metadata is not independent proof.

Use only conversation history up to the judged turn. Prior answers are conversational context, not authoritative facts. Private redaction must be consistent and preserve meaningful distinctions among synthetic test entities. Missing essential evidence fails packet validation rather than becoming an invented fact or zero effect count.

### R07 — Verify delivered facts and effects with hard assertions

Judge the tested product obligations through independent evidence, not semantic votes. Check authorization, identity and requested effect polarity/count, delivered backend values, failure outcomes, receipts and output origin. A passing tool call is not proof of a successful effect. Check the wire-delivered answer when a fact must be surfaced; an internal draft does not establish delivery.

Retain negative controls that differ by a material violation: wrong entity, pending presented as approved, unauthorized or duplicate mutation, missing receipt, unsupported success, replaced model output. They must fail the expected hard check. Style, paraphrase preferences, internal node transitions, mandatory read-tool calls, token counts and prompt byte budgets are excluded from the mandatory live panel. Prompt/request measurements remain diagnostic evidence.

Semantic-judge tooling retained by the general harness is for historical or separately selected research use. Its score, disagreement or availability cannot grant or deny the current hard-contract gate.

### R08 — Prove the safeguards detect violations

Add a small test-only mutation suite. Deliberately inject each violation and require the expected check to fail: replace final text; append canned question; put full answer into tool evidence; omit output schema from byte accounting; skip a model request from telemetry; clear ambiguity; bypass effect preconditions; duplicate quote submission; score an internal draft; omit grounding from a judge packet; mark a missing receipt as zero; remove a required case.

Acceptance includes the mutant ID, intended failing assertion and observed failure. A green test suite that also accepts these mutants is not sufficient. Mutants are never deployed; use isolated test doubles and fixture executors.

### R09 — Prevent fixture-specific behavior and blanket refusal

Production code must not branch on evaluation case IDs, fixture names, test-only external-user IDs, known customer names, or expected response text. Fixture selection stays confined to the existing development harness/gateway boundary. Audit changes touching those identifiers.

Test novel names, amounts, event dates, candidate ordering, typos and paraphrases while preserving scenario meaning. Add paired successful-action and clarification cases: a system that always refuses, clarifies or escalates must fail the supported-action counterpart. Check unsupported operations and valid operations independently. The response must answer available requested facts and make the appropriate next step; “context retained” alone cannot earn success when a useful answer or action is possible.

### R10 — Independent holdouts and submission discipline

Keep the public regression suite reproducible. Separately reserve full scenario variants prepared by the owner/reviewer, including cross-owner continuations. Keep holdout content outside the implementing agent's writable context when possible. If the same agent can inspect or edit the holdouts and their oracle, describe the check as robustness testing, not independent validation.

The candidate runs through the same production path on fixture-backed development, with fixed model settings. Holdout selection seeds and results are recorded after submission; do not cherry-pick seeds or hide prior submissions. Reserve some new cases for a later confirmation if detailed holdout feedback was used to change the implementation. No claim of secrecy or statistical certainty is made from a seed stored beside the code.

### R11 — Fail closed on missing acceptance evidence

The final report enumerates expected versus executed cases and all hard expectations. Any missing selected case, required receipt, output-origin evidence or required request accounting is incomplete/failed acceptance, never “not applicable” unless that exact exclusion was predeclared for the scenario.

An optimizing implementation agent must not be able to self-certify completion by editing the report. Generate acceptance results from the harness, retain command/run IDs and deployment digest, and have the owner/reviewer verify the final diff and manifest. Where repository permissions/CI protection exist, put the acceptance entrypoint and release checks under separate control. Same-workspace checks provide detection, not tamper-proof enforcement.

## C. Minimal new tests and deployment evidence

Prefer extending the existing tests named in E01–E12. Add only three new focused files if equivalent coverage does not already exist: `tests/model-output-origin.test.ts`, `tests/runtime-context-isolation.test.ts`, and `tests/acceptance-contract-mutations.test.ts`. Keep judge adversarial fixtures in the existing semantic-judge test area. This is not a new testing framework.

Each behavior-changing work package still requires its own coverage registry entry, offline invariant tests, deployment to the verified development account and the explicitly selected frozen live panel with objective hard assertions and a paid-run budget. Contract/test-only changes run their focused checks; they do not trigger an unnecessary Lambda deployment unless runtime, prompts or dependencies also change.

Final submission must include: exact base/candidate/deployment digests; evaluation-contract diff; full expected/executed case lists; all failed and passing runs; before/after real-request metrics; removed-path inventory; output-origin comparisons; mutation results; and explicit holdout independence limits. No score, explanatory prose, or screenshot substitutes for those artifacts.
