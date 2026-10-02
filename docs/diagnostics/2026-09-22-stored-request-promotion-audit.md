# Stored-request promotion audit: 8a0dac96

## Evidence and verdict

Reviewed run eval-2026-09-22T15-38-33-130Z-8a0dac96, source e534064a current checkout (implementation lineage e2d80ed1/9e5f5cd9/583b59f4/af8a28b1), all 18 case results/28 turns and tool summaries. Retrieved ALL 74 recorded model response IDs with the repository OpenAiAuditClient: GET response plus all paginated input items, 74 succeeded/0 errors. These comprise 19 classifiers, 28 extractors and 27 reply calls. Private evidence: .openai-audits/review-8a0dac96/index.json and response-ID files, mode0600. No generation, deployment, mutation or production operation in this audit. No secrets or image bytes copied into this report.

This is an actual stored-payload audit, superseding prior limitations caused by root-owned audit files. Tool traces are runtime execution summaries; these are not model-invoked tool conversations. All 27 reply calls have tools:[]: instructions to use tools cannot themselves cause another backend read. Complete GET input pagination was used; image attachments were not downloaded.

Recommendation: HOLD broad promotion of these bytes, for wrong-source gift discovery and unnecessary forced clarification despite an explicit event—not because every semantic red is a serious defect. Many answers are usable, and receipt behavior has improved substantially. No matched current-production comparison is available in this audit, so superiority to production is not established. The recorded 8/18 score remains unchanged; do not manufacture a new acceptance score by retrospective waiver.

## Confirmed contradiction 1: the runtime still overrides reference reasoning

Case receipt_explicit_older_target_wins T0 user: “Consulta por Aniversario Lucia. Ese pedido sigue pendiente?” The stored reply request (resp_0376547ce4dbc9be006ab2a16e158087d2ba0715146a3b0700) includes both events plus the exact user question. It ALSO includes:
- outcome_kind:selection, permitted_next_action:select_purchase, missing input purchase_selection.
- operational instruction: “Hay varias compras registradas y se necesita que la persona elija una ... formula una sola pregunta explícita sobre a cuál se refiere”.

Delivered reply lists Aniversario Lucia and Baby Shower Catalina and asks which event. This is a real product defect, not successful retain-all behavior. The implementation log's positive interpretation of T0 is incorrect.

Cause chain: information-orchestrator.filterPurchaseCandidates retains records but sets needsSelection=purchases.length>1; purchase-reply-projector.selectPurchaseReplyOutcome also independently treats length>1 as selection; agent-service.ts around8245 translates it into a compulsory question. The reply model is explicitly instructed to disregard a reference it could resolve. The latest simplification stopped halfway. My previous package should have required removal of these downstream forced-selection consumers as part of retaining candidates.

Durable edit: preserve candidates and source coverage, remove record-count-as-unresolved inference from these three layers for read-only requests. Distinguish candidate multiplicity from unresolved reference. Let existing reply reasoning use current explicit text/history for read answers. Preserve exact-ID/reference mismatch and authorization constraints. Mutations still require validated structured target IDs before effects; never authorize writes from reply prose. No new entity resolver/model pass or fuzzy string selector. Test actual spec.input absence of compulsory select_purchase directions when only multiplicity is known; reuse the existing explicit-older live case and add a T0 assertion (it currently judges mainly T1).

## Confirmed contradiction 2: offers are required by tests but unsupported by the reply context

Unknown physical shipping T0 and handoff T0 have identical reply contexts apart from identities. They contain valid physical gift evidence, missing shipment facts, permitted_next_action:none and no support-availability field. Both receive:
- “Responde solo con los campos solicitados del resultado”.
- support_continuity: “No ofrezcas acciones que la evidencia no permite”.

The model reports the limitation and stops; the rubric requires a human-help offer. This is not simply failure to follow a clearly specified available action. Agent-service around8197 is injecting restrictive prose after canonical evidence. The model cannot discover handoff capability with tools because reply tools are empty.

