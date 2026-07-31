# How To Repeat

## Prerequisites

- AWS CLI authenticated with profile `se-dev`.
- `jq`, `rg`, Node.js, and repository dependencies installed.
- Read access to DynamoDB table `recap-agent-runtime-perf` and CloudWatch log
  group `/aws/lambda/recap-agent-runtime`.

## Commands

```bash
aws sts get-caller-identity --profile se-dev

aws dynamodb scan \
  --profile se-dev \
  --table-name recap-agent-runtime-perf \
  --filter-expression '#channel = :whatsapp AND #next = :faq' \
  --expression-attribute-names '{"#channel":"channel","#next":"next_node"}' \
  --expression-attribute-values '{":whatsapp":{"S":"whatsapp"},":faq":{"S":"consultar_faq"}}' \
  --projection-expression 'captured_at,external_user_hash,user_message_preview,assistant_message_preview_redacted,previous_node,next_node,assistant_message_quality_flags,tools_called,trace_id,message_id,conversation_id' \
  --output json > /tmp/faq-scan.json

jq '{
  count: .Count,
  with_file_search: ([.Items[] | select((.tools_called.L // []) | map(.S) | index("file_search"))] | length),
  with_quality_flags: ([.Items[] | select(((.assistant_message_quality_flags.L // []) | length) > 0)] | length),
  duplicate_groups: ([.Items[] | .message_id.S] | group_by(.) | map(select(length > 1)) | length),
  duplicate_excess_records: ([.Items[] | .message_id.S] | group_by(.) | map(select(length > 1) | length - 1) | add),
  min_captured_at: ([.Items[].captured_at.S] | min),
  max_captured_at: ([.Items[].captured_at.S] | max)
}' /tmp/faq-scan.json

aws logs describe-log-groups \
  --profile se-dev \
  --log-group-name-prefix '/aws/lambda/recap-agent-runtime' \
  --query 'logGroups[0].{retentionInDays:retentionInDays,storedBytes:storedBytes}'

aws logs tail '/aws/lambda/recap-agent-runtime' \
  --profile se-dev \
  --since 7d \
  --format short

npm run check
```

## Expected Outputs

- The summary values should be compared with
  `artifacts/2026-07-24-summary.json`.
- Raw exports remain in `/tmp`; do not commit user-message exports.

## Validation

- Verify duplicate groups by native `message_id`, not message text.
- Match CloudWatch and DynamoDB by UTC timestamp, hashed external user, selected
  node, and delivery outcome. CloudWatch does not include the DynamoDB trace id.
- Manually review redacted message previews before assigning a business topic;
  do not turn the audit keyword list into conversational routing logic.
