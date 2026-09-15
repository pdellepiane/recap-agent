# L0 outbound-path inventory (symbol + hash authority, base `29ed763e`)

Date: 2026-09-09. Rewritten 2026-09-10 (W0-02) from line-number authority to
symbol + content-hash authority at HEAD `29ed763e`, closing the reviewer
blocking finding (stale base `a8e443ab`, 70-120 line drift, missing hash list,
no diff report) and critic F4. Authority is the (symbol, file, content hash)
triple below. Any line numbers quoted in section 8 are reproduced grep evidence
at the pinned HEAD, informational only, never authority.

Method: `rg -n "deterministic" src/runtime` plus symbol greps for
`renderOutbound`, `deterministicReplyText`, `enforcePurchaseReplyDeterministic`,
`renderPurchaseReplyDeterministic`, `resolvePurchaseReplyText`,
`sanitizeAssistantOutput`, `normalizeInformationExtractionAmbiguity`,
`renderRsvp`, `CapabilityOutcomeRenderer`. Every customer-visible text emission
found across `src`, including unlabelled branches. Name search alone was
insufficient: `deterministic:` bundle IDs, `enforce*` post-generation rewrites,
renderer dictionaries, guardrail fallbacks, and vocabulary substitutions were
all inspected at their call sites.

Conventions: old caller = production caller symbol exercised; replacement
status = plan work package / edit target (E01-E12 per acceptance-contract
Section A, L-families per plan.md). E-table verification status is in section 9.

## 0. Basis: content hashes at `29ed763e` (recomputed, all match worktree)

| file | `git hash-object` at `29ed763e` | worktree match |
| --- | --- | --- |
| `src/runtime/agent-service.ts` | `09f9dd3e28c3dd2944e585610b3bf8fec0ab91d0` | YES |
| `src/runtime/openai-agent-runtime.ts` | `4cfdf32324df1afb97f0bcb0ba1ff651790a4530` | YES |
| `src/runtime/purchase-reply-projector.ts` | `c006c9917633239c39d17a203daab78568620fbd` | YES |
| `src/runtime/reply-evidence-projector.ts` | `1151696dc13cb75d7f75df0fcebf1186c9edd81c` | YES |
| `src/runtime/message-renderer.ts` | `6fe28925c4c012d3dfed326560f77bf558c46ae1` | YES |
| `src/runtime/capability-outcome-renderer.ts` | `3dc3064613a193c504660d96b5a9a76d8fb35a6f` | YES |
| `src/runtime/capability-boundary-renderer.ts` | `c4345c47f9ec9be5379ca233f433234afcf1b33b` | YES |

Recompute: `git show 29ed763e:<path> | git hash-object --stdin`.
Full blob list: `git ls-files "src/runtime/*" | while read f; do git show 29ed763e:"$f" | git hash-object --stdin; done`
(no recompute drift; all seven match the values above).

## 1. Post-generation rewrites in `agent-service.ts` (model output exists, then replaced)

| symbol | file | old caller | replacement status |
| --- | --- | --- | --- |
| `enforceFaqAmbiguityReply` | `src/runtime/agent-service.ts` | `necesidad_cubierta` finished path; main compose seam; information batch (`ambiguitySafeReply`) | E04 / L2 clarification family — not started |
| `enforcePurchaseReplyDeterministic` | `src/runtime/agent-service.ts` | information batch after `composeReply` | E02 / L2 purchase family — not started |
| `enforceMissingFieldReply` | `src/runtime/agent-service.ts` | main compose seam, node `aclarar_pedir_faltante`, only `budget_or_guest_range` | E04 / L2 clarification family — not started |
| `enforceAmbiguousProviderConfirmationReply` | `src/runtime/agent-service.ts` | main compose seam when `providerConfirmationGuard.ambiguous` | E04 / L2 clarification family — not started |
| RSVP merge block (`deterministicReplyText`, `deterministicReplyIsComplete`, `deterministicIsDecliningOffer`) | `src/runtime/agent-service.ts` | `responder_invitacion` after `composeReply`; full replacement when declining-offer/complete, else prepended as first paragraph | E03 / L2 RSVP family — not started |
| `enforceContactRequestFields` + `completeContactConfirmation` (structured contact path in `renderOutbound`) | `src/runtime/agent-service.ts` | every structured-message delivery via `renderOutbound` | E05 / L2 contact+closure family — not started |
| `applyCloseSubmissionToText` + `buildCloseSubmissionSummary` (plain-text close path in `renderOutbound`) | `src/runtime/close-submission-summary.ts` + `src/runtime/agent-service.ts` | every plain-text delivery on node `crear_lead_cerrar` with `finish_plan` output | E05 / L2 closure family — not started |
| `sanitizeAssistantOutput` | `src/runtime/agent-service.ts` | every delivery via `renderOutbound` (renderer path + plain-text path); regex strips `filecite turnN file M`, collapses spaces, deletes trailing final period | E07 / L2 renderer audit — partial (still present; layout audit pending) |

