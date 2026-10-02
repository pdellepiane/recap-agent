import { describe, expect, it } from 'vitest';

import { classifyLocationCompatibility } from '../src/core/location';

describe('location compatibility', () => {
  it('classifies provider location compatibility without inventing coverage', () => {
    // Lima districts and Lima city are compatible.
    expect(classifyLocationCompatibility('Miraflores, Lima', 'Lima, Perú')).toBe(
      'compatible',
    );
    expect(classifyLocationCompatibility('San Isidro, Lima', 'Cieneguilla, Lima, Perú')).toBe(
      'compatible',
    );
    // Cross-region and cross-country providers mismatch.
    expect(classifyLocationCompatibility('Lima, Perú', 'Provincia de Ica, Perú')).toBe(
      'mismatch',
    );
    expect(classifyLocationCompatibility('Lima, Perú', 'Tulum, México')).toBe(
      'mismatch',
    );
    // Country-only locations stay unknown rather than inventing city coverage.
    expect(classifyLocationCompatibility('Miraflores, Lima', 'Perú')).toBe('unknown');
    expect(classifyLocationCompatibility('Lima', null)).toBe('unknown');
  });
});
