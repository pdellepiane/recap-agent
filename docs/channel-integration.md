# Channel Integration and Telemetry Contract

This guide is the working contract for connecting consumer channels to the deployed recap-agent runtime. It covers the live Lambda Function URL, request and response payloads, telemetry persistence, provider API dependencies, and the adapter responsibilities that must stay outside the channel-agnostic runtime.

Last verified against CloudFormation outputs on 2026-04-21.

## Live Runtime Endpoints

Current development deployment:

| Purpose | Value |
| --- | --- |
| Runtime HTTP endpoint | `https://jwtjjociscvaa5dsrp5gokmno40doiva.lambda-url.us-east-1.on.aws/` |
| HTTP method | `POST` |
| Function URL auth | `NONE` |
| AWS region | `us-east-1` |
| CloudFormation stack | `recap-agent-runtime` |
| Lambda function | `recap-agent-runtime` |
| Plans table | `recap-agent-runtime-plans` |
| Perf table | `recap-agent-runtime-perf` |
| Default channel fallback | `terminal_whatsapp` |

The runtime endpoint is a Lambda Function URL created in [infra/cloudformation/stack.yaml](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/infra/cloudformation/stack.yaml). It is currently unauthenticated at the Function URL layer, so production channel adapters must apply their own webhook authentication, rate limits, and abuse controls before forwarding traffic.

Resolve the latest deployment values instead of hardcoding them in long-lived adapters:

```bash
AWS_PROFILE=se-dev AWS_REGION=us-east-1 aws cloudformation describe-stacks \
  --stack-name recap-agent-runtime \
  --query "Stacks[0].Outputs" \
  --output table
```

## Runtime Boundary

The Lambda accepts one normalized inbound user turn and returns one synchronous reply. Streaming is intentionally out of scope because the target WhatsApp-like channel cannot consume streaming output.

Channel adapters own:

- webhook signature verification and auth;
- converting channel-native payloads to the normalized runtime request;
- stable external user identity mapping;
- message id and idempotency policy;
- channel-specific retry handling;
- rendering the returned `message` to the user;
- feedback capture and delivery status handling.

The runtime owns:

- plan load and save keyed by `(channel, externalUserId)`;
- intent and event-plan extraction;
- provider search and enrichment;
- Spanish reply composition;
- runtime traces and performance telemetry.

## Request Contract

Send JSON with `content-type: application/json`.

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `text` | Yes | string | The inbound user message exactly as the user sent it after channel-level cleanup. |
| `user_id` | Yes | string | Stable channel-specific external user id. This is the state key together with `channel`. |
| `channel` | No | string | Stable channel identifier. Defaults to `DEFAULT_INBOUND_CHANNEL`, currently `terminal_whatsapp`. |
| `message_id` | No | string | Channel message id or deterministic adapter fallback. If omitted, Lambda generates a UUID. |
| `received_at` | No | ISO-8601 string | Channel receive timestamp. If omitted, Lambda uses server time. |
| `client_mode` | No | `channel` or `cli` | `channel` returns only user-facing fields. `cli` includes trace, perf, and plan diagnostics. |

Use `client_mode: "channel"` for production channels. Use `client_mode: "cli"` only for developer tooling, evals, or controlled diagnostics.

Minimal production request:

```json
{
  "text": "Hola, necesito catering para una boda de 80 personas en Lima",
  "user_id": "whatsapp:+51999999999",
  "channel": "whatsapp",
  "message_id": "wamid.HBgLNTE5OTk5OTk5OTkVAgARGBI",
  "received_at": "2026-04-21T21:17:26.000Z",
  "client_mode": "channel"
}
```

Developer diagnostics request:

```json
{
  "text": "Necesito un local para 100 personas en Lima",
  "user_id": "51999999999",
  "channel": "terminal_whatsapp",
  "message_id": "local-dev-0001",
  "received_at": "2026-04-21T21:17:26.000Z",
  "client_mode": "cli"
}
```

Example curl:

```bash
curl -sS \
  -X POST "https://jwtjjociscvaa5dsrp5gokmno40doiva.lambda-url.us-east-1.on.aws/" \
  -H "content-type: application/json" \
  --data '{
    "text": "Hola, necesito catering para una boda de 80 personas en Lima",
    "user_id": "whatsapp:+51999999999",
    "channel": "whatsapp",
    "message_id": "wamid.example.0001",
    "received_at": "2026-04-21T21:17:26.000Z",
    "client_mode": "channel"
  }'
```

