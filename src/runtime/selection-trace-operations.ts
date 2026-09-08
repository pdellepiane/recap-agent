import type { ProviderCategory } from '../core/provider-category';
import type { ProviderPlanOperation } from './extraction-schemas';

/**
 * F4 trace parity for hint-resolved provider selections. Selections resolved
 * from retained shortlist evidence (semantic hints such as cheaper/location
 * references) mutate the plan without an LLM-emitted providerPlanOperation,
 * so the trace summary would show no select_provider entry even though the
 * plan records the selection. This helper builds the missing synthetic
 * operations for the trace only; plan application never consumes them.
 */
export function missingSelectionTraceOperations(args: {
  existing: readonly ProviderPlanOperation[];
  selectedCategories: readonly string[];
}): ProviderPlanOperation[] {
  const recorded = new Set(
    args.existing.map((operation) => `${operation.type}:${operation.category ?? ''}`),
  );
  return args.selectedCategories
    .filter((category) => !recorded.has(`select_provider:${category}`))
    .map((category) => ({
      type: 'select_provider' as const,
      category: category as ProviderCategory,
      preferences: [],
      hardConstraints: [],
      queryIntent: null,
      rerunSearch: false,
      provider: null,
      removeProvider: null,
      addProvider: null,
    }));
}
