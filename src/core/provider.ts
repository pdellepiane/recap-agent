export type ProviderSummary = {
  id: number;
  title: string;
  slug?: string | null;
  category?: string | null;
  location?: string | null;
  priceLevel?: string | null;
  rating?: string | null;
  reason?: string | null;
};

export type ProviderDetail = ProviderSummary & {
  description?: string | null;
  eventTypes: string[];
  raw: Record<string, unknown>;
};
