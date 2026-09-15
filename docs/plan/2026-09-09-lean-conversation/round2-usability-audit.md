# Round 2 practical-usability audit — 2026-09-11

Read-only product/evaluator assessment of all 37 nonpassing artifacts in 9edcb9ac, with old-run comparison for identity rejection and targeted source/fixture inspection. No rubric, runtime, score or production change. These are qualitative judgments from recorded interactions, not human-user testing or a replacement release score. Passing cases were not independently revalidated here.

## Conclusion

Many failed cases are understandable enough for normal interaction. The backlog label “24 genuine failures” is not established by the evidence. Conversely, a fluent answer cannot excuse missing effects, dropped tasks, inaccessible images, unsupported factual claims or absent delivered answers. Old 48/89 and new 57/94 use different contracts; the same 89 moved 48 to 54, but that is not a controlled estimate of improvement. Baseline rerun on the revised contract remains required.

Labels: usable = recorded conversation serves the immediate user goal despite failed checks, subject to separately enforced effects/access invariants; mixed = understandable but factual/disclosure/recovery or completeness issue needs attention; product = concrete user-visible failure or missing required effect. These labels do not override hard gates. Backend facts existing in a fixture do not by themselves prove they were visible to the candidate or authorized to disclose.

## Corrections to previous triage

- Provider names in the ambiguous-confirmation answer are present in the artifact provider_results (IDs 90/91). Withdraw the earlier claim they were invented. Their inclusion in the exact candidate request still needs verification, but judge prose is not proof of hallucination.
- Martha's event names and pending states occur in purchase-martha-frozen.json. The judge's assertion they have no source is not supported by the fixture. Missing event membership is not the same as missing order event_name. Candidate projection/disclosure remains a separate check.
- Kiara 149.9 exists in both frozen fixtures. Assess unrequested disclosure and relevance, not invented amount based only on the judge statement.
- URL-unavailable is classifiable from existing evidence: artifact planDiffSummary records Lambda HTTP 500 caused by upstream image HTTP 404. No rerun is needed to establish that observed failure.
- Planning blanks are delivery action=failure/model_origin_mismatch. They are real delivery outages even if the underlying provenance check is defective. They are not equivalent to intentional silence after thanks.

## Single start for implementation agent

Canonical case: live_behavior.phone_account_rejection_requests_email (brief shorthand phone_purchase_rejection). Compare d2141705 and 9edcb9ac artifacts. Old: stopReason identity_rejected; persist information_authentication_terminal_handoff; pending count 1; request_human_takeover called; effect 1/1. New: persist information_authentication_declined; pending count 0; no takeover; effect 0/0. Same user rejects account/number association, not the original question.

Inspect structured phoneConfirmation and authAction and the identity guard before completeDeclinedInformationAuthentication in handleInformationFlow. Current source checks phoneConfirmation=no AND (hasPhoneIdentity OR !declined), followed by declined handling. Establish the exact deployed extraction/precondition before claiming an executor change. Artifact diffs locate the changed branch, not a unique source commit or deterministic cause. Preserve legitimate refusal with no forced handoff as a paired regression. Do not keyword-route the account rejection or force every refusal to escalate. After this, inspect s01/s08 candidate-visible disclosure projections separately; do not assume the handoff root cause also explains payment disclosure.

## Assessment of every nonpassing case

Counts within reviewed nonpasses: usable=10, mixed=18, product=9. No adjusted pass rate is claimed.

