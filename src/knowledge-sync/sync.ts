import fs from 'node:fs';
import path from 'node:path';
import { OpenAiKnowledgeUploader } from './openai-uploader';
import type { KnowledgeBaseSyncConfig } from './types';

export interface SyncResult {
  articlesScraped: number;
  batchId: string;
  fileIds: string[];
  vectorStoreId: string;
}

export async function runKnowledgeBaseSyncFromDir(
  config: KnowledgeBaseSyncConfig,
  articleCount?: number,
): Promise<SyncResult> {
  const outputDir = config.outputDir;
  fs.mkdirSync(outputDir, { recursive: true });

  const mdFiles = fs.readdirSync(outputDir).filter((f) => f.endsWith('.md'));
  const articlesScraped = articleCount ?? mdFiles.length;

  if (mdFiles.length === 0) {
    throw new Error(`No markdown files found in ${outputDir}`);
  }

  console.log(`Processing ${mdFiles.length} articles from ${outputDir}`);

  const batchId = `kb-${new Date().toISOString().split('T')[0].replace(/-/g, '')}`;

  const uploader = new OpenAiKnowledgeUploader(config);

  const articleFiles = mdFiles.map((fileName) => {
    const slug = fileName.replace(/\.md$/, '');
    const filePath = path.join(outputDir, fileName);
    // Try to infer category from frontmatter if possible, otherwise use slug
    const content = fs.readFileSync(filePath, 'utf-8');
    const categoryMatch = content.match(/^category:\s*"([^"]+)"/m);
    const typeMatch = content.match(/^article_type:\s*(\w+)/m);
    return {
      filePath,
      slug,
      category: categoryMatch?.[1] ?? 'General',
      articleType: typeMatch?.[1] ?? 'faq',
    };
  });

  const uploadResult = await uploader.uploadBatch(articleFiles, batchId);
  await uploader.cleanupOldBatches(uploadResult.vectorStoreId, batchId);

  return {
    articlesScraped,
    batchId: uploadResult.batchId,
    fileIds: uploadResult.fileIds,
    vectorStoreId: uploadResult.vectorStoreId,
  };
}
