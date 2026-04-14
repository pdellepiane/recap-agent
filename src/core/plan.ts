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

export const providerNeedStatusValues = [
  'identified',
  'search_ready',
  'shortlisted',
  'selected',
  'deferred',
] as const;

export type ProviderNeedStatus = (typeof providerNeedStatusValues)[number];

const providerSummarySchema = z.object({
  id: z.number(),
  title: z.string(),
  slug: z.string().nullish(),
  category: z.string().nullish(),
  location: z.string().nullish(),
  priceLevel: z.string().nullish(),
  rating: z.string().nullish(),
  reason: z.string().nullish(),
  detailUrl: z.string().nullish(),
  websiteUrl: z.string().nullish(),
  minPrice: z.string().nullish(),
  maxPrice: z.string().nullish(),
  promoBadge: z.string().nullish(),
  promoSummary: z.string().nullish(),
  descriptionSnippet: z.string().nullish(),
  serviceHighlights: z.array(z.string()).default([]),
  termsHighlights: z.array(z.string()).default([]),
});

export const providerNeedSchema = z.object({
  category: z.string(),
  status: z.enum(providerNeedStatusValues),
  preferences: z.array(z.string()),
  hard_constraints: z.array(z.string()),
  missing_fields: z.array(z.string()),
  recommended_provider_ids: z.array(z.number()),
  recommended_providers: z.array(providerSummarySchema),
  selected_provider_id: z.number().nullable(),
  selected_provider_hint: z.string().nullable(),
});

export type ProviderNeed = z.infer<typeof providerNeedSchema>;

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
  active_need_category: z.string().nullable(),
  location: z.string().nullable(),
  budget_signal: z.string().nullable(),
  guest_range: z.enum(guestRangeValues).nullable(),
  preferences: z.array(z.string()),
  hard_constraints: z.array(z.string()),
  missing_fields: z.array(z.string()),
  provider_needs: z.array(providerNeedSchema),
  recommended_provider_ids: z.array(z.number()),
  recommended_providers: z.array(providerSummarySchema),
  selected_provider_id: z.number().nullable(),
  selected_provider_hint: z.string().nullable(),
  assumptions: z.array(z.string()),
  conversation_summary: z.string(),
  last_user_goal: z.string().nullable(),
  open_questions: z.array(z.string()),
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

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
  );
}

function normalizeCategory(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.toLowerCase();
}

function mergeProviderNeed(
  current: ProviderNeed | null,
  update: Partial<ProviderNeed> & { category: string },
): ProviderNeed {
  const recommendedProviderIds =
    update.recommended_provider_ids ?? current?.recommended_provider_ids ?? [];
  const selectedProviderId =
    update.selected_provider_id ?? current?.selected_provider_id ?? null;
  const recommendedProviders =
    update.recommended_providers ?? current?.recommended_providers ?? [];

  let status = update.status ?? current?.status ?? 'identified';
  if (selectedProviderId) {
    status = 'selected';
  } else if (recommendedProviders.length > 0 || recommendedProviderIds.length > 0) {
    status = 'shortlisted';
  } else if ((update.missing_fields ?? current?.missing_fields ?? []).length === 0) {
    status = 'search_ready';
  }

  return providerNeedSchema.parse({
    category: update.category,
    status,
    preferences: uniqueStrings([
      ...(current?.preferences ?? []),
      ...(update.preferences ?? []),
    ]),
    hard_constraints: uniqueStrings([
      ...(current?.hard_constraints ?? []),
      ...(update.hard_constraints ?? []),
    ]),
    missing_fields: update.missing_fields ?? current?.missing_fields ?? [],
    recommended_provider_ids: recommendedProviderIds,
    recommended_providers: recommendedProviders,
    selected_provider_id: selectedProviderId,
    selected_provider_hint:
      update.selected_provider_hint ?? current?.selected_provider_hint ?? null,
  });
}

function mergeProviderNeeds(
  current: ProviderNeed[],
  updates: ProviderNeed[],
): ProviderNeed[] {
  const map = new Map<string, ProviderNeed>();

  for (const need of current) {
    const key = normalizeCategory(need.category);
    if (!key) {
      continue;
    }

    map.set(key, providerNeedSchema.parse(need));
  }

  for (const update of updates) {
    const key = normalizeCategory(update.category);
    if (!key) {
      continue;
    }

    map.set(key, mergeProviderNeed(map.get(key) ?? null, update));
  }

  return Array.from(map.values());
}

function ensureActiveNeed(
  providerNeeds: ProviderNeed[],
  activeNeedCategory: string | null,
  fallbackCategory: string | null,
): { providerNeeds: ProviderNeed[]; activeNeedCategory: string | null } {
  const candidate =
    normalizeCategory(activeNeedCategory) ??
    normalizeCategory(fallbackCategory) ??
    providerNeeds[0]?.category ??
    null;

  if (!candidate) {
    return {
      providerNeeds,
      activeNeedCategory: null,
    };
  }

  const existing = providerNeeds.find(
    (need) => normalizeCategory(need.category) === candidate,
  );

  if (existing) {
    return {
      providerNeeds,
      activeNeedCategory: existing.category,
    };
  }

  const nextNeed = mergeProviderNeed(null, {
    category: candidate,
    missing_fields: [],
  });

  return {
    providerNeeds: [...providerNeeds, nextNeed],
    activeNeedCategory: nextNeed.category,
  };
}

