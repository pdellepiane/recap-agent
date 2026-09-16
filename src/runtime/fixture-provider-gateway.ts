import type { PersistedPlan } from '../core/plan';
import type {
  CategoryLocationProviderSearchInput,
  CreateProviderReviewInput,
  FavoriteRequestInput,
  KeywordProviderSearchInput,
  MarketplaceCategory,
  MarketplaceLocation,
  ProviderGateway,
  ProviderGatewaySearchResult,
  ProviderReview,
  QueryIntentProviderSearchInput,
  UserEventLookupInput,
  UserEventLookupResult,
  UserLoginCodeRequestResult,
  UserLoginCodeVerificationResult,
  QuoteRequestInput,
} from './provider-gateway';
import type { ProviderDetail, ProviderSummary } from '../core/provider';
import { providerSummarySchema } from '../core/provider';
import type { FixtureData } from './eval-fixture-gateway';
import type { EvalFixtureStateStore } from './eval-fixture-state';
import { InMemoryEvalFixtureStateStore } from './eval-fixture-state';

export type FixtureProviderGatewayOptions = {
  runId?: string;
  caseId?: string;
  stateStore?: EvalFixtureStateStore;
  allowCustomerWrites?: boolean;
};

export type FixtureProviderCallRecord = {
  readonly method: string;
  readonly args: Record<string, unknown>;
  readonly resultStatus: string;
};

function toRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readSection(data: FixtureData | null, key: string): unknown {
  if (!data) {
    return undefined;
  }
  return (data as Record<string, unknown>)[key];
}

/**
 * Isolated fixture provider gateway. Every method resolves locally to a
 * simulated implementation or a hard failure. No method performs HTTP.
 * Integrator seam: handler.ts can delegate fixture-mode provider calls here
 * instead of forwarding writes to the real gateway.
 */
export class FixtureProviderGateway implements ProviderGateway {
  readonly simulated = true as const;
  private readonly calls: FixtureProviderCallRecord[] = [];
  private readonly stateStore: EvalFixtureStateStore;
  private readonly runId: string;
  private readonly caseId: string;

  constructor(
    private readonly scenario: string,
    private readonly data: FixtureData | null,
    private readonly loadStatus: 'loaded' | 'unknown_scenario' | 'malformed',
    options: FixtureProviderGatewayOptions = {},
  ) {
    this.stateStore = options.stateStore ?? new InMemoryEvalFixtureStateStore();
    this.runId = options.runId?.trim() || 'local-run';
    this.caseId = options.caseId?.trim() || 'local-case';
  }

  getCallLog(): readonly FixtureProviderCallRecord[] {
    return [...this.calls];
  }

  callCount(method: string): number {
    return this.calls.filter((call) => call.method === method).length;
  }

  getStateStore(): EvalFixtureStateStore {
    return this.stateStore;
  }

  private unknownError(): string {
    return `Unknown fixture scenario "${this.scenario}".`;
  }

  private unavailable(): boolean {
    return this.loadStatus !== 'loaded';
  }

  private track(method: string, args: Record<string, unknown>, resultStatus: string): void {
    this.calls.push({ method, args: { ...args }, resultStatus });
  }

  private providerFixture(): Record<string, unknown> {
    return toRecord(readSection(this.data, 'provider'));
  }

  /**
   * Fixture-declared provider summaries. Entries failing strict validation
   * are dropped (never repaired or invented); an absent section is an empty
   * result, never a real-backend read.
   */
  private readProviderSummaries(key: string): ProviderSummary[] {
    const fixture = this.providerFixture();
    const raw = fixture[key];
    if (!Array.isArray(raw)) {
      return [];
    }
    const summaries: ProviderSummary[] = [];
    for (const entry of raw) {
      const parsed = providerSummarySchema.safeParse(entry);
      if (parsed.success) {
        summaries.push(parsed.data);
      }
    }
    return summaries;
  }

