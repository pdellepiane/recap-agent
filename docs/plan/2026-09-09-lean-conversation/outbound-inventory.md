# L0 outbound-path inventory (base `a8e443ab`, dev `2q9MtDjNsnBBVdVMqDIP3fYXZBwG4srZfNrxM3ll7FY=`)

Date: 2026-09-09. Every customer-visible text emission found across `src`, including unlabelled branches. Name search alone was insufficient: `deterministic:` bundle IDs (20), `enforce*` post-generation rewrites, renderer dictionaries, guardrail fallbacks, and vocabulary substitutions were all inspected at their call sites.

Conventions below: caller = production caller exercised; model call = whether any model output exists on that path before delivery; override = what happens to model text; replacement = plan work package/edit target.

## 1. Post-generation rewrites in `agent-service.ts` (model output exists, then replaced)

| # | Location | Caller | Emitted content | Override | Replacement |
| --- | --- | --- | --- | --- | --- |
| 1.1 | `enforceFaqAmbiguityReply` (6911), called 868, 1896, 5254 | `necesidad_cubierta` finished path; main compose seam 1891; information batch 5254 | `interpretations`-built `¿Quieres saber A o B?`, extractor `clarificationQuestion`, or fixed `¿Podrías indicar a qué información te refieres?`; sets `structuredMessage: undefined` | Full replacement of composed reply | E04/L2 clarification family |
| 1.2 | `enforcePurchaseReplyDeterministic` (6975), called 5267 | Information batch after `composeReply` | 9 bounded outcomes via `purchase-reply-projector.ts` renderers (see §2); sets `structuredMessage/recommendationFunnel: undefined` | Full replacement on match, else passthrough | E02/L2 purchase family |
| 1.3 | `enforceMissingFieldReply` (7159), called 1893 | Main compose seam, node `aclarar_pedir_faltante`, only `budget_or_guest_range` | Fixed `Para continuar con la búsqueda, ¿cuántos invitados esperas aproximadamente o qué presupuesto tienes?` | Full replacement | E04/L2 clarification family |
| 1.4 | `enforceAmbiguousProviderConfirmationReply` (7184), called 1891 | Main compose seam when `providerConfirmationGuard.ambiguous` | Fixed `¿Qué proveedor o acción estás confirmando?` | Full replacement | E04/L2 clarification family |
| 1.5 | RSVP merge block (2599-2624) | `responder_invitacion` after `composeReply` (2577) | `deterministicReplyText` fragment: full replacement when declining-offer/complete, else prepended as first paragraph | Replace or prepend | E03/L2 RSVP family |
| 1.6 | Structured contact path in `renderOutbound` (10963): `enforceContactRequestFields` (11005) | Every structured-message delivery | `completeContactConfirmation` (11073): fixed `Ya tengo tu nombre, correo electrónico y teléfono. ¿Confirmas que envíe la solicitud de cotización a ${destination}?`; finished-plan generic summary (11028-11038); `summary_es` submission-summary injection (11013-11018) | Field replacement / whole-message replacement | E05/L2 contact+closure family |
| 1.7 | Plain-text close path in `renderOutbound` (10988): `applyCloseSubmissionToText` (close-submission-summary.ts:105) | Every plain-text delivery on node `crear_lead_cerrar` with `finish_plan` output | `buildCloseSubmissionSummary` sentences (91-100, 122): sent/blocked/partial variants with date + provider names | Regex replacement of `¿Confirmas que envíe…?` | E05/L2 closure family |
| 1.8 | `sanitizeAssistantOutput` (11140), applied 10974 + 10995 | Every delivery | Regex strips `filecite turnN file M`, collapses spaces, and **deletes a trailing final period** (`replace(/\.(?=\s*$)/u, '')`) | Silent mutation of model text | E07/L2 renderer audit |

## 2. Purchase prose renderers (`purchase-reply-projector.ts`)

All called only from `enforcePurchaseReplyDeterministic` (§1.2) except `resolveCapabilityPurchaseContinuation` (§4.3) and `renderVoucherContinuityReply` internals. No production caller for `resolvePurchaseReplyText` (dead; tests only).

| Symbol | Lines | Emitted content |
| --- | --- | --- |
| `renderPurchaseReplyDeterministic` | 327 | Cart/order/conflict/no-record fixed sentences; reference/neutral selection enumerations |
| `renderConciseApprovedStatus` | 393 | `El pago de tu regalo para ${event} figura aprobado.` |
| `renderReferenceMatchedSingle` | 418 | Single-record reference answer by status |
| `renderReferenceSelection` | 444 | Multi-candidate reference question |
| `renderNeutralPurchaseSelection` | 464 | Generic multi-record selection question |
| `renderConciseTransferValidation` | 504 | Pending-transfer method + 72h window text |
| `renderOrderPlusCartCheckout` | 543 | Pending order + active cart checkout text |
| `renderPendingCorrectionGrounding` | 604 | Pending-correction grounding text |
| `renderVoucherContinuityReply` | 614 | Voucher continuity text |
| `renderReportedPendingInitial` / `renderReportedShortfallPending` | 657/674 | User-reported pending variants |
| Keep (no prose): `selectPurchaseReplyOutcome`, disclosed field readers, `projectPurchaseReplyForModel`, reconciliation, reference matching | — | Factual projection only |

