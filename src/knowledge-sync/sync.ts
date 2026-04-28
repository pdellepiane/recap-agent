import fs from 'node:fs';
import path from 'node:path';
import { TawkHelpScraper } from './scraper';
import { articlesToMarkdown } from './formatter';
import { OpenAiKnowledgeUploader } from './openai-uploader';
import type { KnowledgeBaseSyncConfig } from './types';

export interface SyncResult {
  articlesScraped: number;
  fileId: string;
  vectorStoreId: string;
}

export async function runKnowledgeBaseSync(config: KnowledgeBaseSyncConfig): Promise<SyncResult> {
  const scraper = new TawkHelpScraper(config.baseUrl);
  const articles = await scraper.scrapeAllArticles();

  const markdown = articlesToMarkdown(articles);

  fs.mkdirSync(path.dirname(config.outputPath), { recursive: true });
  fs.writeFileSync(config.outputPath, markdown, 'utf-8');

  const uploader = new OpenAiKnowledgeUploader(config);
  const result = await uploader.upload(config.outputPath);

  return {
    articlesScraped: articles.length,
    fileId: result.fileId,
    vectorStoreId: result.vectorStoreId,
  };
}
