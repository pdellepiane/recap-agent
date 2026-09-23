# Coordinator integration — final work package (offline only) — 2026-09-22

Self-contained integration record for the final work package merge. Coordinator
owned ONLY shared-file integration, atomic commits, `docs/implementation-log.md`,
and the coverage-registry entries below. Offline only: no deployment, no live
evaluation, no promotion, no production change. The future dev-gate and promotion
procedure at the end of this document was NOT executed.

## 1. Commits (oldest first, base `0da5c55f`)

| SHA | Subject | Contents |
|---|---|---|
| `47a624ca` | Project canonical purchase profile with provenance and coverage | Owner A decision 1, 5 files |
| `a26a1eb0` | Trim production prompts and unify extractor continuity | Owner B decision 2 + B6–B12, 23 files |
| `6a3e8a18` | Target gpt-6-luna with fail-closed production model promotion | Owner C decision 4, 9 files |
| `25345946` | Revise ten eval oracles and freeze the 138-row adjudication ledger | Owner C decision 5, 20 files |
| `9e99374f` | Register final work package behavior coverage and log the integration | 9 coverage entries, implementation log, this report |
| HEAD (doc-only) | Record coordinator freeze SHA in integration report | replaces the `<coordinator>` placeholder with `9e99374f`; no code/config/prompt/eval change |

Freeze definition: the frozen candidate is the tree at `9e99374f` plus the
section-4 artifact digest. The HEAD doc-only commit changes only this section
of this report (placeholder → `9e99374f`), so every functional byte — code,
prompts, config, evals, registry, log, measurements — is identical between
`9e99374f` and HEAD, and the artifact digest applies to both.
`git diff 0da5c55f HEAD` touches 57 files
(55 owner + coverage registry + this report; the implementation log entry is
part of the 55).

## 2. Changed files by commit

`47a624ca` (Owner A):
`src/runtime/customer-context.ts`, `src/runtime/purchase-reply-projector.ts`,
`src/runtime/information-orchestrator.ts`,
`tests/owner-a-decision-1-canonical-profile.test.ts` (new, 20 tests),
plus hunk `@@ -4644` (comment-only) of `src/runtime/openai-agent-runtime.ts`.

`a26a1eb0` (Owner B):
`prompts/extractors/base_system.txt`, `prompts/extractors/capability_boundary.txt`,
`prompts/extractors/information.txt`, `prompts/extractors/planning.txt`,
`prompts/extractors/rsvp.txt`,
`prompts/nodes/deteccion_intencion/response_classifier.txt`,
`prompts/nodes/deteccion_intencion/response_classifier_campaign.txt`,
`prompts/nodes/resolver_consultas_informativas/auth_control.txt`,
`prompts/nodes/resolver_consultas_informativas/support_continuity.txt`,
`prompts/shared/reply_core.txt` (new),
`src/runtime/model-request-projector.ts`, `src/runtime/prompt-manifest.ts`,
`src/runtime/turn-capability-policy.ts`, `src/audit/prompt-inventory.ts`,
`tests/owner-b-decision-2-prompt-economy.test.ts` (new, 24 tests),
`tests/agent-service-information-flow.test.ts`, `tests/agent-service.test.ts`,
`tests/matched-request-measurement.test.ts`, `tests/model-output-origin.test.ts`,
`tests/prompt-audit.test.ts`, `tests/prompt-loader.test.ts`,
`tests/runtime-actual-request.test.ts`,
plus 6 Owner B hunks of `src/runtime/openai-agent-runtime.ts`.

`6a3e8a18` (Owner C decision 4):
`src/runtime/openai-model-defaults.ts`, `infra/cloudformation/stack.yaml`,
`scripts/deploy.mjs`, `.env.example`, `scripts/prod-model-promotion.mjs` (new),
`scripts/prod-model-promotion.d.mts` (new),
`tests/owner-c-decision-4-model-deployment.test.ts` (new, 13 tests),
`tests/openai-model-defaults.test.ts`,
plus 2 Owner C hunks of `src/runtime/openai-agent-runtime.ts`.

