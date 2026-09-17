# Profile inference disposition ledger (Packet E1)

Status: implementation ledger; no live acceptance claimed. September 15, 2026.
Directive: `profile-inference-directive-2026-09-15.md`. Checklist: `profile-inference-test-inventory-2026-09-15.json` (117 cases, review flags are candidates, not defects).
Machine-readable twin: `profile-inference-disposition-ledger.json` (528 current rows plus the 5 removed-and-replaced originals with replacement pointers, covering all 529). Count is discovered from the loaded catalog, never hardcoded.

Totals: 117 cases, 529 original expectations (528 current: 5 removed-and-replaced, 4 added as replacements). Current dispositions: retain 504, revise 12, replace 12; every original is accounted for below (current rows plus the removed list, each with a replacement pointer).

## Disposition rules (applied per expectation, overrides win)

- retain: authorization guards (tool_usage mustNotCall auth/write), effect count/identity (fixture_effect_count, receipt-backed plan subsets), provenance (tool/trace facts), output-origin gates, truthful-silence routes, factual-consistency bans (text_not_contains), lane-routing node_transition pins (documented runtime invariant, routing is runtime-owned), typed state invariants (plan_field_equals except attempt counters).
- revise: hard semantic rubrics that need inference-tolerant wording (grounded inference + useful extra detail pass; missing topics, unsupported certainty, unrelated dumps, unnecessary clarification fail); semantic checks missing requireJudge:true; S07 complete-utterance + zero-write authority; host-declining distinguishable evidence; delayed-image judge-only ground truth; date-format tolerance wherever dates distinguish candidates.
- replace: node/counter pins (selection_attempts, failed_code_attempts) with outcome/continuation checks; literal text_contains word-list/date-format pins with semantic outcome checks. Literal tests remain only for genuinely forbidden secrets/identifiers.

## Implemented replacements and revisions (this packet)

- `live_behavior.rsvp_ambiguous_event_requires_grounded_selection` v3->v4: counter `records-one-ambiguous-attempt` replaced by turn-1 continuation proof; literal `projection-carries-candidate-dates` folded into a format-tolerant semantic rubric; turn-0 expectations scoped with turnIndex 0 (unscoped expectations read the last turn).
- `live_behavior.repeated_otp_failure_preserves_gift_query` v2->v3: counter `single-failure-is-recorded` removed; receipt-based handoff.write counts carry the outcome. Old runs preserved (R05).
- `live_behavior.s07_attending_identical_no_write` v1->v2: complete-utterance + zero-write-authoritative rubric; confirmation wording describes existing state; date formats may vary; threshold kept at 0.9. Old runs preserved (R05).
- `live_behavior.rsvp_host_set_declining_consistent` v3->v4 + fixture fix: records now distinguishable (distinct datetimes); rubric accepts direct identified-guest report or one bounded distinguishing question; no guessed mutation. Old runs preserved (R05).
- New `live_behavior.rsvp_host_set_declining_unique_guest` (fixture `rsvp-host-declining-unique`): single authorized guest, host-set declining with hasResponded=false, read-only proof. Never requires hasResponded=true.
- New fixture `rsvp-same-event-cross-guest.json`: same-event IDs with explicit guest bindings for the cross-guest enrichment regression (separate from the declining tests).
- `live_behavior.image_file_delayed_question` v2->v3 and `live_behavior.image_readable_captionless` v3->v4: judge-only manually verified ground truth bound to fixture image digests (e6024548 Monto S/ 250.00; c3bed1bc comprobante S/ 149.90) via the judge-context pathway; never runtime input. Read-only amount is not backend approval.
- `live_behavior.wedding_planner_location_completes_search` v1->v2: two literal anyOf pins replaced by one semantic outcome check.
- Runner: global judge rules extended (accept grounded inference + useful extra detail; fail missing topics / unsupported certainty / unrelated dumps / unnecessary clarification); `resolveJudgeOnlyImageGroundTruth` supplies digest-bound ground truth to judges only. Case schema gains optional `judgeGroundTruth` (judge-only, never loaded into runtime input).
- 2026-09-16 evaluator-owned audit fixes (7 pins revised, no replacements): `live_behavior.image_conversation_continuity` v3->v4 binds the same E1 digest mechanism (turn-0 bytes byte-identical to the delayed-question fixture, e6024548..., verified read-only); `live_feedback.token_seeded_contact_correction` v1->v2 scopes both semantic contact-info clauses so a close-flow event-date request stays admissible (seed carries no event date; selection-defer-close EX1 v2 precedent); `live_behavior.rsvp_missing_action_requires_explicit_decision` v4->v5 and `live_behavior.rsvp_declined_state_offers_one_change` v5->v6 revise the retired awaiting_action/attending staging pins to the P2 read-only contract (none/null). All keep hard severity, requireJudge, and thresholds; seeds keep the retired staged shape as the incoming boundary. Old runs preserved (R05).
- 2026-09-16 customer-support release E1/E2 ledger repair (12 rows): node_transition pins already replaced in YAML by receipt-backed fixture_effect_count checks (accountless guest event, accountless pre-auth, owner payment, Luis, explicit-time, Martha-adjacent maria-jose current-order, image-url-unavailable, cinthya, jose, host-declining-consistent, missing-action) and one trace_field_equals pin replaced by a semantic judge (Diana later-event-message) now carry disposition replace with the conversion rationale; Diana gains the added turn-2 `one-handoff-effect-in-thread` receipt row (handoff.write 0/0/0, reused success never a new effect). Old runs preserved (R05).
- Coverage registry: new entries registered separately per behavior change (unique-guest declining, ambiguous-identity declining, continuation-proof ambiguity, judge-only image truth, S07 complete-utterance, counter removals, literal-pin replacements).

## Removed expectations (replaced, all 5 originals accounted for)

- [replace] `live_behavior.repeated_otp_failure_preserves_gift_query` / `single-failure-is-recorded` (plan_field_equals): Counter pin removed in v3; outcome carried by receipt-based handoff.write counts plus the turn-0 semantic judge. Replaced by: `turn0-handoff-effect`, `final-handoff-effect-unchanged`, `turn0-auth-episode-ended-handoff-confirmed`.
- [replace] `live_behavior.rsvp_ambiguous_event_requires_grounded_selection` / `records-one-ambiguous-attempt` (plan_field_equals): Counter pin removed in v4; replaced by the turn-1 continuation proof (clarification answerable, state survives). Replaced by: `continuation-answers-on-chosen-candidate`, `continuation-needs-no-reauth`.
- [replace] `live_behavior.rsvp_ambiguous_event_requires_grounded_selection` / `projection-carries-candidate-dates` (text_contains): Literal date-format pin removed in v4 and folded into the format-tolerant semantic rubric. Replaced by: `asks-which-persisted-event`.
- [replace] `live_behavior.wedding_planner_location_completes_search` / `explicit-need-asks-location` (text_contains): Literal word-list pin removed in v2; replaced by a semantic outcome check. Replaced by: `explicit-need-asks-missing-context`.
- [replace] `live_behavior.wedding_planner_location_completes_search` / `explicit-need-asks-scale-or-budget-in-same-turn` (text_contains): Literal word-list pin removed in v2; replaced by the same semantic outcome check. Replaced by: `explicit-need-asks-missing-context`.

