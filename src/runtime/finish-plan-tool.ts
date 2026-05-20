import { mergePlan, type PersistedPlan, type PlanSnapshot } from '../core/plan';
import type { ProviderGateway } from './provider-gateway';
import { parseInternationalPhone } from './phone';

export type FinishPlanToolResult = {
  status: 'success' | 'partial' | 'failed';
  contacted_providers: Array<{
    providerId: number;
    category: string;
    success: boolean;
    error?: string;
  }>;
};

export type FinishPlanToolErrorResult = {
  status: 'failed';
  error: 'missing_contact_info' | 'invalid_contact_info' | 'no_selected_providers';
  detail: string;
};

export type FinishPlanToolOutput = FinishPlanToolResult | FinishPlanToolErrorResult;

function splitPhoneExtension(digits: string): { phone: string; phoneExtension: string } | null {
  const parsed = parseInternationalPhone(`+${digits.replace(/\D/g, '')}`);
  if (parsed.status !== 'valid') {
    return null;
  }
  return {
    phone: parsed.nationalNumber,
    phoneExtension: parsed.countryCode,
  };
}

export async function executeFinishPlanTool(args: {
  plan: PersistedPlan;
  providerGateway: ProviderGateway;
}): Promise<FinishPlanToolOutput> {
  const { plan, providerGateway } = args;

  if (!plan.contact_name || !plan.contact_email || !plan.contact_phone) {
    return {
      status: 'failed',
      error: 'missing_contact_info',
      detail:
        'Faltan datos de contacto. Solicita nombre, email y teléfono antes de llamar finish_plan.',
    };
  }

  const selectedProviders = plan.provider_needs
    .flatMap((need) => need.selected_provider_ids.map((providerId) => ({
      providerId,
      category: need.category,
    })));

  if (selectedProviders.length === 0) {
    return {
      status: 'failed',
      error: 'no_selected_providers',
      detail:
        'No hay proveedores seleccionados. El usuario debe elegir al menos un proveedor antes de cerrar.',
    };
  }

  const today = new Date().toISOString().split('T')[0];
  const guestsRange = plan.guest_range ?? '';

  const fallbackDescription = `Solicitud de cotización para ${plan.event_type ?? 'evento'} en ${plan.location ?? 'su ubicación'}.`;
  const description = plan.conversation_summary && plan.conversation_summary.trim().length >= 10
    ? plan.conversation_summary.trim()
    : fallbackDescription;

  const contactedProviders: FinishPlanToolResult['contacted_providers'] = [];
  const phoneParts = splitPhoneExtension(plan.contact_phone);
  if (!phoneParts) {
    return {
      status: 'failed',
      error: 'invalid_contact_info',
      detail:
        'El teléfono debe incluir código de país compatible y número completo antes de llamar finish_plan.',
    };
  }
  const { phone, phoneExtension } = phoneParts;

  for (const entry of selectedProviders) {
    try {
      await providerGateway.createQuoteRequest({
        providerId: entry.providerId,
        name: plan.contact_name,
        email: plan.contact_email,
        phone,
        phoneExtension,
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

  if (overallStatus !== 'failed') {
    const snapshot = mergePlan(plan as PlanSnapshot, {
      lifecycle_state: 'finished',
      current_node: 'necesidad_cubierta',
      intent: 'cerrar',
      updated_at: new Date().toISOString(),
    });
    Object.assign(plan, snapshot);
  }

  return {
    status: overallStatus,
    contacted_providers: contactedProviders,
  };
}
