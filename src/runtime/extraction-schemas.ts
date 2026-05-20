import { z } from 'zod';

import { eventTypeSchema } from '../core/event-type';
import { planIntentValues } from '../core/plan';
import { providerCategorySchema } from '../core/provider-category';
import { providerNeedSubQuerySchema } from '../core/provider-sub-query';
import { closeActionSchema } from './close-flow-schemas';
import { providerFitCriteriaSchema } from './provider-fit';

export const providerReferenceSchema = z.object({
  providerId: z.number().int().positive().nullable(),
  providerTitle: z.string().min(1).nullable(),
  category: providerCategorySchema.nullable(),
  hint: z.string().min(1).nullable(),
});

export type ProviderReference = z.infer<typeof providerReferenceSchema>;

export const providerQueryIntentSchema = z.object({
  category: providerCategorySchema,
  label: z.string().min(1),
  priority: z.number().int().min(1),
  queryStrings: z.array(z.string().min(2)).min(1),
  subQueries: z.array(providerNeedSubQuerySchema).optional(),
  preferences: z.array(z.string()),
  hardConstraints: z.array(z.string()),
  missingFields: z.array(z.string()),
  retrievalReady: z.boolean(),
  fitCriteria: providerFitCriteriaSchema,
});

export type ProviderQueryIntent = z.infer<typeof providerQueryIntentSchema>;

export const providerPlanOperationSchema = z.object({
  type: z.enum([
    'add_need',
    'update_need',
    'delete_need',
    'select_provider',
    'unselect_provider',
    'replace_provider',
    'defer_need',
    'reactivate_need',
  ]),
  category: providerCategorySchema.nullable(),
  preferences: z.array(z.string()),
  hardConstraints: z.array(z.string()),
  queryIntent: providerQueryIntentSchema.nullable(),
  rerunSearch: z.boolean(),
  provider: providerReferenceSchema.nullable(),
  removeProvider: providerReferenceSchema.nullable(),
  addProvider: providerReferenceSchema.nullable(),
});

export type ProviderPlanOperation = z.infer<typeof providerPlanOperationSchema>;

export const planOperationSchema = z.object({
  providerOperations: z.array(providerPlanOperationSchema),
});

export type PlanOperation = z.infer<typeof planOperationSchema>;

export const providerExplanationRequestSchema = z.object({
  scope: z.enum(['single_need', 'all_needs']),
  primaryProvider: providerReferenceSchema,
  comparedProviders: z.array(providerReferenceSchema),
  category: providerCategorySchema.nullable(),
  categories: z.array(providerCategorySchema),
  question: z.string().min(1),
});

export type ProviderExplanationRequest = z.infer<typeof providerExplanationRequestSchema>;

export const providerDetailRequestSchema = z.object({
  provider: providerReferenceSchema,
  category: providerCategorySchema.nullable(),
  requestedDepth: z.enum(['summary', 'full']),
});

export type ProviderDetailRequest = z.infer<typeof providerDetailRequestSchema>;

export const extractionSchema = z.object({
  intent: z.enum(planIntentValues).nullable(),
  secondaryIntents: z.array(z.enum(planIntentValues)).default([]),
  kbQuery: z.string().nullable().optional(),
  intentConfidence: z.number().min(0).max(1).nullable(),
  eventType: eventTypeSchema.nullable(),
  vendorCategory: providerCategorySchema.nullable(),
  vendorCategories: z.array(providerCategorySchema),
  activeNeedCategory: providerCategorySchema.nullable(),
  location: z.string().nullable(),
  budgetSignal: z.string().nullable(),
  guestRange: z.enum(['1-20', '21-50', '51-100', '101-200', '201+', 'unknown']).nullable(),
  preferences: z.array(z.string()),
  hardConstraints: z.array(z.string()),
  assumptions: z.array(z.string()),
  conversationSummary: z.string(),
  selectedProviderHints: z.array(z.string()).default([]),
  selectedProviderReferences: z.array(providerReferenceSchema).default([]),
  closeAction: closeActionSchema.nullable().default(null),
  pauseRequested: z.boolean(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  providerFitCriteria: providerFitCriteriaSchema,
  providerQueryIntents: z.array(providerQueryIntentSchema).default([]),
  providerPlanOperations: z.array(providerPlanOperationSchema).default([]),
  providerExplanationRequest: providerExplanationRequestSchema.nullable().default(null),
  providerDetailRequest: providerDetailRequestSchema.nullable().default(null),
});

export type StructuredExtraction = z.infer<typeof extractionSchema>;