  private readProviderSearchResult(key: string): ProviderGatewaySearchResult {
    const fixture = this.providerFixture();
    const section = toRecord(fixture[key]);
    const raw = section['providers'];
    if (!Array.isArray(raw)) {
      return { providers: [] };
    }
    const providers: ProviderSummary[] = [];
    for (const entry of raw) {
      const parsed = providerSummarySchema.safeParse(entry);
      if (parsed.success) {
        providers.push(parsed.data);
      }
    }
    return { providers };
  }

  private readProviderSummariesById(key: string, providerId: number): ProviderSummary[] {
    const fixture = this.providerFixture();
    const byId = toRecord(fixture[key]);
    const raw = byId[String(providerId)];
    if (!Array.isArray(raw)) {
      return [];
    }
    const summaries: ProviderSummary[] = [];
    for (const entry of raw) {
      const parsed = providerSummarySchema.safeParse(entry);
      if (parsed.success) {
        summaries.push(parsed.data);
      }
    }
    return summaries;
  }

  async listCategories(): Promise<MarketplaceCategory[]> {
    if (this.unavailable()) {
      this.track('listCategories', {}, 'failed');
      return [];
    }
    const fixture = this.providerFixture();
    const raw = fixture['categories'];
    this.track('listCategories', {}, 'success');
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.filter((entry): entry is MarketplaceCategory =>
      entry !== null && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string',
    );
  }

  async getCategoryBySlug(slug: string): Promise<MarketplaceCategory | null> {
    if (this.unavailable()) {
      this.track('getCategoryBySlug', { slug }, 'failed');
      return null;
    }
    const fixture = this.providerFixture();
    const bySlug = toRecord(fixture['categoriesBySlug']);
    const direct = bySlug[slug];
    this.track('getCategoryBySlug', { slug }, direct ? 'success' : 'not_found');
    if (direct !== null && typeof direct === 'object') {
      return direct as MarketplaceCategory;
    }
    return null;
  }

  async listLocations(): Promise<MarketplaceLocation[]> {
    if (this.unavailable()) {
      this.track('listLocations', {}, 'failed');
      return [];
    }
    const fixture = this.providerFixture();
    const raw = fixture['locations'];
    this.track('listLocations', {}, 'success');
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.filter((entry): entry is MarketplaceLocation =>
      entry !== null && typeof entry === 'object',
    );
  }

  async searchProviders(plan: PersistedPlan): Promise<ProviderGatewaySearchResult> {
    void plan;
    if (this.unavailable()) {
      this.track('searchProviders', {}, 'failed');
      return { providers: [] };
    }
    const fixture = this.providerFixture();
    const raw = fixture['searchProviders'];
    this.track('searchProviders', {}, 'success');
    if (!Array.isArray(raw)) {
      return { providers: [] };
    }
    return { providers: raw.filter((entry): entry is ProviderSummary => entry !== null && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'number') };
  }

  async searchProvidersByKeyword(input: KeywordProviderSearchInput): Promise<ProviderGatewaySearchResult> {
    if (this.unavailable()) {
      this.track('searchProvidersByKeyword', { ...input }, 'failed');
      return { providers: [] };
    }
    const result = this.readProviderSearchResult('searchProvidersByKeyword');
    this.track('searchProvidersByKeyword', { ...input }, 'success');
    return result;
  }

  async searchProvidersByCategoryLocation(input: CategoryLocationProviderSearchInput): Promise<ProviderGatewaySearchResult> {
    if (this.unavailable()) {
      this.track('searchProvidersByCategoryLocation', { ...input }, 'failed');
      return { providers: [] };
    }
    const result = this.readProviderSearchResult('searchProvidersByCategoryLocation');
    this.track('searchProvidersByCategoryLocation', { ...input }, 'success');
    return result;
  }

