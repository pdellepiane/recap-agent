import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const envPath = path.join(root, '.env');
const awsEnv = {
  ...process.env,
  AWS_PROFILE: process.env.AWS_PROFILE ?? 'se-dev',
  AWS_REGION: process.env.AWS_REGION ?? 'us-east-1',
  AWS_SDK_LOAD_CONFIG: '1',
  AWS_PAGER: '',
};
const secretName = process.env.CHANNEL_API_SECRET_NAME ?? 'recap-agent/channel-api-key';
const newToken = crypto.randomBytes(32).toString('base64url');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recap-agent-channel-key-'));
const secretFile = path.join(tempDir, 'value');

fs.writeFileSync(secretFile, newToken, { mode: 0o600 });
try {
  execFileSync(
    'aws',
    [
      'secretsmanager',
      'put-secret-value',
      '--secret-id',
      secretName,
      '--secret-string',
      `file://${secretFile}`,
    ],
    { env: awsEnv, stdio: 'ignore' },
  );
  upsertDotEnvValue(envPath, 'CHANNEL_API_KEY', newToken);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log(`Rotated ${secretName}.`);
console.log('The new token is stored in .env and AWSCURRENT; the prior token remains AWSPREVIOUS.');
console.log('Run AWS_PROFILE=se-dev npm run deploy to refresh Lambda containers.');

function upsertDotEnvValue(filePath, key, value) {
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const lines = content.split(/\r?\n/u);
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) {
    lines[index] = `${key}=${value}`;
  } else {
    lines.push(`${key}=${value}`);
  }
  fs.writeFileSync(filePath, `${lines.join('\n').replace(/^\n+/u, '')}\n`, { mode: 0o600 });
}
