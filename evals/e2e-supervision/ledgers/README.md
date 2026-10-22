# Qualified conversations

Each ledger is one supervised conversation: the guest's messages, the agent's
replies, the observed state and the language verdict the supervising agent
reached turn by turn. The format is `ledger-template.md`.

A ledger records the artifact it ran against. The same objective can have
several ledgers because the behaviour changed between runs; the earlier ones
are the honest record of what the customer read at that time.

| Ledger | Objective | Artifact | Verdict |
|---|---|---|---|
| `2026-10-21-obj-c-mirta-refund.md` | OBJ-C | before the reply contracts | PASS WITH FINDINGS |
| `2026-10-21-obj-c-mirta-offer-accept.md` | OBJ-C | before the reply contracts | PASS |
| `2026-10-21-obj-d-silvia-transfer.md` | OBJ-D | before the reply contracts | PASS WITH FINDINGS |
| `2026-10-21-obj-e-ambiguity.md` | OBJ-E | before the reply contracts | PASS WITH FINDINGS |
| `2026-10-21-obj-a-receipt-no-purchase.md` | OBJ-A | `df72d58f` | PASS |
| `2026-10-21-obj-b-reference-unavailable.md` | OBJ-B | `df72d58f` | PASS |
| `2026-10-21-obj-c-mirta-refund-rerun.md` | OBJ-C | `df72d58f` | PASS WITH FINDINGS |
| `2026-10-21-obj-d-silvia-transfer-rerun.md` | OBJ-D | `df72d58f` | PASS WITH FINDINGS |
| `2026-10-21-obj-m-wrong-recipient-transfer.md` | OBJ-M | `df72d58f` | PASS WITH FINDINGS |
| `2026-10-21-obj-h-post-handoff-new-question.md` | OBJ-H | `df72d58f` | FAIL |
| `2026-10-21-obj-i-handoff-failure.md` | OBJ-I | `df72d58f` | FAIL |
| `2026-10-21-obj-o-repeatability.md` | OBJ-O (OBJ-E half) | `df72d58f` | PASS |
| `2026-10-21-obj-c-mirta-refund-rerun2.md` | OBJ-C | `53a1ff31` | PASS WITH FINDINGS |
| `2026-10-21-obj-d-silvia-transfer-rerun2.md` | OBJ-D | `53a1ff31` | PASS WITH FINDINGS |
| `2026-10-21-obj-m-wrong-recipient-transfer-rerun2.md` | OBJ-M | `53a1ff31` | PASS WITH FINDINGS |
| `2026-10-21-obj-i-handoff-failure-rerun.md` | OBJ-I | `8dab1ac6` | PASS WITH FINDINGS |
| `2026-10-21-obj-c-mirta-refund-rerun3.md` | OBJ-C | `8dab1ac6` | PASS WITH FINDINGS |
| `2026-10-21-obj-d-silvia-transfer-rerun3.md` | OBJ-D | `8dab1ac6` | FAIL |
| `2026-10-21-obj-m-wrong-recipient-transfer-rerun3.md` | OBJ-M | `8dab1ac6` | PASS WITH FINDINGS |
| `2026-10-21-obj-f-persistent-guest.md` | OBJ-F | `8dab1ac6` | FAIL |
| `2026-10-21-obj-f-persistent-guest-rerun.md` | OBJ-F | `ae0514d6` | PASS WITH FINDINGS |
| `2026-10-21-obj-o-repeatability-obj-c-runs.md` | OBJ-O (OBJ-C half) | `8dab1ac6` | PASS WITH FINDINGS |
| `2026-10-21-obj-j-happy-path.md` | OBJ-J | `8dab1ac6` | PASS |
| `2026-10-21-obj-k-notification-question.md` | OBJ-K | `8dab1ac6` | FAIL |
| `2026-10-21-obj-l-brevity.md` | OBJ-L | `8dab1ac6` | PASS WITH FINDINGS |
| `2026-10-21-obj-n-de-escalation.md` | OBJ-N | `8dab1ac6` | FAIL |
| `2026-10-21-obj-g-correction.md` | OBJ-G | `8dab1ac6` | PASS |

The artifacts, in order: `df72d58f` (the reply contracts), `53a1ff31` (the
first next-step rule), `8dab1ac6` (the customer-anchored next step, the
truthful handoff outcomes), `805d56b1` (the dead-key fix, the no-derivation
rule, the escalation frame order, the not-retried handoff values), `ae0514d6`
(the offer-as-question rule and the capability-blocked backstop) and
`ec20056c` (the legacy-plan load fix).

Two ledgers name an artifact that is no longer the deployed one. The OBJ-F
re-run names `ae0514d6`, the artifact deployed when that lane started;
`ec20056c` differs from it only by an inner schema default that lets a plan
stored before the new field load, which cannot change a fresh conversation.
The deployed artifact was re-validated anyway: four targeted live cases
passed and a two-turn check of the loop shape produced the same replies.

A FAIL is a defect report, not a score: it names the phrase, the harm and
the turn, and it says whether the disposition is open or fixed.
