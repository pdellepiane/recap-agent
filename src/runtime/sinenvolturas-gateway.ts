import { getActiveNeed, type PersistedPlan } from '../core/plan';
import {
  normalizeProviderSummary,
  type ProviderDetail,
  type ProviderSummary,
} from '../core/provider';
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
    const searchTerms = Array.from(
      new Set(
        [
          ...this.categoryAliases(activeNeed?.category ?? plan.vendor_category),
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
    const haystack = this.normalizeText([
      provider.title,
      provider.category ?? '',
      provider.location ?? '',
    ].join(' '));
    const categoryAliases = this.categoryAliases(activeCategory ?? plan.vendor_category);
    const categoryMatches =
      categoryAliases.length === 0 ||
      categoryAliases.some((alias) => haystack.includes(this.normalizeText(alias)));
    const locationAliases = this.locationAliases(plan.location);
    const locationMatches =
      locationAliases.length === 0 ||
      locationAliases.some((alias) => haystack.includes(this.normalizeText(alias)));

    return categoryMatches && locationMatches;
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

    return normalizeProviderSummary({
      id: provider.id,
      title,
      slug: provider.slug ?? null,
      category,
      location: [city, country].filter(Boolean).join(', ') || null,
      priceLevel: provider.price_level ?? null,
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

  private buildDetailUrl(slug: string | null): string | null {
    if (!slug) {
      return null;
    }

    return `https://sinenvolturas.com/proveedores/${slug}`;
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
        serviceHighlights = lines.slice(0, 3);
        continue;
      }

      if (termsHighlights.length === 0 && title.includes('términos')) {
        termsHighlights = lines.slice(0, 2);
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
          3,
        );
      }

      if (termsHighlights.length === 0) {
        termsHighlights = this.extractLinesAfterHeading(
          combinedLines,
          ['términos y condiciones', 'términos  y condiciones', 'terms and conditions'],
          2,
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

  private categoryAliases(category: string | null | undefined): string[] {
    const normalized = this.normalizeText(category ?? '');
    if (!normalized) {
      return [];
    }

    const aliases = new Set<string>([category?.trim() ?? '']);

    switch (normalized) {
      case 'local':
      case 'venue':
        aliases.add('salón');
        aliases.add('salon');
        aliases.add('venue');
        aliases.add('espacio para eventos');
        aliases.add('recepciones');
        break;
      case 'fotografia':
        aliases.add('fotografía');
        aliases.add('fotografia y video');
        aliases.add('foto');
        break;
      case 'catering':
        aliases.add('catering');
        aliases.add('mesa gastronómica');
        break;
      default:
        break;
    }

    return Array.from(aliases).filter(Boolean);
  }

  private locationAliases(location: string | null | undefined): string[] {
    if (!location) {
      return [];
    }

    const parts = location
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length >= 3);

    return Array.from(new Set([location.trim(), ...parts]));
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
