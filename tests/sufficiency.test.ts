import { describe, expect, it } from 'vitest';

import { createEmptyPlan, mergePlan } from '../src/core/plan';
import { computeSearchSufficiency } from '../src/core/sufficiency';

describe('computeSearchSufficiency', () => {
  it('requires category, location, and budget or guest range', () => {
    const empty = createEmptyPlan({
      planId: 'plan_1',
      channel: 'terminal',
      externalUserId: 'user_1',
    });

    expect(computeSearchSufficiency(empty)).toEqual({
      searchReady: false,
      missingFields: ['vendor_category', 'location', 'budget_or_guest_range'],
    });

    const ready = mergePlan(empty, {
      vendor_category: 'fotografía',
      location: 'Lima',
      budget_signal: '$$',
    });

    expect(computeSearchSufficiency(ready)).toEqual({
      searchReady: true,
      missingFields: [],
    });
  });
});