Durable edit: retain existing typed support capability facts in the reply projection, separating availability to offer help from a requested/executed effect. Remove the only-requested-fields note and duplicate capability prose; a known lookup success can be a fact rather than an instruction. Let the model propose an available next step when the question remains unanswered. Do not set handoff requested or call takeover just to make an offer test pass. Missing phone/unavailable capability remain distinguishable. Existing handoff T1/T2 are successful and must remain so.

## Confirmed contradiction 3: backend source still depends on ambiguous prompt directions

Mixed T0 stored extraction resp_039b17b6ca683902006ab2a12fbe2887d2b247612a2262ff18 explicitly outputs requestedOperation purchase.orders.read, resource orders, aspects shipping, query about two gifts. The runtime reads only orders and gets an empty world. T1 repeats that path; T2 eventually reads gifts and gives correct quantity1/150.

Actual extractor instruction contains all of:
- orders for orders/carts;
- gift_purchases for payment/dedication/card/shipping/thanks;
- payment-validation window => orders;
- “estado de mi pedido” => orders including shipping.
It selects partitions partly by subject, partly by aspect. Source implementation now consistently respects the output, but the input contract remains internally ambiguous. This is not resolved by declaring old filtering exonerated.

Durable direction: rewrite the existing source instruction around backend ownership/record kind, with shipping/payment aspects independent of ownership. Avoid another gift example appended globally. Support an unresolved source using the existing bounded purchase discovery executor: when the requested purchase source is not established, read the available authorized roots once each; a verified source needs only its own read. Source certainty must not be fabricated from having an enum default. Do not use keyword routing or an orders-empty fallback that silently treats one partition as the whole account. Preserve per-source empty/unread/unavailable coverage and surface scoped uncertainty until discovery finishes. This is one unified purchase-read capability composed from current gateways, not a new conversational state machine or new model round trip. Change schema/executor together if an explicit unknown source is needed.

## Actual context quality and prompt leanness

Reply instructions range5377–7785 UTF-8 bytes; extractor instructions17247–21572 bytes. All stages use low reasoning. No evidence supports changing model/effort before correcting inputs.

Every inspected support reply includes shared planning/provider guidance, rigid vocabulary substitutions and wording examples. Extractor mixed T0 includes full Spanish answer style, personality and planning extraction instructions although it emits structured JSON. Remove answer-style prose from extraction and task-irrelevant planning guidance from customer-support reply bundles through the existing compiler; do not create a second compiler.

A fresh shipping turn has empty history but continuity_has_prior_answer:true and selects support_continuity, whose opening assumes the user supplied a follow-up detail. This is false continuity metadata. Derive prior-answer truth from actual prior delivered answer/history, not current lookup success; test empty-history first turns.

Canonical context repeats the same record as commonRefs, candidates, purchases and detailedPurchases. References are legitimate, but purchases can say grandTotal:null and totalAvailability:available while amountDisclosure.total contains the value. Shipping-only credit input masks backend paymentStatus to null even though the fixture says approved. Omitted-by-projection is being presented as unknown, not distinguished from missing-at-source. Preserve authorized useful record facts once; distinguish disclosure omission from source absence. Do not unmask sensitive identifiers or account details. Item amounts are now correctly preserved; do not reverse that fix.

Operational notes include currency/time-correction directions on ordinary shipping/status questions. They are irrelevant and sometimes duplicate one another. Delete these conditional prose additions where typed known/unknown facts already suffice. Avoid adding a new global instruction for every observed sentence.

Gift meaning facts are present: chosenBy:host, giftShipmentApplicable:false, mechanism:host_account_credit. The no-credit-purpose rule is present in actual instructions. Unsubstantiated extra purpose wording is therefore a real remaining generation issue, not a missing field. However saying generic credit mechanism is not automatically saying funds posted. Keep this distinction in evaluation.

## Complete outcome reassessment

