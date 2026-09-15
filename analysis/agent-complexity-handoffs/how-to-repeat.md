# Reproduce this audit

Work from the recap-agent repository. This is an investigation workflow; do not deploy or edit prompts to reproduce its observations. Existing `.eval-runs` are required for the fixed comparison. Preserve private audit files outside published artifacts.

1. Capture `git status --short` and `git rev-parse HEAD`; another development task may change the workspace.
2. Use `aws sts get-caller-identity --profile se-dev --region us-east-1 --query Account --output text`. Require account `684516060775`. If needed, refresh using `aws login --profile se-signin`.
3. Read development deployment metadata before and after live work:

   ```sh
   aws lambda get-function-configuration --function-name recap-agent-runtime-dev --profile se-dev --region us-east-1 --query '{FunctionName:FunctionName,LastModified:LastModified,CodeSha256:CodeSha256,RevisionId:RevisionId,State:State}' --output json
   ```

4. Measure local bundles:

   ```sh
   npm run audit:prompts -- --inventory analysis/agent-complexity-handoffs/artifacts/prompt-inventory.json --branches analysis/agent-complexity-handoffs/artifacts/prompt-branches.json
   ```

5. Inspect each selected case's entire `turns` list in the fixed report. Follow `trace.openai_calls` response IDs. Retrieve each available call with `npm run audit:openai -- --response-id <response-id>`. This performs OpenAI GET requests, writes private files, and requires the configured API key without printing it. Inspect instructions, all input items, output schema, tools, output, and usage. Compare raw extraction ambiguity to normalized trace and reply input; do not rely on the extraction summary alone.
6. Group live `requestMetrics` by classifier/extraction/reply. Report instructionBytes, inputBytes, schemaPropertyCount, and toolCount separately. Count non-null stage references separately from underlying request counts. Median tokens includes cached usage. Keep synthetic branch estimates explicitly separate.
7. Replay the isolated existing scenarios:

   ```sh
   AWS_PROFILE=se-dev AWS_REGION=us-east-1 DEV_STACK_NAME=recap-agent-runtime-dev npm run eval:behavior-live -- --case live_behavior.purchase_confirmation_carina_request_survives_normalization --case live_behavior.mailbox_issue_deferral_and_clarification_preserve_support --case live_behavior.ambiguous_confirmation_clarifies
   ```

The harness uses development identities and the configured fixtures. It persists evaluation state in development and calls live models/judges. Exit 1 in the recorded run represents one failed hard expectation, not an evaluator error. Do not claim a full-suite acceptance gate from this selected replay.

8. Search source callers with `rg -n 'projectExtraction\(' src`. Compare actual `extract()` capability selection to static samples. Inspect semantic overrides and shared/node rules. Record dated results before comparing a replacement architecture.
