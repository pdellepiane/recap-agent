import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const env = loadDotEnv(path.join(root, '.env'));

const required = ['OPENAI_API_KEY'];
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
  try {
    execFileSync(
      'aws',
      ['secretsmanager', 'describe-secret', '--secret-id', secretName],
      { env, stdio: 'ignore' },
    );
    run(
      'aws',
      ['secretsmanager', 'put-secret-value', '--secret-id', secretName, '--secret-string', secretValue],
      { env },
    );
  } catch {
    run(
      'aws',
      ['secretsmanager', 'create-secret', '--name', secretName, '--secret-string', secretValue],
      { env },
    );
  }
}

function zipArtifact(sourceDir, outputFile) {
  if (fs.existsSync(outputFile)) {
    fs.rmSync(outputFile);
  }
  run('zip', ['-r', outputFile, '.'], { cwd: sourceDir });
}
