import { parse } from 'node-html-parser';
import type { ScrapedArticle, ScrapedCategory } from './types';

export class TawkHelpScraper {
  constructor(private readonly baseUrl: string) {}

  async scrapeAllArticles(): Promise<ScrapedArticle[]> {
    const categories = await this.listCategories();
    if (categories.length === 0) {
      throw new Error('The help center returned no categories.');
    }
    const articleSlugs = new Set<string>();

    for (const category of categories) {
      const slugs = await this.listArticleSlugs(category.slug);
      for (const slug of slugs) {
        articleSlugs.add(slug);
      }
    }

    if (articleSlugs.size === 0) {
      throw new Error('The help center returned no article links.');
    }

    const articles: ScrapedArticle[] = [];
    const failures: string[] = [];
    for (const slug of articleSlugs) {
      try {
        const article = await this.scrapeArticle(slug);
        if (!article.title.trim() || !article.content.trim()) {
          throw new Error('Article title or content is empty.');
        }
        articles.push(article);
      } catch (error) {
        failures.push(
          `${slug}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `Refusing a partial knowledge-base overwrite; ${failures.length} articles failed: ${failures.join(' | ')}`,
      );
    }

    const contentOwners = new Map<string, string>();
    for (const article of articles) {
      const contentKey = article.content.replace(/\s+/gu, ' ').trim();
      const existingSlug = contentOwners.get(contentKey);
      if (existingSlug) {
        throw new Error(
          `Duplicate article content found for ${existingSlug} and ${article.slug}.`,
        );
      }
      contentOwners.set(contentKey, article.slug);
    }

    return articles;
  }

  async listCategories(): Promise<ScrapedCategory[]> {
    const html = await this.fetchHtml('/');
    const root = parse(html);

    const categories: ScrapedCategory[] = [];
    const links = root.querySelectorAll('a[href^="/category/"]');

    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href) continue;

      const slug = href.replace('/category/', '').trim();
      if (!slug || categories.some((c) => c.slug === slug)) continue;

      const name = link.text.trim() || slug;
      categories.push({
        name,
        slug,
        articleCount: 0,
      });
    }

    return categories;
  }

  async listArticleSlugs(categorySlug: string): Promise<string[]> {
    const html = await this.fetchHtml(`/category/${categorySlug}`);
    const root = parse(html);

    const slugs: string[] = [];
    const links = root.querySelectorAll('a[href^="/article/"]');

    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href) continue;

      const slug = href.replace('/article/', '').trim();
      if (slug && !slugs.includes(slug)) {
        slugs.push(slug);
      }
    }

    return slugs;
  }

  async scrapeArticle(slug: string): Promise<ScrapedArticle> {
    const html = await this.fetchHtml(`/article/${slug}`);
    const root = parse(html);

    const title = root.querySelector('h1')?.text.trim() ?? slug;

    const breadcrumbLink = root.querySelector('.category-crumb.last-path a span:not(.mobile-divider)');
    const category = breadcrumbLink?.text.trim() ?? 'General';

    const container = root.querySelector('#article-wrapper') ?? root;
    const paragraphs: string[] = [];

    for (const child of container.childNodes) {
      this.collectBlockContent(child, paragraphs);
    }

    const updatedText = root.querySelector('.time')?.text.trim() ?? null;

    return {
      title,
      slug,
      category,
      content: paragraphs.join('\n\n'),
      updatedAt: updatedText,
    };
  }

  /**
   * Collect article paragraphs in document order. Paragraph blocks emit as
   * text; tables outside paragraph blocks (Tawk renders them in bare
   * overflow containers) emit as Markdown. Tables nested inside a paragraph
   * block are handled by extractText instead, so collection never descends
   * past an emitted boundary and content cannot duplicate.
   */
  private collectBlockContent(
    node: ReturnType<typeof parse>['childNodes'][number],
    paragraphs: string[],
  ): void {
    if (Number(node.nodeType) !== 1) return;
    const element = node as unknown as ReturnType<typeof parse>;
    const classes = (element.getAttribute?.('class') ?? '').split(/\s+/u);
    if (classes.includes('paragraph-block')) {
      const text = this.extractText(element);
      if (text.trim()) {
        paragraphs.push(text.trim());
      }
      return;
    }
    if (element.tagName?.toLowerCase() === 'table') {
      const table = this.extractTable(element);
      if (table.trim()) {
        paragraphs.push(table.trim());
      }
      return;
    }
    for (const child of element.childNodes) {
      this.collectBlockContent(child, paragraphs);
    }
  }

  private extractText(node: ReturnType<typeof parse>): string {
    const texts: string[] = [];

    for (const child of node.childNodes) {
      const nodeType = Number(child.nodeType);
      if (nodeType === 3) {
        texts.push(child.text);
      } else if (nodeType === 1) {
        const element = child as unknown as ReturnType<typeof parse>;
        const tag = element.tagName?.toLowerCase();

        if (tag === 'script' || tag === 'style') {
          continue;
        }

        if (tag === 'br') {
          texts.push('\n');
        } else if (tag === 'li') {
          const liText = this.extractText(element);
          if (liText.trim()) {
            texts.push(`- ${liText.trim()}`);
          }
        } else if (tag === 'table') {
          const table = this.extractTable(element);
          if (table) {
            texts.push(table);
          }
        } else if (tag === 'a') {
          texts.push(this.extractLink(element));
        } else {
          texts.push(this.extractText(element));
        }

        if (tag === 'p' || tag === 'div' || tag === 'li' || tag === 'table' || /^h[1-6]$/.test(tag ?? '')) {
          texts.push('\n');
        }
      }
    }

    return texts.join('').replace(/\n{3,}/g, '\n\n');
  }

  /**
   * Render a help-center table as compact Markdown. The first row becomes the
   * header (Tawk tables carry no th markup); multi-line cells flatten with a
   * semicolon separator so the table stays one row per line. Pipes escape so
   * cell content cannot break the table layout.
   */
  private extractTable(element: ReturnType<typeof parse>): string {
    const rows = element.querySelectorAll('tr');
    const lines: string[] = [];
    for (const [index, row] of rows.entries()) {
      const cells = row.querySelectorAll('th,td').map((cell) =>
        this.extractText(cell)
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .join('; ')
          .replace(/\|/gu, '\\|')
          .trim(),
      );
      if (cells.length === 0) continue;
      lines.push(`| ${cells.join(' | ')} |`);
      if (index === 0) {
        lines.push(`| ${cells.map(() => '---').join(' | ')} |`);
      }
    }
    return lines.length > 0 ? `\n${lines.join('\n')}\n` : '';
  }

  /**
   * Preserve article links as Markdown so synced content keeps calculator and
   * reference URLs. Relative hrefs resolve against the help-center base URL;
   * javascript and empty hrefs degrade to plain text.
   */
  private extractLink(element: ReturnType<typeof parse>): string {
    const text = this.extractText(element).replace(/\s+/gu, ' ').trim();
    const href = element.getAttribute?.('href')?.trim() ?? '';
    if (text.length === 0) return '';
    if (!href || href.toLowerCase().startsWith('javascript:') || href.startsWith('#')) {
      return text;
    }
    try {
      const absolute = new URL(href, this.baseUrl).toString();
      return `[${text}](${absolute})`;
    } catch {
      return text;
    }
  }

  private async fetchHtml(path: string): Promise<string> {
    const url = new URL(path, this.baseUrl).toString();
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return response.text();
  }
}
