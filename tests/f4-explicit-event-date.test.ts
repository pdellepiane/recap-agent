import { describe, expect, it } from 'vitest';

import { resolveExplicitEventDate } from '../src/runtime/close-submission-summary';

describe('explicit event date provenance', () => {
  it('accepts a model date only when the user supplied the same date', () => {
    expect(resolveExplicitEventDate('2026-10-18', 'Mi evento es el 18 de octubre de 2026.')).toBe('2026-10-18');
  });

  it('normalizes user-authored long and numeric dates', () => {
    expect(resolveExplicitEventDate('18 de octubre de 2026', 'Mi evento es el 18/10/2026.')).toBe('2026-10-18');
    expect(resolveExplicitEventDate('', 'Mi evento es el 18/10/2026.')).toBe('2026-10-18');
  });

  it('rejects prompt-only, contradicted, ambiguous and invalid dates', () => {
    expect(resolveExplicitEventDate('2026-10-18', 'mi teléfono es 51954779071')).toBeNull();
    expect(resolveExplicitEventDate('2026-10-18', 'Mi evento es el 20 de octubre de 2026.')).toBeNull();
    expect(resolveExplicitEventDate(null, '2026-10-18 o 2026-10-20')).toBeNull();
    expect(resolveExplicitEventDate('2026-13-40', 'Mi evento es el 40 de octubre de 2026.')).toBeNull();
  });
});
