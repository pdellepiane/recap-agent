import { describe, expect, it, vi } from 'vitest';

import {
  assertKnownFlags,
  main,
  parseCaseConcurrencyFlag,
  parseCaseIds,
  parseJudgeConcurrencyFlag,
  parseResumeMode,
} from '../src/evals/live-behavior-cli';

describe('live-behavior-cli parseCaseIds', () => {
  it('returns undefined when no --case flag is present', () => {
    expect(parseCaseIds([])).toBeUndefined();
    expect(parseCaseIds(['--other', 'foo'])).toBeUndefined();
  });

  it('parses single --case <id>', () => {
    expect(parseCaseIds(['--case', 'live_behavior.rsvp_cristian_phone_enriched_confirmation'])).toEqual([
      'live_behavior.rsvp_cristian_phone_enriched_confirmation',
    ]);
  });

  it('parses repeatable --case <id> flags', () => {
    expect(parseCaseIds(['--case', 'a', '--case', 'b', '--case', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('parses --case=<id> form', () => {
    expect(parseCaseIds(['--case=a', '--case=b'])).toEqual(['a', 'b']);
  });

  it('supports mixed spaced and equals forms', () => {
    expect(parseCaseIds(['--case', 'a', '--case=b', '--case', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('ignores incomplete trailing --case with no value', () => {
    expect(parseCaseIds(['--case'])).toBeUndefined();
  });

  it('ignores --case followed by another flag', () => {
    expect(parseCaseIds(['--case', '--case', 'foo'])).toEqual(['foo']);
  });
});

describe('live-behavior-cli help', () => {
  it('prints usage without loading or calling runEvaluation', async () => {
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
    } finally {
      write.mockRestore();
    }

    expect(loadRunner).not.toHaveBeenCalled();
    expect(runEvaluation).not.toHaveBeenCalled();
  });

  it('accepts the short help flag', async () => {
    const loadRunner = vi.fn(async () => {
      throw new Error('runner should not load for help');
    });

    await expect(main(['-h'], loadRunner)).resolves.toBeUndefined();
    expect(loadRunner).not.toHaveBeenCalled();
  });
});

describe('live-behavior-cli concurrency flags (O2)', () => {
  it('defaults to four case workers and two judges', () => {
    expect(parseCaseConcurrencyFlag([])).toBe(4);
    expect(parseJudgeConcurrencyFlag([])).toBe(2);
    expect(parseCaseConcurrencyFlag(['--case', 'a'])).toBe(4);
  });

  it('parses spaced and equals forms', () => {
    expect(parseCaseConcurrencyFlag(['--case-concurrency', '3'])).toBe(3);
    expect(parseCaseConcurrencyFlag(['--case-concurrency=1'])).toBe(1);
    expect(parseJudgeConcurrencyFlag(['--judge-concurrency', '1'])).toBe(1);
    expect(parseJudgeConcurrencyFlag(['--judge-concurrency=2'])).toBe(2);
  });

  it('rejects missing and invalid values', () => {
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

  it('passes bounded concurrency into runEvaluation with full-manifest default', async () => {
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
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
    try {
      await main(['--case', 'a', '--case-concurrency', '3', '--judge-concurrency=1'], loadRunner);
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
  });

  it('runs the unfiltered suite when no --case flag is present', async () => {
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    const seen: Array<Record<string, unknown>> = [];
    const runEvaluation = vi.fn(async (options: Record<string, unknown>) => {
      seen.push(options);
      return {
        runId: 'run-1',
        runDir: 'dir-1',
        report: { totalCases: 117, passedCases: 117, failedCases: 0, erroredCases: 0, skippedCases: 0 },
      };
    });
    const loadRunner = vi.fn(async () => runEvaluation);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await main([], loadRunner);
    } finally {
      write.mockRestore();
      if (previousKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousKey;
      }
    }
    // No case filter means the complete current manifest, never a count pin.
    expect(seen[0]).toMatchObject({ caseIds: undefined });
    expect('caseIds' in (seen[0] ?? {}) && seen[0]?.['caseIds']).toBeUndefined();
  });
});
