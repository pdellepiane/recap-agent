import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EvalCase } from '../src/evals/case-schema';
import {
  acquireExternalLaneLock,
  classifyEvalCaseLane,
  collectFixtureCaseOperations,
  releaseExternalLaneLock,
} from '../src/evals/runner';
import { runEvaluation } from '../src/evals/runner';
import {
  attendanceToIsolationState,
  setupFixtureRsvpIsolation,
  setupRsvpIsolation,
  teardownFixtureRsvpIsolation,
  teardownRsvpIsolation,
} from '../src/evals/rsvp-isolation';
import {
  buildExecutionConversationMapping,
  resolvePhysicalExternalUserId,
  resolvePhysicalSessionId,
} from '../src/evals/targets/live-lambda';
import {
  FixtureAgentConversationGateway,
  assertFixtureGatewayImplementsOperations,
  loadFixtureData,
} from '../src/runtime/eval-fixture-gateway';
import {
  InMemoryEvalFixtureStateStore,
  buildConfigScopedFixtureRunId,
} from '../src/runtime/eval-fixture-state';

function makeCase(overrides: Partial<EvalCase> & { id: string }): EvalCase {
  return {
    suite: 'live_behavior_regression',
    version: 1,
    description: 'O1 isolation probe.',
    imports: [],
    tags: [],
    priority: 'p2',
    status: 'active',
    targetModes: ['live_lambda'],
    variables: {},
    inputs: [{ text: 'hola' }],
    expectations: [],
    scorers: [],
    notes: [],
    ...overrides,
  };
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ status: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubBackend(options: { events: Array<{ event_id: number; name: string }>; attendance: Record<string, unknown> | null }): void {
  vi.stubEnv('SE_API_KEY', 'test-key');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const raw = String(url);
      const route = raw.replace(/^https?:\/\/[^/]+/u, '');
      if (route.includes('/guest/rsvp')) {
        return jsonResponse({ will_attend: true, guest_id: 584353, event_id: 100 });
      }
      if (route.includes('/guest/events')) {
        return jsonResponse({
          events: options.events.map((event) => ({
            event_id: event.event_id,
            name: event.name,
            slug: 'slug',
            role: 'guest',
          })),
        });
      }
      if (route.includes('/event?')) {
        return jsonResponse({
          event: { event_id: 100, name: 'Otra celebración prueba', slug: 'slug', with_time: false },
          attendance: options.attendance,
          purchases: [],
        });
      }
      throw new Error(`Unexpected backend path: ${route}`);
    }),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubEnv('EVAL_COORDINATOR_HOST', os.hostname());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('O1 execution identity', () => {
  it('scopes the fixture runId by config while reports keep the logical run ID', async () => {
    const scopedA = buildConfigScopedFixtureRunId('run-logical', 'config-a');
    const scopedB = buildConfigScopedFixtureRunId('run-logical', 'config-b');
    expect(scopedA).not.toBe(scopedB);
    expect(scopedA).toContain('run-logical');
    expect(scopedA).toContain('config-a');

    const store = new InMemoryEvalFixtureStateStore();
    await store.record({
      runId: scopedA, caseId: 'case-x', scenario: 's', operation: 'rsvp.write', args: {}, resultStatus: 'responded',
    });
    expect(await store.count(scopedA, 'case-x', 'rsvp.write')).toBe(1);
    expect(await store.count(scopedB, 'case-x', 'rsvp.write')).toBe(0);

    const dry = await runEvaluation({
      evalsDir: path.resolve(process.cwd(), 'evals'),
      outputDir: path.resolve(process.cwd(), '.eval-runs-test'),
      suite: 'smoke',
      target: 'offline',
      dryRun: true,
    });
    expect(dry.report.results.length).toBeGreaterThan(0);
    for (const result of dry.report.results) {
      expect(result.runId).toBe(dry.runId);
    }
    // Offline smoke cases carry no backend fixture, so they admit to the
    // serial external lane (admission only; execution stays serial).
    expect(classifyEvalCaseLane(makeCase({ id: 'smoke-like' })).lane).toBe('external');
  });

  it('maps repeated logical conversation IDs identically and keeps distinct IDs distinct', () => {
    const mapping = buildExecutionConversationMapping({
      runId: 'run-1',
      configLabel: 'cfg',
      caseId: 'case-1',
      channel: 'terminal_whatsapp_eval',
      logicalExternalUserIds: ['user-a', 'user-a', 'user-b', undefined],
      logicalSessionIds: ['sess-a', 'sess-a', 'sess-b', undefined],
    });
    const firstA = resolvePhysicalExternalUserId(mapping, 'user-a');
    expect(resolvePhysicalExternalUserId(mapping, 'user-a')).toBe(firstA);
    expect(resolvePhysicalExternalUserId(mapping, 'user-b')).not.toBe(firstA);
    expect(resolvePhysicalExternalUserId(mapping, undefined)).toBe(mapping.defaultExternalUserId);
    const sessA = resolvePhysicalSessionId(mapping, 'sess-a');
    expect(resolvePhysicalSessionId(mapping, 'sess-a')).toBe(sessA);
    expect(resolvePhysicalSessionId(mapping, 'sess-b')).not.toBe(sessA);
    // The concurrent-first-two-turns overlap survives mapping: same logical
    // user on both turns still resolves to one physical conversation.
    expect(resolvePhysicalExternalUserId(mapping, 'user-a')).toBe(firstA);
    // Business phones never leak into physical conversation IDs.
    expect(firstA).not.toContain('51973296571');
    expect(sessA).not.toContain('51973296571');

    const other = buildExecutionConversationMapping({
      runId: 'run-2',
      configLabel: 'cfg',
      caseId: 'case-1',
      channel: 'terminal_whatsapp_eval',
      logicalExternalUserIds: ['user-a'],
      logicalSessionIds: ['sess-a'],
    });
    expect(resolvePhysicalExternalUserId(other, 'user-a')).not.toBe(firstA);
  });
});

