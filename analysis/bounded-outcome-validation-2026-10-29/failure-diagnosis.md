# Targeted validation failure diagnosis

This diagnosis is post hoc. It does not change the frozen cases, original scores, or retained artifacts. The observed study used the development Lambda identified in `frozen.json`; any later repair and validation must have separate identities and results.

## Second displayed provider

Nine of the ten unassessable selection comparisons came from the three baby-shower, corporate, and social scenarios: each repetition returned only one provider. A request to select a second option therefore could not establish second-choice behavior. Future controlled scenarios must provide at least two distinct candidates and verify that both are actually displayed. Live catalog coverage should remain a separate outcome.

Birthday repetition 2 displayed 4Foodies (ID 136) second but recorded Café del Alba (ID 189). The candidate order was not the delivered order. The plan stores candidate recommendations, not a verified delivered ordering (`src/core/plan.ts`), while `src/runtime/agent-service.ts` can resolve an ordinal against `recommended_providers`. The extractor is also given a ranked candidate list in `src/runtime/openai-agent-runtime.ts`, and `prompts/extractors/provider_selection.txt` describes that list as a source of ordering. Candidate order is not a reliable proxy for actual response order.

Wedding repetition 1 did not record a selection and requested clarification about conflicting lists. Wedding repetition 3 recorded three selected IDs (142, 132, 90), although only 132 was the displayed second option; the reply asked for confirmation. The checker could not treat a multiple-ID selection as a unique match. Each remains a failed case as originally scored; the unassessable classification is a limitation of this particular comparison, not evidence of correctness.

A defensible repair requires unambiguous, provenance-bound evidence of the options actually delivered, resolved from a structured output or otherwise validated against delivered content. Selection must use that evidence, or ask for clarification when unavailable; it must not assume internal search rank was displayed. A regression must reproduce the complete interaction and the mismatch between candidate and delivery order. User-provided fixture data and simulated effects must remain isolated from external customer writes.

## Simulated quote submission

One-provider repetitions 2 and 3 and two-provider repetition 1 performed no quote write on the first turn; confirmed receipts were consequently absent. All had a selected provider or providers and seeded contact fields. Their recorded `closeAction` values were respectively null, `request_contact`, and `request_contact`, versus `proceed_confirmed` in the successful repetitions. In one failed case the user was asked for contact already present in plan state. This points to inconsistent extraction or propagation of explicit dispatch authorization, but it does not by itself establish which stage caused each failure.

A repair must distinguish an explicit request to send from a request for information, preserve explicit refusal or ambiguity, validate the actual event date and contact, and require typed authorization before any effect. Do not infer permission to send merely from a selected provider or complete contact details. A live regression must preserve the exact interaction and use simulated writes, exact receipt IDs and date, plus a no-repeat check. The old failures must remain visible.
