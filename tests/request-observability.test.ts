import { describe, expect, it } from 'vitest';

import { buildChannelRequestLog } from '../src/lambda/request-observability';

describe('Lambda channel request observability', () => {
  it('records the rejection reason without exposing message or user identifiers', () => {
    const record = buildChannelRequestLog({
      requestId: 'request-1',
      method: 'POST',
      statusCode: 400,
      outcome: 'invalid_request',
      durationMs: 12.7,
      authorizationHeaderPresent: true,
      bearerTokenPresent: true,
      channel: 'whatsapp',
      externalUserId: 'whatsapp:51991347878',
      messageId: 'wamid.secret-value',
      validationIssues: [
        {
          path: 'contact_phone',
          code: 'custom',
          message: 'contact_phone is required for WhatsApp channels.',
        },
      ],
    });

    expect(record).toMatchObject({
      event: 'channel_request_completed',
      status_code: 400,
      outcome: 'invalid_request',
      duration_ms: 13,
      authorization_header_present: true,
      bearer_token_present: true,
      channel: 'whatsapp',
      validation_issues: [
        {
          path: 'contact_phone',
          code: 'custom',
        },
      ],
    });
    expect(record.external_user_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(record.message_id_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(record)).not.toContain('51991347878');
    expect(JSON.stringify(record)).not.toContain('wamid.secret-value');
  });

  it('redacts sensitive values from unexpected error messages', () => {
    const record = buildChannelRequestLog({
      requestId: 'request-2',
      method: 'POST',
      statusCode: 500,
      outcome: 'internal_error',
      durationMs: 9,
      authorizationHeaderPresent: true,
      bearerTokenPresent: true,
      error: new Error('Failed for +51991347878 at https://example.com/private'),
    });

    expect(record.error_name).toBe('Error');
    expect(record.error_message_redacted).toBe('Failed for [phone] at [url]');
  });
});
