import { SinEnvolturasGateway } from '../runtime/sinenvolturas-gateway';
import type { ProviderSyncRecord } from './types';

type ApiEnvelope<T> = {
  data: T;
};

type ProviderListItem = {
  id?: number | null;
};

type PaginatedProviders = {
  current_page?: number;
  data?: ProviderListItem[];
  last_page?: number;
  total?: number;
};

function splitLocation(location: string | null | undefined): {
  city: string | null;
  country: string | null;
} {
  if (!location) {
    return { city: null, country: null };
  }

  const parts = location.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return { city: null, country: parts[0] ?? null };
  }

  return {
    city: parts[0] ?? null,
    country: parts[parts.length - 1] ?? null,
  };
}

export class ProviderCatalogFetcher {
  private readonly gateway: SinEnvolturasGateway;

  constructor(private readonly baseUrl: string) {
    this.gateway = new SinEnvolturasGateway({
      baseUrl,
      persistedSearchLimit: 50,
      summarySearchWordLimit: 10,
    });
  }

  async fetchAllProviders(): Promise<ProviderSyncRecord[]> {
    const ids = await this.fetchAllProviderIds();
    const records: ProviderSyncRecord[] = [];

    for (const id of ids) {
      const detail = await this.gateway.getProviderDetail(id);
      if (!detail) {
        continue;
      }

      const locationParts = splitLocation(detail.location);
      records.push({
        ...detail,
        city: locationParts.city,
        country: locationParts.country,
      });
    }

    return records;
  }

  private async fetchAllProviderIds(): Promise<number[]> {
    const firstPage = await this.fetchPage(1);
    const lastPage = firstPage.data.last_page ?? 1;
    const ids = new Set<number>();

    this.collectIds(firstPage.data.data ?? [], ids);

    for (let page = 2; page <= lastPage; page += 1) {
      const response = await this.fetchPage(page);
      this.collectIds(response.data.data ?? [], ids);
    }

    return Array.from(ids).sort((left, right) => left - right);
  }

  private collectIds(items: ProviderListItem[], ids: Set<number>): void {
    for (const item of items) {
      if (typeof item.id === 'number' && Number.isInteger(item.id)) {
        ids.add(item.id);
      }
    }
  }

  private async fetchPage(page: number): Promise<ApiEnvelope<PaginatedProviders>> {
    const response = await fetch(`${this.baseUrl}/filtered?page=${page}`);
    if (!response.ok) {
      throw new Error(`Provider API request failed with ${response.status}`);
    }

    return (await response.json()) as ApiEnvelope<PaginatedProviders>;
  }
}
