import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runEvaluation } from '../src/evals/runner';
import type { EvalCase } from '../src/evals/case-schema';

vi.mock('../src/evals/rsvp-isolation', async () => {
  const actual = await vi.importActual('../src/evals/rsvp-isolation') as unknown as Record<string, unknown>;
  return {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    ...(actual as Record<string, unknown>),
    setupRsvpIsolation: vi.fn((actual as unknown as { setupRsvpIsolation: (...args: unknown[]) => unknown }).setupRsvpIsolation),
    teardownRsvpIsolation: vi.fn((actual as unknown as { teardownRsvpIsolation: (...args: unknown[]) => unknown }).teardownRsvpIsolation),
  };
});

import { setupRsvpIsolation, teardownRsvpIsolation } from '../src/evals/rsvp-isolation';

describe('rsvp isolation hooks', () => {
  const evalsDir = path.resolve(process.cwd(), 'evals');
  const outputDir = path.resolve(process.cwd(), '.eval-runs-test');

  function makeCase(overrides: Partial<EvalCase> & { id: string }): EvalCase {
    return {
      suite: 'smoke',
      version: 1,
      description: 'hook test',
      targetModes: ['offline'],
      inputs: [{ text: 'hello', channel: 'terminal_whatsapp_eval' }],
      expectations: [],
      scorers: [],
      tags: [],
      priority: 'p2',
      status: 'active',
      variables: {},
      imports: [],
      ...overrides,
    } as EvalCase;
  }

  it('executes setup before case and teardown after case', async () => {
    const callOrder: string[] = [];
    const mockedSetup = vi.mocked(setupRsvpIsolation);
    const mockedTeardown = vi.mocked(teardownRsvpIsolation);
    mockedSetup.mockImplementation(async () => {
      callOrder.push('setup');
      // call real to keep context handling but record order
      return { guestId: 584353, eventName: 'Otra celebración prueba', phone: '+51973296571', priorState: null, targetState: 'declining' };
    });
    mockedTeardown.mockImplementation(async () => {
      callOrder.push('teardown');
    });

    const testCase = makeCase({
      id: 'hook-order-case',
      rsvpIsolation: {
        setup: { guestId: 584353, eventName: 'Otra celebración prueba', phone: '+51973296571', targetState: 'declining' },
        teardown: { guestId: 584353, eventName: 'Otra celebración prueba', phone: '+51973296571', restore: true },
      },
    });

    const result = await runEvaluation({
      evalsDir,
      outputDir,
      target: 'offline',
      caseOverrides: [testCase],
    });

    expect(callOrder).toEqual(['setup', 'teardown']);
    expect(result.report.results[0]?.status).toBe('passed');
    mockedSetup.mockRestore();
    mockedTeardown.mockRestore();
  });

  it('setup failure marks case as errored and does not silently skip', async () => {
    const mockedSetup = vi.mocked(setupRsvpIsolation);
    mockedSetup.mockRejectedValue(new Error('setup boom'));

    const testCase = makeCase({
      id: 'hook-setup-fails',
      rsvpIsolation: {
        setup: { guestId: 584353, eventName: 'Otra celebración prueba', phone: '+51973296571', targetState: 'declining' },
      },
    });

    const result = await runEvaluation({
      evalsDir,
      outputDir,
      target: 'offline',
      caseOverrides: [testCase],
    });

    expect(result.report.results[0]?.status).toBe('errored');
    expect(result.report.results[0]?.planDiffSummary[0]).toContain('RSVP isolation setup failed');
    mockedSetup.mockRestore();
  });

  it('teardown is still called after successful case and does not hide prior setup error', async () => {
    const callOrder: string[] = [];
    const mockedSetup = vi.mocked(setupRsvpIsolation);
    const mockedTeardown = vi.mocked(teardownRsvpIsolation);
    mockedSetup.mockImplementation(async () => {
      callOrder.push('setup');
      throw new Error('early setup fail');
    });
    mockedTeardown.mockImplementation(async () => {
      callOrder.push('teardown');
    });

    const testCase = makeCase({
      id: 'hook-teardown-after-setup-fail',
      rsvpIsolation: {
        setup: { guestId: 584353, eventName: 'Otra celebración prueba', phone: '+51973296571', targetState: 'declining' },
        teardown: { guestId: 584353, eventName: 'Otra celebración prueba', phone: '+51973296571', restore: true },
      },
    });

    const result = await runEvaluation({
      evalsDir,
      outputDir,
      target: 'offline',
      caseOverrides: [testCase],
    });

    expect(result.report.results[0]?.status).toBe('errored');
    expect(callOrder).toEqual(['setup', 'teardown']);
    mockedSetup.mockRestore();
    mockedTeardown.mockRestore();
  });

  it('rejects unknown rsvpIsolation fields via schema strictness', async () => {
    const { evalCaseSchema } = await import('../src/evals/case-schema');
    const bad = {
      id: 'bad-case',
      suite: 'smoke',
      version: 1,
      description: 'bad',
      targetModes: ['offline'],
      inputs: [{ text: 'hi' }],
      rsvpIsolation: {
        setup: { guestId: 584353, eventName: 'Otra celebración prueba', phone: '+51973296571', targetState: 'declining', unknownField: 'oops' },
      },
    };
    expect(() => evalCaseSchema.parse(bad)).toThrow();
  });
});
