import { z } from 'zod';

import { providerCategorySchema } from '../core/provider-category';

export const closeActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('confirm_close'),
  }),
  z.object({
    type: z.literal('defer_need'),
    category: providerCategorySchema,
  }),
  z.object({
    type: z.literal('request_contact'),
  }),
  z.object({
    type: z.literal('abandon_plan'),
  }),
  z.object({
    type: z.literal('clarify'),
    reason: z.string().min(1),
  }),
]);

export type CloseAction = z.infer<typeof closeActionSchema>;

const contactedProviderSchema = z.object({
  providerId: z.number().int().positive(),
  category: providerCategorySchema,
  success: z.boolean(),
  error: z.string().min(1).optional(),
});

export const closeFlowResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('success'),
    contactedProviders: z.array(contactedProviderSchema).min(1),
  }),
  z.object({
    status: z.literal('partial'),
    contactedProviders: z.array(contactedProviderSchema).min(1),
  }),
  z.object({
    status: z.literal('missing_contact'),
    missingFields: z.array(z.enum(['full_name', 'email', 'phone'])).min(1),
  }),
  z.object({
    status: z.literal('no_selected_providers'),
  }),
  z.object({
    status: z.literal('invalid_contact'),
    field: z.enum(['email', 'phone']),
    reason: z.string().min(1),
  }),
  z.object({
    status: z.literal('needs_clarification'),
    reason: z.string().min(1),
  }),
]);

export type CloseFlowResult = z.infer<typeof closeFlowResultSchema>;