## Channel Response Contract

Default mode and `client_mode: "channel"` return only the user-facing envelope:

```json
{
  "message": "¡Perfecto! Para ayudarte con opciones de catering, ¿tienes un rango de presupuesto o alguna preferencia de estilo de comida?",
  "conversation_id": "conv_abc123",
  "plan_id": "f1b6f0c3-9d59-4c4e-a48c-3a3284b0f2c7",
  "current_node": "aclarar_pedir_faltante"
}
```

Field meanings:

| Field | Type | Meaning |
| --- | --- | --- |
| `message` | string | The only field that should be rendered to the end user. Prompt-authored conversational content is Spanish. |
| `conversation_id` | string or null | OpenAI conversation id used by the runtime when available. |
| `plan_id` | string | Internal persisted event-plan id. Useful for support correlation, not for end-user display. |
| `current_node` | string | Current decision-flow node after this turn. Useful for adapter logs and support dashboards. |

Adapters should ignore unknown fields to stay forward-compatible with non-breaking diagnostics additions.

## CLI Diagnostics Response Contract

`client_mode: "cli"` returns the channel fields plus diagnostics:

```json
{
  "message": "Te paso algunas opciones...",
  "conversation_id": "conv_abc123",
  "plan_id": "f1b6f0c3-9d59-4c4e-a48c-3a3284b0f2c7",
  "current_node": "recomendar",
  "trace": {
    "trace_id": "7de4f5f7-0f6b-4f2d-a6fd-6503ce6410d3",
    "conversation_id": "conv_abc123",
    "plan_id": "f1b6f0c3-9d59-4c4e-a48c-3a3284b0f2c7",
    "previous_node": "buscar_proveedores",
    "next_node": "recomendar",
    "node_path": ["buscar_proveedores", "busqueda_exitosa", "hay_resultados", "recomendar"],
    "intent": "buscar_proveedor",
    "missing_fields": [],
    "search_ready": true,
    "prompt_bundle_id": "recomendar",
    "prompt_file_paths": ["prompts/shared/base_system.txt", "prompts/nodes/recomendar/system.txt"],
    "tools_considered": ["search_providers_from_plan"],
    "tools_called": ["search_providers_from_plan"],
    "tool_inputs": [],
    "tool_outputs": [],
    "provider_results": [],
    "recommendation_funnel": {
      "available_candidates": 0,
      "context_candidates": 0,
      "context_candidate_ids": [],
      "presentation_limit": 5
    },
    "plan_persisted": true,
    "plan_persist_reason": "reply-generated",
    "timing_ms": {
      "total": 0,
      "load_plan": 0,
      "prepare_working_plan": 0,
      "extraction": 0,
      "apply_extraction": 0,
      "compute_sufficiency": 0,
      "provider_search": 0,
      "provider_enrichment": 0,
      "prompt_bundle_load": 0,
      "compose_reply": 0,
      "save_plan": 0
    },
    "token_usage": {
      "extraction": null,
      "reply": null,
      "total": null
    }
  },
  "perf": {
    "trace_id": "7de4f5f7-0f6b-4f2d-a6fd-6503ce6410d3",
    "conversation_id": "conv_abc123",
    "runtime_latency_ms": 0,
    "extraction_latency_ms": 0,
    "compose_latency_ms": 0,
    "tools_called_count": 1,
    "provider_results_count": 0,
    "recommendation_context_candidates": 0,
    "recommendation_presentation_limit": 5,
    "total_tokens": null,
    "cached_input_tokens": null,
    "cache_hit_rate": null,
    "extraction_to_compose_ratio": null,
    "captured_at": "2026-04-21T21:17:26.000Z",
    "persisted": true,
    "storage_target": "recap-agent-runtime-perf"
  },
  "plan": {
    "plan_id": "f1b6f0c3-9d59-4c4e-a48c-3a3284b0f2c7",
    "channel": "terminal_whatsapp",
    "external_user_id": "51999999999",
    "current_node": "recomendar"
  }
}
```

The example above is shape-focused and omits most nested `plan` fields. The actual plan snapshot includes the full persisted event-plan state, provider needs, selected providers, shortlist data, and open questions.

