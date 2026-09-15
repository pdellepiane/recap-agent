# Step-D matched-request measurement — 2026-09-11 (current candidate, offline)

Status: measurement + projection-narrowing fixes landed offline. No reduction
claim is made: there is no matched baseline, so no baseline-vs-candidate
comparison exists. Static sample bytes are never runtime cost.

## 1. Exact method

- Instrumented boundary: `installOpenAiTransportCapture` on the OpenAI client
  used by `OpenAiAgentRuntime` / `OpenAiMessageResponseClassifier`. Every
  model call in every stage (classifier, extraction, reply, tool-loop
  follow-ups, repair generations, image, knowledge retrieval) is observed
  AFTER installed-SDK serialization: `totalPayloadBytes` is the UTF-8 length
  of the exact request body handed to `fetch`; `instructionBytes`,
  `inputBytes`, `toolBytes` are the UTF-8 JSON lengths of the serialized
  `instructions` / `input` / `tools` fields; `outputSchemaBytes` is the UTF-8
  JSON length of the serialized output-schema (`text.format`); each request
  also stores `requestBodySha256`, stage, sequence, status, and ids.
- Representative offline turns drive the REAL production builders
  (`PromptLoader.loadNodeBundle`, `composeExtractorInput`,
  `composeConversationInput`, `resolveDynamicTools`, `resolveOutputSchema`,
  `Runner.run`) with a stubbed transport fetch returning schema-valid canned
  payloads. Offline stub model is `gpt-test`; the live model is
  `gpt-5.6-luna`, so offline byte totals pin the candidate shape, not live
  cost.
- Failed attempts are retained with null success markers and intact bytes;
  repair calls add their own observations. Absent evidence is null, never
  zero. Completeness reuses the E10 helpers
  (`checkTransportMetricsCompleteness`, `assertCompleteTransportAccounting`);
  no gate, threshold, rubric, or case was changed.
- Stored records are content-free: case IDs, domain IDs, block IDs, byte
  counts, token counts, and hashes only. No instruction text, user message,
  payload, or model output is stored in this artifact.
- Code: `src/audit/matched-request-measurement.ts`
  (`summarizeMatchedStage`, `summarizeMatchedTurn`,
  `aggregateMatchedByDomain`, `attributeEvidenceBlockBytes`).
  Proof: `tests/matched-request-measurement.test.ts` (12 tests).

## 2. Repeated-OTP trace: where the ~14.5KB comes from

The audit's ~14.5KB figure is the `resolver_consultas_informativas` bundle
instructions (now 16,948 bytes after step-C additions; prompt-audit pin
17,356 serialized). The reply evidence for the narrow terminal OTP outcome
is 2,167–2,626 bytes depending on fixture detail. Instructions dominate;
evidence was already narrow.

### 2a. Instruction bundle breakdown (bundle id `802e65774165`)

| File | Bytes | sha256 (16) |
| --- | --- | --- |
| shared/base_system.txt | 989 | 82c1d08aeb1587e5 |
| shared/agent_personality.txt | 1590 | e09b7326903f4173 |
| shared/output_style.txt | 2164 | a410ec4db27e5bff |
| shared/common_anti_patterns.txt | 390 | 0e103077e31bebf5 |
| nodes/resolver_consultas_informativas/system.txt | 4115 | 9137f8f8ad5af9f8 |
| nodes/resolver_consultas_informativas/response_contract.txt | 7791 | 9ee35745ccf81e64 |
| nodes/resolver_consultas_informativas/tool_policy.txt | 257 | 7de3169e3b0cd459 |
| Total instructions | 16948 | — |

`response_contract.txt` (46%) mixes guidance for every outcome
(purchase/cart/image/FAQ/declined/scoped-miss/terminal/capability). On a
terminal OTP turn only the terminal-auth bullets plus the general response
rules are relevant; the purchase/cart/image/FAQ-specific guidance is
irrelevant to the turn yet always included. Narrowing that requires a
per-outcome bundle split, which is new prompt machinery whose behavior
preservation can only be proven by a live baseline-vs-candidate comparison
(see §6). No prompt text was added or removed in this pass.

### 2b. OTP-terminal evidence block attribution (content-free)

Fixture: `resolver_consultas_informativas`, pending purchase + `code_requested`
+ failed verification + `handoff_requested`, `informationResults: []`.

