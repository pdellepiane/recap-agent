import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { assertRequiredAwsIdentity, createRequiredAwsEnv } from './aws-profile.mjs';
import {
  optionalTrimmed,
  resolveDeploymentTarget,
} from './deployment-config.mjs';

const root = process.cwd();
const envPath = path.join(root, '.env');
const deploymentEnvironment = resolveDeploymentTarget(process.env);
const deploymentEnvPath = path.join(root, '.env.development');
const env = {
  ...loadDotEnv(envPath),
  ...(deploymentEnvironment.environment === 'development'
    ? loadDotEnv(deploymentEnvPath)
    : {}),
  ...process.env,
};
const channelApiKeyName = deploymentEnvironment.channelApiKeyEnvName;
const isProductionPromotion = deploymentEnvironment.environment === 'production';
const suppliedArtifactPath = optionalTrimmed(process.env.DEPLOY_ARTIFACT_PATH);
const expectedArtifactSha256 = optionalTrimmed(process.env.DEPLOY_ARTIFACT_SHA256);

if (isProductionPromotion && (!suppliedArtifactPath || !expectedArtifactSha256)) {
  throw new Error(
    'Production deployment requires DEPLOY_ARTIFACT_PATH and DEPLOY_ARTIFACT_SHA256 for exact-artifact promotion.',
  );
}

if (!isProductionPromotion && !env[channelApiKeyName]) {
  env[channelApiKeyName] = crypto.randomBytes(32).toString('base64url');
  const channelKeyPath =
    deploymentEnvironment.environment === 'development' ? deploymentEnvPath : envPath;
  upsertDotEnvValue(channelKeyPath, channelApiKeyName, env[channelApiKeyName]);
  console.log(
    `Generated ${channelApiKeyName} and stored it in the ignored ${path.basename(channelKeyPath)} file.`,
  );
}

const required = isProductionPromotion ? [] : ['OPENAI_API_KEY', 'SE_API_KEY', channelApiKeyName];
for (const key of required) {
  if (!env[key]) {
    throw new Error(`${key} is required in the deployment environment.`);
  }
}

const awsEnv = createRequiredAwsEnv();
assertRequiredAwsIdentity(awsEnv);

const {
  environment,
  stackName,
  functionName,
  openAiSecretName: secretName,
  seApiSecretName,
  channelApiSecretName,
  providerSyncStackName,
  providerSyncEnvironment,
} = deploymentEnvironment;
const artifactBucket = process.env.ARTIFACT_BUCKET ?? `recap-agent-artifacts-${getAccountId(awsEnv)}-${awsEnv.AWS_REGION}`;
const artifactDir = path.join(root, '.artifacts');
const artifactZip = suppliedArtifactPath
  ? path.resolve(root, suppliedArtifactPath)
  : path.join(artifactDir, 'recap-agent.zip');

fs.mkdirSync(artifactDir, { recursive: true });

if (suppliedArtifactPath) {
  assertArtifactFile(artifactZip);
} else {
  run('npm', ['run', 'build'], { env: process.env });
  zipArtifact(path.join(root, 'dist'), artifactZip);
}

const artifactSha256 = sha256File(artifactZip);
if (expectedArtifactSha256 && !isSha256(expectedArtifactSha256)) {
  throw new Error('DEPLOY_ARTIFACT_SHA256 must be a 64-character hexadecimal SHA-256 digest.');
}
if (expectedArtifactSha256 && artifactSha256 !== expectedArtifactSha256.toLowerCase()) {
  throw new Error(
    `Artifact digest mismatch: expected ${expectedArtifactSha256.toLowerCase()}, got ${artifactSha256}.`,
  );
}

