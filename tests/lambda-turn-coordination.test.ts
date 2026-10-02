import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import type { handler as LambdaHandler } from '../src/lambda/handler';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyPlan, mergePlan } from '../src/core/plan';
import type { ConversationTurnLease } from '../src/storage/conversation-turn-coordinator';

const coordinatorMocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  acquire: vi.fn<[ConversationTurnLease, number], Promise<boolean>>(),
  release: vi.fn<[ConversationTurnLease], Promise<void>>(),
  getPlan: vi.fn(),
  savePlan: vi.fn(),
}));

vi.mock('../src/storage/dynamo-plan-store', () => ({
  DynamoPlanStore: vi.fn().mockImplementation(() => ({
    getByExternalUser: coordinatorMocks.getPlan,
    save: coordinatorMocks.savePlan,
  })),
}));

vi.mock('../src/storage/dynamo-conversation-turn-coordinator', () => ({
  DynamoConversationTurnCoordinator: vi.fn().mockImplementation(() => {
    coordinatorMocks.constructor();
    return {
      acquire: coordinatorMocks.acquire,
      release: coordinatorMocks.release,
    };
  }),
}));

describe('Lambda turn coordination boundary', () => {
  let handler: typeof LambdaHandler;

  beforeAll(async () => {
    vi.stubEnv('CHANNEL_API_KEY', 'test-channel-key');
    vi.stubEnv('CONVERSATION_TURN_WAIT_MS', '0');
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const imported = await import('../src/lambda/handler');
    handler = imported.handler;
  });

  beforeEach(() => {
    coordinatorMocks.constructor.mockReset();
    coordinatorMocks.acquire.mockReset();
    coordinatorMocks.release.mockReset();
    coordinatorMocks.getPlan.mockReset();
    coordinatorMocks.savePlan.mockReset();
  });

  afterAll(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('does not construct or acquire a lease for failed authentication', async () => {
    const response = await handler(buildEvent({
      headers: {},
      body: JSON.stringify(validMessage()),
    }));

    expect(response.statusCode).toBe(401);
    expect(coordinatorMocks.constructor).not.toHaveBeenCalled();
    expect(coordinatorMocks.acquire).not.toHaveBeenCalled();
  });

  it('does not construct or acquire a lease for invalid payloads', async () => {
    const response = await handler(buildEvent({
      headers: { authorization: 'Bearer test-channel-key' },
      body: JSON.stringify({ channel: 'webchat', user_id: 'user-1' }),
    }));

    expect(response.statusCode).toBe(400);
    expect(coordinatorMocks.constructor).not.toHaveBeenCalled();
    expect(coordinatorMocks.acquire).not.toHaveBeenCalled();
  });

  it('returns a retryable 503 without entering runtime work when busy', async () => {
    coordinatorMocks.acquire.mockResolvedValue(false);
    const response = await handler(buildEvent({
      headers: { authorization: 'Bearer test-channel-key' },
      body: JSON.stringify(validMessage()),
    }));

    expect(response.statusCode).toBe(503);
    expect(response.headers).toMatchObject({ 'retry-after': '2' });
    // Busy rejections still carry tracking ids; correlation derives from the
    // native message id already on the request.
    const payload = JSON.parse(response.body ?? '{}') as { request_id?: unknown };
    expect(payload).toMatchObject({
      error: 'Conversation is busy. Retry this request.',
      code: 'conversation_busy',
      retryable: true,
      correlation_id: 'message-1',
    });
    expect(typeof payload.request_id).toBe('string');
    expect(coordinatorMocks.constructor).toHaveBeenCalledOnce();
    expect(coordinatorMocks.acquire).toHaveBeenCalledOnce();
    // Failed acquisition never enters runtime work: no plan read or save.
    expect(coordinatorMocks.getPlan).not.toHaveBeenCalled();
    expect(coordinatorMocks.savePlan).not.toHaveBeenCalled();
  });

  it('fails closed with coordination_unavailable when lease storage errors', async () => {
    coordinatorMocks.acquire.mockRejectedValue(new Error('storage unavailable'));
    const response = await handler(buildEvent({
      headers: { authorization: 'Bearer test-channel-key' },
      body: JSON.stringify(validMessage()),
    }));

    expect(response.statusCode).toBe(503);
    expect(response.headers).toMatchObject({ 'retry-after': '2' });
    expect(JSON.parse(response.body ?? '{}')).toMatchObject({
      code: 'coordination_unavailable',
      retryable: true,
    });
    expect(coordinatorMocks.acquire).toHaveBeenCalledOnce();
    // Storage failure fails closed before any agent work: no plan read/save.
    expect(coordinatorMocks.getPlan).not.toHaveBeenCalled();
    expect(coordinatorMocks.savePlan).not.toHaveBeenCalled();
  });

  it('does not grant a fresh runtime budget when Lambda reports no time remaining', async () => {
    const response = await handler(
      buildEvent({
        headers: { authorization: 'Bearer test-channel-key' },
        body: JSON.stringify(validMessage()),
      }),
      buildContext({ remainingMs: 0 }),
    );

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body ?? '{}')).toMatchObject({
      code: 'conversation_busy',
      retryable: true,
    });
    expect(coordinatorMocks.acquire).not.toHaveBeenCalled();
  });

  it.each(['/conversations/overtake', '/conversations/resume'])(
    'holds the same conversation lease across read and save for %s', async (rawPath) => {
      let held = false;
      coordinatorMocks.acquire.mockImplementation(async () => { held = true; return true; });
      coordinatorMocks.release.mockImplementation(async () => { held = false; });
      const plan = createEmptyPlan({ planId: 'control-plan', channel: 'webchat', externalUserId: 'user-1' });
      coordinatorMocks.getPlan.mockImplementation(async () => {
        expect(held).toBe(true);
        return rawPath.endsWith('resume') ? mergePlan(plan, {
          human_escalation: { status: 'requested', requested_at: new Date().toISOString(), phone_number: null, last_error: null },
        }) : plan;
      });
      coordinatorMocks.savePlan.mockImplementation(async () => { expect(held).toBe(true); });
      const response = await handler({
        ...buildEvent({
          headers: { authorization: 'Bearer test-channel-key' },
          body: JSON.stringify({ channel: 'webchat', user_id: 'user-1', request_id: 'same-request-id' }),
        }), rawPath,
      });
      expect(response.statusCode).toBe(200);
      expect(held).toBe(false);
      expect(coordinatorMocks.savePlan).toHaveBeenCalledOnce();
      expect(coordinatorMocks.release).toHaveBeenCalledOnce();
      expect(coordinatorMocks.acquire.mock.calls[0]?.[0]).toMatchObject({ channel: 'webchat', externalUserId: 'user-1' });
      expect(response.headers).toMatchObject({ 'x-recap-turn-acquire-attempts': '1' });
      expect(JSON.stringify(coordinatorMocks.acquire.mock.calls[0]?.[0])).not.toContain('same-request-id');
    },
  );

  it('serializes overlapping same-conversation turns through actual lease acquisition order', async () => {
    let held = false;
    coordinatorMocks.acquire.mockImplementation(async () => {
      if (held) return false;
      held = true;
      return true;
    });
    coordinatorMocks.release.mockImplementation(async () => {
      held = false;
    });
    const plan = createEmptyPlan({ planId: 'race-plan', channel: 'webchat', externalUserId: 'user-1' });
    const escalated = mergePlan(plan, {
      human_escalation: { status: 'requested', requested_at: new Date().toISOString(), phone_number: null, last_error: null },
    });
    coordinatorMocks.getPlan.mockResolvedValue(escalated);
    coordinatorMocks.savePlan.mockImplementation(async () => {
      // Every durable write happens under the lease its own turn acquired:
      // a turn that lost the race never reaches runtime work.
      expect(held).toBe(true);
    });
    const headers = { authorization: 'Bearer test-channel-key' };
    const body = JSON.stringify({ channel: 'webchat', user_id: 'user-1', request_id: 'race-request' });
    const [first, second] = await Promise.all([
      handler({ ...buildEvent({ headers, body }), rawPath: '/conversations/resume' }),
      handler({ ...buildEvent({ headers, body }), rawPath: '/conversations/resume' }),
    ]);

    // Exactly one turn wins the lease; the loser fails closed as retryable
    // busy without entering runtime work. No sender FIFO is assumed: either
    // invocation may win the race.
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 503]);
    const busy = [first, second].find((response) => response.statusCode === 503);
    expect(JSON.parse(busy?.body ?? '{}')).toMatchObject({ code: 'conversation_busy', retryable: true });
    expect(coordinatorMocks.getPlan).toHaveBeenCalledOnce();
    expect(coordinatorMocks.savePlan).toHaveBeenCalledOnce();
    expect(coordinatorMocks.release).toHaveBeenCalledOnce();
    expect(held).toBe(false);
  });
});

function validMessage(): Record<string, unknown> {
  return {
    channel: 'webchat',
    user_id: 'user-1',
    text: 'Hola',
    message_id: 'message-1',
    session_id: 'session-1',
  };
}

function buildEvent(args: {
  headers: Record<string, string>;
  body: string;
}): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: '/',
    rawQueryString: '',
    headers: args.headers,
    requestContext: {
      accountId: 'anonymous',
      apiId: 'test-function-url',
      domainName: 'example.lambda-url.us-east-1.on.aws',
      domainPrefix: 'example',
      http: {
        method: 'POST',
        path: '/',
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
    body: args.body,
    isBase64Encoded: false,
  };
}

function buildContext(args: { remainingMs: number }): Context {
  return {
    awsRequestId: 'lambda-request-1',
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'recap-agent-test',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:recap-agent-test',
    memoryLimitInMB: '1024',
    getRemainingTimeInMillis: () => args.remainingMs,
    logGroupName: '/aws/lambda/recap-agent-test',
    logStreamName: 'test',
    done: () => undefined,
    fail: () => undefined,
    succeed: () => undefined,
  };
}