## Full per-case ledger

### live_behavior.abandoned_cart_only_sonia (`live-behavior-abandoned-cart-sonia.yaml`, v1)

- [retain] `abandoned-cart-enters-information` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `abandoned-cart-uses-phone-partitions` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `abandoned-cart-recognized` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `no-purchase-not-found` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `no-correo-channel-claim` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.accountless_event_answer_precedes_remaining_private_auth (`live-behavior-accountless-event-before-private-auth.yaml`, v3)

- [replace] `routes-to-information` (fixture_effect_count, 2026-09-16 E2: implementation pin replaced; hard): Receipt-backed invariant replacing the retired implementation pin; old runs preserved.
- [retain] `reads-and-reuses-phone-enriched-event` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `keeps-email-auth-ready-for-the-private-query` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `answers-event-and-reuses-scoped-purchase` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `summary-excludes-payment-type` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.accountless_guest_event_uses_phone_without_otp (`live-behavior-accountless-guest-event.yaml`, v2)

- [replace] `routes-to-associated-event-information` (fixture_effect_count, 2026-09-16 E2: implementation pin replaced; hard): Receipt-backed invariant replacing the retired implementation pin; old runs preserved.
- [retain] `uses-phone-enriched-event-context-directly` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `leaves-no-authentication-request-pending` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `answers-from-the-invited-event-without-otp` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.active_cart_checkout_continuity_alex (`live-behavior-active-cart-checkout-alex.yaml`, v1)

- [retain] `active-cart-stays-information` (node_transition, hard turn=0): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `active-cart-uses-phone-partitions` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `active-cart-continuity-stays-information` (node_transition, hard turn=1): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `active-cart-not-flattened` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.ambiguous_confirmation_adversarial_selection (`live-behavior-ambiguous-confirmation-adversarial.yaml`, v2)

