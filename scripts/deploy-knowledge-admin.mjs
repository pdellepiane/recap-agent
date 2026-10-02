import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import esbuild from 'esbuild';
import { assertRequiredAwsIdentity, createRequiredAwsEnv } from './aws-profile.mjs';

const awsEnv = createRequiredAwsEnv();
assertRequiredAwsIdentity(awsEnv);
function aws(args) { return execFileSync('aws', [...args, '--profile', 'se-dev', '--region', 'us-east-1'], { env: awsEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
const runtime = JSON.parse(aws(['cloudformation', 'describe-stacks', '--stack-name', 'recap-agent-runtime-dev', '--output', 'json'])).Stacks[0];
const parameters = Object.fromEntries(runtime.Parameters.map(p => [p.ParameterKey, p.ParameterValue]));
if (!parameters.KbVectorStoreId || !parameters.OpenAISecretArn) throw new Error('Development FAQ store and OpenAI secret must already exist.');
const folder = path.resolve('.artifacts/knowledge-admin');
const build = path.join(folder, 'build');
await mkdir(build, { recursive: true });
await esbuild.build({ entryPoints: ['src/knowledge-admin/handler.ts'], outfile: path.join(build, 'index.js'), bundle: true, platform: 'node', target: 'node24', format: 'cjs' });
for (const filename of ['page.html', 'app.js']) await cp(path.join('src/knowledge-admin', filename), path.join(build, filename));
const titles = {};
for (const file of await readdir('knowledge-base/articles')) {
  if (!file.endsWith('.md')) continue;
  const content = await readFile(path.join('knowledge-base/articles', file), 'utf8');
  const encoded = content.match(/^title: ("(?:[^"\\]|\\.)*")$/mu)?.[1];
  if (encoded) titles[file.slice(0, -3)] = JSON.parse(encoded);
}
await writeFile(path.join(build, 'original-titles.json'), JSON.stringify(titles));
const zip = path.join(folder, 'knowledge-admin.zip');
execFileSync('zip', ['-q', '-j', zip, ...['index.js', 'page.html', 'app.js', 'original-titles.json'].map(file => path.join(build, file))]);
const digest = crypto.createHash('sha256').update(await readFile(zip)).digest('hex');
const bucket = 'recap-agent-artifacts-684516060775-us-east-1';
const key = `knowledge-admin/${digest}.zip`;
aws(['s3', 'cp', zip, `s3://${bucket}/${key}`, '--only-show-errors']);
aws(['cloudformation', 'deploy', '--template-file', 'infra/cloudformation/knowledge-admin.yaml', '--stack-name', 'recap-agent-knowledge-admin-dev', '--capabilities', 'CAPABILITY_IAM', '--parameter-overrides', `ArtifactBucket=${bucket}`, `ArtifactKey=${key}`, `OpenAISecretArn=${parameters.OpenAISecretArn}`, `KbVectorStoreId=${parameters.KbVectorStoreId}`, '--no-fail-on-empty-changeset']);
const stack = JSON.parse(aws(['cloudformation', 'describe-stacks', '--stack-name', 'recap-agent-knowledge-admin-dev', '--output', 'json'])).Stacks[0];
const outputs = Object.fromEntries(stack.Outputs.map(output => [output.OutputKey, output.OutputValue]));
const capability = aws(['secretsmanager', 'get-secret-value', '--secret-id', outputs.AdminPathSecretArn, '--query', 'SecretString', '--output', 'text']);
const url = `${outputs.BaseUrl}${capability}/`;
await writeFile(path.join(folder, 'access.json'), JSON.stringify({ url, ...outputs }, null, 2), { mode: 0o600 });
await writeFile(path.join(folder, 'deployment.json'), JSON.stringify({ deployedAt: new Date().toISOString(), stack: stack.StackId, artifactSha256: digest, functionName: outputs.FunctionName, vectorStoreId: parameters.KbVectorStoreId, status: stack.StackStatus }, null, 2));
console.log('Knowledge helper deployed. Its unlisted URL is saved in the ignored .artifacts/knowledge-admin/access.json file.');
