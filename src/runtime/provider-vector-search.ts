import OpenAI from 'openai';
import type { ComparisonFilter, CompoundFilter } from 'openai/resources/shared';
import type { PersistedPlan } from '../core/plan';
import { getActiveNeed } from '../core/plan';

export type ProviderVectorSearchResult = {
  providerId: number;
  score: number;
  matchedText: string;
  attributes: Record<string, string | number | boolean>;
  filename: string;
};

export type ProviderVectorSearchOptions = {
  apiKey: string;
  vectorStoreId: string;
  maxResults: number;
  scoreThreshold: number;
};

export type RawProviderVectorSearchResult = {
  attributes: Record<string, string | number | boolean> | null;
  content: Array<{ text: string; type: 'text' }>;
  filename: string;
  score: number;
};

export type ProviderVectorSearchRequest = {
  query: string[];
  filters: ComparisonFilter | CompoundFilter | null;
};

export function parseProviderVectorSearchResult(
  value: RawProviderVectorSearchResult,
): ProviderVectorSearchResult | null {
  const attributes = value.attributes ?? {};
  const rawProviderId = attributes.provider_id;
  const providerId =
    typeof rawProviderId === 'number'
      ? rawProviderId
      : typeof rawProviderId === 'string'
        ? Number.parseInt(rawProviderId, 10)
        : null;

  if (!providerId || !Number.isInteger(providerId) || providerId <= 0) {
    return null;
  }

  return {
    providerId,
    score: value.score,
    matchedText: value.content.map((chunk) => chunk.text).join('\n\n'),
    attributes,
    filename: value.filename,
  };
}

export function buildProviderVectorSearchRequest(
  plan: PersistedPlan,
): ProviderVectorSearchRequest {
  const query = buildProviderVectorSearchQueries(plan);
  const filters = buildProviderVectorSearchFilters(plan);
  return { query, filters };
}

export function buildProviderVectorSearchQueries(plan: PersistedPlan): string[] {
  const activeNeed = getActiveNeed(plan);
  const category = activeNeed?.category ?? plan.active_need_category ?? plan.vendor_category;
  const preferenceText = activeNeed?.preferences.length
    ? activeNeed.preferences.join(', ')
    : null;
  const hardConstraintText = activeNeed?.hard_constraints.length
    ? activeNeed.hard_constraints.join(', ')
    : null;

  const baseParts = [
    category ? `Necesidad activa de proveedor: ${category}` : null,
    plan.event_type ? `Tipo de evento: ${plan.event_type}` : null,
    plan.location ? `Ubicación o cobertura requerida: ${plan.location}` : null,
    plan.budget_signal ? `Presupuesto o rango esperado: ${plan.budget_signal}` : null,
    preferenceText ? `Preferencias del usuario: ${preferenceText}` : null,
    hardConstraintText ? `Evitar o penalizar: ${hardConstraintText}` : null,
    plan.conversation_summary
      ? `Contexto de conversación: ${plan.conversation_summary}`
      : null,
    'Busca solo proveedores para esta necesidad activa; no mezcles otras necesidades del plan.',
  ];
  const base = compactJoin(baseParts);

  const queries = [
    base,
    compactJoin([
      category ? `Proveedor de ${category}` : null,
      preferenceText,
      plan.event_type,
      plan.location,
    ]),
    compactJoin([
      category ? `Servicios, promoción y términos de ${category}` : null,
      preferenceText,
      hardConstraintText ? `evitar ${hardConstraintText}` : null,
    ]),
  ].filter((query) => query.length > 0);

  return Array.from(new Set(queries));
}

export function buildProviderVectorSearchFilters(
  plan: PersistedPlan,
): ComparisonFilter | CompoundFilter | null {
  const activeNeed = getActiveNeed(plan);
  const filters: ComparisonFilter[] = [];
  const category = activeNeed?.category ?? plan.active_need_category ?? plan.vendor_category;

  if (category) {
    filters.push({
      type: 'eq',
      key: 'category_key',
      value: category,
    });
  }

  const location = plan.location?.trim();
  if (location) {
    const country = countryFromLocation(location);
    if (country) {
      filters.push({
        type: 'eq',
        key: 'country_key',
        value: normalizeKey(country),
      });
    }
  }

  if (filters.length === 0) {
    return null;
  }
  if (filters.length === 1) {
    return filters[0] ?? null;
  }

  return {
    type: 'and',
    filters,
  };
}

export class ProviderVectorSearchGateway {
  private readonly client: OpenAI;

  constructor(private readonly options: ProviderVectorSearchOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey, maxRetries: 3 });
  }

  async search(plan: PersistedPlan): Promise<ProviderVectorSearchResult[]> {
    const request = buildProviderVectorSearchRequest(plan);
    const response = await this.client.vectorStores.search(
      this.options.vectorStoreId,
      {
        query: request.query,
        max_num_results: this.options.maxResults,
        rewrite_query: true,
        ...(request.filters ? { filters: request.filters } : {}),
        ranking_options: {
          ranker: 'auto',
          score_threshold: this.options.scoreThreshold,
        },
      },
    );

    return response.data.flatMap((item) => {
      const parsed = parseProviderVectorSearchResult(item);
      return parsed ? [parsed] : [];
    });
  }
}

function compactJoin(parts: Array<string | null>): string {
  return parts.filter((value): value is string => Boolean(value?.trim())).join('\n');
}

function countryFromLocation(location: string): string | null {
  const normalized = normalizeKey(location);

  if (normalized.includes('peru') || normalized.includes('lima')) {
    return 'Perú';
  }
  if (normalized.includes('mexico') || normalized.includes('queretaro') || normalized.includes('tulum')) {
    return 'México';
  }
  return null;
}

function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