`25345946` (Owner C decision 5):
`src/evals/runner.ts`, `src/evals/run-manifest.ts`,
`scripts/build-adjudication-ledger.mjs` (new),
`evals/ledgers/eval-2026-09-22T21-54-01-651Z-54da3f5a.json` (new),
10 revised `evals/cases/*.yaml` (list in section 5),
`docs/plan/2026-09-09-lean-conversation/profile-inference-disposition-ledger.json`,
`docs/plan/2026-09-09-lean-conversation/final-promotion-prompt-pass-2026-09-22.md`,
`tests/owner-c-decision-5-eval-contracts.test.ts` (new, 9 tests),
`tests/b-fixture-oracles.test.ts`, `tests/f3-oracle-revision-mutations.test.ts`,
`docs/implementation-log.md` (Owner C entry).

Coordinator commit: `evals/live-behavior-coverage.yaml` (9 entries),
`docs/implementation-log.md` (coordinator entry), this report.

Shared-file integration: `src/runtime/openai-agent-runtime.ts` carried 9 hunks
with zero conflict markers; they route 1/6/2 to A/B/C with no overlapping
regions and no behavior dropped. Deliberately behavior-neutral by inspection:
A4 ledger helpers are additive and unwired (no production caller);
B11 `operationDomain` is a parity refactor (24/24 operations map identically);
B12 cache layout keeps stable customer-free keys; C1 oracles touch no runtime.

Explicitly NOT committed (out of scope, left in the working tree): the
`.gitignore` deepwork hunk, `.ignore`, and untracked diagnostics/draft docs
under `docs/diagnostics/` and `docs/plan/2026-09-09-lean-conversation/`.

## 3. Test counts (all observed in this session, offline)

Full suite at integrated HEAD: **205 files, 2,375 passed, 5 historical skipped,
0 failed** (`npm test`, ~30 s). Baseline before the package was 201/2,309; the
+66 delta is exactly the 4 new owner suites (20 + 24 + 13 + 9).

Focused sets (integrated tree):
- Registry + owners: `live-behavior-coverage` 1, owner-a 20, owner-b 24,
  owner-c-decision-4 13, owner-c-decision-5 9 → 67/67.
- Serialized production-request + contracts: matched-request-measurement,
  runtime-actual-request 59, model-output-origin 34, agent-service-information-flow
  93 (+2 skip), prompt-audit 12 (+1 skip), prompt-loader 17, openai-model-defaults 3,
  b-fixture-oracles 8, f3-oracle-revision-mutations, profile-inference-e1 7,
  eval-run-manifest 20, message-response-classifier 22, s01-frozen-regression 6,
  agent-service 96 → 14 files, 414 passed / 3 skipped.
- Effect/read-back: l4-customer-context, l4-customer-context-service,
  information-orchestrator, rsvp-mutation-authorization, event-identity-rsvp
  → 5 files, 180/180.
- `npx tsc --noEmit` clean; `npx eslint` clean on all 27 touched
  source/test/script files.

Per-commit worktree checks (detached worktrees + symlinked `node_modules`):
- `47a624ca`: typecheck clean; 8 files / 227 tests green.
- `a26a1eb0`: typecheck clean; 9 files / 364 passed / 3 skipped green.
- `6a3e8a18`: typecheck clean; 102/103 green with exactly 1 known red —
  `owner-c-decision-4 … records candidate and judge identities separately`
  expects the run-manifest judge separation whose hunks were grouped into the
  later C-eval commit `25345946`, where it passes. History was kept immutable,
  so this grouping artifact stands; per-commit consumers should validate at HEAD,
  which is fully green.

## 4. Frozen candidate (ONE source/config/artifact)

- Source: coordinator commit SHA on `main` (see log entry of the same date;
  owner commits `47a624ca`, `a26a1eb0`, `6a3e8a18`, `25345946`).
- Config: application `gpt-6-luna` on all three roles
  (`infra/cloudformation/stack.yaml`, `scripts/deploy.mjs` development defaults,
  `.env.example`); evaluator judge pinned `gpt-5.6-luna`
  (`src/runtime/openai-model-defaults.ts`, `src/evals/runner.ts` ×4 sites,
  `src/evals/run-manifest.ts`).
