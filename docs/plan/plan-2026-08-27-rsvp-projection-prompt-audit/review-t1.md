# Review Note: T1r - Reviewer gate on the T1 change set before deploy 1

- plan_id: plan-2026-08-27-rsvp-projection-prompt-audit
- task_id: T1r
- review_target: code | review_mode: high | review_scope: changed
- Reviewed change set: commit 82d48b0 ("feat(rsvp): project three-state RSVP evidence (Paolo & Mariana fix)"), parent 3a1b116, wave-1 baseline 4d14915. 11 files: 9 modified + 2 created, matching the T1 report.
- Read-only review; this note is the only artifact written. No source files modified.
- Reviewer gates rerun on the current tree (includes non-RSVP T0/T2/T3 commits): all evidence below was independently re-executed, not taken from the T1 report.

## Verdict

**PASS - no blocking findings. T6 may proceed with deploy 1.**

One medium-severity non-blocking defect (F1, registry provenance) and minor informational notes (F2-F4). F1 should be corrected to 82d48b0 in a standalone registry commit before or alongside deploy 1; it is test-only metadata, not Lambda-impacting, and does not require a redeploy on its own.

## Criteria verification (C1-C7)

### C1: Three-state projection contract - PASS

- The reply evidence is a discriminated union with exactly `resolved_single | needs_event_selection | unavailable` (src/runtime/contracts.ts:89-117). `resolved_single` carries a single `event` field; `candidates` exists only in the `needs_event_selection` variant, so a resolved event plus a broad list is unrepresentable at the type level.
- Records lacking event identity are rejected, not projected: `hasRsvpEventIdentity` (src/runtime/agent-service.ts:2207-2214, identity = non-null `eventId` or non-empty normalized `eventName`, consistent with the pre-existing `sameRsvpEvent` name-matching semantics at 2403-2413) filters both sources inside `reconcileRsvpPhoneEvidence` (2254-2282) and again in `projectRsvpPhoneEvidenceForReply` (2286-2377). Rejections are observable via `rsvp_reconcile_rejected_missing_identity`.
- Deterministic rendering: `sortRsvpInvitationsDeterministically` (2229-2252) orders by `eventId`, then normalized name, then date; duplicate identity records are deduped by reconcile before sorting, so no ties survive; stable sort. Twin test proves byte-identical snapshots for identical inputs (tests/rsvp-three-state-projection.test.ts:75-89) and stable candidate ordering (41-52).
- The offline twin asserts candidate-array ABSENCE, not just presence of the resolved event: `expect(evidence).not.toHaveProperty('candidates')` and `not.toHaveProperty('events')` alongside `state: 'resolved_single'` (tests/rsvp-three-state-projection.test.ts:21-23), plus the old `events` shape is explicitly excluded.

### C2: Uncertainty preserved; no union reintroduction - PASS

- Single call site for reply evidence: src/runtime/agent-service.ts:1915-1917, passing `selectedInvitation` derived from `selectRsvpInvitation` (2431-2469, unchanged selection semantics). `RsvpPhoneReplyEvidence` is constructed only in agent-service.ts (repo-wide grep); src/runtime/openai-agent-runtime.ts:975 serializes the request field verbatim (`rsvp_phone_evidence`); no other call site passes reconciled arrays into reply evidence. The old `events:` reply field is fully removed from runtime code.
- When a selection is established, the guard at 2309 forces `resolved_single` with one `event` and no candidates (also on the mutation path: `applyRsvpMutationResultToPhoneEvidence` at 2379-2401 only updates states in place, so the selected invitation stays matched). When no selection exists: 1 identity-bearing invitation yields `resolved_single`; 2+ yield `needs_event_selection` with the sorted candidate list. The `matched ?? selectedInvitation` fallback (2312) is unreachable in current wiring (defensive only), and even if reached projects a single event, never a list.
- Nuance (informational, not a violation): reply candidates appear whenever no selection is established and 2+ identity-bearing invitations exist, which includes the `awaiting_event_selection` branch (1801-1816) and the guest-record-unavailable branch (1798-1800). The binding C2 clause - the reply model never receives resolved event plus broad list together - holds on every path by union construction plus the 2309 guard.

