import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { runKnowledgeBaseSync } from './sync';
import type { KnowledgeBaseSyncConfig } from './types';

export async function handler(
  _event: APIGatewayProxyEventV2,
  _context: Context,
): Promise<APIGatewayProxyResultV2> {
  const baseUrl = process.env.KB_BASE_URL ?? 'https://sinenvolturas.tawk.help';
  const openAiApiKey = process.env.OPENAI_API_KEY;
  const vectorStoreId = process.env.KB_VECTOR_STORE_ID ?? null;
  const vectorStoreName = process.env.KB_VECTOR_STORE_NAME ?? 'Sin Envolturas Knowledge Base';
  const outputPath = '/tmp/sinenvolturas-kb.md';

  if (!openAiApiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'OPENAI_API_KEY is not configured' }),
    };
  }

  const config: KnowledgeBaseSyncConfig = {
    baseUrl,
    outputPath,
    openAiApiKey,
    vectorStoreName,
    vectorStoreId,
  };

  try {
    const result = await runKnowledgeBaseSync(config);
    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Knowledge base sync failed:', message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: message }),
    };
  }
}
