# Evaluation Framework

This document explains how to benchmark `recap-agent` without turning the suite into a brittle set of transcript snapshots.

## Goals

The evaluation framework is designed around four constraints:

1. We need the same case definitions to run against both a deterministic local harness and the live deployed Lambda contract.
2. We need stable, trackable outputs for benchmarking model and prompt changes over time.
3. We cannot rely on exact full-response matching because the agent is still evolving.
4. We need enough structure to catch regressions in state, trajectory, tool use, and provider handling, not just surface phrasing.

The framework therefore treats evaluation as a layered measurement problem:

- deterministic checks for state and flow correctness;
- tolerant text checks for stable contractual language;
- optional model-graded checks for subjective qualities such as helpfulness or conversational efficiency;
- standardized result artifacts for longitudinal comparison.

## Research Basis

The design is informed by current agent-evaluation practice and benchmark design.

- OpenAI, *A Practical Guide to Building Agents*:
  - Start with the strongest model to establish a performance baseline, then swap in smaller models and keep the evals constant while measuring the tradeoff.
  - Treat tools, instructions, and orchestration as first-class pieces of the system, which means the eval harness must capture more than final text.
  - Source: https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
- LangSmith evaluation concepts:
  - Separate offline evaluation from online evaluation.
  - Organize evaluation around datasets, experiments, runs, and evaluators.
  - Use deterministic evaluators where possible and add LLM-as-judge only where a code check is insufficient.
  - Source: https://docs.langchain.com/langsmith/evaluation-concepts
- Anthropic, *Building Effective AI Agents*:
  - Prefer modular, composable systems with explicit context management and evaluator-optimizer patterns when quality needs iterative improvement.
  - Source: https://resources.anthropic.com/building-effective-ai-agents
- Benchmark families that focus on end-to-end execution rather than isolated prompt quality:
  - `τ-bench`: https://arxiv.org/abs/2406.12045
  - `GAIA`: https://arxiv.org/abs/2311.12983
  - `SWE-agent`: https://arxiv.org/abs/2405.15793

The practical outcome for this repo is straightforward:

- optimize for end-state plan correctness and trajectory invariants first;
- test across models and prompt bundles using one shared dataset;
- keep benchmark cases reusable and parameterized;
- make every failure legible enough to tell whether the regression came from extraction, orchestration, tool use, provider ranking, or response quality.

## High-Level Architecture

The evaluation subsystem lives under [`src/evals`](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/src/evals).

- [`case-schema.ts`](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/src/evals/case-schema.ts): typed schemas for cases, suites, matrices, expectations, scorers, turn envelopes, results, and reports.
- [`loader.ts`](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/src/evals/loader.ts): YAML or JSON loading, template merge, fixture imports, and variable interpolation.
- [`runner.ts`](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/src/evals/runner.ts): suite or case selection, target execution, expectation evaluation, scoring, and artifact writing.
- [`reporting.ts`](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/src/evals/reporting.ts): JSONL, JSON, and Markdown output plus aggregate summaries.
- [`targets/offline.ts`](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/src/evals/targets/offline.ts): deterministic local harness with in-memory plan storage, fixture-backed provider gateway, and fixture-backed runtime behavior.
- [`targets/live-lambda.ts`](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/src/evals/targets/live-lambda.ts): live Lambda adapter that normalizes deployed responses into the same turn envelope used by offline runs.
- [`scorers/semantic-judge.ts`](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/src/evals/scorers/semantic-judge.ts): optional model-based grader for rubric-driven judgments.

The git-tracked dataset lives under [`evals/`](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/evals).

- `cases/`: scenario definitions
- `templates/`: reusable base case definitions
- `fixtures/`: reusable seed plans and offline fixture fragments
- `suites/`: suite manifests
- `matrices/`: model and configuration matrices

Generated run artifacts are written outside version control under `.eval-runs/`.

## Targets

### Offline

The offline target is the default development surface.

It runs the real `AgentService` against:

- `InMemoryPlanStore`
- a fixture-backed `ProviderGateway`
- a fixture-backed `AgentRuntime`
- the real prompt loader from `prompts/`

Use offline runs for:

