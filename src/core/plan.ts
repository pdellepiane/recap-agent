import { z } from 'zod';

import type { DecisionNode } from './decision-nodes';
import type { ProviderSummary } from './provider';

export const planIntentValues = [
  'buscar_proveedores',
  'refinar_busqueda',
  'ver_opciones',
  'confirmar_proveedor',
  'retomar_plan',
  'cerrar',
  'pausar',
] as const;

export type PlanIntent = (typeof planIntentValues)[number];

export const guestRangeValues = [
  '1-20',
  '21-50',
  '51-100',
  '101-200',
  '201+',
  'unknown',
] as const;

export type GuestRange = (typeof guestRangeValues)[number];

export const planSchema = z.object({
  plan_id: z.string(),
  channel: z.string(),
  external_user_id: z.string(),
  conversation_id: z.string().nullable(),
  current_node: z.string(),
  intent: z.enum(planIntentValues).nullable(),
  intent_confidence: z.number().min(0).max(1).nullable(),
  event_type: z.string().nullable(),
  vendor_category: z.string().nullable(),
  location: z.string().nullable(),
  budget_signal: z.string().nullable(),
  guest_range: z.enum(guestRangeValues).nullable(),
  preferences: z.array(z.string()),
  hard_constraints: z.array(z.string()),
  missing_fields: z.array(z.string()),
  recommended_provider_ids: z.array(z.number()),
  recommended_providers: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      slug: z.string().nullish(),
      category: z.string().nullish(),
      location: z.string().nullish(),
      priceLevel: z.string().nullish(),
      rating: z.string().nullish(),
      reason: z.string().nullish(),
    }),
  ),
  selected_provider_id: z.number().nullable(),
  selected_provider_hint: z.string().nullable(),
  assumptions: z.array(z.string()),
  conversation_summary: z.string(),
  updated_at: z.string(),
});

export type PersistedPlan = z.infer<typeof planSchema>;

export type PlanSnapshot = PersistedPlan & { current_node: DecisionNode };

export type PlanUpdate = Partial<
  Omit<PersistedPlan, 'plan_id' | 'channel' | 'external_user_id'>
>;

export function createEmptyPlan(args: {
  planId: string;
  channel: string;
  externalUserId: string;
}): PlanSnapshot {
  return {
    plan_id: args.planId,
    channel: args.channel,
    external_user_id: args.externalUserId,
    conversation_id: null,
    current_node: 'contacto_inicial',
    intent: null,
    intent_confidence: null,
    event_type: null,
    vendor_category: null,
    location: null,
    budget_signal: null,
    guest_range: null,
    preferences: [],
    hard_constraints: [],
    missing_fields: [],
    recommended_provider_ids: [],
    recommended_providers: [],
    selected_provider_id: null,
    selected_provider_hint: null,
    assumptions: [],
    conversation_summary: '',
    updated_at: new Date(0).toISOString(),
  };
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
  );
}

export function mergePlan(plan: PlanSnapshot, update: PlanUpdate): PlanSnapshot {
  const merged: PersistedPlan = {
    ...plan,
    ...update,
    preferences: uniqueStrings([...(plan.preferences ?? []), ...(update.preferences ?? [])]),
    hard_constraints: uniqueStrings([
      ...(plan.hard_constraints ?? []),
      ...(update.hard_constraints ?? []),
    ]),
    assumptions: uniqueStrings([...(plan.assumptions ?? []), ...(update.assumptions ?? [])]),
    recommended_provider_ids:
      update.recommended_provider_ids ?? plan.recommended_provider_ids ?? [],
    recommended_providers: update.recommended_providers ?? plan.recommended_providers ?? [],
    missing_fields: update.missing_fields ?? plan.missing_fields ?? [],
    updated_at: update.updated_at ?? new Date().toISOString(),
  };

  return planSchema.parse(merged) as PlanSnapshot;
}

export function summarizeRecommendedProviders(providers: ProviderSummary[]): string {
  if (providers.length === 0) {
    return 'No hay proveedores recomendados todavía.';
  }

  return providers
    .map((provider, index) => {
      const location = provider.location ? ` en ${provider.location}` : '';
      const category = provider.category ? ` [${provider.category}]` : '';
      const price = provider.priceLevel ? ` (${provider.priceLevel})` : '';
      return `${index + 1}. ${provider.title}${category}${location}${price}`;
    })
    .join('\n');
}
