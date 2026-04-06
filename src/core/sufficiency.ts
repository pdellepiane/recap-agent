import type { PersistedPlan } from './plan';

export type SearchSufficiency = {
  searchReady: boolean;
  missingFields: string[];
};

export function computeSearchSufficiency(plan: PersistedPlan): SearchSufficiency {
  const missingFields: string[] = [];

  if (!plan.vendor_category) {
    missingFields.push('vendor_category');
  }

  if (!plan.location) {
    missingFields.push('location');
  }

  if (!plan.budget_signal && !plan.guest_range) {
    missingFields.push('budget_or_guest_range');
  }

  const searchReady = missingFields.length === 0;
  return { searchReady, missingFields };
}

