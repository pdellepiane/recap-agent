import { describe, expect, it } from 'vitest';

import {
  prioritizedProviderCategoriesForEvent,
  starterProviderCategoriesForEvent,
} from '../src/core/event-provider-priorities';

describe('event provider priorities', () => {
  it('keeps wedding planners in wedding priorities', () => {
    expect(prioritizedProviderCategoriesForEvent('boda')).toContain('Wedding planners');
  });

  it('does not offer wedding planners by default for birthdays', () => {
    expect(starterProviderCategoriesForEvent('cumpleanos')).not.toContain('Wedding planners');
  });

  it('returns a compact starter menu', () => {
    expect(starterProviderCategoriesForEvent('boda')).toEqual([
      'Locales',
      'Catering',
      'Fotografía y video',
      'Música',
      'Florería y papelería',
    ]);
  });
});
