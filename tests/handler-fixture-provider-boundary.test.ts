import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEmptyPlan } from '../src/core/plan';
import { buildFixtureProviderGateway, fixtureProviderReadSourceSchema } from '../src/lambda/fixture-provider-boundary';
import { FixtureAgentConversationGateway, type FixtureData } from '../src/runtime/eval-fixture-gateway';
import { InMemoryEvalFixtureStateStore } from '../src/runtime/eval-fixture-state';
import { FixtureProviderGateway } from '../src/runtime/fixture-provider-gateway';
import { createProviderFitCriteria } from '../src/runtime/provider-fit';
import type { ProviderGateway, UserEventLookupResult } from '../src/runtime/provider-gateway';

const publicMethods = new Set([
  'listCategories', 'getCategoryBySlug', 'listLocations', 'searchProviders',
  'searchProvidersByKeyword', 'searchProvidersByCategoryLocation', 'searchProvidersByQueryIntent',
  'getRelevantProviders', 'getProviderDetail', 'getRelatedProviders', 'listProviderReviews',
]);

function world(providerId: number): FixtureData {
  const provider = {
    id: providerId, title: `Provider ${providerId}`, category: 'Catering', location: 'Lima',
    serviceHighlights: [], termsHighlights: [], eventTypes: ['others'], raw: {},
  };
  return {
    scenario: 'provider-boundary',
    provider: {
      categories: [{ id: 1, name: 'Catering', slug: 'catering', color: null, eventTypes: [], raw: {} }],
      categoriesBySlug: { catering: { id: 1, name: 'Catering', slug: 'catering', color: null, eventTypes: [], raw: {} } },
      locations: [{ cityId: 1, countryId: 1, city: 'Lima', country: 'Peru', raw: {} }],
      searchProviders: [provider], searchProvidersByKeyword: { providers: [provider] },
      searchProvidersByCategoryLocation: { providers: [provider] }, searchProvidersByQueryIntent: { providers: [provider] },
      relevantProviders: [provider], providerDetailsById: { '1': provider },
      relatedProvidersById: { '1': [provider] }, reviewsById: { '1': [] },
      eventVendorContextById: { '5': { id: 'fixture-event-vendors' } },
      eventFavoriteProvidersById: { '5': [provider] }, userEventsVendorContext: [{ id: 'fixture-owner-event' }],
    },
    emailAuth: {
      request: { status: 'sent' },
      verify: { status: 'authenticated', token: 'fixture-token', tokenExpiresAt: '2030-01-01T00:00:00Z' },
    },
  } as FixtureData;
}

async function exercisePublicReads(gateway: ProviderGateway): Promise<number[]> {
  const criteria = createProviderFitCriteria({
    eventType: 'cumpleanos', needCategory: 'Catering', location: 'Lima',
    budgetSignal: null, preferences: [], hardConstraints: [],
  });
  expect(await gateway.listCategories()).toHaveLength(1);
  expect(await gateway.getCategoryBySlug('catering')).not.toBeNull();
  expect(await gateway.listLocations()).toHaveLength(1);
  const plan = createEmptyPlan({ planId: 'boundary', channel: 'whatsapp', externalUserId: 'fixture-user' });
  const result = await gateway.searchProviders(plan);
  await gateway.searchProvidersByKeyword({ keyword: 'catering' });
  await gateway.searchProvidersByCategoryLocation({ category: 'Catering', location: 'Lima' });
  await gateway.searchProvidersByQueryIntent({ category: 'Catering', queryStrings: ['catering'], location: 'Lima', fitCriteria: criteria });
  await gateway.getRelevantProviders();
  await gateway.getProviderDetail(1);
  await gateway.getProviderDetailAndTrackView(1);
  await gateway.getRelatedProviders(1);
  await gateway.listProviderReviews(1);
  return result.providers.map((provider) => provider.id);
}

