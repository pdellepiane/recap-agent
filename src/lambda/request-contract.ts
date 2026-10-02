import { z } from 'zod';

import { inboundMediaKindValues } from '../core/messages';
import { inboundImageSchema } from '../core/inbound-image';
import { parseInternationalPhone, type PhoneParseResult } from '../runtime/phone';

type InvalidPhoneReason = Extract<PhoneParseResult, { status: 'invalid' }>['reason'];

function contactPhoneIssueMessage(reason: InvalidPhoneReason): string {
  switch (reason) {
    case 'missing_country_code':
      return 'contact_phone must include the international prefix, e.g. +51999999999.';
    case 'unsupported_country_code':
      return 'contact_phone uses an unassigned country code; send canonical E.164 from the verified WhatsApp sender.';
    case 'invalid_length':
      return 'contact_phone has an invalid length for its country code.';
    case 'invalid_characters':
      return 'contact_phone contains invalid characters; send canonical E.164 digits.';
    case 'empty':
      return 'contact_phone is required for WhatsApp channels.';
  }
}

const whatsAppChannels = new Set(['whatsapp', 'whatsapp_sandbox']);
// The channel is the first component of the persisted channel#user partition key.
const channelSchema = z.string().trim().min(1).refine(
  (value) => !value.includes('#'),
  'channel must not contain the storage key separator #.',
);
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

/**
 * S1 development-only evaluation marker. The wire carries the fixture
 * scenario plus the required evaluation identity (runId/caseId); the
 * conversation scope is derived by the handler from the existing
 * channel/user_id, never from this marker. This is not a production
 * message-package contract: every marker is rejected in production, and
 * incomplete evaluation identities are rejected in development fixture
 * execution (see handler getFixtureRuntime).
 */
export const backendFixtureSchema = z.object({
  scenario: z.string().trim().min(1).max(128),
  runId: z.string().trim().min(1).max(128),
  caseId: z.string().trim().min(1).max(256),
}).strict();

export const channelRequestSchema = z.object({
  text: z.string().trim().max(16_000).nullish().transform((value) => value ?? ''),
  image: inboundImageSchema.optional(),
  media: z.array(inboundMediaSchema).max(10).optional().default([]),
  user_id: z.string().trim().min(1),
  channel: channelSchema,
  message_id: z.string().trim().min(1).optional(),
  received_at: z.string().datetime({ offset: true }).optional(),
  session_id: z.string().trim().min(1).nullable().optional(),
  client_mode: z.enum(['cli', 'channel']).optional(),
  contact_phone: z.string().trim().min(1).nullable().optional(),
  backendFixture: backendFixtureSchema.optional(),
}).superRefine((value, context) => {
  if (!value.text && value.media.length === 0 && !value.image) {
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
  if (value.contact_phone) {
    const phoneParse = parseInternationalPhone(value.contact_phone);
    if (phoneParse.status === 'invalid') {
      context.addIssue({
        code: 'custom',
        path: ['contact_phone'],
        message: contactPhoneIssueMessage(phoneParse.reason),
      });
    }
  }
});

export type ChannelRequestBody = z.infer<typeof channelRequestSchema>;

export const agentParticipationRequestSchema = z.object({
  channel: channelSchema,
  user_id: z.string().trim().min(1),
  request_id: z.string().trim().min(1),
  requested_at: z.string().datetime({ offset: true }).optional(),
});

export type AgentParticipationRequestBody = z.infer<typeof agentParticipationRequestSchema>;