## 2. Purchase prose renderers (`purchase-reply-projector.ts`)

All called only from `enforcePurchaseReplyDeterministic` (section 1) except
`resolveCapabilityPurchaseContinuation` (section 3) and
`renderVoucherContinuityReply` internals. No production caller for
`resolvePurchaseReplyText` (dead; tests only). Verified by grep in section 8.

| symbol | file | old caller | replacement status |
| --- | --- | --- | --- |
| `renderPurchaseReplyDeterministic` | `src/runtime/purchase-reply-projector.ts` | `enforcePurchaseReplyDeterministic`; `resolvePurchaseReplyText` | E02 — not started (keep outcome selection + projection, delete text replacement) |
| `renderConciseApprovedStatus` | `src/runtime/purchase-reply-projector.ts` | `renderPurchaseReplyDeterministic` dispatch | E02 — not started |
| `renderReferenceMatchedSingle` | `src/runtime/purchase-reply-projector.ts` | `renderPurchaseReplyDeterministic` dispatch | E02 — not started |
| `renderReferenceSelection` | `src/runtime/purchase-reply-projector.ts` | `renderPurchaseReplyDeterministic` dispatch | E02 — not started |
| `renderNeutralPurchaseSelection` | `src/runtime/purchase-reply-projector.ts` | `renderPurchaseReplyDeterministic` dispatch | E02 — not started |
| `renderConciseTransferValidation` | `src/runtime/purchase-reply-projector.ts` | `renderPurchaseReplyDeterministic` dispatch | E02 — not started |
| `renderOrderPlusCartCheckout` | `src/runtime/purchase-reply-projector.ts` | `renderPurchaseReplyDeterministic` dispatch | E02 — not started |
| `renderPendingCorrectionGrounding` | `src/runtime/purchase-reply-projector.ts` | `renderPurchaseReplyDeterministic` dispatch | E02 — not started |
| `renderVoucherContinuityReply` | `src/runtime/purchase-reply-projector.ts` | `renderPurchaseReplyDeterministic` dispatch + voucher continuity internals | E02 — not started |
| `renderReportedPendingInitial` / `renderReportedShortfallPending` | `src/runtime/purchase-reply-projector.ts` | `renderPurchaseReplyDeterministic` dispatch | E02 — not started |
| `resolvePurchaseReplyText` | `src/runtime/purchase-reply-projector.ts` | none in production (dead; tests only) | E02 — not started (delete with tests) |
| `selectPurchaseReplyOutcome` + disclosed field readers + `projectPurchaseReplyForModel` + reconciliation + reference matching | `src/runtime/purchase-reply-projector.ts` | `enforcePurchaseReplyDeterministic` (factual projection only, no prose) | E02 — keep |

## 3. Zero-model-call fixed replies (`agent-service.ts`)

Each path returns `renderOutbound({text: fixed})` with no `composeReply` on that branch.