- [retain] `adversarial-clarifies-without-choosing` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `adversarial-no-selection-persisted` (plan_field_subset, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `adversarial-no-provider-effects-or-close` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `adversarial-ambiguity-response-is-a-focused-clarification` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.ambiguous_confirmation_clarifies (`live-behavior-ambiguous-confirmation.yaml`, v1)

- [retain] `ambiguous-clarifies-without-choosing` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `no-provider-selected-without-reference` (plan_field_subset, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `shortlist-ids-unchanged-no-selection` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `no-search-on-ambiguous-confirmation` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `ambiguity-response-is-a-focused-clarification` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.authentication_refusal_closes_protected_query (`live-behavior-auth-refusal-closes-query.yaml`, v1)

- [retain] `refusal-returns-to-resume-node` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `refusal-does-not-call-authentication-or-handoff` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `protected-request-is-cleared` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `refusal-is-respected` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.concurrent_support_turns_preserve_context (`live-behavior-concurrent-support-turns.yaml`, v1)

- [retain] `first-support-question` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `second-turn-actually-contended` (trace_field_number, hard turn=1): Numeric trace invariant (not a conversational counter); kept as a documented runtime invariant.
- [retain] `second-turn-remains-support` (node_transition, hard turn=1): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `second-turn-loads-first-turn-plan` (trace_field_equals, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `support-detail-acknowledgment-does-not-call-backend` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `support-detail-acknowledgment-lightweight-route` (trace_field_equals, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay). Renamed 2026-09-17 from `support-detail-acknowledgment-is-deterministic` (old name prescribed implementation); structural check unchanged.
- [retain] `no-restart-or-identity-overwrite-after-overlap` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.continuity_question_needs_image (`live-behavior-continuity-question-needs-image.yaml`, v2)

- [retain] `needs-image-first-turn-no-tools` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `needs-image-first-turn-clarifies` (text_semantic, hard requireJudge=True turn=0): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `needs-image-second-turn-projected` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `needs-image-second-turn-no-resend` (text_not_contains, hard turn=1): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `needs-image-second-turn-answers-pending` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.continuity_text_image_same_turn (`live-behavior-continuity-text-image-same-turn.yaml`, v2)

- [retain] `same-turn-image-persisted-and-projected` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `same-turn-no-resend-request` (text_not_contains, hard turn=0): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `same-turn-answer-uses-both` (text_semantic, hard requireJudge=True turn=0): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.continuity_voucher_then_thanks (`live-behavior-continuity-voucher-then-thanks.yaml`, v3)

- [retain] `voucher-receipt-projected` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `voucher-receipt-no-approval` (text_not_contains, hard turn=0): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `voucher-receipt-brief-and-honest` (text_semantic, hard requireJudge=True turn=0): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `thanks-adds-no-payment-effect` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `thanks-no-repeated-explanation` (text_not_contains, hard turn=1): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.current_campaign_order_over_historical_declined_maria_jose (`live-behavior-current-campaign-order-maria-jose.yaml`, v2)

- [replace] `current-order-enters-information` (fixture_effect_count, 2026-09-16 E2: implementation pin replaced; hard turn=0): Receipt-backed invariant replacing the retired implementation pin; old runs preserved.
- [retain] `current-order-uses-phone-partitions` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `current-pending-suppresses-historical-declined` (text_semantic, hard requireJudge=True turn=0): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `shortfall-remains-pending` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.customer_transaction_code_by_phone (`live-behavior-customer-transaction-code-by-phone.yaml`, v3)

- [retain] `transaction-code-enters-information` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `transaction-code-uses-phone-orders` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `transaction-code-unavailable-unique-grounded` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.customer_transaction_reference_matched (`live-behavior-customer-transaction-reference-matched.yaml`, v1)

- [retain] `matched-enters-information` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `matched-uses-phone-orders` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `matched-answers-alias-a` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.customer_transaction_reference_unavailable_multiple (`live-behavior-customer-transaction-reference-unavailable-multiple.yaml`, v3)

- [retain] `multiple-enters-information` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `multiple-uses-phone-orders-without-write` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `multiple-asks-grounded-selection` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.event_context_long_thread (`live-behavior-event-context-long-thread.yaml`, v1)

- [retain] `read-only-0` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `context-0` (text_semantic, hard requireJudge=True turn=0): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `read-only-1` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `context-1` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `read-only-2` (tool_usage, hard turn=2): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `context-2` (text_semantic, hard requireJudge=True turn=2): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `read-only-3` (tool_usage, hard turn=3): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `context-3` (text_semantic, hard requireJudge=True turn=3): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.host_support_allows_explicit_rsvp_switch (`live-behavior-host-support-explicit-rsvp-switch.yaml`, v1)

- [retain] `explicit-switch-enters-rsvp` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `explicit-state-query-is-read-only` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `current-request-not-old-pending-topic` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `read-only-query-does-not-stage-a-future-mutation` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.

### live_behavior.host_withdrawal_diana_policy_and_support (`live-behavior-host-withdrawal-diana.yaml`, v1)

- [retain] `role-correction-is-not-a-buyer-lookup` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `acknowledges-role-without-generic-reset` (text_semantic, hard requireJudge=True turn=0): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `policy-and-human-support-without-unrelated-api-work` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `withdrawal-topic-retained` (plan_field_subset, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `supported-policy-not-invented-withdrawal-status` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `handoff-is-persisted` (plan_field_equals, hard turn=1): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [replace] `later-event-message-stays-with-human-team` (text_semantic, 2026-09-16 E2: implementation pin replaced; hard turn=2): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `no-repeated-takeover-or-rsvp` (tool_usage, hard turn=2): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `one-handoff-effect-in-thread` (fixture_effect_count, hard turn=2, 2026-09-16 E1 v3): repeated takeover forbidden via authoritative per-turn effect receipts (handoff.write 0/0/0 at turn 2); a reused turn-1 success receipt never counts as a new effect. Read-only policy lookup remains permitted.: Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).

### live_behavior.host_withdrawal_pending_event_followup (`live-behavior-host-withdrawal-event-followup.yaml`, v1)

- [retain] `event-name-continues-withdrawal-support` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `event-anchor-preserved` (plan_field_subset, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `pending-topic-not-invitations` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.host_withdrawal_general_policy_only (`live-behavior-host-withdrawal-general.yaml`, v1)

- [retain] `only-general-policy-work` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `no-handoff-required` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `sourced-general-window` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.image_captioned_preserved (`live-behavior-image-captioned.yaml`, v3)

- [retain] `captioned-image-native-persisted` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `caption-answered-in-spanish` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.image_conversation_continuity (`live-behavior-image-conversation-continuity.yaml`, v4)

- [retain] `continuity-silent-persist-native` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `continuity-silent-persist-reason` (trace_field_equals, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `continuity-no-resend-request` (text_not_contains, hard turn=1): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `continuity-retained-image-answered` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). 2026-09-16 revise: rubric now references the E1 judge-only manually verified ground truth (Monto S/ 250.00) bound to the fixture image digest e6024548... via the judge-context pathway; never runtime input. Threshold 0.8 kept. Case v3->v4.

### live_behavior.image_conversation_repeat_answered (`live-behavior-image-conversation-repeat-answered.yaml`, v1)

- [retain] `repeat-first-turn-native-persisted` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `repeat-first-turn-answered-in-spanish` (text_semantic, hard requireJudge=True turn=0): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `repeat-no-resend-request` (text_not_contains, hard turn=1): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `repeat-answered-amount-from-history` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.image_distractor_history_preserves_current_question (`live-behavior-image-distractor-history-preserves-current-question.yaml`, v1)

- [retain] `distractor-image-silent-persist-no-inspect` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `distractor-image-silent-persist-reason` (trace_field_equals, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `distractor-question-no-campaign-leak` (text_not_contains, hard turn=1): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `distractor-question-no-resend-or-backend-claim` (text_not_contains, hard turn=1): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `distractor-question-no-backend-mutation` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `distractor-current-question-answered-from-image` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.image_expired_reference_resubmit (`live-behavior-image-expired-reference.yaml`, v6)

- [retain] `expired-no-inspect-no-write` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `expired-no-invented-content` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `expired-answers-from-evidence-or-asks-fact` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.image_file_captioned_persisted (`live-behavior-image-file-captioned.yaml`, v2)

- [retain] `file-image-uploads-and-projects` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `file-image-reply-has-no-bytes-or-id` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `file-image-caption-answered` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.image_file_delayed_question (`live-behavior-image-file-delayed-question.yaml`, v3)

- [retain] `file-image-first-turn-persists` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `file-image-first-turn-silent-persist-reason` (trace_field_equals, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `file-image-delayed-no-resend` (text_not_contains, hard turn=1): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [revise] `file-image-delayed-answered-from-pixels` (text_semantic, hard requireJudge=True turn=1): Rubric now references judge-only manually verified ground truth (Monto S/ 250.00) bound to the fixture image digest e6024548...; ground truth rides the judge context only, never runtime input. Read-only amount is not backend approval. Case v2->v3.

### live_behavior.image_file_explicit_describe (`live-behavior-image-file-explicit-describe.yaml`, v2)

- [retain] `file-image-describe-uses-owner-path` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `file-image-describe-no-ids` (text_not_contains, hard turn=0): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `file-image-describe-answered` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.image_file_malformed_unavailable (`live-behavior-image-file-malformed.yaml`, v6)

- [retain] `file-image-malformed-no-inspect-no-effect` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `file-image-malformed-answered-in-spanish` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.image_file_unrelated_omits_pixels (`live-behavior-image-file-unrelated.yaml`, v2)

- [retain] `file-image-first-turn-persists` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `file-image-unrelated-no-visual-content` (text_not_contains, hard turn=1): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `file-image-unrelated-answered-without-pixels` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.image_multiple_pending_orders_no_select (`live-behavior-image-multiple-pending-orders.yaml`, v2)

- [retain] `multi-order-image-uses-owner-path` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `multi-order-image-no-approval` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `multi-order-image-no-auto-select` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.image_non_receipt_payment_claim (`live-behavior-image-non-receipt-payment-claim.yaml`, v2)

- [retain] `non-receipt-uses-owner-path` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `non-receipt-no-approval-or-effect` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `non-receipt-no-payment-proof` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `non-receipt-not-treated-as-proof` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.image_readable_captionless (`live-behavior-image-readable-captionless.yaml`, v4)

- [retain] `image-silent-persist-no-inspect` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `image-silent-persist-reason` (trace_field_equals, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `image-silent-no-bytes-or-id` (text_not_contains, hard turn=1): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [revise] `image-delayed-question-answered` (text_semantic, hard requireJudge=True turn=1): Rubric now references judge-only manually verified ground truth (COMPROBANTE DE PAGO, Tienda Demo, Monto S/ 149.90, Fecha 05/09/2026, Operacion 884211) bound to the fixture image digest c3bed1bc...; judge context only. Case v3->v4.

### live_behavior.image_receipt_ambiguous_digits (`live-behavior-image-receipt-ambiguous-digits.yaml`, v2)

- [retain] `ambiguous-uses-owner-path` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `ambiguous-no-approval-or-bytes` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `ambiguous-digits-not-confirmed` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.image_receipt_illegible_amount (`live-behavior-image-receipt-illegible-amount.yaml`, v2)

- [retain] `illegible-uses-owner-path` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `illegible-no-approval-or-bytes` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `illegible-amount-stays-unknown` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.image_too_large_fallback (`live-behavior-image-too-large.yaml`, v4)

- [retain] `too-large-no-effect-no-leak` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `too-large-no-inspection-claim` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `too-large-guidance-in-spanish` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.image_unavailable_captioned (`live-behavior-image-unavailable-captioned.yaml`, v4)

- [retain] `unavailable-caption-no-effect` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `unavailable-caption-answered-plus-recovery` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.image_url_describe_dice (`live-behavior-image-url-describe.yaml`, v4)

- [retain] `url-image-uses-native-context` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `url-image-reply-has-no-link` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `url-image-dice-described` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.image_url_receipt_payment_thread (`live-behavior-image-url-receipt-payment.yaml`, v2)

- [retain] `receipt-url-uses-native-context` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `receipt-url-supports-without-proof` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `thanks-does-not-restart-explanation` (text_semantic, hard requireJudge=True turn=2): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.image_url_unavailable_evidence (`live-behavior-image-url-unavailable.yaml`, v3)

- [retain] `expired-url-uses-native-context` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [replace] `expired-url-stays-informative` (fixture_effect_count, 2026-09-16 E2: implementation pin replaced; hard): Receipt-backed invariant replacing the retired implementation pin; old runs preserved.
- [retain] `expired-url-no-link-leak` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `expired-url-unavailable-not-proof` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.jose_campaign_greeting_then_acknowledgement (`live-behavior-jose-campaign-acknowledgement.yaml`, v1)

- [retain] `acknowledgement-performs-no-provider-or-rsvp-effect` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `acknowledgement-uses-no-rsvp-vocabulary` (text_not_contains, hard turn=1): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `acknowledgement-closes-without-repeated-welcome-or-interview` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.mailbox_issue_deferral_and_clarification_preserve_support (`live-behavior-mailbox-continuity-maria-isabel.yaml`, v1)

- [retain] `greeting-allows-brief-context-without-plan` (text_semantic, hard requireJudge=True turn=0): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `report-enters-support` (node_transition, hard turn=1): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `report-no-takeover-no-otp-no-purchase-faq` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `deferral-does-not-fetch-or-authenticate` (tool_usage, hard turn=2): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `clarification-no-takeover-no-otp-no-purchase-faq` (tool_usage, hard turn=3): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `mailbox-never-requests-handoff` (plan_field_equals, hard turn=3): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `clarification-stays-in-support` (node_transition, hard turn=3): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `acknowledge-mailbox-not-welcome` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `acknowledge-deferral-without-inventing-referent` (text_semantic, hard requireJudge=True turn=2): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `understand-full-mailbox-clarification` (text_semantic, hard requireJudge=True turn=3): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.maria_paz_current_reminder_explanation (`live-behavior-maria-paz-reminder-explanation.yaml`, v1)

- [retain] `reminder-explanation-performs-no-rsvp-write` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `reminder-explanation-preserves-literal-title` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `reminder-explanation-uses-no-rsvp-vocabulary` (text_not_contains, hard turn=1): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.native_image_long_thread (`live-behavior-native-image-long-thread.yaml`, v1)

- [retain] `image-arrival-silent` (trace_field_equals, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `no-unsolicited-effects-0` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `no-unsolicited-effects-1` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `no-unsolicited-effects-2` (tool_usage, hard turn=2): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `no-unsolicited-effects-3` (tool_usage, hard turn=3): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `no-unsolicited-effects-4` (tool_usage, hard turn=4): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `no-unsolicited-effects-5` (tool_usage, hard turn=5): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `contextual-response-2` (text_semantic, hard requireJudge=True turn=2): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `contextual-response-3` (text_semantic, hard requireJudge=True turn=3): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `contextual-response-4` (text_semantic, hard requireJudge=True turn=4): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `contextual-response-5` (text_semantic, hard requireJudge=True turn=5): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.nonphysical_purchase_omits_shipping (`live-behavior-nonphysical-purchase-omits-shipping.yaml`, v1)

- [retain] `enters-information-flow` (node_transition, None): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `does-not-use-provider-tools` (tool_usage, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `nonphysical-purchase-has-no-shipping-claim` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `tokens-present` (token_usage_present, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).

### live_behavior.otp_nondelivery_auto_resends_once (`live-behavior-otp-auto-resend-once.yaml`, v2)

- [retain] `first-nondelivery-enters-human-handoff` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `first-nondelivery-hands-off-without-another-code-operation` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `handoff-is-persisted` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `protected-query-remains-pending-after-handoff` (plan_field_subset, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `first-nondelivery-handoff-language-has-no-resend-loop` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `nondelivery-handoff-effect` (fixture_effect_count, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).

### live_behavior.otp_not_received_requires_response (`live-behavior-otp-not-received.yaml`, v2)

- [retain] `enters-human-handoff` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `challenge-and-question-remain-pending` (plan_field_subset, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `missing-code-report-hands-off-without-another-code-operation` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `handoff-is-persisted` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `ends-code-delivery-loop` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `exhausted-handoff-effect` (fixture_effect_count, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).

### live_behavior.otp_number_words_are_verified (`live-behavior-otp-number-words.yaml`, v1)

- [retain] `word-code-is-submitted` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `word-code-is-not-rejected-for-format` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `word-code-receives-correct-outcome` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.otp_sent_explains_image_limitation (`live-behavior-otp-sent-image-guidance.yaml`, v2)

- [retain] `requests-email-code-without-phone-lookup` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `code-challenge-persists` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `post-send-image-guidance` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.otp_terminal_handoff_failed (`live-behavior-otp-terminal-handoff-failed.yaml`, v1)

- [retain] `failed-handoff-is-not-requested` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `failed-handoff-no-verify-after-turn0` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `failed-handoff-no-effect-after-turn0` (tool_usage, hard turn=2): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `failed-handoff-effect-turn0` (fixture_effect_count, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `failed-handoff-effect-final-unchanged` (fixture_effect_count, hard turn=2): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `failed-handoff-truthful-turn0` (text_semantic, hard requireJudge=True turn=0): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `failed-handoff-truthful-turn1` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `failed-handoff-truthful-turn2` (text_semantic, hard requireJudge=True turn=2): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.otp_terminal_handoff_unavailable (`live-behavior-otp-terminal-handoff-unavailable.yaml`, v1)

- [retain] `unavailable-handoff-is-not-requested` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `unavailable-handoff-no-takeover-dispatch` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `unavailable-handoff-no-effect-turn1` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `unavailable-handoff-effect-none` (fixture_effect_count, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `unavailable-handoff-truthful-turn0` (text_semantic, hard requireJudge=True turn=0): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `unavailable-handoff-truthful-turn1` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.otp_terminal_handoff_unknown (`live-behavior-otp-terminal-handoff-unknown.yaml`, v2)

- [retain] `unknown-handoff-is-not-requested` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `unknown-handoff-no-verify-after-turn0` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `unknown-handoff-no-effect-after-turn0` (tool_usage, hard turn=2): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `unknown-handoff-effect-turn0` (fixture_effect_count, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `unknown-handoff-effect-final-unchanged` (fixture_effect_count, hard turn=2): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `unknown-handoff-truthful-turn0` (text_semantic, hard requireJudge=True turn=0): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `unknown-handoff-truthful-turn1` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `unknown-handoff-truthful-turn2` (text_semantic, hard requireJudge=True turn=2): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.otp_terminal_missing_trusted_phone (`live-behavior-otp-terminal-missing-trusted-phone.yaml`, v1)

- [retain] `missing-phone-handoff-is-not-requested` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `missing-phone-no-takeover-dispatch` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `missing-phone-truthful-turn0` (text_semantic, hard requireJudge=True turn=0): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.owner_customer_payment_relevance (`live-behavior-owner-customer-payment-relevance.yaml`, v2)

- [replace] `payment-turn-enters-information` (fixture_effect_count, 2026-09-16 E2: implementation pin replaced; hard turn=0): Receipt-backed invariant replacing the retired implementation pin; old runs preserved.
- [retain] `payment-turn-uses-phone-orders` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `payment-turn-persists-customer-owner` (plan_field_equals, hard turn=0): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `payment-reply-excludes-cart` (text_not_contains, hard turn=0): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `payment-reply-answers-from-payment-evidence` (text_semantic, hard requireJudge=True turn=0): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `thanks-closes-without-restart` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.owner_planning_to_faq_single_transfer (`live-behavior-owner-planning-to-faq-transfer.yaml`, v2)

- [retain] `planning-turn-does-not-search-early` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `faq-turn-enters-information` (node_transition, hard turn=2): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `faq-turn-runs-no-provider-search` (tool_usage, hard turn=2): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `faq-turn-persists-faq-owner` (plan_field_equals, hard turn=2): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `faq-reply-answers-general-question` (text_semantic, hard requireJudge=True turn=2): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.payment_destination_requires_pending_purchase (`live-behavior-payment-destination-requires-pending.yaml`, v1)

- [retain] `enters-information-flow` (node_transition, None): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `does-not-use-provider-tools` (tool_usage, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `payment-destination-requires-pending-purchase` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `tokens-present` (token_usage_present, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).

### live_behavior.pending_balance_validation_luis (`live-behavior-pending-balance-luis.yaml`, v2)

- [replace] `pending-balance-enters-information` (fixture_effect_count, 2026-09-16 E2: implementation pin replaced; hard turn=0): Receipt-backed invariant replacing the retired implementation pin; old runs preserved.
- [retain] `pending-balance-uses-phone-partitions` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `balance-unknown-no-currency` (text_semantic, hard requireJudge=True turn=0): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `voucher-does-not-confirm` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.phone_account_rejection_requests_email (`live-behavior-phone-account-rejected.yaml`, v2)

- [retain] `rejected-phone-is-not-retried` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `phone-authentication-is-cleared` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `phone-token-is-cleared` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `phone-auth-method-is-cleared` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `protected-question-remains-pending` (plan_field_subset, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `requests-registered-email-after-rejection` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `identity-rejection-handoff-effect` (fixture_effect_count, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `seeded-token-absent-from-output` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.phone_confirmation_unclear_requires_yes_or_no (`live-behavior-phone-confirmation-unclear.yaml`, v2)

- [retain] `stale-confirmation-is-cleared` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `current-phone-event-context-is-read-directly` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `no-account-authentication-persists` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `does-not-repeat-retired-confirmation` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.phone_purchase_missing_hands_off_once (`live-behavior-phone-missing-information.yaml`, v1)

- [retain] `scoped-lookup-and-handoff` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `manual-help-requested` (plan_field_equals, hard turn=0): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `purchase-query-retained` (plan_field_subset, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `no-repeat-handoff-or-otp` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `scoped-missing-data-handoff-not-account-login` (text_semantic, hard requireJudge=True turn=0): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `scoped-lookup-not-found-outcome` (trace_field_subset, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `missing-purchase-handoff-effect` (fixture_effect_count, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).

### live_behavior.provider_reference_cheaper_option (`live-behavior-provider-reference-cheaper.yaml`, v1)

- [retain] `cheaper-provider-selected` (plan_field_subset, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `selection-operation-recorded` (trace_field_subset, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `no-new-provider-search` (tool_usage, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `cheaper-reference-response` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.provider_reference_miraflores_option (`live-behavior-provider-reference-miraflores.yaml`, v1)

- [retain] `miraflores-provider-selected` (plan_field_subset, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `location-selection-operation-recorded` (trace_field_subset, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `no-new-provider-search` (tool_usage, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `miraflores-reference-response` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.purchase_confirmation_carina_request_survives_normalization (`live-behavior-purchase-confirmation-carina.yaml`, v2)

- [retain] `ambiguous-request-clarifies-before-lookup` (trace_field_equals, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `ambiguous-request-does-not-choose-an-operation` (trace_field_equals, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `ambiguous-request-no-external-call` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `asks-one-status-or-document-question` (text_semantic, hard requireJudge=True turn=0): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `clarified-request-looks-up-current-order` (tool_usage, hard turn=2): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `answer-current-payment` (text_semantic, hard requireJudge=True turn=2): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `repeated-request-does-not-authorize-document-or-otp` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `repeated-request-retains-operation-ambiguity` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.purchase_currency_pen_symbol (`live-behavior-purchase-currency-pen.yaml`, v1)

- [retain] `currency-uses-phone-orders` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `currency-enters-information` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `currency-pen-no-inference` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.purchase_current_pending_over_old_approved (`live-behavior-purchase-current-vs-old.yaml`, v2)

- [retain] `current-purchase-enters-information` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `current-purchase-uses-phone-orders` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `current-pending-wins-over-old-approved` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.purchase_delia_status_by_phone (`live-behavior-purchase-delia-phone-orders.yaml`, v4)

- [retain] `delia-enters-information` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `delia-uses-order-summary-only` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `delia-approved-payment-is-reported` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.purchase_explicit_time_alternatives (`live-behavior-purchase-explicit-time.yaml`, v2)

- [replace] `explicit-time-enters-information` (fixture_effect_count, 2026-09-16 E2: implementation pin replaced; hard): Receipt-backed invariant replacing the retired implementation pin; old runs preserved.
- [retain] `explicit-time-uses-phone-orders` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `explicit-time-keeps-recorded-hour` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.purchase_joaquin_dedication_selection (`live-behavior-purchase-joaquin-dedication.yaml`, v2)

- [retain] `joaquin-enters-information` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `joaquin-uses-detailed-gift-read` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `joaquin-is-asked-to-select-one-purchase` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.purchase_kiara_pending_by_phone (`live-behavior-purchase-kiara-phone-orders.yaml`, v2)

- [retain] `kiara-enters-information` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `kiara-uses-order-summary-only` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `kiara-pending-status-is-reported` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.purchase_martha_accountless_selection (`live-behavior-purchase-martha-accountless.yaml`, v3)

- [retain] `martha-enters-information` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `martha-uses-phone-orders-without-auth` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `martha-is-given-purchase-selection` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.purchase_pending_transfer_continuity (`live-behavior-purchase-pending-transfer-continuity.yaml`, v1)

- [retain] `pending-transfer-stays-information` (node_transition, hard turn=0): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `pending-transfer-uses-phone-detail` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `pending-transfer-explains-window` (text_semantic, hard requireJudge=True turn=0): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `currency-correction-stays-information` (node_transition, hard turn=1): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `ambiguous-backend-time-does-not-reset` (node_transition, hard turn=2): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `currency-time-claims-remain-grounded` (text_semantic, hard requireJudge=True turn=2): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.repeated_otp_failure_preserves_gift_query (`live-behavior-repeated-otp-failure.yaml`, v3)

- [retain] `first-code-verified-once` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `second-code-never-verifies-nor-dispatches` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `prose-follow-up-does-not-reverify` (tool_usage, hard turn=2): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `first-failure-persists-human-handoff` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `gift-query-remains-pending` (plan_field_subset, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `no-copy-blame-or-email-loop-after-first-failure` (text_not_contains, hard turn=1): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `turn0-auth-episode-ended-handoff-confirmed` (text_semantic, hard requireJudge=True turn=0): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `turn0-handoff-effect` (fixture_effect_count, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `final-handoff-effect-unchanged` (fixture_effect_count, hard turn=2): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).

### live_behavior.reset_plan_discards_stored_context (`live-behavior-reset-plan.yaml`, v1)

- [retain] `reset-is-a-native-state-transition` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `reset-route-is-explicit` (trace_field_equals, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `fresh-plan-is-persisted` (trace_field_equals, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `old-event-is-cleared` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `old-location-is-cleared` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `old-contact-email-is-cleared` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `old-provider-needs-are-cleared` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `reset-does-not-search-or-close` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `reset-response-confirms-completed-state-and-continues` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.roberto_reminder_invitation_disagreement (`live-behavior-roberto-reminder-disagreement.yaml`, v1)

- [retain] `mismatch-reads-invitations-without-rsvp-write` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `mismatch-escalates-once-to-human` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `mismatch-reply-is-truthful-without-denial` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `mismatch-uses-no-rsvp-vocabulary` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `mismatch-attendance-unchanged` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `mismatch-handoff-requested` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `mismatch-handoff-effect` (fixture_effect_count, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).

### live_behavior.roberto_verified_unique_rsvp_writes_once (`live-behavior-roberto-verified-unique.yaml`, v2)

- [retain] `verified-unique-writes-rsvp-once` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `verified-unique-reports-verified-outcome` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `verified-unique-uses-no-rsvp-vocabulary` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `verified-attendance-clears-pending-flow` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `verified-attendance-one-effect` (fixture_effect_count, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).

### live_behavior.rsvp_ambiguous_event_requires_grounded_selection (`live-behavior-rsvp-ambiguous-event.yaml`, v4)

- [retain] `remains-in-rsvp-node` (node_transition, hard turn=0): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `preserves-event-selection-state` (plan_field_equals, hard turn=0): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `does-not-mutate-an-ungrounded-candidate` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [revise] `asks-which-persisted-event` (text_semantic, hard requireJudge=True turn=0): Rubric keeps required candidate dates (they distinguish candidates) but accepts any format; adds that useful extra grounded detail passes and re-asking after answer fails. Case v3->v4.
- [retain] `continuation-answers-on-chosen-candidate` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `continuation-needs-no-reauth` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `no-rsvp-vocabulary` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.rsvp_state_reversal_ends_confirmed (`live-behavior-rsvp-attendance-confirmed.yaml`, v3)

- [retain] `remains-in-rsvp-node` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `reads-authoritative-rsvp-state` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `reports-confirmed-final-state` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `no-rsvp-vocabulary` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.s07_attending_identical_no_write (`live-behavior-rsvp-attending-identical-no-write.yaml`, v2)

- [retain] `remains-in-rsvp-node` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `reports-without-another-mutation` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [revise] `reports-confirmed-without-new-registration` (text_semantic, hard requireJudge=True): Rubric now evaluates the complete utterance plus zero-write evidence: confirmation wording describes the existing state, never a new mutation; verified zero-write evidence outranks any phrase; date formats may vary. No threshold lowering (0.9 kept). Case v1->v2, R05 preserved.
- [retain] `no-rsvp-vocabulary` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.rsvp_cinthya_campaign_invitation_not_reported_missing (`live-behavior-rsvp-cinthya-campaign.yaml`, v6)

- [replace] `enters-rsvp-node` (fixture_effect_count, 2026-09-16 E2: implementation pin replaced; hard): Receipt-backed invariant replacing the retired implementation pin; old runs preserved.
- [retain] `reads-user-level-state-without-account-auth` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `preserves-campaign-grounded-invitation` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `no-rsvp-vocabulary` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.rsvp_confirmed_state_is_reported (`live-behavior-rsvp-confirmed-state.yaml`, v6)

- [retain] `remains-in-rsvp-node` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `reads-user-level-invitation-state` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `clears-completed-rsvp-state` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `reports-existing-confirmation-naturally` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `fragment-not-inverted` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `no-rsvp-vocabulary` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.rsvp_cristian_phone_enriched_confirmation (`live-behavior-rsvp-cristian-phone-enriched.yaml`, v6)

- [retain] `cristian-enters-rsvp` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `cristian-reconciles-both-phone-reads` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `cristian-existing-confirmation-is-reported` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `fragment-not-inverted` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `no-rsvp-vocabulary` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.rsvp_declined_state_offers_one_change (`live-behavior-rsvp-declined-state.yaml`, v6)

- [retain] `remains-in-rsvp-node` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `reads-state-without-premature-mutation` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [revise] `waits-for-one-change-confirmation` (plan_field_equals, hard): 2026-09-16 P2 read-only alignment (case v5->v6): retired awaiting_action staging pin revised to the P2 read-only contract value none (emptyRsvpState); seedPlan keeps the retired staged shape as the incoming boundary to prove normalization.
- [revise] `preserves-attending-change` (plan_field_equals, hard): 2026-09-16 P2 read-only alignment (case v5->v6): retired attending pending_action pin revised to the P2 read-only contract value null (emptyRsvpState).
- [retain] `reports-decline-and-offers-change` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `no-rsvp-vocabulary` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.rsvp_explicit_mutation_targets_requested_event (`live-behavior-rsvp-explicit-mutation-targets-requested-event.yaml`, v1)

- [retain] `turn0-reads-ana-without-write` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `turn0-answers-ana-facts` (text_semantic, hard requireJudge=True turn=0): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `turn1-writes-once-for-marta` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `turn1-single-marta-write-receipt` (fixture_effect_count, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `turn1-confirms-marta-entity-only` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.rsvp_host_set_declining_consistent (`live-behavior-rsvp-host-set-declining-consistent.yaml`, v4)

- [replace] `declining-enters-rsvp-node` (fixture_effect_count, 2026-09-16 E2: implementation pin replaced; hard): Receipt-backed invariant replacing the retired implementation pin; old runs preserved.
- [retain] `declining-query-performs-no-write` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [revise] `declining-reported-for-named-event` (text_semantic, hard requireJudge=True): Fixture corrected to distinguishable evidence (distinct datetimes per record); rubric accepts the identified-guest direct report or one bounded distinguishing question naming states/dates, never a guessed mutation, never asking the user to distinguish identical labels. Case v3->v4.
- [retain] `no-rsvp-vocabulary` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.rsvp_jose_campaign_invitation_not_reported_missing (`live-behavior-rsvp-jose-campaign.yaml`, v7)

- [replace] `enters-rsvp-node` (fixture_effect_count, 2026-09-16 E2: implementation pin replaced; hard): Receipt-backed invariant replacing the retired implementation pin; old runs preserved.
- [retain] `reads-user-level-state-without-account-auth` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `preserves-campaign-grounded-invitation` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `fragment-not-inverted` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `no-rsvp-vocabulary` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.rsvp_missing_action_requires_explicit_decision (`live-behavior-rsvp-missing-action.yaml`, v5)

- [replace] `enters-rsvp-node` (fixture_effect_count, 2026-09-16 E2: implementation pin replaced; hard): Receipt-backed invariant replacing the retired implementation pin; old runs preserved.
- [revise] `preserves-awaiting-action-state` (plan_field_equals, hard): 2026-09-16 P2 read-only alignment (case v4->v5): retired awaiting_action staging pin revised to the P2 read-only contract value none (emptyRsvpState); seedPlan keeps the retired staged shape as the incoming boundary to prove normalization.
- [revise] `preserves-attending-change` (plan_field_equals, hard): 2026-09-16 P2 read-only alignment (case v4->v5): retired attending pending_action pin revised to the P2 read-only contract value null (emptyRsvpState).
- [retain] `does-not-mutate-without-decision` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `asks-for-explicit-rsvp-decision` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `no-rsvp-vocabulary` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.rsvp_missing_event_identity_is_unavailable (`live-behavior-rsvp-missing-event-identity.yaml`, v1)

- [retain] `read-only-invitation-check` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `incomplete-evidence-is-not-no-invitation` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.rsvp_multi_person_offers_human_help (`live-behavior-rsvp-multi-person-human-help.yaml`, v11)

- [retain] `enters-rsvp-node` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `no-mutation` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `handoff-registered` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `multi-person-offers-human-help` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `no-overclaim-apply-confirmation` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `no-rsvp-vocabulary` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.rsvp_paolo_mariana_resolved_single (`live-behavior-rsvp-paolo-mariana-resolved-single.yaml`, v6)

- [retain] `enters-rsvp-node` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `projects-resolved-single-without-candidate-list` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `reports-already-resolved-invitation-for-named-event` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `no-rsvp-vocabulary` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.rsvp_guest_and_plus_one_combined_saved (`live-behavior-rsvp-plus-one-combined.yaml`, v1)

- [retain] `enters-rsvp-node` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `combined-mutation-single-call` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `combined-saved` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `no-raw-rsvp-fields` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.rsvp_plus_one_multiple_events_requires_selection (`live-behavior-rsvp-plus-one-multiple-events.yaml`, v1)

- [retain] `enters-rsvp-node` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `no-premature-mutation` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `requires-event-selection` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.rsvp_plus_one_not_eligible_no_false_success (`live-behavior-rsvp-plus-one-not-eligible.yaml`, v1)

- [retain] `enters-rsvp-node` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `phone-scoped-mutation-attempted` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `not-eligible-reported-honestly` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `no-false-success` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.rsvp_plus_one_uses_phone_scoped_mutation (`live-behavior-rsvp-plus-one.yaml`, v1)

- [retain] `enters-rsvp-node` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `phone-scoped-plus-one-mutation` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `saved-outcome-only` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `no-raw-rsvp-fields` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.rsvp_tia_niur_ambiguous_clarifies (`live-behavior-rsvp-tia-niur-ambiguous-clarifies.yaml`, v1)

- [retain] `ambiguous-enters-rsvp-node` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `ambiguous-performs-no-mutation` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `ambiguous-asks-bounded-selection` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.rsvp_tia_niur_old_target_wins (`live-behavior-rsvp-tia-niur-old-target-wins.yaml`, v1)

- [retain] `old-target-performs-no-mutation` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `explicit-old-target-wins-over-newer` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.rsvp_trusted_phone_reports_no_pending (`live-behavior-rsvp-trusted-phone.yaml`, v3)

- [retain] `enters-rsvp-node` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `reads-user-level-invitations-without-auth` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `records-rsvp-route` (trace_field_equals, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `reports-no-associated-invitation-outcome` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `no-rsvp-vocabulary` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.rsvp_unmatched_named_event_no_mutation (`live-behavior-rsvp-unmatched-named-event-no-mutation.yaml`, v1)

- [retain] `unmatched-names-no-mutation` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `unmatched-never-answers-another-event-as-beto` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.s01_frozen_kiara_pending_replay (`live-behavior-s01-frozen-world-identity.yaml`, v2)

- [retain] `s01-frozen-enters-information` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `s01-frozen-uses-order-summary-only` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `s01-frozen-pending-status-is-reported` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.s08_kiara_approved_replay (`live-behavior-s08-kiara-approved.yaml`, v5)

- [retain] `s08-approved-enters-information` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `s08-approved-uses-order-summary-only` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `s08-approved-status-is-reported` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.s11_rsvp_durability_confirms_once (`live-behavior-s11-rsvp-durability.yaml`, v3)

- [retain] `remains-in-rsvp-node` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `reads-authoritative-rsvp-state` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `exactly-one-rsvp-write-receipt` (fixture_effect_count, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `reports-confirmed-final-state-once` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `no-rsvp-vocabulary` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.s12_provider_completion_truthful_event_date (`live-behavior-s12-provider-completion.yaml`, v1)

- [retain] `submits-quotes-through-finish-plan` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `multi-need-selection-preserved` (plan_field_subset, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `confirms-per-provider-submission-with-explicit-date` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `no-rsvp-vocabulary` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.

### live_behavior.s2-failed-delivery-preserves-pending (`live-behavior-s2-failed-delivery-preserves-pending.yaml`, v1)

- [retain] `s2-first-turn-no-mutation` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `s2-retry-projects-image-once` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `s2-retry-no-resend-no-duplicate` (text_not_contains, hard turn=1): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `s2-preserved-then-answered` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.s3-stale-ref-silence-fails (`live-behavior-s3-stale-ref-silence-fails.yaml`, v3)

- [retain] `s3-stale-ref-no-false-persist-tools` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `s3-stale-ref-no-false-success` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `s3-stale-ref-surfaces-image-problem` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.s4-injected-renderer-prose-fails (`live-behavior-s4-injected-renderer-prose-fails.yaml`, v1)

- [retain] `s4-miraflores-card-selected` (plan_field_subset, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `s4-no-new-search-no-close` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `s4-genuine-card-correct` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.s5-generic-model-failure-not-image (`live-behavior-s5-generic-model-failure-not-image.yaml`, v1)

- [retain] `s5-captionless-persists` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `s5-answered-no-image-unavailable` (text_not_contains, hard turn=1): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `s5-usage-present` (token_usage_present, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `s5-answered-from-pixels` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.s7-ambiguous-orders-no-auto-select (`live-behavior-s7-ambiguous-orders-no-auto-select.yaml`, v1)

- [retain] `s7-ambiguous-no-effect-no-select` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `s7-ambiguous-no-approval-claim` (text_not_contains, hard): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `s7-ambiguous-clarifies-without-selecting` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.spanish_only_mixed_language_request (`live-behavior-spanish-only.yaml`, v2)

- [retain] `tokens-present` (token_usage_present, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `no-known-english-interface-terms` (text_not_contains, None): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `correct-behavior-and-spanish-only` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.support_detail_continuity (`live-behavior-support-detail-continuity.yaml`, v1)

- [retain] `support-question-uses-kb` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `guest-name-stays-support` (node_transition, hard turn=1): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `event-detail-stays-support` (node_transition, hard turn=2): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `support-details-do-not-reset-or-rename` (text_semantic, hard requireJudge=True turn=2): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.tito_numbered_name_and_post_rsvp_closure (`live-behavior-tito-post-rsvp-closure.yaml`, v2)

- [retain] `first-turn-reads-rsvp-state-without-account-auth` (tool_usage, hard turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `post-rsvp-comment-performs-no-rsvp-write` (tool_usage, hard turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `post-rsvp-comment-uses-no-rsvp-vocabulary` (text_not_contains, hard turn=1): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `post-rsvp-comment-preserves-attendance-with-one-acknowledgement` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.wedding_planner_location_completes_search (`live-behavior-wedding-planner-location-completes-search.yaml`, v2)

- [retain] `explicit-need-asks-missing-context` (text_semantic, hard requireJudge=True turn=1): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `no-search-before-required-context` (tool_usage, None turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `final-turn-search-ready` (trace_field_equals, None turn=3): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `final-turn-routes-to-recommendations` (node_transition, None turn=3): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `final-turn-searches-now` (tool_usage, None turn=3): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `final-turn-has-provider-options` (provider_result_count, None turn=3): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `final-response-advances-without-an-empty-extra-step` (text_semantic, hard requireJudge=True turn=3): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_behavior.wrong_account_handoff_once (`live-behavior-wrong-account-handoff.yaml`, v2)

- [retain] `wrong-account-real-handoff` (tool_usage, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `wrong-account-escalates` (node_transition, hard): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `wrong-account-no-otp-recovery` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `wrong-account-handoff-effect-confirmed` (fixture_effect_count, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).

### live_behavior.close_date_provenance_and_completed_retry (`live-close-date-provenance-completed-retry.yaml`, v1)

- [retain] `tokens-all-turns` (token_usage_present, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `selected-provider-preserved` (plan_field_subset, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `no-provider-search` (tool_usage, None turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `correct-close-behavior` (text_semantic, hard requireJudge=True turn=4): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `contact-details-alone-do-not-submit` (tool_usage, hard turn=3): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `explicit-close-dispatches` (tool_usage, hard turn=4): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `explicit-close-effect` (fixture_effect_count, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `completed-retry-does-not-dispatch` (tool_usage, hard turn=5): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `completed-plan-is-durable` (plan_field_equals, hard): Typed state invariant (auth cleared, handoff persisted, rsvp lifecycle, owner, selection safety); kept. Only selection/attempt counters are replaced, handled as overrides.
- [retain] `completed-retry-reports-existing-outcome` (text_semantic, hard requireJudge=True turn=5): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live.faq_from_recommendation_node (`live-faq-from-recommendation.yaml`, v1)

- [retain] `recommendation-to-faq` (node_transition, None): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `faq-knowledge-retrieval-called` (tool_usage, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `no-provider-results-in-faq` (provider_result_count, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `commission-answer` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `no-missing-kb-fallback` (text_not_contains, None): Prohibition check (forbidden secrets/identifiers, no-invention bans, no-resend/no-URL bans, vocabulary bans); literal form allowed for genuinely forbidden content. Kept.
- [retain] `one-turn-budget` (budget_constraints, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).

### live_feedback.token_seeded_close_flow (`live-feedback-token-close-flow.yaml`, v2)

- [retain] `tokens-all-turns` (token_usage_present, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `selected-provider-preserved` (plan_field_subset, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `no-provider-search` (tool_usage, None turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `correct-close-behavior` (text_semantic, hard requireJudge=True turn=4): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.
- [retain] `contact-details-alone-do-not-submit` (tool_usage, hard turn=3): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `explicit-close-dispatches` (tool_usage, hard turn=4): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `explicit-close-effect` (fixture_effect_count, hard): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).

### live_feedback.token_seeded_contact_correction (`live-feedback-token-contact-correction.yaml`, v2)

- [retain] `tokens-all-turns` (token_usage_present, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `first-phone-invalid` (trace_field_equals, None turn=0): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `corrected-phone-final` (trace_field_equals, None turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [revise] `correct-contact-correction-behavior` (text_semantic, hard requireJudge=True turn=1): 2026-09-16 audit scoping (case v1->v2): contact-info clause now states a close-flow event-date request is admissible (seed plan carries no event date); ban covers re-asking phone/name/email only. Threshold 0.85 kept.
- [revise] `correct-final-close-behavior` (text_semantic, hard requireJudge=True turn=2): 2026-09-16 audit scoping (case v1->v2): final-close clause now states a close-flow event-date request is admissible (seed plan carries no event date; selection-defer-close EX1 v2 precedent); ban covers re-asking phone/name/email and restarting provider search only. Threshold 0.85 kept.

### live_feedback.token_fresh_multifront_stays_multi_need (`live-feedback-token-multifront.yaml`, v1)

- [retain] `tokens-all-turns` (token_usage_present, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `multi-node` (node_transition, None): Lane-routing assertion to a documented runtime node (responder_invitacion / resolver_consultas_informativas / handoff / close lanes); kept as a documented runtime invariant. Routing is runtime-owned.
- [retain] `multi-strategy` (trace_field_equals, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `correct-multifront-behavior` (text_semantic, hard requireJudge=True): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

### live_feedback.token_seeded_selection_defer_close (`live-feedback-token-selection-defer-close.yaml`, v4)

- [retain] `tokens-all-turns` (token_usage_present, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `photography-selected` (plan_field_subset, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `catering-defer-recorded` (trace_field_subset, None turn=1): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `catering-deferred` (plan_field_subset, None): Authorization / effect identity / provenance / output-origin structural check; kept per directive (authorization, effect count/identity, provenance, output-origin stay).
- [retain] `correct-selection-defer-close-behavior` (text_semantic, hard requireJudge=True turn=3): Hard semantic judge kept (requireJudge:true mandatory). Global judge rules now also require: accept grounded inference + useful extra detail; fail missing topics, unsupported certainty, unrelated dumps, and unnecessary clarification when context/tools suffice.

## Outstanding (coordinator-owned, not in this packet)

- Continuation turns for remaining clarification cases beyond the ambiguous-event proof (ledger marks candidate rubrics; runtime owns behavior).
- Full unfiltered diagnostic audit, matched baseline/candidate gate, live reruns of revised oracles (R05: old runs preserved, both artifacts rerun on new contracts).
- No test execution, deploy, or promotion was performed from this instruction; validation commands are listed in the implementation log and stay unauthorized until the coordinator runs them.
