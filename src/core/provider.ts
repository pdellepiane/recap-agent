export type ProviderSummary = {
  id: number;
  title: string;
  slug?: string | null;
  category?: string | null;
  location?: string | null;
  priceLevel?: string | null;
  rating?: string | null;
  reason?: string | null;
  detailUrl?: string | null;
  websiteUrl?: string | null;
  minPrice?: string | null;
  maxPrice?: string | null;
  promoBadge?: string | null;
  promoSummary?: string | null;
  descriptionSnippet?: string | null;
  serviceHighlights: string[];
  termsHighlights: string[];
};

export type ProviderDetail = ProviderSummary & {
  description?: string | null;
  eventTypes: string[];
  raw: Record<string, unknown>;
};

export function normalizeProviderSummary(
  provider: Omit<ProviderSummary, 'serviceHighlights' | 'termsHighlights'> & {
    serviceHighlights?: string[] | null;
    termsHighlights?: string[] | null;
  },
): ProviderSummary {
  return {
    ...provider,
    serviceHighlights: provider.serviceHighlights ?? [],
    termsHighlights: provider.termsHighlights ?? [],
  };
}