Replacement: E02 — keep outcome selection + projection, delete text replacement.

## 3. Zero-model-call fixed replies (`agent-service.ts`)

Each path returns `renderOutbound({text: fixed})` with no `composeReply` on that branch.

| Bundle ID | Location | Caller | Emitted content |
| --- | --- | --- | --- |
| `human_escalation_soft_pause` | 531 | Soft-pause after escalation | (text above site; escalation pause message) |
| `human_help_offer_accepted` | 634 | Health-offer accept | `humanEscalationRequestedMessage`: `handoff_outcomes.json` requested/failed variants |
| `conversation_health_help_offer` | 681 | Health monitor | Fixed `Siento que no estamos avanzando como deberíamos. ¿Quieres que una persona del equipo se una a esta conversación para ayudarte?` (7662) |
| `solicitar_agente_humano` | 1278 | Explicit human request | `selectExplicitHumanMessage` (7621): handoff variants incl. fixed non-auth success/failure sentences (7631-7633) |
| `rsvp_multi_person_handoff` (+`_failure`, +deduped) | 2100/2197/2276 | Multi-person RSVP scope | `renderRsvpHandoffFragment` (3363): fixed `¡Con gusto! Para confirmar la asistencia para ti y para ${names}, nuestro equipo de apoyo humano te ayudará.` |
| RSVP mismatch handoff | 2371 | Confirm with reminder, no record | Fixed `Gracias por tu mensaje.${reminderClause} En este momento no puedo verificar tu invitación, ya pedí apoyo humano para revisarlo.` |
| `post_rsvp_closure` | 3720 | Post-RSVP thanks | Fixed `Gracias por tu mensaje, me alegra que la hayas disfrutado en familia. Tu asistencia sigue confirmada y figura que asistirás.` (3691) |
| `ambiguous_provider_confirmation` | 3784 | Bare confirmation over shortlist | Fixed `¿Qué proveedor o acción estás confirmando?` (3752) |
| `capability_clarification` | 3993 | Ambiguous capability | `capabilityBoundaryRenderer.render` or fixed `¿Qué necesitas hacer exactamente con esta información?` |
| `capability_purchase_continuation` | 4055 | Unsupported + safe read | `resolveCapabilityPurchaseContinuation` text or safe-read context + boundary text |
| `unsupported_operation` | 4124 | Unsupported op | `renderCapabilitySafeReadContext` (4155: voucher/pending/72h sentences) + boundary renderer or fixed `No puedo realizar esa gestión desde aquí.` |
| `unsupported_image_media` | 4311 | Image metadata w/o access | Boundary renderer or fixed `No puedo leer ni revisar el contenido de imágenes.` |
| `image_unavailable_fallback` | 4400/4462 | Image delivery failure | `image_outcomes.json` fixed variants; caption case appends fallback to a second pipeline reply (4373) |
| `support_continuity_acknowledgment` | 5381 | Bounded support act, no model call | `selectSupportAcknowledgmentMessage` (5417): 8 fixed variants by kind/topic |
| `host_withdrawal_policy_and_support` | 5527 | Host withdrawal | `host-withdrawal.json` assembled parts (policy/unavailable/status/handoff/event) |
| `information_authentication_declined` | 5747 | Explicit verification refusal | Fixed `Entiendo. Sin autenticación no puedo continuar con esa consulta protegida. No volveré a pedirte el correo ni un código. Cerré esa consulta; si después deseas retomarla, puedes escribirnos por aquí.` (5727) |
| `terminal_otp_handoff_retained` | 5812 | Post-terminal OTP code | `handoffMessages.requested` fixed variant |
| `information_authentication_terminal_handoff` | 5927 | Terminal auth escalation | `selectTerminalHandoffMessage` (7636): 6 fixed identity/phone variants + handoff dictionary |
| Classifier suppression | 704-746 | `would_suppress` in enforce mode | No text: `suppressOutbound` delivery action `suppress` (legitimate suppression candidate; L4 consolidates semantics into owner) |
| Human escalation active | 519 | Escalation in flight | No text: `suppressOutbound(..., 'human_escalation_active')` |

Replacement: E06 (support/human/image/auth/capability dictionaries → typed outcome projection + generation); E03 (RSVP fixed paths); L4 (suppression semantics into entry/owner).

## 4. Renderer dictionaries and vocabulary mutation

