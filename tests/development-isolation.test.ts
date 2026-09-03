import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveDevelopmentTarget } from '../src/aws/development-target';
import { getConfig } from '../src/runtime/config';
import { HttpAgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import { SinEnvolturasGateway } from '../src/runtime/sinenvolturas-gateway';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('development isolation', () => {
  const outputs = { DeploymentEnvironment: 'development', FunctionUrl: 'https://dev.test', PlansTableName: 'dev-plans' };
  it('requires a verified dev stack even when the caller supplies a URL', () => {
    expect(() => resolveDevelopmentTarget({}, { functionUrl: 'https://prod.test' })).toThrow();
    expect(() => resolveDevelopmentTarget({ ...outputs, DeploymentEnvironment: 'production' })).toThrow();
    expect(() => resolveDevelopmentTarget(outputs, { plansTableName: 'prod-plans' })).toThrow();
    expect(() => resolveDevelopmentTarget(outputs, { functionUrl: 'https://prod.test' })).toThrow();
    expect(resolveDevelopmentTarget(outputs)).toEqual({ functionUrl: 'https://dev.test', plansTableName: 'dev-plans' });
  });
  it('fails closed for missing or unknown Lambda deployment environment', () => {
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'runtime');
    vi.stubEnv('DEPLOYMENT_ENV', '');
    delete process.env.DEPLOYMENT_ENV;
    expect(() => getConfig()).toThrow('DEPLOYMENT_ENV');
    vi.stubEnv('DEPLOYMENT_ENV', 'staging');
    expect(() => getConfig()).toThrow();
    vi.stubEnv('DEPLOYMENT_ENV', 'development');
    expect(getConfig().deployment.environment).toBe('development');
  });
  it('blocks agent customer writes before any fetch or retry', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const gateway = new HttpAgentConversationGateway({ baseUrl: 'https://api.test', apiKey: 'test',
      timeoutMs: 1000, maxRetries: 2, messageLoggingEnabled: true, allowCustomerWrites: false });
    const phone = { phone_extension: '+51', phone_number: '900000001' };
    expect(await gateway.requestHumanTakeover('51900000001')).toMatchObject({ status: 'failed', retryable: false });
    expect(await gateway.logMessage({ phoneNumber: '51900000001', body: 'test', direction: 'outbound' })).toMatchObject({ status: 'failed' });
    expect(await gateway.guestRsvp({ ...phone, action: 'attending' })).toMatchObject({ status: 'failed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('blocks provider OTP writes and uses untracked detail reads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new SinEnvolturasGateway({ baseUrl: 'https://api.test', persistedSearchLimit: 12,
      summarySearchWordLimit: 5, allowCustomerWrites: false });
    await gateway.requestUserLoginCode('test@example.test').catch(() => undefined);
    expect(fetchMock).not.toHaveBeenCalled();
    await gateway.getProviderDetailAndTrackView(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(expect.not.stringContaining('/view/'));
  });
});
