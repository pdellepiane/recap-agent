import { z } from 'zod';

import { priceLevelSchema } from './price-level';
import { providerCategorySchema } from './provider-category';

export const providerSummarySchema = z.object({
  id: z.number(),
  title: z.string(),
  slug: z.string().nullish(),
  category: providerCategorySchema.nullish(),
  location: z.string().nullish(),
  priceLevel: priceLevelSchema.nullish(),
  rating: z.string().nullish(),
  reason: z.string().nullish(),
  detailUrl: z.string().nullish(),
  websiteUrl: z.string().nullish(),
  minPrice: z.string().nullish(),
  maxPrice: z.string().nullish(),
  promoBadge: z.string().nullish(),
  promoSummary: z.string().nullish(),
  descriptionSnippet: z.string().nullish(),
  serviceHighlights: z.array(z.string()).default([]),
  termsHighlights: z.array(z.string()).default([]),
  providerNotes: z.array(z.string()).optional(),
  eventTypes: z.array(z.string()).optional(),
  description: z.string().nullish(),
  fitScore: z.number().min(0).max(100).nullish(),
  fitWarnings: z.array(z.string()).optional(),
  fitTags: z.array(z.string()).optional(),
  retrievalScore: z.number().nullish(),
  retrievalSource: z.enum(['api', 'vector', 'hybrid']).nullish(),
});

export type ProviderSummary = z.infer<typeof providerSummarySchema>;

export type ProviderDetail = ProviderSummary & {
  description?: string | null;
  eventTypes: string[];
  raw: Record<string, unknown>;
};

export function normalizeProviderSummary(
  provider: Omit<ProviderSummary, 'serviceHighlights' | 'termsHighlights' | 'providerNotes'> & {
    serviceHighlights?: string[] | null;
    termsHighlights?: string[] | null;
    providerNotes?: string[] | null;
  },
): ProviderSummary {
  return providerSummarySchema.parse({
    ...provider,
    serviceHighlights: provider.serviceHighlights ?? [],
    termsHighlights: provider.termsHighlights ?? [],
    providerNotes: provider.providerNotes ?? [],
  });
}