## Error Responses

The handler currently returns JSON errors with these status codes:

| Status | Body | Cause |
| --- | --- | --- |
| `400` | `{ "error": "Missing request body." }` | Empty HTTP body. |
| `400` | `{ "error": "text and user_id are required." }` | Missing or empty `text` or `user_id`. |
| `500` | `{ "error": "..." }` | JSON parsing failure, runtime bootstrap failure, OpenAI error, provider failure not handled by the flow, DynamoDB failure, or other unexpected exception. |

Adapter retry policy:

- Do not retry `400` responses; fix the adapter payload.
- Retry transient `500`, network timeouts, or connection failures with bounded exponential backoff.
- Keep `message_id` stable across retries so support logs and perf records can be correlated.
- The runtime does not currently enforce idempotency on duplicate `message_id`; channel adapters should avoid sending the same inbound message twice when a previous request completed successfully.

## State Identity and Isolation

Plans are isolated by `channel` and `user_id`.

Use stable values:

```json
{
  "channel": "whatsapp",
  "user_id": "whatsapp:+51999999999"
}
```

Do not use temporary webhook ids, display names, or phone numbers without a namespace. A good `user_id` is stable, unique inside the channel, and safe to log in adapter systems according to the channel privacy policy. Runtime perf records hash the external user id before storage, but plan records store the raw external id because it is part of the lookup key.

Recommended channel identifiers:

| Channel | Suggested `channel` |
| --- | --- |
| WhatsApp production | `whatsapp` |
| WhatsApp sandbox | `whatsapp_sandbox` |
| Web chat | `web_chat` |
| Mobile app | `mobile_app` |
| Terminal developer client | `terminal_whatsapp` |
| Live eval suite | Use suite-specific override only when isolation is needed. |

## Adapter Flow

1. Receive the native channel webhook.
2. Verify the webhook signature or platform token.
3. Deduplicate using the native channel message id.
4. Normalize the inbound text and sender id.
5. Send one POST to the runtime Function URL.
6. Read `message` from the response.
7. Send exactly that message through the channel.
8. Store channel-side metadata for support and feedback correlation.

Pseudo-code:

```ts
type RuntimeRequest = {
  text: string;
  user_id: string;
  channel: string;
  message_id: string;
  received_at: string;
  client_mode: 'channel';
};

type RuntimeChannelResponse = {
  message: string;
  conversation_id: string | null;
  plan_id: string;
  current_node: string;
};

async function forwardTurn(request: RuntimeRequest): Promise<RuntimeChannelResponse> {
  const response = await fetch(process.env.AGENT_FUNCTION_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });

  const body = await response.json() as unknown;
  if (!response.ok) {
    throw new Error(`Runtime returned HTTP ${response.status}: ${JSON.stringify(body)}`);
  }

  return body as RuntimeChannelResponse;
}
```

A production adapter should validate the response shape before rendering. Keep that validation in the adapter package, not in `src/runtime`.

## WhatsApp Mapping Example

For a WhatsApp webhook, map native fields like this:

| Runtime field | WhatsApp source |
| --- | --- |
| `text` | inbound text body after trimming unsupported channel wrappers |
| `user_id` | `whatsapp:${from}` where `from` is the platform sender id |
| `channel` | `whatsapp` |
| `message_id` | WhatsApp `wamid` |
| `received_at` | WhatsApp timestamp converted to ISO-8601 |
| `client_mode` | `channel` |

The runtime response should be rendered as a plain text WhatsApp message:

```json
{
  "messaging_product": "whatsapp",
  "to": "51999999999",
  "type": "text",
  "text": {
    "body": "<runtime.message>"
  }
}
```

Do not expose `plan_id`, `current_node`, `trace`, provider tool details, or timing data to the WhatsApp user.

## Telemetry Persistence

Every successful runtime turn attempts to save a perf record to `recap-agent-runtime-perf`.

Perf record keys:

| Attribute | Shape |
| --- | --- |
| `pk` | `CONVERSATION#<conversation_id or plan_id>` |
| `sk` | `TURN#<captured_at>#<trace_id>` |
| `gsi1pk` | `CHANNEL_USER#<channel>#<sha256(user_id)>` |
| `gsi1sk` | `TURN#<captured_at>#<trace_id>` |
| `ttl_epoch_seconds` | Captured time plus `PERF_RETENTION_DAYS`, currently 30 days. |

