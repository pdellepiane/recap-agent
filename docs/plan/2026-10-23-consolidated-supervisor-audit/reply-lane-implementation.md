# Reply and public FAQ implementation record — 2026-10-23

Implemented in the preserved working tree; not a deployment or live qualification.

## Decisions and changes

- Added structured `feeTopic` (`gift_commission`, `host_withdrawal`, `mixed`) to FAQ requests and completed results. The extractor owner supplies the topic. `hostWithdrawal` additionally establishes the withdrawal topic; article identity alone never identifies a requested service.
- Propagated the topic through FAQ orchestration and extraction normalization. Gift commission guidance requires both its structured topic and a recognized official commission article. Withdrawal guidance is separate and explicitly forbids unsupported conversions or treating the gift calculator as proof of withdrawal charges.
- General withdrawal questions preserve their actual retrieval query. Policy-only results preserve complete retrieved fee evidence even when a processing window also parses. Individual-status handling retains the previously validated processing-window projection and other retrieved articles; it still cannot verify or execute a particular withdrawal.
- Completed policy-only FAQ retrieval now clears pending policy work without requiring a processing-hours fact. A missing processing window remains unknown.
- Reply FAQ projection retains article evidence alongside optional processing policy. An hours field no longer replaces the fee article in the model input.
- Public fee figures are permitted by `payment_disclosure.txt`; private payment destinations continue to require an identified pending purchase. Image guidance forbids private access links and secrets while allowing relevant verified public resources.
- Public-search guidance is scoped to the failed/empty request and preserves events found by other requests. The exact search URL remains the next step, not a claim that the event was located or published.
- Completed purchase results with a failed constituent source now select the partial-source module. Ready purchase facts remain available with canonical source coverage.
- Planning interview/domain/question guidance is selected only on typed planning question nodes without close/pause evidence. Final close, saved-selection and receipt nodes no longer receive initial collection instructions. Shared flow discipline no longer equates final closure with temporary saving. This does not introduce a new pause runtime: the root owner is keeping the retired explicit-pause feature unavailable in production schemas.
- The no-repetition invariant now permits explaining genuinely changed evidence/outcomes and their consequences.
- Repaired the withdrawal live candidate so the calculator is required only on a distinct third-turn gift-commission question. The second withdrawal-conversion turn has no unsupported calculator requirement. Case ID remains `live_behavior.withdrawal_fee_policy_and_calculator`, version 2, max turns 3. Public search case ID remains unchanged.

## Offline verification

Command:

```sh
npx vitest run tests/agent-service-information-flow.test.ts tests/runtime-actual-request.test.ts tests/faq-prompt-economy.test.ts tests/host-withdrawal-policy.test.ts tests/commission-grounding.test.ts
```

Final lane run: 5 files passed, 121 tests passed, 1 pre-existing skipped. The actual-request serialization test's quota failures are mocked transport responses; this run made no paid requests.

The new service-entry tests exercise the router `information_flow` branch (implemented by the support owner), not only a reply constructor. Supplied event names and a successful empty profile produce the search module before OTP/private auth/handoff for domestic and foreign contact forms. A transport-failed event source remains `request_failed` and does not load the scoped absence module. Their account-event fixture explicitly returns an empty source; omitting that method would correctly yield incomplete/failed profile coverage rather than authoritative absence.

The entry tests first found a missing pending-request ID in the support owner's new branch; that owner repaired the ID mapping. The first fixture version also omitted the provider account-event method, causing a legitimate incomplete-source result; the fixture was corrected without reclassifying a failed source as absence.

Actual serialized request tests check fee-topic module selection, retained fee text with optional hours, image + public search + gift calculator compatibility, completed partial-source facts and planning completion scope. They invoke `auditActualRequestContract` with the actual emitted compiler context for the fee and mixed-image cases.

Representative instruction/input bytes from the final lane run:

| Branch | Instruction bytes | Input bytes |
| --- | ---: | ---: |
| Gift fee topic | 1444 | 1698 |
| Withdrawal fee topic | 1474 | 1698 |
| Mixed fee topics | 1916 | 1688 |
| Image + missing event + gift fee | 3973 | 1934 |
| Existing no-event prompt fixture | 2659 | 1462 |

These include concurrent root/support changes and are branch-specific offline measurements, not total customer-profile limits or live latency results. No byte budget was raised.

## Remaining validation boundaries

- Root owns full typecheck/lint integration, review freshness, registry reconciliation, exact artifact build/deployment and selected live runs.
- No AWS call, deployment, paid model call or live conversation was performed by this lane.
- The existing gift numeric check is a secondary numeric value allowlist. It does not prove semantic attribution or recognize every possible newly calculated value. Mixed-topic language still requires supervised qualification; no claim of comprehensive semantic monetary validation is made.
- The current published withdrawal policy supports the first free transfer and subsequent USD5/equivalent, but does not establish PEN20, an exchange rate, or processing hours. Personalized withdrawal conversion remains unverified.

## Integration repair: public policy versus raw operational evidence

The broader suite exposed an important existing negative test: a completed FAQ with parsed 72-hour policy plus an unrelated raw operational account/payment/delivery sample must not disclose that sample. The reply projector now retains fee text alongside parsed hours only for a structured withdrawal/mixed fee topic whose evidence has a validated full-article identity (canonical filename and exact official source URL). Otherwise it keeps the compact typed processing-policy projection. The original negative assertions were preserved; a positive canonical fee+hours case and source-identity rejection cases were added. Verified public fee sources include the withdrawal article and both official commission articles so mixed fee questions retain both services' supported public evidence.

Post-repair measurements changed gift-only input to 1630 bytes (the fixture no longer fabricates withdrawal processing hours for a gift-only query) and image+public resources to 3797 instruction / 1866 input bytes. The typed withdrawal and mixed fee measurements remain 1474/1698 and 1916/1688 bytes respectively. Root's concurrently edited extraction stub caused a separate token-usage test failure; it is independent of this policy projection repair and was reported without hiding it.
