# Technical Evaluation Study

This dossier evaluates the development Lambda through 50 frozen Spanish-language
scenario conversations repeated three times. It covers functional completion,
workflow coverage, latency, calls, tokens, cache use, estimated cost, persistence,
and deterministic grounding.

The study is a technical evaluation only. It does not measure user satisfaction
and does not compare the agent with a baseline.

## Layout

- `methodology.md`: protocol, metrics, and denominators.
- `manual-grounding-rubric.md`: human review procedure for recommendation rationales.
- `how-to-repeat.md`: validation, deployment, and execution commands.
- `artifacts/`: immutable timestamped study runs and generated findings.

The frozen scenario source is
`evals/studies/technical-evaluation-50-v1.json`. Pricing assumptions are stored
separately in `evals/studies/pricing-2026-07-01.json`.
