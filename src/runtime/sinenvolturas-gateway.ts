import { getActiveNeed, type PersistedPlan } from '../core/plan';
import type { ProviderDetail, ProviderSummary } from '../core/provider';
import type {
  CreateProviderReviewInput,
  FavoriteRequestInput,
  MarketplaceCategory,
  MarketplaceLocation,
  ProviderGateway,
  ProviderGatewaySearchResult,
  ProviderReview,
  ProviderSearchQuery,
  QuoteRequestInput,
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
  translations?: Array<{
    title?: string | null;
    language?: { locale?: string | null };
  }>;
  category?: {
    translations?: Array<{ name?: string | null; language?: { locale?: string | null } }>;
  };
  city?: { name?: string | null } | string | null;
  country?: { name?: string | null } | string | null;
  description?: string | null;
  event_types?: Array<{ name?: string | null }> | null;
  [key: string]: unknown;
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
      persistedSearchLimit: number;
      summarySearchWordLimit: number;
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
    const activeNeed = getActiveNeed(plan);
    const searchTerms = [
      activeNeed?.category ?? plan.vendor_category,
      plan.event_type,
      plan.location,
      plan.conversation_summary
        .split(/\s+/)
        .slice(0, this.options.summarySearchWordLimit)
        .join(' '),
    ]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));

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

    const providers = paginated
      .map((provider) => this.toProviderSummary(provider))
      .filter((provider) => this.matchesPlan(provider, plan, activeNeed?.category ?? null))
      .slice(0, this.options.persistedSearchLimit)
      .map((provider) => ({
        ...provider,
        reason: this.reasonForProvider(provider, plan, activeNeed?.category ?? null),
      }));

    return { providers };
  }

  async searchProvidersByQuery(
    query: ProviderSearchQuery,
  ): Promise<ProviderGatewaySearchResult> {
    const search = query.search?.trim();
    const page = query.page ?? 1;
    const searchParams = new URLSearchParams();

    if (search) {
      searchParams.set('search', search);
    }
    searchParams.set('page', String(page));

    for (const [key, value] of Object.entries(query.query ?? {})) {
      if (value === null || value === undefined) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const entry of value) {
          searchParams.append(key, String(entry));
        }
        continue;
      }

      searchParams.set(key, String(value));
    }

    const response = await this.fetchJson<ApiEnvelope<PaginatedProviders>>(
      `/filtered?${searchParams.toString()}`,
    );

    return {
      providers: (response.data.data ?? []).map((provider) =>
        this.toProviderSummary(provider),
      ),
    };
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

  async createQuoteRequest(
    input: QuoteRequestInput,
  ): Promise<Record<string, unknown>> {
    const response = await this.postJson<ApiEnvelope<Record<string, unknown>>>(
      '/quote',
      {
        name: input.name,
        email: input.email,
        phone: input.phone,
        phoneExtension: input.phoneExtension,
        eventDate: input.eventDate,
        guestsRange: input.guestsRange,
        description: input.description,
        benefitId: input.providerId,
        userId: input.userId,
      },
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

  private matchesPlan(
    provider: ProviderSummary,
    plan: PersistedPlan,
    activeCategory: string | null,
  ): boolean {
    const haystack = [
      provider.title,
      provider.category ?? '',
      provider.location ?? '',
    ]
      .join(' ')
      .toLowerCase();

    const mustContain = [activeCategory ?? plan.vendor_category, plan.location]
      .map((value) => value?.toLowerCase())
      .filter((value): value is string => Boolean(value));

    return mustContain.every((term) => haystack.includes(term));
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
    if (plan.location && provider.location) {
      reasons.push(`opera en ${provider.location}`);
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

    const category =
      provider.category?.translations?.find((translation) =>
        translation.language?.locale?.startsWith('es'),
      )?.name ??
      provider.category?.translations?.[0]?.name ??
      null;

    const city =
      typeof provider.city === 'string'
        ? provider.city
        : provider.city?.name ?? null;
    const country =
      typeof provider.country === 'string'
        ? provider.country
        : provider.country?.name ?? null;

    return {
      id: provider.id,
      title,
      slug: provider.slug ?? null,
      category,
      location: [city, country].filter(Boolean).join(', ') || null,
      priceLevel: provider.price_level ?? null,
      rating: provider.rating ?? null,
    };
  }

  private toProviderDetail(provider: ProviderApiItem): ProviderDetail {
    const summary = this.toProviderSummary(provider);
    return {
      ...summary,
      description:
        typeof provider.description === 'string' ? provider.description : null,
      eventTypes:
        provider.event_types?.map((item) => item.name).filter(Boolean) as string[] ??
        [],
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

  private async fetchJson<T>(pathname: string): Promise<T> {
    const response = await fetch(`${this.options.baseUrl}${pathname}`);

    if (!response.ok) {
      throw new Error(`Provider API request failed with ${response.status}`);
    }

    return (await response.json()) as T;
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
      throw new Error(`Provider API request failed with ${response.status}`);
    }

    return (await response.json()) as T;
  }
}
