import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EvalCase } from '../src/evals/case-schema';
import {
  assertLiveRegressionFixtureCoverage,
  classifyEvalCaseLane,
  collectFixtureCaseOperations,
  runEvaluation,
} from '../src/evals/runner';
import { setupFixtureRsvpIsolation } from '../src/evals/rsvp-isolation';
import {
  FixtureAgentConversationGateway,
  assertFixtureGatewayImplementsOperations,
  loadFixtureData,
} from '../src/runtime/eval-fixture-gateway';
import { InMemoryEvalFixtureStateStore } from '../src/runtime/eval-fixture-state';

function makeCase(overrides: Partial<EvalCase> & { id: string }): EvalCase {
  return {
    suite: 'live_behavior_regression',
    version: 1,
    description: 'Preflight coverage probe.',
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
  } as EvalCase;
}

function scopedCase(id: string): EvalCase {
  return makeCase({
    id,
    backendFixture: { scenario: 's11-rsvp-durability-declining' },
    inputs: [{ text: 'hola', backendFixture: { scenario: 's11-rsvp-durability-declining' } }],
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('§2 live_behavior_regression fixture-coverage preflight', () => {
  it('rejects a fixture-declaring case with a turn missing its scenario, naming case and turn', () => {
    const incomplete = makeCase({
      id: 'coverage-missing-turn',
      backendFixture: { scenario: 's11-rsvp-durability-declining' },
      inputs: [
        { text: 'hola', backendFixture: { scenario: 's11-rsvp-durability-declining' } },
        { text: 'sin escenario' },
      ],
    });
    expect(() => assertLiveRegressionFixtureCoverage([incomplete])).toThrow(
      /coverage-missing-turn.*turn 1.*no fixture scenario/,
    );
  });

  it('rejects an unknown exercised tool, naming case and operation', () => {
    const unknownTool = makeCase({
      id: 'coverage-unknown-tool',
      backendFixture: { scenario: 's11-rsvp-durability-declining' },
      inputs: [{ text: 'hola', backendFixture: { scenario: 's11-rsvp-durability-declining' } }],
      expectations: [
        {
          type: 'tool_usage',
          severity: 'hard',
          mustCall: ['definitely_not_a_real_tool'],
          mustNotCall: [],
        },
      ],
    });
    expect(() => assertLiveRegressionFixtureCoverage([unknownTool])).toThrow(
      /coverage-unknown-tool.*definitely_not_a_real_tool/,
    );
    // Unknown tools fail closed to the external lane, never parallel.
    expect(classifyEvalCaseLane(unknownTool).lane).toBe('external');
  });

  it('rejects a fully turn-scoped case that is not fixture-isolated, naming case and operations', () => {
    const literalIdentity = makeCase({
      id: 'coverage-literal-identity',
      backendFixture: { scenario: 's11-rsvp-durability-declining' },
      inputs: [{ text: 'hola', backendFixture: { scenario: 's11-rsvp-durability-declining' } }],
      expectations: [
        {
          type: 'tool_usage',
          severity: 'hard',
          mustCall: ['guest_rsvp'],
          mustNotCall: [],
        },
        {
          type: 'trace_field_equals',
          severity: 'hard',
          path: 'conversation_id',
          expected: 'literal-id',
        },
      ],
    });
    expect(classifyEvalCaseLane(literalIdentity).lane).toBe('external');
    expect(() => assertLiveRegressionFixtureCoverage([literalIdentity])).toThrow(
      /coverage-literal-identity.*not fully fixture-isolated.*guestRsvp/,
    );
  });

  it('allows real-backend integration checks with no fixture intent', () => {
    const realBackend = makeCase({
      id: 'coverage-real-backend',
      rsvpIsolation: {
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
      },
    });
    expect(() => assertLiveRegressionFixtureCoverage([realBackend])).not.toThrow();
    expect(classifyEvalCaseLane(realBackend).lane).toBe('external');
  });

  it('allows a fully fixture-covered case', () => {
    expect(() => assertLiveRegressionFixtureCoverage([scopedCase('coverage-complete')])).not.toThrow();
    expect(classifyEvalCaseLane(scopedCase('coverage-complete')).lane).toBe('parallel');
  });

  it('ignores suites and targets outside live_behavior_regression/live_lambda', () => {
    const offlinePartial = makeCase({
      id: 'coverage-offline-partial',
      suite: 'other_suite',
      targetModes: ['offline'],
      backendFixture: { scenario: 's11-rsvp-durability-declining' },
      inputs: [{ text: 'sin escenario' }],
    });
    expect(() => assertLiveRegressionFixtureCoverage([offlinePartial])).not.toThrow();
  });

  it('is never satisfied by EVAL_COORDINATOR_HOST, set or unset', () => {
    const incomplete = makeCase({
      id: 'coverage-host-independent',
      backendFixture: { scenario: 's11-rsvp-durability-declining' },
      inputs: [{ text: 'sin escenario' }],
    });
    vi.stubEnv('EVAL_COORDINATOR_HOST', os.hostname());
    expect(() => assertLiveRegressionFixtureCoverage([incomplete])).toThrow(/coverage-host-independent/);
    vi.stubEnv('EVAL_COORDINATOR_HOST', '');
    expect(() => assertLiveRegressionFixtureCoverage([incomplete])).toThrow(/coverage-host-independent/);
  });

  it('rejects incomplete coverage on a dry run before any remote call', async () => {
    const incomplete = makeCase({
      id: 'coverage-dry-run',
      backendFixture: { scenario: 's11-rsvp-durability-declining' },
      inputs: [{ text: 'sin escenario' }],
    });
    await expect(runEvaluation({
      evalsDir: path.resolve(process.cwd(), 'evals'),
      outputDir: path.resolve(process.cwd(), '.eval-runs-test'),
      target: 'live_lambda',
      dryRun: true,
      caseOverrides: [incomplete],
      disableSignalHandlers: true,
    })).rejects.toThrow(/coverage-dry-run.*turn 0.*no fixture scenario/);
  });
});

describe('§2 network tripwires: fixture operations never use real HTTP', () => {
  it('fixture RSVP setup performs zero real HTTP writes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('real HTTP is forbidden here'));
    const loadResult = await loadFixtureData('s11-rsvp-durability-declining');
    expect(loadResult.status).toBe('loaded');
    if (loadResult.status !== 'loaded') return;
    const store = new InMemoryEvalFixtureStateStore();
    const gateway = new FixtureAgentConversationGateway('s11-rsvp-durability-declining', loadResult, {
      runId: 'run-tripwire',
      caseId: 'case-tripwire',
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
      requiredOperations: collectFixtureCaseOperations(scopedCase('coverage-tripwire')).conversation,
    });
    expect(context?.priorState).toBe('declining');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('an unexpected operation fails closed with its exact name', () => {
    expect(() => assertFixtureGatewayImplementsOperations({}, ['guestRsvp'])).toThrow(
      /does not implement required operations: guestRsvp/,
    );
    expect(() => collectFixtureCaseOperations(makeCase({
      id: 'coverage-unexpected-op',
      expectations: [
        {
          type: 'tool_usage',
          severity: 'hard',
          mustCall: ['guest_rsvp'],
          mustNotCall: [],
        },
        {
          type: 'fixture_effect_count',
          severity: 'hard',
          operation: 'rsvp.write',
          expectedAttempts: 1,
          expectedSuccesses: 1,
          expectedReplays: 0,
        },
      ],
    }))).not.toThrow();
  });
});
