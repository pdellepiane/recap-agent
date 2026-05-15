import OpenAI from 'openai';
import type { ComparisonFilter, CompoundFilter } from 'openai/resources/shared';
import { locationCountryKey } from '../core/location';
import type { PersistedPlan } from '../core/plan';
import { getActiveNeed } from '../core/plan';
import { resolveSearchCategories } from '../core/provider-category';
import type { QueryIntentProviderSearchInput } from './provider-gateway';

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

export function buildLocationFilter(location: string | null): ComparisonFilter | CompoundFilter | null {
  if (!location) {
    return null;
  }
  const country = locationCountryKey(location);
  if (!country) {
    return null;
  }
  return {
    type: 'or',
    filters: [
      { type: 'eq', key: 'country_key', value: country },
      { type: 'eq', key: 'country_key', value: '' },
    ],
  };
}

export function buildProviderVectorSearchFilters(
  categories: string[],
  location: string | null,
): ComparisonFilter | CompoundFilter | null {
  const filters: Array<ComparisonFilter | CompoundFilter> = [];

  if (categories.length === 1) {
    filters.push({
      type: 'eq',
      key: 'category_key',
      value: categories[0],
    });
  } else if (categories.length > 1) {
    filters.push({
      type: 'or',
      filters: categories.map((category) => ({
        type: 'eq' as const,
        key: 'category_key',
        value: category,
      })),
    });
  }

  const locationFilter = buildLocationFilter(location);
  if (locationFilter) {
    filters.push(locationFilter);
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
    const activeNeed = getActiveNeed(plan);
    const categoryValue = activeNeed?.category ?? plan.active_need_category ?? plan.vendor_category;
    const categories = resolveSearchCategories(categoryValue);
    const queries = buildProviderVectorSearchQueries(plan);

    console.log('[search-funnel] vector search categories:', categories,
      'location:', plan.location ?? '(none)',
      'queries:', queries.length);

    if (categories.length <= 1) {
      const filters = buildProviderVectorSearchFilters(categories, plan.location ?? null);
      console.log('[search-funnel] single-category filter:', filters ? JSON.stringify(filters) : 'none');

      const response = await this.client.vectorStores.search(
        this.options.vectorStoreId,
        {
          query: queries,
          max_num_results: this.options.maxResults,
          rewrite_query: true,
          ...(filters ? { filters } : {}),
          ranking_options: {
            ranker: 'auto',
            score_threshold: this.options.scoreThreshold,
          },
        },
      );

      const seen = new Set<number>();
      const results = response.data.flatMap((item) => {
        const parsed = parseProviderVectorSearchResult(item);
        if (!parsed || seen.has(parsed.providerId)) return [];
        seen.add(parsed.providerId);
        return [parsed];
      });

      console.log('[search-funnel] vector raw hits:', response.data.length,
        'after dedup:', results.length,
        'scores:', results.map((r) => r.score.toFixed(3)).join(', '));

      return results;
    }

    // Parallel search: each category gets the full result budget;
    // final representation is determined by relevance scores, not quotas.
    console.log('[search-funnel] parallel search for', categories.length,
      'categories, budget each:', this.options.maxResults);

    const locationFilter = buildLocationFilter(plan.location ?? null);
    const searchPromises = categories.map(async (category) => {
      const categoryFilter: ComparisonFilter = {
        type: 'eq',
        key: 'category_key',
        value: category,
      };
      const filters: ComparisonFilter | CompoundFilter = locationFilter
        ? { type: 'and', filters: [categoryFilter, locationFilter] }
        : categoryFilter;

      const response = await this.client.vectorStores.search(
        this.options.vectorStoreId,
        {
          query: queries,
          max_num_results: this.options.maxResults,
          rewrite_query: true,
          filters,
          ranking_options: {
            ranker: 'auto',
            score_threshold: this.options.scoreThreshold,
          },
        },
      );

      const seen = new Set<number>();
      const results = response.data.flatMap((item) => {
        const parsed = parseProviderVectorSearchResult(item);
        if (!parsed || seen.has(parsed.providerId)) return [];
        seen.add(parsed.providerId);
        return [parsed];
      });

      console.log(`[search-funnel] category "${category}": raw=${response.data.length} dedup=${results.length} scores=[${results.map((r) => r.score.toFixed(3)).join(', ')}]`);

      return results;
    });

    const categoryResults = await Promise.all(searchPromises);

    // Merge and deduplicate across categories, keeping highest score.
    // Score-based merging means categories with stronger results naturally
    // claim more slots in the final ranked list.
    const bestById = new Map<number, ProviderVectorSearchResult>();
    for (const results of categoryResults) {
      for (const result of results) {
        const existing = bestById.get(result.providerId);
        if (!existing || result.score > existing.score) {
          bestById.set(result.providerId, result);
        }
      }
    }

    const merged = Array.from(bestById.values()).sort((a, b) => b.score - a.score);
    console.log('[search-funnel] merged parallel results:', merged.length,
      'scores:', merged.map((r) => r.score.toFixed(3)).join(', '));

    return merged;
  }

  async searchQueryIntent(
    input: QueryIntentProviderSearchInput,
  ): Promise<ProviderVectorSearchResult[]> {
    const categories = resolveSearchCategories(input.category);
    const filters = buildProviderVectorSearchFilters(categories, input.location);
    const queries = Array.from(new Set(input.queryStrings.filter((query) => query.trim().length > 0)));

    const response = await this.client.vectorStores.search(
      this.options.vectorStoreId,
      {
        query: queries,
        max_num_results: this.options.maxResults,
        rewrite_query: true,
        ...(filters ? { filters } : {}),
        ranking_options: {
          ranker: 'auto',
          score_threshold: this.options.scoreThreshold,
        },
      },
    );

    const seen = new Set<number>();
    return response.data.flatMap((item) => {
      const parsed = parseProviderVectorSearchResult(item);
      if (!parsed || seen.has(parsed.providerId)) return [];
      seen.add(parsed.providerId);
      return [parsed];
    });
  }
}

function compactJoin(parts: Array<string | null>): string {
  return parts.filter((value): value is string => Boolean(value?.trim())).join('\n');
}
