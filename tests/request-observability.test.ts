import { describe, expect, it } from 'vitest';

import { buildChannelRequestLog } from '../src/lambda/request-observability';

describe('Lambda channel request observability', () => {
  it('records the rejection reason without exposing message or user identifiers', () => {
    const record = buildChannelRequestLog({
      requestId: 'request-1',
      method: 'POST',
      requestPath: '/',
      requestRoute: 'message',
      requestBodyPresent: true,
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
      request_path: '/',
      request_route: 'message',
      request_body_present: true,
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
      requestPath: '/conversations/resume',
      requestRoute: 'resume_automated_agent',
      requestBodyPresent: true,
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

  it('records safe ownership correlation and resulting plan state', () => {
    const record = buildChannelRequestLog({
      requestId: 'request-3',
      method: 'POST',
      requestPath: '/conversations/resume',
      requestRoute: 'resume_automated_agent',
      requestBodyPresent: true,
      statusCode: 200,
      outcome: 'agent_participation_resumed',
      durationMs: 18,
      authorizationHeaderPresent: true,
      bearerTokenPresent: true,
      channel: 'whatsapp',
      externalUserId: 'whatsapp:51991347878',
      ownershipRequestId: 'ownership-resume-secret',
      participationStatus: 'resumed',
      planId: 'plan-123',
      humanEscalationStatus: 'none',
    });

    expect(record).toMatchObject({
      request_path: '/conversations/resume',
      request_route: 'resume_automated_agent',
      ownership_operation: 'resume',
      participation_status: 'resumed',
      plan_id: 'plan-123',
      human_escalation_status: 'none',
    });
    expect(record.ownership_request_id_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(record.message_id_hash).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain('ownership-resume-secret');
    expect(JSON.stringify(record)).not.toContain('51991347878');
  });

  it('redacts phone-like values from an unexpected request path', () => {
    const record = buildChannelRequestLog({
      requestId: 'request-4',
      method: 'POST',
      requestPath: '/conversations/resume/51991347878',
      requestRoute: 'not_found',
      requestBodyPresent: false,
      statusCode: 401,
      outcome: 'unauthorized',
      durationMs: 2,
      authorizationHeaderPresent: false,
      bearerTokenPresent: false,
    });

    expect(record.request_path).toBe('/conversations/resume/[phone]');
  });
});
