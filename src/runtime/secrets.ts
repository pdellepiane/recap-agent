import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

const cachedSecrets = new Map<string, string>();

export async function resolveOpenAiApiKey(options: {
  directApiKey: string | null;
  secretId: string | null;
  region: string;
}): Promise<string> {
  if (options.directApiKey) {
    return options.directApiKey;
  }

  if (!options.secretId) {
    throw new Error('OPENAI_SECRET_ID is required when OPENAI_API_KEY is not set.');
  }

  return resolveSecretValue({
    secretId: options.secretId,
    region: options.region,
    jsonKey: 'OPENAI_API_KEY',
  });
}

export async function resolveSeApiKey(options: {
  secretId: string | null;
  region: string;
}): Promise<string> {
  if (!options.secretId) {
    throw new Error('SE_API_SECRET_ID is required for Agent API access.');
  }

  return resolveSecretValue({
    secretId: options.secretId,
    region: options.region,
    jsonKey: 'SE_API_KEY',
  });
}

async function resolveSecretValue(options: {
  secretId: string;
  region: string;
  jsonKey: 'OPENAI_API_KEY' | 'SE_API_KEY';
}): Promise<string> {
  const cachedSecret = cachedSecrets.get(options.secretId);
  if (cachedSecret) {
    return cachedSecret;
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

  const secretValue = extractApiKey(secretString, options.jsonKey);
  cachedSecrets.set(options.secretId, secretValue);
  return secretValue;
}

function extractApiKey(
  secretString: string,
  jsonKey: 'OPENAI_API_KEY' | 'SE_API_KEY',
): string {
  const trimmed = secretString.trim();
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const value = parsed[jsonKey];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Secret JSON does not contain ${jsonKey}.`);
    }
    return value;
  }

  return trimmed;
}
