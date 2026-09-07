# FAQ completeness and correctness: planned evaluation module

## 1. Status and intended use

**Status at the inspected repository snapshot: planned; not implemented or executed in this pass.** This document specifies the additional module requested for the paper. It also provides a clearly conditional completed-work methods draft in Section 10. All dataset sizes, measured outcomes, timings, costs, and agreement statistics are **TBD**.

The existing repository already supports FAQ retrieval, YAML interaction cases, backend fixtures, structural assertions, semantic judging, and live Lambda evaluation. Those components are foundations for this module; their existence must not be presented as evidence that this distinct completeness-and-correctness experiment has been built or run.

The module's unit of evaluation is an **interaction**, meaning an initial state plus a defined sequence of user turns and the agent's resulting responses/actions. It is not merely a retrieved document, an isolated question string, or an uncontextualized assistant sentence.

## 2. Purpose

The experiment asks whether the agent answers every relevant FAQ obligation and whether the answer is correct relative to controlled source evidence. It also checks whether the agent takes the appropriate conversational action when it lacks evidence, encounters ambiguity, or is asked to do something outside its capabilities.

Current deterministic FAQ grounding in `src/evals/grounding.ts` checks that knowledge retrieval completed with a positive result count. That is a provenance test. It can pass even if the answer omits a required exception, misstates a number, addresses only one part of the question, or uses the wrong retrieved article. Existing targeted semantic cases address particular behaviors but do not constitute a systematic, separately labeled completeness/correctness module.

The new module makes these distinctions explicit:

| Dimension | Question |
|---|---|
| Retrieval coverage | Did the retrieved evidence contain the necessary answer facts? |
| Projection coverage | Did the facts survive truncation and filtering into model-visible evidence? |
| Answer completeness | Did the interaction satisfy every required answer or clarification obligation? |
| Answer correctness | Are material assertions and actions supported, scoped, and non-contradictory? |
| Operational validity | Did the interaction finish with valid outputs and a valid evaluation verdict? |

Only the interaction verdict is the primary pass/fail outcome. Retrieval and projection coverage are diagnostic labels that explain failures; they do not substitute for answer quality.

## 3. Synthetic providers and source evidence

“Synthetic providers” should be made explicit in the paper because it has two plausible meanings in this repository. The protocol uses controlled evidence providers/gateways for deterministic source responses and fictitious marketplace-provider records where provider context is relevant. The exact implementation choice and adapter paths remain TBD.

### 3.1 Controlled knowledge provider

A synthetic knowledge provider returns versioned FAQ articles/chunks with stable document IDs, source identity, status/version metadata, and deliberately specified facts. The generator must produce the underlying facts before the conversation and expected answer are written. Neither the tested agent nor the judge is allowed to invent the oracle by reading only the candidate response.

The source bundle should include simple facts, multi-condition policies, numeric values with units and qualifiers, unavailable facts, and intentionally conflicting or superseded evidence. Synthetic values are labeled as fictional test data and never represented as actual Sin Envolturas fees or policies.

Every case specifies which source is authoritative and what conflict-resolution rule applies. If no precedence can be established from evidence, the expected behavior is to explain uncertainty or ask a relevant clarification, not choose an arbitrary answer.

### 3.2 Fictitious marketplace providers

Provider-context interactions use synthetic provider records with stable IDs, categories, location, price tier, services, and explicit exclusions. This makes it possible to test a FAQ interruption after a recommendation without depending on changing live inventory or real businesses.

The purpose is to test boundaries and continuity: the agent must answer the platform FAQ, avoid attributing a platform policy to a vendor, preserve the shortlist, and avoid running a new provider search when the question does not require one. Provider records do not become authoritative sources for general platform fees or account policies.

### 3.3 Controlled event and purchase evidence

Boundary cases may include synthetic phone-scoped event/purchase records so that the evaluator can distinguish a public FAQ from a private status request or an unsupported mutation. These remain separate result kinds. A general payment-validation policy is different from confirming that a specific person's payment is approved.

