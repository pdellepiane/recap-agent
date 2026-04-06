import type { PersistedPlan } from '../core/plan';
import type { ProviderDetail, ProviderSummary } from '../core/provider';
import type {
  ProviderGateway,
  ProviderGatewaySearchResult,
} from './provider-gateway';

type ApiEnvelope<T> = {
  data: T;
  status: boolean;
  errors: unknown;
  error: string;
};

type CategoryApiItem = {
  translations?: Array<{ name?: string | null; language?: { locale?: string | null } }>;
};

type LocationApiItem = {
  city?: string | null;
  country?: string | null;
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
  constructor(private readonly baseUrl: string) {}

  async listCategories(): Promise<string[]> {
    const response = await this.fetchJson<ApiEnvelope<CategoryApiItem[]>>(
      '/categories',
    );
    return response.data
      .flatMap((category) => category.translations ?? [])
      .map((translation) => translation.name?.trim())
      .filter((value): value is string => Boolean(value));
  }

  async listLocations(): Promise<string[]> {
    const response = await this.fetchJson<ApiEnvelope<LocationApiItem[]>>(
      '/locations',
    );

    return response.data
      .map((location) => location.city ?? location.country ?? null)
      .filter((value): value is string => Boolean(value));
  }

  async searchProviders(
    plan: PersistedPlan,
  ): Promise<ProviderGatewaySearchResult> {
    const searchTerms = [
      plan.vendor_category,
      plan.event_type,
      plan.location,
      plan.conversation_summary.split(/\s+/).slice(0, 5).join(' '),
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
      .filter((provider) => this.matchesPlan(provider, plan))
      .slice(0, 5)
      .map((provider) => ({
        ...provider,
        reason: this.reasonForProvider(provider, plan),
      }));

    return { providers };
  }

  async getProviderDetail(providerId: number): Promise<ProviderDetail | null> {
    try {
      const response = await this.fetchJson<ApiEnvelope<ProviderApiItem>>(
        `/${providerId}`,
      );
      const provider = response.data;
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
    } catch {
      return null;
    }
  }

  private matchesPlan(provider: ProviderSummary, plan: PersistedPlan): boolean {
    const haystack = [
      provider.title,
      provider.category ?? '',
      provider.location ?? '',
    ]
      .join(' ')
      .toLowerCase();

    const mustContain = [plan.vendor_category, plan.location]
      .map((value) => value?.toLowerCase())
      .filter((value): value is string => Boolean(value));

    return mustContain.every((term) => haystack.includes(term));
  }

  private reasonForProvider(
    provider: ProviderSummary,
    plan: PersistedPlan,
  ): string {
    const reasons: string[] = [];
    if (plan.vendor_category && provider.category) {
      reasons.push(`coincide con la categoría ${plan.vendor_category}`);
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

  private async fetchJson<T>(pathname: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${pathname}`);

    if (!response.ok) {
      throw new Error(`Provider API request failed with ${response.status}`);
    }

    return (await response.json()) as T;
  }
}

