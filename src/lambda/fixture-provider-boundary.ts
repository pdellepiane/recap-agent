import { z } from 'zod';

import type { FixtureAgentConversationGateway, FixtureData } from '../runtime/eval-fixture-gateway';
import type { EvalFixtureStateStore } from '../runtime/eval-fixture-state';
import { FixtureProviderGateway } from '../runtime/fixture-provider-gateway';
import type { ProviderGateway, UserEventLookupResult } from '../runtime/provider-gateway';

export const fixtureProviderReadSourceSchema = z.enum(['fixture', 'live_public_read_only']);

/** The handler's exhaustive provider composition: no implicit external fallback. */
export function buildFixtureProviderGateway(args: {
  scenario: string;
  runId: string;
  caseId: string;
  data: FixtureData | null;
  stateStore: EvalFixtureStateStore;
  agentGateway: Pick<FixtureAgentConversationGateway, 'requestUserLoginCode' | 'verifyUserLoginCode'>;
  publicProviderGateway: ProviderGateway;
}): ProviderGateway {
  const source = fixtureProviderReadSourceSchema.parse(args.data?.providerReadSource ?? 'fixture');
  const local = new FixtureProviderGateway(args.scenario, args.data,
    args.data ? 'loaded' : 'unknown_scenario', args);
  const publicReads = source === 'live_public_read_only' ? args.publicProviderGateway : local;
  const data = args.data as Record<string, unknown> | null;
  const customerContext = data?.['providerUserEvents'];

  return {
    listCategories: () => publicReads.listCategories(),
    getCategoryBySlug: (slug) => publicReads.getCategoryBySlug(slug),
    listLocations: () => publicReads.listLocations(),
    searchProviders: (plan) => publicReads.searchProviders(plan),
    searchProvidersByKeyword: (input) => publicReads.searchProvidersByKeyword(input),
    searchProvidersByCategoryLocation: (input) => publicReads.searchProvidersByCategoryLocation(input),
    searchProvidersByQueryIntent: (input) => publicReads.searchProvidersByQueryIntent(input),
    getRelevantProviders: () => publicReads.getRelevantProviders(),
    getProviderDetail: (id) => publicReads.getProviderDetail(id),
    // A nominal detail-and-view request must never issue a real tracking write.
    getProviderDetailAndTrackView: (id) => publicReads.getProviderDetail(id),
    getRelatedProviders: (id) => publicReads.getRelatedProviders(id),
    listProviderReviews: (id) => publicReads.listProviderReviews(id),
    getEventVendorContext: (id) => local.getEventVendorContext(id),
    listEventFavoriteProviders: (input) => local.listEventFavoriteProviders(input),
    listUserEventsVendorContext: (id) => local.listUserEventsVendorContext(id),
    lookupUserEventContext: (input) => customerContext && typeof customerContext === 'object' && !Array.isArray(customerContext)
      ? Promise.resolve(customerContext as UserEventLookupResult)
      : local.lookupUserEventContext(input),
    requestUserLoginCode: (email) => args.agentGateway.requestUserLoginCode(email),
    verifyUserLoginCode: (email, code) => args.agentGateway.verifyUserLoginCode(email, code),
    lookupAuthenticatedUserEvents: (input) => local.lookupAuthenticatedUserEvents(input),
    createQuoteRequest: (input) => local.createQuoteRequest(input),
    addVendorToEventFavorites: (input) => local.addVendorToEventFavorites(input),
    createProviderReview: (input) => local.createProviderReview(input),
  };
}
