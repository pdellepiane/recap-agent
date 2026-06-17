import { getActiveNeed, type PersistedPlan } from '../core/plan';
import {
  normalizeProviderSummary,
  type ProviderDetail,
  type ProviderSummary,
} from '../core/provider';
import { locationCountryKey } from '../core/location';
import { normalizeToPriceLevel } from '../core/price-level';
import { normalizeToProviderCategory, resolveSearchCategories } from '../core/provider-category';
import type { ProviderVectorSearchGateway, ProviderVectorSearchResult } from './provider-vector-search';
import type {
  CategoryLocationProviderSearchInput,
  CreateProviderReviewInput,
  FavoriteRequestInput,
  GuestLoginCodeRequestResult,
  GuestLoginCodeVerificationResult,
  KeywordProviderSearchInput,
  MarketplaceCategory,
  MarketplaceLocation,
  ProviderGateway,
  ProviderGatewaySearchResult,
  QueryIntentProviderSearchInput,
  ProviderSearchMode,
  ProviderReview,
  QuoteRequestInput,
  UserEventLookupInput,
  UserEventLookupResult,
  UserEventOrderSummary,
  UserEventRelation,
  UserEventSummary,
} from './provider-gateway';

type ApiEnvelope<T> = {
  data: T;
  status: boolean;
  errors: unknown;
  error: string;
};

type CategoryApiItem = {
  id?: number | null;
  slug?: string | null;
  color?: string | null;
  event_types?: Array<{ name?: string | null }> | null;
  translations?: Array<{ name?: string | null; language?: { locale?: string | null } }>;
  [key: string]: unknown;
};

type LocationApiItem = {
  city_id?: number | null;
  country_id?: number | null;
  city?: string | null;
  country?: string | null;
  [key: string]: unknown;
};

type ProviderApiItem = {
  id: number;
  slug?: string | null;
  rating?: string | null;
  price_level?: string | null;
  min_price?: string | null;
  max_price?: string | null;
  translations?: Array<{
    title?: string | null;
    language?: { locale?: string | null };
  }>;
  promos?: PromoApiItem[] | null;
  info_translations?: ProviderInfoTranslation[] | null;
  social_networks?: SocialNetworkApiItem[] | null;
  category?: {
    translations?: Array<{ name?: string | null; language?: { locale?: string | null } }>;
  };
  city?: { name?: string | null } | string | null;
  country?: { name?: string | null } | string | null;
  description?: string | null;
  event_types?: Array<{ name?: string | null }> | null;
  [key: string]: unknown;
};

type ProviderInfoTranslation = {
  title?: string | null;
  description?: string | null;
  language?: { locale?: string | null } | null;
};

type PromoApiItem = {
  url?: string | null;
  translations?: Array<{
    title?: string | null;
    subtitle?: string | null;
    badge?: string | null;
    language?: { locale?: string | null } | null;
  }> | null;
};

type SocialNetworkApiItem = {
  url?: string | null;
  social_network?: {
    name?: string | null;
  } | null;
};

type PaginatedProviders = {
  current_page?: number;
  data?: ProviderApiItem[];
  total?: number;
};

export class SinEnvolturasGateway implements ProviderGateway {
  constructor(
    private readonly options: {
      baseUrl: string;
      guestServiceBaseUrl?: string;
      guestAuthBaseUrl?: string;
      persistedSearchLimit: number;
      summarySearchWordLimit: number;
      searchMode?: ProviderSearchMode;
      vectorSearchGateway?: Pick<ProviderVectorSearchGateway, 'search' | 'searchQueryIntent'> | null;
    },
  ) {}

  async listCategories(): Promise<MarketplaceCategory[]> {
    const response = await this.fetchJson<ApiEnvelope<CategoryApiItem[]>>(
      '/categories',
    );
    return response.data.map((category) => this.toMarketplaceCategory(category));
  }

  async getCategoryBySlug(slug: string): Promise<MarketplaceCategory | null> {
    try {
      const response = await this.fetchJson<ApiEnvelope<CategoryApiItem>>(
        `/category-slug/${encodeURIComponent(slug)}`,
      );
      return this.toMarketplaceCategory(response.data);
    } catch {
      return null;
    }
  }

  async listLocations(): Promise<MarketplaceLocation[]> {
    const response = await this.fetchJson<ApiEnvelope<LocationApiItem[]>>(
      '/locations',
    );

    return response.data.map((location) => this.toMarketplaceLocation(location));
  }

  async searchProviders(
    plan: PersistedPlan,
  ): Promise<ProviderGatewaySearchResult> {
    const searchMode = this.options.searchMode ?? 'hybrid';
    if (searchMode === 'api' || !this.options.vectorSearchGateway) {
      return this.searchProvidersFromApi(plan);
    }

    if (searchMode === 'vector') {
      return this.searchProvidersFromVector(plan);
    }

    return this.searchProvidersHybrid(plan);
  }

