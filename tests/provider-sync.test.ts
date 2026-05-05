import { describe, expect, it } from 'vitest';
import type { ProviderSyncRecord } from '../src/provider-sync/types';
import { formatProviderToMarkdown } from '../src/provider-sync/formatter';

describe('provider sync formatter', () => {
  it('formats one provider as markdown with searchable metadata and Spanish content', () => {
    const provider: ProviderSyncRecord = {
      id: 115,
      title: 'Dj Naoki',
      slug: 'dj-naoki',
      category: 'Música',
      location: 'Lima, Perú',
      city: 'Lima',
      country: 'Perú',
      priceLevel: '$$',
      rating: '4.8',
      reason: null,
      detailUrl: 'https://sinenvolturas.com/proveedores/dj-naoki',
      websiteUrl: 'https://example.test',
      minPrice: null,
      maxPrice: null,
      promoBadge: '10% Off',
      promoSummary: 'Descuento para eventos contratados desde Sin Envolturas.',
      descriptionSnippet: 'DJ para bodas y eventos.',
      description: 'DJ para bodas y eventos con música comercial, latina y electrónica.',
      serviceHighlights: ['Música para fiesta', 'Iluminación básica'],
      termsHighlights: ['Sujeto a disponibilidad'],
      eventTypes: ['wedding', 'others'],
      raw: {},
    };

    const formatted = formatProviderToMarkdown(provider);

    expect(formatted.metadata.providerId).toBe(115);
    expect(formatted.metadata.category).toBe('Música');
    expect(formatted.markdown).toContain('provider_id: 115');
    expect(formatted.markdown).toContain('category: "Música"');
    expect(formatted.markdown).toContain('## Descripción');
    expect(formatted.markdown).toContain('DJ para bodas y eventos');
    expect(formatted.markdown).toContain('- Música para fiesta');
  });
});
