import crypto from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { handler as LambdaHandler } from '../src/lambda/handler';
import type { ChannelRequestLog } from '../src/lambda/request-observability';

let lambdaHandler: typeof LambdaHandler;

beforeAll(async () => {
  vi.stubEnv('CHANNEL_API_KEY', 'test-channel-key');
  vi.stubEnv('DEPLOYMENT_ENV', 'production');
  ({ handler: lambdaHandler } = await import('../src/lambda/handler'));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('Lambda handler request observability', () => {
  it('rejects fixture input in production before loading runtime or state', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await lambdaHandler(buildEvent({
      method: 'POST', rawPath: '/', headers: { authorization: 'Bearer test-channel-key' },
      body: JSON.stringify({ channel: 'whatsapp', user_id: 'fixture-test', text: 'test', contact_phone: '+51900000001',
        backendFixture: { scenario: 'support-continuity' } }),
    }));
    expect(response.statusCode).toBe(403);
    expect(response.body).toContain('only in development');
    info.mockRestore();
  });
  it('logs the ownership path and route before rejecting missing authentication', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const response = await lambdaHandler(buildEvent({
      method: 'POST',
      rawPath: '/conversations/resume',
      headers: {},
      body: JSON.stringify({
        channel: 'whatsapp',
        user_id: 'whatsapp:51999999999',
        request_id: 'resume-request-1',
      }),
    }));

    expect(response.statusCode).toBe(401);
    expect(response.headers).toMatchObject({
      'x-recap-request-id': 'lambda-request-1',
    });
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0]?.[0] satisfies ChannelRequestLog).toMatchObject({
      outcome: 'unauthorized',
      request_path: '/conversations/resume',
      request_route: 'resume_automated_agent',
      ownership_operation: 'resume',
      request_body_present: true,
      authorization_header_present: false,
      bearer_token_present: false,
    });

    info.mockRestore();
  });

  it('rejects an authenticated non-POST ownership request with an Allow header', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const response = await lambdaHandler(buildEvent({
      method: 'GET',
      rawPath: '/conversations/resume',
      headers: {
        authorization: 'Bearer test-channel-key',
      },
    }));

    expect(response.statusCode).toBe(405);
    expect(response.headers).toMatchObject({ allow: 'POST' });
    expect(info.mock.calls[0]?.[0] satisfies ChannelRequestLog).toMatchObject({
      outcome: 'method_not_allowed',
      method: 'GET',
      request_path: '/conversations/resume',
      request_route: 'resume_automated_agent',
      ownership_operation: 'resume',
      request_body_present: false,
    });

    info.mockRestore();
  });

  it('echoes the inbound correlation id and captures the exact bytes on invalid JSON', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const rawBody = '{"text": "truncated';

    const response = await lambdaHandler(buildEvent({
      method: 'POST',
      rawPath: '/',
      headers: {
        authorization: `Bearer ${process.env.CHANNEL_API_KEY ?? ''}`,
        'x-recap-correlation-id': 'se-adapter-7',
      },
      body: rawBody,
    }));

    expect(response.statusCode).toBe(400);
    expect(response.headers).toMatchObject({
      'x-recap-request-id': 'lambda-request-1',
      'x-recap-correlation-id': 'se-adapter-7',
    });
    expect(info.mock.calls[0]?.[0] satisfies ChannelRequestLog).toMatchObject({
      outcome: 'invalid_json',
      correlation_id: 'se-adapter-7',
      correlation_source: 'inbound_header',
      payload_capture: {
        body_bytes: Buffer.byteLength(rawBody, 'utf8'),
        body_sha256: crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex'),
        body_parse: 'invalid_json',
      },
    });

    info.mockRestore();
  });

  it('falls back to the Lambda request id and inventories shape on invalid request', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const rawBody = JSON.stringify({
      text: 'hola',
      user_id: 'whatsapp:51999999999',
      channel: 'whatsapp',
    });

    const response = await lambdaHandler(buildEvent({
      method: 'POST',
      rawPath: '/',
      headers: { authorization: `Bearer ${process.env.CHANNEL_API_KEY ?? ''}` },
      body: rawBody,
    }));

    expect(response.statusCode).toBe(400);
    expect(response.headers).toMatchObject({
      'x-recap-correlation-id': 'lambda-request-1',
    });
    const record = info.mock.calls[0]?.[0] satisfies ChannelRequestLog as ChannelRequestLog;
    expect(record).toMatchObject({
      outcome: 'invalid_request',
      correlation_id: 'lambda-request-1',
      correlation_source: 'lambda_request',
      payload_capture: {
        body_bytes: Buffer.byteLength(rawBody, 'utf8'),
        body_sha256: crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex'),
        body_parse: 'json_object',
        top_level_fields: ['channel:string', 'text:string', 'user_id:string'],
      },
    });
    expect(JSON.stringify(record)).not.toContain('51999999999');

    info.mockRestore();
  });

  it('auto-correlates by native message id and tracks ids in the response body', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const rawBody = JSON.stringify({
      text: 'hola',
      user_id: 'whatsapp:51999999999',
      channel: 'whatsapp',
      message_id: 'wamid.native-42',
    });

    const response = await lambdaHandler(buildEvent({
      method: 'POST',
      rawPath: '/',
      headers: { authorization: `Bearer ${process.env.CHANNEL_API_KEY ?? ''}` },
      body: rawBody,
    }));

    expect(response.statusCode).toBe(400);
    expect(response.headers).toMatchObject({
      'x-recap-correlation-id': 'wamid.native-42',
    });
    expect(info.mock.calls[0]?.[0] satisfies ChannelRequestLog).toMatchObject({
      outcome: 'invalid_request',
      correlation_id: 'wamid.native-42',
      correlation_source: 'native_message',
    });
    const parsedBody = JSON.parse(response.body ?? '{}') as Record<string, unknown>;
    expect(parsedBody.correlation_id).toBe('wamid.native-42');
    expect(parsedBody.request_id).toBe('lambda-request-1');
    expect(JSON.stringify(info.mock.calls[0]?.[0])).not.toContain('51999999999');

    info.mockRestore();
  });
});

function buildEvent(args: {
  method: string;
  rawPath: string;
  headers: Record<string, string>;
  body?: string;
}): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: args.rawPath,
    rawQueryString: '',
    headers: args.headers,
    requestContext: {
      accountId: 'anonymous',
      apiId: 'test-function-url',
      domainName: 'example.lambda-url.us-east-1.on.aws',
      domainPrefix: 'example',
      http: {
        method: args.method,
        path: args.rawPath,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'vitest',
      },
      requestId: 'lambda-request-1',
      routeKey: '$default',
      stage: '$default',
      time: '21/Jul/2026:18:00:00 +0000',
      timeEpoch: 1_774_118_400_000,
    },
    ...(args.body ? { body: args.body } : {}),
    isBase64Encoded: false,
  };
}