  async searchProvidersByQueryIntent(input: QueryIntentProviderSearchInput): Promise<ProviderGatewaySearchResult> {
    if (this.unavailable()) {
      this.track('searchProvidersByQueryIntent', { category: input.category }, 'failed');
      return { providers: [] };
    }
    const result = this.readProviderSearchResult('searchProvidersByQueryIntent');
    this.track('searchProvidersByQueryIntent', { category: input.category }, 'success');
    return result;
  }

  async getRelevantProviders(): Promise<ProviderSummary[]> {
    if (this.unavailable()) {
      this.track('getRelevantProviders', {}, 'failed');
      return [];
    }
    const providers = this.readProviderSummaries('relevantProviders');
    this.track('getRelevantProviders', {}, 'success');
    return providers;
  }

  async getProviderDetail(providerId: number): Promise<ProviderDetail | null> {
    if (this.unavailable() || !Number.isSafeInteger(providerId) || providerId <= 0) {
      this.track('getProviderDetail', { providerId }, 'failed');
      return null;
    }
    const fixture = this.providerFixture();
    const byId = toRecord(fixture['providerDetailsById']);
    const direct = byId[String(providerId)];
    this.track('getProviderDetail', { providerId }, direct ? 'success' : 'not_found');
    if (direct !== null && typeof direct === 'object') {
      return direct as ProviderDetail;
    }
    return null;
  }

  async getProviderDetailAndTrackView(providerId: number): Promise<ProviderDetail | null> {
    // Fixture mode never tracks a real view. Return the same simulated detail.
    const detail = await this.getProviderDetail(providerId);
    this.track('getProviderDetailAndTrackView', { providerId }, detail ? 'success' : 'not_found');
    return detail;
  }

  async getRelatedProviders(providerId: number): Promise<ProviderSummary[]> {
    if (this.unavailable()) {
      this.track('getRelatedProviders', { providerId }, 'failed');
      return [];
    }
    const providers = this.readProviderSummariesById('relatedProvidersById', providerId);
    this.track('getRelatedProviders', { providerId }, 'success');
    return providers;
  }

  async listProviderReviews(providerId: number): Promise<ProviderReview[]> {
    if (this.unavailable()) {
      this.track('listProviderReviews', { providerId }, 'failed');
      return [];
    }
    const fixture = this.providerFixture();
    const byId = toRecord(fixture['reviewsById']);
    const raw = byId[String(providerId)];
    this.track('listProviderReviews', { providerId }, 'success');
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.filter((entry): entry is ProviderReview =>
      entry !== null && typeof entry === 'object',
    );
  }

  async getEventVendorContext(eventId: number): Promise<Record<string, unknown> | null> {
    if (this.unavailable()) {
      this.track('getEventVendorContext', { eventId }, 'failed');
      return null;
    }
    const fixture = this.providerFixture();
    const byId = toRecord(fixture['eventVendorContextById']);
    const direct = byId[String(eventId)];
    this.track('getEventVendorContext', { eventId }, direct ? 'success' : 'not_found');
    if (direct !== null && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as Record<string, unknown>;
    }
    return null;
  }

  async listEventFavoriteProviders(args: {
    eventId: number;
    sortBy?: string | null;
    page?: number | null;
    categoryId?: number | null;
  }): Promise<ProviderSummary[]> {
    if (this.unavailable()) {
      this.track('listEventFavoriteProviders', { ...args }, 'failed');
      return [];
    }
    const providers = this.readProviderSummariesById('eventFavoriteProvidersById', args.eventId);
    this.track('listEventFavoriteProviders', { ...args }, 'success');
    return providers;
  }

  async listUserEventsVendorContext(userId: number): Promise<Record<string, unknown>[]> {
    if (this.unavailable()) {
      this.track('listUserEventsVendorContext', { userId }, 'failed');
      return [];
    }
    const fixture = this.providerFixture();
    const raw = fixture['userEventsVendorContext'];
    this.track('listUserEventsVendorContext', { userId }, 'success');
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.filter((entry): entry is Record<string, unknown> =>
      entry !== null && typeof entry === 'object' && !Array.isArray(entry),
    );
  }