- Artifact: `npm run build` output (`dist/`: esbuild bundles + `prompts/` +
  eval fixtures) zipped exactly as `scripts/deploy.mjs:zipArtifact` does:
  SHA-256 `971acea6b9e67e50b61950732caa569bf09dcfb89a497631781b8586d5a88482`,
  7,429,048 bytes, kept at `/tmp/recap-agent-frozen.zip` for re-verification.
  Lambda bundle `dist/lambda/index.js` SHA-256
  `e9daea52bfc99bd65b16c74408b88c1c9abb3ea42ff9c19b34e863b7439f3ff5`.
  Zip bytes embed file timestamps, so the canonical freeze is this digest
  PLUS the git SHA; a rebuild reproduces equivalent bytes, not the hash.
- Ledger: `evals/ledgers/eval-2026-09-22T21-54-01-651Z-54da3f5a.json`,
  SHA-256 `70ec8103d17a34076ac6f8766ea840d9cbae455710e54127d6f5ba9e41383f0d`.

## 5. 138-row ledger reference

Source run `eval-2026-09-22T21-54-01-651Z-54da3f5a` (frozen, immutable,
`referenceStatus: red`): 138/138 cases, **77 pass / 61 fail / 0 error / 0 skip**.
The ledger copies scores/statuses/gates without rescoring (proven by
`tests/owner-c-decision-5-eval-contracts.test.ts`): 87 failed expectations —
33 `product-fact-effect`, 38 `product-helpfulness`, 14 `oracle-fixture`,
2 `planning-accepted` (`ambiguous_confirmation_clarifies`, `spanish_only`;
zero effects, grounded facts; waiver needs an explicit later release decision).
74 ledger links keep their contract; 13 link to the 10 revised YAMLs:

| Case | Version | Contract change |
|---|---|---|
| `gift_mixed_order_distinguishes_items` | v3→v4 | drop shipping-only `paymentStatus` demand |
| `purchase_current_pending_over_old_approved` | v2→v3 | tool-label pin → authorized evidence/coverage |
| `purchase_delia_status_by_phone` | v4→v5 | tool-label pin → authorized evidence/coverage |
| `purchase_martha_accountless_selection` | v4→v5 | tool-label pin → authorized evidence/coverage |
| `purchase_kiara_pending_by_phone` | v2→v3 | tool-label pin → authorized evidence/coverage |
| `s08_kiara_approved_replay` | v5→v6 | tool-label pin → authorized evidence/coverage |
| `s01_frozen_kiara_pending_replay` | v3→v4 | tool-label pin → authorized evidence/coverage |
| `phone_purchase_missing_hands_off_once` | v1→v2 | offer-first: no unrequested handoff write/effect |
| `image_distractor_history_preserves_current_question` | v2→v3 | T0 silence pin → bounded-reconciliation judge |
| `image_readable_captionless` | v5→v6 | T1 amount question drops transcription demand |

Notable keeps (no waiver): T0 227.76 full-due false balance (release blocker),
plus-one saved-receipt hedging, `image_url_context` pin, carina
operation-selection failures, invented provider/FAQ amounts. Suite remains 138
cases; every revised case keeps hard structural plus hard requireJudge semantic
expectations; frozen worlds unchanged.

## 6. Prompt-size table (paired before→after, bytes, UTF-8)

Method: one offline probe (`/tmp/probe.mts`, stub transport, `gpt-test`)
executed against a detached worktree of base `0da5c55f` and against the
integrated tree. Wire figures are post-installed-SDK-serialization request
bodies. Static files are `prompts/` on disk. No live model was called.

Static prompt files:

