import { describe, expect, it } from 'vitest';

import { selectStarterProviderCategories } from '../src/runtime/agent-service';

describe('starter provider category selection', () => {
  it('preserves explicit provider needs without adding event defaults', () => {
    expect(selectStarterProviderCategories({
      eventType: 'baby_shower',
      explicitCategories: ['Locales'],
      maxNeeds: 5,
    })).toEqual(['Locales']);
    expect(selectStarterProviderCategories({
      eventType: 'boda',
      explicitCategories: ['Catering', 'Música', 'Fotografía y video'],
      maxNeeds: 5,
    })).toEqual(['Catering', 'Música', 'Fotografía y video']);
  });

  it('uses event defaults when no compact explicit set is established', () => {
    expect(selectStarterProviderCategories({
      eventType: 'boda',
      explicitCategories: [],
      maxNeeds: 3,
    })).toEqual(['Locales', 'Catering', 'Fotografía y video']);
  });
});