- PR validation
- regression testing
- prompt iteration
- model and config comparison without live provider or live Lambda variability

### Live Lambda

The live target calls the deployed Lambda Function URL and then hydrates the persisted plan from DynamoDB so the result envelope matches the offline shape as closely as possible.

By contract, live eval requests are sent in CLI mode so diagnostics are returned:

- request includes `client_mode=cli`;
- response includes `trace` and optional `perf` fields for evaluation assertions;
- telemetry persistence still happens server-side for all channels, including non-CLI traffic.

Use live runs for:

- contract verification against the deployed runtime
- catching integration drift between local assumptions and real deployment behavior
- validating trace and persisted-plan observability

Do not use the live target as the default inner loop. It costs more, takes longer, and is more exposed to environment drift.

## Case Authoring

An eval case is a structured scenario, not a golden transcript.

Every case can include:

- identity and metadata
  - `id`
  - `suite`
  - `version`
  - `description`
  - `tags`
  - `priority`
  - `status`
- execution scope
  - `targetModes`
  - `configOverrides`
  - `budget`
- scenario definition
  - `inputs`
  - `seedPlan`
  - `fixtures`
  - `variables`
  - `imports`
- validation
  - `expectations`
  - `scorers`
- maintenance notes
  - `notes`

### Variables

Variables let one case definition stay generic:

```yaml
variables:
  event_type: boda
  location: Lima

inputs:
  - text: quiero planear una {{event_type}} en {{location}}
```

### Templates

Templates let cases share defaults such as:

- target modes
- base scorers
- default notes
- budget defaults

### Imports

Imports let cases reuse external structured fragments such as:

- seed plans
- provider shortlists
- offline search fixtures
- repeated expectation blocks

Example:

```yaml
imports:
  - ../fixtures/seed-plans/recommend-catering-shortlist-edo.yaml
  - ../fixtures/offline/search-results/catering-shortlist-top-three.yaml
```

Imports are merged before the case body. The case body remains the final override layer.

This keeps the suite customizable and reduces copy-pasted provider payloads.

## Expectations

Expectations are deterministic or semi-deterministic assertions attached to a case.

Supported expectation families:

- `node_transition`
- `node_path_contains`
- `plan_field_equals`
- `plan_field_subset`
- `provider_results_contains`
- `tool_usage`
- `text_contains`
- `text_not_contains`
- `text_semantic`
- `trajectory_invariants`
- `budget_constraints`

### Why layered expectations

Exact transcript matching is usually the wrong contract for agents in active development.

Instead, the suite checks:

- whether the agent reached the correct node family;
- whether the final plan state is correct;
- whether prior selections were preserved;
- whether the right tools were used or avoided;
- whether required links or phrases are present;
- whether known anti-patterns were avoided.

This is much more stable than snapshotting an entire Spanish reply.

### Severity

Every expectation is either:

- `hard`: a failure should generally fail the case
- `soft`: a failure should reduce quality score without necessarily failing the case

Use `hard` for contract behavior. Use `soft` for preference-like quality checks.

## Scorers

Scorers convert expectation and trajectory quality into a normalized case score.

Current scorer types:

- `expectation_pass_rate`
- `budget_efficiency`
- `text_semantic`

### Recommended scoring strategy

Use a mixed model:

- hard gates for catastrophic failures:
  - wrong node family
  - lost selected provider
  - missing persisted state
  - invalid provider links
- soft quality scorers for:
  - helpfulness
  - recommendation differentiation
  - clarification efficiency
  - plan coherence across turns

The framework computes a weighted score per case while still exposing all raw expectation outcomes.

## Suites

The suite taxonomy is organized around product behavior instead of source directories.

Core regression suites:

- `entrypoint_planning`
- `clarification`
- `recommendation`
- `selection_continuity`
- `multi_need_planning`
- `state_and_resume`
- `search_failure_modes`
- `domain_knowledge`
- `trace_observability`

Benchmark or operator suites:

- `smoke`
- `dev_regression`
- `live_smoke`
- `benchmark_full`

### Recommended usage

- `smoke`: use during active iteration and before commits
- `dev_regression`: use before merges or before prompt or model updates
- `live_smoke`: use intentionally, with budget awareness
- `benchmark_full`: use for scheduled comparisons and research-grade benchmarking

