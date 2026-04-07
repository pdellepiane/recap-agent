import { mkdir, cp, rm } from 'node:fs/promises';
import path from 'node:path';

import esbuild from 'esbuild';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const lambdaOutfile = path.join(distDir, 'lambda', 'index.js');
const terminalOutfile = path.join(distDir, 'terminal', 'client.js');

await rm(distDir, { recursive: true, force: true });
await mkdir(path.dirname(lambdaOutfile), { recursive: true });
await mkdir(path.dirname(terminalOutfile), { recursive: true });

await esbuild.build({
  entryPoints: ['src/lambda/handler.ts'],
  outfile: lambdaOutfile,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
  external: ['aws-sdk'],
});

await esbuild.build({
  entryPoints: ['src/terminal/client.ts'],
  outfile: terminalOutfile,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
});

await cp(path.join(root, 'prompts'), path.join(distDir, 'prompts'), {
  recursive: true,
});

console.log('Build completed.');