### C3: Observability and no keyword matching - PASS

- `rsvp_projection_state` emitted on all four projection exits and `rsvp_reconcile_rejected_missing_identity` on rejection, via `logAuthObservabilityEvent` (11 established usages in this file). Payloads carry state, coverage, resolution, counts, selected/rejected identity outcome. Flow logic is untouched: projection only formats reply evidence; plan state transitions (1798-1882) are unchanged from the pre-fix flow.
- No keyword/exact-string matching introduced for flow decisions. Selection continues to use typed extraction (`rsvpCandidateGuestId`, `rsvpEventReference`) and pre-existing normalized-text helpers. The prompt conditions on the typed field `rsvp_phone_evidence.state`, not on message keywords.

### C4: Registry, live case, offline twin - PASS (one medium defect, F1)

- Registry entry `project-rsvp-phone-evidence-as-three-state` (evals/live-behavior-coverage.yaml:249-251) and suite registration `live_behavior.rsvp_paolo_mariana_resolved_single` (evals/suites/live_behavior_regression.yaml, suite 37 -> 38 cases, verified against anchor 78ae24e: 37).
- Live case (evals/cases/live-behavior-rsvp-paolo-mariana-resolved-single.yaml) structurally mirrors the existing RSVP case pattern (template.base-live, seedPlan, budget): hard `node_transition` to `responder_invitacion`, hard `tool_usage` (`mustCall: [lookup_rsvp_invitations]`, `mustNotCall` auth/OTP/guest_rsvp), and hard `text_semantic` with `minScore: 0.9` and `requireJudge: true`. The rubric describes the correct behavior: entirely Spanish, reports attendance already confirmed for the named event, wishes the guest well, and forbids asking to choose among invitations, listing alternatives, requesting email/code, or claiming a new mutation. The seed (`rsvp_state: none`, phone lookup) reconstructs the recorded interaction (fresh state query resolved through phone evidence), distinct from the stored-selection pattern of `rsvp_confirmed_state_is_reported`.
- No existing registered case weakened or modified: the commit touches only the new case file; registry and suite diffs are append-only. `tests/live-behavior-coverage.test.ts` passes (rerun).
- F1 (see Findings): the registry `implementedBy` hash points at an orphaned commit.

### C5: Prompt changes and byte deltas - PASS

- Changes confined to the responder_invitacion reply branch: system.txt and response_contract.txt. Both now branch explicitly on `rsvp_phone_evidence.state` (resolved_single / needs_event_selection / unavailable). Removed rules are exactly those made redundant by typed evidence: the generic multi-invitation enumeration rule and the broad already-responded/unavailable guidance (replaced by the state-conditioned line). Remaining rules are invariants not carried by typed state (no email/code, naturalness, no internal values, Spanish). This satisfies Minimum Disclosure: typed state replaces conditional prompt guidance, and each branch now receives only its own guidance.
- Conversational content is Spanish; the rewrite also replaced curly quotes with straight quotes (ASCII hygiene).
- Byte deltas independently verified with `git show 78ae24e:<path>` vs `git show 82d48b0:<path>`: system.txt 1367 -> 1345 (-22), response_contract.txt 1242 -> 1284 (+42), net +20, matching the logged bundle 8233 -> 8253 (+20, +0.24%) and the T3 baseline table. Justification for the net increase (replacing broad contradictory conditional guidance with precise typed-state guidance) is recorded in the log. `npm run audit:prompts` rerun: 0 violations; `npm run audit:prompts:compare` rerun: green, 52.21% reduction (732995 -> 350327 serialized bytes).

### C6: Strict TypeScript, no shims, channel-agnostic, node names - PASS

- No `any` in the diff (regex sweep over the commit: zero matches); typecheck clean. The union replaces the old shape outright - no backward-compat shim, no dual-shape tolerance; all consumers (including tests) updated to the new shape, and the updated tests add `state` assertions rather than weakening prior ones.
- Channel-agnostic: no channel-specific code; renderers untouched. State-machine node names unchanged; prompt file paths unchanged (content only); no state renames.

### C7: Local gate evidence - PASS (credibility independently confirmed)

