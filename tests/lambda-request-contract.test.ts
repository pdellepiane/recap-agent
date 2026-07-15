import { describe, expect, it } from 'vitest';

import {
  agentParticipationRequestSchema,
  channelRequestSchema,
} from '../src/lambda/request-contract';

describe('Lambda channel request contract', () => {
  it('accepts WhatsApp requests with explicit international phone context', () => {
    const result = channelRequestSchema.safeParse({
      text: 'Necesito catering',
      user_id: 'whatsapp:51999999999',
      channel: 'whatsapp',
      contact_phone: '+51999999999',
      message_id: 'wamid.123',
      received_at: '2026-07-14T15:00:00.000Z',
      client_mode: 'channel',
    });
    expect(result.success).toBe(true);
  });

  it('rejects WhatsApp requests without phone context', () => {
    const result = channelRequestSchema.safeParse({
      text: 'Necesito catering',
      user_id: 'whatsapp:51999999999',
      channel: 'whatsapp',
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed phone context instead of silently dropping it', () => {
    const result = channelRequestSchema.safeParse({
      text: 'Necesito catering',
      user_id: 'whatsapp:51999999999',
      channel: 'whatsapp',
      contact_phone: '999999999',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a conversation ownership request', () => {
    const result = agentParticipationRequestSchema.safeParse({
      channel: 'whatsapp',
      user_id: 'whatsapp:51999999999',
      request_id: 'ownership-request-123',
      requested_at: '2026-07-15T20:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a conversation ownership request without correlation identity', () => {
    const result = agentParticipationRequestSchema.safeParse({
      channel: 'whatsapp',
      user_id: 'whatsapp:51999999999',
    });
    expect(result.success).toBe(false);
  });
});
