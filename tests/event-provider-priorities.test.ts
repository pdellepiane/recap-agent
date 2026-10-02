import { describe, expect, it } from 'vitest';

import {
  prioritizedProviderCategoriesForEvent,
  starterProviderCategoriesForEvent,
} from '../src/core/event-provider-priorities';

describe('event provider priorities', () => {
  it('keeps wedding planners in wedding priorities', () => {
    expect(prioritizedProviderCategoriesForEvent('boda')).toContain('Wedding planners');
  });

  it('returns compact starter menus without wedding planners by default', () => {
    expect(starterProviderCategoriesForEvent('cumpleanos')).not.toContain('Wedding planners');
    expect(starterProviderCategoriesForEvent('boda')).toEqual([
      'Locales',
      'Catering',
      'Fotografía y video',
      'Música',
      'Florería y papelería',
    ]);
  });
});