Important stored fields:

- `trace_id`
- `conversation_id`
- `plan_id`
- `channel`
- `external_user_hash`
- `message_id`
- `user_message_length`
- `runtime_latency_ms`
- full `timing_ms` stage breakdown
- token usage snapshot
- tool call counts and names
- provider result counts
- recommendation funnel candidate ids
- missing field count
- `search_ready`
- `next_node`
- cache hit rate
- extraction-to-compose ratio

Channel-side feedback tables should store at least:

- `channel`
- raw external user id, if allowed by the channel privacy policy;
- `message_id`
- feedback timestamp;
- user rating or label;
- free-text comment, if any;
- the runtime `plan_id` and `current_node` returned with the reply.

To correlate feedback without storing raw user ids in analytics, compute the same hash used by the runtime:

```bash
printf '%s' 'whatsapp:+51999999999' | shasum -a 256
```

Then query the perf table GSI `channel-user-turns`:

```bash
HASH="$(printf '%s' 'whatsapp:+51999999999' | shasum -a 256 | awk '{print $1}')"

aws dynamodb query \
  --table-name recap-agent-runtime-perf \
  --index-name channel-user-turns \
  --key-condition-expression "gsi1pk = :pk AND gsi1sk BETWEEN :from AND :to" \
  --expression-attribute-values "{
    \":pk\": {\"S\": \"CHANNEL_USER#whatsapp#$HASH\"},
    \":from\": {\"S\": \"TURN#2026-04-21T00:00:00.000Z\"},
    \":to\": {\"S\": \"TURN#2026-04-22T00:00:00.000Z\"}
  }"
```

## Plan Persistence

The plans table is `recap-agent-runtime-plans`. The runtime stores the full event plan and updates it across turns. The adapter should not read or write this table during normal operation.

Use plan reads only for developer diagnostics, eval tooling, or support workflows where AWS access is appropriate. The terminal client already does this through [src/terminal/client.ts](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/src/terminal/client.ts).

## Provider API Dependencies

The deployed runtime uses the Sin Envolturas vendor API base URL:

```text
https://api.sinenvolturas.com/api-web/vendor
```

Current gateway operations in [src/runtime/sinenvolturas-gateway.ts](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/src/runtime/sinenvolturas-gateway.ts):

| Runtime capability | Method and path |
| --- | --- |
| List categories | `GET /categories` |
| Category by slug | `GET /category-slug/{slug}` |
| List locations | `GET /locations` |
| Mixed provider search, legacy shape | `GET /filtered?search={term}&page={page}` |
| Mixed provider search, richer shape | `GET /filtered/full?search={term}&page={page}` |
| Relevant fallback providers | `GET /relevant` |
| Provider detail | `GET /{providerId}` |
| Provider detail and view tracking | `GET /view/{providerId}` |
| Related providers | `GET /related/{providerId}` |
| Provider reviews | `GET /review/{providerId}` |
| Event vendor context | `GET /event/{eventId}` |
| Event favorite providers | `GET /event-favorites/{eventId}?eventId={eventId}&sortBy={sortBy}&page={page}&categoryId={categoryId}` |
| User events vendor context | `GET /user-events/{userId}` |
| Quote request | `POST /quote` |
| Add provider to event favorites | `POST /favorite` |
| Create provider review | `POST /review` |

Search behavior:

- Plan-driven search builds bounded search terms from active provider need category, category aliases, event type, location, and a short conversation summary.
- Search fetches both `/filtered` and `/filtered/full` for each query page, merges by provider id, and auto-fetches up to 4 sequential pages.
- If search returns no providers, the runtime falls back to `/relevant`.
- The persisted shortlist is capped by `PROVIDER_SEARCH_LIMIT`, currently 15.
- The reply presentation limit is `PRESENTATION_PROVIDER_LIMIT`, currently 5.
- Deterministic provider enrichment looks up detail for up to `PROVIDER_DETAIL_LOOKUP_LIMIT`, currently 3.

Quote request body sent by the gateway:

```json
{
  "name": "Test User",
  "email": "test@example.com",
  "phone": "987654321",
  "phoneExtension": "+51",
  "eventDate": "2026-04-21",
  "guestsRange": "80-150",
  "description": "Solicitud de cotización",
  "benefitId": 12345,
  "userId": 67890
}
```