  private async searchProvidersFromApi(
    plan: PersistedPlan,
    activeCategory?: string | null,
  ): Promise<ProviderGatewaySearchResult> {
    const resolvedCategory = activeCategory ?? this.resolveActiveCategory(plan);
    const searchTerms = Array.from(
      new Set(
        [
          resolvedCategory,
          plan.event_type,
          plan.location,
          plan.conversation_summary
            .split(/\s+/)
            .slice(0, this.options.summarySearchWordLimit)
            .join(' '),
        ]
          .map((value) => value?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    );

    let paginated: ProviderApiItem[] = [];

    for (const term of searchTerms) {
      const response = await this.fetchJson<ApiEnvelope<PaginatedProviders>>(
        `/filtered?search=${encodeURIComponent(term)}&page=1`,
      );
      const items = response.data.data ?? [];
      if (items.length > 0) {
        paginated = items;
        break;
      }
    }

    if (paginated.length === 0) {
      const fallback = await this.fetchJson<ApiEnvelope<ProviderApiItem[]>>(
        '/relevant',
      );
      paginated = fallback.data;
    }

    const providers = this.selectProvidersForPlan(
      paginated.map((provider) => this.toProviderSummary(provider)),
      plan,
      resolvedCategory ?? null,
    )
      .slice(0, this.options.persistedSearchLimit)
      .map((provider) => ({
        ...provider,
        reason: this.reasonForProvider(provider, plan, resolvedCategory ?? null),
      }));

    return { providers };
  }

  private async searchProvidersFromVector(
    plan: PersistedPlan,
  ): Promise<ProviderGatewaySearchResult> {
    const vectorResults = await this.options.vectorSearchGateway?.search(plan) ?? [];
    console.log('[search-funnel] vector results:', vectorResults.length,
      vectorResults.map((r) => `#${r.providerId}(${r.score.toFixed(3)})`).join(', '));
    const providers = await this.enrichVectorResults(vectorResults);
    console.log('[search-funnel] enriched providers:', providers.length,
      providers.map((p) => `#${p.id}(${p.slug ?? '?'})`).join(', '));
    const resolvedCategory = this.resolveActiveCategory(plan);
    const selectedProviders = this.selectProvidersForPlan(
      providers,
      plan,
      resolvedCategory,
    );
    return {
      providers: selectedProviders
        .slice(0, this.options.persistedSearchLimit)
        .map((provider) => ({
          ...provider,
          reason: provider.reason ?? this.reasonForProvider(provider, plan, resolvedCategory),
        })),
    };
  }

  private async searchProvidersHybrid(
    plan: PersistedPlan,
  ): Promise<ProviderGatewaySearchResult> {
    const vectorResults = await this.options.vectorSearchGateway?.search(plan) ?? [];
    console.log('[search-funnel] hybrid vector results:', vectorResults.length,
      vectorResults.map((r) => `#${r.providerId}(${r.score.toFixed(3)})`).join(', '));
    const vectorProviders = await this.enrichVectorResults(vectorResults);
    console.log('[search-funnel] hybrid enriched providers:', vectorProviders.length);

    const apiResult = await this.searchProvidersFromApi(plan);

    if (vectorProviders.length === 0) {
      console.log('[search-funnel] no vector results, falling back to API');
      console.log('[search-funnel] API results:', apiResult.providers.length,
        apiResult.providers.map((p) => `#${p.id}(${p.slug ?? '?'})`).join(', '));
      return {
        providers: apiResult.providers.slice(0, this.options.persistedSearchLimit),
      };
    }

    const resolvedCategory = this.resolveActiveCategory(plan);
    const mergedProviders = this.mergeProviderCandidates(apiResult.providers, vectorProviders);
    const selectedProviders = this.selectProvidersForPlan(
      mergedProviders,
      plan,
      resolvedCategory,
    );

    return {
      providers: selectedProviders
        .slice(0, this.options.persistedSearchLimit)
        .map((provider) => ({
          ...provider,
          reason: provider.reason ?? this.reasonForProvider(provider, plan, resolvedCategory),
        })),
    };
  }

  private async enrichVectorResults(
    vectorResults: ProviderVectorSearchResult[],
  ): Promise<ProviderSummary[]> {
    const providers: ProviderSummary[] = [];
    const seenIds = new Set<number>();

    for (const result of vectorResults) {
      if (seenIds.has(result.providerId)) {
        continue;
      }

      seenIds.add(result.providerId);
      const detail = await this.getProviderDetail(result.providerId);
      if (!detail) {
        continue;
      }
      const { raw: _raw, ...summary } = detail;
      void _raw;

      providers.push({
        ...summary,
        retrievalScore: result.score,
        retrievalSource: 'vector',
        reason: detail.reason ?? 'coincide semánticamente con la búsqueda',
      });
    }

    return providers;
  }

  private mergeProviderCandidates(
    apiProviders: ProviderSummary[],
    vectorProviders: ProviderSummary[],
  ): ProviderSummary[] {
    const merged = new Map<number, ProviderSummary>();

    for (const provider of apiProviders) {
      merged.set(provider.id, {
        ...provider,
        retrievalSource: provider.retrievalSource ?? 'api',
      });
    }

    for (const provider of vectorProviders) {
      const existing = merged.get(provider.id);
      if (!existing) {
        merged.set(provider.id, provider);
        continue;
      }

      merged.set(provider.id, {
        ...provider,
        reason: existing.reason ?? provider.reason,
        retrievalScore: provider.retrievalScore,
        retrievalSource: 'hybrid',
      });
    }

    return Array.from(merged.values()).sort((left, right) => {
      const leftSource = left.retrievalSource === 'hybrid' ? 1 : 0;
      const rightSource = right.retrievalSource === 'hybrid' ? 1 : 0;
      if (rightSource !== leftSource) {
        return rightSource - leftSource;
      }

      return (right.retrievalScore ?? 0) - (left.retrievalScore ?? 0);
    });
  }

  async searchProvidersByKeyword(
    input: KeywordProviderSearchInput,
  ): Promise<ProviderGatewaySearchResult> {
    return this.searchProvidersWithAllowedParams({
      search: input.keyword.trim(),
      page: input.page ?? 1,
    });
  }

  async searchProvidersByCategoryLocation(
    input: CategoryLocationProviderSearchInput,
  ): Promise<ProviderGatewaySearchResult> {
    const composedSearch = [input.category, input.location ?? null]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .join(' ');

    return this.searchProvidersWithAllowedParams({
      search: composedSearch,
      page: input.page ?? 1,
    });
  }

  async searchProvidersByQueryIntent(
    input: QueryIntentProviderSearchInput,
  ): Promise<ProviderGatewaySearchResult> {
    if (this.options.vectorSearchGateway && this.options.searchMode !== 'api') {
      const vectorResults = await this.options.vectorSearchGateway.searchQueryIntent(input);
      const providers = await this.enrichVectorResults(vectorResults);
      return {
        providers: this.selectProvidersForCriteria(
          providers,
          input.location,
          input.category,
        ).slice(0, this.options.persistedSearchLimit),
      };
    }

    return this.searchProvidersByCategoryLocation({
      category: input.category,
      location: input.location,
      page: 1,
    });
  }

  async getRelevantProviders(): Promise<ProviderSummary[]> {
    const response = await this.fetchJson<ApiEnvelope<ProviderApiItem[]>>(
      '/relevant',
    );
    return response.data.map((provider) => this.toProviderSummary(provider));
  }

  async getProviderDetail(providerId: number): Promise<ProviderDetail | null> {
    try {
      const response = await this.fetchJson<ApiEnvelope<ProviderApiItem>>(
        `/${providerId}`,
      );
      return this.toProviderDetail(response.data);
    } catch {
      return null;
    }
  }

  async getProviderDetailAndTrackView(
    providerId: number,
  ): Promise<ProviderDetail | null> {
    try {
      const response = await this.fetchJson<ApiEnvelope<ProviderApiItem>>(
        `/view/${providerId}`,
      );
      return this.toProviderDetail(response.data);
    } catch {
      return null;
    }
  }

  async getRelatedProviders(providerId: number): Promise<ProviderSummary[]> {
    const response = await this.fetchJson<ApiEnvelope<ProviderApiItem[]>>(
      `/related/${providerId}`,
    );
    return response.data.map((provider) => this.toProviderSummary(provider));
  }

  async listProviderReviews(providerId: number): Promise<ProviderReview[]> {
    const response = await this.fetchJson<ApiEnvelope<Array<Record<string, unknown>>>>(
      `/review/${providerId}`,
    );
    return response.data.map((review) => this.toProviderReview(review));
  }

  async getEventVendorContext(eventId: number): Promise<Record<string, unknown> | null> {
    const response = await this.fetchJson<ApiEnvelope<Record<string, unknown>>>(
      `/event/${eventId}`,
    );
    return response.data;
  }

  async listEventFavoriteProviders(args: {
    eventId: number;
    sortBy?: string | null;
    page?: number | null;
    categoryId?: number | null;
  }): Promise<ProviderSummary[]> {
    const searchParams = new URLSearchParams();
    searchParams.set('eventId', String(args.eventId));

    if (args.sortBy) {
      searchParams.set('sortBy', args.sortBy);
    }
    if (args.page) {
      searchParams.set('page', String(args.page));
    }
    if (args.categoryId) {
      searchParams.set('categoryId', String(args.categoryId));
    }

    const response = await this.fetchJson<ApiEnvelope<PaginatedProviders>>(
      `/event-favorites/${args.eventId}?${searchParams.toString()}`,
    );
    return (response.data.data ?? []).map((provider) =>
      this.toProviderSummary(provider),
    );
  }

  async listUserEventsVendorContext(
    userId: number,
  ): Promise<Record<string, unknown>[]> {
    const response = await this.fetchJson<ApiEnvelope<Array<Record<string, unknown>>>>(
      `/user-events/${userId}`,
    );
    return response.data;
  }

  async lookupUserEventContext(
    input: UserEventLookupInput,
  ): Promise<UserEventLookupResult | null> {
    const searchParams = new URLSearchParams();
    if (input.email) {
      searchParams.set('email', input.email);
    } else if (input.phone) {
      searchParams.set('phone', input.phone);
    }

    const response = await this.fetchGuestServiceJson<ApiEnvelope<Record<string, unknown>>>(
      `/user-lookup?${searchParams.toString()}`,
    );

    if (!response.status || !response.data) {
      return null;
    }

    return this.toUserEventLookupResult(input, response.data);
  }

  async requestGuestLoginCode(email: string): Promise<GuestLoginCodeRequestResult> {
    const response = await this.postGuestAuthJson<ApiEnvelope<Record<string, unknown>>>(
      '/request-login-code',
      { email },
      { throwOnHttpError: false },
    );

    if (!response.ok) {
      return {
        status: response.status === 404 ? 'email_not_found' : 'failed',
        error: this.authErrorMessage(response.body) ?? `Guest auth request failed with ${response.status}`,
      };
    }

    const body = response.body;
    if (body.status === true) {
      return { status: 'sent' };
    }

    return {
      status: this.isEmailNotFoundAuthError(body) ? 'email_not_found' : 'failed',
      error: this.authErrorMessage(body) ?? 'No se pudo enviar el código.',
    };
  }

  async verifyGuestLoginCode(
    email: string,
    code: string,
  ): Promise<GuestLoginCodeVerificationResult> {
    const response = await this.postGuestAuthJson<ApiEnvelope<Record<string, unknown>>>(
      '/login-code',
      { email, code },
      { throwOnHttpError: false },
    );

    if (!response.ok) {
      const authError = this.authErrorMessage(response.body);
      return {
        status:
          response.status === 400 && this.isInvalidCodeAuthError(response.body)
            ? 'invalid_code'
            : response.status === 401 || response.status === 422
              ? 'invalid_code'
              : 'failed',
        error: authError ?? `Guest login failed with ${response.status}`,
      };
    }

    const body = response.body;
    const token = this.extractAuthToken(body);
    if (body.status === true && token) {
      return {
        status: 'authenticated',
        token,
        tokenExpiresAt: this.defaultGuestTokenExpiry(),
      };
    }

    return {
      status: this.isInvalidCodeAuthError(body) ? 'invalid_code' : 'failed',
      error: this.authErrorMessage(body) ?? 'El código no pudo validarse.',
    };
  }

  async lookupAuthenticatedGuest(args: {
    token: string;
    email: string;
  }): Promise<UserEventLookupResult | null> {
    const searchParams = new URLSearchParams();
    searchParams.set('email', args.email);

    const response = await this.fetchGuestServiceJson<ApiEnvelope<Record<string, unknown>>>(
      `/user-lookup?${searchParams.toString()}`,
      {
        authorization: `Bearer ${args.token}`,
      },
    );

    if (!response.status || !response.data) {
      return null;
    }

    return this.toUserEventLookupResult({ email: args.email, phone: null }, response.data);
  }

  async createQuoteRequest(
    input: QuoteRequestInput,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      name: input.name,
      email: input.email,
      phone: input.phone,
      phoneExtension: input.phoneExtension,
      eventDate: input.eventDate,
      guestsRange: input.guestsRange,
      description: input.description,
      benefitId: input.providerId,
    };
    if (input.userId != null) {
      body.userId = input.userId;
    }

    const response = await this.postJson<ApiEnvelope<Record<string, unknown>>>(
      '/quote',
      body,
    );

    return response.data;
  }

  async addVendorToEventFavorites(
    input: FavoriteRequestInput,
  ): Promise<Record<string, unknown>> {
    const response = await this.postJson<ApiEnvelope<Record<string, unknown>>>(
      '/favorite',
      {
        user_id: input.userId,
        event_id: input.eventId,
        benefit_id: input.providerId,
      },
    );

    return response.data;
  }

  async createProviderReview(
    input: CreateProviderReviewInput,
  ): Promise<Record<string, unknown>> {
    const response = await this.postJson<ApiEnvelope<Record<string, unknown>>>(
      '/review',
      {
        name: input.name,
        rating: input.rating,
        comment: input.comment ?? '',
        benefit_id: input.providerId,
        user_id: input.userId,
      },
    );

    return response.data;
  }

  private resolveActiveCategory(plan: PersistedPlan): string | null {
    const raw = getActiveNeed(plan)?.category ?? plan.active_need_category ?? plan.vendor_category;
    if (!raw) return null;
    const categories = resolveSearchCategories(raw);
    return categories[0] ?? raw;
  }

  private selectProvidersForPlan(
    providers: ProviderSummary[],
    plan: PersistedPlan,
    activeCategory: string | null,
  ): ProviderSummary[] {
    return this.selectProvidersForCriteria(providers, plan.location, activeCategory);
  }

  private selectProvidersForCriteria(
    providers: ProviderSummary[],
    location: string | null,
    activeCategory: string | null,
  ): ProviderSummary[] {
    const locationCountry = locationCountryKey(location);
    const evaluated = providers
      .map((provider) => {
        const categoryScore = this.categoryMatchScore(provider, activeCategory);
        const locationScore = this.locationMatchScore(provider, locationCountry);
        return {
          provider,
          categoryScore,
          locationScore,
          hasLocation: Boolean(provider.location),
        };
      })
      .filter((entry) => !activeCategory || entry.categoryScore > 0);

    const categoryScoped = evaluated.length > 0 ? evaluated : providers.map((provider) => ({
      provider,
      categoryScore: 0,
      locationScore: this.locationMatchScore(provider, locationCountry),
      hasLocation: Boolean(provider.location),
    }));

    const exactLocationMatches =
      !locationCountry
        ? categoryScoped
        : categoryScoped.filter((entry) => entry.locationScore >= 3);

    const rankedPool = exactLocationMatches.length > 0 ? exactLocationMatches : categoryScoped;

    return rankedPool
      .sort((left, right) => {
        if (right.locationScore !== left.locationScore) {
          return right.locationScore - left.locationScore;
        }
        if (right.categoryScore !== left.categoryScore) {
          return right.categoryScore - left.categoryScore;
        }
        if (left.hasLocation !== right.hasLocation) {
          return Number(right.hasLocation) - Number(left.hasLocation);
        }
        return left.provider.id - right.provider.id;
      })
      .map((entry) => entry.provider);
  }

  private categoryMatchScore(
    provider: ProviderSummary,
    activeCategory: string | null,
  ): number {
    if (!activeCategory) {
      return 1;
    }

    if (provider.category === activeCategory) {
      return 2;
    }

    const haystack = this.normalizeText([
      provider.title,
      provider.category ?? '',
    ].join(' '));
    if (haystack.includes(this.normalizeText(activeCategory))) {
      return 1;
    }

    return 0;
  }

  private locationMatchScore(
    provider: ProviderSummary,
    locationCountry: string | null,
  ): number {
    if (!provider.location) {
      return 0;
    }

    if (!locationCountry) {
      return 1;
    }

    if (locationCountryKey(provider.location) === locationCountry) {
      return 3;
    }

    return 1;
  }

  private hasExactLocationMatch(
    provider: ProviderSummary,
    locationCountry: string | null,
  ): boolean {
    return this.locationMatchScore(provider, locationCountry) >= 3;
  }

  private reasonForProvider(
    provider: ProviderSummary,
    plan: PersistedPlan,
    activeCategory: string | null,
  ): string {
    const reasons: string[] = [];
    if (activeCategory && provider.category) {
      reasons.push(`coincide con la categoría ${activeCategory}`);
    }
    const locationCountry = locationCountryKey(plan.location);
    if (plan.location && provider.location) {
      if (this.hasExactLocationMatch(provider, locationCountry)) {
        reasons.push(`opera en ${provider.location}`);
      } else {
        reasons.push(
          `reporta cobertura en ${provider.location} (confirma atención exacta en ${plan.location})`,
        );
      }
    } else if (plan.location && !provider.location) {
      reasons.push(`sin ubicación pública confirmada para ${plan.location}`);
    }
    if (plan.budget_signal && provider.priceLevel) {
      reasons.push(`parece alineado al rango ${plan.budget_signal}`);
    }

    return reasons.join(', ') || 'coincide con los criterios principales del plan';
  }

  private toProviderSummary(provider: ProviderApiItem): ProviderSummary {
    const title =
      provider.translations?.find((translation) =>
        translation.language?.locale?.startsWith('es'),
      )?.title ??
      provider.translations?.[0]?.title ??
      `Proveedor ${provider.id}`;

    const rawCategory =
      provider.category?.translations?.find((translation) =>
        translation.language?.locale?.startsWith('es'),
      )?.name ??
      provider.category?.translations?.[0]?.name ??
      null;

    const category = normalizeToProviderCategory(rawCategory);

    const city =
      typeof provider.city === 'string'
        ? provider.city
        : provider.city?.name ?? null;
    const country =
      typeof provider.country === 'string'
        ? provider.country
        : provider.country?.name ?? null;

    return normalizeProviderSummary({
      id: provider.id,
      title,
      slug: provider.slug ?? null,
      category,
      location: [city, country].filter(Boolean).join(', ') || null,
      priceLevel: normalizeToPriceLevel(provider.price_level),
      rating: provider.rating ?? null,
      detailUrl: this.buildDetailUrl(provider.slug ?? null),
      websiteUrl: this.findWebsiteUrl(provider.social_networks ?? null),
      minPrice: provider.min_price ?? null,
      maxPrice: provider.max_price ?? null,
      promoBadge: null,
      promoSummary: null,
      descriptionSnippet: null,
      serviceHighlights: [],
      termsHighlights: [],
    });
  }

  private toProviderDetail(provider: ProviderApiItem): ProviderDetail {
    const summary = this.toProviderSummary(provider);
    const infoSections = this.extractInfoSections(provider.info_translations ?? null);
    const promo = this.extractPromo(provider.promos ?? null);

    return {
      ...summary,
      description:
        infoSections.description ??
        (typeof provider.description === 'string' ? provider.description : null),
      eventTypes:
        provider.event_types?.map((item) => item.name).filter(Boolean) as string[] ??
        [],
      promoBadge: promo.badge,
      promoSummary: promo.summary,
      descriptionSnippet: this.firstSentence(
        infoSections.description ??
          (typeof provider.description === 'string' ? provider.description : null),
      ),
      serviceHighlights: infoSections.serviceHighlights,
      termsHighlights: infoSections.termsHighlights,
      raw: provider,
    };
  }

  private toMarketplaceCategory(category: CategoryApiItem): MarketplaceCategory {
    const name =
      category.translations?.find((translation) =>
        translation.language?.locale?.startsWith('es'),
      )?.name ??
      category.translations?.[0]?.name ??
      'Categoría sin nombre';

    return {
      id: category.id ?? null,
      name,
      slug: category.slug ?? null,
      color: category.color ?? null,
      eventTypes:
        category.event_types?.map((eventType) => eventType.name).filter(Boolean) as string[] ??
        [],
      raw: category,
    };
  }

  private toMarketplaceLocation(location: LocationApiItem): MarketplaceLocation {
    return {
      cityId: location.city_id ?? null,
      countryId: location.country_id ?? null,
      city: location.city ?? null,
      country: location.country ?? null,
      raw: location,
    };
  }

  private toProviderReview(review: Record<string, unknown>): ProviderReview {
    return {
      id: typeof review.id === 'number' ? review.id : null,
      name: typeof review.name === 'string' ? review.name : null,
      rating:
        typeof review.rating === 'number'
          ? review.rating
          : typeof review.rating === 'string'
            ? Number.parseFloat(review.rating)
            : null,
      comment: typeof review.comment === 'string' ? review.comment : null,
      createdAt:
        typeof review.created_at === 'string' ? review.created_at : null,
      raw: review,
    };
  }

  private async searchProvidersWithAllowedParams(input: {
    search: string;
    page: number;
  }): Promise<ProviderGatewaySearchResult> {
    const searchParams = new URLSearchParams();
    searchParams.set('search', input.search);
    searchParams.set('page', String(input.page));

    const response = await this.fetchJson<ApiEnvelope<PaginatedProviders>>(
      `/filtered?${searchParams.toString()}`,
    );

    return {
      providers: (response.data.data ?? []).map((provider) =>
        this.toProviderSummary(provider),
      ),
    };
  }

  private async fetchJson<T>(pathname: string): Promise<T> {
    const response = await fetch(`${this.options.baseUrl}${pathname}`);

    if (!response.ok) {
      throw new Error(`Provider API request failed with ${response.status}`);
    }

    return (await response.json()) as T;
  }

  private async fetchGuestServiceJson<T>(
    pathname: string,
    headers?: Record<string, string>,
  ): Promise<T> {
    const baseUrl = this.options.guestServiceBaseUrl ?? this.options.baseUrl;
    const response = headers
      ? await fetch(`${baseUrl}${pathname}`, { headers })
      : await fetch(`${baseUrl}${pathname}`);

    if (!response.ok) {
      throw new Error(`Guest service API request failed with ${response.status}`);
    }

    return (await response.json()) as T;
  }

  private async postGuestAuthJson<T>(
    pathname: string,
    body: Record<string, unknown>,
    options?: { throwOnHttpError?: boolean },
  ): Promise<{ ok: boolean; status: number; body: T }> {
    const baseUrl = this.options.guestAuthBaseUrl ?? 'https://se-v2-api-dev.jnq.io/api-web/user';
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const parsedBody = (await response.json().catch(() => ({}))) as T;

    if (!response.ok && options?.throwOnHttpError !== false) {
      throw new Error(`Guest auth API request failed with ${response.status}`);
    }

    return {
      ok: response.ok,
      status: response.status,
      body: parsedBody,
    };
  }

  private authErrorMessage(body: unknown): string | null {
    if (!body || typeof body !== 'object') {
      return null;
    }
    const record = body as Record<string, unknown>;
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error;
    }
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message;
    }
    if (Array.isArray(record.errors)) {
      const first = record.errors.find((entry): entry is string => typeof entry === 'string');
      if (first) {
        return first;
      }
    }
    if (record.errors && typeof record.errors === 'object') {
      for (const entry of Object.values(record.errors as Record<string, unknown>)) {
        if (typeof entry === 'string') {
          return entry;
        }
        if (Array.isArray(entry)) {
          const first = entry.find((item): item is string => typeof item === 'string');
          if (first) {
            return first;
          }
        }
      }
    }
    return null;
  }

  private isEmailNotFoundAuthError(body: unknown): boolean {
    const message = this.authErrorMessage(body)?.toLowerCase() ?? '';
    return (
      message.includes('not found') ||
      message.includes('not registered') ||
      message.includes('no existe') ||
      message.includes('no encontrado') ||
      message.includes('no registrado')
    );
  }

  private isInvalidCodeAuthError(body: unknown): boolean {
    const message = this.authErrorMessage(body)?.toLowerCase() ?? '';
    return (
      message.includes('invalid') ||
      message.includes('expired') ||
      message.includes('incorrect') ||
      message.includes('inválido') ||
      message.includes('vencido') ||
      message.includes('incorrecto')
    );
  }

  private extractAuthToken(body: unknown): string | null {
    const candidates = this.collectAuthTokenCandidates(body);
    return candidates.find((candidate) => candidate.trim().length > 0) ?? null;
  }

  private collectAuthTokenCandidates(value: unknown): string[] {
    if (!value || typeof value !== 'object') {
      return [];
    }
    const record = value as Record<string, unknown>;
    const directKeys = ['token', 'access_token', 'accessToken', 'auth_token', 'authToken', 'bearer_token', 'bearerToken'];
    const direct = directKeys
      .map((key) => record[key])
      .filter((entry): entry is string => typeof entry === 'string');
    const nested = ['data', 'user', 'auth', 'credentials']
      .flatMap((key) => this.collectAuthTokenCandidates(record[key]));
    return [...direct, ...nested];
  }

  private extractTokenExpiry(body: unknown): string | null {
    if (!body || typeof body !== 'object') {
      return null;
    }
    const record = body as Record<string, unknown>;
    const expiry = this.readStringDeep(record, [
      'expires_at',
      'expiresAt',
      'token_expires_at',
      'tokenExpiresAt',
      'expiration',
    ]);
    if (expiry) {
      const timestamp = Date.parse(expiry);
      return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
    }
    const expiresIn = this.readNumberDeep(record, ['expires_in', 'expiresIn']);
    if (expiresIn !== null && expiresIn > 0) {
      return new Date(Date.now() + expiresIn * 1000).toISOString();
    }
    return null;
  }

  private readStringDeep(value: unknown, keys: string[]): string | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'string' && record[key].trim()) {
        return record[key];
      }
    }
    for (const nestedKey of ['data', 'user', 'auth', 'credentials']) {
      const nested = this.readStringDeep(record[nestedKey], keys);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  private readNumberDeep(value: unknown, keys: string[]): number | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      const entry = record[key];
      if (typeof entry === 'number' && Number.isFinite(entry)) {
        return entry;
      }
      if (typeof entry === 'string') {
        const parsed = Number.parseInt(entry, 10);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    for (const nestedKey of ['data', 'user', 'auth', 'credentials']) {
      const nested = this.readNumberDeep(record[nestedKey], keys);
      if (nested !== null) {
        return nested;
      }
    }
    return null;
  }

  private defaultGuestTokenExpiry(): string {
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }

  private async postJson<T>(
    pathname: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`${this.options.baseUrl}${pathname}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unable to read error body');
      throw new Error(
        `Provider API request failed with ${response.status}: ${errorBody}`,
      );
    }

    return (await response.json()) as T;
  }

  private buildDetailUrl(slug: string | null): string | null {
    if (!slug) {
      return null;
    }

    return `https://sinenvolturas.com/proveedores/${slug}`;
  }

  private toUserEventLookupResult(
    input: UserEventLookupInput,
    data: Record<string, unknown>,
  ): UserEventLookupResult {
    const orders = this.recordArray(data.recent_orders).map((order) =>
      this.toUserEventOrderSummary(order),
    );
    const ordersByEventId = this.groupOrdersByEventId(
      this.recordArray(data.recent_orders),
      orders,
    );
    const events: UserEventSummary[] = [
      ...this.recordArray(data.events).map((event) =>
        this.toUserEventSummary('owner', event, event, ordersByEventId),
      ),
      ...this.recordArray(data.guest_in_events).map((guest) =>
        this.toUserEventSummary('guest', guest, this.recordOrNull(guest.event), ordersByEventId),
      ),
      ...this.recordArray(data.host_in_events).map((host) =>
        this.toUserEventSummary('host', host, this.recordOrNull(host.event), ordersByEventId),
      ),
      ...this.recordArray(data.celebrated_in).map((celebrated) =>
        this.toUserEventSummary(
          'celebrated',
          celebrated,
          this.recordOrNull(celebrated.event),
          ordersByEventId,
        ),
      ),
    ];

    const eventIds = new Set(events.map((event) => event.eventId).filter((id): id is number => id !== null));
    const orderOnlyEvents = this.recordArray(data.recent_orders)
      .filter((order) => {
        const event = this.recordOrNull(order.event);
        const eventId = event ? this.numberField(event, 'id') : null;
        return eventId !== null && !eventIds.has(eventId);
      })
      .map((order) =>
        this.toUserEventSummary('order', order, this.recordOrNull(order.event), ordersByEventId),
      );

    const user = this.recordOrNull(data.user);
    return {
      lookup: input,
      user: user
        ? {
            id: this.numberField(user, 'id'),
            fullName: this.stringField(user, 'full_name'),
            email: this.stringField(user, 'email'),
            fullPhone: this.stringField(user, 'full_phone'),
          }
        : null,
      events: [...events, ...orderOnlyEvents],
      counts: {
        ownerEvents: this.recordArray(data.events).length,
        guestEvents: this.recordArray(data.guest_in_events).length,
        hostEvents: this.recordArray(data.host_in_events).length,
        celebratedEvents: this.recordArray(data.celebrated_in).length,
        recentOrders: orders.length,
      },
    };
  }

  private toUserEventSummary(
    relation: UserEventRelation,
    source: Record<string, unknown>,
    event: Record<string, unknown> | null,
    ordersByEventId: Map<number, UserEventOrderSummary[]>,
  ): UserEventSummary {
    const eventId = event ? this.numberField(event, 'id') : this.numberField(source, 'event_id');
    const currency = this.recordOrNull(event?.currency ?? source.currency);
    const country = this.recordOrNull(event?.country ?? source.country);
    return {
      relation,
      eventId,
      slug: event ? this.stringField(event, 'slug') : null,
      url: event ? this.buildEventUrl(this.stringField(event, 'slug')) : null,
      name: event ? this.stringField(event, 'name') : this.stringField(source, 'name'),
      place: this.resolveEventPlace(event, source),
      type: event ? this.stringField(event, 'type') : null,
      datetime: event ? this.stringField(event, 'datetime') : null,
      stage: event ? this.stringField(event, 'stage') : null,
      isVisible: event ? this.booleanField(event, 'is_visible') : null,
      isPublic: event ? this.booleanField(event, 'is_public') : null,
      currency: currency
        ? this.stringField(currency, 'cod_alpha') ?? this.stringField(currency, 'name')
        : null,
      country: country ? this.stringField(country, 'name') : null,
      guestStatus: relation === 'guest'
        ? {
            hasResponded: this.booleanField(source, 'has_responded'),
            willAttend: this.booleanField(source, 'will_attend'),
            hasCouple: this.booleanField(source, 'has_couple'),
            responseDate: this.stringField(source, 'response_date'),
          }
        : null,
      hostType: relation === 'host' ? this.stringField(source, 'type') : null,
      hostPermission: relation === 'host' ? this.stringField(source, 'permission') : null,
      hostStatus: relation === 'host' ? this.stringField(source, 'status') : null,
      celebratedType: relation === 'celebrated' ? this.stringField(source, 'type') : null,
      amountCollected: event ? this.numberField(event, 'amount_collected') : null,
      amountTransferred: event ? this.numberField(event, 'amount_transferred') : null,
      transactionsCount: event ? this.numberField(event, 'transactions_count') : null,
      invitedGuestCount: event ? this.numberField(event, 'invited_guest') : null,
      confirmedGuestCount: event ? this.numberField(event, 'confirmed_guest') : null,
      orders: eventId === null ? [] : ordersByEventId.get(eventId) ?? [],
    };
  }

  private toUserEventOrderSummary(order: Record<string, unknown>): UserEventOrderSummary {
    const paymentMethod = this.recordOrNull(order.payment_method);
    return {
      id: this.numberField(order, 'id'),
      incrementId: this.stringField(order, 'increment_id'),
      giftType: this.stringField(order, 'gift_type'),
      grandTotal: this.numberField(order, 'grand_total'),
      paymentStatus: this.stringField(order, 'payment_status'),
      shippingStatus: this.stringField(order, 'shipping_status'),
      createdAt: this.stringField(order, 'created_at'),
      paymentMethod: paymentMethod ? this.stringField(paymentMethod, 'name') : null,
    };
  }

  private buildEventUrl(slug: string | null): string | null {
    if (!slug) {
      return null;
    }

    return `https://sinenvolturas.com/${slug}`;
  }

  private resolveEventPlace(
    event: Record<string, unknown> | null,
    source: Record<string, unknown>,
  ): string | null {
    const directFields = [
      event ? this.stringField(event, 'place') : null,
      event ? this.stringField(event, 'location') : null,
      event ? this.stringField(event, 'address') : null,
      this.stringField(source, 'place'),
      this.stringField(source, 'location'),
      this.stringField(source, 'address'),
    ].filter((value): value is string => value !== null);
    if (directFields.length > 0) {
      return directFields[0];
    }

    const country = this.recordOrNull(event?.country ?? source.country);
    return country ? this.stringField(country, 'name') : null;
  }

  private groupOrdersByEventId(
    rawOrders: Record<string, unknown>[],
    orders: UserEventOrderSummary[],
  ): Map<number, UserEventOrderSummary[]> {
    const byEventId = new Map<number, UserEventOrderSummary[]>();
    rawOrders.forEach((rawOrder, index) => {
      const event = this.recordOrNull(rawOrder.event);
      const eventId = event ? this.numberField(event, 'id') : null;
      const order = orders[index];
      if (eventId === null || !order) {
        return;
      }
      const current = byEventId.get(eventId) ?? [];
      current.push(order);
      byEventId.set(eventId, current);
    });
    return byEventId;
  }

  private recordArray(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    );
  }

  private recordOrNull(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private stringField(source: Record<string, unknown>, key: string): string | null {
    const value = source[key];
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  }

  private numberField(source: Record<string, unknown>, key: string): number | null {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private booleanField(source: Record<string, unknown>, key: string): boolean | null {
    const value = source[key];
    return typeof value === 'boolean' ? value : null;
  }

  private findWebsiteUrl(
    socialNetworks: SocialNetworkApiItem[] | null,
  ): string | null {
    if (!socialNetworks) {
      return null;
    }

    const website = socialNetworks.find(
      (network) => network.social_network?.name?.toLowerCase() === 'web',
    );

    return website?.url?.trim() || null;
  }

  private extractInfoSections(
    translations: ProviderInfoTranslation[] | null,
  ): {
    description: string | null;
    serviceHighlights: string[];
    termsHighlights: string[];
  } {
    if (!translations || translations.length === 0) {
      return {
        description: null,
        serviceHighlights: [],
        termsHighlights: [],
      };
    }

    const localizedTranslations = translations
      .filter((translation) => {
        const locale = translation.language?.locale?.toLowerCase() ?? '';
        return locale.startsWith('es');
      });
    const source = localizedTranslations.length > 0 ? localizedTranslations : translations;

    let description: string | null = null;
    let serviceHighlights: string[] = [];
    let termsHighlights: string[] = [];

    for (const translation of source) {
      const title = translation.title?.toLowerCase() ?? '';
      const lines = this.htmlToLines(translation.description ?? null);

      if (lines.length === 0) {
        continue;
      }

      if (!description && (title.includes('acerca') || title.includes('about'))) {
        description = lines.join(' ');
        continue;
      }

      if (serviceHighlights.length === 0 && title.includes('servicios')) {
        serviceHighlights = lines;
        continue;
      }

      if (termsHighlights.length === 0 && title.includes('términos')) {
        termsHighlights = lines;
      }
    }

    if (serviceHighlights.length === 0 || termsHighlights.length === 0) {
      const combinedLines = source.flatMap((translation) =>
        this.htmlToLines(translation.description ?? null),
      );

      if (serviceHighlights.length === 0) {
        serviceHighlights = this.extractLinesAfterHeading(
          combinedLines,
          ['servicios que ofrece', 'services offered'],
          Number.MAX_SAFE_INTEGER,
        );
      }

      if (termsHighlights.length === 0) {
        termsHighlights = this.extractLinesAfterHeading(
          combinedLines,
          ['términos y condiciones', 'términos  y condiciones', 'terms and conditions'],
          Number.MAX_SAFE_INTEGER,
        );
      }
    }

    if (!description) {
      description =
        this.htmlToLines(source[0]?.description ?? null).join(' ').trim() || null;
    }

    return {
      description,
      serviceHighlights,
      termsHighlights,
    };
  }

  private extractPromo(
    promos: PromoApiItem[] | null,
  ): {
    badge: string | null;
    summary: string | null;
  } {
    if (!promos || promos.length === 0) {
      return {
        badge: null,
        summary: null,
      };
    }

    for (const promo of promos) {
      const localizedTranslations = promo.translations?.filter((translation) => {
        const locale = translation.language?.locale?.toLowerCase() ?? '';
        return locale.startsWith('es');
      });
      const source =
        localizedTranslations && localizedTranslations.length > 0
          ? localizedTranslations
          : promo.translations ?? [];
      const translation = source[0];

      if (!translation) {
        continue;
      }

      return {
        badge: translation.badge?.trim() || null,
        summary: translation.subtitle?.trim() || null,
      };
    }

    return {
      badge: null,
      summary: null,
    };
  }

  private htmlToLines(html: string | null): string[] {
    if (!html) {
      return [];
    }

    const withBreaks = html
      .replace(/<\/(p|li|h1|h2|h3|h4|h5|h6)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li>/gi, '- ')
      .replace(/<[^>]+>/g, ' ');

    return this.decodeHtmlEntities(withBreaks)
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map((line) => line.replace(/^-+\s*/, ''));
  }

  private decodeHtmlEntities(value: string): string {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&aacute;/g, 'á')
      .replace(/&eacute;/g, 'é')
      .replace(/&iacute;/g, 'í')
      .replace(/&oacute;/g, 'ó')
      .replace(/&uacute;/g, 'ú')
      .replace(/&ntilde;/g, 'ñ')
      .replace(/&Aacute;/g, 'Á')
      .replace(/&Eacute;/g, 'É')
      .replace(/&Iacute;/g, 'Í')
      .replace(/&Oacute;/g, 'Ó')
      .replace(/&Uacute;/g, 'Ú')
      .replace(/&Ntilde;/g, 'Ñ');
  }

  private firstSentence(value: string | null): string | null {
    if (!value) {
      return null;
    }

    const normalized = value.trim();
    if (!normalized) {
      return null;
    }

    const sentence = normalized.match(/.+?[.!?](\s|$)/)?.[0] ?? normalized;
    return sentence.trim();
  }

  private extractLinesAfterHeading(
    lines: string[],
    headings: string[],
    limit: number,
  ): string[] {
    const normalizedHeadings = headings.map((heading) => heading.toLowerCase());
    const startIndex = lines.findIndex((line) =>
      normalizedHeadings.includes(line.toLowerCase().replace(/:$/, '')),
    );

    if (startIndex < 0) {
      return [];
    }

    return lines
      .slice(startIndex + 1)
      .filter((line) => !normalizedHeadings.includes(line.toLowerCase().replace(/:$/, '')))
      .slice(0, limit);
  }

  private categorySearchTerms(category: string | null | undefined): string[] {
    const canonical = normalizeToProviderCategory(category);
    return canonical ? [canonical] : [];
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
