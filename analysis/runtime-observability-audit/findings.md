# Findings

## Current Understanding

### Deployment alignment

- `recap-agent-runtime` and `recap-agent-provider-sync-dev` were both
  `UPDATE_COMPLETE` after deployments on 2026-07-20. The runtime Lambda code
  SHA-256 exactly matched `.artifacts/recap-agent.zip`; tracked repository files
  were clean at `14b67f4` during the audit.
- The last runtime request was logged at 2026-07-20 22:32:14 UTC, approximately
  six minutes before the current runtime deployment. The current artifact is
  therefore deployed but not yet exercised by traffic.
- `recap-agent-knowledge-sync-dev` is materially older: its code and S3 artifact
  date to 2026-04-28.

### Runtime request health

- The seven-day Lambda metric window contained 203 invocations, zero Lambda
  `Errors`, and zero throttles. The zero error metric is not an application
  success signal because the handler catches runtime exceptions and returns a
  formatted HTTP 500 response.
- CloudWatch contained 183 structured `channel_request_completed` events in the
  retained window: 133 conversational successes, two application HTTP 500s, 12
  invalid requests, 27 unauthorized requests, one unknown route, and eight
  successful conversation-ownership operations.
- The two application failures were (1) a structured model output that omitted
  `closeAction.reason` for a clarification action and (2) a downstream failure
  to acquire a conversation lock. The latter was followed by a successful retry
  with the same channel message identifier.
- Successful request latency was 6.30 seconds at p50, 11.33 seconds at p95, and
  23.15 seconds maximum in CloudWatch request logs.

### Successful-turn telemetry

- The DynamoDB performance table was active with TTL enabled and a configured
  30-day retention period. It held 1,882 items (approximately 12.2 MB) at the
  time of inspection; the retained records ranged from 2026-06-26 through
  2026-07-20.
- From 2026-07-14 onward, it held 139 successful turn records: 134 WhatsApp and
  five terminal WhatsApp-demo turns across 54 hashed users. Every record had a
  valid state-machine invariant result and a persisted plan.
- Turn latency in that sample was 6.22 seconds at p50, 11.58 seconds at p95, and
  22.74 seconds maximum. Mean phase time was approximately 1.65 seconds for the
  classifier, 2.41 seconds for extraction, and 2.43 seconds for composition.
- Token usage was present for 134 turns. Mean total usage was 16,985 tokens,
  p95 was 24,996, maximum was 37,779, and the mean recorded cache-hit rate was
  53.0%.
- The enforced response classifier suppressed 12 turns and used no fallbacks.
  Conversation health was `progressing` on 95 turns, `uncertain` on 41, and
  `stalled` on three.
- Automated message-quality checks flagged 15 command-like contact prompts and
  two repeated-line replies. No empty-message, citation-artifact, or welcome-menu
  flags appeared in this window.
- Only two turns performed provider search, returning 17 provider results in
  total. Most observed traffic exercised interview and invited-event lookup
  paths, so the window is not representative of provider-search quality.

### WhatsApp DynamoDB/CloudWatch reconciliation

- The WhatsApp-only slice from 2026-07-14 through 2026-07-20 contained 134
  successful-turn records in DynamoDB and 143 structured CloudWatch completion
  events. The CloudWatch events were 133 conversational successes, two HTTP
  500s, and eight conversation-ownership operations.
- All 133 CloudWatch conversational successes matched DynamoDB by SHA-256 of the
  raw channel message ID. Every matched pair agreed on the hashed user and final
  state-machine node. There were no CloudWatch successes missing from DynamoDB.
- DynamoDB had one additional successful WhatsApp turn at 2026-07-14 16:35:03
  UTC. It predates the first structured completion event at 2026-07-15 19:29:52
  UTC and therefore reflects deployment timing, not a failed CloudWatch write.
- Daily success counts matched exactly from 2026-07-15 onward: 14, 4, 73, 38,
  2, and 2 turns respectively through 2026-07-20.
- DynamoDB had 119 turns with an assistant-message hash and 15 without one.
  CloudWatch had 118 `send` and 15 `suppress` outcomes; the extra DynamoDB
  assistant message is the pre-structured-logging turn. This independently
  reconciles the delivery behavior.
- For the 133 matched successes, CloudWatch request duration exceeded the
  runtime trace duration by 13 ms at p50 and 512 ms at p95, averaging 137 ms.
  This is consistent with handler work outside `handleTurn`, including
  authentication/config access and performance-record persistence.
- Both CloudWatch HTTP 500s were retried with the same WhatsApp message ID and
  later produced a DynamoDB success: the model-schema failure recovered after
  approximately 7.4 seconds and the conversation-lock failure after
  approximately 13.1 seconds.
- Three WhatsApp message IDs were processed successfully twice in both systems.
  Two groups returned `delivery_action=send` twice and generated different
  assistant-message hashes, making duplicate user-visible replies possible. One
  of those races also created different plan and conversation IDs for the same
  inbound message. The third group was suppressed twice, so it duplicated model
  and persistence work without returning a message. The runtime evidence proves
  duplicate `send` instructions, but adapter/WhatsApp delivery logs are required
  to prove that both replies reached the end user.
- The reconciled DynamoDB slice represented 51 hashed users and 47 non-null
  conversation IDs. Its most common terminal nodes were `entrevista` (47 turns)
  and `consultar_evento_invitado` (42 turns).

### Observability gaps

- Rich DynamoDB traces are written only after `handleTurn` succeeds. The two HTTP
  500s therefore have request/error logs but no equivalent full turn trace,
  which removes the most useful state-machine and model evidence from failed
  turns.
- Three channel message identifiers each produced two successful turn records.
  The repository explicitly documents that runtime duplicate suppression is not
  implemented, so adapter retries can repeat state changes and replies.
- The runtime is configured for X-Ray `PassThrough`, not `Active`, and no custom
  tracing library was found. There is no automatically recorded AWS service map
  or distributed trace for Lambda, DynamoDB, OpenAI, or downstream APIs.
- No CloudWatch metric filters, metric alarms, or composite alarms with the
  `recap-agent` prefix were present. Application HTTP 500s therefore do not
  trigger the native Lambda `Errors` signal or an application alarm.
- Runtime CloudWatch logs expire after seven days, while provider-sync and
  knowledge-sync log groups have no retention policy. The retention posture is
  inconsistent.
- The performance table stores a raw 160-character user-message preview and the
  raw channel `message_id`. WhatsApp message identifiers can embed phone-like
  material. Assistant previews and tool previews are redacted, but user previews
  and message identifiers are not. This is a privacy and data-minimization gap.
- Point-in-time recovery was disabled on both runtime DynamoDB tables at the time
  of the audit. This is more important for plan state than for expiring perf data.

### Sync jobs

- Provider sync is enabled weekly and reserved to one concurrent execution. Its
  post-deployment run on 2026-07-21 completed in 271.75 seconds with 185 provider
  files queued and zero associations pending. No Lambda error or timeout was
  recorded.
- The knowledge-sync EventBridge rule is `DISABLED` even though its checked-in
  CloudFormation template declares `State: ENABLED`. It has not run since
  2026-05-05; all three observed invocations ended in the known Tawk HTTP 403
  path while still reporting zero native Lambda errors. The runtime continues to
  use an existing KB vector store, but this audit could not establish its content
  freshness from the Lambda path.