describe('O1 fixture RSVP isolation performs zero real writes', () => {
  it('sets up and tears down the s11 world without HTTP and without effects', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('real HTTP is forbidden here'));
    const loadResult = await loadFixtureData('s11-rsvp-durability-declining');
    expect(loadResult.status).toBe('loaded');
    if (loadResult.status !== 'loaded') return;
    const store = new InMemoryEvalFixtureStateStore();
    const gateway = new FixtureAgentConversationGateway('s11-rsvp-durability-declining', loadResult, {
      runId: buildConfigScopedFixtureRunId('run-o1', 'cfg'),
      caseId: 'live_behavior.s11_rsvp_durability_confirms_once',
      stateStore: store,
    });
    const context = await setupFixtureRsvpIsolation({
      setup: {
        guestId: 584353,
        eventName: 'Otra celebración prueba',
        phone: '+51973296571',
        targetState: 'declining',
      },
      gateway,
      requiredOperations: collectFixtureCaseOperations(
        makeCase({ id: 'probe', backendFixture: { scenario: 's11-rsvp-durability-declining' } }),
      ).conversation,
    });
    expect(context?.priorState).toBe('declining');
    expect(context?.targetState).toBe('declining');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await store.count(context ? 'run-o1::cfg' : '', 'live_behavior.s11_rsvp_durability_confirms_once', 'rsvp.write')).toBe(0);

    await teardownFixtureRsvpIsolation({
      setup: {
        guestId: 584353,
        eventName: 'Otra celebración prueba',
        phone: '+51973296571',
        targetState: 'declining',
      },
      teardown: {
        guestId: 584353,
        eventName: 'Otra celebración prueba',
        phone: '+51973296571',
        restore: true,
      },
      context,
      gateway,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await store.count('run-o1::cfg', 'live_behavior.s11_rsvp_durability_confirms_once', 'rsvp.write')).toBe(0);
  });

  it('rejects setup when the explicit prior contradicts the fixture world', async () => {
    const loadResult = await loadFixtureData('s11-rsvp-durability-declining');
    if (loadResult.status !== 'loaded') return;
    const gateway = new FixtureAgentConversationGateway('s11-rsvp-durability-declining', loadResult, {
      runId: 'run-o1',
      caseId: 'case-prior',
    });
    await expect(setupFixtureRsvpIsolation({
      setup: {
        guestId: 584353,
        eventName: 'Otra celebración prueba',
        phone: '+51973296571',
        targetState: 'declining',
        priorState: 'attending',
      },
      gateway,
    })).rejects.toThrow('prior mismatch');
  });

  it('verifies fixture gateway operations; marker presence is insufficient', async () => {
    const loadResult = await loadFixtureData('s11-rsvp-durability-declining');
    if (loadResult.status !== 'loaded') return;
    const gateway = new FixtureAgentConversationGateway('s11-rsvp-durability-declining', loadResult, {
      runId: 'run-o1',
      caseId: 'case-ops',
    });
    expect(() => assertFixtureGatewayImplementsOperations(gateway, ['guestRsvp', 'getGuestEventsByPhone', 'getEventDetail'])).not.toThrow();
    expect(() => assertFixtureGatewayImplementsOperations({}, ['guestRsvp'])).toThrow(
      'does not implement required operations',
    );
  });
});