  async lookupUserEventContext(input: UserEventLookupInput): Promise<UserEventLookupResult | null> {
    if (this.unavailable()) {
      this.track('lookupUserEventContext', { ...input }, 'failed');
      return null;
    }
    const fixture = this.providerFixture();
    if (fixture['userEvents'] !== null && typeof fixture['userEvents'] === 'object') {
      this.track('lookupUserEventContext', { ...input }, 'success');
      return fixture['userEvents'] as UserEventLookupResult;
    }
    this.track('lookupUserEventContext', { ...input }, 'empty');
    return {
      lookup: input,
      user: null,
      events: [],
      counts: { ownerEvents: 0, guestEvents: 0, hostEvents: 0, celebratedEvents: 0, recentOrders: 0 },
    };
  }

  async requestUserLoginCode(email: string): Promise<UserLoginCodeRequestResult> {
    const prior = await this.stateStore.count(this.runId, this.caseId, 'otp.request');
    if (this.unavailable()) {
      this.track('requestUserLoginCode', { email }, 'failed');
      await this.stateStore.record({
        runId: this.runId,
        caseId: this.caseId,
        scenario: this.scenario,
        operation: 'otp.request',
        args: { email },
        resultStatus: 'failed',
      });
      return { status: 'unavailable', error: this.unknownError() };
    }
    if (prior >= 1) {
      // One-shot: no resend. Persist terminal attempt and fail closed.
      this.track('requestUserLoginCode', { email }, 'failed');
      await this.stateStore.record({
        runId: this.runId,
        caseId: this.caseId,
        scenario: this.scenario,
        operation: 'otp.request',
        args: { email },
        resultStatus: 'failed',
      });
      return { status: 'failed', error: 'Fixture OTP request already consumed; no resend.' };
    }
    const emailAuth = toRecord(readSection(this.data, 'emailAuth'));
    const request = emailAuth['request'] as UserLoginCodeRequestResult | undefined;
    const result: UserLoginCodeRequestResult = request && typeof request === 'object' && 'status' in request
      ? request
      : { status: 'unavailable', error: 'Email authentication request is not configured in this fixture.' };
    this.track('requestUserLoginCode', { email }, result.status);
    await this.stateStore.record({
      runId: this.runId,
      caseId: this.caseId,
      scenario: this.scenario,
      operation: 'otp.request',
      args: { email },
      resultStatus: result.status,
    });
    return result;
  }

  async verifyUserLoginCode(email: string, code: string): Promise<UserLoginCodeVerificationResult> {
    const prior = await this.stateStore.count(this.runId, this.caseId, 'otp.verify');
    if (this.unavailable()) {
      this.track('verifyUserLoginCode', { email }, 'failed');
      await this.stateStore.record({
        runId: this.runId,
        caseId: this.caseId,
        scenario: this.scenario,
        operation: 'otp.verify',
        args: { email },
        resultStatus: 'failed',
      });
      return { status: 'unavailable', error: this.unknownError() };
    }
    if (prior >= 1) {
      this.track('verifyUserLoginCode', { email }, 'failed');
      await this.stateStore.record({
        runId: this.runId,
        caseId: this.caseId,
        scenario: this.scenario,
        operation: 'otp.verify',
        args: { email },
        resultStatus: 'failed',
      });
      return { status: 'failed', error: 'Fixture OTP verification already consumed.' };
    }
    void code;
    const emailAuth = toRecord(readSection(this.data, 'emailAuth'));
    const verify = emailAuth['verify'] as UserLoginCodeVerificationResult | undefined;
    const result: UserLoginCodeVerificationResult = verify && typeof verify === 'object' && 'status' in verify
      ? verify
      : { status: 'unavailable', error: 'Email authentication verification is not configured in this fixture.' };
    this.track('verifyUserLoginCode', { email }, result.status);
    await this.stateStore.record({
      runId: this.runId,
      caseId: this.caseId,
      scenario: this.scenario,
      operation: 'otp.verify',
      args: { email },
      resultStatus: result.status,
    });
    return result;
  }

