import path from 'node:path';
import { runProviderSync } from '../src/provider-sync/sync';

async function main() {
  const openAiApiKey = process.env.OPENAI_API_KEY;
  const skipUpload = process.env.PROVIDER_SYNC_SKIP_UPLOAD === 'true';

  if (!openAiApiKey && !skipUpload) {
    throw new Error('OPENAI_API_KEY is required unless PROVIDER_SYNC_SKIP_UPLOAD=true');
  }

  const result = await runProviderSync(
    {
      providerBaseUrl:
        process.env.SINENVOLTURAS_BASE_URL ??
        'https://api.sinenvolturas.com/api-web/vendor',
      outputDir:
        process.env.PROVIDER_SYNC_OUTPUT_DIR ??
        path.resolve(process.cwd(), 'dist', 'provider-search'),
      openAiApiKey: openAiApiKey ?? 'skip-upload',
      vectorStoreName:
        process.env.PROVIDER_VECTOR_STORE_NAME ??
        'Sin Envolturas Provider Search',
      vectorStoreId: process.env.PROVIDER_VECTOR_STORE_ID ?? null,
    },
    { skipUpload },
  );

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
