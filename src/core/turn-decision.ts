import { z } from 'zod';

import { decisionNodeSchema } from './decision-nodes';
import { providerCategorySchema } from './provider-category';

export const needSufficiencySchema = z.object({
  category: providerCategorySchema,
  searchReady: z.boolean(),
  missingFields: z.array(z.string()),
  hasShortlist: z.boolean(),
  hasSelection: z.boolean(),
});

export type NeedSufficiency = z.infer<typeof needSufficiencySchema>;

export const sessionFocusSchema = z.object({
  sessionId: z.string().min(1),
  activeNeedCategory: providerCategorySchema.nullable(),
  lastPresentedCategories: z.array(providerCategorySchema),
  lastPresentedProviderIds: z.array(z.number().int().positive()),
  lastNode: decisionNodeSchema.nullable(),
  updatedAt: z.string(),
});

export type SessionFocus = z.infer<typeof sessionFocusSchema>;

export const decisionEvidenceSchema = z.object({
  previousNode: decisionNodeSchema,
  extractionIntent: z.string().nullable(),
  explicitNeedCategoryCount: z.number().int().min(0),
  extractionProviderQueryIntentCount: z.number().int().min(0),
  extractionProviderPlanOperationCount: z.number().int().min(0),
  broadProviderMenuRequested: z.boolean(),
  planBeforeNode: decisionNodeSchema,
  planAfterNode: decisionNodeSchema,
  providerNeedCount: z.number().int().min(0),
  readyNeedCategories: z.array(providerCategorySchema),
  focusedNeedCategory: providerCategorySchema.nullable(),
  sessionFocus: sessionFocusSchema.nullable(),
  globalMissingFields: z.array(z.string()),
  sufficiencyByNeed: z.array(needSufficiencySchema),
  hasResolvedSelection: z.boolean(),
  hasAmbiguousSelection: z.boolean(),
  hasExistingShortlist: z.boolean(),
  hasReplaceProviderOperation: z.boolean(),
});

export type DecisionEvidence = z.infer<typeof decisionEvidenceSchema>;

export const routeKindValues = [
  'ask_event_context',
  'clarify_missing_fields',
  'single_need_search',
  'multi_need_search',
  'present_existing_shortlist',
  'apply_selection',
  'modify_plan',
  'faq',
  'invited_event_lookup',
  'close',
  'pause',
  'human_help_offer',
  'human_escalation',
  'error',
] as const;

export type RouteKind = (typeof routeKindValues)[number];

export const providerSearchModeValues = [
  'none',
  'single_need_from_plan',
  'multi_need_query_intents',
  'existing_shortlist',
] as const;

export type ProviderSearchMode = (typeof providerSearchModeValues)[number];

export const presentationScopeValues = [
  'none',
  'single_need',
  'multi_need',
  'clarification',
  'close',
  'faq',
  'invited_event_lookup',
  'human_help_offer',
  'human_escalation',
] as const;

export type PresentationScope = (typeof presentationScopeValues)[number];

export const turnDecisionSchema = z.object({
  nextNode: decisionNodeSchema,
  routeKind: z.enum(routeKindValues),
  providerSearchMode: z.enum(providerSearchModeValues),
  presentationScope: z.enum(presentationScopeValues),
  focusNeedCategory: providerCategorySchema.nullable(),
  needsToSearch: z.array(providerCategorySchema),
  needsToPresent: z.array(providerCategorySchema),
  stopReason: z.string().nullable(),
  persistReason: z.string().min(1),
  invariantStatus: z.enum(['valid', 'invalid']),
  invariantViolations: z.array(z.string()),
});

export type TurnDecision = z.infer<typeof turnDecisionSchema>;
