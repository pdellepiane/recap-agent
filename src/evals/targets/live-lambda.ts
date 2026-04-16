import crypto from 'node:crypto';

import { planSchema, planIntentValues } from '../../core/plan';
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
  const functionUrl = args.config.liveLambda?.functionUrl;
  if (!functionUrl) {
    return {
      turns: [],
      status: 'skipped',
    };
  }

  const channel =
    args.currentCase.configOverrides?.liveLambda?.channel ??
    args.config.liveLambda?.channel ??
    'terminal_whatsapp_eval';
  const config = getConfig();
  const planStore = new DynamoPlanStore(config.storage.plansTableName, {
    region: config.aws.region,
  });
  const externalUserId = `${channel}-${args.config.label}-${args.currentCase.id}-${crypto
    .randomUUID()
    .slice(0, 8)}`;
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
    const persistedPlan = await planStore.getByExternalUser(
      input.channel ?? channel,
      input.externalUserId ?? externalUserId,
    );
    turns.push({
      turnIndex,
      input,
      outputText: parsed.message,
      currentNode: parsed.current_node,
      trace: parsed.trace,
      perf: parsed.perf ?? null,
      plan:
        persistedPlan ??
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

function seedPlanFallback(channel: string, externalUserId: string) {
  return {
    plan_id: 'unknown',
    channel,
    external_user_id: externalUserId,
    conversation_id: null,
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