const artifactKey = optionalTrimmed(process.env.DEPLOY_ARTIFACT_S3_KEY) ?? `lambda/${artifactSha256}.zip`;
console.log(`Artifact SHA-256: ${artifactSha256}`);
ensureBucketExists(artifactBucket, awsEnv);
let secretArn;
let seApiSecretArn;
let channelApiSecretArn;
let targetFunctionName = functionName;
if (isProductionPromotion) {
  // Promotion must preserve the live stack's credential bindings. In
  // particular, local .env values are never copied into production.
  const currentStack = readCurrentStack(stackName, awsEnv);
  const currentEnvironment = optionalTrimmed(currentStack.DeploymentEnvironment);
  if (currentEnvironment && currentEnvironment !== 'production') {
    throw new Error(
      `Refusing production promotion because ${stackName} is marked ${currentEnvironment}.`,
    );
  }
  targetFunctionName = requireCurrentStackValue(currentStack, 'FunctionName');
  secretArn = requireCurrentStackValue(currentStack, 'OpenAISecretArn');
  seApiSecretArn = requireCurrentStackValue(currentStack, 'SeApiSecretArn');
  channelApiSecretArn = requireCurrentStackValue(currentStack, 'ChannelApiSecretArn');

  // The content-addressed artifact must first be deployed to the isolated
  // development stack. This binds production promotion to the exact code
  // that reached development instead of trusting a local path and digest
  // pair alone.
  const developmentStackName = optionalTrimmed(process.env.DEV_STACK_NAME) ??
    'recap-agent-runtime-dev';
  const developmentStack = readCurrentStack(developmentStackName, awsEnv);
  if (requireCurrentStackValue(developmentStack, 'DeploymentEnvironment') !== 'development') {
    throw new Error(
      `Refusing production promotion because ${developmentStackName} is not marked development.`,
    );
  }
  const developmentArtifactKey = requireCurrentStackValue(
    developmentStack,
    'CodeS3Key',
  );
  if (developmentArtifactKey !== artifactKey) {
    throw new Error(
      'Production artifact must exactly match the content-addressed artifact currently deployed in development.',
    );
  }
} else {
  syncSecret(secretName, env.OPENAI_API_KEY, awsEnv);
  secretArn = describeSecretArn(secretName, awsEnv);
  syncSecret(seApiSecretName, env.SE_API_KEY, awsEnv);
  seApiSecretArn = describeSecretArn(seApiSecretName, awsEnv);
  syncSecret(channelApiSecretName, env[channelApiKeyName], awsEnv);
  channelApiSecretArn = describeSecretArn(channelApiSecretName, awsEnv);
}
run('aws', ['s3', 'cp', artifactZip, `s3://${artifactBucket}/${artifactKey}`], { env: awsEnv });
const parameterOverrides = [
  `DeploymentEnvironment=${environment}`,
  `FunctionName=${targetFunctionName}`,
  `CodeS3Bucket=${artifactBucket}`,
  `CodeS3Key=${artifactKey}`,
  `OpenAISecretArn=${secretArn}`,
  `SeApiSecretArn=${seApiSecretArn}`,
  `ChannelApiSecretArn=${channelApiSecretArn}`,
];
if (!isProductionPromotion) {
  parameterOverrides.push(
    `OpenAIModel=${process.env.OPENAI_MODEL ?? env.OPENAI_MODEL ?? 'gpt-5.6-luna'}`,
    `OpenAIExtractorModel=${process.env.OPENAI_EXTRACTOR_MODEL ?? env.OPENAI_EXTRACTOR_MODEL ?? 'gpt-5.6-luna'}`,
    `OpenAIResponseClassifierModel=${process.env.OPENAI_RESPONSE_CLASSIFIER_MODEL ?? env.OPENAI_RESPONSE_CLASSIFIER_MODEL ?? 'gpt-5.6-luna'}`,
    `ResponseClassifierMode=${process.env.RESPONSE_CLASSIFIER_MODE ?? env.RESPONSE_CLASSIFIER_MODE ?? 'enforce'}`,
    `PerfRetentionDays=${process.env.PERF_RETENTION_DAYS ?? env.PERF_RETENTION_DAYS ?? '30'}`,
    `LogRetentionDays=${process.env.LOG_RETENTION_DAYS ?? env.LOG_RETENTION_DAYS ?? '7'}`,
    `ProviderSearchMode=${process.env.PROVIDER_SEARCH_MODE ?? env.PROVIDER_SEARCH_MODE ?? 'hybrid'}`,
    `ProviderVectorStoreName=${process.env.PROVIDER_VECTOR_STORE_NAME ?? env.PROVIDER_VECTOR_STORE_NAME ?? 'Sin Envolturas Provider Search'}`,
    `ProviderVectorStoreId=${getEnvironmentSetting('PROVIDER_VECTOR_STORE_ID', '')}`,
    `ProviderVectorMaxResults=${process.env.PROVIDER_VECTOR_MAX_RESULTS ?? env.PROVIDER_VECTOR_MAX_RESULTS ?? '12'}`,
    `ProviderVectorScoreThreshold=${process.env.PROVIDER_VECTOR_SCORE_THRESHOLD ?? env.PROVIDER_VECTOR_SCORE_THRESHOLD ?? '0.2'}`,
    `KbEnabled=${process.env.KB_ENABLED ?? env.KB_ENABLED ?? 'true'}`,
    `KbVectorStoreId=${getEnvironmentSetting('KB_VECTOR_STORE_ID', '')}`,
    `KbMaxResults=${process.env.KB_MAX_RESULTS ?? env.KB_MAX_RESULTS ?? '6'}`,
    `KbScoreThreshold=${process.env.KB_SCORE_THRESHOLD ?? env.KB_SCORE_THRESHOLD ?? '0'}`,
    `AgentApiBaseUrl=${process.env.AGENT_API_BASE_URL ?? env.AGENT_API_BASE_URL ?? 'https://api.sinenvolturas.com/api/agent'}`,
    `AgentApiTimeoutMs=${process.env.AGENT_API_TIMEOUT_MS ?? env.AGENT_API_TIMEOUT_MS ?? '5000'}`,
    `AgentApiMaxRetries=${process.env.AGENT_API_MAX_RETRIES ?? env.AGENT_API_MAX_RETRIES ?? '2'}`,
    `AgentMessageLoggingEnabled=${process.env.AGENT_MESSAGE_LOGGING_ENABLED ?? env.AGENT_MESSAGE_LOGGING_ENABLED ?? 'false'}`,
    `SinEnvolturasGuestServiceBaseUrl=${process.env.SINENVOLTURAS_GUEST_SERVICE_BASE_URL ?? env.SINENVOLTURAS_GUEST_SERVICE_BASE_URL ?? 'https://api.sinenvolturas.com/api/guest-service'}`,
    `SinEnvolturasUserAuthBaseUrl=${process.env.SINENVOLTURAS_USER_AUTH_BASE_URL ?? env.SINENVOLTURAS_USER_AUTH_BASE_URL ?? 'https://api.sinenvolturas.com/api-web/user'}`,
    `AgentFeatureProviderPlanning=${process.env.AGENT_FEATURE_PROVIDER_PLANNING ?? env.AGENT_FEATURE_PROVIDER_PLANNING ?? 'true'}`,
    `AgentFeatureProviderSearch=${process.env.AGENT_FEATURE_PROVIDER_SEARCH ?? env.AGENT_FEATURE_PROVIDER_SEARCH ?? 'true'}`,
    `AgentFeatureProviderQuoteRequests=${process.env.AGENT_FEATURE_PROVIDER_QUOTE_REQUESTS ?? env.AGENT_FEATURE_PROVIDER_QUOTE_REQUESTS ?? 'true'}`,
    `AgentFeatureFaq=${process.env.AGENT_FEATURE_FAQ ?? env.AGENT_FEATURE_FAQ ?? 'true'}`,
    `AgentFeatureInvitedEventLookup=${process.env.AGENT_FEATURE_INVITED_EVENT_LOOKUP ?? env.AGENT_FEATURE_INVITED_EVENT_LOOKUP ?? 'true'}`,
    `AgentFeaturePurchaseInformation=${process.env.AGENT_FEATURE_PURCHASE_INFORMATION ?? env.AGENT_FEATURE_PURCHASE_INFORMATION ?? 'true'}`,
    `AgentFeatureRsvp=${process.env.AGENT_FEATURE_RSVP ?? env.AGENT_FEATURE_RSVP ?? 'true'}`,
  );
}
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
    ...parameterOverrides,
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

