# Provider Vector Search

## Overview

Provider search now supports a hybrid retrieval path. The Sin Envolturas provider API remains the source of truth for provider IDs, quote actions, links, pricing, promos, and enriched details. A separate OpenAI vector store adds semantic discovery over provider descriptions, services, promos, and terms.

The default runtime mode is `hybrid`, but it only uses vector search when `PROVIDER_VECTOR_STORE_ID` is configured. Without that ID, the gateway falls back to the API path.

## Runtime Modes

| Mode | Behavior |
|---|---|
| `api` | Use the existing `/filtered` and `/relevant` provider endpoints only. |
| `vector` | Search the provider vector store, then enrich each matched provider through the provider detail endpoint. |
| `hybrid` | Search both API and vector store, dedupe by provider ID, enrich vector-only hits, then pass candidates to provider-fit ranking. |

## Need Isolation and Query Formulation

Provider vector search is not exposed to the conversational agent as an ambient `file_search` tool. The runtime calls vector search before reply composition, receives typed provider IDs, enriches those IDs through the provider API, and only then sends curated `ProviderSummary` records to the reply model.

To avoid mixing provider types or needs:

- FAQ lookup remains isolated in the `consultar_faq` node and uses the FAQ vector store only.
- Provider vector lookup runs only inside provider search, never inside `consultar_faq`.
- The provider query is built from the active provider need only: active category, active preferences, active hard constraints, event type, location, budget, and conversation summary.
- If the plan contains several provider needs, inactive needs are not used as retrieval categories or filters.
- The vector search applies metadata filters for category and country when available.

To improve recall without mixing categories:

- The runtime sends multiple query formulations to vector search: a full structured query, a short provider/category query, and a services/promos/terms query.
- Category filters use normalized aliases for known marketplace categories. For example, `foto` and `fotografía` search the indexed `fotografia y video` category, while `local` searches `locales`.
- The query text explicitly names the active need and tells retrieval not to mix other plan needs.
- `rewrite_query` remains enabled so OpenAI can improve semantic matching inside the filtered provider type.

Configuration:

```bash
PROVIDER_SEARCH_MODE=hybrid
PROVIDER_VECTOR_STORE_ID=vs_...
PROVIDER_VECTOR_STORE_NAME="Sin Envolturas Provider Search"
PROVIDER_VECTOR_MAX_RESULTS=12
PROVIDER_VECTOR_SCORE_THRESHOLD=0.2
```

**Important:** `PROVIDER_VECTOR_STORE_ID` must be set as a CloudFormation stack parameter (`ProviderVectorStoreId`) so the Lambda environment receives it. Without this ID, the runtime falls back to API-only search even in `hybrid` mode. The value is persisted in the Lambda function's environment variables and survives deployments as long as the parameter is passed.

## Sync Pipeline

The provider sync pipeline mirrors the FAQ knowledge-base sync pattern:

1. Fetch all provider summaries from `/filtered?page=N`.
2. Fetch each provider detail from `/{providerId}`.
3. Write one Markdown file per provider with frontmatter and Spanish searchable body content.
4. Upload each file to the provider vector store.
5. Attach vector-store file attributes for filtering: `provider_id`, `slug`, `category`, `category_key`, `city`, `city_key`, `country`, `country_key`, `price_level`, `batch_id`, and `source`.
6. Delete files from old batches after a successful sync.

Local dry run:

```bash
PROVIDER_SYNC_SKIP_UPLOAD=true npm run sync:providers
```

Full local upload:

```bash
OPENAI_API_KEY=... PROVIDER_VECTOR_STORE_ID=vs_... npm run sync:providers
```

## Deployment

`infra/provider-sync.yml` defines a scheduled provider sync Lambda. It runs weekly and can create a provider vector store on first run if `ProviderVectorStoreId` is empty. The runtime stack accepts the resulting vector store ID through `ProviderVectorStoreId`.

After a runtime or sync change, redeploy development Lambda so terminal validation uses current behavior.
