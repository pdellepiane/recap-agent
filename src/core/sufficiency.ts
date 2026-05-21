import { getActiveNeed, type PersistedPlan, type ProviderNeed } from './plan';
import type { NeedSufficiency } from './turn-decision';

export type SearchSufficiency = {
  searchReady: boolean;
  missingFields: string[];
};

export function computeSearchSufficiency(plan: PersistedPlan): SearchSufficiency {
  const missingFields: string[] = [];
  const activeNeed = getActiveNeed(plan);

  if (!activeNeed?.category) {
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

export function computeNeedSearchSufficiency(
  plan: PersistedPlan,
  need: ProviderNeed,
): NeedSufficiency {
  const missingFields: string[] = [];

  if (!need.category) {
    missingFields.push('vendor_category');
  }

  if (!plan.location) {
    missingFields.push('location');
  }

  if (!plan.budget_signal && !plan.guest_range) {
    missingFields.push('budget_or_guest_range');
  }

  return {
    category: need.category,
    searchReady: missingFields.length === 0,
    missingFields,
    hasShortlist: need.recommended_providers.length > 0,
    hasSelection: need.selected_provider_ids.length > 0,
  };
}

export function computeNeedSearchSufficiencies(plan: PersistedPlan): NeedSufficiency[] {
  return plan.provider_needs.map((need) => computeNeedSearchSufficiency(plan, need));
}
