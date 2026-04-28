import fs from 'node:fs';
import path from 'node:path';
import { TawkHelpScraper } from '../src/knowledge-sync/scraper';
import { articlesToMarkdown } from '../src/knowledge-sync/formatter';
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

  const markdown = articlesToMarkdown(articles);

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'sinenvolturas-kb.md');
  fs.writeFileSync(outputPath, markdown, 'utf-8');

  console.log(`Wrote markdown to ${outputPath}`);

  if (!skipUpload) {
    if (!openAiApiKey) {
      console.error('OPENAI_API_KEY is required for upload. Set KB_SKIP_UPLOAD=true to skip.');
      process.exit(1);
    }

    const uploader = new OpenAiKnowledgeUploader({
      baseUrl,
      outputPath,
      openAiApiKey,
      vectorStoreName,
      vectorStoreId,
    });

    const result = await uploader.upload(outputPath);
    console.log('Upload complete:', result);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