| symbol | file | old caller | replacement status |
| --- | --- | --- | --- |
| `human_escalation_soft_pause` bundle | `src/runtime/agent-service.ts` | soft-pause after escalation | E06 — not started |
| `human_help_offer_accepted` bundle (`humanEscalationRequestedMessage`) | `src/runtime/agent-service.ts` | health-offer accept | E06 — not started |
| `conversation_health_help_offer` bundle | `src/runtime/agent-service.ts` | health monitor | E06 — not started |
| `solicitar_agente_humano` bundle (`selectExplicitHumanMessage`) | `src/runtime/agent-service.ts` | explicit human request | E06 — not started |
| `rsvp_multi_person_handoff` bundle + failure/deduped (`renderRsvpHandoffFragment`) | `src/runtime/agent-service.ts` | multi-person RSVP scope | E03 — not started |
| RSVP mismatch handoff (`deterministicReplyText` reminder clause) | `src/runtime/agent-service.ts` | confirm with reminder, no record | E03 — not started |
| `post_rsvp_closure` bundle | `src/runtime/agent-service.ts` | post-RSVP thanks | E03 — not started |
| `ambiguous_provider_confirmation` bundle | `src/runtime/agent-service.ts` | bare confirmation over shortlist | E04 — not started |
| `capability_clarification` bundle (`capabilityBoundaryRenderer.render` or fixed question) | `src/runtime/agent-service.ts` | ambiguous capability | E06 — not started |
| `capability_purchase_continuation` bundle (`resolveCapabilityPurchaseContinuation`) | `src/runtime/agent-service.ts` | unsupported + safe read | E06 — not started |
| `unsupported_operation` bundle (`renderCapabilitySafeReadContext` + boundary renderer) | `src/runtime/agent-service.ts` | unsupported op | E06 — not started |
| `unsupported_image_media` bundle | `src/runtime/agent-service.ts` | image metadata without access | E06 — not started |
| `image_unavailable_fallback` bundle | `src/runtime/agent-service.ts` | image delivery failure (incl. caption-case second-pipeline append) | E06 — not started |
| `support_continuity_acknowledgment` bundle (`selectSupportAcknowledgmentMessage`) | `src/runtime/agent-service.ts` | bounded support act, no model call | E06 — not started |
| `host_withdrawal_policy_and_support` bundle (`host-withdrawal.json` parts) | `src/runtime/agent-service.ts` | host withdrawal | E06 — not started |
| `information_authentication_declined` fixed reply | `src/runtime/agent-service.ts` | explicit verification refusal | E06 — not started |
| `terminal_otp_handoff_retained` bundle (`handoffMessages.requested`) | `src/runtime/agent-service.ts` | post-terminal OTP code | E06 — not started |
| `information_authentication_terminal_handoff` bundle (`selectTerminalHandoffMessage`) | `src/runtime/agent-service.ts` | terminal auth escalation | E06 — not started |
| `contextual_clarification` bundle | `src/runtime/agent-service.ts` | contextual clarification fallback | E04 — not started |
| classifier suppression (`suppressOutbound`, `would_suppress` enforce mode) | `src/runtime/agent-service.ts` | delivery classifier | L4 (suppression semantics into owner) — not started |
| human escalation active (`suppressOutbound human_escalation_active`) | `src/runtime/agent-service.ts` | escalation in flight | L4 — not started |

## 4. Renderer dictionaries and vocabulary mutation

| symbol | file | old caller | replacement status |
| --- | --- | --- | --- |
| `CapabilityBoundaryRenderer.render` + `defaultCapabilityBoundaryMessages` + `prompts/capability/capability_boundary.txt` | `src/runtime/capability-boundary-renderer.ts` | `capability_clarification` / `unsupported_*` branches above | E06 — not started (retire dictionary, project decision/state/receipt) |
| `CapabilityOutcomeRenderer.renderTurnOutcome` / `renderHandoffOutcome` + `prompts/capability/turn_outcomes.txt` | `src/runtime/capability-outcome-renderer.ts` | none in production — no prod callers (verified section 8); delete with tests | E06 — not started |
| `handoff_outcomes.json` / `image_outcomes.json` / `host-withdrawal.json` message maps | `prompts/nodes/...` | human-help / image / host-withdrawal branches above | E06 — not started (replace with outcome projection) |
| jailbreak guardrail tripwire fixed reply | `src/runtime/openai-agent-runtime.ts` | guardrail tripwire, zero model call | L1 failure handling — not started (typed operational failure + receipt, never canned prose) |
| `normalizeSpanishVocabularyText` | `src/runtime/agent-service.ts` | applied to `*_es` model fields (RSVP→confirmación de asistencia, QR→código de pago, chat→conversación, ~17 substitutions) | E07 — partial (still present; remove substitutions) |
| `MessageRenderer.formatSentence` + `MessageRenderer.renderContactRequest` | `src/runtime/message-renderer.ts` | `renderOutbound` structured path (`Envíame tu ${labels}`) | E07 — partial (restrict to layout + approved data) |

