# How To Repeat

## Prerequisites

- Repository checkout with AWS CLI v2 and `jq`.
- Authenticated AWS profile `se-dev` with read access to CloudFormation, Lambda,
  CloudWatch, CloudWatch Logs, DynamoDB, EventBridge, and the artifact S3 bucket.
- Region `us-east-1`.

## Commands

```bash
AWS_PROFILE=se-dev AWS_REGION=us-east-1 aws sts get-caller-identity

AWS_PROFILE=se-dev AWS_REGION=us-east-1 aws cloudformation describe-stacks \
  --stack-name recap-agent-runtime \
  --query 'Stacks[0].{Status:StackStatus,Updated:LastUpdatedTime,Outputs:Outputs}' \
  --output json

AWS_PROFILE=se-dev AWS_REGION=us-east-1 aws lambda get-function-configuration \
  --function-name recap-agent-runtime \
  --query '{LastModified:LastModified,CodeSha256:CodeSha256,Runtime:Runtime,MemorySize:MemorySize,Timeout:Timeout,State:State,LastUpdateStatus:LastUpdateStatus,TracingConfig:TracingConfig,LoggingConfig:LoggingConfig}' \
  --output json

openssl dgst -sha256 -binary .artifacts/recap-agent.zip | base64

AWS_PROFILE=se-dev AWS_REGION=us-east-1 aws logs describe-log-groups \
  --log-group-name-prefix /aws/lambda/recap-agent \
  --query 'logGroups[].{name:logGroupName,retention:retentionInDays,storedBytes:storedBytes,metricFilters:metricFilterCount}' \
  --output json

AWS_PROFILE=se-dev AWS_REGION=us-east-1 aws dynamodb describe-table \
  --table-name recap-agent-runtime-perf \
  --query 'Table.{Status:TableStatus,ItemCount:ItemCount,SizeBytes:TableSizeBytes,GSIs:GlobalSecondaryIndexes}' \
  --output json

AWS_PROFILE=se-dev AWS_REGION=us-east-1 aws dynamodb describe-time-to-live \
  --table-name recap-agent-runtime-perf

AWS_PROFILE=se-dev AWS_REGION=us-east-1 aws cloudwatch describe-alarms \
  --alarm-name-prefix recap-agent

AWS_PROFILE=se-dev AWS_REGION=us-east-1 aws events list-rules \
  --name-prefix recap-agent \
  --query 'Rules[].{Name:Name,State:State,Schedule:ScheduleExpression}' \
  --output json
```

For request-outcome aggregation, start a CloudWatch Logs Insights query over the
desired UTC epoch-second window:

```bash
AWS_PROFILE=se-dev AWS_REGION=us-east-1 aws logs start-query \
  --log-group-name /aws/lambda/recap-agent-runtime \
  --start-time <start-epoch-seconds> \
  --end-time <end-epoch-seconds> \
  --query-string 'filter message.event = "channel_request_completed" | stats count(*) as requests, pct(message.duration_ms, 50) as p50_ms, pct(message.duration_ms, 95) as p95_ms, max(message.duration_ms) as max_ms by message.outcome, message.status_code | sort requests desc'

AWS_PROFILE=se-dev AWS_REGION=us-east-1 aws logs get-query-results \
  --query-id <query-id>
```

For DynamoDB analysis, scan only telemetry fields and aggregate locally. Do not
export `user_message_preview`, raw `message_id`, tool previews, or plan summaries
into shareable artifacts. The exact projection and aggregate used on 2026-07-21
is recorded in `dates/2026-07-21.md`.

For WhatsApp reconciliation:

1. Scan `recap-agent-runtime-perf` for records with `channel=whatsapp` and the
   same UTC start time as the CloudWatch query.
2. Project `captured_at`, `message_id`, `external_user_hash`, `next_node`,
   `runtime_latency_ms`, `assistant_message_hash`, `trace_id`, classifier fields,
   and tool names. Do not retain the raw `message_id` in the output.
3. Compute `sha256(message_id)` locally. This produces the same join key as
   CloudWatch's `message.message_id_hash`.
4. Read structured CloudWatch records with:

```bash
AWS_PROFILE=se-dev AWS_REGION=us-east-1 aws logs filter-log-events \
  --log-group-name /aws/lambda/recap-agent-runtime \
  --start-time <start-epoch-milliseconds> \
  --filter-pattern '{ $.message.event = "channel_request_completed" && $.message.channel = "whatsapp" }' \
  --query 'events[].message' \
  --output json
```

5. Group each source by message hash. Compare counts, user hashes, nodes,
   timestamps, delivery actions, and `CloudWatch duration_ms - DynamoDB
   runtime_latency_ms`. Treat ownership-operation events as intentionally absent
   from the successful-turn table.

## Expected Outputs

- Updated point-in-time conclusions in `findings.md`.
- A sanitized aggregate under `analysis/runtime-observability-audit/artifacts/`.

## Validation

- Confirm the Lambda code hash matches the local deployment artifact before
  attributing runtime observations to the checked-out source.
- Confirm the query end time is later than the latest deployment and explicitly
  state whether any request exercised that artifact.
- Reconcile CloudWatch structured successes with DynamoDB successful-turn counts,
  accounting for log retention and non-production demo channels.
- Require zero unmatched CloudWatch successes, zero user-hash mismatches, and
  zero final-node mismatches. Explain any DynamoDB-only records using deployment
  history or log retention rather than discarding them.
- Inspect application `status_code >= 500` outcomes separately from the native
  Lambda `Errors` metric.
