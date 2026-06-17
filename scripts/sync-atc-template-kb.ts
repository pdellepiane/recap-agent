import path from 'node:path';
import { runKnowledgeBaseSyncFromDir } from '../src/knowledge-sync/sync';

const atcKnowledgeSource = 'notion_customer_service_templates';

async function main(): Promise<void> {
  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    console.error('OPENAI_API_KEY is required to upload supplemental ATC FAQ KB files.');
    process.exit(1);
  }

  const outputDir = process.env.ATC_TEMPLATE_KB_OUTPUT_DIR ?? path.resolve(process.cwd(), 'dist', 'knowledge-base-atc');
  const result = await runKnowledgeBaseSyncFromDir({
    baseUrl: process.env.KB_BASE_URL ?? 'https://sinenvolturas.tawk.help',
    outputDir,
    openAiApiKey,
    vectorStoreName: process.env.KB_VECTOR_STORE_NAME ?? 'Sin Envolturas Knowledge Base',
    vectorStoreId: process.env.KB_VECTOR_STORE_ID ?? null,
    uploadAttributes: {
      source: atcKnowledgeSource,
      source_kind: 'response_sample',
      channel: 'chat',
      status: 'Vigente',
    },
    cleanupScopeSource: atcKnowledgeSource,
  });

  console.log('Supplemental ATC FAQ KB sync complete:', result);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
