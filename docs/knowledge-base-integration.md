# Knowledge Base Integration

## Overview

The knowledge base integration connects the recap-agent to Sin Envolturas' Tawk help center (`sinenvolturas.tawk.help`). It scrapes FAQ articles, uploads them to an OpenAI vector store, and makes them searchable by the agent via the `file_search` hosted tool.

**Key design principle:** The knowledge base is a first-class state-machine node (`consultar_faq`), not an ambient tool. The agent explicitly enters KB mode when the user asks a FAQ-style question, and can return to event planning cleanly.

---

## Architecture

```
+----------------------------------+
|  sinenvolturas.tawk.help         |
|  (Tawk help center)              |
+---------------+------------------+
                | scrape (weekly)
                v
+----------------------------------+
|  knowledge-sync Lambda           |
|  - TawkHelpScraper               |
|  - per-article formatter         |
|  - OpenAI file upload + batch    |
|  - old-batch cleanup             |
+---------------+------------------+
                | upload
                v
+----------------------------------+
|  OpenAI Vector Store             |
|  - one file per article          |
|  - YAML frontmatter metadata     |
|  - batch_id attributes           |
+---------------+------------------+
                | file_search tool
                v
+----------------------------------+
|  recap-agent runtime             |
|  - consultar_faq node            |
|  - KB-only prompt bundle         |
|  - clean return to planning      |
+----------------------------------+
```

---

## File Rotation Strategy

OpenAI vector stores do **not** support in-place file updates. The sync job uses a batch rotation pattern:

1. **Scrape** all articles from Tawk.
2. **Format** each as an individual `.md` file with YAML frontmatter metadata.
3. **Upload** each file to the OpenAI Files API (`purpose: 'assistants'`).
4. **Create a batch** in the vector store with all new file IDs, tagged with `batch_id` and `source` attributes.
5. **Poll** until the batch status is `completed`.
6. **Delete** old vector store files whose `batch_id` does not match the current run.
7. **Optionally delete** old underlying file objects to avoid storage charges.

### Why one file per article?

- Granular citations: the model cites specific filenames.
- Per-file metadata attributes enable future filtering by category, type, or tags.
- Easier incremental updates (though we currently do full-batch replacement).
- Faster debugging: you can inspect individual articles in the OpenAI dashboard.

### Rate limits

| Limit | Value |
|---|---|
| Max files per batch | 500 |
| Rate limit per vector store | 300 req/min |
| Current article count | ~52 |

With 52 articles, a single batch is well within limits.

---

## Metadata Schema

Each article is formatted with YAML frontmatter:

```yaml
---
title: "¿Cuánto cuesta?"
slug: "cuanto-cuesta"
category: "Sobre Sin Envolturas"
article_type: "pricing"
tags: ["comisiones", "transferencia", "pago", "tarjeta", "paypal"]
source_url: "https://sinenvolturas.tawk.help/article/cuanto-cuesta"
last_updated: "2025-12-15"
related_topics: ["pagos", "listas-de-regalo", "eventos"]
---
```

### Fields

| Field | Source | Description |
|---|---|---|
| `title` | Scraped | Human-readable title |
| `slug` | Scraped | URL-safe identifier from Tawk |
| `category` | Scraped | Tawk category name |
| `article_type` | Heuristic mapper | `pricing`, `faq`, `tutorial`, `announcement`, `policy`, `event_guide`, `about` |
| `tags` | Content keywords | Auto-extracted from article text (max 8) |
| `source_url` | Constructed | Direct link back to Tawk article |
| `last_updated` | Scraped | Timestamp from Tawk page |
| `related_topics` | Content keywords | Broader topic buckets (max 5) |

### Article type mapper

The mapper uses the Tawk category name as the primary signal:

| Category pattern | article_type |
|---|---|
| `pago`, `precio`, `costo`, `comisión` | `pricing` |
| `faq`, `pregunta` | `faq` |
| `tutorial`, `guía`, `cómo` | `tutorial` |
| `anuncio`, `actualización`, `novedad` | `announcement` |
| `política`, `término`, `legal` | `policy` |
| `evento`, `celebración`, `boda` | `event_guide` |
| `sobre`, `introducción`, `qué es` | `about` |
| default | `faq` |

### Vector store attributes

Each file in the vector store carries these attributes (used by OpenAI for filtering):

```json
{
  "batch_id": "kb-20260428",
  "source": "recap-agent-knowledge-sync"
}
```

TODO: When response scripts are confirmed, add `script_id` and `response_template` fields to the article metadata and vector store attributes.

---

## State Machine Integration

### New intent: `consultar_faq`

Added to `planIntentValues` and the extractor schema. The extractor detects when the user is asking a question about Sin Envolturas as a product/platform rather than planning an event.

### New node: `consultar_faq`

**Entry conditions:**
- Extractor detects `intent === 'consultar_faq'`
- `resolveExtractionNode()` returns `'consultar_faq'`

