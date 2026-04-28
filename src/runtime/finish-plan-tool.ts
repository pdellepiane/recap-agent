import {
  FINISHED_PLAN_TTL_SECONDS,
  mergePlan,
  type PersistedPlan,
  type PlanSnapshot,
} from '../core/plan';
import type { ProviderGateway } from './provider-gateway';

export type FinishPlanToolResult = {
  status: 'success' | 'partial' | 'failed';
  contacted_providers: Array<{
    providerId: number;
    category: string;
    success: boolean;
    error?: string;
  }>;
  ttl_epoch_seconds: number;
};

export type FinishPlanToolErrorResult = {
  status: 'failed';
  error: 'missing_contact_info' | 'no_selected_providers';
  detail: string;
  ttl_epoch_seconds: number;
};

export type FinishPlanToolOutput = FinishPlanToolResult | FinishPlanToolErrorResult;

/**
 * Shared implementation for `finish_plan`: sends quote requests to all selected
 * providers (one per need) via the provider gateway, mutates the persisted plan
 * to finished state, and returns per-provider outcomes.
 */
export async function executeFinishPlanTool(args: {
  plan: PersistedPlan;
  providerGateway: ProviderGateway;
  onPlanFinished?: (ttlEpochSeconds: number) => void;
}): Promise<FinishPlanToolOutput> {
  const { plan, providerGateway, onPlanFinished } = args;

  if (!plan.contact_name || !plan.contact_email || !plan.contact_phone) {
    return {
      status: 'failed',
      error: 'missing_contact_info',
      detail:
        'Faltan datos de contacto. Solicita nombre, email y teléfono antes de llamar finish_plan.',
      ttl_epoch_seconds: 0,
    };
  }

  const selectedProviders = plan.provider_needs
    .filter((need) => need.selected_provider_id !== null)
    .map((need) => ({
      providerId: need.selected_provider_id!,
      category: need.category,
    }));

  if (selectedProviders.length === 0) {
    return {
      status: 'failed',
      error: 'no_selected_providers',
      detail:
        'No hay proveedores seleccionados. El usuario debe elegir al menos un proveedor antes de cerrar.',
      ttl_epoch_seconds: 0,
    };
  }

  const today = new Date().toISOString().split('T')[0];
  const guestsRange = plan.guest_range ?? '';

  const fallbackDescription = `Solicitud de cotización para ${plan.event_type ?? 'evento'} en ${plan.location ?? 'su ubicación'}.`;
  const description = plan.conversation_summary && plan.conversation_summary.trim().length >= 10
    ? plan.conversation_summary.trim()
    : fallbackDescription;

  const contactedProviders: FinishPlanToolResult['contacted_providers'] = [];

  for (const entry of selectedProviders) {
    try {
      await providerGateway.createQuoteRequest({
        providerId: entry.providerId,
        name: plan.contact_name,
        email: plan.contact_email,
        phone: plan.contact_phone,
        phoneExtension: '+51',
        eventDate: today,
        guestsRange,
        description,
      });
      contactedProviders.push({
        providerId: entry.providerId,
        category: entry.category,
        success: true,
      });
    } catch (error) {
      contactedProviders.push({
        providerId: entry.providerId,
        category: entry.category,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const allSucceeded = contactedProviders.every((p) => p.success);
  const someSucceeded = contactedProviders.some((p) => p.success);
  const overallStatus = allSucceeded
    ? 'success'
    : someSucceeded
      ? 'partial'
      : 'failed';

  let ttlEpochSeconds = 0;
  if (overallStatus !== 'failed') {
    ttlEpochSeconds = Math.floor(Date.now() / 1000) + FINISHED_PLAN_TTL_SECONDS;
    const snapshot = mergePlan(plan as PlanSnapshot, {
      lifecycle_state: 'finished',
      current_node: 'necesidad_cubierta',
      intent: 'cerrar',
      updated_at: new Date().toISOString(),
    });
    Object.assign(plan, snapshot);
    onPlanFinished?.(ttlEpochSeconds);
  }

  return {
    status: overallStatus,
    contacted_providers: contactedProviders,
    ttl_epoch_seconds: ttlEpochSeconds,
  };
}
