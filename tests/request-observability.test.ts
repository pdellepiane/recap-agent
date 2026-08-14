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
      messageIdSource: 'native',
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
      message_id_source: 'native',
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

  it('marks an internally generated message id without presenting it as native', () => {
    const record = buildChannelRequestLog({
      requestId: 'request-generated-id',
      method: 'POST',
      requestPath: '/',
      requestRoute: 'message',
      requestBodyPresent: true,
      statusCode: 200,
      outcome: 'success',
      durationMs: 10,
      authorizationHeaderPresent: true,
      bearerTokenPresent: true,
      channel: 'whatsapp',
      messageId: 'generated-uuid',
      messageIdSource: 'generated',
    });

    expect(record.message_id_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(record.message_id_source).toBe('generated');
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

  it('records media shape while hashing provider media identifiers', () => {
    const record = buildChannelRequestLog({
      requestId: 'request-media',
      method: 'POST',
      requestPath: '/',
      requestRoute: 'message',
      requestBodyPresent: true,
      statusCode: 200,
      outcome: 'success',
      durationMs: 25,
      authorizationHeaderPresent: true,
      bearerTokenPresent: true,
      channel: 'whatsapp',
      externalUserId: 'whatsapp:51991347878',
      messageId: 'wamid.image',
      mediaKinds: ['image'],
      providerMediaIds: ['2754859441498128'],
      feedbackSignalVersion: 1,
      decisionSource: 'deterministic',
      ambiguityStatus: 'clear',
      modelCallCount: 0,
      outputQualityFlagCount: 0,
      spanishPolicyTermHitCount: 0,
    });

    expect(record).toMatchObject({
      media_count: 1,
      media_kinds: ['image'],
      feedback_signal_version: 1,
      decision_source: 'deterministic',
      ambiguity_status: 'clear',
      model_call_count: 0,
      output_quality_flag_count: 0,
      spanish_policy_term_hit_count: 0,
    });
    expect(record.provider_media_id_hashes?.[0]).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(record)).not.toContain('2754859441498128');
  });

  it('summarizes authentication, FAQ outcomes, and every model stage', () => {
    const record = buildChannelRequestLog({
      requestId: 'request-standard-trace',
      method: 'POST',
      requestPath: '/',
      requestRoute: 'message',
      requestBodyPresent: true,
      statusCode: 200,
      outcome: 'success',
      durationMs: 42,
      authorizationHeaderPresent: true,
      bearerTokenPresent: true,
      traceId: 'trace-standard',
      authenticationExecution: [
        {
          operation: 'auth_by_phone',
          status: 'user_not_found',
          auth_method: 'phone',
          failure_kind: 'user_not_found',
        },
        {
          operation: 'request_user_login_code',
          status: 'sent',
          auth_method: 'email_otp',
          failure_kind: null,
        },
      ],
      informationOutcomes: [{
        requestId: 'information-1',
        kind: 'faq',
        status: 'completed',
        source: 'knowledge_base',
        outcomeCode: 'completed_with_results',
        retryable: null,
        queryHash: 'a'.repeat(64),
        evidence: [{
          fileId: 'file-faq',
          filename: 'faq.md',
          score: 0.91,
          contentHash: 'b'.repeat(64),
        }],
        resultCount: 2,
        durationMs: 18,
      }],
      openAiCalls: {
        classifier: {
          responseId: 'resp_classifier',
          requestId: 'req_classifier',
          model: 'gpt-5.6-luna',
          attemptCount: 1,
          requestMetrics: {
            instructionBytes: 10,
            inputBytes: 20,
            toolCount: 0,
            schemaPropertyCount: 8,
          },
        },
        extraction: null,
        reply: null,
      },
    });

    expect(record).toMatchObject({
      trace_id: 'trace-standard',
      authentication_path: 'phone_to_email_otp',
      authentication_reason: 'user_not_found',
      information_outcomes: [{
        kind: 'faq',
        outcomeCode: 'completed_with_results',
        resultCount: 2,
      }],
      openai_calls: {
        classifier: {
          status: 'completed',
          response_id: 'resp_classifier',
          request_id: 'req_classifier',
        },
        extraction: { status: 'not_called' },
        reply: { status: 'not_called' },
      },
    });
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
