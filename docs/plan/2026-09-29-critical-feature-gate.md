# Critical feature development gate — 2026-09-29

## Decision contract

Run this **selected** panel once against the exact final development artifact after typecheck, relevant offline tests, prompt relevance checks, and `tests/live-behavior-coverage.test.ts` pass. This is not the full live suite. Freeze the 28 case IDs below before invoking the paid runner. Use case concurrency 2 and judge concurrency 1; estimated spend is under US$0.12 from recent observed cases. Record the actual cost, artifact identity, run ID, delivered replies, hard effects, and judge evidence. No semantic retry or panel expansion is included in this instruction.

A release pass requires every case to pass its hard structural and semantic expectations, with manual inspection of the commission, RSVP write, payment-destination, and identity cases. A judge or oracle error may be adjudicated only against saved reply input, source records, and effect receipts; the formal result remains visible. Any real false commission amount, wrong invitation/order binding, unverified success claim, unauthorized disclosure, or missing required write blocks promotion. Production ingress for the actual Sinar message remains a separate verification item because the available logs cannot attribute the redacted 400 requests to her phone.

## Frozen selected cases

1. `live_behavior.faq_commission_full_article_citation`
2. `live_behavior.faq_commission_50_pen_no_unverified_arithmetic`
3. `live_behavior.rsvp_sinar_campaign_decline`
4. `live_behavior.rsvp_plus_one_not_eligible_no_false_success`
5. `live_behavior.rsvp_host_set_declining_consistent`
6. `live_behavior.rsvp_explicit_mutation_targets_requested_event`
7. `live_behavior.rsvp_ambiguous_event_requires_grounded_selection`
8. `live_behavior.rsvp_plus_one_multiple_events_requires_selection`
9. `live_behavior.rsvp_guest_and_plus_one_combined_saved`
10. `live_behavior.rsvp_unmatched_named_event_no_mutation`
11. `live_behavior.s11_rsvp_durability_confirms_once`
12. `live_behavior.rsvp_missing_event_identity_is_unavailable`
13. `live_behavior.customer_transaction_reference_matched`
14. `live_behavior.customer_transaction_reference_unavailable_multiple`
15. `live_behavior.purchase_current_pending_over_old_approved`
16. `live_behavior.payment_destination_requires_pending_purchase`
17. `live_behavior.phone_purchase_missing_hands_off_once`
18. `live_behavior.host_withdrawal_diana_policy_and_support`
19. `live_behavior.host_withdrawal_pending_event_followup`
20. `live_behavior.gift_credit_pending_payment_stays_pending`
21. `live_behavior.gift_credit_with_physical_card_distinguishes`
22. `live_behavior.image_unavailable_captioned`
23. `live_behavior.image_receipt_illegible_amount`
24. `live_behavior.support_detail_continuity`
25. `live_behavior.support_pending_question_completed`
26. `live_behavior.image_conversation_continuity`
27. `live_behavior.accountless_guest_event_uses_phone_without_otp`
28. `live_behavior.rsvp_plus_one_uses_phone_scoped_mutation`

The selected YAML cases all have a hard `text_semantic` expectation with `requireJudge: true`. Twenty-seven also have at least one hard structural assertion. The payment-destination case has a hard semantic disclosure boundary and non-hard route/tool diagnostics; its authorization boundary is judged from the delivered answer and inspected manually.
