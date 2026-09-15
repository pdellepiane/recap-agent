# Findings: simplify ownership before adding handoffs

Audit date: 2026-09-09. Confidence is high in the measured complexity and identified failure mechanisms, moderate in the proposed boundaries, and unmeasured for the performance of a replacement architecture.

## What was actually examined

The principal fixed comparison is live Lambda run `eval-2026-09-09T18-23-59-665Z-b67635c8`: 83 cases, 123 turns, 75 passing cases and eight failures. These are development evaluations, often with frozen backend fixtures; they are not a production traffic sample. Their distribution cannot establish customer demand or production failure rates.

Read complete turn sequences for purchase ambiguity, mailbox support, quote closure, planning, FAQ interruption, RSVP switching, and uncertain human escalation. Retrieved stored Responses and input items directly from OpenAI for selected complete sequences, plus the last two turns of a later closing run. Private raw payloads remain in `.openai-audits`; the dossier contains measurements and references only. The fresh replay and deployment observations are recorded in the dated note.

The working tree was already dirty and another development effort was deploying concurrently. Local source observations and earlier live behavior are distinguished throughout. No change to runtime, prompts, infrastructure, or regression definitions was made by this audit.

## 1. The concern is supported, but the product has several real workflows

This service handles event planning across multiple provider needs, purchase and payment reads, event lookup, invitation responses, general information, account recovery, images, and human support. Stateful ambiguity, protected records, explicit authorization, uncertain writes, and interruptions are real requirements. Removing their controls would simplify code by removing behavior the product already promises.

The avoidable part is the concentration and overlap: `agent-service.ts` was 11,140 lines, `openai-agent-runtime.ts` 2,565, and `information-orchestrator.ts` 1,873 when inspected. There are 109 text prompt files and 29 node configurations. Size is a maintenance signal, not proof of a defect by itself.

The current implementation separates model stages rather than persistent business ownership: a delivery classifier uses Responses directly; a `plan_extractor` Agent returns structured intent; service code normalizes and routes it; a node-specific reply Agent composes the result and can expose tools. Image inspection is separate. No SDK handoff configuration was found in this runtime. Calling the stages separate agents does not make purchases or planning independently owned workflows.

## 2. Live context is broader than the task requires

From the fixed 123-turn run:

| Model stage | Recorded stage references | Median instruction bytes | Median input bytes | Top-level schema fields |
| --- | ---: | ---: | ---: | --- |
| Delivery classifier | 115 | 9,227 | 698 | 9 |
| Extraction | 114 | 13,163 | 1,971 | 30 in 93 calls; 37 in 18; 33 in 3 |
| Reply | 75 | 13,417 | 3,947 | 2 in 65 calls; 3 or 4 in the remainder |

72 turns have all three stage references, 42 have two, four have one, and five have none. References are not an exact count of underlying requests: tools and retries can add calls. Some paths render without a reply model. Among turns with reported totals, median token usage is 11,005.5; median recorded runtime duration is 6,719 ms. Cached tokens are included; these numbers are not uncached billing totals.

Directly retrieved purchase and mailbox extraction calls include provider categories, provider fit criteria, guest ranges, budgets, RSVP party fields, and contact fields. A payment request also receives suggested provider categories and their priority order. This is observed context contamination, not just an estimate from file sizes.

`extract()` enables information, RSVP, and planning from feature flags. Plan state further narrows some capabilities, but business-domain isolation is incomplete. `projectExtraction()` exists in a separate module, yet the source search found no caller in `src` beyond its definition. Therefore that abstraction is not evidence that actual extraction follows it.

The static audit reports zero violations, but its sample initial profile measures 9,999 instruction bytes and 16 fields, whereas retrieved live calls have 13,163 bytes and 30 fields. Its classifier sample records eight fields while live telemetry records nine. These are different profiles and sampled measurements, not a valid before/after comparison. Instrument the actual request construction path and assert absence of unrelated content there.

## 3. A concrete failure occurs after a correct model decision

In the payment-confirmation scenario, turn 0 requests confirmation of payment; turn 1 repeats the request and says a gift was purchased; turn 2 explicitly requests recorded status and amount, excluding document delivery.

The stored turn-1 extraction returns `ambiguity.status=ambiguous`, with alternatives `purchase.orders.read` and `confirmation_document.send`. The reply input instead contains `ambiguity.status=clear` and a completed purchase result. The reply reports the approved payment and recorded amount.

Those facts were present in the supplied backend evidence. The judge's allegation that the facts were invented is therefore not supported by the raw reply input. The actual issue is premature resolution of the operation ambiguity.

The inspected `normalizeInformationExtractionAmbiguity()` clears ambiguity whenever non-FAQ information requests exist. It supplies no new evidence that distinguishes status lookup from sending a document. This is precisely the kind of semantic override a smaller ownership model should eliminate. The invariant should be: unresolved operation ambiguity remains unresolved until structured evidence resolves it. A new specialist running behind the same normalization would still fail.