## Run Matrices

Run matrices make configuration benchmarking first-class.

Each matrix entry can vary:

- target
- reply model
- extractor model
- reasoning effort
- prompt bundle label
- environment overrides
- notes

This is the main mechanism for comparing model or configuration changes without editing cases.

## Result Artifacts

Each run writes a dedicated directory under `.eval-runs/<run-id>/`.

Artifacts include:

- `results.jsonl`: one normalized result row per `(case, config, target)`
- `report.json`: machine-readable aggregate report
- `report.md`: human-readable leaderboard and summary
- `artifacts/<config>/<case>.json`: full case result envelope

Each normalized result includes:

- pass or fail status
- final normalized score
- expectation results
- scorer results
- node transitions
- latency and tool counts
- plan diff summary
- artifact paths
- full normalized per-turn envelopes

The aggregate report also includes:

- suite summaries
- config summaries
- target summaries
- flaky candidates when the same case shows inconsistent outcomes across configs or targets

## Commands

List available suites and case ids:

```bash
npm run eval:list
```

Run a cheap offline smoke slice:

```bash
npm run eval -- --suite smoke --target offline
```

Dry-run a larger matrix without executing it:

```bash
npm run eval -- --suite benchmark_full --matrix evals/matrices/models.yaml --dry-run
```

Run a single case:

```bash
npm run eval -- --case selection.choose_edo_from_shortlist --target offline
```

Render a saved report:

```bash
npm run eval:report -- --input .eval-runs/<run-id>
npm run eval:report -- --input .eval-runs/<run-id>/report.json --format json
```

## Safe Operating Workflow

Recommended workflow while the agent is under active development:

1. Add or update an offline case first.
2. Run a targeted offline smoke or single-case evaluation.
3. If the change is deployment-sensitive, run a very small `live_smoke` slice.
4. Only run broader matrices when explicitly benchmarking model or prompt changes.
5. Promote production issues into offline regression cases whenever possible.

This mirrors the offline to online feedback loop recommended by LangSmith:

- online or live behavior surfaces issues
- those issues become offline cases
- offline cases validate fixes cheaply
- live checks confirm the deployed contract

## Anti-Patterns

Avoid these when authoring or maintaining evals:

- exact full-transcript assertions for multi-turn agent replies
- hiding fixture logic inside test code instead of git-tracked case data
- coupling a case to one specific model phrasing
- mixing too many independent goals into one case
- using live Lambda as the default development loop
- adding only text checks while ignoring plan or trace state
- creating “pass” conditions that a model can satisfy while silently failing on tool use or plan continuity

## Current Limitations

This framework intentionally does not do a few things yet:

- It does not run the full suite in `npm run check`.
- It does not automatically compare against a checked-in baseline run yet.
- It does not automatically estimate token cost from real provider or model usage; dry-runs use case-level heuristics.
- The semantic judge is optional and will skip when `OPENAI_API_KEY` is not set.

Those are reasonable constraints for the current stage of the project. The main priority is to keep the evaluation system useful, inspectable, and cheap enough to use regularly.

## Adding a New Case

The target authoring experience is that a contributor can add a new case without touching TypeScript code.

Recommended process:

1. Choose the suite that best reflects the product behavior being tested.
2. Start from an existing template under `evals/templates/`.
3. Reuse imports from `evals/fixtures/` where possible.
4. Add only the expectations that reflect the actual contract you care about.
5. Prefer `plan_field_*`, `trajectory_invariants`, and `tool_usage` over exact reply text.
6. Add `text_contains` only for truly stable reply requirements such as URLs or critical wording.
7. Add a semantic scorer only when a deterministic check is not enough.

## Case Design Heuristics

For this agent, the most valuable checks tend to be:

- final persisted plan state
- active need continuity
- selected provider continuity
- correct transition family
- exposed trace observability
- provider shortlist contents and links
- not reopening already-resolved ambiguity

If a case fails, the report should make it obvious whether the fault was in:

- state
- trajectory
- tools
- shortlist
- trace visibility
- response quality

That is the standard this framework is designed to enforce.
