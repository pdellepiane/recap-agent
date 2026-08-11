import crypto from 'node:crypto';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

import { configureRequiredLocalAwsProfile } from '../../aws/local-profile';

import { createEmptyPlan, mergePlan, normalizeRawPlan, planIntentValues, planSchema } from '../../core/plan';
import { getConfig } from '../../runtime/config';
import { DynamoPlanStore } from '../../storage/dynamo-plan-store';
import type { EvalCase, EvalRunConfig, EvalTurnResult, LambdaTurnResponse } from '../case-schema';
import { lambdaTurnResponseSchema } from '../case-schema';
import {
  redactArtifactText,
  projectSafePlan,
  projectSafeRecord,
  projectSafeTrace,
} from '../../runtime/artifact-redaction';
import { attachEvaluationState } from '../evaluation-state';

export async function runLiveLambdaCase(args: {
  currentCase: EvalCase;
  config: EvalRunConfig;
  artifactDir: string;
}): Promise<{
  turns: EvalTurnResult[];
  status: 'passed' | 'failed' | 'errored' | 'skipped';
}> {
  configureRequiredLocalAwsProfile({
    profile: process.env.AWS_PROFILE,
    region: process.env.AWS_REGION,
  });

  const liveDefaults = await resolveLiveLambdaDefaults(args);
  const functionUrl = liveDefaults.functionUrl;
  if (!functionUrl) {
    return {
      turns: [],
      status: 'skipped',
    };
  }
  const channelApiKey = process.env.CHANNEL_API_KEY;
  if (!channelApiKey) {
    throw new Error('CHANNEL_API_KEY is required for live Lambda evaluations.');
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
        authorization: `Bearer ${channelApiKey}`,
      },
      body: JSON.stringify({
        channel: input.channel ?? channel,
        user_id: input.externalUserId ?? externalUserId,
        text: input.text,
        message_id: `${args.currentCase.id}-${turnIndex}`,
        received_at: input.receivedAt ?? new Date().toISOString(),
        session_id: input.sessionId ?? args.currentCase.id,
        contact_phone: resolveConfiguredContactPhone(input.contactPhone),
        client_mode: 'cli',
      }),
      signal: AbortSignal.timeout(95_000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Live Lambda returned HTTP ${response.status}: ${errorBody.slice(0, 500)}`,
      );
    }

    const raw = await response.json();
    const parsed = lambdaTurnResponseSchema.parse(raw);
    const typedTrace = lambdaTurnResponseSchema.shape.trace.parse(parsed.trace);
    const typedPerf = parsed.perf === undefined || parsed.perf === null
      ? parsed.perf
      : lambdaTurnResponseSchema.shape.perf.parse(parsed.perf);
    let turnPlan = parsed.plan ? planSchema.parse(parsed.plan) : null;
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
    const evaluationPlan = turnPlan ??
      planSchema.parse(
        normalizeRawPlan({
          ...seedPlanFallback(input.channel ?? channel, input.externalUserId ?? externalUserId),
          ...normalizePlanFromTrace(
            parsed,
            input.channel ?? channel,
            input.externalUserId ?? externalUserId,
          ),
        }),
      );
    const turn: EvalTurnResult = {
      turnIndex,
      input: redactLiveInput(input),
      outputText: redactArtifactText(parsed.message ?? ''),
      currentNode: parsed.current_node,
      trace: projectSafeTrace(typedTrace) as LambdaTurnResponse['trace'],
      perf:
        typedPerf === undefined || typedPerf === null
          ? typedPerf
          : projectSafeRecord(typedPerf),
      plan: projectSafePlan(evaluationPlan),
      latencyMs: Date.now() - startedAt,
    };
    attachEvaluationState(turn, {
      plan: evaluationPlan,
      input,
      outputText: parsed.message ?? '',
    });
    turns.push(turn);
  }

  return {
    turns,
    status: 'passed',
  };
}

function redactLiveInput(input: EvalTurnResult['input']): EvalTurnResult['input'] {
  return {
    ...input,
    text: redactArtifactText(input.text),
    ...(input.externalUserId
      ? { externalUserId: input.externalUserId }
      : {}),
    ...(input.contactPhone !== undefined ? { contactPhone: null } : {}),
  };
}

function resolveConfiguredContactPhone(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (!value.startsWith('$')) {
    return value;
  }
  const variableName = value.slice(1);
  const configured = process.env[variableName];
  if (!configured) {
    throw new Error(`${variableName} is required for this live phone-auth case.`);
  }
  return configured;
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
    selected_provider_ids: [],
    selected_provider_hints: [],
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
