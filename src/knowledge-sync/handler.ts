import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { runKnowledgeBaseSync } from './sync';
import type { KnowledgeBaseSyncConfig } from './types';

export async function handler(
  event: APIGatewayProxyEventV2,
  _context: Context,
): Promise<APIGatewayProxyResultV2> {
  const baseUrl = process.env.KB_BASE_URL ?? 'https://sinenvolturas.tawk.help';
  const vectorStoreId = process.env.KB_VECTOR_STORE_ID ?? null;
  const vectorStoreName = process.env.KB_VECTOR_STORE_NAME ?? 'Sin Envolturas Knowledge Base';
  const outputDir = '/tmp/knowledge-base';
  const secretId = process.env.OPENAI_SECRET_ID;
  const openAiApiKey = process.env.OPENAI_API_KEY;

  // Support manual trigger via query parameter or body
  const force =
    event.queryStringParameters?.force === 'true' ||
    (event.body && JSON.parse(event.body ?? '{}').force === true);

  if (force) {
    console.log('Manual force trigger received');
  }

  let resolvedApiKey: string;
  if (openAiApiKey) {
    resolvedApiKey = openAiApiKey;
  } else if (secretId) {
    const region = process.env.AWS_REGION ?? 'us-east-1';
    const secretsClient = new SecretsManagerClient({ region });
    const secretResponse = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: secretId }),
    );
    if (!secretResponse.SecretString) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'OPENAI_SECRET_ID does not contain a SecretString' }),
      };
    }
    resolvedApiKey = secretResponse.SecretString;
  } else {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'OPENAI_API_KEY or OPENAI_SECRET_ID must be configured' }),
    };
  }

  const config: KnowledgeBaseSyncConfig = {
    baseUrl,
    outputDir,
    openAiApiKey: resolvedApiKey,
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
