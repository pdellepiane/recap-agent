import { z } from 'zod';

import { inboundMediaKindValues } from '../core/messages';
import { parseInternationalPhone } from '../runtime/phone';

const whatsAppChannels = new Set(['whatsapp', 'whatsapp_sandbox']);
const internetMediaTypePattern =
  /^[a-z0-9!#$%&'*+\-.^_`|~]+\/[a-z0-9!#$%&'*+\-.^_`|~]+$/iu;

const inboundMediaSchema = z.object({
  type: z.enum(inboundMediaKindValues),
  id: z.string().trim().min(1).max(512),
  mime_type: z.string().trim().min(1).max(128).regex(internetMediaTypePattern),
  sha256: z.string().trim().regex(/^[a-f0-9]{64}$/iu),
  filename: z.string().trim().min(1).max(255).nullable().optional(),
}).strict().superRefine((value, context) => {
  const topLevelType = value.mime_type.split('/', 1)[0]?.toLowerCase();
  const expectedTopLevelTypes = value.type === 'sticker'
    ? ['image']
    : value.type === 'document'
      ? ['application', 'text']
      : [value.type];
  if (!topLevelType || !expectedTopLevelTypes.includes(topLevelType)) {
    context.addIssue({
      code: 'custom',
      path: ['mime_type'],
      message: `mime_type must use a supported top-level media type for ${value.type}.`,
    });
  }
});

export const channelRequestSchema = z.object({
  text: z.string().trim().max(16_000).optional().default(''),
  media: z.array(inboundMediaSchema).max(10).optional().default([]),
  user_id: z.string().trim().min(1),
  channel: z.string().trim().min(1),
  message_id: z.string().trim().min(1).optional(),
  received_at: z.string().datetime({ offset: true }).optional(),
  session_id: z.string().trim().min(1).nullable().optional(),
  client_mode: z.enum(['cli', 'channel']).optional(),
  contact_phone: z.string().trim().min(1).nullable().optional(),
}).superRefine((value, context) => {
  if (!value.text && value.media.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['text'],
      message: 'A non-empty text or at least one media item is required.',
    });
  }
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

export const agentParticipationRequestSchema = z.object({
  channel: z.string().trim().min(1),
  user_id: z.string().trim().min(1),
  request_id: z.string().trim().min(1),
  requested_at: z.string().datetime({ offset: true }).optional(),
});

export type AgentParticipationRequestBody = z.infer<typeof agentParticipationRequestSchema>;
