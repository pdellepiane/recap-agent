import crypto from 'node:crypto';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

import { createEmptyPlan, mergePlan, planIntentValues, planSchema } from '../../core/plan';
import { getConfig } from '../../runtime/config';
import { DynamoPlanStore } from '../../storage/dynamo-plan-store';
import type { EvalCase, EvalRunConfig, EvalTurnResult, LambdaTurnResponse } from '../case-schema';
import { lambdaTurnResponseSchema } from '../case-schema';

export async function runLiveLambdaCase(args: {
  currentCase: EvalCase;
  config: EvalRunConfig;
  artifactDir: string;
}): Promise<{
  turns: EvalTurnResult[];
  status: 'passed' | 'failed' | 'errored' | 'skipped';
}> {
  const profile = process.env.AWS_PROFILE ?? 'se-dev';
  const region = process.env.AWS_REGION ?? 'us-east-1';
  process.env.AWS_PROFILE = profile;
  process.env.AWS_REGION = region;
  process.env.AWS_SDK_LOAD_CONFIG = process.env.AWS_SDK_LOAD_CONFIG ?? '1';
  process.env.AWS_PAGER = '';

  const liveDefaults = await resolveLiveLambdaDefaults(args);
  const functionUrl = liveDefaults.functionUrl;
  if (!functionUrl) {
    return {
      turns: [],
      status: 'skipped',
    };
  }

  const channel =
    args.currentCase.configOverrides?.liveLambda?.channel ??
    args.config.liveLambda?.channel ??
    process.env.TERMINAL_CHANNEL ??
    'terminal_whatsapp';
  const planStore = new DynamoPlanStore(liveDefaults.plansTableName, {
    region: liveDefaults.region,
  });
  const externalUserId = `${channel}-${args.config.label}-${args.currentCase.id}-${crypto
    .randomUUID()
    .slice(0, 8)}`;
  const seedChannel = args.currentCase.inputs[0]?.channel ?? channel;
  const seedExternalUserId =
    args.currentCase.inputs[0]?.externalUserId ?? externalUserId;
  if (args.currentCase.seedPlan) {
    try {
      await planStore.save({
        plan: mergePlan(
          createEmptyPlan({
            planId: crypto.randomUUID(),
            channel: seedChannel,
            externalUserId: seedExternalUserId,
          }),
          args.currentCase.seedPlan,
        ),
        reason: 'eval-seed',
      });
    } catch {
      return {
        turns: [],
        status: 'skipped',
      };
    }
  }
  const turns: EvalTurnResult[] = [];

  for (const [turnIndex, input] of args.currentCase.inputs.entries()) {
    const startedAt = Date.now();
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        channel: input.channel ?? channel,
        user_id: input.externalUserId ?? externalUserId,
        text: input.text,
        message_id: `${args.currentCase.id}-${turnIndex}`,
        received_at: input.receivedAt ?? new Date().toISOString(),
        client_mode: 'cli',
      }),
    });

    if (!response.ok) {
      throw new Error(`Live Lambda returned HTTP ${response.status}.`);
    }

    const raw = (await response.json()) as LambdaTurnResponse;
    const parsed = lambdaTurnResponseSchema.parse(raw);
    let turnPlan = parsed.plan ?? null;
    if (!turnPlan) {
      try {
        turnPlan = await planStore.getByExternalUser(
          input.channel ?? channel,
          input.externalUserId ?? externalUserId,
        );
      } catch {
        turnPlan = null;
      }
    }
    turns.push({
      turnIndex,
      input,
      outputText: parsed.message,
      currentNode: parsed.current_node,
      trace: parsed.trace,
      perf: parsed.perf ?? null,
      plan:
        turnPlan ??
        planSchema.parse({
          ...seedPlanFallback(input.channel ?? channel, input.externalUserId ?? externalUserId),
          ...normalizePlanFromTrace(
            parsed,
            input.channel ?? channel,
            input.externalUserId ?? externalUserId,
          ),
        }),
      latencyMs: Date.now() - startedAt,
      rawTargetResponse: parsed as unknown as Record<string, unknown>,
    });
  }

  return {
    turns,
    status: 'passed',
  };
}

async function resolveLiveLambdaDefaults(args: {
  currentCase: EvalCase;
  config: EvalRunConfig;
}): Promise<{
  functionUrl: string | null;
  plansTableName: string;
  region: string;
}> {
  const appConfig = getConfig();
  const region = process.env.AWS_REGION ?? appConfig.aws.region;
  const stackName = process.env.STACK_NAME ?? 'recap-agent-runtime';
  const directFunctionUrl =
    args.currentCase.configOverrides?.liveLambda?.functionUrl ??
    args.config.liveLambda?.functionUrl ??
    appConfig.lambda.functionUrl ??
    null;
  const directPlansTableName = process.env.PLANS_TABLE_NAME ?? null;

  let outputs: Partial<Record<'FunctionUrl' | 'PlansTableName', string>> = {};
  if (!directFunctionUrl || !directPlansTableName) {
    try {
      outputs = await getStackOutputs(stackName, region);
    } catch {
      outputs = {};
    }
  }

  const functionUrl =
    directFunctionUrl ??
    outputs.FunctionUrl ??
    null;

  const plansTableName =
    directPlansTableName ??
    outputs.PlansTableName ??
    appConfig.storage.plansTableName;

  return {
    functionUrl,
    plansTableName,
    region,
  };
}

async function getStackOutputs(stackName: string, region: string) {
  const client = new CloudFormationClient({ region });
  const response = await client.send(
    new DescribeStacksCommand({
      StackName: stackName,
    }),
  );
  const outputs = response.Stacks?.[0]?.Outputs ?? [];
  return Object.fromEntries(
    outputs
      .filter((item) => item.OutputKey && item.OutputValue)
      .map((item) => [item.OutputKey as string, item.OutputValue as string]),
  ) as Partial<Record<'FunctionUrl' | 'PlansTableName', string>>;
}

function seedPlanFallback(channel: string, externalUserId: string) {
  return {
    plan_id: 'unknown',
    channel,
    external_user_id: externalUserId,
    conversation_id: null,
    lifecycle_state: 'active',
    contact_name: null,
    contact_email: null,
    current_node: 'contacto_inicial',
    intent: null,
    intent_confidence: null,
    event_type: null,
    vendor_category: null,
    active_need_category: null,
    location: null,
    budget_signal: null,
    guest_range: null,
    preferences: [],
    hard_constraints: [],
    missing_fields: [],
    provider_needs: [],
    recommended_provider_ids: [],
    recommended_providers: [],
    selected_provider_id: null,
    selected_provider_hint: null,
    assumptions: [],
    conversation_summary: '',
    last_user_goal: null,
    open_questions: [],
    updated_at: new Date(0).toISOString(),
  };
}

function normalizePlanFromTrace(
  response: LambdaTurnResponse,
  channel: string,
  externalUserId: string,
) {
  const normalizedIntent = planIntentValues.includes(
    response.trace.intent as (typeof planIntentValues)[number],
  )
    ? (response.trace.intent as (typeof planIntentValues)[number])
    : null;

  return {
    plan_id: response.plan_id,
    channel,
    external_user_id: externalUserId,
    conversation_id: response.conversation_id,
    current_node: response.current_node,
    intent: normalizedIntent,
    missing_fields: response.trace.missing_fields,
    recommended_providers: response.trace.provider_results,
    recommended_provider_ids: response.trace.provider_results.map((provider) => provider.id),
    updated_at: new Date().toISOString(),
  };
}