**Behavior in `handleTurn()`:**
- Sets `current_node = 'consultar_faq'`
- Persists the plan (so the user can resume later)
- Loads the `consultar_faq` prompt bundle
- Composes a reply with access to `file_search` (hosted tool, injected by runtime)
- Returns immediately (does not enter the planning flow)

**Plan preservation:**
- The KB flow only updates `current_node`. It does NOT modify `event_type`, `vendor_category`, `provider_needs`, or any planning fields.
- If the user returns to planning, `resolveResumeNode()` checks if they had prior planning context (`plan.intent && plan.event_type`). If so, resumes to `entrevista`; otherwise to `deteccion_intencion`.

**Prompt bundle (`prompts/nodes/consultar_faq/`):**
- `system.txt` — Node objective and constraints
- `response_contract.txt` — Tone, length, citation rules, exit behavior
- `tool_policy.txt` — Only `file_search` (no provider tools)
- `transition_policy.txt` — Rules for staying in KB vs switching to planning

### Return to planning

From `consultar_faq`, the agent transitions back to planning when:
- The user says something like "quiero planificar mi boda", "necesito un fotógrafo", "muéstrame opciones de catering"
- The extractor detects a planning intent (`buscar_proveedores`, `refinar_busqueda`, etc.)
- `resolveResumeNode()` routes to `entrevista` (if plan has context) or `deteccion_intencion` (if fresh)

### Re-asking in KB mode

If the user is unsatisfied with a KB answer, they can simply reformulate the question. The extractor continues to detect `consultar_faq`, and the agent re-runs `file_search` with the new query. There is no limit on KB turns.

---

## Scheduling

### Frequency

**Weekly** (`rate(7 days)`). Tawk content does not change daily; weekly balances freshness vs API cost.

### Trigger sources

1. **Scheduled:** EventBridge rule triggers automatically.
2. **Manual:** Invoke the Lambda directly with `?force=true` query parameter or `{ "force": true }` in the body.

### Local testing

```bash
# Scrape only, skip upload
KB_SKIP_UPLOAD=true npx tsx scripts/sync-knowledge-base.ts

# Full scrape + upload (requires OPENAI_API_KEY)
npx tsx scripts/sync-knowledge-base.ts
```

---

## Deployment

### Current architecture

**Tawk blocks both AWS Lambda and GitHub Actions IPs** (confirmed via testing). Scraping must be done from a non-cloud IP (local machine, office network, etc.).

The pipeline is:

```
Local machine (non-blocked IP)
  │ scrapes sinenvolturas.tawk.help
  │ uploads articles zip to S3
  │ invokes Lambda
  ▼
S3 bucket: knowledge-sync/dev/articles-latest.zip
  ▼
Lambda: recap-agent-knowledge-sync-dev (serverless)
  │ downloads zip from S3
  │ extracts markdown files
  │ uploads to OpenAI vector store
  │ cleans up old batches
  ▼
OpenAI Vector Store
```

The Lambda also runs on a weekly EventBridge schedule as a re-sync (pulls latest articles from S3 and re-uploads to OpenAI).

### Prerequisites

- OpenAI API key stored in AWS Secrets Manager (same secret used by main runtime)
- S3 bucket `recap-agent-artifacts-{accountId}-{region}` exists
- AWS CLI credentials configured locally

### Deployment order

1. **Build and upload the knowledge-sync Lambda artifact:**
   ```bash
   npm run build
   cd dist/knowledge-sync && zip -r knowledge-sync.zip . && cd ../..
   aws s3 cp dist/knowledge-sync/knowledge-sync.zip \
     s3://recap-agent-artifacts-{accountId}-{region}/knowledge-sync/dev/latest.zip
   ```

2. **Deploy the knowledge-sync stack:**
   ```bash
   aws cloudformation deploy \
     --stack-name recap-agent-knowledge-sync-dev \
     --template-file infra/knowledge-sync.yml \
     --capabilities CAPABILITY_NAMED_IAM \
     --parameter-overrides \
       Environment=dev \
       OpenAiSecretArn=arn:aws:secretsmanager:...:secret:recap-agent/openai-api-key
   ```

3. **Run initial sync locally** (to create the vector store):
   ```bash
   OPENAI_API_KEY=sk-... npx tsx scripts/sync-knowledge-base.ts
   ```
   Capture the `vectorStoreId` from the output.

4. **Update the knowledge-sync stack with the vector store ID:**
   ```bash
   aws cloudformation deploy \
     --stack-name recap-agent-knowledge-sync-dev \
     --template-file infra/knowledge-sync.yml \
     --capabilities CAPABILITY_NAMED_IAM \
     --parameter-overrides \
       Environment=dev \
       OpenAiSecretArn=arn:aws:secretsmanager:...:secret:recap-agent/openai-api-key \
       KbVectorStoreId=vs_xxxxxxxxxxxxxxxxxxxxxxxx
   ```