| Case | Assessment | Reason |
|---|---|---|
| live_behavior.ambiguous_confirmation_adversarial_selection | usable | One focused choice question; both names exist in provider_results. Repeating two names is not invented intent. Earlier hallucination allegation withdrawn; verify candidate projection separately. |
| live_behavior.current_campaign_order_over_historical_declined_maria_jose | mixed | Pending status understood; amount provenance and applicability of processing window need candidate-visible evidence, not judge assertions alone. |
| live_behavior.customer_transaction_code_by_phone | mixed | Grounded candidate clarification is usable; calling event_date the purchase date may mislead. Verify date semantics and why selection is prohibited. |
| live_behavior.customer_transaction_reference_unavailable_multiple | mixed | Clear selection request with distinguishing facts; missing event labels is not inherently a blocker. Disclosure authorization still needs checking. |
| live_behavior.host_withdrawal_diana_policy_and_support | mixed | User can reach human review; broad planning reset is awkward and unnecessary. Policy omission is completeness, provided handoff succeeds. |
| live_behavior.host_withdrawal_pending_event_followup | usable | Acknowledges correct event and review; not repeating a processing window does not block the conversation. Confirmed handoff remains required. |
| live_behavior.image_captioned_preserved | product | Does not answer the supplied image question; unnecessary clarification despite attachment. |
| live_behavior.image_conversation_continuity | mixed | Old inspection/description requirements are obsolete; generic onboarding misses the attachment. Follow-up usability is weak, not proof that description is needed. |
| live_behavior.image_file_delayed_question | product | Fails explicit later image question and offers unrelated event choices. |
| live_behavior.image_file_malformed_unavailable | product | Reports specific visible content despite unavailable image; appears to substitute text history for visual evidence. |
| live_behavior.image_readable_captionless | mixed | No unsolicited description is correct. Generic greeting instead of contextual attachment acknowledgement needs improvement; old node/tool oracle is not product quality. |
| live_behavior.image_too_large_fallback | product | Silently hides upload limitation, leaving user unable to know the image needs replacing. |
| live_behavior.image_unavailable_captioned | mixed | Greeting is understandable, but missing image-availability feedback may strand a later question. No need for a canned resend paragraph. |
| live_behavior.image_url_describe_dice | usable | Answers exact count/colors question correctly. Translucency was not asked; internal node label needs separate architecture testing. |
| live_behavior.image_url_receipt_payment_thread | usable | Clearly states pending validation and never approves payment; silence after thanks is appropriate. Backend jargon and image-disclaimer wording are not required for understanding. Attachment-path checks remain separate. |
| live_behavior.image_url_unavailable_evidence | product | Artifact records HTTP 500 from upstream image 404. No usable response; not an unclassified wording miss. |
| live_behavior.jose_campaign_greeting_then_acknowledgement | usable | Stops after explicit thanks/leave it there. Semantic missing-wire rejection confuses deliberate silence with absent required response. |
| live_behavior.otp_sent_explains_image_limitation | mixed | Instruction to paste code is understandable; judge distinction between no images and cannot read screenshots is pedantic. However, global claim images are unsupported conflicts with new image capability; scope it to code entry. |
| live_behavior.otp_terminal_handoff_unavailable | mixed | Truthfully says verification failed and query pending; no false success. Recovery next step remains weak, distinct from exact wording requirements. |
| live_behavior.otp_terminal_missing_trusted_phone | mixed | Failure/pending state understandable; offering support without means to request it may leave user stuck. Missing identity sentence alone is not a material failure. |
| live_behavior.owner_customer_payment_relevance | usable | Correct pending status, no invented remaining balance, no irrelevant cart; silence after thanks fits requested behavior. |
| live_behavior.pending_balance_validation_luis | mixed | Payment remains pending and user report recognized. Event date described as order date needs checking; no need to recite backend-validation disclaimer verbatim. |
| live_behavior.phone_account_rejection_requests_email | product | Old run preserved question and wrote handoff. New run cleared question and wrote none after account-association rejection. |
| live_behavior.purchase_martha_accountless_selection | mixed | Clear selection with event names and pending states that ARE present in fixture. Judge hallucination allegation is unsupported; verify candidate visibility and disclosure/date semantics before acceptance. |
| live_behavior.purchase_pending_transfer_continuity | mixed | Useful pending/window response, but volunteered totals/balances and unresolved certificate question add friction. Disclosure authorization is separate. |
| live_behavior.rsvp_cinthya_campaign_invitation_not_reported_missing | usable | Correct event, confirmation and no new write. Missing thanks is style only. |
| live_behavior.rsvp_declined_state_offers_one_change | usable | Answers how attendance is recorded. Optional offer to change it is not necessary to answer the user question; preserve no unauthorized mutation. |
| live_behavior.rsvp_multi_person_offers_human_help | usable | Correctly explains companion limit, no registration, human continuation. Two sentences rather than one is not failure, subject to real handoff receipt. |
| live_behavior.rsvp_paolo_mariana_resolved_single | usable | Correct confirmed status/event/date/no new write. Missing well-wish is style only. |
| live_behavior.rsvp_trusted_phone_reports_no_pending | mixed | Honest no-confirmation result and offer of help; potentially unnecessary retry invitation. Negative lookup versus unavailable lookup must be explicit in evidence. |
| live_behavior.s01_frozen_kiara_pending_replay | mixed | Answers status; amount exists in frozen fixture, so not automatically invented. Exposing unrequested amounts/balance may violate scoped disclosure; 72h applicability needs verification. |
| live_behavior.s08_kiara_approved_replay | mixed | Answers approved status; 149.9 exists in fixture. Unrequested balance uncertainty confuses an approved transaction and disclosure must be checked. |
| live_behavior.spanish_only_mixed_language_request | mixed | User-used catering/baby shower terms are intelligible; lexical ban is not usability. But email-link request is not addressed, a separate completeness issue. |
| live_behavior.tito_numbered_name_and_post_rsvp_closure | mixed | Final warm acknowledgement is usable. Earlier asks whether to read or confirm despite user saying confirm: unnecessary clarification deserves separate review. |
| live_behavior.wedding_planner_location_completes_search | product | Final required answer absent: delivery action=failure, reason=model_origin_mismatch. User receives no provider results. |
| live_feedback.token_fresh_multifront_stays_multi_need | product | Entire requested planning response suppressed by model_origin_mismatch failure. Internal prepared results do not help user. |
| live_feedback.token_seeded_selection_defer_close | product | User rejects catering and asks to close; system requests catering again and does not finish requested task. |

## Evaluation direction

Keep separate measures for: (1) task completion and useful next step, (2) factual grounding and authorized disclosure, (3) effects and state continuity, (4) delivery/infrastructure reliability, (5) optional style. Exact thanks, well-wishes, one-sentence limits, backend jargon and unrequested visual adjectives should not define product success. Test natural correct paraphrases and legitimate silence alongside wrong payment approval, wrong event, failed handoff and swallowed required answer. Internal node/tool expectations belong to explicit architecture checks and must evolve when their paths are intentionally retired.

Do not blindly lower semantic thresholds or remove all structural checks. Review each oracle change against actual user intent and independently visible facts, preserve old results, and rerun baseline/candidate on the same revised contract. Continue inspecting successful outputs too: this failure-only review cannot estimate overall user satisfaction or prove the architecture shift worked.