## 5. Model-call inventory (request assembly, E09/E10)

| symbol | file | old caller | replacement status |
| --- | --- | --- | --- |
| `OpenAiMessageResponseClassifier.classify` | `src/runtime/message-response-classifier.ts` | delivery classifier | temporary per plan; consolidate into entry/owner in L4 — not started |
| `extract` → `composeExtractorInput` → `buildExtractorPlanSnapshot` | `src/runtime/openai-agent-runtime.ts` | extraction stage (history JSON + plan/provider_needs/rsvp/information_state + continuity + OTP evidence) | E09 — not started (single profile-scoped builder) |
| `composeReply` → `composeConversationInput` → `resolveOutputSchema` / `resolveDynamicTools` | `src/runtime/openai-agent-runtime.ts` | reply stage (turn evidence JSON + ambiguity/capability/tool lines) | E09 — not started |
| `inspectImage` | `src/runtime/openai-agent-runtime.ts` | image path (caption + base64, 1-turn runner) | E06 outcome projection — not started |
| `buildRequestMetrics` + `extractOpenAiCallRef` | `src/runtime/openai-agent-runtime.ts` | all three stages (instruction/input bytes, toolCount, schemaPropertyCount, last-response-ID only) | E10 — partial (capture all requests incl. retries/tool-loop at transport boundary with IDs/hashes) |
| `prompt-audit.ts` + `prompt-branch-measurement.ts` + `prompt-inventory.ts` | `src/audit/*` | static sample metrics (`tests/prompt-audit.test.ts`) | L0 — distinguish static samples from runtime metrics; extend to real-request capture |

## 6. Semantic-override candidates (E08/L3, validation/preservation kept)

| symbol | file | old caller | replacement status |
| --- | --- | --- | --- |
| `normalizeInformationExtractionAmbiguity` | `src/runtime/agent-service.ts` | extraction post-processing (2 apply sites) then reply input | E08 — not started (removal target; Carina comparison test) |
| `guardAmbiguousProviderConfirmation` + `isBareProviderConfirmationTurn` + `hasNoConfirmationDelta` | `src/runtime/agent-service.ts` | main compose seam; second-guesses extractor ambiguity | L3 audit — not started |
| `hasGroundedSelectionReference` | `src/runtime/agent-service.ts` | selection reference match (token-overlap ≥4 chars) | L3 confirm exact/grounded-only — not started |
| `isExplicitHumanRequest` + `isSupportWinOverHuman` | `src/runtime/agent-service.ts` | typed-field routing with legacy actionIntent fallback | L3 move residual semantics to model output — not started |
| `dynamic-agent-policy.ts` tool gating | `src/runtime/dynamic-agent-policy.ts` | precondition enforcement | keep |
| `turn-capability-policy.ts: projectReplyEvidence` | `src/runtime/turn-capability-policy.ts` | typed outcome | keep, rewire to generation |

No `includes()`/`startsWith()` free-text intent routing found in the reply path
beyond the above; extractor prompts carry the `requestedOperation` "meaning,
never isolated words" rule (`openai-agent-runtime.ts: composeExtractorInput`).

## 7. Eval harness paths (E11/E12)

| symbol | file | old caller | replacement status |
| --- | --- | --- | --- |
| `live-lambda.ts` + `case-schema.ts` + `runner.ts` + `reporting.ts` | `src/evals/targets/live-lambda.ts`, `src/evals/*` | trace raw provenance vs delivered output via redacted artifacts | E11 — partial (split raw candidate / delivered / transform version / failed generation) |
| `buildSemanticJudgeContext` + `scorers/semantic-judge.ts` | `src/evals/runner.ts`, `src/evals/scorers/semantic-judge.ts` | judge packet composition | E12 — partial (separate candidate / candidate-visible evidence / independent effect truth / expectations; truncate history at judged turn) |

## 8. Verification evidence (reproduced at `29ed763e`; line numbers informational only)

All commands run at worktree whose seven runtime blobs match section 0
(`git hash-object` verified YES for all).