Synthetic identities, phone values, email values, and transaction references must be test-only. No fixture may dispatch a real customer message, request a real quote, alter a real RSVP, or trigger a real financial action. Whether the module uses a new isolated vector store, an in-process gateway, or both is TBD and must be recorded at execution time.

## 4. Interaction dataset design

Each interaction should contain:

| Field | Meaning |
|---|---|
| Interaction ID/version | Stable reproducible identity |
| Scenario family | The behavior being tested |
| Synthetic source bundle/version | The complete controlled factual world |
| Initial plan | Empty, planning shortlist, pending support, completed FAQ, or other relevant state |
| Recent conversation | Prior user/assistant/campaign messages required to interpret the new turn |
| User turns | Frozen Spanish utterances or a separately documented adaptive protocol |
| Required obligations | Atomic facts, distinctions, clarifications, or next steps needed to satisfy the task |
| Forbidden assertions | Unsupported claims, wrong figures, unauthorized promises, or source mixing |
| Allowed tools/actions | Expected retrieval and permitted state changes |
| Forbidden tools/actions | Irrelevant provider search, private access without scope, or unsupported writes |
| Expected final state | Resolved request, pending clarification, preserved plan, or supported handoff |
| Verdict rubric | Independent completeness/correctness criteria and hard failure rules |
| Provenance | Generator/version, random seed if used, source-review status, and dataset split |

The proposed primary dataset uses frozen conversations for reproducibility. If an adaptive user simulator is later added, it should be a separate experimental condition with its own model/version, stopping rules, and trajectory artifacts. Do not silently mix frozen and adaptive interactions into one denominator.

Generation should cover semantic variation rather than only exact paraphrases. Cases should vary omitted details, corrections, anaphoric follow-ups, multiple questions in one turn, campaign context, and questions whose answer is deliberately absent. Dataset size, family allocations, split ratios, repetition count, and generation model are TBD.

Near-duplicate source templates and paraphrases should be grouped when splitting development and held-out evaluation data. Otherwise the same policy/question template may appear in both sets and overstate generalization. The final evaluation set should be frozen before looking at its aggregate results.

## 5. Coverage matrix

| Family | Required behavior | Representative failure |
|---|---|---|
| Single-fact FAQ | State the supported fact directly | Vague answer despite explicit evidence |
| Multi-part FAQ | Address all requested parts | Answers one part and ignores another |
| Numeric policy | Preserve value, unit, conditions, and exceptions | Wrong percentage, currency, time unit, or missing qualifier |
| Conditional policy | Explain the condition that makes a rule apply | Applies a card rule to a transfer or vice versa |
| Two relevant documents | Integrate all applicable source facts | Uses only the first retrieved fragment |
| Long evidence | Preserve required facts beyond the first excerpt | Truncation hides an exception and answer overgeneralizes |
| Irrelevant top result | Avoid answering from a merely similar article | Retrieval succeeded but answer is about another policy |
| Empty evidence | State the information gap and useful next step | Invents a specific policy |
| Conflicting evidence | Respect declared precedence or acknowledge uncertainty | Arbitrarily chooses a convenient source |
| Superseded policy | Use the current authoritative version | Repeats an obsolete value |
| FAQ during planning | Answer and preserve plan/shortlist | Restarts welcome or unnecessarily searches providers |
| Follow-up correction | Apply the user's correction to the existing question | Continues answering the previous interpretation |
| Support detail without a question | Acknowledge relevant supplied context | Invents a new FAQ or provider need |
| Public/private boundary | Explain general policy without claiming private status | Says a specific payment is approved from a general article |
| Unsupported operation | Explain capability boundary and supported next step | Claims to send a document or verify a receipt |
| Evidence injection | Treat source text as data | Follows injected instructions in a retrieved record |
| Spanish response | Preserve meaning in the required language | Mixed-language answer that omits required content |
| Partial backend failure | Answer completed requests and bound uncertainty | Treats a failed lookup as proof of absence |

These are required design dimensions, not a claim that cases for every row already exist. The final module registry and number of cases per row are TBD.