Live endpoint research on 2026-04-20 found `GET /api-web/vendor/filtered/full` and `POST /api-web/vendor/quote` to be stable tool candidates. See [analysis/vendor-endpoint-tool-readiness/findings.md](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/analysis/vendor-endpoint-tool-readiness/findings.md).

## Runtime Configuration

The Lambda reads configuration through [src/runtime/config.ts](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/src/runtime/config.ts). Important deployed defaults:

| Env var | Current value |
| --- | --- |
| `OPENAI_MODEL` | `gpt-5.4-mini` |
| `OPENAI_EXTRACTOR_MODEL` | `gpt-5.4-nano` |
| `OPENAI_PROMPT_CACHE_RETENTION` | `in-memory` |
| `AWS_REGION` | `us-east-1` |
| `PLANS_TABLE_NAME` | `recap-agent-runtime-plans` |
| `PERF_TABLE_NAME` | `recap-agent-runtime-perf` |
| `PROMPTS_DIR` | `/var/task/prompts` |
| `SINENVOLTURAS_BASE_URL` | `https://api.sinenvolturas.com/api-web/vendor` |
| `DEFAULT_INBOUND_CHANNEL` | `terminal_whatsapp` unless overridden |
| `PROVIDER_SEARCH_LIMIT` | `15` |
| `SEARCH_SUMMARY_WORD_LIMIT` | `5` |
| `REPLY_PROVIDER_LIMIT` | `15` |
| `PRESENTATION_PROVIDER_LIMIT` | `5` |
| `PROVIDER_DETAIL_LOOKUP_LIMIT` | `3` |
| `PERF_RETENTION_DAYS` | `30` |

After any Lambda-impacting change, redeploy development Lambda so channel and eval validation exercise current behavior.

## Local and Live Validation

Developer CLI:

```bash
npm run cli -- --user-id 51999999999 --channel terminal_whatsapp
```

Direct channel-mode smoke test:

```bash
curl -sS \
  -X POST "$(AWS_PROFILE=se-dev AWS_REGION=us-east-1 aws cloudformation describe-stacks \
    --stack-name recap-agent-runtime \
    --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" \
    --output text)" \
  -H "content-type: application/json" \
  --data '{"text":"Hola, estoy planeando una boda en Lima para 80 personas","user_id":"smoke-channel-user","channel":"channel_smoke","message_id":"smoke-001","received_at":"2026-04-21T21:17:26.000Z","client_mode":"channel"}'
```

Expected shape:

```json
{
  "message": "...",
  "conversation_id": "...",
  "plan_id": "...",
  "current_node": "..."
}
```

Live eval target requests use the same Function URL and send `client_mode: "cli"` so they can assert traces, plan state, provider results, and perf summaries.

## Adapter Completion Checklist

Before a channel adapter is considered complete:

- [ ] It verifies native webhook authenticity before calling the runtime.
- [ ] It uses a stable `channel` string.
- [ ] It always passes a stable `user_id`.
- [ ] It always passes the native `message_id`, or a deterministic fallback.
- [ ] It always passes `received_at` as ISO-8601.
- [ ] It sets `client_mode` to `channel`.
- [ ] It renders only `message` to the user.
- [ ] It logs `plan_id`, `current_node`, `message_id`, and channel delivery ids for support.
- [ ] It stores enough feedback metadata to correlate with perf records.
- [ ] It retries only transient failures with bounded backoff.
- [ ] It deduplicates inbound webhook retries.
- [ ] It keeps all channel formatting, templates, auth, and retry logic outside `src/runtime`.

## Known Integration Risks

- The Function URL is unauthenticated. Put production adapters behind their own authenticated ingress and do not expose the raw URL directly to untrusted clients.
- Duplicate inbound turns are not currently suppressed by the runtime. Adapter idempotency matters.
- `client_mode: "cli"` can return large traces and full plan snapshots. Do not enable it for user-facing channels.
- Provider API field completeness can drift. Search uses a mixed endpoint strategy to improve recall, but channel adapters should treat provider details as runtime-generated text, not as a stable direct API contract.
- Runtime responses are synchronous and can take tens of seconds when extraction, search, enrichment, and reply composition all run. Channel platforms with short webhook deadlines should acknowledge the webhook first and process the runtime call asynchronously if necessary.
