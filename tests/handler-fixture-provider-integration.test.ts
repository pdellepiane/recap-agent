import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterAll, describe, expect, it, vi } from 'vitest';

import type { ProviderGateway } from '../src/runtime/provider-gateway';
import type * as FixtureStateModule from '../src/runtime/eval-fixture-state';

const captured = vi.hoisted(() => ({ provider: null as ProviderGateway | null, externalCalls: [] as string[] }));

vi.mock('../src/runtime/sinenvolturas-gateway', () => ({
  SinEnvolturasGateway: vi.fn().mockImplementation(() => new Proxy({}, {
    get(_target, key) {
      return () => { captured.externalCalls.push(String(key)); throw new Error(`External provider method forbidden: ${String(key)}`); };
    },
  })),
}));

vi.mock('../src/runtime/agent-service', () => ({
  AgentService: vi.fn().mockImplementation((dependencies: { providerGateway: ProviderGateway }) => {
    captured.provider = dependencies.providerGateway;
    return { handleTurn: async () => { throw new Error('Stop after capturing handler dependencies'); } };
  }),
}));

vi.mock('../src/storage/dynamo-conversation-turn-coordinator', () => ({
  DynamoConversationTurnCoordinator: vi.fn().mockImplementation(() => ({
    acquire: async () => true, release: async () => undefined,
  })),
}));

vi.mock('../src/runtime/eval-fixture-state', async (importOriginal) => {
  const actual = await importOriginal<typeof FixtureStateModule>();
  return { ...actual, createEvalFixtureStateStoreFromEnv: () => new actual.InMemoryEvalFixtureStateStore() };
});

describe('Lambda fixture provider dependency injection', () => {
  afterAll(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('passes the isolated gateway to the real handler service construction instead of the shared real gateway', async () => {
    vi.stubEnv('DEPLOYMENT_ENV', 'development');
    vi.stubEnv('CHANNEL_API_KEY', 'fixture-channel-key');
    vi.stubEnv('OPENAI_API_KEY', 'fixture-openai-key');
    vi.stubEnv('PROVIDER_SEARCH_MODE', 'api');
    vi.stubEnv('KB_ENABLED', 'false');
    vi.stubEnv('CONVERSATION_TURN_WAIT_MS', '0');
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network'));
    const { handler } = await import('../src/lambda/handler');
    const event: APIGatewayProxyEventV2 = {
      version: '2.0', routeKey: '$default', rawPath: '/', rawQueryString: '',
      headers: { authorization: 'Bearer fixture-channel-key' },
      requestContext: {
        accountId: 'anonymous', apiId: 'test-function-url', domainName: 'example.test', domainPrefix: 'example',
        http: { method: 'POST', path: '/', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'vitest' },
        requestId: 'fixture-provider-boundary', routeKey: '$default', stage: '$default', time: '', timeEpoch: Date.now(),
      },
      body: JSON.stringify({
        channel: 'terminal_whatsapp', user_id: 'fixture-provider-boundary', text: 'Necesito catering',
        message_id: 'fixture-provider-boundary', client_mode: 'cli',
        backendFixture: { scenario: 'provider-decimal-budget', runId: 'integration-run', caseId: 'integration-case' },
      }),
      isBase64Encoded: false,
    };
    const response = await handler(event);
    expect(response.statusCode).toBe(500); // Explicit test stop, not a conversational outcome.
    const provider = captured.provider;
    if (!provider) throw new Error('Handler did not construct the fixture service');
    expect((await provider.getProviderDetail(9101))?.title).toBe('Mesa Accesible');
    expect(await provider.getEventVendorContext(7)).toBeNull();
    expect(await provider.lookupAuthenticatedUserEvents({ email: 'fixture@example.test', token: 'fixture-token' })).toBeNull();
    expect(await provider.addVendorToEventFavorites({ providerId: 9101, userId: 7, eventId: 5 })).toMatchObject({ status: 'simulated' });
    expect(await provider.createProviderReview({ providerId: 9101, userId: 7, name: 'Fixture User', rating: 4 })).toMatchObject({ status: 'simulated' });
    expect(captured.externalCalls).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
