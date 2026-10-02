import { mergePlan, type PersistedPlan, type PlanSnapshot } from '../core/plan';
import { splitStoredInternationalPhone } from './phone';
import type { ProviderGateway } from './provider-gateway';

const EVENT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export function isValidEventDate(value: unknown): value is string {
  if (typeof value !== 'string' || !EVENT_DATE_PATTERN.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

export type ProviderQuoteEffectStatus = 'confirmed' | 'failed' | 'unresolved';

export type ProviderQuoteEffect = {
  readonly providerId: number;
  readonly category: string;
  readonly status: ProviderQuoteEffectStatus;
  readonly eventDate: string;
  readonly receiptId: string | null;
  readonly error: string | null;
  readonly attemptCount: number;
};

export type PlanCompletionGateway = Pick<ProviderGateway, 'createQuoteRequest'>;

export type PlanCompletionRequest = {
  readonly plan: PersistedPlan;
  readonly eventDate: unknown;
  readonly providerGateway: PlanCompletionGateway;
  readonly priorEffects?: readonly ProviderQuoteEffect[];
};

export type PlanCompletionOutcome = {
  readonly status: 'success' | 'partial' | 'failed';
  readonly error: 'missing_event_date' | 'invalid_event_date' | 'missing_contact_info' | 'invalid_contact_info' | 'no_selected_providers' | null;
  readonly detail: string | null;
  readonly eventDate: string | null;
  readonly effects: readonly ProviderQuoteEffect[];
  readonly finished: boolean;
  readonly planUpdate: PlanSnapshot | null;
  readonly retriedProviderIds: readonly number[];
  readonly replayedProviderIds: readonly number[];
};

type SelectedProvider = { readonly providerId: number; readonly category: string };

function fail(
  error: NonNullable<PlanCompletionOutcome['error']>,
  detail: string,
): PlanCompletionOutcome {
  return {
    status: 'failed',
    error,
    detail,
    eventDate: null,
    effects: [],
    finished: false,
    planUpdate: null,
    retriedProviderIds: [],
    replayedProviderIds: [],
  };
}

function isUnknownEffect(message: string): boolean {
  return message.toLowerCase().includes('unknown');
}

function receiptIdOf(result: unknown, providerId: number): string {
  if (result !== null && typeof result === 'object') {
    const id = (result as Record<string, unknown>)['id'] ?? (result as Record<string, unknown>)['syntheticId'];
    if (typeof id === 'string' && id.trim().length > 0) {
      return id;
    }
    if (typeof id === 'number') {
      return String(id);
    }
  }
  return `quote-${providerId}`;
}

export async function executePlanCompletion(request: PlanCompletionRequest): Promise<PlanCompletionOutcome> {
  const { plan, providerGateway } = request;
  const prior = request.priorEffects ?? [];

  if (typeof request.eventDate !== 'string' || request.eventDate.trim().length === 0) {
    return fail(
      'missing_event_date',
      'Falta la fecha del evento. Pide una fecha explicita antes de llamar finish_plan; nunca se envia hoy ni nulo.',
    );
  }
  if (!isValidEventDate(request.eventDate)) {
    return fail(
      'invalid_event_date',
      'La fecha del evento debe tener formato AAAA-MM-DD valido antes de llamar finish_plan.',
    );
  }
  const eventDate: string = request.eventDate;

  if (!plan.contact_name || !plan.contact_email || !plan.contact_phone) {
    return fail(
      'missing_contact_info',
      'Faltan datos de contacto. Solicita nombre, correo electrónico y teléfono antes de llamar finish_plan.',
    );
  }

  const selected: SelectedProvider[] = plan.provider_needs.flatMap((need) =>
    need.selected_provider_ids.map((providerId) => ({ providerId, category: need.category })),
  );
  if (selected.length === 0) {
    return fail(
      'no_selected_providers',
      'No hay proveedores seleccionados. El usuario debe elegir al menos un proveedor antes de cerrar.',
    );
  }

  const parsedPhone = splitStoredInternationalPhone(plan.contact_phone);
  const phoneParts = parsedPhone
    ? { phone: parsedPhone.phone_number, phoneExtension: parsedPhone.phone_extension }
    : null;
  if (!phoneParts) {
    return fail(
      'invalid_contact_info',
      'El teléfono debe incluir código de país y número completo antes de llamar finish_plan.',
    );
  }

  const guestsRange = plan.guest_range ?? '';
  const trimmedSummary = plan.contact_name && plan.conversation_summary.trim().length >= 10
    ? plan.conversation_summary.trim()
    : `Solicitud de cotización para ${plan.event_type ?? 'evento'} en ${plan.location ?? 'su ubicación'}.`;

  const priorByProvider = new Map<number, ProviderQuoteEffect>();
  for (const effect of prior) {
    if (!priorByProvider.has(effect.providerId)) {
      priorByProvider.set(effect.providerId, effect);
    }
  }

  const effects: ProviderQuoteEffect[] = [];
  const retried: number[] = [];
  const replayed: number[] = [];
  for (const entry of selected) {
    const previous = priorByProvider.get(entry.providerId);
    if (previous?.status === 'confirmed') {
      replayed.push(entry.providerId);
      effects.push(previous);
      continue;
    }
    if (previous) {
      retried.push(entry.providerId);
    }
    const attemptCount = (previous?.attemptCount ?? 0) + 1;
    try {
      const result = await providerGateway.createQuoteRequest({
        providerId: entry.providerId,
        name: plan.contact_name,
        email: plan.contact_email,
        phone: phoneParts.phone,
        phoneExtension: phoneParts.phoneExtension,
        eventDate,
        guestsRange,
        description: trimmedSummary,
      });
      effects.push({
        providerId: entry.providerId,
        category: entry.category,
        status: 'confirmed',
        eventDate,
        receiptId: receiptIdOf(result, entry.providerId),
        error: null,
        attemptCount,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      effects.push({
        providerId: entry.providerId,
        category: entry.category,
        status: isUnknownEffect(message) ? 'unresolved' : 'failed',
        eventDate,
        receiptId: null,
        error: message,
        attemptCount,
      });
    }
  }

  const allConfirmed = effects.length > 0 && effects.every((effect) => effect.status === 'confirmed');
  const someConfirmed = effects.some((effect) => effect.status === 'confirmed');
  const status = allConfirmed ? 'success' : someConfirmed ? 'partial' : 'failed';
  const planUpdate = allConfirmed
    ? mergePlan(plan as PlanSnapshot, {
      lifecycle_state: 'finished',
      current_node: 'necesidad_cubierta',
      intent: 'cerrar',
      updated_at: new Date().toISOString(),
    })
    : null;

  return {
    status,
    error: null,
    detail: null,
    eventDate,
    effects,
    finished: allConfirmed,
    planUpdate,
    retriedProviderIds: retried,
    replayedProviderIds: replayed,
  };
}
