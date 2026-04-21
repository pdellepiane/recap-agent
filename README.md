# recap-agent

Serverless conversational agent runtime for Sin Envolturas.

## What is implemented

- Explicit decision-flow-aligned runtime based on the `Flujo de estados`.
- Per-turn plan persistence with a `PlanStore` abstraction and DynamoDB implementation.
- OpenAI Agents SDK orchestration with:
  - one conversational agent;
  - one structured extractor agent.
- Spanish prompt files under `prompts/`, mapped to exact flow nodes.
- Real Sin Envolturas provider gateway for read-side operations.
- Lambda handler plus a local terminal client that hits the live Lambda Function URL.
- CloudFormation stack for Lambda + DynamoDB + Function URL.

## Project layout

- `src/core`: decision nodes, plan schema, sufficiency rules, trace model
- `src/runtime`: prompt loading, OpenAI orchestration, provider gateway, flow service
- `src/storage`: `PlanStore` interfaces and persistence adapters
- `src/lambda`: deployed entrypoint
- `src/terminal`: local client for live Lambda interaction
- `prompts/`: Spanish prompt files tracked by exact node
- `infra/cloudformation`: serverless infrastructure template
- `docs/implementation-log.md`: change log with reasons and decisions
- `docs/evaluation-framework.md`: authoring and operating guide for the eval harness
- `docs/channel-integration.md`: channel-agnostic contract and new-channel implementation guide

## Local checks

Required local runtime:

```bash
node -v  # Node 24 LTS
```

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

## Dev CLI

The CLI is developer-first and always targets the live deployed Lambda runtime, so the conversation path is the same one used by the deployed function. It does not run a separate local agent.

It uses Bun by default:

```bash
npm run terminal
```

Node fallback:

```bash
npm run terminal:node
```

Default resolution order:

1. CLI flags
2. local `.env`
3. CloudFormation stack outputs for `FunctionUrl` and `PlansTableName`
4. hardcoded defaults for profile, region, user id, channel, and timeout

Create your local defaults from the tracked example:

```bash
cp .env.example .env
```

Useful flags:

```bash
npm run terminal -- --help
npm run terminal -- --user-id 51988888888
npm run terminal -- --show-raw --full-plan
npm run terminal -- --url https://... --plans-table recap-agent-runtime-plans
```

Built-in debug commands inside the CLI:

- `/help`
- `/config`
- `/plan`
- `/exit`

After every turn the CLI can show:

- the rendered agent reply
- the full node transition trace
- the persisted perf snapshot for latency, tools, providers, and token efficiency
- the post-turn plan snapshot returned by Lambda
- the raw Lambda JSON payload when `--show-raw` is enabled

Use `/plan` when you specifically want to fetch the current DynamoDB plan row out of band.

## Channel-Agnostic Runtime and Telemetry

The core runtime is channel-agnostic:

- `AgentService` and runtime orchestration are transport-independent.
- channel identity is treated as input data (`channel` + `user_id`) and used for plan scoping.
- traces and perf records are captured server-side on every successful turn, regardless of client type.

Response payload visibility is client-mode dependent:

- `client_mode=cli` returns debug diagnostics (`trace`, `perf`, `plan`) for developer tooling.
- consumer channels should use `client_mode=channel` (or omit it) and receive user-facing fields only.

This means feedback from non-technical channels can still be correlated to hard telemetry data without exposing debug internals to end users.

For full details and implementation guidance, see [channel-integration.md](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/docs/channel-integration.md).

## Purge terminal test plans

To remove persisted plans created by the terminal test channel from DynamoDB:

```bash
npm run purge:terminal-plans -- --dry-run
npm run purge:terminal-plans -- --yes
```

Defaults:

- channel: `terminal_whatsapp`
- stack: `recap-agent-runtime`
- profile: `se-dev`
- region: `us-east-1`

Useful overrides:

```bash
npm run purge:terminal-plans -- --channel terminal_whatsapp --yes
npm run purge:terminal-plans -- --table recap-agent-runtime-plans --yes
```