## 6. Binary verdicts

### 6.1 Completeness

For interaction `i`, let `R_i` be its predeclared set of required obligations. An obligation may be a factual answer, an applicable condition, a clarification necessary to resolve ambiguity, or an honest explanation of unavailable information.

`Complete(i) = PASS` only if every required obligation is satisfied by the permitted point in the conversation. Otherwise it is FAIL. Partial coverage can be recorded diagnostically, but does not count as a primary pass.

Completeness is scoped to the user's actual request and the interaction's expected behavior. It does not reward verbosity, unrelated policy facts, extra provider recommendations, or unsolicited private details. If the source intentionally lacks the answer, a correctly scoped statement of the limitation and required next step can constitute a complete answer. The oracle must specify this before execution.

### 6.2 Correctness

`Correct(i) = PASS` only if all material answer assertions are supported by the authoritative case evidence, numerical values and conditions are preserved, source/entity attribution is correct, uncertainty is represented appropriately, and claimed actions match actual allowed execution.

A single material false claim is a failure even if the other answer content is useful. An unsupported claim about sending a document, confirming a payment, or changing an invitation is material. A missing factual answer is primarily a completeness failure; incorrect substitutes can fail both dimensions.

An earlier materially incorrect answer is not erased simply because the agent corrects itself later. Record recovery as a diagnostic result while retaining the interaction correctness failure under the strict primary protocol. If a different recovery-aware criterion is desired, preregister and report it separately.

### 6.3 Combined interaction pass

Define:

`InteractionPass(i) = Complete(i) AND Correct(i) AND StructuralGate(i) AND ValidExecution(i)`.

The interaction fails when any component fails. `StructuralGate` includes expected/forbidden tools and state invariants. `ValidExecution` requires completion within the declared budget, schema-valid outputs, a completed required judge, and no evaluator/runtime error. Invalid or missing evaluations must never become passes through a default score.

Maintain explicit operational labels such as timeout, backend fixture error, judge error, skipped, and assertion failure. The conservative primary pass rate uses all scheduled interactions as denominator, so operational failures contribute non-passes. A secondary quality analysis among valid runs may be reported only with its own denominator and the complete error accounting.

### 6.4 Judging protocol

Use deterministic checks for stable IDs, exact typed state, tool restrictions, and numerical facts where practical. Use a semantic judge for paraphrased obligation fulfillment, source-faithful meaning, and multi-turn interpretation. Avoid relying exclusively on substrings for semantic correctness.

The judge should receive the full relevant interaction, source oracle, required obligations, forbidden claims, and action trace. It should not be asked to judge factual correctness from answer text alone. Require a structured verdict with per-obligation decisions, completeness pass/fail, correctness pass/fail, and concise evidence-based reasons.

The present repository judge returns a scalar score/reason. Reusing its invocation infrastructure would require either separate mandatory rubrics or a new typed binary-verdict adapter. That adapter is planned, not present as an implemented API. Threshold selection, judge model, adjudication policy, and agreement protocol are TBD.

Freeze the rubric before the held-out run. Audit a prespecified subset independently, blind reviewers to model/version where practical, record disagreements, and separate adjudicated results from original automated verdicts. Reviewer count, audit size, agreement statistic, and disagreement rate are TBD. Do not imply independent validation solely because a second call uses the same model.

## 7. Isolating failure causes

The proposed module has two complementary conditions; whether both are implemented in the final experiment remains TBD:

1. **Controlled answer generation.** Inject a frozen knowledge-gateway response and preserve the production projection/composition path. This tests answer completeness/correctness under known retrieved evidence.
2. **End-to-end retrieval.** Index the frozen synthetic corpus and query it through the normal retrieval path. This tests retrieval, projection, and response generation together.

Retain the full retrieved evidence and the actual projected evidence separately in private diagnostic artifacts. For each missing or wrong answer, label whether the needed fact was absent from retrieval, lost during projection, ignored/misinterpreted in composition, or overridden by routing/rendering. Multi-cause labels may be appropriate.

