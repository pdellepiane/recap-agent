import { z } from 'zod';

import { providerCategorySchema } from '../core/provider-category';

export const closeActionSchema = z.object({
  type: z.enum([
    'confirm_close',
    'defer_need',
    'request_contact',
    'abandon_plan',
    'clarify',
  ]),
  category: providerCategorySchema.nullable().default(null),
  reason: z.string().min(1).nullable().default(null),
}).superRefine((action, context) => {
  if (action.type === 'defer_need' && action.category === null) {
    context.addIssue({
      code: 'custom',
      path: ['category'],
      message: 'category is required when type is defer_need',
    });
  }
  if (action.type !== 'defer_need' && action.category !== null) {
    context.addIssue({
      code: 'custom',
      path: ['category'],
      message: 'category must be null unless type is defer_need',
    });
  }
  if (action.type === 'clarify' && action.reason === null) {
    context.addIssue({
      code: 'custom',
      path: ['reason'],
      message: 'reason is required when type is clarify',
    });
  }
  if (action.type !== 'clarify' && action.reason !== null) {
    context.addIssue({
      code: 'custom',
      path: ['reason'],
      message: 'reason must be null unless type is clarify',
    });
  }
});

export type CloseAction = z.input<typeof closeActionSchema>;

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