| File | Before | After | Delta |
|---|---:|---:|---:|
| `nodes/deteccion_intencion/response_classifier.txt` | 9,175 | 4,844 | −4,331 |
| `nodes/deteccion_intencion/response_classifier_campaign.txt` | 2,282 | 1,470 | −812 |
| `extractors/information.txt` | 5,095 | 3,901 | −1,194 |
| `extractors/planning.txt` | 3,234 | 2,322 | −912 |
| `extractors/rsvp.txt` | 2,851 | 2,139 | −712 |
| `extractors/base_system.txt` | 2,298 | 2,223 | −75 |
| `extractors/capability_boundary.txt` | 780 | 643 | −137 |
| `nodes/resolver_consultas_informativas/auth_control.txt` | 486 | 439 | −47 |
| `nodes/resolver_consultas_informativas/support_continuity.txt` | 666 | 1,043 | +377 (decision-2 prose) |
| `shared/reply_core.txt` | — (absent) | 1,347 (new, production core) | +1,347 |
| `shared/{base_system,agent_personality,output_style,common_anti_patterns}.txt` | 1,111 / 1,445 / 1,951 / 390 | unchanged on disk | production no longer loads them |

Per-stage instruction / schema / dynamic-input bytes (before → after):

| Stage / turn | Instruction | Output schema | Dynamic input | Wire total |
|---|---:|---:|---:|---:|
| Classifier general (`hola`) | 9,227 → 4,896 | 1,592 → 1,592 | user 619 → 619 | 11,837 → 7,492 |
| Classifier campaign (bundle) | 2,343 → 1,531 | 1,592 (same schema family) | per-message | — |
| Extractor fresh (`busco local para boda`) | 14,954 → 11,877 | 11,022 → 11,022 | wire 1,355 → 1,218 (spec 1,249 → 1,115) | 27,688 → 24,460 |
| Extractor established support (`Gracias`) | 12,347 → 10,182 | same family | spec 1,471 → 1,288 | — |
| Extractor first turn (`Hola`) | — | — | spec 1,226 → 1,092 (identical facts) | — |
| Extractor card follow-up (names-only) | — | — | spec 1,257 → 1,513 (+256, new facts below) | — |
| Reply first support (venue record) | 5,019 → 1,371 | 313 → 313 | spec 2,733 → 2,733 (wire 3,063) | 8,776 → 5,001 |
| Reply purchase profile (2 records) | 6,696 → 3,048 | 313 (same family) | spec 6,371 → 7,311 (+940 facts below) | — |
| Reply continued (pending question) | 5,750 → 2,479 | 313 (same family) | spec 1,541 → 1,541 | — |
| Reply OTP-terminal matched turn (existing pin) | measured 5,595 (pins 5,000–6,100; was 9,647) | >0 pinned | pins 2,000–6,000; tools ≤4 | — |

Schemas are byte-identical before/after on every captured stage: no schema file
changed in this package. Instruction deltas come from prompt subtraction and the
four-file→one-file reply-core swap with identical module sets
(e.g. purchase-profile modules unchanged:
`shared_invariants + reply_purchase_facts + reply_approval_boundary + reply_gift_fulfillment`).
Input growth is new facts, not duplication (next section).

## 7. Repeated-fact count, available tools, physical backend calls

Repeated facts (occurrences in one serialized input, before → after):
- Card follow-up, pending-question string `¿Para qué evento es la compra?`:
  4 → 5. Homes after: actual delivered history message (1), plan snapshot
  `owner_pending_question` (1), plan snapshot pending-request query (1), typed
  continuity `pending_question` (1), typed continuity `unresolved.query` (1).
  The +1 is the new unresolved-task pointer (new typed signal, previously only
  in the plan snapshot); the recovered `last_completed` card issue
  (`tarjeta rechazada`) is likewise new. Typed keys each occur exactly once
  (`pending_question`, `prior_answer_gist`, `unresolved`, `last_completed`);
  user message ×1, `Roger Abanto` ×1, both states. Section count 3 → 1:
  `history_status`, `prior_answer_gist`, `pending_question_ref` standalone
  sections are gone; one `conversation_continuity` object carries history
  state, gist, pending question/task, unresolved pointer, and last-completed
  topic, and a true first turn emits nothing.
