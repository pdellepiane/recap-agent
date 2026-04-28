import { parse } from 'node-html-parser';
import type { ScrapedArticle, ScrapedCategory } from './types';

export class TawkHelpScraper {
  constructor(private readonly baseUrl: string) {}

  async scrapeAllArticles(): Promise<ScrapedArticle[]> {
    const categories = await this.listCategories();
    const articleSlugs = new Set<string>();

    for (const category of categories) {
      const slugs = await this.listArticleSlugs(category.slug);
      for (const slug of slugs) {
        articleSlugs.add(slug);
      }
    }

    const articles: ScrapedArticle[] = [];
    for (const slug of articleSlugs) {
      try {
        const article = await this.scrapeArticle(slug);
        articles.push(article);
      } catch (error) {
        console.error(`Failed to scrape article ${slug}:`, error instanceof Error ? error.message : String(error));
      }
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

    const contentBlocks = root.querySelectorAll('.paragraph-block');
    const paragraphs: string[] = [];

    for (const block of contentBlocks) {
      const text = this.extractText(block);
      if (text.trim()) {
        paragraphs.push(text.trim());
      }
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

  private extractText(node: ReturnType<typeof parse>): string {
    const texts: string[] = [];

    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        texts.push(child.text);
      } else if (child.nodeType === 1) {
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
        } else {
          texts.push(this.extractText(element));
        }

        if (tag === 'p' || tag === 'div' || tag === 'li' || /^h[1-6]$/.test(tag ?? '')) {
          texts.push('\n');
        }
      }
    }

    return texts.join('').replace(/\n{3,}/g, '\n\n');
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