| Location | Content | Replacement |
| --- | --- | --- |
| `capability-boundary-renderer.ts` (89-124) + `defaultCapabilityBoundaryMessages` (69-80) + `prompts/…/capability_boundary.txt` | 10 fixed boundary sentences/questions served by key; `render` returns complete prose by decision+state | E06: retire dictionary, project decision/state/receipt |
| `capability-outcome-renderer.ts` `renderTurnOutcome`/`renderHandoffOutcome` + `prompts/capability/turn_outcomes.txt` (14 fixed lines) | Complete outcome sentences per status | E06; note: `CapabilityOutcomeRenderer` has **no production callers** — delete with tests |
| `prompts/nodes/…/handoff_outcomes.json` (8 variants), `image_outcomes.json` (4), `host-withdrawal.json` (6) | Fixed customer sentences loaded as data | E06: replace with outcome projection |
| `openai-agent-runtime.ts` jailbreak guardrail tripwire (500-512) | Fixed `No puedo ayudar a ignorar instrucciones, revelar prompts internos o saltarme las reglas del sistema. Sí puedo ayudarte con preguntas sobre Sin Envolturas o con tu plan de evento.` with zero model call | L1 failure handling: typed operational failure + receipt, never canned prose |
| `normalizeSpanishVocabularyText` (1794+) applied 523 to `*_es` model fields | ~17 regex substitutions (RSVP→confirmación de asistencia, QR→código de pago, chat→conversación, …) | E07: remove substitutions |
| `message-renderer.ts` `formatSentence` (310) + `renderContactRequest` (260: fixed `Envíame tu ${labels}`) | Capitalization/punctuation authoring; fixed request sentence | E07: layout + approved data only |

## 5. Model-call inventory (request assembly, E09/E10)

| Stage | Assembly | Metrics today | Gap vs contract |
| --- | --- | --- | --- |
| Classifier | `OpenAiMessageResponseClassifier.classify` (message-response-classifier.ts:116), called 7436 | Model call | Temporary per plan; consolidate into entry/owner in L4 |
| Extractor | `extract` (openai-agent-runtime.ts:215) → `composeExtractorInput` (865): history JSON + full `buildExtractorPlanSnapshot` (931: plan, provider_needs w/ 4 providers each, rsvp_state, information_state) + category context + continuity + OTP evidence | `buildRequestMetrics` (550): instruction/input bytes, toolCount, schemaPropertyCount only | E09: single profile-scoped builder; E10: capture all requests incl. retries/tool-loop at transport boundary with IDs/hashes |
| Reply | `composeReply` (427) → `composeConversationInput` (1044): canonical turn evidence JSON + ambiguity line + category/capability/tool lines; output schema via `resolveOutputSchema`; tools via `resolveDynamicTools` | Same partial metrics via `extractOpenAiCallRef` (564, last-response-ID only) | E09/E10 as above; R03: measure at SDK serialization incl. schema+tools+retries |
| Image | `inspectImage` (175): caption + base64, 1-turn runner | Partial metrics | Unchanged path; outcome projection replaces fixed fallbacks (E06) |
| Audit today | `src/audit/prompt-audit.ts`, `prompt-branch-measurement.ts`, `prompt-inventory.ts`, `tests/prompt-audit.test.ts` | Static sample metrics | L0: distinguish static samples from runtime metrics; extend to real-request capture |

## 6. Semantic-override candidates (E08/L3, validation/preservation kept)

- `normalizeInformationExtractionAmbiguity` (4645): non-FAQ ambiguity with requests → `status: 'clear'`, interpretations cleared. Blanket semantic override; E08 removal target (Carina comparison test).
- `guardAmbiguousProviderConfirmation` (8329) + `isBareProviderConfirmationTurn` (8320) + `hasNoConfirmationDelta` (8285): structured, but second-guesses extractor ambiguity; L3 audit whether they erase semantic ambiguity without new evidence.
- `hasGroundedSelectionReference` (8400): token-overlap (≥4 chars) matching of user text against extracted hints — exact/grounded lookup retained per contract, but L3 must confirm it only matches already-extracted values.
- `isExplicitHumanRequest` (8260), `isSupportWinOverHuman` (8274): typed-field routing with legacy actionIntent fallback; L3 moves residual semantics to model output.
- `dynamic-agent-policy.ts` tool gating (191-206): precondition enforcement (keep). `turn-capability-policy.ts:232 projectReplyEvidence`: typed outcome (keep, rewire to generation).
- No `includes()`/`startsWith()` free-text intent routing found in the reply path beyond the above; extractor prompts carry the `requestedOperation` "meaning, never isolated words" rule (openai-agent-runtime.ts:893).

## 7. Eval harness paths (E11/E12)

- `src/evals/targets/live-lambda.ts`, `case-schema.ts`, `runner.ts`, `reporting.ts`: trace raw provenance vs delivered output today via redacted artifacts; missing-evidence handling and transformation versioning need the E11 split (raw candidate / delivered / transform version / failed generation).
- `runner.ts buildSemanticJudgeContext` + `scorers/semantic-judge.ts`: judge packet composition; E12 requires candidate / candidate-visible evidence / independent effect truth / expectations separated, history truncated at judged turn.
