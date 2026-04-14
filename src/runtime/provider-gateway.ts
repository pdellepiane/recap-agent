import type { PersistedPlan } from '../core/plan';
import type { ProviderDetail, ProviderSummary } from '../core/provider';

export type ProviderGatewaySearchResult = {
  providers: ProviderSummary[];
};

export type KeywordProviderSearchInput = {
  keyword: string;
  page?: number | null;
};

export type CategoryLocationProviderSearchInput = {
  category: string;
  location?: string | null;
  page?: number | null;
};

export type MarketplaceCategory = {
  id: number | null;
  name: string;
  slug: string | null;
  color: string | null;
  eventTypes: string[];
  raw: Record<string, unknown>;
};

export type MarketplaceLocation = {
  cityId: number | null;
  countryId: number | null;
  city: string | null;
  country: string | null;
  raw: Record<string, unknown>;
};

export type ProviderReview = {
  id: number | null;
  name: string | null;
  rating: number | null;
  comment: string | null;
  createdAt: string | null;
  raw: Record<string, unknown>;
};

export type QuoteRequestInput = {
  providerId: number;
  userId: number;
  name: string;
  email: string;
  phone: string;
  phoneExtension: string;
  eventDate: string;
  guestsRange: string;
  description: string;
};

export type FavoriteRequestInput = {
  providerId: number;
  userId: number;
  eventId: number;
};

export type CreateProviderReviewInput = {
  providerId: number;
  userId: number;
  name: string;
  rating: number;
  comment?: string | null;
};

export interface ProviderGateway {
  listCategories(): Promise<MarketplaceCategory[]>;
  getCategoryBySlug(slug: string): Promise<MarketplaceCategory | null>;
  listLocations(): Promise<MarketplaceLocation[]>;
  searchProviders(plan: PersistedPlan): Promise<ProviderGatewaySearchResult>;
  searchProvidersByKeyword(
    input: KeywordProviderSearchInput,
  ): Promise<ProviderGatewaySearchResult>;
  searchProvidersByCategoryLocation(
    input: CategoryLocationProviderSearchInput,
  ): Promise<ProviderGatewaySearchResult>;
  getRelevantProviders(): Promise<ProviderSummary[]>;
  getProviderDetail(providerId: number): Promise<ProviderDetail | null>;
  getProviderDetailAndTrackView(providerId: number): Promise<ProviderDetail | null>;
  getRelatedProviders(providerId: number): Promise<ProviderSummary[]>;
  listProviderReviews(providerId: number): Promise<ProviderReview[]>;
  getEventVendorContext(eventId: number): Promise<Record<string, unknown> | null>;
  listEventFavoriteProviders(args: {
    eventId: number;
    sortBy?: string | null;
    page?: number | null;
    categoryId?: number | null;
  }): Promise<ProviderSummary[]>;
  listUserEventsVendorContext(userId: number): Promise<Record<string, unknown>[]>;
  createQuoteRequest(input: QuoteRequestInput): Promise<Record<string, unknown>>;
  addVendorToEventFavorites(input: FavoriteRequestInput): Promise<Record<string, unknown>>;
  createProviderReview(input: CreateProviderReviewInput): Promise<Record<string, unknown>>;
}
