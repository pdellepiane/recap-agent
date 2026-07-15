import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const envPath = path.join(root, '.env');
const env = loadDotEnv(envPath);

if (!env.CHANNEL_API_KEY) {
  env.CHANNEL_API_KEY = crypto.randomBytes(32).toString('base64url');
  upsertDotEnvValue(envPath, 'CHANNEL_API_KEY', env.CHANNEL_API_KEY);
  console.log('Generated CHANNEL_API_KEY and stored it in the ignored local .env file.');
}

const required = ['OPENAI_API_KEY', 'SE_API_KEY', 'CHANNEL_API_KEY'];
for (const key of required) {
  if (!env[key]) {
    throw new Error(`${key} is required in .env for deployment.`);
  }
}

const awsEnv = {
  ...process.env,
  AWS_PROFILE: process.env.AWS_PROFILE ?? 'se-dev',
  AWS_REGION: process.env.AWS_REGION ?? 'us-east-1',
  AWS_SDK_LOAD_CONFIG: '1',
  AWS_PAGER: '',
};

const stackName = process.env.STACK_NAME ?? 'recap-agent-runtime';
const functionName = process.env.FUNCTION_NAME ?? 'recap-agent-runtime';
const secretName = process.env.OPENAI_SECRET_NAME ?? 'recap-agent/openai-api-key';
const seApiSecretName = process.env.SE_API_SECRET_NAME ?? 'recap-agent/se-api-key';
const channelApiSecretName = process.env.CHANNEL_API_SECRET_NAME ?? 'recap-agent/channel-api-key';
const artifactBucket = process.env.ARTIFACT_BUCKET ?? `recap-agent-artifacts-${getAccountId(awsEnv)}-${awsEnv.AWS_REGION}`;
const artifactKey = `lambda/${Date.now()}-recap-agent.zip`;
const artifactDir = path.join(root, '.artifacts');
const artifactZip = path.join(artifactDir, 'recap-agent.zip');

fs.mkdirSync(artifactDir, { recursive: true });

