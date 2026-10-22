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
| `2026-10-21-obj-c-mirta-refund-rerun2.md` | OBJ-C | `53a1ff31` | PASS WITH FINDINGS |
| `2026-10-21-obj-d-silvia-transfer-rerun2.md` | OBJ-D | `53a1ff31` | PASS WITH FINDINGS |
| `2026-10-21-obj-m-wrong-recipient-transfer-rerun2.md` | OBJ-M | `53a1ff31` | PASS WITH FINDINGS |
| `2026-10-21-obj-h-post-handoff-new-question.md` | OBJ-H | `df72d58f` | FAIL |
| `2026-10-21-obj-i-handoff-failure.md` | OBJ-I | `df72d58f` | FAIL |
| `2026-10-21-obj-o-repeatability.md` | OBJ-O (OBJ-E half) | `df72d58f` | PASS |
