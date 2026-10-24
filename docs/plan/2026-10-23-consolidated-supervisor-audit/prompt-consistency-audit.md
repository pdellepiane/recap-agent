# Prompt consistency audit — 2026-10-23

Read-only runtime audit requested by the user. No character trimming, budget changes, runtime changes or model calls were performed in this pass.

## Exact failing request

Built the extraction request locally through `OpenAiAgentRuntime.buildExtractionRequestSpec`, with an established information-lane plan and `Gracias`, matching the instruction-economy test. The resulting instruction bundle is 6005 UTF-8 bytes and its input is 1288 bytes. Files, in order:

1. `extractors/base_system.txt`
2. `extractors/capability_boundary.txt`
3. `shared/customer_context_fields.txt`
4. `extractors/information.txt`
5. `nodes/resolver_consultas_informativas/auth_control.txt`
6. `extractors/rsvp.txt`
7. `extractors/contact.txt`

The serialization used no model or network request. The other failing test additionally asserts full customer-profile preservation; preserve that invariant while repairing instructions. Its different input size was not remeasured here.

## Findings inside that instruction bundle

### Conflicting responsibility: request versus availability

`base_system.txt` says “Usa acciones disponibles solo con intención expresa.” `capability_boundary.txt` says requestedOperation represents the requested operation, not its availability or authorization, which the runtime validates.

The first instruction can filter out an explicitly requested unsupported operation before the runtime sees it. This matters for refunds/withdrawals and human escalation. Repair by giving extraction one responsibility: capture explicit requested actions, including unavailable ones; deterministic runtime policy owns execution permission. Keep the consent invariant, remove capability filtering from extraction guidance. Add a structured unavailable-operation regression, not a vocabulary pin.

### Schema mismatch: removed selector

`information.txt` says a payment-destination request is purchase “con destination_account”. `openAiInformationRequestSchema` has kind, query, eventHint, orderId, amount, authAction and hostWithdrawal, but no destination_account selector (nor resource/aspects).

This is a stale instruction for an output the current schema cannot represent. Keep purchase classification and preserve the actual destination request in query/requestedOperation; runtime evidence determines disclosable payment details. Add schema/prompt consistency coverage proving removed selector instructions are absent and payment-destination classification remains represented.

### Stage leakage: reply behavior inside extraction

`base_system.txt` says to return only the schema object and not write the response. Nevertheless `shared/customer_context_fields.txt` includes “Afirma un cambio solo con resultado verificado”, while field/date/shipping/credit disclosure guidance travels wholesale even on an empty-profile acknowledgement.

The factual distinctions are valid. The defect is stage and evidence scope, rather than inherently false facts. Separate extraction interpretation invariants from reply claim/disclosure guidance, and select applicable field semantics from typed evidence presence. Preserve every authorized customer field and provenance. Test exact assembled requests for absent irrelevant modules and retained applicable semantics; measure bytes afterward.

### Duplication, not a contradiction

Credential non-propagation is repeated in base_system and auth_control. Both agree. Consolidate under one invariant owner if the composition still protects authentication continuations. Do not classify duplication itself as conflicting policy.

“Conserva el estado vigente” is broader than contact.txt's instruction to emit null for fields absent in the current message. The specific contact rule supplies an exception, so this is scope ambiguity rather than an unequivocal logical contradiction. Clarify extraction as a current-turn delta and leave preservation of stored values to typed merge semantics; first verify those semantics with existing continuity tests.

## Connected defects outside the failing bundle

These are not blamed for its 6005-byte size:

- Router `route.txt` admits public FAQ answers, but `request_settled.txt` describes complete answers only through authorized records. Align settlement with the actual completed task/evidence so FAQ answers do not become unresolved solely because no private record exists.
- Reply commission guidance is selected by shared article identity even though the article also contains withdrawal policy. Its blanket calculator instruction is unsupported for withdrawal calculations. Select separate topic guidance from typed extraction, retaining the no-calculation invariant.

## Repair criterion

Repair responsibility conflicts, schema drift and stage/evidence scope first. Add behavior and composition regressions that explain why the replacement is correct. Then measure serialized instruction and input bytes with the same request fixtures. Keep the 6000-byte guard and complete customer profiles; do not shorten words, remove punctuation, or raise the limit merely to make the two tests green. Runtime/prompt implementation and development/live validation remain pending under the consolidated plan.
