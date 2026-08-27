# Session Handoff - 2026-08-27 - plan-2026-08-27-rsvp-projection-prompt-audit

## Deployed dev revision (current)

- Lambda runtime revision: 52e32c53-1c1d-4165-a524-04f8e4df6130
- CodeSha256: btC3xiTAQhcglHEEhTvS6IL1ucHiASdJENWUYc6Pv10=
- Last deploy: 2026-08-27T21:27:01Z via se-dev us-east-1 account 684516060775 (eval-2026-08-27T21-28-19-828Z-ba2c472f, rev 52e32c53)
- Does NOT include T6-fix-2 commits 26f2971/d020e14/ea80010/c67b25e (local only, 553 tests pass)
- Premature-mutation bug still live in dev until gate attempt 3 redeploys: src/runtime/agent-service.ts:1739 uses unconditional pending_action fallback; fix makes it status-conditional (awaiting_action requires current-turn extraction; awaiting_event_selection keeps stored-decision continuation)

## Workstream status

### A - RSVP three-state projection

- Shipped: three-state (resolved_single | needs_event_selection | unavailable) in src/runtime/agent-service.ts, contracts.ts; candidate arrays omitted in resolved_single; records without event identity rejected; deterministic rendering; /guest/rsvp observability
- Verified live: paolo_mariana case live_behavior.rsvp_paolo_mariana_resolved_single PASSED judge 1.00 in gate attempt 2 (8/12)
- Pending deploy: mutation-authorization fix (T6-fix-2 A) + prompt/note hardening (B) + registry provenance corrections (C) + byte accounting reconciliation (D) - all local, not yet deployed

### B - Prompt audit

- Done: rubric at docs/plan/plan-2026-08-27-rsvp-projection-prompt-audit/rubric.md (10 criteria, 6 sources); inventory at docs/prompt-audit/prompt-inventory.json (128 files, 29 nodes, zero unmapped); per-branch baseline at docs/prompt-audit/per-branch-baseline-78ae24e.json (38 branches, anchor 78ae24e via git show, instructionBytes authoritative per prompt-loader.ts:75-77 and openai-agent-runtime.ts:411-423)
- Done: audit report at docs/prompt-audit/2026-08-system-prompt-audit.md (commit b40713a); verdict warning; 8 findings F1-F8 plus M1-M2; ordered backlog for T5
- Pending: T5 remediation batch (deletions, route-specific sections, byte deltas, relevance regressions, coverage entries)

## Gate history

- Gate 1 attempt 1: 4/12 - eval-2026-08-27T20-38-57-569Z-f4748e3b, rev 3894a691 (CodeSha256 Gz5ch0MIafa8dTkTpkS9+FoDGMa0/ldiCi3LXBMXqLc=)
  - Failures: paolo_mariana routing failure (extraction chose associated_event -> resolver_consultas_informativas instead of responder_invitacion), plus declined/missing_action/jose and 0.55-0.85 semantic drifts
- Fix cycle 1 (T6-fix): eval-runner isolation hooks (src/evals/runner.ts + live-behavior-cli.ts, caseIds filtering), fixture/registry corrections (rsvp fixtures status/pending_action alignment), state-aligned RSVP reply rules (prompts/nodes/responder_invitacion, +501 bytes justified)
- Gate 1 attempt 2: 8/12 - eval-2026-08-27T21-28-19-828Z-ba2c472f, rev 52e32c53 (CodeSha256 btC3xiTAQhcglHEEhTvS6IL1ucHiASdJENWUYc6Pv10=)
  - paolo_mariana PASSED (judge 1.00); remaining 4 failures: ambiguous_event 0.60 (dates), declined 0.00 + missing_action 0.00 (premature mutation), jose 0.05 (unavailable never-claim)