- Purchase profile, order id `ORD-OLDER-2021`: ×4 both states (summary,
  candidate index, detail record, outcome reference — stable homes).
  Item fact `Juego de sábanas`: ×1 both states (detail body only; summaries
  and candidate index carry no item text). `profile_ref: customer_context`
  collapse retained both states; `source_coverage` now rides profile and
  reference (+940 input bytes).

Available tools (scoped per node, before → after identical):
- Support replies (venue / purchase-profile turns): `[]` both states.
- `entrevista` reply: `[list_categories, get_category_by_slug, list_locations]`
  both states, with the authorized-tools line present.
- Tool-less handoff turn: `[]` both states; the `Herramientas autorizadas…
  ninguna` narration line is present before, absent after (B10).
- Extractor and classifier expose no callable tools (`toolCount: 0`;
  extractor wire `tools` field 2 bytes both states).

Physical backend calls and model calls (before → after identical):
- Purchase discovery over two sources: 1 `orders` + 1 `gift` call both states.
- Model calls per turn: 1 classifier + 1 extractor + 1 reply = 3, unchanged.
- No new backend read, write, or model pass was added by any owner.

Cache note (no improvement claimed): prompt bundle ids rotate once because the
prompt files changed (e.g. venue-reply `56dc7ab3bc11` → `8f7b66003718`,
classifier general `1d793c70e818` → `3dadfbdaa726`), then stay stable across
repeated builds and contain no customer bytes (proven by
`tests/owner-b-decision-2-prompt-economy.test.ts` B12). Cached-input-token
deltas require live measurement and are explicitly NOT claimed here; the first
live calls after deploy pay a cold prompt cache.

## 8. Three model settings and reasoning proof (all `gpt-6-luna`)

| Stage | Model source | Settings on `gpt-6-luna` | Proof |
|---|---|---|---|
| Reply | `config.openAi.models.reply` → `OpenAiAgentRuntime` (`src/lambda/handler.ts:651`) | implicit cache 30 m, `reasoning.effort: low`, `text.verbosity: low`, `store: true` | `buildModelSettings` + `supportsLowReasoningEffort` (`src/runtime/openai-agent-runtime.ts`); `owner-c-decision-4 … keeps low reasoning and low verbosity for gpt-6-luna extractor and reply settings` |
| Extractor | `config.openAi.models.extractor` → `OpenAiAgentRuntime` (`src/lambda/handler.ts:652`) | same low/low settings via the same family check | same code path; same test; unknown families keep base settings without silent inheritance (`… preserves low reasoning for the gpt-5 family without touching unknown families`) |
| Response classifier | `config.openAi.models.responseClassifier` → `OpenAiMessageResponseClassifier` (`src/lambda/handler.ts:666`) | `reasoning.effort: low`, `text.verbosity: low`, `store: true`, implicit cache, `prompt_cache_key: classifier:{bundle.id}`, `toolCount: 0` | `src/runtime/message-response-classifier.ts:183-199`; `owner-c-decision-4 … sends low reasoning for the gpt-6-luna classifier call` (stub-wire asserts model + effort + verbosity) |

Defaults: `DEFAULT_GPT_TEXT_MODEL = 'gpt-6-luna'` in
`src/runtime/openai-model-defaults.ts`, mirrored by the three CloudFormation
parameter defaults, the three development deploy defaults, and `.env.example`.
Evaluator separation: `DEFAULT_EVAL_JUDGE_MODEL = 'gpt-5.6-luna'`, used by
`src/evals/runner.ts` (4 sites) and `src/evals/run-manifest.ts`, so the first
migration comparison keeps candidate and judge identities distinct.
Historical identities untouched (`S01_FROZEN_BASELINE`, `evals/baseline/…`,
`evals/baselines/*`, frozen fixtures still pin `gpt-5.6-luna`).
Account-specific `gpt-6-luna` access is UNVERIFIED (no provider call was made).

## 9. Coverage registry entries (9, all in `live_behavior_regression`)

