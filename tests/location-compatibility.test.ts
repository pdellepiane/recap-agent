import { describe, expect, it } from 'vitest';

import { classifyLocationCompatibility } from '../src/core/location';

describe('location compatibility', () => {
  it('treats Lima districts and Lima city as compatible', () => {
    expect(classifyLocationCompatibility('Miraflores, Lima', 'Lima, Perú')).toBe(
      'compatible',
    );
    expect(classifyLocationCompatibility('San Isidro, Lima', 'Cieneguilla, Lima, Perú')).toBe(
      'compatible',
    );
  });

  it('rejects cross-region and cross-country providers', () => {
    expect(classifyLocationCompatibility('Lima, Perú', 'Provincia de Ica, Perú')).toBe(
      'mismatch',
    );
    expect(classifyLocationCompatibility('Lima, Perú', 'Tulum, México')).toBe(
      'mismatch',
    );
  });

  it('keeps country-only locations as unknown rather than inventing city coverage', () => {
    expect(classifyLocationCompatibility('Miraflores, Lima', 'Perú')).toBe('unknown');
    expect(classifyLocationCompatibility('Lima', null)).toBe('unknown');
  });
});
