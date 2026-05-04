import { z } from 'zod';

export const structuredActionTypeSchema = z.enum([
  'select_provider',
  'adjust_criteria',
  'switch_need',
  'close_plan',
  'pause',
  'answer_question',
  'provide_contact',
  'confirm',
  'decline',
  'confirm_close_partial',
]);

export type StructuredActionType = z.infer<typeof structuredActionTypeSchema>;

export const structuredActionSchema = z.object({
  type: structuredActionTypeSchema,
  label_es: z.string(),
});

export type StructuredAction = z.infer<typeof structuredActionSchema>;

export const providerRecommendationSchema = z.object({
  provider_id: z.number(),
  rationale_es: z.string(),
  caveat_es: z.string().nullable(),
});

export type ProviderRecommendation = z.infer<typeof providerRecommendationSchema>;

export const structuredMessageSchema = z.object({
  type: z.enum([
    'welcome',
    'recommendation',
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
  actions: z.array(structuredActionSchema).default([]),
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
  actions: z.array(structuredActionSchema).max(0),
});

export const recommendationMessageSchema = z.object({
  type: z.literal('recommendation'),
  intro_es: z.string(),
  providers: z.array(providerRecommendationSchema),
  actions: z.array(structuredActionSchema),
});

export const contactRequestMessageSchema = z.object({
  type: z.literal('contact_request'),
  intro_es: z.string(),
  requested_fields_es: z.array(z.string()),
  actions: z.array(structuredActionSchema).max(0),
});

export const closeConfirmationMessageSchema = z.object({
  type: z.literal('close_confirmation'),
  summary_es: z.string(),
  selected_providers_es: z.array(z.string()),
  unselected_needs_es: z.array(z.string()),
  actions: z.array(structuredActionSchema),
});

export const closeResultMessageSchema = z.object({
  type: z.literal('close_result'),
  success_es: z.string(),
  contact_explanation_es: z.string(),
  actions: z.array(structuredActionSchema).max(0),
});

export const genericMessageSchema = z.object({
  type: z.literal('generic'),
  actions: z.array(structuredActionSchema).max(0),
  paragraphs_es: z.array(z.string()),
});

export type WelcomeMessage = z.infer<typeof welcomeMessageSchema>;
export type RecommendationMessage = z.infer<typeof recommendationMessageSchema>;
export type ContactRequestMessage = z.infer<typeof contactRequestMessageSchema>;
export type CloseConfirmationMessage = z.infer<typeof closeConfirmationMessageSchema>;
export type CloseResultMessage = z.infer<typeof closeResultMessageSchema>;
export type GenericMessage = z.infer<typeof genericMessageSchema>;