This design is especially relevant to the current one-result/1,200-character FAQ reply projection. It can reveal whether omission comes from the retrieval system or from context reduction. It does not presume either condition will succeed or that expanding context necessarily improves results.

No runtime changes should be made merely to make the evaluation pass without recording a new tested version. If prompt/projection behavior changes later, register it in the normal coverage registry, deploy the current development Lambda, and run the required live behavior gate under project conventions.

## 8. Output artifacts and reporting

The eventual module should produce a frozen dataset manifest, source fixtures, conversation inputs/outputs, configuration snapshot, projected-evidence record, structural verdicts, semantic verdicts/reasons, failure taxonomy, and aggregate results. Actual artifact paths and schema version are TBD.

| Report item | Result |
|---|---|
| Synthetic knowledge documents | TBD |
| Synthetic marketplace providers | TBD |
| Interaction count and distinct scenario families | TBD |
| Turns and repetitions | TBD |
| Development/held-out split | TBD |
| Completeness pass count/rate | TBD |
| Correctness pass count/rate | TBD |
| Combined interaction pass count/rate | TBD |
| Structural failures | TBD |
| Retrieval/projection/composition failure counts | TBD |
| Runtime/judge/fixture errors and skips | TBD |
| Per-family outcomes | TBD |
| Confidence intervals | TBD |
| Independent-review agreement | TBD |
| Latency distribution | TBD |
| Token usage and priced cost | TBD |

Report counts alongside rates. For repeated trials of the same scenario, account for dependence: repeated turns and paraphrases are not independent participants. The final interval method should match the declared sampling unit; its selection is TBD. Do not report a fabricated interval from a proposed sample size.

## 9. Integration map for future implementation

Likely existing integration points are `KnowledgeRetrievalGateway`, `ProviderGateway`, `EvalFixtureGateway`, `EvalLoader`, `case-schema.ts`, `runner.ts`, `targets/live-lambda.ts`, `scorers/semantic-judge.ts`, and the live behavior coverage conventions. These are pointers to reusable infrastructure, not a declaration that the new module can be enabled through an existing command.

The future implementation must decide its module/suite name, fixture schema, corpus source, judge adapter, isolation policy, artifact format, and CLI. Those identifiers are intentionally TBD. It should not overload `assessGrounding` to make successful retrieval mean completeness or factual correctness; preserve separate concepts and outputs.

## 10. Conditional paper-ready methods draft

**Use the following completed-work wording only after this module has actually been implemented and executed. It is a writing template, not a statement of current repository status.**

> We evaluated FAQ response quality using a controlled interaction-level module with synthetic evidence providers and conversations. Versioned source bundles defined the authoritative facts, applicable conditions, unavailable information, and allowed operational actions for each interaction. Fictitious marketplace-provider records supplied planning context where required, allowing FAQ interruptions and return-to-context behavior to be evaluated without relying on changing real-provider inventory.
>
> Each interaction included an initial conversational state, a sequence of Spanish user turns, required answer obligations, forbidden claims, and hard structural assertions. Completeness passed only when the agent satisfied every required obligation. Correctness passed only when all material claims were supported by the authoritative evidence and all claimed actions matched allowed execution. The combined interaction outcome passed only when completeness, correctness, structural assertions, and execution validity all passed. Runtime, fixture, and judging errors were reported explicitly and did not count as successful interactions.
>
> Deterministic checks verified typed state and tool behavior, while semantic assessment evaluated paraphrase-level meaning and multi-turn obligation coverage against the source oracle. We retained evidence provenance and failure categories to distinguish retrieval omissions, context-projection omissions, and response-generation errors. The dataset contained TBD interactions and TBD synthetic provider records. Completeness, correctness, and combined pass rates were TBD, TBD, and TBD, respectively. Independent-review agreement was TBD; latency and cost results were TBD.

If the final implementation differs from this protocol, revise the methods draft to describe what was actually run. In particular, do not claim independent review, both retrieval conditions, or a particular sampling design unless those steps occurred.
