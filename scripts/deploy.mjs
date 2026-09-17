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
const cloudFormationExecutionRoleArn = optionalTrimmed(
  process.env.CLOUDFORMATION_EXECUTION_ROLE_ARN,
);

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
const currentStack = isProductionPromotion
  ? readCurrentStack(stackName, awsEnv)
  : (readOptionalCurrentStack(stackName, awsEnv) ?? {});
let secretArn;
let seApiSecretArn;
let channelApiSecretArn;
let targetFunctionName = functionName;
if (isProductionPromotion) {
  // Promotion must preserve the live stack's credential bindings. In
  // particular, local .env values are never copied into production.
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
  ensureBucketExists(artifactBucket, awsEnv);
  syncSecret(secretName, env.OPENAI_API_KEY, awsEnv);
  secretArn = describeSecretArn(secretName, awsEnv);
  syncSecret(seApiSecretName, env.SE_API_KEY, awsEnv);
  seApiSecretArn = describeSecretArn(seApiSecretName, awsEnv);
  syncSecret(channelApiSecretName, env[channelApiKeyName], awsEnv);
  channelApiSecretArn = describeSecretArn(channelApiSecretName, awsEnv);
}
if (!isProductionPromotion) {
  run('aws', ['s3', 'cp', artifactZip, `s3://${artifactBucket}/${artifactKey}`], {
    env: awsEnv,
  });
}
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
    `OpenAIModel=${getDeploymentSetting('OPENAI_MODEL', 'OpenAIModel', 'gpt-5.6-luna')}`,
    `OpenAIExtractorModel=${getDeploymentSetting('OPENAI_EXTRACTOR_MODEL', 'OpenAIExtractorModel', 'gpt-5.6-luna')}`,
    `OpenAIResponseClassifierModel=${getDeploymentSetting('OPENAI_RESPONSE_CLASSIFIER_MODEL', 'OpenAIResponseClassifierModel', 'gpt-5.6-luna')}`,
    `ResponseClassifierMode=${getDeploymentSetting('RESPONSE_CLASSIFIER_MODE', 'ResponseClassifierMode', 'enforce')}`,
    `PerfRetentionDays=${getDeploymentSetting('PERF_RETENTION_DAYS', 'PerfRetentionDays', '30')}`,
    `LogRetentionDays=${getDeploymentSetting('LOG_RETENTION_DAYS', 'LogRetentionDays', '7')}`,
    `ProviderSearchMode=${getDeploymentSetting('PROVIDER_SEARCH_MODE', 'ProviderSearchMode', 'hybrid')}`,
    `ProviderVectorStoreName=${getDeploymentSetting('PROVIDER_VECTOR_STORE_NAME', 'ProviderVectorStoreName', 'Sin Envolturas Provider Search')}`,
    `ProviderVectorStoreId=${getEnvironmentSetting('PROVIDER_VECTOR_STORE_ID', '')}`,
    `ProviderVectorMaxResults=${getDeploymentSetting('PROVIDER_VECTOR_MAX_RESULTS', 'ProviderVectorMaxResults', '12')}`,
    `ProviderVectorScoreThreshold=${getDeploymentSetting('PROVIDER_VECTOR_SCORE_THRESHOLD', 'ProviderVectorScoreThreshold', '0.2')}`,
    `KbEnabled=${getDeploymentSetting('KB_ENABLED', 'KbEnabled', 'true')}`,
    `KbVectorStoreId=${getEnvironmentSetting('KB_VECTOR_STORE_ID', '')}`,
    `KbMaxResults=${getDeploymentSetting('KB_MAX_RESULTS', 'KbMaxResults', '6')}`,
    `KbScoreThreshold=${getDeploymentSetting('KB_SCORE_THRESHOLD', 'KbScoreThreshold', '0')}`,
    `AgentApiBaseUrl=${getDeploymentSetting('AGENT_API_BASE_URL', 'AgentApiBaseUrl', 'https://api.sinenvolturas.com/api/agent')}`,
    `AgentApiTimeoutMs=${getDeploymentSetting('AGENT_API_TIMEOUT_MS', 'AgentApiTimeoutMs', '5000')}`,
    `AgentApiMaxRetries=${getDeploymentSetting('AGENT_API_MAX_RETRIES', 'AgentApiMaxRetries', '2')}`,
    `AgentMessageLoggingEnabled=${getDeploymentSetting('AGENT_MESSAGE_LOGGING_ENABLED', 'AgentMessageLoggingEnabled', 'false')}`,
    `SinEnvolturasGuestServiceBaseUrl=${getDeploymentSetting('SINENVOLTURAS_GUEST_SERVICE_BASE_URL', 'SinEnvolturasGuestServiceBaseUrl', 'https://api.sinenvolturas.com/api/guest-service')}`,
    `SinEnvolturasUserAuthBaseUrl=${getDeploymentSetting('SINENVOLTURAS_USER_AUTH_BASE_URL', 'SinEnvolturasUserAuthBaseUrl', 'https://api.sinenvolturas.com/api-web/user')}`,
    `AgentFeatureProviderPlanning=${getDeploymentSetting('AGENT_FEATURE_PROVIDER_PLANNING', 'AgentFeatureProviderPlanning', 'true')}`,
    `AgentFeatureProviderSearch=${getDeploymentSetting('AGENT_FEATURE_PROVIDER_SEARCH', 'AgentFeatureProviderSearch', 'true')}`,
    `AgentFeatureProviderQuoteRequests=${getDeploymentSetting('AGENT_FEATURE_PROVIDER_QUOTE_REQUESTS', 'AgentFeatureProviderQuoteRequests', 'true')}`,
    `AgentFeatureFaq=${getDeploymentSetting('AGENT_FEATURE_FAQ', 'AgentFeatureFaq', 'true')}`,
    `AgentFeatureInvitedEventLookup=${getDeploymentSetting('AGENT_FEATURE_INVITED_EVENT_LOOKUP', 'AgentFeatureInvitedEventLookup', 'true')}`,
    `AgentFeaturePurchaseInformation=${getDeploymentSetting('AGENT_FEATURE_PURCHASE_INFORMATION', 'AgentFeaturePurchaseInformation', 'true')}`,
    `AgentFeatureRsvp=${getDeploymentSetting('AGENT_FEATURE_RSVP', 'AgentFeatureRsvp', 'true')}`,
  );
}
const cloudFormationArgs = [
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
];
if (cloudFormationExecutionRoleArn) {
  if (
    !cloudFormationExecutionRoleArn.startsWith(
      `arn:aws:iam::${getAccountId(awsEnv)}:role/`,
    )
  ) {
    throw new Error(
      'CLOUDFORMATION_EXECUTION_ROLE_ARN must be a role in the required AWS account.',
    );
  }
  cloudFormationArgs.push('--role-arn', cloudFormationExecutionRoleArn);
}
run('aws', cloudFormationArgs, { env: awsEnv });

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
  return (
    optionalTrimmed(env[baseKey]) ??
    optionalTrimmed(currentStack[cloudFormationParameterName(baseKey)]) ??
    fallback
  );
}

function getDeploymentSetting(environmentKey, parameterKey, fallback) {
  return (
    optionalTrimmed(env[environmentKey]) ??
    optionalTrimmed(currentStack[parameterKey]) ??
    fallback
  );
}

function cloudFormationParameterName(environmentKey) {
  const names = {
    PROVIDER_VECTOR_STORE_ID: 'ProviderVectorStoreId',
    KB_VECTOR_STORE_ID: 'KbVectorStoreId',
  };
  return names[environmentKey];
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
  const stack = readOptionalCurrentStack(stackName, env);
  if (!stack) {
    throw new Error(`Deployment requires an existing CloudFormation stack: ${stackName}.`);
  }
  return stack;
}

function readOptionalCurrentStack(stackName, env) {
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
    return null;
  }

  const stack = parsed?.Stacks?.[0];
  if (!stack || typeof stack !== 'object') {
    return null;
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
