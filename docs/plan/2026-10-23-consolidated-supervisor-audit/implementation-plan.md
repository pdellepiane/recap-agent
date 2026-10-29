# Consolidated support audit and implementation plan — 2026-10-23

Status: NOT release-ready. Baseline: `8b69c341`. Development deployment, targeted live results and supervised language evidence are recorded in `continuation-status.md`; the public-search follow-up remains an open failure. This document preserves the original plan and audit context.

## Binding clarification

Withdrawal fees and gift/service commissions are distinct FAQ subjects. Both may be answered from published evidence. The assistant must not calculate fees or conversions. The supplied calculator is established for gift/service commission calculations; do not claim it calculates withdrawal fees without evidence. The FAQ publishes a free first withdrawal and US$5 for additional transfers (or the applicable currency equivalent); it does not establish a fixed PEN20 fee.

## Evidence and current limitations

- Original cases A–D: `analysis/2026-10-19-whatsapp-behavior-cases/transcription.md`; historical context and fixture mappings: `supervisor-handoff-2026-10-23.md` in the lean-conversation plan folder.
- October 20 feedback: the supplied screenshots and Claudia's commentary. The pending order total is PEN161.20. A possible PEN11.20 balance is not established by that total alone. Do not invent an amount received, outstanding balance, or approval.
- Public event search: https://sinenvolturas.com/buscar is publicly available. A supplied name or public search link does not authorize private records, attendance changes, or a claim that an event was found.
- Public FAQ checked: https://sinenvolturas.tawk.help/article/cuanto-cuesta. Calculator checked: https://sinenvolturas.com/coste-del-servicio; its published page describes gift/service costs.
- AWS STS and the backing sign-in token endpoint were unreachable from this execution session. The development deploy attempt stopped at the account-identity guard before a deployment. No new live run, artifact identity verification, or language qualification was claimed at that time; the later development deployment and live results are in `continuation-status.md`.
- Another read-only audit created `working-tree-observation.json`; preserve it and its ownership. Prior untracked analysis remains untouched.

## P1 — Request identity, settlement and one handoff

Baseline defect: the router and policy inspect only the latest request. After a refund is parked, an unrelated answer becomes the latest record. A return to the refund can lose its parked identity and escalate again. The existing two-turn case does not cover that return.

1. Project the relevant retained request identities with stable keys and state. Let structured model extraction identify which existing request is resumed, or whether this is a new request; validate keys deterministically. Do not match conversational keywords.
2. Apply pause, clarification, settlement and escalation to the selected request rather than unconditionally to the last list element.
3. Preserve the successful conversation-level handoff receipt independently of bounded request-list eviction. A returned parked topic must not create a second takeover.
4. Distinguish successful FAQ answers and public-resource guidance from unresolved operational disputes in settlement evidence. `request_settled.txt` currently remains narrower than the updated FAQ-capable route definition.
5. Keep failed/unknown handoff outcomes retryable according to actual receipts; do not treat an attempted handoff as confirmed.

Acceptance: deterministic scripted-router twins plus a live refund → unrelated event question → refund return case. Assert exactly one successful takeover, no duplicate effect on return, correct authorized event fact on the unrelated turn, and preservation of the original parked request. Also retain failed-handoff and all-parked-list pruning coverage. Do not add internal-node assertions to the live gate.

Additional independent finding: settlement currently reads conversation-wide `support_outcome.unresolved_money`. Scope that evidence to the selected financial request; an unresolved refund must not keep an unrelated date answer unresolved. Add disputed-payment → unrelated answer → repeated unrelated question coverage with no extra handoff.

## P2 — Financial facts and pending-payment language

Retain explicit labels for order total, backend payment record, customer-reported payment and a verified outstanding balance. Pending `payment.amount` is not itself proof of receipt. Approved purchases must not be described as missing or unconfirmed merely because a secondary reference is absent. A thank-you record does not prove that the platform notified a host.

1. Audit gateway mappings and profile provenance for any real balance/received-amount field before exposing it. Preserve all authorized records, fields and source failures.
2. If an explicit balance exists, deliver that sourced balance with its order total. If it does not, explain the known total and send the disputed payment for human review; never infer PEN11.20 or PEN150 from PEN161.20 alone.
3. Preserve existing A–D regressions and add the October 20 context, including the older USD approved purchase, so it cannot settle the newer PEN pending purchase.
4. Supervise the complete exchange with L1–L11: one coherent explanation, attributed amounts, truthful handoff, no repeated uncertainty paragraph and one next step.

