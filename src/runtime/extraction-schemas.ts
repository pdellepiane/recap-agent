import { z } from 'zod';

import { eventTypeSchema } from '../core/event-type';
import { actionIntentValues, type ActionIntent } from '../core/plan';
import { providerCategorySchema } from '../core/provider-category';
import { providerNeedSubQuerySchema } from '../core/provider-sub-query';
import { closeActionSchema } from './close-flow-schemas';
import { providerFitCriteriaSchema } from './provider-fit';
import {
  purchaseAspectValues,
  purchaseAuthActionValues,
  purchaseResourceValues,
  sensitivePurchaseFieldValues,
} from '../core/information';

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
  queries: z.array(providerNeedSubQuerySchema).min(1).max(3),
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

export const ambiguityEvidenceSchema = z.object({
  status: z.enum(['clear', 'ambiguous']),
  clarificationQuestion: z.string().nullable(),
  interpretations: z.array(z.string()).max(3),
});

export const openAiInformationRequestSchema = z.object({
  kind: z.enum(['faq', 'associated_event', 'purchase']),
  query: z.string().min(1),
  eventHint: z.string().nullable(),
  resource: z.enum(purchaseResourceValues).nullable(),
  orderId: z.string().nullable(),
  aspects: z.array(z.enum(purchaseAspectValues)),
  sensitiveFields: z.array(z.enum(sensitivePurchaseFieldValues)),
  authAction: z.enum(purchaseAuthActionValues).nullable(),
});

export type OpenAiInformationRequest = z.infer<
  typeof openAiInformationRequestSchema
>;

export const extractionSchema = z.object({
  actionIntent: z.enum(actionIntentValues).nullable(),
  informationRequests: z.array(openAiInformationRequestSchema).default([]),
  intentConfidence: z.number().min(0).max(1).nullable(),
  ambiguity: ambiguityEvidenceSchema,
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

export type ExtractionCapabilityProfile = {
  information: boolean;
  providerPlanning: boolean;
  providerOperations: boolean;
  providerSelection: boolean;
  providerInspection: boolean;
  contact: boolean;
  close: boolean;
  pause: boolean;
};

export function createDynamicExtractionSchema(args: {
  allowedActionIntents: readonly ActionIntent[];
  capabilities: ExtractionCapabilityProfile;
}) {
  const allowedActionIntents = args.allowedActionIntents as readonly [
    ActionIntent,
    ...ActionIntent[],
  ];

  return z.object({
    actionIntent: z.enum(allowedActionIntents).nullable(),
    intentConfidence: extractionSchema.shape.intentConfidence,
    ambiguity: extractionSchema.shape.ambiguity,
    assumptions: extractionSchema.shape.assumptions,
    conversationSummary: extractionSchema.shape.conversationSummary,
    ...(args.capabilities.information
      ? { informationRequests: extractionSchema.shape.informationRequests }
      : {}),
    ...(args.capabilities.providerPlanning
      ? {
          eventType: extractionSchema.shape.eventType,
          vendorCategory: extractionSchema.shape.vendorCategory,
          vendorCategories: extractionSchema.shape.vendorCategories,
          activeNeedCategory: extractionSchema.shape.activeNeedCategory,
          location: extractionSchema.shape.location,
          budgetSignal: extractionSchema.shape.budgetSignal,
          guestRange: extractionSchema.shape.guestRange,
          preferences: extractionSchema.shape.preferences,
          hardConstraints: extractionSchema.shape.hardConstraints,
          providerFitCriteria: extractionSchema.shape.providerFitCriteria,
          providerQueryIntents: extractionSchema.shape.providerQueryIntents,
        }
      : {}),
    ...(args.capabilities.providerOperations
      ? { providerPlanOperations: extractionSchema.shape.providerPlanOperations }
      : {}),
    ...(args.capabilities.providerSelection
      ? {
          selectedProviderHints: extractionSchema.shape.selectedProviderHints,
          selectedProviderReferences: extractionSchema.shape.selectedProviderReferences,
        }
      : {}),
    ...(args.capabilities.providerInspection
      ? {
          providerExplanationRequest: extractionSchema.shape.providerExplanationRequest,
          providerDetailRequest: extractionSchema.shape.providerDetailRequest,
        }
      : {}),
    ...(args.capabilities.contact
      ? {
          contactName: extractionSchema.shape.contactName,
          contactEmail: extractionSchema.shape.contactEmail,
          contactPhone: extractionSchema.shape.contactPhone,
        }
      : {}),
    ...(args.capabilities.close
      ? { closeAction: extractionSchema.shape.closeAction }
      : {}),
    ...(args.capabilities.pause
      ? { pauseRequested: extractionSchema.shape.pauseRequested }
      : {}),
  });
}
