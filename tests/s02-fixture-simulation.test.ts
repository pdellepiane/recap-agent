import { describe, expect, it, vi, afterEach } from 'vitest';
import { FixtureAgentConversationGateway, assertFixtureMarkerAllowed } from '../src/runtime/eval-fixture-gateway';
import { FixtureProviderGateway } from '../src/runtime/fixture-provider-gateway';
import {
  InMemoryEvalFixtureStateStore,
  buildFixtureStateKey,
  syntheticEffectId,
  EVAL_FIXTURE_TTL_SECONDS,
} from '../src/runtime/eval-fixture-state';
import { HttpAgentConversationGateway } from '../src/runtime/agent-conversation-gateway';
import { SinEnvolturasGateway } from '../src/runtime/sinenvolturas-gateway';
import {
  setupRsvpIsolationWithGateway,
  teardownRsvpIsolationWithGateway,
} from '../src/evals/rsvp-isolation';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function denyNetwork(): void {
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('network disabled in fixture test');
  }));
}

describe('S02 simulated effects fail closed', () => {
  it('provider writes resolve to simulated receipts without HTTP', async () => {
    denyNetwork();
    const fetchMock = vi.mocked(globalThis.fetch);
    const store = new InMemoryEvalFixtureStateStore();
    const gateway = new FixtureProviderGateway('s02-rsvp-reversal', { scenario: 's02-rsvp-reversal' }, 'loaded', {
      runId: 'run-s02',
      caseId: 'case-provider',
      stateStore: store,
    });
    const quote = await gateway.createQuoteRequest({
      providerId: 42,
      name: 'Test',
      email: 'test@example.invalid',
      phone: '900000001',
      phoneExtension: '+51',
      eventDate: '2026-10-01',
      guestsRange: '50-100',
      description: 'Fiesta',
    });
    expect(quote['status']).toBe('simulated');
    expect(String(quote['id'])).toContain('fixture-provider.quote.write');
    const favorite = await gateway.addVendorToEventFavorites({ providerId: 42, userId: 7, eventId: 9 });
    expect(favorite['status']).toBe('simulated');
    const review = await gateway.createProviderReview({ providerId: 42, userId: 7, name: 'Test', rating: 5 });
    expect(review['status']).toBe('simulated');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(gateway.callCount('createQuoteRequest')).toBe(1);
    expect(await store.count('run-s02', 'case-provider', 'provider.quote.write')).toBe(2);
  });

  it('provider reads return empty without HTTP and unknown scenario fails closed', async () => {
    denyNetwork();
    const fetchMock = vi.mocked(globalThis.fetch);
    const unknown = new FixtureProviderGateway('nope', null, 'unknown_scenario', { runId: 'r', caseId: 'c' });
    expect(await unknown.listCategories()).toEqual([]);
    expect(await unknown.getProviderDetail(1)).toBeNull();
    await expect(unknown.createQuoteRequest({
      providerId: 1,
      name: 'T',
      email: 't@example.invalid',
      phone: '1',
      phoneExtension: '+51',
      eventDate: '2026-10-01',
      guestsRange: '10',
      description: 'd',
    })).rejects.toThrow('Unknown fixture scenario');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('OTP request and verify are one-shot and unknown scenarios fail hard', async () => {
    denyNetwork();
    const store = new InMemoryEvalFixtureStateStore();
    const first = await FixtureAgentConversationGateway.create('s02-otp-nondelivery', undefined, {
      runId: 'run-otp',
      caseId: 'case-otp',
      stateStore: store,
    });
    const sent = await first.requestUserLoginCode('a@example.invalid');
    expect(sent.status).toBe('sent');
    const second = new FixtureAgentConversationGateway(
      's02-otp-nondelivery',
      { status: 'loaded', data: { emailAuth: { request: { status: 'sent' } } } },
      { runId: 'run-otp', caseId: 'case-otp', stateStore: store },
    );
    const resend = await second.requestUserLoginCode('a@example.invalid');
    expect(resend.status).toBe('failed');
    expect(first.getFixtureCallCount('otp.request')).toBe(1);
    expect(await store.count('run-otp', 'case-otp', 'otp.request')).toBe(2);
    const verifier = await FixtureAgentConversationGateway.create('s02-otp-number-words', undefined, {
      runId: 'run-v',
      caseId: 'case-v',
      stateStore: store,
    });
    const verified = await verifier.verifyUserLoginCode('a@example.invalid', '123456');
    expect(verified.status).toBe('authenticated');
    const replayed = await verifier.verifyUserLoginCode('a@example.invalid', '123456');
    expect(replayed.status).toBe('failed');
    const unknown = await FixtureAgentConversationGateway.create('missing-xyz');
    const failed = await unknown.requestUserLoginCode('a@example.invalid');
    expect(failed.status).toBe('unavailable');
  });

  it('handoff succeeds once then replays without a new effect', async () => {
    denyNetwork();
    const store = new InMemoryEvalFixtureStateStore();
    const options = { runId: 'run-h', caseId: 'case-h', stateStore: store };
    const first = await FixtureAgentConversationGateway.create('s02-otp-repeated-failure', undefined, options);
    const ok = await first.requestHumanTakeover('51900000001');
    expect(ok.status).toBe('success');
    const again = await first.requestHumanTakeover('51900000001');
    expect(again.status).toBe('success');
    if (again.status === 'success') {
      expect(again.message).toContain('replay');
    }
    expect(await store.count('run-h', 'case-h', 'handoff.write')).toBe(2);
  });

  it('RSVP writes record receipts, counts and attendance state', async () => {
    denyNetwork();
    const gateway = await FixtureAgentConversationGateway.create('s02-rsvp-reversal', undefined, {
      runId: 'run-r',
      caseId: 'case-r',
    });
    const result = await gateway.guestRsvp({
      phone_extension: '+51',
      phone_number: '973296571',
      action: 'attending',
      guest_id: 584353,
    });
    expect(result.status).toBe('responded');
    if (result.status === 'responded') {
      expect(result.willAttend).toBe(true);
      expect(result.guestId).toBe(584353);
    }
    expect(gateway.getFixtureCallCount('rsvp.write')).toBe(1);
    expect(gateway.getRsvpAttendanceForTesting(584353)).toBe(true);
    expect(gateway.getFixtureReceipts()[0]?.syntheticId).toContain('fixture-rsvp.write');
  });

  it('production rejects fixture markers and dev retains write block', async () => {
    expect(() => assertFixtureMarkerAllowed('production')).toThrow('only in development');
    expect(() => assertFixtureMarkerAllowed('development')).not.toThrow();
    denyNetwork();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const http = new HttpAgentConversationGateway({
      baseUrl: 'https://api.test',
      apiKey: 'key',
      timeoutMs: 1000,
      maxRetries: 2,
      messageLoggingEnabled: false,
      allowCustomerWrites: false,
    });
    expect(http.capabilityDescriptor['rsvp.response.write'].available).toBe(false);
    expect(http.capabilityDescriptor['human.takeover.write'].available).toBe(false);
    await expect(http.guestRsvp({ phone_extension: '+51', phone_number: '900000001', action: 'attending' })).resolves.toMatchObject({ status: 'failed' });
    expect(fetchMock).not.toHaveBeenCalled();
    const provider = new SinEnvolturasGateway({ baseUrl: 'https://api.test', persistedSearchLimit: 12, summarySearchWordLimit: 5, allowCustomerWrites: false });
    await expect(provider.requestUserLoginCode('t@example.invalid')).resolves.toMatchObject({ status: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('capability manifest distinguishes simulation explicitly', async () => {
    const gateway = await FixtureAgentConversationGateway.create('s02-rsvp-reversal');
    expect(gateway.simulated).toBe(true);
    expect(gateway.fixtureScenario).toBe('s02-rsvp-reversal');
    expect(gateway.capabilityDescriptor['rsvp.response.write'].available).toBe(true);
  });

  it('evaluation DynamoDB namespace is keyed by run/case/operation with TTL', () => {
    const key = buildFixtureStateKey('run-1', 'case-1', 'rsvp.write');
    expect(key.pk).toBe('EVAL_FIXTURE#run-1#case-1');
    expect(key.sk).toBe('OP#rsvp.write');
    expect(EVAL_FIXTURE_TTL_SECONDS).toBe(604800);
    const id = syntheticEffectId('s02-rsvp-reversal', 'rsvp.write', 'run-1', 1);
    expect(id).toBe('fixture-rsvp.write-s02-rsvp-reversal-run-1-1');
  });

  it('rsvp isolation seam skips unknown priors and restores explicit ones without network', async () => {
    const unknownWrite = vi.fn(async () => ({ status: 'responded' as const, action: 'attending' as const, willAttend: true, guestId: 1, eventName: null, eventDate: null }));
    const unknownContext = await setupRsvpIsolationWithGateway({
      setup: { guestId: 1, eventName: 'E', phone: '+51900000001', targetState: 'attending' },
    }, { guestRsvp: unknownWrite } as unknown as { guestRsvp: (input: unknown) => Promise<unknown> } as never);
    expect(unknownWrite).toHaveBeenCalledTimes(1);
    expect(unknownContext?.priorState).toBeNull();
    unknownWrite.mockClear();
    await teardownRsvpIsolationWithGateway({
      setup: { guestId: 1, eventName: 'E', phone: '+51900000001', targetState: 'attending' },
      teardown: { guestId: 1, eventName: 'E', phone: '+51900000001', restore: true },
    }, unknownContext, { guestRsvp: unknownWrite } as unknown as { guestRsvp: (input: unknown) => Promise<unknown> } as never);
    expect(unknownWrite).not.toHaveBeenCalled();
    // O1 verified-setup contract: a write must confirm the requested
    // attendance, so the double answers each call honestly — attending for
    // the setup write, declining for the restore write.
    const restoreWrite = vi.fn(async (input: { action?: string }) => (input.action === 'attending'
      ? { status: 'responded' as const, action: 'attending' as const, willAttend: true, guestId: 2, eventName: null, eventDate: null }
      : { status: 'responded' as const, action: 'declining' as const, willAttend: false, guestId: 2, eventName: null, eventDate: null }));
    const restoreContext = await setupRsvpIsolationWithGateway({
      setup: { guestId: 2, eventName: 'E', phone: '+51900000002', targetState: 'attending', priorState: 'declining' },
    }, { guestRsvp: restoreWrite } as unknown as { guestRsvp: (input: unknown) => Promise<unknown> } as never);
    expect(restoreContext?.priorState).toBe('declining');
    await teardownRsvpIsolationWithGateway({
      setup: { guestId: 2, eventName: 'E', phone: '+51900000002', targetState: 'attending', priorState: 'declining' },
      teardown: { guestId: 2, eventName: 'E', phone: '+51900000002', restore: true },
    }, restoreContext, { guestRsvp: restoreWrite } as unknown as { guestRsvp: (input: unknown) => Promise<unknown> } as never);
    expect(restoreWrite).toHaveBeenCalledTimes(2);
  });
});