## 4. Closure exposes both redundant instructions and effect ownership

A later fixed run, `eval-2026-09-09T19-33-11-292Z-fe18616f`, processes a five-turn close flow using 94,194 total tokens and 62,848 ms of evaluation latency. It fails structural checks: contact details alone invoke `finish_plan`, and the fixture records two successful quote writes rather than one. The final semantic judge passes. Fluent final text therefore does not prove correct execution.

The common planning instruction says to confirm temporary saving when the user wants to pause or close. The close-node instructions require definitive quotation submission after confirmation. Both appear in retrieved closing reply instructions. This is a concrete conflict, although the audit does not prove that it caused the duplicate submission.

A planning specialist should own the whole sequence: collect missing data, present the exact pending submission, interpret explicit authorization, execute once through a guarded effect service, and describe the receipt. Do not split interview, selection, contact capture, and close into independent agents with repeated reinterpretation.

## 5. Recommended architecture to test

Use four business specialists within the existing Lambda, one shared conversation identity, and a small persisted ownership record:

| Owner | Responsibility | Excluded authority |
| --- | --- | --- |
| Planning | Event needs, provider search, grounded selection, quotation preparation and confirmation | Purchase data and invitation writes |
| Purchases | Gift/order status, selection, reference resolution, payment questions | Sending unsupported documents or treating images as verified payment |
| Invitations | Identify the event/person, read attendance, interpret explicit changes | Provider close and purchase disclosure |
| General support | FAQ, event information, account-problem conversation, support escalation | Inventing host-finance access or automatic protected writes |

These are proposed boundaries, not four new services or Lambdas. Authentication, authorization, capability checks, concurrency, persistence, and idempotent effects stay in shared typed runtime services. Image inspection is an evidence-producing capability, not a long-lived conversation owner. Each specialist receives only the authorization result it needs; credentials stay outside model context.

A small entry/switch decision handles delivery disposition, initial ownership, explicit task changes, and ambiguous ownership. It must classify meaning with structured output, never keywords. Combine it with the existing delivery classification if experiments preserve suppression quality; do not merely add a fourth mandatory model stage. For established turns, test direct invocation of the saved owner with an explicit transfer outcome. Detecting a genuine topic change still requires semantic interpretation; persistent ownership must not trap the user.

A transfer carries the pending task, unresolved alternatives, grounded entity references, last relevant question/answer, completion receipts, and return owner. Derive it from validated state. Do not trust an unconstrained model summary to overwrite protected state or settled facts. Store owner selection across requests; a per-run SDK handoff is not durable conversation ownership on its own.

SDK handoffs can implement silent transfers, but the default forwards conversation history. `inputFilter` controls that history; handoff arguments do not replace the recipient's main input. Use explicit context projection and expose only valid destinations. These semantics were checked against the installed SDK and [official handoff documentation](https://openai.github.io/openai-agents-js/guides/handoffs/).

Only the final user-facing response is delivered. Transfer events remain internal. Human escalation is different: it is an external business action, needs an outcome receipt, and should be communicated truthfully to the user.

For mixed requests, retain all requested tasks. Independent reads can run through existing bounded orchestration and produce one response. A FAQ interruption can be answered as a tool/subtask with planning retained as owner. A true switch to purchases can transfer ownership and preserve a return pointer. A request involving a write must retain its own explicit authorization. Avoid agents passing control repeatedly to assemble a simple mixed answer.

## 6. Compare simplifications rather than committing to an agent count

| Option | Expected value | Main risk | Recommendation |
| --- | --- | --- | --- |
| Keep runtime, connect real domain projection, remove semantic overrides and duplicate policies | Smaller change; addresses demonstrated defects | Central service remains difficult to maintain | Establish as the low-complexity baseline |
| Four persistent specialists with bounded silent transfer | Clear ownership and smaller schemas/tools | Transfer context loss; extra calls if layered onto existing pipeline | Preferred architecture experiment |
| Agent for each decision node | Superficially modular | Recreates 29-node graph as transfer machinery | Reject |
| One unrestricted tool-using agent | Less routing code | Broad context and weak write boundaries | Reject for existing capabilities |

The most useful first experiment is planning through quotation completion, because it tests sustained ownership and a real effect boundary. Purchases are the next split, with operation ambiguity preserved. Run the original and candidate on identical fixture worlds and conversation seeds. Include successful paths as well as failures. Repeat stochastic cases; one pass is not evidence of superiority.

Acceptance should include all mandatory structural and semantic expectations, unchanged write counts and authorizations, full interruption/resume behavior, measured serialized instruction/input/schema/tool bytes, model requests, cache-aware token usage, median/p95 latency, and code/prompt rules deleted. A specialist architecture that adds abstractions without deleting competing ownership has not simplified this system.

No latency or accuracy improvement is claimed without this comparison. The evidence supports making ownership harder and context smaller; it does not yet establish that SDK handoffs outperform a simpler typed dispatcher.
