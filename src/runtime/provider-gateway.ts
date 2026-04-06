import type { PersistedPlan } from '../core/plan';
import type { ProviderDetail, ProviderSummary } from '../core/provider';

export type ProviderGatewaySearchResult = {
  providers: ProviderSummary[];
};

export interface ProviderGateway {
  listCategories(): Promise<string[]>;
  listLocations(): Promise<string[]>;
  searchProviders(plan: PersistedPlan): Promise<ProviderGatewaySearchResult>;
  getProviderDetail(providerId: number): Promise<ProviderDetail | null>;
}

