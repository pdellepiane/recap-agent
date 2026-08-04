# Prompt-guidance review — 2026-08-04

## Model-guidance finding

OpenAI's current production API guidance is for the GPT-5.6 family. The official
model catalog and model-guidance page do not list GPT-6 or a GPT-6 prompting
guide as of 2026-08-04. This review therefore does not invent GPT-6-specific
rules. It applies the latest published GPT-5.6 guidance to the project's active
`gpt-5.6-luna` workload.

Primary sources:

- [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI model catalog](https://developers.openai.com/api/docs/models)
- [GPT-5.6 Luna model page](https://developers.openai.com/api/docs/models/gpt-5.6-luna)

## Guidance mapped to the implementation

| Published guidance | Project evidence | Result |
|---|---|---|
| Favor lean prompts and state each instruction once | Route-scoped shared files, capability-scoped extractor files, duplicate paragraph/rule gates, and removal of three remaining duplicated negative rules | Implemented |
| Expose only task-relevant tools | `nodePromptManifest` owns an allowed-tool list for every reply node and request tests reject unrelated tools | Implemented |
| Preserve outcomes, constraints, evidence, success criteria, and output shape | Canonical typed decision evidence plus node-specific system, response-contract, and tool-policy files | Implemented |
| Control general response length with API parameters | Active requests use `text.verbosity: low`; Spanish prompt files keep only product-specific response requirements | Implemented |
| Preserve the existing reasoning baseline during migration | All active GPT roles use `reasoning.effort: none` | Implemented |
| Make prompt edits surgical and rerun representative evaluations | Historical-vs-current static comparison plus correctness and request-shape suites | Implemented locally |
| Measure tokens, cache behavior, cost, and quality on the project's workload | Non-generative input counts are captured; production response IDs, cache usage, quality, and final cost require a successful live turn | Partially blocked by API credits |

OpenAI reports directional internal results where leaner prompts improved some
evaluation scores while reducing tokens and cost, but explicitly advises teams
to validate on their own workloads. The project treats those figures as
motivation, not as evidence of Sin Envolturas quality.

## Remaining prompt opportunities

1. The classifier prompt remains unchanged at 1,847 static input tokens. It is
   the next obvious slimming target, but it controls suppression and should not
   be rewritten until the live classifier evaluation set can run.
2. Static prompt construction is now measured, but successful production-shaped
   classifier/extractor/reply payloads must still be retrieved and compared once
   API credits are restored.
3. After successful turns exist, measure prompt cache writes and reads before
   adding explicit cache breakpoints. Do not optimize cache layout from static
   byte counts alone.

## Decision

Keep the current route-scoped composition and make future edits one rule group at
a time. A candidate prompt is promotable only when it preserves required
evidence and behavior, passes the structural gates, reduces measured payload or
fixes a demonstrated quality gap, and passes representative evaluations.
