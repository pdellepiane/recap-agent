import { describe, expect, it, vi } from 'vitest';

import {
  assertKnownFlags,
  assertLiveBehaviorPrerequisites,
  main,
  parseCaseConcurrencyFlag,
  parseCaseIds,
  parseJudgeConcurrencyFlag,
  parseResumeMode,
  requireExplicitCaseIds,
  resolveSelectedLiveBehaviorCases,
} from '../src/evals/live-behavior-cli';
import type { EvalCase } from '../src/evals/case-schema';
import type { FixtureLoadResult } from '../src/runtime/eval-fixture-gateway';

describe('live-behavior-cli parseCaseIds', () => {
  it('parses repeatable --case selections in spaced and equals forms', () => {
    expect(parseCaseIds([])).toBeUndefined();
    expect(parseCaseIds(['--other', 'foo'])).toBeUndefined();
    expect(parseCaseIds(['--case', 'live_behavior.rsvp_cristian_phone_enriched_confirmation'])).toEqual([
      'live_behavior.rsvp_cristian_phone_enriched_confirmation',
    ]);
    expect(parseCaseIds(['--case', 'a', '--case', 'b', '--case', 'c'])).toEqual(['a', 'b', 'c']);
    expect(parseCaseIds(['--case=a', '--case=b'])).toEqual(['a', 'b']);
    expect(parseCaseIds(['--case', 'a', '--case=b', '--case', 'c'])).toEqual(['a', 'b', 'c']);
    expect(parseCaseIds(['--case'])).toBeUndefined();
    expect(parseCaseIds(['--case', '--case', 'foo'])).toEqual(['foo']);
  });
});

describe('live-behavior-cli help', () => {
  it('prints usage for --help and -h without loading or calling runEvaluation', async () => {
    const runEvaluation = vi.fn(async () => ({
      runId: 'unexpected',
      runDir: 'unexpected',
      report: {
        totalCases: 0,
        passedCases: 0,
        failedCases: 0,
        erroredCases: 0,
        skippedCases: 0,
      },
    }));
    const loadRunner = vi.fn(async () => runEvaluation);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await main(['--help'], loadRunner);
      expect(write).toHaveBeenCalledWith(expect.stringContaining('Usage: npm run eval:behavior-live'));
      await expect(main(['-h'], loadRunner)).resolves.toBeUndefined();
    } finally {
      write.mockRestore();
    }

    expect(loadRunner).not.toHaveBeenCalled();
    expect(runEvaluation).not.toHaveBeenCalled();
  });

});

