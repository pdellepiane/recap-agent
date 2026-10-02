# Live behavior test reduction — 30 September 2026

The live panel is reduced by 50% through actual case-file deletion. The live gate ran and is not green.

| Measure | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Live cases | 92 | 46 | 50.0% |
| Assertions | 663 | 329 | 50.4% |
| Turns | 361 | 185 | 48.8% |

All 46 deleted files are absent from the live catalog. No removed case was merged into a longer carrier or moved to another live suite. The retained cases use hard assertions for authorization, effects, backend facts, failures, and receipts; no semantic votes, internal node transitions, required read-tool calls, or budget-efficiency scorer remain. Historical registry entries without a retained case are explicitly retired rather than reassigned to unrelated scenarios.

## Live gate

- Run: eval-2026-10-01T00-04-11-490Z-897da1bc. The date in the ID is UTC; this run occurred on 30 September in Lima.
- Development artifact: 4fa8e7c11395dbffab726108ebeeacf46f794fb9d7eb69fcef4b478c99bc9fdf. AWS account 684516060775, se-dev, us-east-1. Artifact identity was stable before and after execution.
- Frozen panel: all 46 IDs were explicitly selected. One paid run, no retries.
- Result: **39 passed / 7 failed / 0 errored / 0 skipped**; 321 of 329 assertions passed.
- Cost: **$0.155863** ($0.126464 model + $0.029399 Lambda; $0 judges), below the $1 planning allowance.
- Original report: [report.json](../../.eval-runs/eval-2026-10-01T00-04-11-490Z-897da1bc/report.json). Original manifest, results, and reports were preserved unchanged.

The CLI progress label `ok` described successful execution, not successful assertion grading. The final report is the authoritative gate result.

| Failed case | Failed assertions | Disposition |
| --- | ---: | --- |
| live_behavior.customer_event_task_continuity | 2 | Per-turn count contract corrected; original live failure preserved |
| live_behavior.gift_shipping_limitation_accepted_handoff_once | 1 | Per-turn count contract corrected; original live failure preserved |
| live_behavior.host_withdrawal_diana_policy_and_support | 1 | Per-turn count contract corrected; original live failure preserved |
| live_behavior.otp_number_words_are_verified | 1 | Behavior failure retained |
| live_behavior.otp_terminal_handoff_failed | 1 | Per-turn count contract corrected; original live failure preserved |
| live_behavior.otp_terminal_handoff_unknown | 1 | Per-turn count contract corrected; original live failure preserved |
| live_behavior.rsvp_explicit_mutation_targets_requested_event | 1 | Behavior failure retained |

Six failed assertions across five cases expected the cumulative prior write at a later turn. The checker correctly compares per-turn deltas. Those six contracts now expect zero new attempts/successes/replays; their original action turns still require the original write. An offline check proves all six reject an injected extra write. The corrected contracts have **not** been rerun live, so no new live pass rate is claimed.

Two failures remain unchanged: `otp_number_words_are_verified` calls authentication and human takeover on a request to repeat the previous answer; `rsvp_explicit_mutation_targets_requested_event` attempts the Marta RSVP update but the backend returns failure instead of the required successful write. Both cases and their hard assertions remain in the panel.

## Verification

Loader/CLI/coverage/catalog checks: 75 passed. Post-oracle coverage/ledger/effect checks: 15 passed. Type checking and changed-file lint pass. The new negative-control test passes for all six corrected contracts. An unrelated pre-existing S01 source-shape assertion remained red in the broader diagnostic run and was left unchanged; no full offline green claim is made.

The machine-readable [reduction audit](2026-09-30-live-hard-contract-reduction.json) records each deleted case, retired coverage scope, removed assertion, oracle correction, and remaining behavior failure. Eighteen obsolete offline catalog/judge contract checks were removed solely to reconcile the retired live design; they are not counted toward the 50% live reduction.

## Follow-up validation

The two behavior bugs and six later-turn count oracles are corrected. A development run of the same seven affected cases passed all hard assertions on a stable artifact. The original 46-case gate remains historical; see [targeted fix validation](2026-09-30-live-hard-contract-fixes.md) for the recovered run, infrastructure interruption, scope and local limitations.
