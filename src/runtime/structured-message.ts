import { z } from 'zod';

import { providerCategorySchema } from '../core/provider-category';

export const providerRecommendationSchema = z.object({
  provider_id: z.number(),
  match_label_es: z.string().min(1).nullable().optional(),
  rationale_es: z.string(),
  caveat_es: z.string().nullable(),
});

export type ProviderRecommendation = z.infer<typeof providerRecommendationSchema>;

export const providerNeedRecommendationSchema = z.object({
  category: providerCategorySchema,
  summary_es: z.string(),
  providers: z.array(providerRecommendationSchema).min(1),
});

export type ProviderNeedRecommendation = z.infer<typeof providerNeedRecommendationSchema>;

export const structuredMessageSchema = z.object({
  type: z.enum([
    'welcome',
    'recommendation',
    'multi_need_recommendation',
    'generic',
  ]),
  greeting_es: z.string().optional(),
  scope_es: z.string().optional(),
  ask_es: z.string().optional(),
  intro_es: z.string().optional(),
  providers: z.array(providerRecommendationSchema).optional(),
  needs: z.array(providerNeedRecommendationSchema).optional(),
  next_step_es: z.string().optional(),
  paragraphs_es: z.array(z.string()).optional(),
});

export type StructuredMessage = z.infer<typeof structuredMessageSchema>;

export type MessageType = StructuredMessage['type'];

export const pendingTaskOutcomeValues = [
  'answered',
  'needs_input',
  'unchanged',
] as const;

export type PendingTaskOutcome = (typeof pendingTaskOutcomeValues)[number];

export const pendingTaskOutcomeSchema = z.enum(pendingTaskOutcomeValues);

export const welcomeMessageSchema = z.object({
  type: z.literal('welcome'),
  greeting_es: z.string().min(1).max(90),
  scope_es: z.string().min(1).max(140),
  ask_es: z.string().min(1).max(80),
});

export const recommendationMessageSchema = z.object({
  type: z.literal('recommendation'),
  intro_es: z.string(),
  providers: z.array(providerRecommendationSchema),
});

export const multiNeedRecommendationMessageSchema = z.object({
  type: z.literal('multi_need_recommendation'),
  intro_es: z.string(),
  needs: z.array(providerNeedRecommendationSchema).min(1),
  next_step_es: z.string(),
});

export const genericMessageSchema = z.object({
  type: z.literal('generic'),
  paragraphs_es: z.array(z.string()),
});

export type WelcomeMessage = z.infer<typeof welcomeMessageSchema>;
export type RecommendationMessage = z.infer<typeof recommendationMessageSchema>;
export type MultiNeedRecommendationMessage = z.infer<typeof multiNeedRecommendationMessageSchema>;
export type GenericMessage = z.infer<typeof genericMessageSchema>;
