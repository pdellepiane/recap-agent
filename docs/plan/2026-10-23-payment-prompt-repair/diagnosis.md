> Subsequent user instruction explicitly authorized production promotion. The tested artifact was promoted on October 23, 2026; see [production-result.md](production-result.md). Six targeted cases passed, payment supervision passed, and public-search follow-up supervision failed. The latter was disclosed and retained. The initial authorization boundaries below are historical; the review lock is still unapproved.

# Payment prompt and lean-path repair

Date: October 23, 2026, America/Lima. Baseline source d44bfa8f; runtime source 2866333a. This is a new user-authorized repair after the completed final check, not a retry of the previous artifact.

## Usability and scope

The baseline works for public event orientation, public fee explanation, an independent question after takeover, and a single confirmed fixture handoff. It is not demonstrated safe to explain disputed payment balances reliably. Prompt slimming did not establish semantic correctness. This change addresses the observed payment/wiring problems and narrows routed information extraction. No production promotion or review-lock approval is authorized.

## Evidence-backed causes

The exact stored Responses and input items were retrieved read-only, without new model generation, for response IDs `resp_0c6c384f287668ce006adc0a0ae12c87d2a3bba0d0bd6e5ec6` and `resp_047a7a3f7a04ce3f006adc0a1b81b487d2b48b2337965f4f8b`. [Original model calls](artifacts/original-model-calls.json) preserve their instructions, inputs, output schemas and actual JSON output. The full preceding interaction, plan, tools/effects and performance traces remain in the consolidated audit dossier.

1. **Dead guidance:** the payment acknowledgment/next-step rule was edited in `nodes/resolver_consultas_informativas/response_contract.txt`, an audit-only legacy bundle. The production compiler sent shared reply core, record-field semantics and payment disclosure only. That explains why the apparent fix could not affect the first reply. The record-field rule did reach the call, but it alone did not stop the model from inferring a balance or requesting proof.
2. **Mixed instructions:** handoff system prose required restating verified facts; the contract said not to repeat the problem/total; another contract bullet required the facts clause again. Combined with the full purchase profile and preceding answer, this encouraged repeat status plus administrative outcome prose. Success calls also carried a lengthy menu of failure branches. The actual handoff instructions were 3,872 UTF-8 bytes.
3. **Two distinct claim failures:** first-turn model output genuinely returned `reported_payment:null` despite the customer saying she had paid. On the second turn, the model returned `{amount:null,currency:null,method:Yape,claimed_success:true}` correctly. The service deliberately ignored this sidecar on escalation, so persisted state remained null. These are not both model failures.
4. **Partial lean-path migration:** `information_flow` routes still ran the general extractor from a fresh/transient plan. The first fee/public turn carried planning, RSVP and contact fields even though the router already selected information work. Later turns were somewhat narrower but still carried RSVP/contact. The extraction stage accounted for much of the observed 7.6–13.3s latency. A call remains necessary to capture typed queries, references, mixed fee topics and ambiguity; no keyword route or assumed query replaces it.
5. **Incomplete tests:** legacy prompt tests could inspect audit-only files while actual-request contracts checked structural bindings rather than arbitrary prose meaning. The live payment assertions covered a number and a handoff, not retention of the customer claim. Hard-assertion passes were correctly separated from language findings, but were not proof of a complete fix.

## Expected behavior and implementation

- A pending PEN161.20 purchase is a purchase total, not verified received funds or a remaining balance. A reported paid-in-full claim retains unknown amount/currency; never copy the backend total into that claim. Acknowledge the report and offer team review without asking the customer to repeat it or obtain proof.
- A confirmed takeover executes once, retains the extracted claim on that request and leaves unrelated parked requests intact. The acknowledgment after takeover remains deliberately silent. Different factual questions continue to be answered.
- Pending-payment guidance is a tracked compiler module selected only from typed pending-purchase evidence on purchase tasks. It is absent on public FAQ and approved-only purchase calls. The retired node bundle remains historical, not a second active instruction source.
- The existing support output schema emits typed evidence before prose and clarifies that a claim can exist without amount/method. There is no extra classifier or model call. The service persists the validated sidecar after handoff; the complete profile and its provenance remain unchanged.
- Handoff instructions are consolidated into one short outcome contract. They retain failure/unknown/not-retried distinctions, truthful receipts and no promised human arrival, without requiring a second payment-status verdict or proof request. No canned customer response or generated-text replacement is introduced.
- The routed information call uses a projection-only established information domain and a typed scope that omits provider, RSVP and contact fields/modules. Persisted node, real authorization and complete customer profile are untouched. Unsupported requested operations remain expressible; route selection never grants execution.

## Validation boundaries

The [frozen selected manifest](targeted-check.json) permits six cases once, concurrency one, no judges or semantic retry, plus at most ten supervised turns on the three seeded fixtures, with an additional USD0.25 ceiling. Only development may be deployed. Each fixture conversation requires a whole-partition reset. Results, costs, hashes and exact Spanish replies will be recorded after execution. The earlier failures remain unchanged. The pending review lock is not approved by these targeted checks.

Official documentation context: [Structured Outputs can still contain mistakes](https://developers.openai.com/api/docs/guides/structured-outputs#handling-mistakes). Schema compliance is not semantic correctness; this diagnosis rests on the retrieved calls and repository execution paths.
