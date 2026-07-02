import { describe, expect, it } from 'vitest';

import type { ProviderSummary } from '../src/core/provider';
import type { ProviderNeedSubQuery } from '../src/core/provider-sub-query';
import type { ProviderFitCriteria } from '../src/runtime/provider-fit';
import { selectProvidersForSubQuery } from '../src/runtime/provider-sub-query-selection';

const criteria: ProviderFitCriteria = {
  eventType: 'boda',
  needCategory: 'catering',
  location: 'Lima',
  budgetAmount: null,
  budgetCurrency: null,
  mustHave: [],
  shouldAvoid: [],
  rankingNotes: '',
};

function provider(input: Partial<ProviderSummary> & { id: number; title: string }): ProviderSummary {
  return {
    id: input.id,
    title: input.title,
    slug: null,
    category: input.category ?? 'Catering',
    location: input.location ?? 'Lima',
    priceLevel: input.priceLevel ?? 'mid',
    rating: null,
    reason: null,
    detailUrl: null,
    websiteUrl: null,
    minPrice: null,
    maxPrice: null,
    promoBadge: null,
    promoSummary: null,
    descriptionSnippet: input.descriptionSnippet ?? null,
    serviceHighlights: input.serviceHighlights ?? [],
    termsHighlights: [],
    description: input.description ?? null,
    eventTypes: input.eventTypes ?? ['boda'],
    retrievalScore: input.retrievalScore ?? null,
    retrievalSource: input.retrievalSource ?? 'vector',
  };
}

function subQuery(input: Partial<ProviderNeedSubQuery>): ProviderNeedSubQuery {
  return {
    id: input.id ?? 'sushi',
    label: input.label ?? 'sushi',
    category: input.category ?? 'Catering',
    queryStrings: input.queryStrings ?? ['catering con sushi en Lima'],
    mustHave: input.mustHave ?? ['sushi'],
    shouldAvoid: input.shouldAvoid ?? [],
    maxSelections: input.maxSelections ?? 1,
    allowCrossCategory: input.allowCrossCategory ?? false,
  };
}

describe('provider sub-query selection', () => {
  it('lets exact must-have evidence beat generic catering matches', () => {
    const result = selectProvidersForSubQuery({
      subQuery: subQuery({ label: 'sushi', mustHave: ['sushi'] }),
      baseCriteria: criteria,
      providers: [
        provider({
          id: 135,
          title: 'Paola Puerta Catering',
          descriptionSnippet: 'Catering para matrimonios y eventos elegantes.',
          retrievalScore: 0.72,
        }),
        provider({
          id: 109,
          title: 'Edo Sushi Bar',
          descriptionSnippet: 'Catering de sushi para eventos.',
          serviceHighlights: ['Catering de sushi para eventos'],
          retrievalScore: 0.87,
        }),
      ],
    });

    expect(result.selected_provider_ids).toEqual([109]);
    expect(result.candidates[0]?.fitTags).toContain('must_have_evidence');
  });

  it('filters category mismatches unless cross-category is allowed', () => {
    const result = selectProvidersForSubQuery({
      subQuery: subQuery({ allowCrossCategory: false }),
      baseCriteria: criteria,
      providers: [
        provider({
          id: 1,
          title: 'Violinista',
          category: 'Música',
          descriptionSnippet: 'Música en vivo para bodas.',
        }),
        provider({
          id: 2,
          title: 'Sushi Mesa',
          category: 'Catering',
          descriptionSnippet: 'Catering con sushi.',
        }),
      ],
    });

    expect(result.candidate_provider_ids).toEqual([2]);
    expect(result.selected_provider_ids).toEqual([2]);
  });

  it('requires event-service evidence for home and decoration providers', () => {
    const result = selectProvidersForSubQuery({
      subQuery: subQuery({
        id: 'decoracion',
        label: 'decoración minimalista',
        category: 'Hogar y deco',
        queryStrings: ['decoración minimalista para baby shower'],
        mustHave: [],
        maxSelections: 2,
      }),
      baseCriteria: {
        ...criteria,
        eventType: 'baby_shower',
        needCategory: 'Hogar y deco',
      },
      providers: [
        provider({
          id: 1,
          title: 'Tienda de muebles',
          category: 'Hogar y deco',
          descriptionSnippet: 'Muebles modernos para sala y dormitorio.',
        }),
        provider({
          id: 2,
          title: 'Nina Creativa',
          category: 'Hogar y deco',
          descriptionSnippet: 'Recuerdos y velas personalizadas para baby showers y eventos.',
          eventTypes: ['baby_shower'],
        }),
      ],
    });

    expect(result.candidate_provider_ids).toEqual([2, 1]);
    expect(result.selected_provider_ids).toEqual([2]);
    expect(result.candidates.find((candidate) => candidate.id === 2)?.fitTags).toContain(
      'event_service_evidence',
    );
    expect(result.candidates.find((candidate) => candidate.id === 1)?.fitWarnings).toContain(
      'La ficha no demuestra un servicio orientado a eventos.',
    );
  });
});
