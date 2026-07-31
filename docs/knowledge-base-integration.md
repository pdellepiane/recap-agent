# Knowledge Base Integration

## Overview

The knowledge base connects the runtime to Sin Envolturas' Tawk help center.
Repository scripts scrape and normalize FAQ articles, upload them to an OpenAI
vector store, and keep the vector-store identifier in deployment
configuration.

At conversation time, FAQ retrieval is one capability of the first-class
information engine. It is not a hosted tool attached to the reply model.

## Runtime path

```mermaid
flowchart LR
    U["Complete user message"] --> E["Structured turn extraction"]
    E --> R["resolver_consultas_informativas"]
    R --> K["KnowledgeRetrievalGateway.search"]
    K --> V["OpenAI vectorStores.search"]
    V --> N["Normalized ranked evidence"]
    N --> C["Shared information composer"]
```

The extractor keeps the complete semantic FAQ question in an
`informationRequests[]` item. `OpenAiKnowledgeRetrievalGateway` calls
`vectorStores.search(...)` with:

- the complete query;
- a bounded result count;
- query rewriting;
- configured ranking options; and
- a configured score threshold.

Search results are normalized to file ID, filename, score, and text evidence.
They are passed to the shared information composer as a typed FAQ task result.
The reply agent has no `file_search` hosted tool.

Standalone and mixed FAQ questions therefore use the same retrieval,
grounding, tracing, and failure behavior.

## Source isolation

The FAQ vector store and provider vector store are separate resources:

- the FAQ gateway reads only `KB_VECTOR_STORE_ID`;
- provider search reads only `PROVIDER_VECTOR_STORE_ID`;
- the information resolver never exposes provider records as FAQ evidence; and
- provider search never reads FAQ chunks.

Authenticated event and purchase facts remain separate discriminated task
results. The composer is instructed to keep claims attached to their source and
must not infer personal account facts from FAQ documentation.

## Configuration

```text
KB_ENABLED=true
KB_VECTOR_STORE_NAME=Sin Envolturas Knowledge Base
KB_VECTOR_STORE_ID=vs_...
KB_MAX_RESULTS=6
KB_SCORE_THRESHOLD=0
KB_BASE_URL=https://sinenvolturas.tawk.help
```

`src/runtime/config.ts`, `infra/cloudformation/stack.yaml`, and
`scripts/deploy.mjs` validate and forward the same settings.

If retrieval is disabled or no vector-store ID is configured, the FAQ task
fails as `not_configured`. Other ready information tasks can still complete, and
the response gives one next step for the FAQ portion.

## Synchronization

The public help-center corpus can be scraped and replaced locally with:

```bash
npm run sync:faq-kb
```

The replacement is fail-closed: every discovered article must scrape with a
non-empty title and body, exact duplicate bodies are rejected, existing local
Markdown files are cleared only after a successful scrape, and each run gets a
unique batch ID. The new batch is indexed before old FAQ associations are
removed. Cleanup is paginated and source-scoped, so it replaces only
`recap-agent-knowledge-sync` files and preserves supplemental customer-service
documents in the same vector store. A bounded post-cleanup audit requires the
expected file count, zero stale files, and zero duplicate slugs.

Supplemental customer-service documents use their own source-scoped workflow:

```bash
npm run generate:faq-atc-kb
npm run sync:faq-atc-kb
```

The synchronizer uploads normalized documents to the configured FAQ vector
store and removes stale supplemental ATC files without touching unrelated FAQ
documents.

The runtime never scrapes the help center during a user turn.

## Observability

Each FAQ execution emits a redacted capability summary containing:

- request ID;
- `kind: faq`;
- `source: knowledge_base`;
- status;
- result count; and
- latency.

Raw queries, retrieved text, filenames, credentials, and model prompt content
are not persisted in the capability summary.

Evaluations assert `knowledge_base_search` execution and source-grounded output.
The former `file_search_called` assertion and the `consultar_faq` decision node
are intentionally removed.

## Testing

Relevant coverage includes:

- `tests/knowledge-retrieval-gateway.test.ts`;
- `tests/information-orchestrator.test.ts`;
- `tests/agent-service-information-flow.test.ts`;
- `tests/eval-grounding.test.ts`;
- `tests/vector-store-separation.test.ts`; and
- live FAQ cases under `evals/cases`.

Run the full local gate with:

```bash
npm run check
```

See `docs/information-flow.md` for authentication, purchase projection, mixed
capability behavior, and failure semantics.
