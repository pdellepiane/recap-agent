# Sources

| Name | Path or URL | Type | Date Checked | Why It Matters | Caveats |
| --- | --- | --- | --- | --- | --- |
| Runtime CloudFormation | `infra/cloudformation/stack.yaml` | Repository file | 2026-07-21 | Defines runtime logging, retention, Lambda, and DynamoDB telemetry | Describes intended state; live state was checked separately |
| Runtime handler | `src/lambda/handler.ts` | Repository file | 2026-07-21 | Shows request logging, successful-turn persistence, and caught 500 behavior | Does not contain deployment history |
| Request observability | `src/lambda/request-observability.ts` | Repository file | 2026-07-21 | Defines structured request fields and hashing/redaction | Covers completion events, not full traces |
| Performance trace builder | `src/logs/trace/perf.ts` | Repository file | 2026-07-21 | Defines stored trace fields, TTL, redaction, and quality flags | User preview and message ID remain raw |
| Channel integration contract | `docs/channel-integration.md` | Repository documentation | 2026-07-21 | Documents adapter retry and current lack of runtime idempotency | Correctness depends on adapter compliance |
| Provider sync template | `infra/provider-sync.yml` | Repository file | 2026-07-21 | Defines weekly schedule and reserved concurrency | Live schedule state checked separately |
| Knowledge sync template | `infra/knowledge-sync.yml` | Repository file | 2026-07-21 | Defines intended weekly schedule | Live rule had drifted to disabled |
| Runtime stack and Lambda configuration | AWS CloudFormation/Lambda, `recap-agent-runtime` | Live AWS resources | 2026-07-21 | Establishes deployment time, artifact, runtime, logging, and tracing modes | Point-in-time snapshot |
| Runtime request logs | CloudWatch Logs, `/aws/lambda/recap-agent-runtime` | Live log group | 2026-07-21 | Supplies HTTP outcomes, application errors, latency, nodes, and duplicate hashes | Seven-day rolling retention; messages were inspected only in aggregate except the two redacted error events |
| Runtime Lambda metrics | CloudWatch `AWS/Lambda` | Live metrics | 2026-07-21 | Supplies invocations, native errors, throttles, and duration | Native `Errors` excludes formatted HTTP 500 responses |
| Successful-turn telemetry | DynamoDB `recap-agent-runtime-perf` | Live table | 2026-07-21 | Supplies state-machine, timing, token, classifier, quality, and tool evidence | Successful turns only; 30-day TTL; aggregate queries avoided message bodies |
| Provider sync logs and metrics | CloudWatch/Lambda, `recap-agent-provider-sync-dev` | Live AWS resources | 2026-07-21 | Establishes current index refresh outcome | Text logs have no explicit final success event beyond pending count reaching zero and invocation completion |
| Knowledge sync logs, metrics, rule, and artifact | CloudWatch/Lambda/EventBridge/S3, `recap-agent-knowledge-sync-dev` | Live AWS resources | 2026-07-21 | Establishes stale deployment, disabled schedule, and historic 403 path | Does not prove current OpenAI vector-store contents |
| Lambda metrics semantics | https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html | Official AWS documentation | 2026-07-21 | Verifies what the Lambda `Errors` metric counts | Product documentation may evolve |
| Lambda X-Ray semantics | https://docs.aws.amazon.com/lambda/latest/dg/services-xray.html | Official AWS documentation | 2026-07-21 | Verifies that `PassThrough` does not automatically record traces | Product documentation may evolve |
| Node.js structured Lambda logging | https://docs.aws.amazon.com/lambda/latest/dg/nodejs-logging.html | Official AWS documentation | 2026-07-21 | Verifies JSON console-log structure and advanced logging controls | Product documentation may evolve |
