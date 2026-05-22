# Feedback Test Coverage

This matrix maps the batch feedback sources to deterministic regression cases and live token-consuming evals. Each row includes the expected fixed behavior and the old broken behavior that must not return.

## Coverage Matrix

| Feedback source | Failure description | Expected fixed behavior | Regression coverage | Coverage type |
| --- | --- | --- | --- | --- |
| `feedback/batch2/dump.md` attachments `00000054`-`00000058`, `00000060`-`00000061` | Closing repeated a selected catering confirmation and then claimed catering was still unresolved. | A selected provider remains selected through close/contact flow, and the close path asks only for contact data when contact data is missing. | `feedback.close_selected_provider_does_not_reask`; `live_feedback.token_seeded_close_flow` | offline eval, live-token eval |
| `feedback/batch2/dump.md` attachment `00000060` | Contact request lacked context for why name, email, and phone were needed. | Contact collection explains that the fields are needed to close the plan with selected providers. | `feedback.close_selected_provider_does_not_reask`; `live_feedback.token_seeded_close_flow` | offline eval, live-token eval |
| `feedback/batch2/dump.md` attachments `00000062`-`00000063` | Incomplete phone numbers were accepted, and the extension/country-code guidance was unclear. | Invalid or incomplete phones are rejected immediately and do not persist to the plan. | `feedback.invalid_phone_rejected_immediately` | offline eval |
| `feedback/batch2/dump.md` attachment `00000063` and batch1 contact validation notes | A standalone phone correction risked resetting other contact fields. | A corrected phone updates only `contact_phone` while preserving the stored contact name and email. | `feedback.phone_correction_updates_single_field`; `live_feedback.token_seeded_contact_correction` | offline eval, live-token eval |
| `feedback/batch2/dump.md` attachments `00000065`-`00000069` | Saying `ninguna` for catering did not clearly defer that need or allow close to proceed. | `ninguna` marks the active need as deferred and does not keep it blocking close. | `feedback.none_defers_need_and_allows_close`; `live_feedback.token_seeded_selection_defer_close` | offline eval, live-token eval |
| `feedback/batch2/dump.md` attachments `00000065`-`00000069` | Shortlisted but unselected needs caused confusing close loops. | Close is blocked only by unresolved shortlisted needs, and the user gets a clear select-or-defer choice. | `feedback.unselected_shortlist_blocks_close_until_deferred` | offline eval |
| `feedback/batch2/dump.md` attachments `00000065`-`00000069` | Needs with no results were treated as if they still required selection. | No-result needs are treated as non-blocking for close. | `feedback.zero_result_need_not_treated_as_pending` | offline eval |
| `feedback/batch2/dump.md` attachment `00000070` | A provider mentioned earlier was not recognized as selected in a new close/contact path. | Selection state is taken from the persisted plan, not from a fresh recommendation prompt. | `feedback.close_selected_provider_does_not_reask`; `live_feedback.token_seeded_close_flow` | offline eval, live-token eval |
| `feedback/batch2/dump.md` attachments `00000072`-`00000073`; batch1 provider filtering notes | A Lima/Lurín photography request surfaced Mexico providers while Peru options existed. | Location filtering excludes Mexico providers for Lima/Lurín when Peru providers are available. | `feedback.location_filtering_avoids_mexico_for_lurin` | offline eval |
| `feedback/batch2/dump.md` attachment `00000074` | Provider selection was confirmed and then another fresh recommendation list appeared. | Selection confirmation does not relist fresh providers in the same turn. | `feedback.selection_confirmation_does_not_relist` | offline eval |
| `feedback/batch2/dump.md` attachments `00000075`-`00000076` | After an error/clarification, the provider list appeared again as if selection failed. | Post-error clarification preserves the selected provider and does not relist options. | `feedback.post_error_clarification_does_not_relist` | offline eval |
| `feedback/batch2/dump.md` attachment `00000077` | Web-design support questions blurred the bot's boundaries and lacked escalation guidance. | Out-of-scope FAQ states support boundaries and gives support-channel next steps. | `feedback.faq_web_design_support_boundary` | offline eval |
| `feedback/batch2/dump.md` attachments `00000078`-`00000079` | Gift/product-claim FAQ copy was unclear about brand claims and next steps. | Gift FAQ distinguishes gift-list funds from product claims and asks for brand/context to route support. | `feedback.faq_gift_product_claim_clear_next_steps` | offline eval |
| Live failure from terminal trace `01KS5JT79ES3W6SDHD16NCAYXK` and batch1 state-machine notes | A multi-front wedding request was downgraded to stale active Catering search. | Current multi-need evidence routes to multi-need search and grouped recommendations; stale active focus cannot downgrade the turn. | `feedback.multi_need_request_not_downgraded_by_stale_focus`; `live_feedback.token_fresh_multifront_stays_multi_need` | offline eval, live-token eval |

## Token-Consuming Multi-Turn Coverage

The live feedback token suite is intentionally separate from fast local tests. It calls the deployed Lambda turn by turn, starts from seeded/mock plans where the failure requires stored state, and asserts token usage exists for every live turn.

| Eval ID | Purpose | Required token assertions |
| --- | --- | --- |
| `live_feedback.token_seeded_close_flow` | Selected provider close flow over multiple turns from a seeded plan. | `token_usage_present` for all turns, including extraction and reply token totals. |
| `live_feedback.token_seeded_contact_correction` | Invalid phone followed by corrected phone from a seeded contact plan. | `token_usage_present` for all turns, plus final stored phone validation. |
| `live_feedback.token_seeded_selection_defer_close` | Multi-need selection, defer, and close flow from a seeded shortlist plan. | `token_usage_present` for all turns, plus selected/deferred final state. |
| `live_feedback.token_fresh_multifront_stays_multi_need` | Fresh detailed multi-front request must stay multi-need without stale focus. | `token_usage_present` for the turn, plus multi-need route and presentation assertions. |

## Assertion Strategy

Critical behavior is asserted through structured plan fields, trace fields, tool usage, provider result metadata, and the `token_usage_present` aggregate expectation. Text checks are limited to user-facing contract phrases and old broken wording guardrails; they are not the routing source of truth.
