import type { ProviderDetail } from '../core/provider';

export type ProviderSyncConfig = {
  providerBaseUrl: string;
  outputDir: string;
  openAiApiKey: string;
  vectorStoreName: string;
  vectorStoreId: string | null;
};

export type ProviderArticleMetadata = {
  providerId: number;
  title: string;
  slug: string | null;
  category: string | null;
  city: string | null;
  country: string | null;
  location: string | null;
  priceLevel: string | null;
  detailUrl: string | null;
  sourceUrl: string | null;
};

export type FormattedProviderArticle = {
  metadata: ProviderArticleMetadata;
  markdown: string;
};

export type ProviderSyncRecord = ProviderDetail & {
  city: string | null;
  country: string | null;
};
