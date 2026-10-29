# Catalog freshness and enforcement audit — 2026-10-23

Scope: read-only audit of prompt inventory, loaders, compiler manifests, schemas, and existing audit tests. No runtime edits, AWS operations, model calls or paid evaluations. Catalog counts describe the current working tree and were computed through `buildPromptInventory`.

## Why existing checks permit drift

1. `src/audit/prompt-audit.ts:auditPromptBundles` traverses `loadNodeBundle` and `loadExtractorBundle`. Production extraction/reply uses `buildExtractionRequestSpec` / `buildReplyRequestSpec`, typed module selection and `loadModuleFilesBundle`. A legacy bundle can pass while the real composition is contradictory or irrelevant.
2. Existing checks establish file ownership, exact paragraph duplicates, allowlists, deterministic bytes and selected fixture composition. They do not establish that prompt field references still exist in the active schema or that two rules assign conflicting responsibility.
3. `src/audit/prompt-inventory.ts` labels every `router/` file a live router consumer without intersecting the actual router loader paths. A future stale router file can therefore look mapped.
4. Shared registry consumers are always reported as `callType: reply`, even when their registry module is extraction-only. The shared customer-context semantics file consequently has misleading stage metadata in inventory.
5. The inventory contains a fallback that manufactures a filesystem consumer for an unwired `transition_policy.txt`, setting `isOrphaned=false`. No such files currently exist, but adding one could evade the zero-unmapped check.
6. Current inventory: **130 files, zero unmapped, 86 files whose only consumer descriptions contain `retired`**. Those are explicitly audit-only/retired surfaces, not proof of live relevance. Inventory must distinguish production, explicit nonproduction audit fixture, and orphan status. Audit-only prose should not be maintained as a second canonical runtime policy.
7. `openai-agent-runtime.ts:otpContinuationEvidence` still contains Spanish instruction prose directly in source. Its content is not covered by a prompt-directory-only digest or catalog audit, despite controlling extraction behavior. Instruction-bearing strings must be inventoried or moved to the required tracked prompt files before a catalog-wide completeness claim.

## Smallest sustainable mechanism

Extend the existing compiler rather than create a second prompt router.

### A. Dependency-aware review freshness lock

Add a git-tracked review manifest containing the exact catalog path set, SHA256 per file and dependency fingerprints for schema definitions, tool surfaces, module registry/selection code, and input projection code. A deterministic offline check fails when:

- a prompt is added/deleted/changed without updated review metadata;
- a schema/tool/compiler dependency changes without invalidating affected reviews;
- an active prompt references a nonexistent declared schema/input/tool binding;
- an unrecognized or unwired file is silently classified as production.

Reviews need explicit status (`approved`, `reviewed_with_open_findings`, `unreviewed`) and finding IDs. Hash freshness is not semantic approval. Generating a digest lock for the present known conflicts must not mark the current runtime release-ready. Keep blocking findings visible and define a distinct freshness check versus acceptance check.

For a first small implementation, hash the whole small set of dependency source files rather than attempt brittle AST impact inference. Any dependency change invalidates the review package. Narrow invalidation later only when the actual contract graph supports it.

### B. Typed rule contracts beside existing module metadata

Each module declares its stage/owner applicability, schema/input paths it consumes or emits, stable invariant IDs it owns, and incompatible invariant IDs/modules. Validate declared field paths against the actual Zod output schema or exported typed input descriptors, not a separately maintained list of guessed field names. Validate router option values against the existing constant enums (the current router loader already does this).

An invariant must have one owner for a given decision responsibility. For example, extraction captures requested operations; policy validates execution. Reply describes actual receipts. The gate can detect conflicting ownership declarations; humans must still review whether prose matches those declarations.

Do not regex every backticked token as a schema path: prompts legitimately include enums, examples, nested evidence and user references. Require explicit bindings and use targeted banned-retired-symbol checks as a supplemental diagnostic, not as semantic proof.

### C. Actual serialized-request matrix

Use existing request builders offline to generate a deterministic matrix of stage × owner × typed outcome. Assert:

- selected modules exactly equal emitted instruction files;
- every required binding exists in that request's actual schema/input projection;
- incompatible rules never coexist;
- outcome-specific guidance is absent without its typed evidence;
- tool instructions never promise unavailable model-executable tools;
- full authorized profile conservation and provenance remain intact.

Cover planning, FAQ, purchase, RSVP, auth, image, handoff and router calls, including mixed-topic and failure outcomes. Retain byte metrics as resource telemetry and coarse regression guards after semantic checks, not the definition of correctness. Keep manual L1–L11 supervision and objective targeted live cases for behavior that static contracts cannot prove.

### D. Enforce review invalidation in normal development

Run contract/freshness validation under the existing `check` workflow and CI; do not make it an optional report that contributors forget. A prompt/schema/tool/compiler change must produce a focused review record naming changed invariants and affected offline/live cases. No paid model judge is needed for the static gate. Deployment still requires selected development live validation according to repository instructions.

## Local handoff acceptance checks

The local thread should first preserve the current working tree, identify baseline versus partial edits, and resolve the open audit findings. It should then add or repair inventory reachability and actual-composition checks, run typecheck/lint/offline tests and the review freshness check, build/deploy development with `se-dev` in `us-east-1` after account verification, re-read the deployed hash/router config, and execute only the explicitly selected frozen live cases plus supervised language conversations. Never treat 130 mapped files or a fresh digest alone as proof that the instructions agree.
