import fs from 'node:fs';
import path from 'node:path';
import { TawkHelpScraper } from './scraper';
import { formatArticleToMarkdown } from './formatter';
import { OpenAiKnowledgeUploader } from './openai-uploader';
import type { KnowledgeBaseSyncConfig, FormattedArticle } from './types';

export interface SyncResult {
  articlesScraped: number;
  batchId: string;
  fileIds: string[];
  vectorStoreId: string;
}

export async function runKnowledgeBaseSync(config: KnowledgeBaseSyncConfig): Promise<SyncResult> {
  const scraper = new TawkHelpScraper(config.baseUrl);
  const articles = await scraper.scrapeAllArticles();

  console.log(`Scraped ${articles.length} articles`);

  // Format each article as individual markdown file with YAML frontmatter
  const formattedArticles: Array<{ article: FormattedArticle; tempPath: string; slug: string; category: string; articleType: string }> = [];

  fs.mkdirSync(config.outputDir, { recursive: true });

  for (const article of articles) {
    const formatted = formatArticleToMarkdown(article, config.baseUrl);
    const fileName = `${article.slug}.md`;
    const tempPath = path.join(config.outputDir, fileName);
    fs.writeFileSync(tempPath, formatted.markdown, 'utf-8');

    formattedArticles.push({
      article: formatted,
      tempPath,
      slug: article.slug,
      category: formatted.metadata.category,
      articleType: formatted.metadata.articleType,
    });
  }

  console.log(`Wrote ${formattedArticles.length} articles to ${config.outputDir}`);

  // Generate a batch ID based on timestamp
  const batchId = `kb-${new Date().toISOString().split('T')[0].replace(/-/g, '')}`;

  const uploader = new OpenAiKnowledgeUploader(config);

  const uploadResult = await uploader.uploadBatch(
    formattedArticles.map((fa) => ({
      filePath: fa.tempPath,
      slug: fa.slug,
      category: fa.category,
      articleType: fa.articleType,
    })),
    batchId,
  );

  // Clean up old batches from the vector store
  await uploader.cleanupOldBatches(uploadResult.vectorStoreId, batchId);

  return {
    articlesScraped: articles.length,
    batchId: uploadResult.batchId,
    fileIds: uploadResult.fileIds,
    vectorStoreId: uploadResult.vectorStoreId,
  };
}
