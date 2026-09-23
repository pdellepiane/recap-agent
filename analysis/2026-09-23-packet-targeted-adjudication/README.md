# Targeted-panel adjudication dossier — 2026-09-23

## Provenance

- Runs (newest last): `eval-2026-09-23T02-50-13-317Z-d9b6e8e8` (baseline 4/8/0,
  bytes `a781ba47`, source `066725bb`), `eval-2026-09-23T03-41-25-183Z-2cc5a932`
  (5/7/0, bytes `51b2d9c0`, source `5fd1d735`), `eval-2026-09-23T03-51-07-656Z-091ebc82`
  (6/6/0, bytes `c1d54c84`, source `ed52382d`), `eval-2026-09-23T03-55-56-624Z-e06305d2`
  (2/10/0, bytes `578fd0d9`, source `4465ecf5`).
- This dossier adjudicates the `e06305d2` failures (10) from their own traces.
  Artifacts: `.eval-runs/<runId>/artifacts/live_lambda/live_behavior.<case>.json`
  plus `report.json` / `manifest.json` (artifact verified-aws, dirty flag from
  preserved unrelated files only).
- Models: reply/extraction/classification `gpt-6-luna`; judge `gpt-5.6-luna`.
- Scores across runs are NOT combined; old artifacts were never rescored.

## Findings by case (e06305d2)

### Structural fixes holding (failures are phrasing-level)

- `gift_mixed_order_distinguishes_items`: T0 finds the gift via discovery,
  separates physical vs credit, states host choice, invents no dispatch date.
  Judge wants a more explicit no-shipment-because-credit sentence. Real
  behavior correct; rubric literalism. Discovery-default fix holds.
- `image_url_receipt_payment_thread`: `image_url_context` tool pin now PASSES
  (genuine output record added). Remaining semantic fail is literalism
  ("comprobante no confirma" vs required "imagen no puede confirmar").
- `rsvp_ambiguous_event_requires_grounded_selection`: zero-write receipt,
  state, and no-mutation evidence pass. Remaining fail is date-year omission
  ("12 de septiembre" without 2026). Model verbosity variance.
- `customer_event_task_continuity`: T0/T1 complete and correct; T2 omits the
  date (time only). Long-standing stable case; this run's T2 is terse.
  Variance, not a code defect (no related source change).

### Pre-existing underanswer (evidence correct, model terse)

- `pending_balance_validation_luis` T0, `owner_customer_payment_relevance` T0:
  reply says only pending despite purchase_balance carrying total 227.76,
  paid-unknown, and method (verified in trace purchaseFact). T1 turns are
  clean (pending + 72h window, no invented currency, no paid claim) after
  the recitation-requirement revert. Underanswer is stable across all four
  runs; explicit recitation requirements were tried and reverted after they
  caused T1 confabulation (invented S/, fabricated paid) in `091ebc82`.
- `gift_credit_pending_payment_stays_pending` T0: items + host-credit policy
  present in evidence with the gift module loaded; reply omits the mechanism.
  Same tried-and-reverted history as above.

### Model/judge variance (not code defects)

- `support_detail_continuity`: T1/T2 name Roger/Catalina exactly (naming fix
  holds) but re-ask the country question. Passed `091ebc82`, fails otherwise.
  Re-ask flip-flops by run.
- `concurrent_support_turns_preserve_context`: T1 names both refs (fix holds)
  but re-asks currency; T0 answer shape varies by run (email ask / currency
  ask / clean). Fails differently each run.
- `image_readable_captionless` T0: amount included every run (fix holds) but
  pixels misread differently per run ($149.90, S/149.90, S/49.90). T1 reads
  correctly in all runs. Vision variance; exact-currency instruction cannot
  prevent misreads.

## Safety check

- No invented currency, fabricated paid, false success, wrong entity,
  unauthorized access, or duplicate effect in `e06305d2`. The one
  confabulation episode (`091ebc82` T1 turns) was reverted in source
  `2505876b` and is absent here.

## Rerun instructions

```bash
npm run eval:behavior-live -- --label packet-targeted-3 \
  --case live_behavior.pending_balance_validation_luis \
  --case live_behavior.gift_credit_pending_payment_stays_pending \
  --case live_behavior.gift_mixed_order_distinguishes_items \
  --case live_behavior.support_detail_continuity \
  --case live_behavior.concurrent_support_turns_preserve_context \
  --case live_behavior.image_readable_captionless \
  --case live_behavior.image_url_receipt_payment_thread \
  --case live_behavior.rsvp_ambiguous_event_requires_grounded_selection \
  --case live_behavior.owner_customer_payment_relevance \
  --case live_behavior.authentication_refusal_closes_protected_query \
  --case live_behavior.customer_event_task_continuity \
  --case live_behavior.s11_rsvp_durability_confirms_once
```

Requires dev Lambda on bytes `578fd0d9` (source `4465ecf5`), account
`684516060775`, and a judge key. Do not edit fixtures/rubrics after the run.