describe('O1 real-backend isolation fails closed', () => {
  it('is a setup error when no gateway is available', async () => {
    const saved = {
      SE_API_KEY: process.env.SE_API_KEY,
      AGENT_API_KEY: process.env.AGENT_API_KEY,
      CHANNEL_API_KEY: process.env.CHANNEL_API_KEY,
    };
    delete process.env.SE_API_KEY;
    delete process.env.AGENT_API_KEY;
    delete process.env.CHANNEL_API_KEY;
    try {
      await expect(setupRsvpIsolation({
        setup: { guestId: 1, eventName: 'E', phone: '+51900000001', targetState: 'attending' },
      })).rejects.toThrow('no backend gateway');
    } finally {
      if (saved.SE_API_KEY !== undefined) process.env.SE_API_KEY = saved.SE_API_KEY;
      if (saved.AGENT_API_KEY !== undefined) process.env.AGENT_API_KEY = saved.AGENT_API_KEY;
      if (saved.CHANNEL_API_KEY !== undefined) process.env.CHANNEL_API_KEY = saved.CHANNEL_API_KEY;
    }
  });

  it('is a setup error on ambiguous identity (two same-named events)', async () => {
    stubBackend({
      events: [
        { event_id: 100, name: 'Otra celebración prueba' },
        { event_id: 101, name: 'Otra celebración prueba' },
      ],
      attendance: null,
    });
    await expect(setupRsvpIsolation({
      setup: { guestId: 584353, eventName: 'Otra celebración prueba', phone: '+51973296571', targetState: 'declining' },
    })).rejects.toThrow('no known restorable prior');
  });

  it('is a setup error on inconclusive verification (no attendance record)', async () => {
    stubBackend({
      events: [{ event_id: 100, name: 'Otra celebración prueba' }],
      attendance: null,
    });
    await expect(setupRsvpIsolation({
      setup: { guestId: 584353, eventName: 'Otra celebración prueba', phone: '+51973296571', targetState: 'declining' },
    })).rejects.toThrow('no known restorable prior');
  });

  it('teardown without a setup context fails instead of scoring green', async () => {
    await expect(teardownRsvpIsolation(
      { teardown: { guestId: 1, eventName: 'E', phone: '+51900000001', restore: true } },
      null,
    )).rejects.toThrow('requires the setup context');
  });
});

describe('O1 willAttend precedence with hasResponded false', () => {
  it('holds attending/declining on the boolean and pending only when undecided', () => {
    expect(attendanceToIsolationState({ willAttend: true, hasResponded: false })).toBe('attending');
    expect(attendanceToIsolationState({ willAttend: false, hasResponded: false })).toBe('declining');
    expect(attendanceToIsolationState({ willAttend: null, hasResponded: false })).toBe('pending');
    expect(attendanceToIsolationState(null)).toBeNull();
  });
});

describe('O1 lane classification is fail-closed', () => {
  it('admits a fully fixture-scoped case to the parallel lane', () => {
    const verdict = classifyEvalCaseLane(makeCase({
      id: 'parallel-probe',
      backendFixture: { scenario: 's11-rsvp-durability-declining' },
      inputs: [{ text: 'hola', backendFixture: { scenario: 's11-rsvp-durability-declining' } }],
      expectations: [
        {
          id: 'writes-once',
          type: 'tool_usage' as const,
          mustCall: ['lookup_rsvp_invitations', 'guest_rsvp'],
          mustNotCall: [],
          severity: 'hard' as const,
        },
        {
          id: 'receipt',
          type: 'fixture_effect_count' as const,
          operation: 'rsvp.write' as const,
          expectedAttempts: 1,
          expectedSuccesses: 1,
          expectedReplays: 0,
          severity: 'hard' as const,
        },
      ],
    }));
    expect(verdict.lane).toBe('parallel');
  });

  it('sends fixture-less, unknown-tool, and literal-identity cases to external', () => {
    expect(classifyEvalCaseLane(makeCase({ id: 'no-fixture' })).lane).toBe('external');
    expect(classifyEvalCaseLane(makeCase({
      id: 'unknown-tool',
      backendFixture: { scenario: 's' },
      expectations: [{ id: 't', type: 'tool_usage' as const, mustCall: ['invented_backend_tool'], mustNotCall: [], severity: 'hard' as const }],
    })).lane).toBe('external');
    expect(classifyEvalCaseLane(makeCase({
      id: 'literal-identity',
      backendFixture: { scenario: 's' },
      expectations: [{ id: 'p', type: 'plan_field_equals' as const, path: 'external_user_id', expected: 'live-x', severity: 'hard' as const }],
    })).lane).toBe('external');
    expect(classifyEvalCaseLane(makeCase({
      id: 'real-isolation',
      rsvpIsolation: {
        setup: { guestId: 1, eventName: 'E', phone: '+51900000001', targetState: 'declining' },
        teardown: { guestId: 1, eventName: 'E', phone: '+51900000001', restore: true },
      },
    })).lane).toBe('external');
  });
});

