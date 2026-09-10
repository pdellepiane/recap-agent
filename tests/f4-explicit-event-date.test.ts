import { describe, expect, it } from 'vitest';

import { resolveExplicitEventDate } from '../src/runtime/close-submission-summary';

describe('F4 explicit event date resolves without today or null substitution', () => {
  it('passes through a valid model ISO date', () => {
    expect(resolveExplicitEventDate('2026-10-18', 'Mi evento es el 18 de octubre de 2026.')).toBe(
      '2026-10-18',
    );
  });

  it('normalizes a model Spanish long-form date', () => {
    expect(resolveExplicitEventDate('18 de octubre de 2026', 'Mi evento es el 18/10/2026. Cierra el plan.')).toBe(
      '2026-10-18',
    );
  });

  it('falls back to the explicit date in the user message when the model value is unusable', () => {
    expect(
      resolveExplicitEventDate(
        'no-date',
        'Mi evento es el 18 de octubre de 2026. Por favor envia las cotizaciones.',
      ),
    ).toBe('2026-10-18');
  });

  it('parses numeric user dates with day-month-year order', () => {
    expect(resolveExplicitEventDate('', 'Mi evento es el 18/10/2026. Cierra el plan.')).toBe(
      '2026-10-18',
    );
  });

  it('rejects model-only dates and dates contradicted by user evidence', () => {
    expect(resolveExplicitEventDate('2026-10-18', 'mi teléfono es 51954779071')).toBeNull();
    expect(resolveExplicitEventDate('2026-10-18', 'Mi evento es el 20 de octubre de 2026.')).toBeNull();
    expect(resolveExplicitEventDate(null, '2026-10-18 o 2026-10-20')).toBeNull();
  });

  it('returns null instead of today when no explicit date exists', () => {
    expect(resolveExplicitEventDate('', 'Cierra el plan por favor.')).toBe(null);
    expect(resolveExplicitEventDate('manana', 'Cierra el plan por favor.')).toBe(null);
    expect(resolveExplicitEventDate(null, null)).toBe(null);
  });

  it('rejects calendar-invalid dates from either source', () => {
    expect(resolveExplicitEventDate('2026-13-40', 'Mi evento es el 40 de octubre de 2026.')).toBe(
      null,
    );
    expect(resolveExplicitEventDate('32 de enero de 2026', 'Sin fecha.')).toBe(null);
  });
});
