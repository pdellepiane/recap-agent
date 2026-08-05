# OpenAI prompt comparison — 2026-08-04

## Answer

The prompt refactor materially changed the payload sent to OpenAI. Across one
classifier shape, four extractor capability profiles, and all 27 reply routes,
the exact serialized comparison payload fell from 635,882 to 319,703 bytes
(49.72%). Non-generative OpenAI input counting fell from 135,347 to 66,651
tokens (50.76%).

This aggregate is a fixed static comparison suite, not the token count of one
production turn. Its purpose is to isolate prompt construction changes across
every supported route.

## Method

- The historical side is reconstructed directly from Git ref `dd0b6b6^`, before
  the prompt-scoping refactor.
- The current side uses the production `PromptLoader` and current prompt
  manifest.
- Both sides use the same model field (`gpt-5.6-luna`), identical scenario input,
  `reasoning.effort: none`, and `text.verbosity: low`.
- Exact UTF-8 instruction bytes and serialized request bytes are calculated
  locally.
- Exact input tokens are measured with `/responses/input_tokens`. That endpoint
  counts the candidate payload without creating a Response or generating text.
- The gate fails if any non-classifier route does not shrink or if the current
  prompt contains repeated normalized paragraphs.

The classifier is intentionally visible as an unchanged control: 1 file and
1,847 input tokens on both sides. Rewriting it without live quality evaluation
would create avoidable suppression risk.

## What changed

- Reply prompts no longer receive all eight shared modules on every route.
  Every node receives the four core modules; planning and question policies are
  loaded only for nodes that need them.
- Extractor prompts no longer receive one universal schema/prompt bundle. Each
  state-machine capability profile gets only the applicable extraction modules.
- Tool lists are node-scoped.
- Prompt files have stable rule ownership and structural duplication/relevance
  gates.
- Three residual negative rules duplicated between output style and common
  anti-patterns were removed from the latter while retaining their owning rule.

See [findings.md](./findings.md) for every route and [comparison.json](./comparison.json)
for the machine-readable evidence.

The final development Lambda results are in
[live-validation-2026-08-05.md](./live-validation-2026-08-05.md).

## Quality boundary

Smaller is not sufficient by itself. Existing correctness, structured-output,
state-machine, evidence-completeness, ambiguity, and provider-reference tests
remain prerequisites. After credits were restored, the three-case live gate
passed at 1.0 and promoted a measured Luna cost of `$0.00128448` per successful
full turn.