describe('live-behavior-cli concurrency flags (O2)', () => {
  it('parses bounded concurrency flags with defaults', () => {
    expect(parseCaseConcurrencyFlag([])).toBe(4);
    expect(parseJudgeConcurrencyFlag([])).toBe(2);
    expect(parseCaseConcurrencyFlag(['--case', 'a'])).toBe(4);
    expect(parseCaseConcurrencyFlag(['--case-concurrency', '3'])).toBe(3);
    expect(parseCaseConcurrencyFlag(['--case-concurrency=1'])).toBe(1);
    expect(parseJudgeConcurrencyFlag(['--judge-concurrency', '1'])).toBe(1);
    expect(parseJudgeConcurrencyFlag(['--judge-concurrency=2'])).toBe(2);
    expect(() => parseCaseConcurrencyFlag(['--case-concurrency'])).toThrow(/missing value/i);
    expect(() => parseCaseConcurrencyFlag(['--case-concurrency', '--case', 'a'])).toThrow(/missing value/i);
    expect(() => parseCaseConcurrencyFlag(['--case-concurrency='])).toThrow(/missing value/i);
    expect(() => parseCaseConcurrencyFlag(['--case-concurrency', '0'])).toThrow(/1\.\.4/);
    expect(() => parseCaseConcurrencyFlag(['--case-concurrency', '5'])).toThrow(/1\.\.4/);
    expect(() => parseCaseConcurrencyFlag(['--case-concurrency', 'two'])).toThrow();
    expect(() => parseJudgeConcurrencyFlag(['--judge-concurrency', '0'])).toThrow(/1\.\.2/);
    expect(() => parseJudgeConcurrencyFlag(['--judge-concurrency', '3'])).toThrow(/1\.\.2/);
  });

  it('rejects unknown flags but keeps repeatable --case', () => {
    expect(() => assertKnownFlags(['--bogus'])).toThrow(/unknown flag/i);
    expect(() => assertKnownFlags(['--case-concurrencyy', '2'])).toThrow(/unknown flag/i);
    expect(() => assertKnownFlags(['-x'])).toThrow(/unknown flag/i);
    expect(() => assertKnownFlags(['--case', 'a', '--case', 'b'])).not.toThrow();
    expect(() => assertKnownFlags(['--case-concurrency', '2', '--judge-concurrency=1'])).not.toThrow();
    expect(parseCaseIds(['--case', 'a', '--case', 'b'])).toEqual(['a', 'b']);
    expect(parseResumeMode([])).toBe('full');
    expect(parseResumeMode(['--resume-mode=diagnostic'])).toBe('diagnostic');
    expect(() => parseResumeMode(['--resume-mode', 'partial'])).toThrow(/full or diagnostic/);
  });

  it('dispatches the hard-contract selection without local judge credentials', async () => {
    const previousKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const seen: Array<Record<string, unknown>> = [];
    const runEvaluation = vi.fn(async (options: Record<string, unknown>) => {
      seen.push(options);
      return {
        runId: 'run-1',
        runDir: 'dir-1',
        report: { totalCases: 1, passedCases: 1, failedCases: 0, erroredCases: 0, skippedCases: 0 },
      };
    });
    const loadRunner = vi.fn(async () => runEvaluation);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fakeCase = {
      id: 'a',
      backendFixture: undefined,
      inputs: [{ text: 'hola' }],
    } as unknown as EvalCase;
    const caseB = { id: 'b', backendFixture: undefined, inputs: [{ text: 'hola' }] } as unknown as EvalCase;
    try {
      await main(['--case', 'a', '--case-concurrency', '3', '--judge-concurrency=1'], loadRunner, {
        loadCatalog: async () => ({ cases: [fakeCase], suites: [], templates: new Map() }),
        loadFixture: async () => ({ status: 'loaded', data: {} }) as unknown as FixtureLoadResult,
      });
      await main(['--case', 'a', '--case', 'b'], loadRunner, {
        loadCatalog: async () => ({ cases: [fakeCase, caseB], suites: [], templates: new Map() }),
        loadFixture: async () => ({ status: 'loaded', data: {} }) as unknown as FixtureLoadResult,
      });
    } finally {
      write.mockRestore();
      if (previousKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousKey;
      }
    }
    expect(seen[0]).toMatchObject({
      suite: 'live_behavior_regression',
      target: 'live_lambda',
      caseIds: ['a'],
      requestedCaseConcurrency: 3,
      requestedJudgeConcurrency: 1,
      resumeMode: 'full',
    });
    expect(loadRunner).toHaveBeenCalledTimes(2);
    expect(runEvaluation).toHaveBeenCalledTimes(2);
    expect(seen[1]).toMatchObject({ caseIds: ['a', 'b'] });
  });

});

