# Findings

## Current Understanding

- The project is a deployed serverless conversational runtime for Sin Envolturas,
  centered on an event-plan-first state model rather than a single provider-search
  interaction.
- The implementation uses a channel-agnostic Lambda boundary, typed state-machine
  evidence, a structured extractor, an OpenAI Agents reply path, DynamoDB-backed
  plans/perf telemetry, a Sin Envolturas provider gateway, and separate OpenAI
  vector stores for provider search and FAQ retrieval.
- Notion context confirms the original project charter and the architectural
  decision to avoid a zero-infrastructure WhatsApp assumption. The implemented
  architecture follows the later three-layer direction: channel adapter, runtime
  orchestration, and Sin Envolturas/API integrations.
- AWS development verification on 2026-06-22 confirmed:
  - `recap-agent-runtime` was `UPDATE_COMPLETE`, last updated 2026-06-19.
  - The runtime had hybrid provider search enabled, FAQ and invited-event lookup
    enabled, `gpt-5.4-mini` / `gpt-5.4-nano` model parameters, a provider vector
    store, a KB vector store, and DynamoDB plan/perf tables.
  - Provider sync and knowledge sync stacks were deployed and connected to their
    respective vector stores.
- The generated report deliberately avoids direct code excerpts and code-file
  references in the body, per the requested thesis/report style. It describes
  components and contracts at architecture level.
- Formal bibliography entries were restricted to public sources: official
  AWS/OpenAI documentation, the UNAM technical-report guide, and selected
  academic works from the provided AF.csv export. Internal project and Notion
  material remains provenance only, not bibliography.
