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

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Terminal client

The terminal client is intentionally thin. It does not run the agent locally; it sends user turns to the deployed Lambda Function URL.

Required env vars:

```bash
export AGENT_FUNCTION_URL="https://..."
export TERMINAL_USER_ID="51999999999"
```

Then run:

```bash
npm run terminal
```

## Lambda runtime env vars

```bash
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5
OPENAI_EXTRACTOR_MODEL=gpt-5-mini
AWS_REGION=us-east-1
PLANS_TABLE_NAME=recap-agent-runtime-plans
PROMPTS_DIR=/var/task/prompts
SINENVOLTURAS_BASE_URL=https://api.sinenvolturas.com/api-web/vendor
```

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
