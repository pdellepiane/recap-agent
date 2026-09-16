import { z } from 'zod';

import { providerCategorySchema } from '../core/provider-category';

export const closeActionWireSchema = z.object({
  type: z.enum([
    'confirm_close',
    'proceed_confirmed',
    'defer_need',
    'request_contact',
    'abandon_plan',
    'clarify',
  ]),
  category: providerCategorySchema.nullable().default(null),
  reason: z.string().min(1).nullable().default(null),
});

export const closeActionSchema = closeActionWireSchema.superRefine((action, context) => {
  if (action.type === 'defer_need' && action.category === null) {
    context.addIssue({
      code: 'custom',
      path: ['category'],
      message: 'category is required when type is defer_need',
    });
  }
  if (action.type === 'clarify' && action.reason === null) {
    context.addIssue({
      code: 'custom',
      path: ['reason'],
      message: 'reason is required when type is clarify',
    });
  }
});

export type CloseAction = z.input<typeof closeActionSchema>;

/**
 * Shared close-flow 500 repair (live_feedback.token_seeded_close_flow,
 * run a5f25bd5: final output failed schema validation at
 * "closeAction.reason", reason required when type is clarify).
 *
 * A clarify without reason (or defer_need without category) carries no
 * actionable content, so the caller normalizes it to null instead of
 * letting the void action poison structured output validation and turn
 * the whole turn into an HTTP 500. Fully specified actions pass through
 * untouched; every other schema violation still throws at parse. Applied
 * at the extraction normalization boundary in openai-agent-runtime.
 */
export function repairVoidCloseAction(
  action: CloseAction | null | undefined,
): CloseAction | null {
  if (action == null) return null;
  if (action.type === 'clarify' && (action.reason == null || action.reason.length === 0)) {
    return null;
  }
  if (action.type === 'defer_need' && action.category == null) {
    return null;
  }
  return action;
}

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