describe('live-behavior-cli import-safe selection (Finding 3)', () => {
  it('does not execute on import without VITEST', async () => {
    const previousArgv1 = process.argv[1];
    const previousVitest = process.env.VITEST;
    const previousExitCode = process.exitCode;
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      process.argv[1] = '/some/other/script.js';
      delete process.env.VITEST;
      process.exitCode = undefined;
      vi.resetModules();
      await import('../src/evals/live-behavior-cli');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(process.exitCode).toBeUndefined();
      expect(stderrWrite).not.toHaveBeenCalled();
    } finally {
      stderrWrite.mockRestore();
      stdoutWrite.mockRestore();
      process.argv[1] = previousArgv1;
      if (previousVitest === undefined) {
        delete process.env.VITEST;
      } else {
        process.env.VITEST = previousVitest;
      }
      process.exitCode = previousExitCode;
      vi.resetModules();
    }
  });

  it('rejects unknown IDs and missing prerequisites with zero dispatch', async () => {
    expect(() => requireExplicitCaseIds(undefined)).toThrow(/explicit case selection/i);
    expect(() => requireExplicitCaseIds([])).toThrow(/explicit case selection/i);
    const emptyRunner = vi.fn();
    const emptyLoader = vi.fn(async () => emptyRunner);
    await expect(main([], emptyLoader)).rejects.toThrow(/explicit case selection/i);
    expect(emptyLoader).not.toHaveBeenCalled();
    expect(emptyRunner).not.toHaveBeenCalled();

    const known = { id: 'known.case', backendFixture: undefined, inputs: [{ text: 'hola' }] } as unknown as EvalCase;
    expect(() => resolveSelectedLiveBehaviorCases({ cases: [known] }, ['missing.case'])).toThrow(/unknown.*missing\.case/i);

    const withFixture = {
      id: 'fixture.case',
      backendFixture: { scenario: 'missing-scenario' },
      inputs: [{ text: 'hola', backendFixture: { scenario: 'missing-scenario' } }],
    } as unknown as EvalCase;
    await expect(assertLiveBehaviorPrerequisites([withFixture], async (scenario) => ({
      status: 'unknown_scenario',
      scenario,
      error: 'Unknown fixture scenario.',
    }))).rejects.toThrow(/prerequisite missing.*missing-scenario/i);

    const withPhonePlaceholder = {
      id: 'phone.case',
      inputs: [{ text: 'hola', contactPhone: '$MISSING_TEST_PHONE_VAR_XYZ' }],
    } as unknown as EvalCase;
    delete process.env.MISSING_TEST_PHONE_VAR_XYZ;
    await expect(assertLiveBehaviorPrerequisites(
      [withPhonePlaceholder],
      async () => ({ status: 'loaded', data: {} }) as unknown as FixtureLoadResult,
    )).rejects.toThrow(/MISSING_TEST_PHONE_VAR_XYZ is required/i);

    const runEvaluation = vi.fn();
    const loadRunner = vi.fn(async () => runEvaluation);
    await expect(main(['--case', 'missing.case'], loadRunner, {
      loadCatalog: async () => ({ cases: [known], suites: [], templates: new Map() }),
      loadFixture: async () => ({ status: 'loaded', data: {} }) as unknown as FixtureLoadResult,
    })).rejects.toThrow(/unknown.*missing\.case/i);
    expect(loadRunner).not.toHaveBeenCalled();
    expect(runEvaluation).not.toHaveBeenCalled();

    await expect(main(['--case', 'fixture.case'], loadRunner, {
      loadCatalog: async () => ({ cases: [withFixture], suites: [], templates: new Map() }),
      loadFixture: async (scenario) => ({ status: 'unknown_scenario', scenario, error: 'Unknown.' }),
    })).rejects.toThrow(/prerequisite missing/i);
    expect(loadRunner).not.toHaveBeenCalled();
  });

});

describe('live-behavior-cli exact cost streaming', () => {
  it('passes pricing, streams per-case lines to stderr, and reports cost in the summary', async () => {
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    const seen: Array<Record<string, unknown>> = [];
    const costSummary = {
      priced: true,
      pricingVersion: '2026-08-04',
      openaiUsd: 0.001,
      judgeUsd: 0.002,
      lambdaUsd: 0.00003,
      totalUsd: 0.00303,
      unpricedCases: [],
      unpricedModels: [],
    };
    const runEvaluation = vi.fn(async (options: Record<string, unknown>) => {
      seen.push(options);
      (options.onCaseComplete as (event: unknown) => void)({
        caseId: 'a',
        status: 'ok',
        executed: true,
        settledCases: 1,
        totalCases: 1,
        caseCostUsd: 0.00303,
        runningCostUsd: 0.00303,
        priced: true,
      });
      return {
        runId: 'run-1',
        runDir: 'dir-1',
        report: {
          totalCases: 1,
          passedCases: 1,
          failedCases: 0,
          erroredCases: 0,
          skippedCases: 0,
          costSummary,
        },
      };
    });
    const loadRunner = vi.fn(async () => runEvaluation);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const fakeCase = {
      id: 'a',
      backendFixture: undefined,
      inputs: [{ text: 'hola' }],
    } as unknown as EvalCase;
    let stderr = '';
    let stdout = '';
    try {
      await main(['--case', 'a'], loadRunner, {
        loadCatalog: async () => ({ cases: [fakeCase], suites: [], templates: new Map() }),
        loadFixture: async () => ({ status: 'loaded', data: {} }) as unknown as FixtureLoadResult,
      });
      // Capture before restore: mockRestore clears call history.
      stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
      stdout = stdoutWrite.mock.calls.map((call) => String(call[0])).join('');
    } finally {
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
      if (previousKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousKey;
      }
    }
    expect(String(seen[0]?.pricingPath)).toMatch(/studies\/pricing-\d{4}-\d{2}-\d{2}\.json$/);
    expect(typeof seen[0]?.onCaseComplete).toBe('function');
    expect(stderr).toContain('[1/1] a ok case=$0.003030 running=$0.003030');
    expect(stdout).not.toContain('[1/1]');
    const parsed = JSON.parse(stdout) as { cost: unknown };
    expect(parsed.cost).toEqual(costSummary);
  });
});
