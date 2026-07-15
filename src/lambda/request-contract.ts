import { z } from 'zod';

import { parseInternationalPhone } from '../runtime/phone';

const whatsAppChannels = new Set(['whatsapp', 'whatsapp_sandbox']);

export const channelRequestSchema = z.object({
  operation: z.literal('process_message'),
  text: z.string().trim().min(1),
  user_id: z.string().trim().min(1),
  channel: z.string().trim().min(1),
  message_id: z.string().trim().min(1).optional(),
  received_at: z.string().datetime({ offset: true }).optional(),
  session_id: z.string().trim().min(1).nullable().optional(),
  client_mode: z.enum(['cli', 'channel']).optional(),
  contact_phone: z.string().trim().min(1).nullable().optional(),
}).superRefine((value, context) => {
  if (whatsAppChannels.has(value.channel) && !value.contact_phone) {
    context.addIssue({
      code: 'custom',
      path: ['contact_phone'],
      message: 'contact_phone is required for WhatsApp channels.',
    });
    return;
  }
  if (value.contact_phone && parseInternationalPhone(value.contact_phone).status === 'invalid') {
    context.addIssue({
      code: 'custom',
      path: ['contact_phone'],
      message: 'contact_phone must be a supported international number such as +51999999999.',
    });
  }
});

export type ChannelRequestBody = z.infer<typeof channelRequestSchema>;

export const resumeAutomatedAgentRequestSchema = z.object({
  operation: z.literal('resume_automated_agent'),
  channel: z.string().trim().min(1),
  user_id: z.string().trim().min(1),
  request_id: z.string().trim().min(1),
  requested_at: z.string().datetime({ offset: true }).optional(),
});

export type ResumeAutomatedAgentRequestBody = z.infer<
  typeof resumeAutomatedAgentRequestSchema
>;
