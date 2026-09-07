import type { PersistedPlan, PlanSnapshot } from '../core/plan';
import type { ProviderGateway } from './provider-gateway';
import {
  executePlanCompletion,
  type ProviderQuoteEffect,
} from './plan-completion-executor';

export type FinishPlanToolResult = {
  status: 'success' | 'partial' | 'failed';
  contacted_providers: Array<{
    providerId: number;
    category: string;
    success: boolean;
    error?: string;
  }>;
  eventDate: string | null;
  effects: readonly ProviderQuoteEffect[];
  planUpdate: PlanSnapshot | null;
  retryProviderIds: readonly number[];
};

export type FinishPlanToolErrorResult = {
  status: 'failed';
  error:
    | 'missing_contact_info'
    | 'invalid_contact_info'
    | 'no_selected_providers'
    | 'missing_event_date'
    | 'invalid_event_date';
  detail: string;
};

export type FinishPlanToolOutput = FinishPlanToolResult | FinishPlanToolErrorResult;

export async function executeFinishPlanTool(args: {
  plan: PersistedPlan;
  providerGateway: ProviderGateway;
  eventDate?: unknown;
  priorEffects?: readonly ProviderQuoteEffect[];
}): Promise<FinishPlanToolOutput> {
  const outcome = await executePlanCompletion({
    plan: args.plan,
    eventDate: args.eventDate,
    providerGateway: args.providerGateway,
    priorEffects: args.priorEffects,
  });

  if (outcome.error !== null || outcome.eventDate === null) {
    return {
      status: 'failed',
      error: outcome.error ?? 'missing_event_date',
      detail: outcome.detail ?? 'Falta la fecha del evento.',
    };
  }

  return {
    status: outcome.status,
    contacted_providers: outcome.effects.map((effect) => ({
      providerId: effect.providerId,
      category: effect.category,
      success: effect.status === 'confirmed',
      ...(effect.status === 'confirmed' ? {} : { error: effect.error ?? effect.status }),
    })),
    eventDate: outcome.eventDate,
    effects: outcome.effects,
    planUpdate: outcome.planUpdate,
    retryProviderIds: outcome.effects
      .filter((effect) => effect.status !== 'confirmed')
      .map((effect) => effect.providerId),
  };
}
