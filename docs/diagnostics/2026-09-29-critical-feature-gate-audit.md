# Critical feature gate audit — 2026-09-29

## Observed development result

The frozen, explicitly selected 28-case live Lambda panel in `docs/plan/2026-09-29-critical-feature-gate.md` ran once against development artifact SHA-256 `f64b3125e30b2f83ddf19128d6abe217f74b742a5a9d3d75dcfc878f29314f85`. Run `eval-2026-09-29T04-06-33-913Z-2275c902` formally passed 17, failed 11, errored 0, cost US$0.078831, and made 35 judge calls with zero retries. The complete report and reply/trace snapshots are in `.eval-runs/eval-2026-09-29T04-06-33-913Z-2275c902/`. The two commission cases and synthetic Sinar decline case passed. These results are targeted, not a full-suite claim.

## Failure disposition

| Case | Disposition and evidence |
| --- | --- |
| `accountless_guest_event_uses_phone_without_otp` | Oracle error: the judge penalized a confirmed-attendance mention, but the fixture has `has_responded=true` and `will_attend=1`. Version 4 permits that verified fact; venue and auth checks remain. |
| `gift_credit_pending_payment_stays_pending` | The answer explicitly retained pending payment. The judge additionally required the host-credit mechanism although the user asked only whether funds arrived. Keep the current strict oracle pending further product decision; do not count this as a demonstrated false settlement claim. |
| `host_withdrawal_diana_policy_and_support` | Genuine first-turn UX failure: a role correction was followed by an unsolicited provider-planning menu. Later turns included sourced withdrawal policy and handoff. |
| `payment_destination_requires_pending_purchase` | Oracle error: the answer requested verification before lookup, disclosed no destination, and used “pending purchase” conditionally. Version 2 clarifies that conditional reference is allowed. |
| `phone_purchase_missing_hands_off_once` | Mixed: the first answer accurately described an empty orders source and failed gift source, but omitted the required offer of human help. The v3 `not_found` trace pin contradicted the partial-source failure. Version 4 pins both source statuses and retains the hard support-offer expectation. Scoped reply guidance now loads for this typed failure. |
| `purchase_current_pending_over_old_approved` | Stale trace pin: the reply selected the correct current pending record. Full record detail is now in `customer_context`, not `information_execution_summary.evidence`. Version 4 keeps completed/complete structural checks and the hard semantic record check. |
| `rsvp_explicit_mutation_targets_requested_event` | Unresolved time-source contract: fixture stores `18:00Z` and `timezone=America/Lima`, while the oracle expects 18:00 local. Converting UTC gives 13:00 Lima; treating the stored hour as local gives 18:00. No source contract establishes which is authoritative. Do not weaken the oracle or assert a local time until the API contract is resolved. |
| `rsvp_host_set_declining_consistent` | Genuine state conflict: reconciled candidate evidence says one event is declining, while a raw guest record has `hasResponded=false`. The reply used the raw flag to say no response. A scoped module now tells the model to use the per-candidate reconciled state and disclose unresolved conflicts. |
| `rsvp_missing_event_identity_is_unavailable` | Genuine incomplete-source overclaim: an invitation lookup failed, but the reply described an empty search. A scoped failed-lookup module now preserves unknown state. |
| `rsvp_plus_one_not_eligible_no_false_success` | Genuine extra claim: rejected companion reason and human help were delivered, but the answer inferred that the guest's own attendance was unconfirmed although no own-attendance change was requested. The typed effect now exposes `attendance_change_requested`, and the rejected-companion module prohibits that inference. |
| `support_pending_question_completed` | Same unresolved 18:00Z/`America/Lima` contract as the explicit RSVP mutation case. The judge expected the stored 18:00 hour; the model converted to 13:00 Lima. |

## Actual production Sinar ingress

The provided screen displays contact `96170197268` without an international prefix. A read-only audit of the Agent API found one inbound message at `2026-09-28T16:18:50Z` containing the explicit decline, but no matching agent performance record or identity-hashed Lambda log. A nearby Lambda request at `16:19:02.181Z` returned HTTP 400 with `contact_phone must be a supported international number`. The rejection log does not contain the phone, so temporal proximity is evidence of a likely ingress failure, not a provable per-message attribution. The 11-digit screen value cannot be safely normalized to an authorized E.164 identity by guessing. The channel adapter must supply a trusted E.164 phone and then replay or manually repair this attendance response. The synthetic development RSVP pass does not establish that production intake is fixed.

## Release decision

No production promotion. The formal gate has 11 failures; several are real behavior defects, two date/time cases have an unresolved source contract, and the actual production decline may still be rejected before the agent runs. The post-run changes have offline checks and a development deployment, but no new paid semantic verdict. Repository policy forbids retrying semantic failures or broadening the paid panel without a new user instruction.
