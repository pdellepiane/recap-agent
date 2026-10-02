import { describe, expect, it } from 'vitest';

import type { ProviderPlanOperation } from '../src/runtime/extraction-schemas';
import { missingSelectionTraceOperations } from '../src/runtime/selection-trace-operations';

function op(type: ProviderPlanOperation['type'], category: string): ProviderPlanOperation {
  return {
    type,
    category: category as ProviderPlanOperation['category'],
    preferences: [],
    hardConstraints: [],
    queryIntent: null,
    rerunSearch: false,
    provider: null,
    removeProvider: null,
    addProvider: null,
  };
}

describe('F4 hint-resolved provider selection is recorded in trace operations', () => {
  it('records exactly the missing selection trace operations', () => {
    // A synthetic select_provider operation per resolved category when extraction has none.
    const missing = missingSelectionTraceOperations({
      existing: [],
      selectedCategories: ['Catering'],
    });
    expect(missing).toHaveLength(1);
    expect(missing[0]?.type).toBe('select_provider');
    expect(missing[0]?.category).toBe('Catering');
    // No duplicate when the extraction already carries the operation.
    expect(missingSelectionTraceOperations({
      existing: [op('select_provider', 'Catering')],
      selectedCategories: ['Catering'],
    })).toHaveLength(0);
    // No operations when the selection did not resolve.
    expect(missingSelectionTraceOperations({
      existing: [],
      selectedCategories: [],
    })).toHaveLength(0);
  });
});