## Evaluation framework

The repo includes a native evaluation harness for benchmarking the agent across:

- `offline`: deterministic local runs with fixture-backed runtime and provider gateway behavior
- `live_lambda`: live Lambda execution normalized into the same result envelope

Primary commands:

```bash
npm run eval:list
npm run eval -- --suite smoke --target offline
npm run eval -- --suite benchmark_full --target live_lambda --parallel 4
npm run eval -- --case selection.choose_edo_from_shortlist --target offline
npm run eval -- --suite benchmark_full --matrix evals/matrices/models.yaml --dry-run
npm run eval:report -- --input .eval-runs/<run-id>
```

Dataset layout:

- `evals/cases`: scenario definitions
- `evals/templates`: reusable case defaults
- `evals/fixtures`: reusable seed plans and offline fixture fragments
- `evals/suites`: suite manifests
- `evals/matrices`: benchmarking matrices

Run artifacts are written to `.eval-runs/` and are intentionally gitignored.

Each run now emits dashboard-friendly artifacts:

- `report.json` and `report.md` (human-readable summary)
- `dashboard.json` (structured KPI payload for BI ingestion)
- `dashboard.csv` (flat per-case metric table for spreadsheets/dashboards)

The framework is designed around layered expectations rather than transcript snapshots:

- flow and transition checks
- persisted plan checks
- provider shortlist checks
- tool usage checks
- tolerant text checks
- optional semantic graders

Full usage guidance is documented in [evaluation-framework.md](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/docs/evaluation-framework.md).

## Lambda runtime env vars

```bash
OPENAI_MODEL=gpt-5.4-mini
OPENAI_EXTRACTOR_MODEL=gpt-5.4-nano
OPENAI_PROMPT_CACHE_RETENTION=in-memory
AWS_REGION=us-east-1
PLANS_TABLE_NAME=recap-agent-runtime-plans
PROMPTS_DIR=/var/task/prompts
SINENVOLTURAS_BASE_URL=https://api.sinenvolturas.com/api-web/vendor
DEFAULT_INBOUND_CHANNEL=terminal_whatsapp
PROVIDER_SEARCH_LIMIT=15
SEARCH_SUMMARY_WORD_LIMIT=5
REPLY_PROVIDER_LIMIT=15
PRESENTATION_PROVIDER_LIMIT=5
PROVIDER_DETAIL_LOOKUP_LIMIT=3
PERF_TABLE_NAME=recap-agent-runtime-perf
PERF_RETENTION_DAYS=30
```

These env vars are read through one validated runtime config module in [config.ts](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/src/runtime/config.ts). `stack.yaml` supplies the Lambda environment at deploy time, so the CloudFormation defaults and deploy script must stay aligned with `config.ts`. That file is the central place for:

- model selection
- provider search limits
- recommendation display limits
- provider detail lookup limits
- default inbound channel
- AWS table and prompt paths

Linting is enforced through [eslint.config.mjs](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/eslint.config.mjs), including an explicit ban on `any` in TypeScript files.

The repo and deployed Lambda are aligned on Node 24 LTS.

## Deployment

CloudFormation template:

- [`infra/cloudformation/stack.yaml`](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/infra/cloudformation/stack.yaml)

Deployment script:

- `node scripts/deploy.mjs`

The deploy script passes model parameter overrides to CloudFormation from `.env` or the shell when present:

```bash
OPENAI_MODEL=gpt-5.4-mini OPENAI_EXTRACTOR_MODEL=gpt-5.4-nano OPENAI_PROMPT_CACHE_RETENTION=in-memory PERF_RETENTION_DAYS=30 node scripts/deploy.mjs
```

Secret handling:

- the local `.env` provides `OPENAI_API_KEY` only for deployment;
- the deploy script syncs that value to AWS Secrets Manager;
- the Lambda reads the key from Secrets Manager at runtime through `OPENAI_SECRET_ID`;
- the terminal client does not need the OpenAI key.

Internal auth note:

- [docs/aws-auth-setup.md](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/docs/aws-auth-setup.md)
