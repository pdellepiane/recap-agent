import { z } from 'zod';

import { decisionNodeSchema, type DecisionNode } from './decision-nodes';
import { eventTypeSchema, normalizeToEventType } from './event-type';
import { formatPriceLevel } from './price-level';
import { providerSummarySchema, type ProviderSummary } from './provider';
import {
  normalizeToProviderCategory,
  providerCategorySchema,
  type ProviderCategory,
} from './provider-category';
import { providerSubQueryResultSchema } from './provider-sub-query';

export const planIntentValues = [
  'elicitar_necesidades',
  'buscar_proveedores',
  'refinar_busqueda',
  'ver_opciones',
  'confirmar_proveedor',
  'modificar_plan_proveedores',
  'explicar_recomendacion',
  'detallar_proveedor',
  'retomar_plan',
  'cerrar',
  'pausar',
  'consultar_faq',
  'consultar_evento_invitado',
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

export const planLifecycleValues = ['active', 'finished'] as const;

export type PlanLifecycleState = (typeof planLifecycleValues)[number];

export const providerNeedStatusValues = [
  'identified',
  'search_ready',
  'shortlisted',
  'selected',
  'deferred',
  'no_providers_available',
] as const;

export type ProviderNeedStatus = (typeof providerNeedStatusValues)[number];

export const providerNeedSchema = z.object({
  category: providerCategorySchema,
  status: z.enum(providerNeedStatusValues),
  preferences: z.array(z.string()),
  hard_constraints: z.array(z.string()),
  missing_fields: z.array(z.string()),
  recommended_provider_ids: z.array(z.number()),
  recommended_providers: z.array(providerSummarySchema),
  sub_query_results: z.array(providerSubQueryResultSchema).optional(),
  selected_provider_ids: z.array(z.number()),
  selected_provider_hints: z.array(z.string()),
});

export type ProviderNeed = z.infer<typeof providerNeedSchema>;

export const planSchema = z.object({
  plan_id: z.string(),
  channel: z.string(),
  external_user_id: z.string(),
  conversation_id: z.string().nullable(),
  lifecycle_state: z.enum(planLifecycleValues).default('active'),
  contact_name: z.string().nullable().default(null),
  contact_email: z.string().nullable().default(null),
  contact_phone: z.string().nullable().default(null),
  current_node: decisionNodeSchema,
  intent: z.enum(planIntentValues).nullable(),
  intent_confidence: z.number().min(0).max(1).nullable(),
  event_type: eventTypeSchema.nullable(),
  vendor_category: providerCategorySchema.nullable(),
  active_need_category: providerCategorySchema.nullable(),
  location: z.string().nullable(),
  budget_signal: z.string().nullable(),
  guest_range: z.enum(guestRangeValues).nullable(),
  preferences: z.array(z.string()),
  hard_constraints: z.array(z.string()),
  missing_fields: z.array(z.string()),
  provider_needs: z.array(providerNeedSchema),
  recommended_provider_ids: z.array(z.number()),
  recommended_providers: z.array(providerSummarySchema),
  selected_provider_ids: z.array(z.number()),
  selected_provider_hints: z.array(z.string()),
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

export function normalizeRawPlan(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') {
    return raw;
  }

  const plan = { ...(raw as Record<string, unknown>) };

  const normalizeField = (field: string): void => {
    if (typeof plan[field] === 'string') {
      plan[field] = normalizeToProviderCategory(plan[field]);
    }
  };

  normalizeField('vendor_category');
  normalizeField('active_need_category');

  if (typeof plan.event_type === 'string') {
    plan.event_type = normalizeToEventType(plan.event_type);
  }

  if (typeof plan.selected_provider_id === 'number' && !Array.isArray(plan.selected_provider_ids)) {
    plan.selected_provider_ids = [plan.selected_provider_id];
  }
  if (typeof plan.selected_provider_hint === 'string' && !Array.isArray(plan.selected_provider_hints)) {
    plan.selected_provider_hints = [plan.selected_provider_hint];
  }
  delete plan.selected_provider_id;
  delete plan.selected_provider_hint;

  if (Array.isArray(plan.provider_needs)) {
    const providerNeeds: unknown[] = plan.provider_needs;
    plan.provider_needs = providerNeeds.map((need) => {
      if (!need || typeof need !== 'object') {
        return need;
      }
      const needObj = { ...(need as Record<string, unknown>) };
      if (typeof needObj.category === 'string') {
        needObj.category = normalizeToProviderCategory(needObj.category);
      }
      if (typeof needObj.selected_provider_id === 'number' && !Array.isArray(needObj.selected_provider_ids)) {
        needObj.selected_provider_ids = [needObj.selected_provider_id];
      }
      if (typeof needObj.selected_provider_hint === 'string' && !Array.isArray(needObj.selected_provider_hints)) {
        needObj.selected_provider_hints = [needObj.selected_provider_hint];
      }
      if (!Array.isArray(needObj.sub_query_results)) {
        needObj.sub_query_results = [];
      }
      delete needObj.selected_provider_id;
      delete needObj.selected_provider_hint;
      return needObj;
    });
  }

  return plan;
}

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
    lifecycle_state: 'active',
    contact_name: null,
    contact_email: null,
    contact_phone: null,
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

export function isPlanFinished(
  plan: Pick<PersistedPlan, 'lifecycle_state'> | null | undefined,
): boolean {
  return plan?.lifecycle_state === 'finished';
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
  );
}

function normalizeCategory(value: string | null | undefined): ProviderCategory | null {
  return normalizeToProviderCategory(value);
}

function mergeProviderNeed(
  current: ProviderNeed | null,
  update: Partial<ProviderNeed> & { category: string },
): ProviderNeed {
  const recommendedProviderIds =
    update.recommended_provider_ids ?? current?.recommended_provider_ids ?? [];
  const isExplicitSelectionClear =
    update.selected_provider_ids !== undefined &&
    update.selected_provider_ids.length === 0 &&
    update.selected_provider_hints !== undefined &&
    update.selected_provider_hints.length === 0;
  const selectedProviderIds = isExplicitSelectionClear
    ? []
    : Array.from(
        new Set([
          ...(current?.selected_provider_ids ?? []),
          ...(update.selected_provider_ids ?? []),
        ]),
      );
  const selectedProviderHints = isExplicitSelectionClear
    ? []
    : uniqueStrings([
        ...(current?.selected_provider_hints ?? []),
        ...(update.selected_provider_hints ?? []),
      ]);
  const recommendedProviders =
    update.recommended_providers ?? current?.recommended_providers ?? [];
  const subQueryResults =
    update.sub_query_results ?? current?.sub_query_results ?? [];

  let status = update.status ?? current?.status ?? 'identified';

  if (update.status) {
    // Explicit status update always wins
    status = update.status;
  } else if (selectedProviderIds.length > 0) {
    status = 'selected';
  } else if (current?.status === 'no_providers_available' && recommendedProviders.length === 0) {
    // Preserve terminal "no providers" status unless new results arrived
    status = 'no_providers_available';
  } else if (current?.status === 'deferred') {
    // Preserve deferred unless explicitly changed or selected
    status = 'deferred';
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
    sub_query_results: subQueryResults,
    selected_provider_ids: selectedProviderIds,
    selected_provider_hints: selectedProviderHints,
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
): { providerNeeds: ProviderNeed[]; activeNeedCategory: ProviderCategory | null } {
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
  activeNeedCategory: ProviderCategory | null,
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
      selected_provider_ids: [],
      selected_provider_hints: [],
    };
  }

  return {
    vendor_category: activeNeed.category,
    recommended_provider_ids: activeNeed.recommended_provider_ids,
    recommended_providers: activeNeed.recommended_providers,
    selected_provider_ids: activeNeed.selected_provider_ids,
    selected_provider_hints: activeNeed.selected_provider_hints,
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

export function replaceProviderNeeds(
  plan: PlanSnapshot,
  providerNeeds: ProviderNeed[],
  activeNeedCategory: ProviderCategory | null,
): PlanSnapshot {
  const parsedNeeds = providerNeeds.map((need) => providerNeedSchema.parse(need));
  const activeCategory =
    normalizeCategory(activeNeedCategory) ??
    normalizeCategory(parsedNeeds[0]?.category) ??
    null;
  const activeProjection = projectActiveNeed(parsedNeeds, activeCategory);

  return planSchema.parse({
    ...plan,
    provider_needs: parsedNeeds,
    active_need_category: activeCategory,
    vendor_category: activeProjection.vendor_category ?? activeCategory,
    recommended_provider_ids: activeProjection.recommended_provider_ids ?? [],
    recommended_providers: activeProjection.recommended_providers ?? [],
    selected_provider_ids: activeProjection.selected_provider_ids ?? [],
    selected_provider_hints: activeProjection.selected_provider_hints ?? [],
    updated_at: new Date().toISOString(),
  }) as PlanSnapshot;
}

export function summarizeProviderNeeds(providerNeeds: ProviderNeed[]): string {
  if (providerNeeds.length === 0) {
    return 'No hay necesidades de proveedores registradas todavía.';
  }

  return providerNeeds
    .map((need, index) => {
      const selected = need.selected_provider_ids.length > 0
        ? `, proveedores elegidos ${need.selected_provider_ids.join(', ')}`
        : '';
      const unavailable = need.status === 'no_providers_available'
        ? ' (sin proveedores disponibles)'
        : '';
      return `${index + 1}. ${need.category} [${need.status}]${selected}${unavailable}`;
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
            sub_query_results: update.provider_needs?.find(
              (need) => normalizeCategory(need.category) === normalizeCategory(update.vendor_category),
            )?.sub_query_results ?? [],
            selected_provider_ids: update.selected_provider_ids ?? [],
            selected_provider_hints: update.selected_provider_hints ?? [],
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
                sub_query_results: update.provider_needs?.find(
                  (updatedNeed) => normalizeCategory(updatedNeed.category) === normalizeCategory(need.category),
                )?.sub_query_results ?? need.sub_query_results,
                selected_provider_ids:
                  update.selected_provider_ids ?? need.selected_provider_ids,
                selected_provider_hints:
                  update.selected_provider_hints ?? need.selected_provider_hints,
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
    selected_provider_ids: activeProjection.selected_provider_ids ?? [],
    selected_provider_hints: activeProjection.selected_provider_hints ?? [],
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
      const price = provider.priceLevel ? ` (${formatPriceLevel(provider.priceLevel)})` : '';
      const differentiators = [
        provider.promoBadge ?? provider.promoSummary ?? null,
        provider.serviceHighlights?.slice(0, 1).join(', ') || null,
        provider.descriptionSnippet,
      ].filter((value): value is string => Boolean(value));
      return `${index + 1}. ${provider.title}${category} | ubicación: ${location}${price}${differentiators.length > 0 ? ` | detalles: ${differentiators.join(' | ')}` : ''}`;
    })
    .join('\n');
}
