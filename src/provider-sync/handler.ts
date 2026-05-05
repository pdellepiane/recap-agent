import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { runProviderSync } from './sync';
import type { ProviderSyncConfig } from './types';

export async function handler(
  event: APIGatewayProxyEventV2 | Record<string, unknown>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const openAiApiKey = await resolveOpenAiApiKey();
    const config: ProviderSyncConfig = {
      providerBaseUrl:
        process.env.SINENVOLTURAS_BASE_URL ??
        'https://api.sinenvolturas.com/api-web/vendor',
      outputDir: '/tmp/provider-search',
      openAiApiKey,
      vectorStoreName:
        process.env.PROVIDER_VECTOR_STORE_NAME ??
        'Sin Envolturas Provider Search',
      vectorStoreId: process.env.PROVIDER_VECTOR_STORE_ID ?? null,
    };

    const body = isApiEvent(event) ? parseBodyRecord(event.body) : null;
    const skipUpload =
      process.env.PROVIDER_SYNC_SKIP_UPLOAD === 'true' || body?.skipUpload === true;
    const result = await runProviderSync(config, { skipUpload });
    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }
}

async function resolveOpenAiApiKey(): Promise<string> {
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }

  const secretId = process.env.OPENAI_SECRET_ID;
  if (!secretId) {
    throw new Error('OPENAI_API_KEY or OPENAI_SECRET_ID must be configured');
  }

  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
  });
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!response.SecretString) {
    throw new Error('OPENAI_SECRET_ID does not contain a SecretString');
  }
  return response.SecretString;
}

function isApiEvent(event: unknown): event is APIGatewayProxyEventV2 {
  return Boolean(
    event &&
      typeof event === 'object' &&
      'requestContext' in event,
  );
}

function parseBodyRecord(body: string | undefined): Record<string, unknown> | null {
  if (!body) {
    return null;
  }

  const parsed: unknown = JSON.parse(body);
  return parsed && typeof parsed === 'object'
    ? parsed as Record<string, unknown>
    : null;
}
