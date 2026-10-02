import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TawkHelpScraper } from '../src/knowledge-sync/scraper';
import { formatArticleToMarkdown } from '../src/knowledge-sync/formatter';
import { OpenAiKnowledgeUploader } from '../src/knowledge-sync/openai-uploader';
import { createKnowledgeBatchId } from '../src/knowledge-sync/sync';

const scrapedFaqSource = 'recap-agent-knowledge-sync';

async function main() {
  const baseUrl = process.env.KB_BASE_URL ?? 'https://sinenvolturas.tawk.help';
  const outputDir = process.env.KB_OUTPUT_DIR ?? path.resolve(process.cwd(), 'knowledge-base');
  const articlesDir = path.join(outputDir, 'articles');
  const openAiApiKey = process.env.OPENAI_API_KEY;
  const vectorStoreId = process.env.KB_VECTOR_STORE_ID ?? null;
  const vectorStoreName = process.env.KB_VECTOR_STORE_NAME ?? 'Sin Envolturas Knowledge Base';
  const skipUpload = process.env.KB_SKIP_UPLOAD === 'true';

  console.log('Scraping knowledge base from', baseUrl);

  const scraper = new TawkHelpScraper(baseUrl);
  const articles = await scraper.scrapeAllArticles();

  console.log(`Scraped ${articles.length} articles`);

  fs.mkdirSync(articlesDir, { recursive: true });
  for (const existingFile of fs.readdirSync(articlesDir)) {
    if (existingFile.endsWith('.md')) {
      fs.rmSync(path.join(articlesDir, existingFile));
    }
  }

  const formattedArticles: Array<{ filePath: string; slug: string; category: string; articleType: string }> = [];

  for (const article of articles) {
    const formatted = formatArticleToMarkdown(article, baseUrl);
    const filePath = path.join(articlesDir, `${article.slug}.md`);
    fs.writeFileSync(filePath, formatted.markdown, 'utf-8');
    formattedArticles.push({
      filePath,
      slug: article.slug,
      category: formatted.metadata.category,
      articleType: formatted.metadata.articleType,
    });
  }

  console.log(`Wrote ${formattedArticles.length} articles to ${articlesDir}`);

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

    // OpenAI blocks downloading uploaded files, so the runtime expands
    // complete articles from this committed snapshot instead of the Files
    // API. The manifest binds the snapshot to the uploaded batch; the
    // gateway refuses expansion when the live store reports another batch.
    const manifest = {
      version: 1 as const,
      source: scrapedFaqSource,
      batchId: result.batchId,
      vectorStoreId: result.vectorStoreId,
      syncedAt: new Date().toISOString(),
      articles: formattedArticles
        .map((article) => ({
          slug: article.slug,
          sha256: sha256File(article.filePath),
          bytes: fs.statSync(article.filePath).size,
        }))
        .sort((a, b) => a.slug.localeCompare(b.slug)),
    };
    fs.writeFileSync(
      path.join(outputDir, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf-8',
    );

    console.log('Upload complete:', { ...result, audit });
    console.log(`Wrote manifest for batch ${result.batchId} to ${outputDir}`);
  }
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
