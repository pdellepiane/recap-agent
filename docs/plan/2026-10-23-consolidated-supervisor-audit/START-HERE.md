# Local continuation handoff — start here

**Latest correction:** [final-language-fix.md](final-language-fix.md) records the final wording/follow-up fixes, offline evidence and the current AWS cache-access deployment blocker. These changes are newer than the deployed artifact below. The final live check has not run.

**Continuation update:** implementation, full offline validation, development deployment, the targeted live panel and four supervised conversations are recorded in [continuation-status.md](continuation-status.md). The final artifact passed 6 of 6 targeted cases. One supervised public-search follow-up failed and remains open. Production was not changed. The original handoff below is preserved as historical context.

User goal: fix the reported customer-support behavior, audit the whole prompt system for contradictions/staleness, and enforce freshness through stronger contracts than character budgets. Continue in a LOCAL thread with the repository, AWS CLI and the user's `se-dev` session. This cloud/sandbox session could inspect and edit files but could not contact AWS. Do not redesign the project for cloud execution.

## Status and provenance

The bullets in this section describe the state when the original handoff was written. Current deployment and live results are in [continuation-status.md](continuation-status.md).

- Baseline commit: `8b69c341f6a8e50e965fa16afbc0fb427b0a8c6f` (the original supervisor handoff).
- All current changes from this session are **uncommitted working-tree changes**, including new/untracked code, tests, fixtures and these documents. Do not assume switching to another clone transfers them. Preserve the current tree. An optional sibling `working-tree.patch` contains the tracked diff and this session's new files; run `git apply --check` before applying it to a clean matching baseline. Do not apply over an already-modified checkout.
- Earlier user-owned `analysis/2026-10-19-whatsapp-behavior-cases/` and another audit's `working-tree-observation.json` were preserved. The optional patch omits those existing untracked files. The old handoff explains the four original transcripts and their fixture mapping.
- No new development deployment, CodeSha256 verification, paid model call, live gate or supervised live conversation succeeded in this session. Existing historical live results do not validate the candidate changes.
- AWS endpoint and general-domain DNS failed inside the sandbox. STS stopped the deployment before any remote mutation; this is not evidence that the user's local login is invalid. Also tsx's CLI IPC listener hit sandbox EPERM: `node --import tsx <script.ts>` worked offline instead.
- No production changes were authorized or performed.

## Read in this order

1. `implementation-plan.md`: feedback, partial implementations, five repair packages, validation limits.
2. `prompt-consistency-audit.md`: exact 6005-byte failing request and its actual instruction conflicts.
3. `extractor-router-freshness-audit.md`: E1–E5/R1–R5, including active instructions embedded in runtime input builders.
4. `reply-prompt-audit.md`: reply/shared/node conflicts, production versus legacy reachability.
5. `freshness-mechanism-audit.md`: why existing checks miss drift and the durable enforcement architecture.
6. The original `../2026-09-09-lean-conversation/supervisor-handoff-2026-10-23.md` and `evals/e2e-supervision/SKILL.md`.

The agent audit documents are read-only findings. This session also implemented a first offline review-invalidation gate below; the full typed contract/actual-request matrix is still to implement. Do not mistake recommendations for completed code.

## Binding user clarifications

- **Withdrawals are a separate FAQ service from gift commissions.** Answer supported public policy. Do not treat withdrawal questions as forbidden. Preserve the no-calculation rule. Use the calculator for supported gift/service commission calculations; do not claim it computes a withdrawal conversion without evidence.
- Current checked-in/published FAQ: first withdrawal free; additional transfers US$5 or the applicable equivalent. Do not hardcode PEN20 from an uncertain comment.
- The order total PEN161.20 is not evidence of received funds. The possible PEN11.20 balance is not verified by that total alone. Do not fabricate a balance or approval.
- Audit instruction responsibility, schema consistency and applicability **before** measuring prompt size. Do not solve the 6005/6000-byte failure by trimming characters or raising the limit.
- Every delivered conversational sentence remains model-written Spanish. Code/docs/responses to developers stay English. No intent keywords, canned replies, post-generation prose edits, or removal of authorized profile data.