The candidate pending-payment live case currently expects `unresolved_money=true`, but the deterministic support-outcome classifier treats a nonempty pending purchase as resolved. Repair explicit dispute evidence before relying on that assertion; do not mark every pending purchase unresolved. `adminComment` is excluded from model projection and is not an approved workaround for a missing typed balance.

Current candidate: the shared field-semantic prompt was clarified and a synthetic pending-total case was added. These are not evidence that the supplied production conversation can no longer recur.

## P3 — Public event search

Retain the typed, scoped fallback module for associated-event lookup outcomes that are empty or not found. Offer the public search URL without promising that the named event is published or searchable from the runtime. Do not repeat requests for names already supplied. A failed lookup must not be relabeled as an exhaustive absence.

Acceptance: no-associated-phone with names already supplied; an existing authorized event; a failed lookup; and a private/unpublished event. Public guidance must not trigger OTP, expose private facts, invent venue/time/entrances or write RSVP. The live case checks the public destination and unauthorized effects; language qualification checks usefulness.

## P4 — Separate withdrawal FAQ from gift commissions

1. Retain the candidate retrieval fix: general withdrawal-policy queries preserve the actual question; individual-status queries retain their operational handling.
2. Model the requested policy topic in structured extraction and typed runtime state. Shared `cuanto-cuesta.md` source identity cannot select gift-commission guidance because that article also contains withdrawal policy.
3. Select only topic-appropriate reply guidance. Withdrawal fees: explain the free first transfer and published additional-transfer fee, with no invented currency conversion. Gift commissions: explain only the requested policy; direct personalized calculations to the calculator.
4. Preserve relevant FAQ evidence without reintroducing unrelated operational examples or rewriting a fee question into a processing-time question.
5. Replace the candidate withdrawal live case's unsupported mandatory calculator assertion with separate withdrawal-policy and commission-calculator objectives.

Acceptance: general withdrawal fee, withdrawal processing time, individual withdrawal status, gift commission and mixed fee questions. No negative policy that forbids answering withdrawal FAQs; no new fee arithmetic. Use retrieved facts and hard effect/authorization assertions, with manual language supervision.

## P5 — Validation and coverage repairs

- Add separate registry entries for historical fixes `34051051` and `02d23684`, and for every new behavior change. Registry success alone does not detect missing entries.
- Replace the bounded-list candidate's positional internal-state assertion with backend answer and successful persisted-plan reload/continuation outcomes; pin pruning details offline.
- Retain the candidate replacement of the takeover case's internal-node assertion with the authorized event-date fact. Note that probabilistic live outcomes do not pin the policy branch; the offline twin does.
- Retain the candidate probe preflight: synthetic phone, matching contact, fixture seed membership, explicit empty-profile override. Validate before AWS access.
- Reconcile the frozen selected-case package whenever cases change; never run an unfiltered live gate.
- First resolve the responsibility conflicts, stale schema selector and stage/evidence leakage documented in `prompt-consistency-audit.md`; measure size only after those semantic repairs. Do not trim characters to cross the threshold. Reduce irrelevant instruction bytes rather than raising budgets or dropping customer data. Current extraction requests measure **6005 bytes**, above the existing **6000-byte** limit; two tests remain failing.
- Latest full offline run: **210 files passed / 2 failed; 1700 tests passed / 2 failed / 1 skipped**. Both failures were instruction size. A later targeted run still failed at 6005 bytes. Typecheck passed; a lint unsafe-assignment finding was fixed and the scoped rerun passed. No final all-checks-green claim.
- Candidate reply-spec measurements: missing event instructions/input **2383/1462 bytes**; commission **1337/1550 bytes**. These are representative offline request measurements, not production timing or total customer-profile limits.
- Build succeeded under `.artifacts/review-2026-10-23-build`. The attempted development deploy did not pass STS verification. There is no new deployed artifact hash.

## Execution order and exit criteria

Implement P1, P2, P3 and P4 as separate responsibilities with their own log and coverage entries; repair P5 alongside each. Re-run typecheck, lint, affected offline twins, prompt projection/size tests, registry and frozen-manifest checks. Once offline checks pass, build and deploy development through `se-dev`, `us-east-1`, account `684516060775`; re-read CodeSha256 and router configuration.

Freeze an explicitly selected panel containing the new feedback cases, older A–D cases, the returned parked request, bounded-list case and commission case before any paid run. Use the existing paid-run budget and selected-case CLI. Do not retry semantic failures or broaden the panel without a new user instruction. Use synthetic fixture phones and full-partition resets for supervised conversations. Record each actual delivered reply, L1–L11 verdict, receipt, run identity and artifact hash. Only those results can close the language and live-behavior claims.