- `rg -n "deterministic" src/runtime`: 54 matched lines total, 43 in
  `src/runtime/agent-service.ts`, 8 files:
  `agent-service.ts`, `close-submission-summary.ts`, `dynamic-agent-policy.ts`,
  `extraction-schemas.ts`, `model-composition.ts`, `openai-agent-runtime.ts`,
  `purchase-reply-projector.ts`, `reply-evidence-projector.ts`.
- `rg -n "deterministicReplyText" src`: 12 hits, all in `agent-service.ts`
  (declaration + RSVP mismatch assignment + 2 delivery uses + 3
  `renderRsvp*Deterministically` assignments + pending-text assignment +
  mutation-result assignment + null-check + fragment + completeness flag).
- `rg -n "enforcePurchaseReplyDeterministic" src`: definition
  `enforcePurchaseReplyDeterministic` + 1 production caller in the information
  batch after `composeReply` (reproduced at definition `7047` / caller `5273`;
  informational, authority is the symbol pair).
- `rg -n "renderRsvp" src`: 3 deterministic producers
  (`renderRsvpEventSelectionDeterministically`,
  `renderRsvpCurrentStateDeterministically`,
  `renderRsvpMutationResultDeterministically`) + `renderRsvpHandoffFragment` +
  `renderRsvpDurableOutcomeEs` (effect executor, keep).
- `rg -n "renderPurchaseReplyDeterministic" src`: definition at
  `purchase-reply-projector.ts:327` + `resolvePurchaseReplyText` fallback call
  (informational).
- `rg -n "resolvePurchaseReplyText" src`: definition at
  `purchase-reply-projector.ts:364`; no production callers (dead; tests only).
- `rg -n "CapabilityOutcomeRenderer|renderTurnOutcome|renderHandoffOutcome" src`:
  definition in `capability-outcome-renderer.ts` + one audit reference in
  `src/audit/prompt-inventory.ts`; zero production callers — delete with tests.
- `rg -n "sanitizeAssistantOutput" src`: 3 sites, all `agent-service.ts`
  (renderer path `11051`, plain-text path `11084`, definition `11257`;
  informational).
- `rg -n "normalizeInformationExtractionAmbiguity" src`: 3 sites, all
  `agent-service.ts` (2 apply sites `780`/`974`, definition `4651`;
  informational).
- `rg -n "renderOutbound" src/runtime`: 31 call/definition sites (30 in
  `agent-service.ts` callers + 1 `private renderOutbound` definition); all 31
  inspected for unlabelled branches — name search alone was insufficient per
  contract Section A. Includes the zero-model fixed branches (section 3), the
  structured/plain-text close paths (section 1), and the classifier
  suppression sites.
- `rg -n "deterministic:" src`: 20 `deterministic:` bundle IDs exercised in
  `agent-service.ts` (escalation, health, human request, RSVP handoff ×3,
  post-RSVP closure, ambiguous provider confirmation, contextual
  clarification ×2, capability clarification/continuation, unsupported
  operation/image-media, image fallback ×2, host withdrawal, auth declined,
  terminal OTP retained/handoff).

## 9. E-table verification at `29ed763e`

