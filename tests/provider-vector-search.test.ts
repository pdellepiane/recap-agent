import { describe, expect, it } from 'vitest';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import {
  buildProviderVectorSearchFilters,
  buildProviderVectorSearchQueries,
  parseProviderVectorSearchResult,
} from '../src/runtime/provider-vector-search';

describe('provider vector search result parser', () => {
  it('parses valid provider ids and matched text', () => {
    const parsed = parseProviderVectorSearchResult({
      attributes: {
        provider_id: 42,
        category: 'Fotografía',
      },
      content: [
        { type: 'text', text: 'Fotografía documental para bodas íntimas.' },
      ],
      filename: '42-foto.md',
      score: 0.87,
    });

    expect(parsed).toEqual({
      providerId: 42,
      score: 0.87,
      matchedText: 'Fotografía documental para bodas íntimas.',
      attributes: {
        provider_id: 42,
        category: 'Fotografía',
      },
      filename: '42-foto.md',
    });
  });

  it('rejects malformed provider ids', () => {
    const malformedValues = ['abc', 0, -1, true];

    for (const providerId of malformedValues) {
      expect(
        parseProviderVectorSearchResult({
          attributes: {
            provider_id: providerId,
          },
          content: [{ type: 'text', text: 'irrelevant' }],
          filename: 'bad.md',
          score: 0.5,
        }),
      ).toBeNull();
    }
  });
});

describe('provider vector search request formulation', () => {
  it('uses only the active provider need and expands category aliases for recall', () => {
    const plan = mergePlan(
      createEmptyPlan({
        planId: 'plan-vector-query',
        channel: 'terminal_whatsapp',
        externalUserId: 'user-1',
      }),
      {
        event_type: 'boda',
        active_need_category: 'Fotografía y video',
        vendor_category: 'Fotografía y video',
        location: 'Lima',
        conversation_summary: 'También necesitaré catering después, pero ahora busco foto documental.',
        provider_needs: [
          {
            category: 'Fotografía y video',
            status: 'search_ready',
            preferences: ['documental', 'natural'],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [],
            recommended_providers: [],
            selected_provider_id: null,
            selected_provider_hint: null,
          },
          {
            category: 'Catering',
            status: 'identified',
            preferences: ['criollo'],
            hard_constraints: [],
            missing_fields: [],
            recommended_provider_ids: [],
            recommended_providers: [],
            selected_provider_id: null,
            selected_provider_hint: null,
          },
        ],
      },
    );

    const queries = buildProviderVectorSearchQueries(plan);
    const filters = buildProviderVectorSearchFilters(plan);

    expect(queries.length).toBeGreaterThan(1);
    expect(queries[0]).toContain('Necesidad activa de proveedor: Fotografía y video');
    expect(queries[0]).toContain('no mezcles otras necesidades');
    expect(queries.join('\n')).toContain('documental, natural');
    expect(filters?.type).toBe('and');
    const compoundFilters = filters && 'filters' in filters ? filters.filters : [];
    const categoryFilter = compoundFilters.find(
      (filter) =>
        typeof filter === 'object' &&
        filter !== null &&
        'key' in filter &&
        filter.key === 'category_key',
    );
    const countryFilter = compoundFilters.find(
      (filter) =>
        typeof filter === 'object' &&
        filter !== null &&
        'key' in filter &&
        filter.key === 'country_key',
    );

    expect(categoryFilter).toMatchObject({
      type: 'eq',
      key: 'category_key',
      value: 'Fotografía y video',
    });
    expect(countryFilter).toMatchObject({
      type: 'eq',
      key: 'country_key',
      value: 'peru',
    });
  });
});