| Behavior-change id | Implemented by | Live cases |
|---|---|---|
| `canonical-purchase-profile-provenance-source-coverage` | `47a624ca` | gift_mixed_order, receipt_explicit_older_target, purchase_current_pending |
| `classifier-prompt-economy-general-campaign` | `a26a1eb0` | rsvp_missing_action, spanish_only |
| `extractor-prompt-economy-established-support` | `a26a1eb0` | gift_mixed_order, support_detail_continuity |
| `extractor-single-continuity-object` | `a26a1eb0` | support_detail_continuity, concurrent_support_turns |
| `support-continuity-first-report-vs-followup` | `a26a1eb0` | support_detail_continuity, support_pending_question_completed |
| `support-continuity-unresolved-issue-handoff-prose` | `a26a1eb0` | support_detail_continuity, concurrent_support_turns |
| `reply-core-single-file` | `a26a1eb0` | support_detail_continuity, customer_event_task_continuity |
| `reply-tool-narration-omitted-without-tools` | `a26a1eb0` | support_detail_continuity, phone_purchase_missing |
| `application-model-gpt-6-luna-migration` | `6a3e8a18` | gift_mixed_order, support_detail_continuity |

(Case ids abbreviated; full `live_behavior.*` ids are in the YAML.)
Every referenced case is a mandatory-suite `live_lambda` case with a hard
structural expectation and a hard `requireJudge` semantic expectation —
verified offline by `tests/live-behavior-coverage.test.ts`. No entry was added
for behavior-neutral work (A4 unwired helpers, B11 parity refactor, B12 cache
stability, C1 oracle revisions, C5 promotion plumbing), and no older entry was
reused for a later change.

## 10. Unrun release gate (recorded honestly)

NOT run in this session, by explicit offline-only instruction:
development Lambda deploy, `npm run eval:behavior-live` on the 138-case
mandatory suite, any live rerun or rescore of frozen run
`eval-2026-09-22T21-54-01-651Z-54da3f5a`, the `gpt-6-luna` account-access check,
and production promotion. Production (`recap-agent-runtime`) is untouched;
no production credential, parameter, or artifact was read or written beyond the
existing local files.

## 11. Unresolved risks

1. All 9 behavior changes are live-unverified: prompt subtractions and the
   model move can only be graded by the live gate (wording, omissions,
   judge deltas).
2. The T0 227.76 full-due false balance is an open release blocker: offline
   pins prove unknown-remaining projection, but the live fail-to-pass proof
   (reply must not state the full amount as due) has not run.
3. `gpt-6-luna` availability on this account is unverified; the dev deploy +
   smoke + gate may fail closed on model access.
4. Card follow-up input grew +256 bytes and the pending-question string now
   appears 5×; accepted as typed signal, but live extraction impact is
   unmeasured.
5. Kept ledger pins have no waiver: plus-one saved-receipt hedging,
   `image_url_context`, carina operation selection, invented amounts.
6. First live calls after deploy pay a cold prompt cache (bundle ids rotated).
7. Intermediate SHA `6a3e8a18` carries 1 known red test (section 3 grouping
   artifact); validate per-commit consumers at HEAD.
8. Two probe side notes: the classifier falls back to `respond` with
   `classifier_unavailable` when its model call fails (fail-closed toward
   answering); the OTP-terminal matched turn keeps its prior transport pins
   shape with the new 5,595-byte instruction measurement.
9. Stray local state (`.gitignore` deepwork hunk, `.ignore`, untracked
   diagnostics/drafts) remains uncommitted as out of scope.

## 12. FUTURE dev-gate and promotion procedure (exact; DO NOT EXECUTE without a new explicit instruction)

This section is a procedure only. It was not executed in this session.
Production is untouched. All AWS commands use profile `se-dev` in `us-east-1`
only; refresh login with `aws login --profile se-signin` if SSO expired.
Mutating scripts fail closed unless STS confirms account `684516060775`.

Prerequisites:
1. `git status` shows the coordinator commit as HEAD with no tracked
   modifications (the stray `.gitignore` hunk must be resolved first: revert it
   or commit it explicitly — never ship it silently).
