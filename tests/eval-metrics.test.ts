import { describe, expect, it } from 'vitest';

import { mean, median, percentile, wilsonInterval } from '../src/evals/metrics';
import { summarizeExpectedNeedEvaluation } from '../src/evals/technical-study';

describe('evaluation metric primitives', () => {
  it('calculates deterministic distributions', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
    expect(percentile([], 95)).toBe(0);
  });

  it('calculates a bounded 95 percent Wilson interval', () => {
    const interval = wilsonInterval(48, 50);
    expect(interval.lower).toBeGreaterThan(0.86);
    expect(interval.upper).toBeLessThanOrEqual(1);
    expect(wilsonInterval(0, 0)).toEqual({ lower: 0, upper: 0 });
  });
});

describe('expected need evaluation', () => {
  it('separates extraction recall from retrieval coverage', () => {
    expect(summarizeExpectedNeedEvaluation([
      {
        expectedCategories: ['Locales', 'Catering', 'Música'],
        extractedNeeds: [
          { category: 'Locales', hasRecommendations: true },
          { category: 'Catering', hasRecommendations: false },
          { category: 'Otros', hasRecommendations: true },
        ],
      },
      {
        expectedCategories: ['Hogar y deco'],
        extractedNeeds: [
          { category: 'Hogar y deco', hasRecommendations: true },
        ],
      },
    ])).toEqual({
      expected: 4,
      extracted: 3,
      extractionRecall: 0.75,
      extractedAndRecommended: 2,
      retrievalCoverageGivenExtraction: 2 / 3,
      endToEndCoverage: 0.5,
      unexpectedExtractedNeeds: 1,
    });
  });
});
