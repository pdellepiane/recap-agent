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
- the persisted DynamoDB plan snapshot
- the raw Lambda JSON payload when `--show-raw` is enabled

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

## Lambda runtime env vars

```bash
OPENAI_MODEL=gpt-5
OPENAI_EXTRACTOR_MODEL=gpt-5
AWS_REGION=us-east-1
PLANS_TABLE_NAME=recap-agent-runtime-plans
PROMPTS_DIR=/var/task/prompts
SINENVOLTURAS_BASE_URL=https://api.sinenvolturas.com/api-web/vendor
DEFAULT_INBOUND_CHANNEL=terminal_whatsapp
PROVIDER_SEARCH_LIMIT=5
SEARCH_SUMMARY_WORD_LIMIT=5
REPLY_PROVIDER_LIMIT=3
PROVIDER_DETAIL_LOOKUP_LIMIT=3
```

These env vars are read through one validated runtime config module in [config.ts](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/src/runtime/config.ts). That is the central place for:

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

Secret handling:

- the local `.env` provides `OPENAI_API_KEY` only for deployment;
- the deploy script syncs that value to AWS Secrets Manager;
- the Lambda reads the key from Secrets Manager at runtime through `OPENAI_SECRET_ID`;
- the terminal client does not need the OpenAI key.

Internal auth note:

- [docs/aws-auth-setup.md](/Users/leonardocandio/Desktop/UTEC/2026-1/tesis/recap-agent/docs/aws-auth-setup.md)
