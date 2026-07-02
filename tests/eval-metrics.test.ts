import { describe, expect, it } from 'vitest';

import { mean, median, percentile, wilsonInterval } from '../src/evals/metrics';

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