function projectActiveNeed(
  providerNeeds: ProviderNeed[],
  activeNeedCategory: string | null,
): Partial<PersistedPlan> {
  const activeNeed =
    providerNeeds.find(
      (need) => normalizeCategory(need.category) === normalizeCategory(activeNeedCategory),
    ) ?? null;

  if (!activeNeed) {
    return {
      vendor_category: activeNeedCategory,
      recommended_provider_ids: [],
      recommended_providers: [],
      selected_provider_id: null,
      selected_provider_hint: null,
    };
  }

  return {
    vendor_category: activeNeed.category,
    recommended_provider_ids: activeNeed.recommended_provider_ids,
    recommended_providers: activeNeed.recommended_providers,
    selected_provider_id: activeNeed.selected_provider_id,
    selected_provider_hint: activeNeed.selected_provider_hint,
  };
}

export function getActiveNeed(plan: Pick<PersistedPlan, 'provider_needs' | 'active_need_category'>): ProviderNeed | null {
  const activeCategory = normalizeCategory(plan.active_need_category);
  if (!activeCategory) {
    return plan.provider_needs[0] ?? null;
  }

  return (
    plan.provider_needs.find(
      (need) => normalizeCategory(need.category) === activeCategory,
    ) ?? null
  );
}

export function summarizeProviderNeeds(providerNeeds: ProviderNeed[]): string {
  if (providerNeeds.length === 0) {
    return 'No hay necesidades de proveedores registradas todavía.';
  }

  return providerNeeds
    .map((need, index) => {
      const selected = need.selected_provider_id
        ? `, proveedor elegido ${need.selected_provider_id}`
        : '';
      return `${index + 1}. ${need.category} [${need.status}]${selected}`;
    })
    .join('\n');
}

export function mergePlan(plan: PlanSnapshot, update: PlanUpdate): PlanSnapshot {
  const mergedProviderNeeds = mergeProviderNeeds(
    plan.provider_needs ?? [],
    update.provider_needs ?? [],
  );
  const needsWithFallback =
    update.vendor_category && !mergedProviderNeeds.some(
      (need) =>
        normalizeCategory(need.category) === normalizeCategory(update.vendor_category),
    )
      ? [
          ...mergedProviderNeeds,
          mergeProviderNeed(null, {
            category: update.vendor_category,
            preferences: update.preferences ?? [],
            hard_constraints: update.hard_constraints ?? [],
            missing_fields: update.missing_fields ?? [],
            recommended_provider_ids: update.recommended_provider_ids ?? [],
            recommended_providers: update.recommended_providers ?? [],
            selected_provider_id: update.selected_provider_id ?? null,
            selected_provider_hint: update.selected_provider_hint ?? null,
          }),
        ]
      : mergedProviderNeeds.map((need) =>
          normalizeCategory(need.category) === normalizeCategory(update.vendor_category)
            ? mergeProviderNeed(need, {
                category: need.category,
                preferences: update.preferences ?? [],
                hard_constraints: update.hard_constraints ?? [],
                missing_fields: update.missing_fields ?? need.missing_fields,
                recommended_provider_ids:
                  update.recommended_provider_ids ?? need.recommended_provider_ids,
                recommended_providers:
                  update.recommended_providers ?? need.recommended_providers,
                selected_provider_id:
                  update.selected_provider_id ?? need.selected_provider_id,
                selected_provider_hint:
                  update.selected_provider_hint ?? need.selected_provider_hint,
              })
            : need,
        );
  const activeNeedState = ensureActiveNeed(
    needsWithFallback,
    update.active_need_category ?? plan.active_need_category,
    update.vendor_category ?? plan.vendor_category,
  );
  const activeProjection = projectActiveNeed(
    activeNeedState.providerNeeds,
    activeNeedState.activeNeedCategory,
  );

  const merged: PersistedPlan = {
    ...plan,
    ...update,
    preferences: uniqueStrings([...(plan.preferences ?? []), ...(update.preferences ?? [])]),
    hard_constraints: uniqueStrings([
      ...(plan.hard_constraints ?? []),
      ...(update.hard_constraints ?? []),
    ]),
    assumptions: uniqueStrings([...(plan.assumptions ?? []), ...(update.assumptions ?? [])]),
    missing_fields: update.missing_fields ?? plan.missing_fields ?? [],
    provider_needs: activeNeedState.providerNeeds,
    active_need_category: activeNeedState.activeNeedCategory,
    recommended_provider_ids: activeProjection.recommended_provider_ids ?? [],
    recommended_providers: activeProjection.recommended_providers ?? [],
    selected_provider_id: activeProjection.selected_provider_id ?? null,
    selected_provider_hint: activeProjection.selected_provider_hint ?? null,
    vendor_category: activeProjection.vendor_category ?? null,
    open_questions: uniqueStrings([
      ...(plan.open_questions ?? []),
      ...(update.open_questions ?? []),
    ]),
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
      const location = provider.location ?? 'ubicación no especificada';
      const category = provider.category ? ` [${provider.category}]` : '';
      const price = provider.priceLevel ? ` (${provider.priceLevel})` : '';
      const differentiators = [
        provider.promoBadge ?? provider.promoSummary ?? null,
        provider.serviceHighlights?.slice(0, 2).join(', ') || null,
        provider.descriptionSnippet,
      ].filter((value): value is string => Boolean(value));
      const detailUrl = provider.detailUrl ? ` | ficha: ${provider.detailUrl}` : '';
      return `${index + 1}. ${provider.title}${category} | ubicación: ${location}${price}${differentiators.length > 0 ? ` | detalles: ${differentiators.join(' | ')}` : ''}${detailUrl}`;
    })
    .join('\n');
}
