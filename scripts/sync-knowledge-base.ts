import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { TawkHelpScraper } from '../src/knowledge-sync/scraper';
import { formatArticleToMarkdown } from '../src/knowledge-sync/formatter';
import { OpenAiKnowledgeUploader } from '../src/knowledge-sync/openai-uploader';
import { createKnowledgeBatchId } from '../src/knowledge-sync/sync';

const scrapedFaqSource = 'recap-agent-knowledge-sync';

async function main() {
  const baseUrl = process.env.KB_BASE_URL ?? 'https://sinenvolturas.tawk.help';
  const outputDir = process.env.KB_OUTPUT_DIR ?? path.resolve(process.cwd(), 'dist', 'knowledge-base');
  const openAiApiKey = process.env.OPENAI_API_KEY;
  const vectorStoreId = process.env.KB_VECTOR_STORE_ID ?? null;
  const vectorStoreName = process.env.KB_VECTOR_STORE_NAME ?? 'Sin Envolturas Knowledge Base';
  const skipUpload = process.env.KB_SKIP_UPLOAD === 'true';

  console.log('Scraping knowledge base from', baseUrl);

  const scraper = new TawkHelpScraper(baseUrl);
  const articles = await scraper.scrapeAllArticles();

  console.log(`Scraped ${articles.length} articles`);

  fs.mkdirSync(outputDir, { recursive: true });
  for (const existingFile of fs.readdirSync(outputDir)) {
    if (existingFile.endsWith('.md')) {
      fs.rmSync(path.join(outputDir, existingFile));
    }
  }

  const formattedArticles: Array<{ filePath: string; slug: string; category: string; articleType: string }> = [];

  for (const article of articles) {
    const formatted = formatArticleToMarkdown(article, baseUrl);
    const filePath = path.join(outputDir, `${article.slug}.md`);
    fs.writeFileSync(filePath, formatted.markdown, 'utf-8');
    formattedArticles.push({
      filePath,
      slug: article.slug,
      category: formatted.metadata.category,
      articleType: formatted.metadata.articleType,
    });
  }

  console.log(`Wrote ${formattedArticles.length} articles to ${outputDir}`);

  if (!skipUpload) {
    if (!openAiApiKey) {
      console.error('OPENAI_API_KEY is required for upload. Set KB_SKIP_UPLOAD=true to skip.');
      process.exit(1);
    }

    const batchId = createKnowledgeBatchId('local');

    const uploader = new OpenAiKnowledgeUploader({
      baseUrl,
      outputDir,
      openAiApiKey,
      vectorStoreName,
      vectorStoreId,
      uploadAttributes: {
        source: scrapedFaqSource,
        source_kind: 'help_center_article',
      },
      cleanupScopeSource: scrapedFaqSource,
    });

    const result = await uploader.uploadBatch(formattedArticles, batchId);
    await uploader.cleanupOldBatches(result.vectorStoreId, batchId);
    const audit = await uploader.waitForCleanCurrentBatch({
      vectorStoreId: result.vectorStoreId,
      currentBatchId: batchId,
      expectedFileCount: formattedArticles.length,
    });
    if (
      audit.currentBatchFileCount !== formattedArticles.length ||
      audit.staleSourceFileCount !== 0 ||
      audit.duplicateCurrentSlugs.length > 0
    ) {
      throw new Error(
        `FAQ overwrite audit failed: ${audit.currentBatchFileCount}/${formattedArticles.length} current files, ` +
        `${audit.staleSourceFileCount} stale files, ` +
        `${audit.duplicateCurrentSlugs.length} duplicate slugs.`,
      );
    }

    console.log('Upload complete:', { ...result, audit });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
