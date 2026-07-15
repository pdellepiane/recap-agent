import { describe, expect, it } from 'vitest';

import {
  channelRequestSchema,
  resumeAutomatedAgentRequestSchema,
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

  it('accepts an explicit CRM request to resume the automated agent', () => {
    const result = resumeAutomatedAgentRequestSchema.safeParse({
      operation: 'resume_automated_agent',
      channel: 'whatsapp',
      user_id: 'whatsapp:51999999999',
      request_id: 'crm-resume-123',
      requested_at: '2026-07-15T20:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown CRM operations', () => {
    const result = resumeAutomatedAgentRequestSchema.safeParse({
      operation: 'enable_bot_later',
      channel: 'whatsapp',
      user_id: 'whatsapp:51999999999',
      request_id: 'crm-resume-123',
    });
    expect(result.success).toBe(false);
  });
});
