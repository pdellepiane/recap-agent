import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

let cachedSecret: string | null = null;

export async function resolveOpenAiApiKey(options: {
  directApiKey: string | null;
  secretId: string | null;
  region: string;
}): Promise<string> {
  if (options.directApiKey) {
    return options.directApiKey;
  }

  if (cachedSecret) {
    return cachedSecret;
  }

  if (!options.secretId) {
    throw new Error('OPENAI_SECRET_ID is required when OPENAI_API_KEY is not set.');
  }

  const client = new SecretsManagerClient({ region: options.region });
  const response = await client.send(
    new GetSecretValueCommand({
      SecretId: options.secretId,
    }),
  );

  const secretString = response.SecretString;

  if (!secretString) {
    throw new Error(`Secret ${options.secretId} does not contain a SecretString.`);
  }

  cachedSecret = extractApiKey(secretString);
  return cachedSecret;
}

function extractApiKey(secretString: string): string {
  const trimmed = secretString.trim();
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as { OPENAI_API_KEY?: string };
    if (!parsed.OPENAI_API_KEY) {
      throw new Error('Secret JSON does not contain OPENAI_API_KEY.');
    }
    return parsed.OPENAI_API_KEY;
  }

  return trimmed;
}
