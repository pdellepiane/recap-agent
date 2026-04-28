import type { ScrapedArticle } from './types';

export function articlesToMarkdown(articles: ScrapedArticle[]): string {
  const sections: string[] = [];

  for (const article of articles) {
    sections.push(`# ${article.title}`);
    sections.push('');
    sections.push(`**Categoría:** ${article.category}`);
    if (article.updatedAt) {
      sections.push(`**Actualizado:** ${article.updatedAt}`);
    }
    sections.push('');
    sections.push(article.content);
    sections.push('');
    sections.push('---');
    sections.push('');
  }

  return sections.join('\n');
}
