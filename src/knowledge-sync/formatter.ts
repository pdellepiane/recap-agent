import type { ArticleMetadata, FormattedArticle, ScrapedArticle } from './types';

/**
 * Map Tawk category names to article types.
 * Heuristic based on observed categories in sinenvolturas.tawk.help.
 */
function mapCategoryToArticleType(category: string): string {
  const normalized = category.toLowerCase().trim();

  if (normalized.includes('pago') || normalized.includes('precio') || normalized.includes('costo') || normalized.includes('comisión')) {
    return 'pricing';
  }
  if (normalized.includes('faq') || normalized.includes('pregunta')) {
    return 'faq';
  }
  if (normalized.includes('tutorial') || normalized.includes('guía') || normalized.includes('cómo')) {
    return 'tutorial';
  }
  if (normalized.includes('anuncio') || normalized.includes('actualización') || normalized.includes('novedad')) {
    return 'announcement';
  }
  if (normalized.includes('política') || normalized.includes('término') || normalized.includes('legal')) {
    return 'policy';
  }
  if (normalized.includes('evento') || normalized.includes('celebración') || normalized.includes('boda')) {
    return 'event_guide';
  }
  if (normalized.includes('sobre') || normalized.includes('introducción') || normalized.includes('qué es')) {
    return 'about';
  }

  return 'faq';
}

/**
 * Extract simple tags from article content by scanning for keywords.
 * This is a lightweight heuristic; no NLP required.
 */
function extractTags(content: string, category: string): string[] {
  const tags = new Set<string>();
  const text = content.toLowerCase();

  const keywordMap: Record<string, string[]> = {
    pago: ['pago', 'pagos', 'transferencia', 'yape', 'plin', 'tarjeta', 'paypal'],
    comision: ['comisión', 'fee', 'tarifa', 'costo'],
    lista_regalo: ['lista de regalo', 'lista de regalos', 'regalo', 'regalos'],
    evento: ['evento', 'boda', 'matrimonio', 'baby shower', 'cumpleaños', 'celebración'],
    cuenta: ['cuenta', 'usuario', 'login', 'registro', 'contraseña'],
    invitado: ['invitado', 'invitados', 'asistente', 'confirmación'],
    proveedor: ['proveedor', 'proveedores', 'local', 'salón', 'fotógrafo', 'catering'],
    transferencia: ['transferencia', 'depósito', 'banco'],
  };

  for (const [tag, keywords] of Object.entries(keywordMap)) {
    if (keywords.some((kw) => text.includes(kw))) {
      tags.add(tag);
    }
  }

  // Add category-derived tag if it maps cleanly
  const categoryTag = category.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  if (categoryTag.length > 0) {
    tags.add(categoryTag);
  }

  return Array.from(tags).slice(0, 8);
}

/**
 * Infer related topics from content. Lightweight heuristics.
 * TODO: When response scripts are confirmed, add script_id mapping here.
 */
function extractRelatedTopics(content: string, category: string): string[] {
  const topics = new Set<string>();
  const text = content.toLowerCase();

  if (text.includes('pago') || text.includes('transferencia') || text.includes('tarjeta')) {
    topics.add('pagos');
  }
  if (text.includes('regalo') || text.includes('lista')) {
    topics.add('listas-de-regalo');
  }
  if (text.includes('evento') || text.includes('boda') || text.includes('celebración')) {
    topics.add('eventos');
  }
  if (text.includes('invitado') || text.includes('confirmación')) {
    topics.add('invitados');
  }
  if (text.includes('proveedor') || text.includes('local') || text.includes('salón')) {
    topics.add('proveedores');
  }
  if (text.includes('cuenta') || text.includes('usuario')) {
    topics.add('cuenta-usuario');
  }

  // Include normalized category as a topic
  const catTopic = category.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (catTopic.length > 0) {
    topics.add(catTopic);
  }

  return Array.from(topics).slice(0, 5);
}

export function buildArticleMetadata(
  article: ScrapedArticle,
  baseUrl: string,
): ArticleMetadata {
  return {
    title: article.title,
    slug: article.slug,
    category: article.category,
    articleType: mapCategoryToArticleType(article.category),
    tags: extractTags(article.content, article.category),
    sourceUrl: new URL(`/article/${article.slug}`, baseUrl).toString(),
    lastUpdated: article.updatedAt,
    relatedTopics: extractRelatedTopics(article.content, article.category),
  };
}

export function formatArticleToMarkdown(article: ScrapedArticle, baseUrl: string): FormattedArticle {
  const metadata = buildArticleMetadata(article, baseUrl);

  const frontmatterLines = [
    '---',
    `title: "${metadata.title.replace(/"/g, '\\"')}"`,
    `slug: ${metadata.slug}`,
    `category: "${metadata.category}"`,
    `article_type: ${metadata.articleType}`,
    `tags: [${metadata.tags.map((t) => `"${t}"`).join(', ')}]`,
    `source_url: "${metadata.sourceUrl}"`,
    ...(metadata.lastUpdated ? [`last_updated: "${metadata.lastUpdated}"`] : []),
    `related_topics: [${metadata.relatedTopics.map((t) => `"${t}"`).join(', ')}]`,
    '---',
    '',
    article.content,
  ];

  return {
    metadata,
    markdown: frontmatterLines.join('\n'),
  };
}