  async lookupAuthenticatedUserEvents(args: { token: string; email: string }): Promise<UserEventLookupResult | null> {
    if (this.unavailable()) {
      this.track('lookupAuthenticatedUserEvents', { email: args.email }, 'failed');
      return null;
    }
    this.track('lookupAuthenticatedUserEvents', { email: args.email }, 'empty');
    return null;
  }

  async createQuoteRequest(input: QuoteRequestInput): Promise<Record<string, unknown>> {
    // Persist intent before execution and result before reply. No retries.
    await this.stateStore.record({
      runId: this.runId,
      caseId: this.caseId,
      scenario: this.scenario,
      operation: 'provider.quote.write',
      args: { providerId: input.providerId, eventDate: input.eventDate },
      resultStatus: 'intent',
    });
    if (this.unavailable()) {
      this.track('createQuoteRequest', { providerId: input.providerId }, 'failed');
      throw new Error(this.unknownError());
    }
    if (!input.eventDate || !input.eventDate.trim()) {
      this.track('createQuoteRequest', { providerId: input.providerId }, 'failed');
      throw new Error('Fixture quote request requires an explicitly captured event date.');
    }
    const receipt = await this.stateStore.record({
      runId: this.runId,
      caseId: this.caseId,
      scenario: this.scenario,
      operation: 'provider.quote.write',
      args: { providerId: input.providerId, eventDate: input.eventDate },
      resultStatus: 'simulated',
    });
    this.track('createQuoteRequest', { providerId: input.providerId }, 'simulated');
    return {
      id: receipt.syntheticId,
      status: 'simulated',
      providerId: input.providerId,
      eventDate: input.eventDate,
      scenario: this.scenario,
    };
  }

  async addVendorToEventFavorites(input: FavoriteRequestInput): Promise<Record<string, unknown>> {
    await this.stateStore.record({
      runId: this.runId,
      caseId: this.caseId,
      scenario: this.scenario,
      operation: 'provider.favorite.write',
      args: { providerId: input.providerId, eventId: input.eventId },
      resultStatus: 'intent',
    });
    if (this.unavailable()) {
      this.track('addVendorToEventFavorites', { providerId: input.providerId }, 'failed');
      throw new Error(this.unknownError());
    }
    const receipt = await this.stateStore.record({
      runId: this.runId,
      caseId: this.caseId,
      scenario: this.scenario,
      operation: 'provider.favorite.write',
      args: { providerId: input.providerId, eventId: input.eventId },
      resultStatus: 'simulated',
    });
    this.track('addVendorToEventFavorites', { providerId: input.providerId }, 'simulated');
    return { id: receipt.syntheticId, status: 'simulated', providerId: input.providerId, eventId: input.eventId };
  }

  async createProviderReview(input: CreateProviderReviewInput): Promise<Record<string, unknown>> {
    await this.stateStore.record({
      runId: this.runId,
      caseId: this.caseId,
      scenario: this.scenario,
      operation: 'provider.review.write',
      args: { providerId: input.providerId, rating: input.rating },
      resultStatus: 'intent',
    });
    if (this.unavailable()) {
      this.track('createProviderReview', { providerId: input.providerId }, 'failed');
      throw new Error(this.unknownError());
    }
    const receipt = await this.stateStore.record({
      runId: this.runId,
      caseId: this.caseId,
      scenario: this.scenario,
      operation: 'provider.review.write',
      args: { providerId: input.providerId, rating: input.rating },
      resultStatus: 'simulated',
    });
    this.track('createProviderReview', { providerId: input.providerId }, 'simulated');
    return { id: receipt.syntheticId, status: 'simulated', providerId: input.providerId, rating: input.rating };
  }
}