| ID | status | evidence |
| --- | --- | --- |
| E01 | done | `reply-evidence-projector.ts`: `ReplyMode`/`deterministicText`/fallback-to-template removed; `ReplyDisposition = suppressed \\| composed \\| operational_failure`, `projectReply` requires the reply model on complete outcomes. `tests/s10-model-projection.test.ts` asserts `requiresReplyModel`. |
| E02 | not started | `enforcePurchaseReplyDeterministic` + all prose `render*` + `resolvePurchaseReplyText` still present (sections 1-2). |
| E03 | not started | `deterministicReplyText` merge block + 3 `renderRsvp*Deterministically` + handoff/mismatch/closure branches still present (sections 1, 3). |
| E04 | not started | `enforceFaqAmbiguityReply` / `enforceMissingFieldReply` / `enforceAmbiguousProviderConfirmationReply` + `contextual_clarification` still present. |
| E05 | not started | `enforceContactRequestFields` / `completeContactConfirmation` / `buildCloseSubmissionSummary` / `applyCloseSubmissionToText` still present. |
| E06 | not started | Both capability renderers + outcome JSON maps + support/auth/image fixed branches + guardrail tripwire still present. `CapabilityOutcomeRenderer` confirmed callerless but not yet deleted. |
| E07 | partial | `sanitizeAssistantOutput` (incl. trailing-period deletion), `normalizeSpanishVocabularyText` substitutions, `formatSentence`/`renderContactRequest` authoring all still present; only audited, not removed. |
| E08 | not started | `normalizeInformationExtractionAmbiguity` + provider-confirmation guards + token-overlap matcher still present. |
| E09 | not started | Split extractor/reply builders with planning-heavy snapshots still present; no single profile-scoped builder. |
| E10 | partial | `buildRequestMetrics`/`extractOpenAiCallRef` capture instruction/input bytes + last-response-ID only; no retry/tool-loop/per-request ID+hash capture. `spanish_only` baseline failure (`token_usage_present`) confirms the gap. |
| E11 | partial | `live-lambda.ts`/`runner.ts`/`reporting.ts` trace provenance vs delivery but do not split raw candidate / delivered / transform version / failed generation. |
| E12 | partial | Judge packets carry `requestHash`/`rubricDigest`/`evidenceDigest` but do not separate candidate-visible evidence from fixture truth (manifest records delia/s01 disclosure-minimality verdicts as unresolvable until E12). |
| R-requirements | contract frozen | R01-R11 per acceptance-contract.md; R05 manifest frozen at 79/83 with 4 classified failures; no rescore. |

## 10. Inventory diff: `a8e443ab` → `29ed763e` (why the old inventory drifted)

- `git diff --stat a8e443ab..29ed763e -- src/runtime/`: 6 files, +299/−132.
  `agent-service.ts` (+161 lines mostly L1 seam wiring),
  `reply-evidence-projector.ts` (E01: `ReplyMode`→`ReplyDisposition`),
  `openai-agent-runtime.ts` (−82 net), `contracts.ts`, `model-composition.ts`
  (new L1 entry), `prompt-loader.ts`.
- Symbol drift from line-number authority (informational):
  `enforcePurchaseReplyDeterministic` definition `6975`→`7047` (+72);
  `sanitizeAssistantOutput` definition `11140`→`11257` (+117);
  `enforceFaqAmbiguityReply` callers unchanged as symbols (868/1896/5254 → same
  symbols at new lines). Old inventory line numbers are superseded; symbols
  above are the authority.
- Count drift: `deterministic` in `src/runtime` 60→54 lines
  (`agent-service.ts` 44→43) from the E01 removal of `deterministic` mode
  comments/code; `renderOutbound` sites stable at 31; purchase projector
  symbols unchanged (`renderPurchaseReplyDeterministic:327`,
  `resolvePurchaseReplyText:364` both stable).
- `purchase-reply-projector.ts`, `message-renderer.ts`,
  `capability-outcome-renderer.ts`, `capability-boundary-renderer.ts` blobs
  unchanged across the range (hashes in section 0 verify at both ends for the
  four files; L1 did not touch them).

## 11. Wave1-L2 gaps report (what blocks L2 start)

1. L1 deploy+gate pending (manifest placeholder): commits `1305f973`/`29ed763e`
   postdate dev deploy `2q9MtDjNsnBBVdVMqDIP3fYXZBwG4srZfNrxM3ll7FY=`; redeploy
   development (CloudFormation, `se-dev`, `us-east-1`, STS `684516060775`) then
   run the full `npm run eval:behavior-live` before any L2 runtime edit.
2. L2 single-writer lock required on `agent-service.ts` (+
   `purchase-reply-projector.ts` for wave 3): waves 3-8 serialize; this
   inventory makes no runtime edit.
3. L2 order per plan.yaml: purchase + close (waves 3-4) first, then
   support/capability, RSVP, clarification/media/auth (waves 5-7). Each family
   needs its own `live-behavior-coverage.yaml` entry with hard structural +
   hard `text_semantic` (`requireJudge: true`) plus an offline twin.
4. E10/E12 must land before any byte-reduction or disclosure-minimality claim:
   hidden second calls undetectable today; judge packets omit
   candidate-visible purchase facts (delia/s01 stay failures, no rescore).
