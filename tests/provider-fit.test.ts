import { describe, expect, it } from 'vitest';

import type { ProviderSummary } from '../src/core/provider';
import {
  createProviderFitCriteria,
  normalizeBudgetTier,
  parseBudgetAmount,
  rankProvidersForCriteria,
} from '../src/runtime/provider-fit';

function createProvider(overrides: Partial<ProviderSummary> = {}): ProviderSummary {
  return {
    id: 1,
    title: 'Proveedor',
    category: 'Catering',
    location: 'Lima',
    priceLevel: '$$',
    eventTypes: ['others'],
    description: 'Servicios para eventos.',
    serviceHighlights: [],
    termsHighlights: [],
    ...overrides,
  };
}

describe('provider fit normalization', () => {
  it('parses spanish budget amounts', () => {
    expect(parseBudgetAmount('mil soles')).toBe(1000);
    expect(parseBudgetAmount('S/ 1,000')).toBe(1000);
    expect(parseBudgetAmount('1000')).toBe(1000);
    expect(parseBudgetAmount(null)).toBeNull();
  });

  it('normalizes budget tiers', () => {
    expect(normalizeBudgetTier(500)).toBe('very_low');
    expect(normalizeBudgetTier(1000)).toBe('very_low');
    expect(normalizeBudgetTier(1001)).toBe('low');
    expect(normalizeBudgetTier(5000)).toBe('low');
    expect(normalizeBudgetTier(5001)).toBe('medium');
    expect(normalizeBudgetTier(10000)).toBe('medium');
    expect(normalizeBudgetTier(10001)).toBe('high');
    expect(normalizeBudgetTier(25000)).toBe('high');
    expect(normalizeBudgetTier(25001)).toBe('very_high');
    expect(normalizeBudgetTier(null)).toBe('unknown');
  });

  it('builds criteria from extractor fields', () => {
    expect(createProviderFitCriteria({
      eventType: 'cumpleaños',
      needCategory: 'Catering',
      location: 'Miraflores',
      budgetSignal: 'mil soles',
      preferences: ['tablas de quesos'],
      hardConstraints: ['solo bodas'],
      rankingNotes: 'Priorizar comida para cumpleaños con bajo presupuesto.',
    })).toEqual({
      eventType: 'cumpleaños',
      needCategory: 'Catering',
      location: 'Miraflores',
      budgetAmount: 1000,
      budgetCurrency: 'PEN',
      budgetTier: 'very_low',
      mustHave: ['tablas de quesos'],
      shouldAvoid: ['solo bodas'],
      rankingNotes: 'Priorizar comida para cumpleaños con bajo presupuesto.',
    });
  });
});

describe('rankProvidersForCriteria', () => {
  it('ranks birthday low-budget providers correctly', () => {
    const laBotaneria = createProvider({
      id: 17,
      title: 'La Botanería',
      category: 'Catering',
      priceLevel: '$$',
      eventTypes: ['others'],
      description: 'Espacio gastronómico ideal para compartir.',
    });
    const farola = createProvider({
      id: 4,
      title: 'Farola',
      category: 'Catering',
      priceLevel: '$$$',
      eventTypes: ['wedding', 'others'],
      description: 'Servicios enfocados en eventos.',
    });
    const dulcefina = createProvider({
      id: 94,
      title: 'Dulcefina',
      category: 'Catering',
      priceLevel: '$$$$',
      eventTypes: ['others'],
      description: 'Tortas de boda personalizadas.',
    });
    const paolaPuerta = createProvider({
      id: 135,
      title: 'Paola Puerta Catering',
      category: 'Catering',
      priceLevel: '$$$$',
      eventTypes: ['wedding'],
      description: 'Experiencias gastronómicas para matrimonios y eventos.',
    });
    const fourFoodies = createProvider({
      id: 136,
      title: '4Foodies',
      category: 'Catering',
      priceLevel: '$$$',
      eventTypes: ['wedding', 'others'],
      description: 'Catering para eventos y tablas de quesos.',
    });

    const ranked = rankProvidersForCriteria(
      [laBotaneria, farola, dulcefina, paolaPuerta, fourFoodies],
      {
        eventType: 'cumpleaños',
        needCategory: 'Catering',
        location: 'Lima Miraflores',
        budgetAmount: 1000,
        budgetCurrency: 'PEN',
        budgetTier: 'very_low',
        mustHave: ['comida'],
        shouldAvoid: ['solo bodas'],
        rankingNotes: 'Priorizar comida para cumpleaños con bajo presupuesto.',
      },
    );

    expect(ranked[0].id).toBe(17);
    expect(ranked[ranked.length - 1].id).toBe(135);
    expect(ranked.find((p) => p.id === 135)?.fitWarnings).toContain(
      'Proveedor orientado principalmente a bodas.',
    );
  });
});