## Wider findings to resolve

### Actual production composition and stale policies

The offline catalog lists **130 files** and zero unmapped. **86 have only retired/audit consumer descriptions**. The old prompt audit passed 34 bundle checks but predominantly audits `loadNodeBundle` / `loadExtractorBundle`; production calls use typed module selection through `buildExtractionRequestSpec` / `buildReplyRequestSpec`. A green legacy audit is not production prompt consistency. Do not re-enable giant legacy bundles to make the surfaces agree.

High-priority contradictions and drift:

- Requested operations must be captured even when unavailable, but base guidance says use available actions; another input advertises no domain operations and forbids extraction outside that list while the schema accepts requested operations.
- Instruction selection and dynamic schema selection use different capability inputs; disabled fields can still have active instructions.
- `destination_account` is a removed extractor selector referenced in current prompt guidance.
- Explicit pause is exposed by the schema, but close/pause guidance globally forbids it. Planning-wide guidance conflates final close with temporary save.
- Active FAQ guidance forbids figures while public fee policies require sourced figures.
- Active image guidance forbids all links while public search/calculator modules require public links.
- Shared commission article identity incorrectly selects one topic's reply rules for another topic.
- Router settlement is predicted without completed event/FAQ/effect evidence, its input calls customer claims verified facts, and it can select only the latest request. Returning to a parked refund after an unrelated answer can escalate again.
- Conversation-wide unresolved-money state can contaminate an unrelated factual answer.
- Partial-source guidance misses completed results with a failed constituent source.
- Router parsing tolerates unknown/duplicate answer names; validate its answer contract without inventing new probability thresholds.
- Spanish instruction-bearing strings exist inside runtime TypeScript outside prompts. Move guidance into tracked scoped templates; keep input builders factual.

## Candidate changes already present — inspect, do not blindly accept

Earlier in this same thread, before the user switched to consolidation:

- General withdrawal-policy queries retain their actual question; individual-status handling retains the operational query. Relevant additional articles remain preserved alongside a validated processing-window projection.
- Added a scoped public-search reply module for empty/not-found associated-event results and an exact public URL diagnostics allowance.
- Shortened commission guidance around the question and no arithmetic; it **still** has unsupported blanket calculator routing for withdrawals and needs typed topic selection.
- Clarified payment-record field semantics; total versus received-funds/balance still needs complete request-scoped behavior verification.
- Added synthetic fixture-phone/contact preflight to `scripts/supervised-probe.mjs`.
- Added four live candidates: `pending_total_dispute_is_reviewed`, `unassociated_event_has_public_search`, `withdrawal_fee_policy_and_calculator`, `fourth_request_keeps_plan_valid`; suite/frozen manifest count is now 58 total / 55 support.
- Replaced the existing question-after-takeover internal-node assertion with an authorized event-date fact.

Known candidate test defects: pending-payment case expects `unresolved_money=true` although current deterministic classification does not establish that for a nonempty pending order; model the dispute explicitly. Withdrawal case requires an unsupported withdrawal-calculator conversion. Bounded-list case has a positional internal-state assertion; prefer successful persistence/reload and backend facts live, with pruning pinned offline. Add the returned-refund and financial-state-contamination regressions. Register each new behavior and historical fixes `34051051` / `02d23684` separately; entries are still missing.

## New offline freshness gate — implemented, intentionally blocked

Files:

- `src/audit/prompt-freshness.ts`
- `src/audit/prompt-freshness-cli.ts`
- `tests/prompt-freshness.test.ts`
- `evals/prompt-review-lock.json`
- `package.json` adds `audit:prompt-freshness` and appends it to `check`; CI invokes it after tests.

Run:

```bash
npm run audit:prompt-freshness
```

