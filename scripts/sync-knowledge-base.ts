import fs from 'node:fs';
import path from 'node:path';
import { TawkHelpScraper } from '../src/knowledge-sync/scraper';
import { formatArticleToMarkdown } from '../src/knowledge-sync/formatter';
import { OpenAiKnowledgeUploader } from '../src/knowledge-sync/openai-uploader';

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

    const batchId = `local-${new Date().toISOString().split('T')[0].replace(/-/g, '')}`;

    const uploader = new OpenAiKnowledgeUploader({
      baseUrl,
      outputDir,
      openAiApiKey,
      vectorStoreName,
      vectorStoreId,
    });

    const result = await uploader.uploadBatch(formattedArticles, batchId);
    await uploader.cleanupOldBatches(result.vectorStoreId, batchId);

    console.log('Upload complete:', result);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