5. Pre-existing typecheck failure `tests/model-output-origin.test.ts:138`
   (`Type 'undefined' is not assignable to type 'TurnMessageContext'`) is L1
   scope; L2 must not widen it. Lint is green (section 12).

## 12. Quality gates recorded (W0-02)

- `npm run lint`: PASS (`eslint .`, exit 0, 2026-09-10).
- `npm run typecheck` (`tsc --noEmit`): FAIL, pre-existing, single error
  `tests/model-output-origin.test.ts(138,7): error TS2322: Type 'undefined' is
  not assignable to type 'TurnMessageContext'.` Noted as L1 scope per task
  acceptance; no runtime file touched by this inventory task.

## 13. L5 amendment 2026-09-11 (prompt-loader / prompt-inventory reachability)

Scope: L5-owned symbols only. Historical sections 0-12 preserved as-is.
Method: production-caller grep over `src/` (excluding `tests/`), not name
search alone. Base: worktree at `bdb4a88a` plus in-flight L2/L3/L4/URL-image
edits, preserved untouched.

| symbol | old caller (verified current) | replacement status |
| --- | --- | --- |
| `PromptLoader.loadImageMessages` (`prompt-loader.ts`) | none in production or tests (dead) | deleted L5; `image_outcomes.json` retained on disk pending l2-support owner decision, inventory now states `no production loader since L5` |
| `PromptLoader.loadCapabilityBoundaryMessages` (`prompt-loader.ts`) | none in production or tests (dead); `parseCapabilityBoundaryMessages` kept, covered by `tests/capability-boundary.test.ts` | deleted L5; `nodes/.../capability_boundary.txt` retained pending l2-support owner decision, inventory now states `no production loader since L5` |
| `prompt-inventory.ts` branch `capability/turn_outcomes.txt` | file deleted from disk earlier (`prompts/capability/` absent); branch unreachable dead code | deleted L5 |
| `prompt-inventory.ts` branch `nodes/.../handoff_outcomes.json` | file deleted from disk earlier; branch unreachable dead code | deleted L5 |
| `prompt-inventory.ts` loader strings naming `CapabilityBoundaryRenderer` / `CapabilityOutcomeRenderer` (known l2-support handoff leftover) | no such runtime symbols remain (both renderers already gutted to typed contracts) | fixed L5 to name the actual loader/parser state |
| `prompt-inventory.ts` `auth_control.txt` entry (`deterministic_reply`, `no model call`) | actual consumer is `OpenAiAgentRuntime.extract` via `loadAuthControlBundle`, merged into extractor model input | fixed L5 to `extraction` with the real loader chain |
| `extractorPromptFiles` missing `extractors/rsvp.txt` while `extractorPromptFilesForCapabilities({rsvp:true})` emits it | default fallback bundle diverged from the capability union | fixed L5: const now lists all 8 files; production unaffected (production `extract` always passes explicit capabilities, `openai-agent-runtime.ts:445`) |

Not deleted (explicit): `nodes/.../capability_boundary.txt`,
`nodes/.../image_outcomes.json` on-disk files and their tests stay until the
l2-support owner rules; `parseCapabilityBoundaryMessages`,
`claimAllowsSuccess`, `loadImageBundle`, `loadSupportContinuityBundle`,
`loadAuthControlBundle`, `loadHostWithdrawalMessages` all have a live caller
or sole test coverage and stay.

Static metrics (samples, not runtime cost): default extractor fallback bundle
is now 8 files, 16158 instruction bytes / 16483 serialized sample bytes
(+~2437 vs the 7-file fallback; the added bytes are the previously-omitted
`rsvp.txt`, 2411 bytes on disk). No production request changes: every
production and audit caller passes explicit capabilities. No live baseline
exists for a matched comparison, so no runtime byte-reduction claim is made.

Net source delta L5 (vs `bdb4a88a` worktree, own hunks only):
`prompt-loader.ts` -20 lines (dead methods/imports),
`prompt-inventory.ts` -10 net (dead branches out, truthful strings in),
`prompt-manifest.ts` +1, `tests/prompt-audit.test.ts` +3 regression tests.
No prompt files deleted; file count stays 111 with zero unmapped.