if (process.env.DEPLOY_PROVIDER_SYNC === 'true') {
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
      `Environment=${providerSyncEnvironment}`,
      `OpenAiSecretArn=${secretArn}`,
      `SinEnvolturasBaseUrl=${process.env.SINENVOLTURAS_BASE_URL ?? env.SINENVOLTURAS_BASE_URL ?? 'https://api.sinenvolturas.com/api-web/vendor'}`,
      `ProviderVectorStoreName=${process.env.PROVIDER_VECTOR_STORE_NAME ?? env.PROVIDER_VECTOR_STORE_NAME ?? 'Sin Envolturas Provider Search'}`,
      `ProviderVectorStoreId=${getProviderSyncVectorStoreId()}`,
      `CodeS3Bucket=${artifactBucket}`,
      `CodeS3Key=${artifactKey}`,
    ],
    { env: awsEnv },
  );

  console.log(`Deployed provider sync stack: ${providerSyncStackName}`);
} else {
  console.log('Skipped provider sync stack deployment; set DEPLOY_PROVIDER_SYNC=true to opt in.');
}

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

function getEnvironmentSetting(baseKey, fallback) {
  const scopedKey = `${baseKey}_${environment.toUpperCase()}`;
  const scopedValue = optionalTrimmed(env[scopedKey]);
  if (scopedValue) {
    return scopedValue;
  }

  // A development runtime may use an explicitly configured shared index for
  // read-only retrieval. Provider sync has a separate resolver below and
  // never inherits this generic value in development.
  return optionalTrimmed(env[baseKey]) ?? fallback;
}

