import { z } from 'zod';

import { providerCategorySchema } from '../core/provider-category';

export const providerRecommendationSchema = z.object({
  provider_id: z.number(),
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
    'contact_request',
    'close_confirmation',
    'close_result',
    'generic',
  ]),
  greeting_es: z.string().optional(),
  ask_es: z.string().optional(),
  requested_fields_es: z.array(z.string()).optional(),
  intro_es: z.string().optional(),
  providers: z.array(providerRecommendationSchema).optional(),
  needs: z.array(providerNeedRecommendationSchema).optional(),
  next_step_es: z.string().optional(),
  summary_es: z.string().optional(),
  selected_providers_es: z.array(z.string()).optional(),
  unselected_needs_es: z.array(z.string()).optional(),
  success_es: z.string().optional(),
  contact_explanation_es: z.string().optional(),
  paragraphs_es: z.array(z.string()).optional(),
});

export type StructuredMessage = z.infer<typeof structuredMessageSchema>;

export type MessageType = StructuredMessage['type'];

export const welcomeMessageSchema = z.object({
  type: z.literal('welcome'),
  greeting_es: z.string(),
  ask_es: z.string(),
  requested_fields_es: z.array(z.string()),
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

export const contactRequestMessageSchema = z.object({
  type: z.literal('contact_request'),
  intro_es: z.string(),
  requested_fields_es: z.array(z.string()),
});

export const closeConfirmationMessageSchema = z.object({
  type: z.literal('close_confirmation'),
  summary_es: z.string(),
  selected_providers_es: z.array(z.string()),
  unselected_needs_es: z.array(z.string()),
});

export const closeResultMessageSchema = z.object({
  type: z.literal('close_result'),
  success_es: z.string(),
  contact_explanation_es: z.string(),
});

export const genericMessageSchema = z.object({
  type: z.literal('generic'),
  paragraphs_es: z.array(z.string()),
});

export type WelcomeMessage = z.infer<typeof welcomeMessageSchema>;
export type RecommendationMessage = z.infer<typeof recommendationMessageSchema>;
export type MultiNeedRecommendationMessage = z.infer<typeof multiNeedRecommendationMessageSchema>;
export type ContactRequestMessage = z.infer<typeof contactRequestMessageSchema>;
export type CloseConfirmationMessage = z.infer<typeof closeConfirmationMessageSchema>;
export type CloseResultMessage = z.infer<typeof closeResultMessageSchema>;
export type GenericMessage = z.infer<typeof genericMessageSchema>;
