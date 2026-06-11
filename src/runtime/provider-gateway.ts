import type { PersistedPlan } from '../core/plan';
import type { ProviderCategory } from '../core/provider-category';
import type { ProviderDetail, ProviderSummary } from '../core/provider';
import type { ProviderFitCriteria } from './provider-fit';

export type ProviderGatewaySearchResult = {
  providers: ProviderSummary[];
};

export type ProviderSearchMode = 'api' | 'vector' | 'hybrid';

export type KeywordProviderSearchInput = {
  keyword: string;
  page?: number | null;
};

export type CategoryLocationProviderSearchInput = {
  category: ProviderCategory;
  location?: string | null;
  page?: number | null;
};

export type QueryIntentProviderSearchInput = {
  category: ProviderCategory;
  queryStrings: string[];
  location: string | null;
  fitCriteria: ProviderFitCriteria;
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
  userId?: number | null;
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

export type UserEventLookupInput =
  | {
      email: string;
      phone?: null;
    }
  | {
      email?: null;
      phone: string;
    };

export type UserEventRelation =
  | 'owner'
  | 'guest'
  | 'host'
  | 'celebrated'
  | 'order';

export type UserEventGuestStatus = {
  hasResponded: boolean | null;
  willAttend: boolean | null;
  hasCouple: boolean | null;
  responseDate: string | null;
};

export type UserEventOrderSummary = {
  id: number | null;
  incrementId: string | null;
  giftType: string | null;
  grandTotal: number | null;
  paymentStatus: string | null;
  shippingStatus: string | null;
  createdAt: string | null;
  paymentMethod: string | null;
};

export type UserEventSummary = {
  relation: UserEventRelation;
  eventId: number | null;
  slug: string | null;
  url: string | null;
  name: string | null;
  place: string | null;
  type: string | null;
  datetime: string | null;
  stage: string | null;
  isVisible: boolean | null;
  isPublic: boolean | null;
  currency: string | null;
  country: string | null;
  guestStatus: UserEventGuestStatus | null;
  hostType: string | null;
  hostPermission: string | null;
  hostStatus: string | null;
  celebratedType: string | null;
  amountCollected: number | null;
  amountTransferred: number | null;
  transactionsCount: number | null;
  invitedGuestCount: number | null;
  confirmedGuestCount: number | null;
  orders: UserEventOrderSummary[];
};

export type UserEventLookupResult = {
  lookup: UserEventLookupInput;
  user: {
    id: number | null;
    fullName: string | null;
    email: string | null;
    fullPhone: string | null;
  } | null;
  events: UserEventSummary[];
  counts: {
    ownerEvents: number;
    guestEvents: number;
    hostEvents: number;
    celebratedEvents: number;
    recentOrders: number;
  };
};

export type GuestLoginCodeRequestResult =
  | {
      status: 'sent';
    }
  | {
      status: 'email_not_found' | 'failed';
      error: string;
    };

export type GuestLoginCodeVerificationResult =
  | {
      status: 'authenticated';
      token: string;
      tokenExpiresAt: string;
    }
  | {
      status: 'invalid_code' | 'failed';
      error: string;
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
  searchProvidersByQueryIntent(
    input: QueryIntentProviderSearchInput,
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
  lookupUserEventContext(input: UserEventLookupInput): Promise<UserEventLookupResult | null>;
  requestGuestLoginCode(email: string): Promise<GuestLoginCodeRequestResult>;
  verifyGuestLoginCode(
    email: string,
    code: string,
  ): Promise<GuestLoginCodeVerificationResult>;
  lookupAuthenticatedGuest(token: string): Promise<UserEventLookupResult | null>;
  createQuoteRequest(input: QuoteRequestInput): Promise<Record<string, unknown>>;
  addVendorToEventFavorites(input: FavoriteRequestInput): Promise<Record<string, unknown>>;
  createProviderReview(input: CreateProviderReviewInput): Promise<Record<string, unknown>>;
}
