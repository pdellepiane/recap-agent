# Recap Agent: current capabilities and paper-writing dossier

Prepared on 2026-09-04 from repository source at commit `cce28e3b5c75863b1ff4e952055ba2ce2c7a9d7b`.

This is a new report, not a revision of the older project documentation. It describes the inspected implementation, its evaluation machinery, its boundaries, and the evidence a separate writing agent needs to prepare a paper.

Read these files in order:

1. [Implementation and capabilities report](report.md): architecture, complete capability breakdown, operational behavior, evaluation interpretation, limitations, and a paper outline.
2. [FAQ completeness and correctness evaluation](faq-evaluation-module.md): the planned module, an explicit pass/fail protocol, synthetic provider and conversation design, and a conditional paper-ready methods draft. Experimental values remain **TBD**.
3. [Source and evaluation index](source-index.md): source symbols, the complete loaded case catalog, suite membership, coverage registry, tests, and prompt files.

## Evidence status

- Runtime, schema, prompt, test, infrastructure, and evaluator source were inspected locally. Existing narrative documents were not treated as authoritative descriptions of current behavior.
- No deployment, AWS inspection, backend mutation, model evaluation, or live interaction was performed for this report. The checked-out implementation is not proof of the configuration or behavior of a currently deployed Lambda.
- The evaluation catalog was loaded through the repository's `EvalLoader`, including schema validation, template inheritance, and imports.
- `npx vitest run tests/live-behavior-coverage.test.ts` passed: one test file, one test. This checks registry structure; it does not establish conversational success.
- The existing working-tree modifications to `.continues-handoff.md` and `docs/implementation-log.md` were left untouched. This task adds only this dossier.
- The additional FAQ evaluation module is **planned, not implemented or executed**. Its conditional methods draft is written in completed-work language for later use, but must not be represented as an accomplished experiment until implemented and run.

## Inventory, not experimental results

The validated catalog contains 105 cases, 80 eligible for live Lambda execution and 29 for offline execution; these target sets overlap. There are nine suite manifests, 59 explicit members of `live_behavior_regression`, 165 registered behavior-change entries, and 105 test files. Counts describe files and configuration at this snapshot, not passing interactions, participants, independent samples, or model accuracy.

All new-module dataset sizes, pass rates, confidence intervals, correctness/completeness results, latency, cost, and reviewer agreement are **TBD**.
