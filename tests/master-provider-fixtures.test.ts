import { describe, expect, it, vi } from 'vitest';

import { loadFixtureData } from '../src/runtime/eval-fixture-gateway';
import { FixtureProviderGateway } from '../src/runtime/fixture-provider-gateway';
import { createProviderFitCriteria, isProviderEligibleForCriteria, rankProvidersForCriteria } from '../src/runtime/provider-fit';
import type { ProviderCategory } from '../src/core/provider-category';
import { normalizeToProviderCategory } from '../src/core/provider-category';

async function gateway(scenario: string): Promise<FixtureProviderGateway> {
  const loaded = await loadFixtureData(scenario);
  if (loaded.status !== 'loaded') throw new Error(`Study world unavailable: ${scenario}`);
  return new FixtureProviderGateway(scenario, loaded.data, 'loaded');
}

describe('master provider study evidence worlds', () => {
  it('keeps category-specific affordable recommendations independent despite mixed candidates', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request'));
    try {
      const provider = await gateway('master-provider-catalog');
      for (const [category, expectedId] of [['Catering', 9101], ['Música', 9301]] satisfies Array<[ProviderCategory, number]>) {
        const criteria = createProviderFitCriteria({
          eventType: 'cumpleanos', needCategory: category, location: 'Lima',
          budgetSignal: 'S/ 500.00', preferences: [], hardConstraints: [],
        });
        const result = await provider.searchProvidersByQueryIntent({
          category, location: 'Lima', queryStrings: [category], fitCriteria: criteria,
        });
        const eligible = rankProvidersForCriteria(result.providers, criteria)
          .filter((entry) => normalizeToProviderCategory(entry.category) === category &&
            isProviderEligibleForCriteria(entry, criteria));
        expect(eligible.map((entry) => entry.id)).toEqual([expectedId]);
        const detail = await provider.getProviderDetail(expectedId);
        expect(detail?.id).toBe(expectedId);
        expect(detail?.category).toBe(category);
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it('has no undisclosed provider in the empty or exhausted worlds', async () => {
    const criteria = createProviderFitCriteria({
      eventType: 'cumpleanos', needCategory: 'Catering', location: 'Lima',
      budgetSignal: null, preferences: [], hardConstraints: [],
    });
    const empty = await gateway('master-provider-empty');
    expect((await empty.searchProvidersByQueryIntent({
      category: 'Catering', queryStrings: ['catering'], location: 'Lima', fitCriteria: criteria,
    })).providers).toEqual([]);
    expect(await empty.getProviderDetail(9101)).toBeNull();

    const exhausted = await gateway('provider-decimal-budget');
    for (const location of ['Lima', null]) {
      for (const page of [1, 2, 3]) {
        const result = await exhausted.searchProvidersByCategoryLocation({ category: 'Catering', location, page });
        expect(result.providers.map((entry) => entry.id)).toEqual([9101, 9102]);
      }
    }
  });
});