function getProviderSyncVectorStoreId() {
  const scopedKey = `PROVIDER_VECTOR_STORE_ID_${environment.toUpperCase()}`;
  if (environment === 'development') {
    return optionalTrimmed(env[scopedKey]) ?? '';
  }
  return getEnvironmentSetting('PROVIDER_VECTOR_STORE_ID', '');
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

function assertArtifactFile(filePath) {
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    throw new Error(`DEPLOY_ARTIFACT_PATH does not exist: ${filePath}`);
  }
  if (!stats.isFile()) {
    throw new Error(`DEPLOY_ARTIFACT_PATH must point to a file: ${filePath}`);
  }
  if (path.extname(filePath).toLowerCase() !== '.zip') {
    throw new Error(`DEPLOY_ARTIFACT_PATH must point to a .zip file: ${filePath}`);
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function isSha256(value) {
  return /^[0-9a-f]{64}$/iu.test(value);
}

function getAccountId(env) {
  return execFileSync('aws', ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text'], {
    env,
    encoding: 'utf8',
  }).trim();
}

function describeSecretArn(secretName, env) {
  return execFileSync(
    'aws',
    [
      'secretsmanager',
      'describe-secret',
      '--secret-id',
      secretName,
      '--query',
      'ARN',
      '--output',
      'text',
    ],
    { env, encoding: 'utf8' },
  ).trim();
}

function readCurrentStack(stackName, env) {
  let parsed;
  try {
    parsed = JSON.parse(
      execFileSync(
        'aws',
        [
          'cloudformation',
          'describe-stacks',
          '--stack-name',
          stackName,
          '--output',
          'json',
        ],
        { env, encoding: 'utf8' },
      ),
    );
  } catch {
    throw new Error(
      `Production promotion requires an existing CloudFormation stack: ${stackName}.`,
    );
  }

  const stack = parsed?.Stacks?.[0];
  if (!stack || typeof stack !== 'object') {
    throw new Error(`CloudFormation stack ${stackName} returned no usable state.`);
  }
  const values = {};
  for (const parameter of stack.Parameters ?? []) {
    if (
      parameter &&
      typeof parameter === 'object' &&
      typeof parameter.ParameterKey === 'string' &&
      typeof parameter.ParameterValue === 'string'
    ) {
      values[parameter.ParameterKey] = parameter.ParameterValue;
    }
  }
  for (const output of stack.Outputs ?? []) {
    if (
      output &&
      typeof output === 'object' &&
      typeof output.OutputKey === 'string' &&
      typeof output.OutputValue === 'string' &&
      !values[output.OutputKey]
    ) {
      values[output.OutputKey] = output.OutputValue;
    }
  }
  return values;
}

function requireCurrentStackValue(stack, key) {
  const value = optionalTrimmed(stack[key]);
  if (!value) {
    throw new Error(`Production stack is missing required parameter/output ${key}.`);
  }
  return value;
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
