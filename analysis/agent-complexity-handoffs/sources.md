# Sources

- Fixed broad run: `.eval-runs/eval-2026-09-09T18-23-59-665Z-b67635c8/report.json` and its case artifacts. 83 cases / 123 turns. Source of aggregate metrics and scenario comparisons.
- Later closing run: `.eval-runs/eval-2026-09-09T19-33-11-292Z-fe18616f/artifacts/live_lambda/live_feedback.token_seeded_close_flow.json`.
- Fresh audit replay: `.eval-runs/eval-2026-09-09T19-46-21-934Z-a2111d98/report.json` and its three case artifacts.
- Direct OpenAI GET retrievals: `artifacts/retrieval-index.json`; private files referenced there retain instructions, inputs, outputs, schemas, tools, settings, and usage. Do not publish raw payloads.
- `artifacts/live-turn-metrics.json`: measured trace request metrics and usage from the fixed broad run; no customer transcript.
- `artifacts/stored-request-measurements.json`: content-free measurements for the first 18 directly retrieved calls.
- `artifacts/prompt-audit.json`, `prompt-inventory.json`, and `prompt-branches.json`: local prompt measurements at audit time. The audit log contains npm's preamble before JSON.
- `artifacts/development-deployment.json` and `development-deployment-after.json`: restricted metadata from AWS development Lambda. Same revision observed before and after fresh replay; not proof of every earlier artifact's deployment identity.
- `src/runtime/agent-service.ts`: normalization, contextual clarification, domain routing, effects, and reply coordination; particularly `normalizeInformationExtractionAmbiguity()`.
- `src/runtime/openai-agent-runtime.ts`: live extraction capabilities and node-specific reply Agent construction.
- `src/runtime/message-response-classifier.ts`: nine-field direct Responses delivery classification.
- `src/runtime/extraction-projection.ts`, `prompt-manifest.ts`, `prompt-loader.ts`, `information-orchestrator.ts`, `turn-capability-policy.ts`, `core/decision-flow.ts`: projection, available tools, information tasks, deterministic controls, and resume behavior. `core/decision-flow.ts` is under `src/core`.
- `prompts/shared/flow_discipline.txt` and `prompts/nodes/crear_lead_cerrar/system.txt`: conflicting temporary-save and definitive-close guidance, also confirmed in stored closing prompts.
- `src/audit/prompt-branch-measurement.ts`: synthetic measurement inputs; these do not substitute for emitted requests.
- `evals/cases/live-behavior-purchase-confirmation-carina.yaml` and other scenario definitions: exact seed worlds and expected behavior.
- `docs/information-flow.md`: useful original scope description, but account recovery guidance differs from active human-first policy. Historical documentation was not treated as current authority.
- Installed `node_modules/@openai/agents-core/dist/handoff.d.ts` and `.js`; [official Agents SDK handoffs](https://openai.github.io/openai-agents-js/guides/handoffs/) accessed 2026-09-09 for history-filter and transfer semantics.
