import { describe, expect, it } from 'vitest';

import {
  extractionSchema,
  providerPlanOperationSchema,
  providerQueryIntentSchema,
} from '../src/runtime/extraction-schemas';

const fitCriteria = {
  eventType: 'boda',
  needCategory: 'catering',
  location: 'Lima',
  budgetAmount: null,
  budgetCurrency: null,
  mustHave: ['estaciones'],
  shouldAvoid: [],
  rankingNotes: 'Priorizar proveedores con estaciones para boda.',
} as const;

describe('structured extraction schemas', () => {
  it('parses provider query intents with canonical fields', () => {
    const parsed = providerQueryIntentSchema.parse({
      category: 'Catering',
      label: 'Catering para boda',
      priority: 1,
      queryStrings: ['Catering para boda en Lima con estaciones'],
      preferences: ['estaciones'],
      hardConstraints: [],
      missingFields: [],
      retrievalReady: true,
      fitCriteria,
    });

    expect(parsed.category).toBe('Catering');
    expect(parsed.retrievalReady).toBe(true);
  });

  it('rejects malformed provider operations', () => {
    expect(() =>
      providerPlanOperationSchema.parse({
        type: 'delete_need',
        category: 'categoría inventada',
        preferences: [],
        hardConstraints: [],
        queryIntent: null,
        rerunSearch: false,
        provider: null,
        removeProvider: null,
        addProvider: null,
      }),
    ).toThrow();
  });

  it('defaults structured extraction arrays without legacy aliases', () => {
    const parsed = extractionSchema.parse({
      intent: 'elicitar_necesidades',
      intentConfidence: 0.95,
      eventType: 'boda',
      vendorCategory: null,
      vendorCategories: [],
      activeNeedCategory: null,
      location: 'Lima',
      budgetSignal: null,
      guestRange: '51-100',
      preferences: [],
      hardConstraints: [],
      assumptions: [],
      conversationSummary: 'Boda en Lima.',
      selectedProviderHints: [],
      pauseRequested: false,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      providerFitCriteria: fitCriteria,
    });

    expect(parsed.providerQueryIntents).toEqual([]);
    expect(parsed.providerPlanOperations).toEqual([]);
    expect(parsed.providerExplanationRequest).toBeNull();
    expect(parsed.providerDetailRequest).toBeNull();
  });
});