- Rerun on the current tree: `npm run typecheck` clean; `npm run lint` clean; `npm test` 545/545 across 74 files (T1's reported 541 + T3's 4; arithmetic consistent with both log entries: baseline 520 + 16 T0 + 5 twin = 541). `tests/live-behavior-coverage.test.ts` green within the run. Audit gates green as above.
- docs/implementation-log.md entry present with reason, decision, prompt footprint, and verification, appended as a single atomic write.

## Findings

| # | Severity | Location | Finding |
|---|----------|----------|---------|
| F1 | MEDIUM | evals/live-behavior-coverage.yaml:250 | `implementedBy: "86a5b3a"` references an orphaned, unreachable pre-amend duplicate of the T1 commit (86a5b3a has the same message, date, and parent 3a1b116 as 82d48b0 but is not an ancestor of HEAD). The reachable implementing commit is 82d48b0. The coverage test only validates hash format (`/^[0-9a-f]{7,40}$/`), so the defect passes gates, but provenance is wrong and the object will be lost on GC or fresh clone. Fix: one-line registry change to `82d48b0` in a standalone commit; test-only metadata, not Lambda-impacting, no redeploy required for the fix itself. |
| F2 | LOW | src/runtime/contracts.ts:115 | The `unavailable` reason variants `missing_event_identity` and `lookup_failed` are never produced: lookup failure maps to `rsvpPhoneEvidence: null` (agent-service.ts:1783-1785, 1915-1917) and identity-less records are filtered before projection, exhausting to `no_invitations`. Dead union members; harmless (never serialized to the model) but over-specified. Candidate for the T4/T5 audit, not a deploy blocker. |
| F3 | LOW (informational) | src/runtime/agent-service.ts:2312 | `const target = matched ?? selectedInvitation` is unreachable in current wiring (selected invitations always originate from `evidence.invitations`, which `applyRsvpMutationResultToPhoneEvidence` only maps in place). Defensive dead path; also note the pre-existing edge where `selectRsvpInvitation` via `extractedGuestId` can select an identity-less record while another identity-bearing invitation exists - projection then reports the single identity-bearing invitation while the operational note references the selected record. Pre-existing selection semantics, still grounded and union-free; no action required for this gate. |
| F4 | INFO (out of T1 scope) | plan.yaml T6 description | T6's prose says "11 existing suite cases whose IDs contain rsvp, plus both accountless-event cases, plus T1's new case" but its own list of 12 decomposes as 9 pre-existing rsvp + 2 accountless + 1 new (suite now has 10 rsvp IDs). Membership is pinned by the explicit ID list, which is correct and deterministic; the prose arithmetic is an internal inconsistency only. Flagging for the orchestrator; no T1 action. |

## Invariant checklist

- No backward-compat shims: old `events` reply shape fully removed, all consumers migrated. PASS
- No keyword/exact-string flow matching: typed extraction and typed state field only. PASS
- Channel-agnostic core: no channel-specific behavior in the diff. PASS
- Existing live cases untouched: commit touches only the new case; registry/suite append-only. PASS
- No reopened 78ae24e paths: parser/gateway, COD301816 normalization, phone-scoped retrieval untouched. PASS
- Node names unchanged: no renames in runtime or prompts. PASS
- File ownership respected: no src/audit/ changes in the T1 commit. PASS
- Recorded spec implemented as written, no redesign or extra states. PASS

## Gate reruns performed by this review (current tree)

- `npm run typecheck` - clean
- `npm run lint` - clean
- `npm test` - 545/545 across 74 files (includes live-behavior-coverage test and the RSVP twin)
- `npm run audit:prompts` - 0 violations
- `npm run audit:prompts:compare` - green, 52.21% reduction
- Byte math vs anchor 78ae24e via `git show` - matches logged values exactly

## Decision

- Verdict: **pass** (warning-level findings only; zero blocking findings).
- T6 may proceed with deploy 1 carrying exactly the T1 change set, per plan wave 3.
- Required follow-up (non-blocking): correct F1 to `82d48b0` before T8 provenance verification; recommended before or alongside deploy 1.
- F2/F3 are logged for the T4 prompt-audit scope; no T1 rework required.
