import { describe, expect, it, vi } from 'vitest';

import { main, parseCaseIds } from '../src/evals/live-behavior-cli';

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