2. `npx tsc --noEmit`, `npx eslint .`, and `npm test` are green at HEAD.
3. The frozen artifact digest in section 4 matches a fresh
   `npm run build` + zip only in content; the zip hash itself is
   timestamp-sensitive, so the deploy step below re-hashes the fresh bytes and
   the run manifest records the new digest (do NOT expect `971acea6…` to
   reproduce bit-for-bit).
4. A judge API key is available in the environment (a missing judge key fails
   the gate; skipped/errored cases fail the gate).

Step A — identity preflight (read-only):
`AWS_PROFILE=se-dev AWS_REGION=us-east-1 aws sts get-caller-identity`
must return account `684516060775`. Record dev `recap-agent-runtime-dev` and
prod `recap-agent-runtime` CodeSha256 values BEFORE any mutation
(`aws lambda get-function-configuration`).

Step B — deploy EXACT HEAD bytes to development only:
`AWS_PROFILE=se-dev AWS_REGION=us-east-1 DEPLOYMENT_ENV=development npm run deploy`
(exit 0; stack `recap-agent-runtime-dev` `UPDATE_COMPLETE`). Record the printed
`Artifact SHA-256`, S3 key `s3://recap-agent-artifacts-684516060775-us-east-1/lambda/<sha>.zip`,
and the AFTER CodeSha256. Verify the function URL answers HTTP 401
unauthenticated (alive). Confirm the three deployed model parameters equal
`gpt-6-luna` (stack parameters + live Lambda environment).

Step C — smoke (fail fast before the paid gate): one classifier call, one
extraction, one support reply against dev (any cheap path, e.g. the terminal
client or a single live case). Abort on model-access errors
(`gpt-6-luna` unverified until this step).

Step D — full mandatory live gate (one bounded invocation):
`EVAL_COORDINATOR_HOST=<this-host> AWS_PROFILE=se-dev AWS_REGION=us-east-1 npm run eval:behavior-live -- --label candidate`
(defaults: case-concurrency 4, judge-concurrency 2; single-host external-lane
lock is mandatory). Requirements: 138/138 selected, non-zero turns every case,
0 skipped, 0 errored. A missing judge key, skipped case, evaluator error, or
failed hard expectation is a failed gate per AGENTS.md.

Step E — adjudicate from stored artifacts (no rescoring):
compare the new report against the frozen ledger
(`evals/ledgers/eval-2026-09-22T21-54-01-651Z-54da3f5a.json`) and the 10 revised
contracts (section 5). Product blockers requiring repair before production
(wrong-entity disclosure or mutation, duplicate effect, fabricated successful
write/approval, blank or undelivered support reply, the 227.76 full-due
balance) fail the release even if the aggregate moves. Wording/completeness/
planning-quality failures within the ledger's kept classifications may be
carried explicitly, never silently; the 2 `planning-accepted` rows still need
their explicit waiver decision. Record the run id and artifact in the
implementation log.

Step F — production promotion (only after the gate passes and a human
authorizes the release): promote the EXACT dev artifact bytes plus the three
dev-parity model params. The C5 path enforces this; run from a shell whose
`OPENAI_MODEL`, `OPENAI_EXTRACTOR_MODEL`, and
`OPENAI_RESPONSE_CLASSIFIER_MODEL` each exactly equal the corresponding
`recap-agent-runtime-dev` stack parameter (currently `gpt-6-luna` ×3):
`AWS_PROFILE=se-dev AWS_REGION=us-east-1 DEPLOYMENT_ENV=production DEPLOY_ARTIFACT_PATH=<dev-zip> DEPLOY_ARTIFACT_SHA256=<dev-sha> npm run deploy`.
The script aborts on any missing model value, any dev/prod model mismatch, or
any post-deploy mismatch of CloudFormation params, live Lambda env, CodeS3Key,
or CodeSha256. Record the printed rollback identities (previous prod models +
S3 key), the new CodeSha256, and the verified models. Keep the previous prod
artifact available for rollback.

Rollback: redeploy production with the recorded previous S3 key and previous
model values through the same Step F command shape; verify the same four
post-deploy checks.