- Fix cycle 2 (T6-fix-2, commits 26f2971/d020e14/ea80010/c67b25e): status-conditional pending_action fallback at src/runtime/agent-service.ts:1739, prompt/note hardening (response_contract.txt +22 bytes, nombre y fecha), registry provenance 4c4a56a correction (ea80010), byte accounting reconciliation (instructionBytes 8776 vs raw 8512, header overhead 264)
- Fix cycle 2b: dev-data hunt for campaign-context phone WITHOUT guest record -> NOT_FOUND (80 phones enumerated; evidence /tmp/evidence-T6-fix-2b.json)

## Open decision - T6-open-decision (jose case)

- Premise under test: invitation_record unavailable with campaign context
- Live dev data contradicts premise:
  - Gia Antonella event 38331 guest 579788: has_responded=true will_attend=true (verified via GET /guest/events and GET /event?event_id=38331 with X-Agent-Key, plus user-lookup)
  - Julisabeth y Andres event 35569 guest 570463: same (has_responded true)
  - Only 2 phones have campaign context for these events (+51904523314, +51941438449); both already have guest records for those events
  - All other 78 enumerated phones have no campaign context for those events
  - Evidence: /tmp/evidence-T6-fix-2b.json, read-only, no guestRsvp mutations, STS se-dev 684516060775
- SE API capability: can toggle attending/declining via guestRsvp, cannot provision/delete guest record or inject admin_campaign context; rsvpIsolation skips pending when queryCurrentRsvpState returns null (src/evals/rsvp-isolation.ts:80-86); no branch creates unavailable
- Options awaiting user decision:
  - (B) Re-ground jose to attending + re-point rsvp-unavailable-never-claim-confirmation to trusted_phone_reports_no_pending IF that case verifiably exercises the unavailable projection
  - (C-alt) Build SE-API provisioning capability (new scope, needs user approval and backend support)
  - Rejected: keep as-is (case tests nothing it claims; would mask unavailable projection)
- Impact: T6 gate cannot pass jose until decision resolved; T5 registry entry rsvp-unavailable-never-claim-confirmation points at jose today

## Next steps (exact)

1. Resolve T6-open-decision (user picks B or C-alt; B requires verifying trusted_phone_reports_no_pending exercises unavailable)
2. Gate attempt 3: redeploy dev Lambda with T6-fix-2 commits (26f2971/d020e14/ea80010/c67b25e) via se-dev us-east-1 fail-closed (STS 684516060775), then npm run eval:behavior-live with 12-case RSVP subset via --case repeatable flags; must achieve 12/12 with no missing judge/skipped/errored
3. T5: apply remediation backlog from audit report (F1-F6, F3-F5 deletions, F1 route-specific RSVP sections, F5 shared scope, M1 tooling fix, M2 provenance) with measured byte deltas and relevance regressions; register coverage entries
4. T5r: reviewer gate on T5 (review-t5.md) - must pass before next deploy
5. T7: deploy T5 batch + run gate 2 (12 RSVP re-validation + T5 new cases)
6. T8: cumulative gate + explicit user decision point for full live_behavior_regression suite (37+ cases, pinned by suite ID)

## Evidence pointers

- Plan: docs/plan/plan-2026-08-27-rsvp-projection-prompt-audit/plan.yaml
- Review T1: docs/plan/plan-2026-08-27-rsvp-projection-prompt-audit/review-t1.md
- Rubric: docs/plan/plan-2026-08-27-rsvp-projection-prompt-audit/rubric.md
- Inventory: docs/prompt-audit/prompt-inventory.json
- Baseline: docs/prompt-audit/per-branch-baseline-78ae24e.json
- Audit report: docs/prompt-audit/2026-08-system-prompt-audit.md
- Eval runs: .eval-runs/eval-2026-08-27T20-38-57-569Z-f4748e3b (4/12), .eval-runs/eval-2026-08-27T21-28-19-828Z-ba2c472f (8/12), .eval-runs/eval-2026-08-27T21-21-05-474Z-9f2633f1 (401 intermediate)
- Dev-data evidence: /tmp/evidence-T6-fix-2b.json (80 phones, 2 campaign, both with guest records)
- Implementation log: docs/implementation-log.md (T6-fix-2 batch and this handoff)