describe('handler fixture provider routing boundary', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it.each(['fixture', 'live_public_read_only'] as const)('%s keeps customer reads and all effects local', async (source) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('External HTTP is forbidden in this test'));
    const calls: string[] = [];
    const publicGateway = new Proxy(new FixtureProviderGateway('public', world(99), 'loaded'), {
      get(target, property, receiver): unknown {
        const method: unknown = Reflect.get(target, property, receiver);
        if (typeof method !== 'function') return method;
        return (...inputs: unknown[]): unknown => {
          calls.push(String(property));
          if (!publicMethods.has(String(property))) throw new Error(`Forbidden shared provider call: ${String(property)}`);
          return Reflect.apply(method, target, inputs);
        };
      },
    });
    const context: UserEventLookupResult = {
      lookup: { email: 'fixture@example.test' }, user: null, events: [],
      counts: { ownerEvents: 0, guestEvents: 0, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 },
    };
    const data = { ...world(1), providerReadSource: source, providerUserEvents: context };
    const stateStore = new InMemoryEvalFixtureStateStore();
    const agentGateway = FixtureAgentConversationGateway.createSync('provider-boundary', data, undefined,
      { stateStore, runId: 'boundary-run', caseId: source });
    const gateway = buildFixtureProviderGateway({
      scenario: 'provider-boundary', runId: 'boundary-run', caseId: source, data,
      stateStore, agentGateway, publicProviderGateway: publicGateway,
    });
    expect(await exercisePublicReads(gateway)).toEqual([source === 'fixture' ? 1 : 99]);

    expect(await gateway.getEventVendorContext(5)).toEqual({ id: 'fixture-event-vendors' });
    expect((await gateway.listEventFavoriteProviders({ eventId: 5 }))[0]?.id).toBe(1);
    expect(await gateway.listUserEventsVendorContext(7)).toEqual([{ id: 'fixture-owner-event' }]);
    expect(await gateway.lookupUserEventContext({ email: 'fixture@example.test' })).toEqual(context);
    expect(await gateway.lookupAuthenticatedUserEvents({ email: 'fixture@example.test', token: 'fixture-token' })).toBeNull();
    expect(await gateway.requestUserLoginCode('fixture@example.test')).toMatchObject({ status: 'sent' });
    expect(await gateway.verifyUserLoginCode('fixture@example.test', '123456')).toMatchObject({ status: 'authenticated' });
    expect(await gateway.createQuoteRequest({
      providerId: 1, userId: 7, name: 'Fixture User', email: 'fixture@example.test', phone: '999000111',
      phoneExtension: '+51', eventDate: '2030-01-01', guestsRange: '1-20', description: 'Fixture quote',
    })).toMatchObject({ status: 'simulated' });
    expect(await gateway.addVendorToEventFavorites({ providerId: 1, userId: 7, eventId: 5 })).toMatchObject({ status: 'simulated' });
    expect(await gateway.createProviderReview({ providerId: 1, userId: 7, name: 'Fixture User', rating: 4 })).toMatchObject({ status: 'simulated' });
    const receipts = await stateStore.list('boundary-run', source);
    for (const operation of ['provider.quote.write', 'provider.favorite.write', 'provider.review.write']) {
      expect(receipts.filter((receipt) => receipt.operation === operation && receipt.resultStatus === 'simulated')).toHaveLength(1);
    }
    expect(fetch).not.toHaveBeenCalled();
    if (source === 'fixture') expect(calls).toEqual([]);
    else {
      expect([...new Set(calls)].sort()).toEqual([...publicMethods].sort());
      expect(calls.filter((name) => name === 'getProviderDetail')).toHaveLength(2);
      expect(calls).not.toContain('getProviderDetailAndTrackView');
    }
  });

  it('defaults absent read metadata to fixtures and rejects unsupported selectors', async () => {
    const data = world(1);
    const gateway = buildFixtureProviderGateway({
      scenario: 'provider-boundary', runId: 'default-run', caseId: 'default-case', data,
      stateStore: new InMemoryEvalFixtureStateStore(),
      agentGateway: FixtureAgentConversationGateway.createSync('provider-boundary', data),
      publicProviderGateway: new Proxy(new FixtureProviderGateway('public', world(99), 'loaded'), {
        get() { throw new Error('No public method may be accessed by default'); },
      }),
    });
    expect((await gateway.getRelevantProviders())[0]?.id).toBe(1);
    expect(fixtureProviderReadSourceSchema.safeParse('real').success).toBe(false);
  });
});