describe('O1 external lane lock', () => {
  it('refuses a second owner and never steals on elapsed time', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'o1-lock-'));
    const first = acquireExternalLaneLock(dir, 'run-a');
    expect(() => acquireExternalLaneLock(dir, 'run-b')).toThrow('refusing a second owner');
    releaseExternalLaneLock(first);
    const second = acquireExternalLaneLock(dir, 'run-b');
    releaseExternalLaneLock(second);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('replaces only a lock whose PID is gone, and never deletes another owner on release', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'o1-lock-'));
    const lockPath = path.join(dir, '.eval-external-lane.lock');
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: 2147483647, runId: 'run-gone', startedAt: new Date(0).toISOString(), hostname: os.hostname() }),
      'utf8',
    );
    const acquired = acquireExternalLaneLock(dir, 'run-next');
    // A foreign lock is never removed by release.
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: 2147483647, runId: 'run-rival', startedAt: new Date(0).toISOString(), hostname: os.hostname() }),
      'utf8',
    );
    releaseExternalLaneLock(acquired);
    expect(await fs.readFile(lockPath, 'utf8')).toContain('run-rival');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('restricts external evaluations to the named coordinator host', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'o1-lock-'));
    vi.stubEnv('EVAL_COORDINATOR_HOST', 'some-other-host.invalid');
    expect(() => acquireExternalLaneLock(dir, 'run-a')).toThrow('restricted to coordinator host');
    vi.stubEnv('EVAL_COORDINATOR_HOST', '');
    expect(() => acquireExternalLaneLock(dir, 'run-a')).toThrow('EVAL_COORDINATOR_HOST');
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('O1 shared-phone executions stay disjoint', () => {
  it('separates chat, history, and effect state across scoped executions', async () => {
    const store = new InMemoryEvalFixtureStateStore();
    const phone = '+51987654321';
    const scoped = async (scopedRun: string, caseId: string): Promise<FixtureAgentConversationGateway> => {
      const loaded = await loadFixtureData('image-clean-world');
      if (loaded.status !== 'loaded') throw new Error('missing fixture');
      return new FixtureAgentConversationGateway('image-clean-world', loaded, {
        runId: scopedRun,
        caseId,
        conversationKey: 'conv-shared',
        stateStore: store,
      });
    };
    const runA = buildConfigScopedFixtureRunId('run-o1', 'cfg-a');
    const runB = buildConfigScopedFixtureRunId('run-o1', 'cfg-b');
    const gatewayA = await scoped(runA, 'case-shared');
    const gatewayB = await scoped(runB, 'case-shared');
    await gatewayA.logMessage({ phoneNumber: phone, body: 'mensaje A', direction: 'inbound', whatsappMessageId: 'wamid-a' });
    await gatewayB.logMessage({ phoneNumber: phone, body: 'mensaje B', direction: 'inbound', whatsappMessageId: 'wamid-b' });
    const readA = await gatewayA.getRecentMessages(phone);
    const readB = await gatewayB.getRecentMessages(phone);
    if (readA.status !== 'success' || readB.status !== 'success') throw new Error('history read failed');
    expect(readA.messages.map((message) => message.body)).toEqual(['mensaje A']);
    expect(readB.messages.map((message) => message.body)).toEqual(['mensaje B']);
    await gatewayA.requestHumanTakeover(phone);
    expect(await store.count(runA, 'case-shared', 'handoff.write')).toBe(1);
    expect(await store.count(runB, 'case-shared', 'handoff.write')).toBe(0);
  });
});