| Block ID | Bytes | sha256 (16) |
| --- | --- | --- |
| nodes | 90 | d581b8204c39f81a |
| history | 48 | 9e93ec5a7e2051a7 |
| user_message | 8 | 26395d85381a5557 |
| decision | 4 | d81a2e36e4fd9e32 |
| extraction | 391 | bf52e3e5a76b078b |
| plan | 538 | f268c68ba741b64d |
| information_results | 2 | 090c6ed842b408b6 |
| capability_outcome | 4 | 188aa58ebe079842 |
| image_evidence | 4 | bb991145a40cbfc9 |
| authentication_outcome | 170 | 64c191ffb3196532 |
| rsvp_phone_evidence | 4 | 0bf4e3e96a05beae |
| rsvp_party | 4 | cf21726fe91acfb6 |
| turn_state | 69 | e08d30890ddae7d2 |
| provider_candidates | 2 | e3e89a6617cf1e1f |
| recommendation_funnel | 4 | a36068108a5c16a7 |

No planning-only fields (`provider_needs`, `vendor_category`, `event_type`),
no `rsvp_state`, and no `close_submission_receipt` reach this turn
(asserted in test). Remaining null blocks are key-only overhead; removing
them would reshape every turn's input and needs live validation (§6).

## 3. Per-domain/per-case wire totals (offline stub model, 1 call each)

| Case (offline shape) | Domain | Calls | Total | Instructions | Input | Tools | Schema | Tokens in/out | Body sha (16) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| otp-terminal | auth | 1 | 20158 | 17180 | 2433 | 2 | 313 | 900/40 | c6543227cdef836d |
| purchase-summary | purchase | 1 | 19285 | 17180 | 1560 | 2 | 313 | 900/40 | 0a1d556ba84aaea9 |
| faq-completed | faq | 1 | 19319 | 17180 | 1594 | 2 | 313 | 900/40 | c88eb9f49c641622 |
| rsvp-read | rsvp | 1 | 11178 | 9139 | 1505 | 2 | 313 | 900/40 | 5c94c569bb585e33 |
| close-continuation | close | 1 | 18269 | 13090 | 4648 | 2 | 313 | 900/40 | 0ac6846693dcb890 |

Notes: wire `instructions` exceed raw bundle bytes by the JSON string
re-encoding envelope (e.g. 17,180 vs 16,948). `tools=2` is the empty-array
encoding on these tool-free nodes. Token counts come from the stubbed usage
payload, proving the token-usage plumbing is captured where available. A
two-stage (extraction + reply) OTP turn and a failure-plus-repair turn are
covered in test with both observations counted.

## 4. Projection-narrowing fixes (this pass, no new instructions)

1. `src/runtime/openai-agent-runtime.ts` `buildReplyTurnEvidence`: omit the
   duplicated top-level `handoff_outcome` block when `authentication_outcome`
   is present (terminal/declined auth turns carry the handoff nested).
   Non-auth handoff paths still emit the top-level block. Saves ~40 bytes on
   auth turns; all other turns byte-identical.
2. `src/runtime/openai-agent-runtime.ts` `composeConversationInput` (new
   `isEstablishedNonPlanningReplyLane` guard): established
   information/RSVP lanes no longer fall back to plan-derived provider focus
   (`getActiveNeed` returns `provider_needs[0]` when no active category, so
   any coincidental planning selection leaked into `turn_state`). Those lanes
   now project `focus_need_category: null`; planning lanes unchanged. Found
   by the new R04 paired test, which failed before the fix. No prompt text
   was added, edited, or removed.

## 5. Validation

- New: `tests/matched-request-measurement.test.ts` 12/12 pass (wire capture,
  failure/repair inclusion, extraction+reply aggregation, 5-domain totals,
  block attribution, handoff dedup, unrelated-state stability for auth and
  RSVP lanes, relevant-change sensitivity).
- Focused: `openai-agent-runtime-token-usage` (51), `prompt-audit`,
  `openai-transport-capture`, `image-sdk-wire`, `agent-service`,
  `agent-service-information-flow`, `l4-owner-routing`,
  `acceptance-contract-mutations`: all pass. `live-behavior-coverage`: pass.
- `npx tsc --noEmit` clean; `npx eslint` on touched files clean.
- Full offline suite: see implementation-log entry for the result.

## 6. Unmatched-baseline limit and what a future comparison needs

- The reference gate `d2141705` is RED and unmatched to this candidate: no
  baseline transport capture exists for these cases, so NO reduction claim
  is made here. The tables above are current-candidate offline pins only.
- A valid future baseline-vs-candidate comparison needs identical
  denominators on both sides: same model and settings, same fixture worlds,
  same requested-case list (failed runs included), repair calls included,
  and transport captured at the same SDK boundary with the same component
  accounting. Compare per-domain/per-case totals, not aggregate medians.
- Candidate future reductions (NOT done here; each needs live proof):
  per-outcome instruction bundles for the informative node; omitting
  always-null evidence blocks; removing the internal `decision` routing
  block and the constant neutral `turn_state` triple from reply inputs.
  Do not truncate the pending question, explicit authorization, unresolved
  alternatives, or candidate identity to meet a byte target.
- E10 consistency kept: transport capture, original-hash verification, and
  completeness helpers untouched; only additive measurement helpers were
  introduced.