5. **Deploy the main runtime stack with the vector store ID:**
   ```bash
   aws cloudformation deploy \
     --stack-name recap-agent-runtime \
     --template-file infra/cloudformation/stack.yaml \
     --capabilities CAPABILITY_NAMED_IAM \
     --parameter-overrides \
       FunctionName=recap-agent-runtime \
       CodeS3Bucket=recap-agent-artifacts-{accountId}-{region} \
       CodeS3Key=lambda/...-recap-agent.zip \
       OpenAISecretArn=arn:aws:secretsmanager:...:secret:recap-agent/openai-api-key \
       KbEnabled=true \
       KbVectorStoreId=vs_xxxxxxxxxxxxxxxxxxxxxxxx
   ```

### Running a sync (manual)

Since Tawk blocks cloud IPs, the scraping step must run locally:

```bash
# 1. Scrape locally
OPENAI_API_KEY=sk-... npx tsx scripts/sync-knowledge-base.ts
# Or skip OpenAI upload: KB_SKIP_UPLOAD=true npx tsx scripts/sync-knowledge-base.ts

# 2. Upload articles to S3
cd dist/knowledge-base && zip -r ../../knowledge-base-articles.zip . && cd ../..
aws s3 cp knowledge-base-articles.zip \
  s3://recap-agent-artifacts-{accountId}-{region}/knowledge-sync/dev/articles-latest.zip

# 3. Trigger Lambda
aws lambda invoke \
  --function-name recap-agent-knowledge-sync-dev \
  --payload '{"source":"manual"}' \
  --cli-binary-format raw-in-base64-out \
  response.json
```

### IAM permissions

The knowledge-sync Lambda role needs:
- `AWSLambdaBasicExecutionRole` (CloudWatch Logs)
- `secretsmanager:GetSecretValue` for the OpenAI secret
- `s3:GetObject` for the articles zip file

---

## Cost Considerations

| Component | Pricing | Estimate |
|---|---|---|
| OpenAI vector store storage | $0.10/GB/day after 1 GB free | ~52 articles × ~2 KB = ~100 KB ≈ free |
| OpenAI file upload | Included in storage | Negligible |
| Lambda execution (weekly) | ~$0.0000002 per 100ms × 512MB | ~$0.001 per run |
| EventBridge rule | $1.00 per million invocations | ~$0.05/year |

---

## Troubleshooting

### Verify vector store contents

```bash
curl https://api.openai.com/v1/vector_stores \
  -H "Authorization: Bearer $OPENAI_API_KEY" | jq '.data[] | {id, name}'

curl "https://api.openai.com/v1/vector_stores/{vs_id}/files" \
  -H "Authorization: Bearer $OPENAI_API_KEY" | jq '.data[] | {id, filename, status, attributes}'
```

### Check sync Lambda logs

```bash
aws logs tail /aws/lambda/recap-agent-knowledge-sync-dev --follow
```

### Test the scraper locally

```bash
KB_SKIP_UPLOAD=true npx tsx scripts/sync-knowledge-base.ts
ls -la dist/knowledge-base/
head dist/knowledge-base/cuanto-cuesta.md
```

### Agent not using KB answers

1. Check that `KB_ENABLED` env var is `true` on the runtime Lambda.
2. Check that `KB_VECTOR_STORE_ID` is set to the correct vector store ID.
3. Verify the agent is in `consultar_faq` node (check trace `current_node`).
4. Check that `file_search` is in `tools_considered` in the trace.
5. Review CloudWatch logs for `file_search_call` events.

### Lambda sync fails with HTTP 403 from Tawk

**Symptom:** The knowledge-sync Lambda fails immediately with `HTTP 403 for https://sinenvolturas.tawk.help/`.

**Cause:** Tawk (and/or Cloudflare in front of it) blocks requests originating from AWS Lambda and GitHub Actions IP ranges.

**Solution:** Run the scraper locally from a non-blocked IP (your laptop, office network, etc.), then upload the articles to S3 and trigger the Lambda:

```bash
# 1. Scrape locally
KB_SKIP_UPLOAD=true npx tsx scripts/sync-knowledge-base.ts

# 2. Upload to S3
cd dist/knowledge-base && zip -r ../../knowledge-base-articles.zip . && cd ../..
aws s3 cp knowledge-base-articles.zip \
  s3://recap-agent-artifacts-{accountId}-{region}/knowledge-sync/dev/articles-latest.zip

# 3. Trigger Lambda
aws lambda invoke \
  --function-name recap-agent-knowledge-sync-dev \
  --payload '{"source":"manual"}' \
  --cli-binary-format raw-in-base64-out \
  response.json
```

**Long-term fix:**
- Ask Sin Envolturas to whitelist your office/IP range in their Tawk/Cloudflare settings.
- Or request a Tawk API key or webhook for programmatic access to help center content.

---

## TODO

- [ ] Add `script_id` and `response_template` fields to article metadata when response scripts are confirmed.
- [ ] Consider attribute-based filtering (e.g., search only `pricing` articles) if the model starts returning irrelevant citations.
- [ ] Add a `/kb` slash command or explicit trigger phrase for users who want to force KB mode.
- [ ] Monitor vector store storage growth; if it exceeds 1 GB, implement selective cleanup of old underlying file objects.
