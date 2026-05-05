import type { FormattedProviderArticle, ProviderSyncRecord } from './types';

function escapeYamlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function yamlString(value: string | null | undefined): string {
  return value ? `"${escapeYamlString(value)}"` : 'null';
}

function yamlList(values: string[]): string {
  return `[${values.map((value) => `"${escapeYamlString(value)}"`).join(', ')}]`;
}

function normalizeWhitespace(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function section(title: string, lines: string[]): string[] {
  if (lines.length === 0) {
    return [];
  }

  return [`## ${title}`, '', ...lines, ''];
}

function bulletLines(values: string[]): string[] {
  return values.map((value) => `- ${value}`);
}

export function formatProviderToMarkdown(
  provider: ProviderSyncRecord,
): FormattedProviderArticle {
  const description = normalizeWhitespace(provider.description);
  const promoSummary = normalizeWhitespace(provider.promoSummary);
  const metadata = {
    providerId: provider.id,
    title: provider.title,
    slug: provider.slug ?? null,
    category: provider.category ?? null,
    city: provider.city,
    country: provider.country,
    location: provider.location ?? null,
    priceLevel: provider.priceLevel ?? null,
    detailUrl: provider.detailUrl ?? null,
    sourceUrl: provider.detailUrl ?? null,
  };

  const frontmatter = [
    '---',
    `provider_id: ${metadata.providerId}`,
    `title: ${yamlString(metadata.title)}`,
    `slug: ${yamlString(metadata.slug)}`,
    `category: ${yamlString(metadata.category)}`,
    `city: ${yamlString(metadata.city)}`,
    `country: ${yamlString(metadata.country)}`,
    `location: ${yamlString(metadata.location)}`,
    `price_level: ${yamlString(metadata.priceLevel)}`,
    `detail_url: ${yamlString(metadata.detailUrl)}`,
    `source_url: ${yamlString(metadata.sourceUrl)}`,
    `event_types: ${yamlList(provider.eventTypes ?? [])}`,
    '---',
    '',
  ];

  const body = [
    `# ${provider.title}`,
    '',
    `Proveedor ID: ${provider.id}`,
    provider.category ? `Categoría: ${provider.category}` : null,
    provider.location ? `Ubicación: ${provider.location}` : null,
    provider.priceLevel ? `Nivel de precio: ${provider.priceLevel}` : null,
    provider.minPrice ? `Precio mínimo: ${provider.minPrice}` : null,
    provider.maxPrice ? `Precio máximo: ${provider.maxPrice}` : null,
    provider.rating ? `Rating: ${provider.rating}` : null,
    provider.websiteUrl ? `Web: ${provider.websiteUrl}` : null,
    provider.detailUrl ? `Ficha pública: ${provider.detailUrl}` : null,
    '',
    ...section('Descripción', description ? [description] : []),
    ...section(
      'Promoción',
      [provider.promoBadge ?? null, promoSummary].filter(
        (value): value is string => Boolean(value),
      ),
    ),
    ...section('Servicios destacados', bulletLines(provider.serviceHighlights)),
    ...section('Términos destacados', bulletLines(provider.termsHighlights)),
    ...section('Tipos de evento', bulletLines(provider.eventTypes ?? [])),
  ].filter((value): value is string => value !== null);

  return {
    metadata,
    markdown: [...frontmatter, ...body].join('\n'),
  };
}
