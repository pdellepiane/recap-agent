import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { handler as LambdaHandler } from '../src/lambda/handler';
import type { ChannelRequestLog } from '../src/lambda/request-observability';

let lambdaHandler: typeof LambdaHandler;

beforeAll(async () => {
  vi.stubEnv('CHANNEL_API_KEY', 'test-channel-key');
  ({ handler: lambdaHandler } = await import('../src/lambda/handler'));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('Lambda handler request observability', () => {
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