run('npm', ['run', 'build'], { env: process.env });
ensureBucketExists(artifactBucket, awsEnv);
syncSecret(secretName, env.OPENAI_API_KEY, awsEnv);
const secretArn = execFileSync(
  'aws',
  ['secretsmanager', 'describe-secret', '--secret-id', secretName, '--query', 'ARN', '--output', 'text'],
  { env: awsEnv, encoding: 'utf8' },
).trim();
syncSecret(seApiSecretName, env.SE_API_KEY, awsEnv);
const seApiSecretArn = execFileSync(
  'aws',
  ['secretsmanager', 'describe-secret', '--secret-id', seApiSecretName, '--query', 'ARN', '--output', 'text'],
  { env: awsEnv, encoding: 'utf8' },
).trim();
syncSecret(channelApiSecretName, env.CHANNEL_API_KEY, awsEnv);
const channelApiSecretArn = execFileSync(
  'aws',
  ['secretsmanager', 'describe-secret', '--secret-id', channelApiSecretName, '--query', 'ARN', '--output', 'text'],
  { env: awsEnv, encoding: 'utf8' },
).trim();
zipArtifact(path.join(root, 'dist'), artifactZip);
run('aws', ['s3', 'cp', artifactZip, `s3://${artifactBucket}/${artifactKey}`], { env: awsEnv });
run(
  'aws',
  [
    'cloudformation',
    'deploy',
    '--stack-name',
    stackName,
    '--template-file',
    'infra/cloudformation/stack.yaml',
    '--capabilities',
    'CAPABILITY_NAMED_IAM',
    '--parameter-overrides',
    `FunctionName=${functionName}`,
    `CodeS3Bucket=${artifactBucket}`,
    `CodeS3Key=${artifactKey}`,
    `OpenAISecretArn=${secretArn}`,
    `SeApiSecretArn=${seApiSecretArn}`,
    `ChannelApiSecretArn=${channelApiSecretArn}`,
    `OpenAIModel=${process.env.OPENAI_MODEL ?? env.OPENAI_MODEL ?? 'gpt-5.4-mini'}`,
    `OpenAIExtractorModel=${process.env.OPENAI_EXTRACTOR_MODEL ?? env.OPENAI_EXTRACTOR_MODEL ?? 'gpt-5.4-nano'}`,
    `OpenAIResponseClassifierModel=${process.env.OPENAI_RESPONSE_CLASSIFIER_MODEL ?? env.OPENAI_RESPONSE_CLASSIFIER_MODEL ?? 'gpt-5.4-nano'}`,
    `ResponseClassifierMode=${process.env.RESPONSE_CLASSIFIER_MODE ?? env.RESPONSE_CLASSIFIER_MODE ?? 'enforce'}`,
    `OpenAIPromptCacheRetention=${process.env.OPENAI_PROMPT_CACHE_RETENTION ?? env.OPENAI_PROMPT_CACHE_RETENTION ?? 'in-memory'}`,
    `PerfRetentionDays=${process.env.PERF_RETENTION_DAYS ?? env.PERF_RETENTION_DAYS ?? '30'}`,
    `LogRetentionDays=${process.env.LOG_RETENTION_DAYS ?? env.LOG_RETENTION_DAYS ?? '7'}`,
    `ProviderSearchMode=${process.env.PROVIDER_SEARCH_MODE ?? env.PROVIDER_SEARCH_MODE ?? 'hybrid'}`,
    `ProviderVectorStoreName=${process.env.PROVIDER_VECTOR_STORE_NAME ?? env.PROVIDER_VECTOR_STORE_NAME ?? 'Sin Envolturas Provider Search'}`,
    `ProviderVectorStoreId=${process.env.PROVIDER_VECTOR_STORE_ID ?? env.PROVIDER_VECTOR_STORE_ID ?? ''}`,
    `ProviderVectorMaxResults=${process.env.PROVIDER_VECTOR_MAX_RESULTS ?? env.PROVIDER_VECTOR_MAX_RESULTS ?? '12'}`,
    `ProviderVectorScoreThreshold=${process.env.PROVIDER_VECTOR_SCORE_THRESHOLD ?? env.PROVIDER_VECTOR_SCORE_THRESHOLD ?? '0.2'}`,
    `AgentApiBaseUrl=${process.env.AGENT_API_BASE_URL ?? env.AGENT_API_BASE_URL ?? 'https://api.sinenvolturas.com/api/agent'}`,
    `AgentApiTimeoutMs=${process.env.AGENT_API_TIMEOUT_MS ?? env.AGENT_API_TIMEOUT_MS ?? '5000'}`,
    `AgentApiMaxRetries=${process.env.AGENT_API_MAX_RETRIES ?? env.AGENT_API_MAX_RETRIES ?? '2'}`,
    `AgentMessageLoggingEnabled=${process.env.AGENT_MESSAGE_LOGGING_ENABLED ?? env.AGENT_MESSAGE_LOGGING_ENABLED ?? 'false'}`,
    `SinEnvolturasGuestServiceBaseUrl=${process.env.SINENVOLTURAS_GUEST_SERVICE_BASE_URL ?? env.SINENVOLTURAS_GUEST_SERVICE_BASE_URL ?? 'https://se-v2-api-dev.jnq.io/api/guest-service'}`,
    `SinEnvolturasGuestAuthBaseUrl=${process.env.SINENVOLTURAS_GUEST_AUTH_BASE_URL ?? env.SINENVOLTURAS_GUEST_AUTH_BASE_URL ?? 'https://se-v2-api-dev.jnq.io/api-web/user'}`,
    `AgentFeatureProviderPlanning=${process.env.AGENT_FEATURE_PROVIDER_PLANNING ?? env.AGENT_FEATURE_PROVIDER_PLANNING ?? 'true'}`,
    `AgentFeatureProviderSearch=${process.env.AGENT_FEATURE_PROVIDER_SEARCH ?? env.AGENT_FEATURE_PROVIDER_SEARCH ?? 'true'}`,
    `AgentFeatureProviderQuoteRequests=${process.env.AGENT_FEATURE_PROVIDER_QUOTE_REQUESTS ?? env.AGENT_FEATURE_PROVIDER_QUOTE_REQUESTS ?? 'true'}`,
    `AgentFeatureFaq=${process.env.AGENT_FEATURE_FAQ ?? env.AGENT_FEATURE_FAQ ?? 'true'}`,
    `AgentFeatureInvitedEventLookup=${process.env.AGENT_FEATURE_INVITED_EVENT_LOOKUP ?? env.AGENT_FEATURE_INVITED_EVENT_LOOKUP ?? 'true'}`,
  ],
  { env: awsEnv },
);

