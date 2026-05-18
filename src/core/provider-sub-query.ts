import { z } from 'zod';

import { providerSummarySchema } from './provider';
import { providerCategorySchema } from './provider-category';

export const providerNeedSubQuerySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  category: providerCategorySchema,
  queryStrings: z.array(z.string().min(2)).min(1),
  mustHave: z.array(z.string()),
  shouldAvoid: z.array(z.string()),
  maxSelections: z.number().int().min(1).max(3),
  allowCrossCategory: z.boolean(),
});

export type ProviderNeedSubQuery = z.infer<typeof providerNeedSubQuerySchema>;

export const providerSubQueryCandidateSchema = providerSummarySchema.extend({
  retrievalScore: z.number().nullish(),
  fitScore: z.number().min(0).max(100).nullish(),
  fitTags: z.array(z.string()).default([]),
  fitWarnings: z.array(z.string()).default([]),
});

export type ProviderSubQueryCandidate = z.infer<typeof providerSubQueryCandidateSchema>;

export const providerSubQueryResultSchema = z.object({
  subQuery: providerNeedSubQuerySchema,
  candidate_provider_ids: z.array(z.number()),
  selected_provider_ids: z.array(z.number()),
  candidates: z.array(providerSubQueryCandidateSchema),
  no_match_reason: z.string().nullable(),
});

export type ProviderSubQueryResult = z.infer<typeof providerSubQueryResultSchema>;
