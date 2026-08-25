import { describe, expect, it, vi } from 'vitest';

import {
  logAuthObservabilityEvent,
  sanitizeAuthLogValue,
  withAuthenticationFlowContext,
  withRequestObservabilityContext,
} from '../src/runtime/auth-observability';

describe('authentication observability', () => {
  it('keeps request and response detail while replacing only credential fields', () => {
    const value = sanitizeAuthLogValue({
      email: 'maria@example.com',
      phone_number: '987654321',
      request_body: { code: '123456' },
      nested: {
        status: true,
        access_token: 'secret-token',
      },
    });

    const root = asRecord(value);
    const code = asRecord(asRecord(root.request_body).code);
    const nested = asRecord(root.nested);
    const accessToken = asRecord(nested.access_token);
    expect(root.email).toBe('maria@example.com');
    expect(root.phone_number).toBe('987654321');
    expect(code.redacted).toBe(true);
    expect(code.kind).toBe('secret');
    expect(code.length).toBe(6);
    expect(code.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(nested.status).toBe(true);
    expect(accessToken.redacted).toBe(true);
    expect(accessToken.length).toBe(12);
    expect(accessToken.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(value)).not.toContain('123456');
    expect(JSON.stringify(value)).not.toContain('secret-token');
  });

  it('logs unverified JWT metadata and a stable fingerprint without the token', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'auth.example.test',
      sub: 'user-42',
      aud: ['guest-api'],
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    })).toString('base64url');
    const token = `${header}.${payload}.signature`;

    const value = sanitizeAuthLogValue({ Authorization: `Bearer ${token}` });

    const authorization = asRecord(asRecord(value).Authorization);
    const jwt = asRecord(authorization.jwt);
    expect(authorization.redacted).toBe(true);
    expect(authorization.kind).toBe('jwt');
    expect(authorization.length).toBe(token.length);
    expect(authorization.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(jwt).toEqual({
      algorithm: 'HS256',
      type: 'JWT',
      issuer: 'auth.example.test',
      subject: 'user-42',
      audience: ['guest-api'],
      issued_at: 1_700_000_000,
      expires_at: 1_700_003_600,
    });
    expect(JSON.stringify(value)).not.toContain(token);
  });

  it('correlates flow logs with the Lambda request, flow, and plan ids', () => {
    const records: unknown[] = [];
    vi.spyOn(console, 'info').mockImplementation((...values: unknown[]) => {
      records.push(...values);
    });

    withRequestObservabilityContext('lambda-request-1', () => {
      withAuthenticationFlowContext(
        { authFlowId: 'auth-flow-1', planId: 'plan-1' },
        () => logAuthObservabilityEvent('info', 'auth_test_event', {
          request_body: { email: 'maria@example.com', otp: '654321' },
        }),
      );
    });

    const record = asRecord(records[0]);
    const requestBody = asRecord(record.request_body);
    const otp = asRecord(requestBody.otp);
    expect(record.event).toBe('auth_test_event');
    expect(record.lambda_request_id).toBe('lambda-request-1');
    expect(record.auth_flow_id).toBe('auth-flow-1');
    expect(record.plan_id).toBe('plan-1');
    expect(requestBody.email).toBe('maria@example.com');
    expect(otp.redacted).toBe(true);
    expect(otp.length).toBe(6);
  });
});

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a record.');
  }
  return value as Record<string, unknown>;
}