It fingerprints every prompt, runtime/core TypeScript, knowledge article/manifest and the key audit contract sources. It rejects changed/additional/deleted prompts, dependency drift, duplicate review entries, pending/blocked reviews, absent review evidence and unresolved blocking findings. All 130 entries start **pending**. The current gate must fail; a generated digest is not semantic approval. `--candidate <new-path>` exclusively creates a fresh pending candidate and cannot overwrite a reviewed file. Do not mark entries approved just to get green or automate blind approvals.

The dependency boundary is deliberately coarse: any covered dependency edit requires a package review. Narrow this only after typed module dependencies exist. This prevents silent reviewed-version drift, **not every possible semantic contradiction**.

Still needed for durable prevention:

1. Explicit production/archived/orphan classification from real loader reachability; eliminate the inventory's synthetic orphan consumer and incorrect stage mapping.
2. Per-module typed schema/evidence/tool bindings, invariant ownership and incompatible-rule declarations, validated against the actual generated schema/registries.
3. Actual serialized-request matrix across capabilities, owners and outcomes, including mixed image+public-link, fee FAQ+no private orders, pause vs final close, handoff+FAQ, and completed partial-source results.
4. Mutation tests proving renamed fields, disabled capabilities, conflicting module ownership and changed enums fail without a model.
5. Explicit semantic review records/closed findings before approving lock entries. Byte budgets remain secondary resource guards.

## Validation actually obtained

- Earlier baseline focused set: 84 passed.
- Earlier candidate focused set: 128 passed / one skipped.
- Full candidate offline run: 210 files passed / two failed; 1700 tests passed / two failed / one skipped. Both failures were instruction-size checks. Later targeted runs still measured 6005 bytes against 6000. No final green full-suite claim.
- New audit/freshness set: 4 files / 20 tests passed, including five freshness tests for pending approval, same-length prompt edits, dependency edits, new/deleted files and blocking findings.
- Typecheck and scoped lint for the new audit implementation passed.
- Legacy audit completed offline: 34 bundles, no reported violations, 130 catalog files, 38 measured branches. Its blind spots are documented above.
- The new whole-catalog freshness gate is expected to report all 130 entries pending, not success.
- Earlier candidate Lambda build succeeded under `.artifacts/review-2026-10-23-build`; no verified deployed artifact resulted. Do not deploy this old build after further fixes—build a fresh exact artifact.

## Local execution order

1. Preserve and inspect the working tree; confirm all untracked handoff/code/test files arrived. Read the findings before changing prompts. Fix contradictions and request/outcome state at their typed owners, in separate atomic responsibilities, maintaining `docs/implementation-log.md`.
2. Finish the semantic freshness mechanism and reconcile candidate regressions/registry. Run typecheck, lint, affected offline contracts, coverage registry, manifest reconciliation and full offline tests. Existing byte failures stay visible until semantic repairs resolve them; do not raise limits.
3. Verify local AWS, exclusively `se-dev` / `us-east-1`, account `684516060775`. If needed refresh the backing login with `aws login --profile se-signin`. Mutations must fail closed on account mismatch.
4. Build/deploy development with router enabled. Re-read `CodeSha256` and configuration and record the exact artifact and source identities. Do not deploy production.
5. Freeze explicitly selected cases and the existing paid-run budget after repairing the cases. Proposed panel: the three October-feedback topics, the bounded-list case, returned-parked-refund and unrelated-money isolation, existing A–D cases and gift-commission calculator coverage. Run only `npm run eval:behavior-live -- --case <id> ...`; never run the unfiltered live gate or retry a semantic failure without a new user instruction.
6. Apply the E2E supervision skill to synthetic fixture conversations, with full-partition resets and seeded phones. Review actual delivered Spanish against L1–L11. Record every failure, receipt, run/cost/artifact identity. No semantic judges in the live gate.

Success means consistent actual request contracts, enforced review freshness, passing offline checks, a verified current development deployment, targeted objective live results and supervised language evidence. Do not declare the reported production failures impossible based on static tests alone.
