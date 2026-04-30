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