const functionUrl = execFileSync(
  'aws',
  [
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    stackName,
    '--query',
    "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue",
    '--output',
    'text',
  ],
  { env: awsEnv, encoding: 'utf8' },
).trim();

console.log(`Deployed stack: ${stackName}`);
console.log(`Function URL: ${functionUrl}`);

const providerSyncStackName = process.env.PROVIDER_SYNC_STACK_NAME ?? 'recap-agent-provider-sync-dev';
run(
  'aws',
  [
    'cloudformation',
    'deploy',
    '--stack-name',
    providerSyncStackName,
    '--template-file',
    'infra/provider-sync.yml',
    '--capabilities',
    'CAPABILITY_NAMED_IAM',
    '--parameter-overrides',
    `Environment=${process.env.ENVIRONMENT ?? 'dev'}`,
    `OpenAiSecretArn=${secretArn}`,
    `SinEnvolturasBaseUrl=${process.env.SINENVOLTURAS_BASE_URL ?? env.SINENVOLTURAS_BASE_URL ?? 'https://api.sinenvolturas.com/api-web/vendor'}`,
    `ProviderVectorStoreName=${process.env.PROVIDER_VECTOR_STORE_NAME ?? env.PROVIDER_VECTOR_STORE_NAME ?? 'Sin Envolturas Provider Search'}`,
    `ProviderVectorStoreId=${process.env.PROVIDER_VECTOR_STORE_ID ?? env.PROVIDER_VECTOR_STORE_ID ?? ''}`,
    `CodeS3Bucket=${artifactBucket}`,
    `CodeS3Key=${artifactKey}`,
  ],
  { env: awsEnv },
);

console.log(`Deployed provider sync stack: ${providerSyncStackName}`);

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) {
      continue;
    }
    const index = line.indexOf('=');
    if (index < 0) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    result[key] = value;
  }
  return result;
}

function upsertDotEnvValue(filePath, key, value) {
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) {
    lines[index] = `${key}=${value}`;
  } else {
    lines.push(`${key}=${value}`);
  }
  fs.writeFileSync(filePath, `${lines.join('\n').replace(/^\n+/u, '')}\n`, { mode: 0o600 });
}

function run(command, args, options) {
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
}

function getAccountId(env) {
  return execFileSync('aws', ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text'], {
    env,
    encoding: 'utf8',
  }).trim();
}

function ensureBucketExists(bucket, env) {
  try {
    execFileSync('aws', ['s3api', 'head-bucket', '--bucket', bucket], {
      env,
      stdio: 'ignore',
    });
  } catch {
    run(
      'aws',
      ['s3api', 'create-bucket', '--bucket', bucket, '--region', env.AWS_REGION],
      { env },
    );
  }
}

function syncSecret(secretName, secretValue, env) {
  const tempDir = fs.mkdtempSync(path.join(artifactDir, 'secret-'));
  const secretFile = path.join(tempDir, 'value');
  fs.writeFileSync(secretFile, secretValue, { mode: 0o600 });
  try {
    try {
      execFileSync(
        'aws',
        ['secretsmanager', 'describe-secret', '--secret-id', secretName],
        { env, stdio: 'ignore' },
      );
      const currentSecretValue = execFileSync(
        'aws',
        [
          'secretsmanager',
          'get-secret-value',
          '--secret-id',
          secretName,
          '--version-stage',
          'AWSCURRENT',
          '--query',
          'SecretString',
          '--output',
          'text',
        ],
        { env, encoding: 'utf8' },
      ).replace(/\r?\n$/u, '');
      if (currentSecretValue === secretValue) {
        return;
      }
      run(
        'aws',
        [
          'secretsmanager',
          'put-secret-value',
          '--secret-id',
          secretName,
          '--secret-string',
          `file://${secretFile}`,
        ],
        { env },
      );
    } catch {
      run(
        'aws',
        [
          'secretsmanager',
          'create-secret',
          '--name',
          secretName,
          '--secret-string',
          `file://${secretFile}`,
        ],
        { env },
      );
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function zipArtifact(sourceDir, outputFile) {
  if (fs.existsSync(outputFile)) {
    fs.rmSync(outputFile);
  }
  run('zip', ['-r', outputFile, '.'], { cwd: sourceDir });
}