| Case | Assessment based on actual input/output |
| --- | --- |
| campaign | Correct event, no shipment, backend approved fact supported; output explicitly says credit availability NOT confirmed. Judge calling this settlement-adjacent is wrong. Added discretionary-use purpose lacks supplied support. Judge also demands retention-until-withdrawal not provided in reply facts. |
| credit_pending | Useful pending answer; nonetheless uses “para que ellos lo elijan” while other cases fail for similar purpose wording. Passing judge is not proof of consistent business semantics. |
| credit_states | Correct no-shipment mechanism, host-choice attribution unclear; discretionary-use embellishment unsupported. “Se entrega como crédito” alone is not proof of already-posted funds. |
| credit_card | Correct credit versus physical-card distinction. Judge specifically fails known amount80 as unsolicited; conflicts with the requested useful-facts policy. Known amount is not a fabricated financial claim. Additional purpose wording remains separately reviewable. |
| mixed | Real wrong-source discovery failure T0/T1; excessive order-ID request follows from incomplete backend coverage. T2 proves amount/quantity data works when fetched. |
| shipped | In-transit fact present; output invents recipient hosts and mixes in future dispatch. Real grounding defect; default gift recipient must not replace absent recipient evidence. |
| physical_unknown | Honest unavailable shipment details; next-step omission plausibly driven by none action+restricted prose. Completeness defect, no executed unauthorized effect. |
| handoff | Same T0 omission; accepted request succeeds once and thanks is clean. Preserve those successes. |
| unknown_type | Honest inability to establish fulfillment/date; missing useful available next step. |
| receipt_alone | Useful state and validation-window answers, no unsupported new write. |
| receipt_approved | Useful approved-state answer with source distinction. Event uniquely identifies the record; omitted340.44 alone is unnecessary recital requirement. |
| receipt_dual | Correct two-event clarification. “Ambas pagadas” could overstate recorded pending payment; inspect as semantic nuance, do not equate passing judge with perfect grounding. |
| receipt_explicit_older | T0 forced redundant question is genuine regression in usability; T1 resolves target and states pending/image boundary, omitted window is completeness. Report incorrectly praised T0. |
| receipt_gift_only | Correct gift and pending status, no cart distraction. |
| receipt_non_receipt | Silent first image, exact hours answer from frozen KB passage. Fixed synthetic behavior, not proof of current live-KB completeness. |
| receipt_text_pending | Correct unknown-paid boundary and follow-up window. |
| receipt_with_text | Useful pending answer, no forced transcription. |
| Roberto | Scoped lookup limitation and no claimed attendance mutation. Usable limitation, could offer more direct help when capability is known. |

## Why “variance, not regression” is not established

There is one run per candidate with changed runtime projections/oracles. Identical backend records do not establish identical serialized input or instruction bytes. Shipping input includes new note/context choices; explicit-older has a demonstrated instruction-induced behavior change. Call flips observed stochastic variation only after comparing complete payloads/settings. Do not spend repeated runs merely to prove variance. Judge differences across cases can also create apparent instability.

## Promotion decision and smallest next work

Do not promote broad customer-support traffic on these bytes yet. Fix two structural boundaries first: (1) source discovery cannot stop at a guessed partition while claiming account-wide absence; (2) multiple records cannot mandate a clarification when explicit user context resolves the read. Then align support availability with evidence, remove contradictory operational notes, and correct amount/settlement/recital oracle defects BEFORE freezing the next run.

Keep scope bounded to extraction source semantics, existing purchase executor/projection, operational-note deletion, current prompt compiler relevance and existing case contracts. No new response templates, agent count, general loop or autonomous side effects. Preserve image transport, auth, receipts and exactly-once writes.

Offline proof must inspect production serialized spec.input and gateway calls, not only a mock extraction: mixed gift unknown-source discovers the gift world; explicit older name with two authorized candidates has no forced-clarification direction; unknown shipment includes truthful support-availability facts and no forced escalation; backend approved status is not relabeled unavailable; no duplicate full record body. Retain all original cases and strengthen explicit-older T0 rather than add cases. A fresh bounded live validation would be needed after runtime changes; no deployment or new paid run is authorized by this audit request.

No claim of comprehensive production safety: this panel is narrow, and a matched production comparison was not performed. Historical gate remains8/18. Useful-answer readiness and strict oracle score are reported separately.
