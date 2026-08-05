import { describe, expect, it } from 'vitest';

import { evaluateSemanticJudgeOutcome } from '../src/evals/scorers/semantic-judge';

describe('semantic judge expectation policy', () => {
  it('fails closed when a mandatory live judge is skipped', () => {
    expect(
      evaluateSemanticJudgeOutcome({
        outcome: {
          skipped: true,
          score: 0,
          message: 'Missing evaluator credentials.',
        },
        minScore: 0.85,
        requireJudge: true,
      }),
    ).toEqual({ passed: false, score: 0 });
  });

  it('preserves optional semantic checks for offline development', () => {
    expect(
      evaluateSemanticJudgeOutcome({
        outcome: {
          skipped: true,
          score: 0,
          message: 'Missing evaluator credentials.',
        },
        minScore: 0.85,
        requireJudge: false,
      }),
    ).toEqual({ passed: true, score: 1 });
  });

  it('applies the configured threshold when the judge runs', () => {
    expect(
      evaluateSemanticJudgeOutcome({
        outcome: {
          skipped: false,
          score: 0.84,
          message: 'A required behavior was missing.',
        },
        minScore: 0.85,
        requireJudge: true,
      }),
    ).toEqual({ passed: false, score: 0.84 });
  });
});
