import 'dotenv/config';

import path from 'node:path';

import OpenAI from 'openai';

import { PromptLoader } from '../runtime/prompt-loader';
import { auditPromptBundles } from './prompt-audit';

async function main(): Promise<void> {
  const flags = new Set(process.argv.slice(2));
  const knownFlags = new Set(['--remote-token-count']);
  const unknownFlag = [...flags].find((flag) => !knownFlags.has(flag));
  if (unknownFlag) {
    throw new Error(`Unknown argument: ${unknownFlag}.`);
  }
  const remoteTokenCount = flags.has('--remote-token-count');
  const apiKey = process.env.OPENAI_API_KEY;
  if (remoteTokenCount && !apiKey) {
    throw new Error('OPENAI_API_KEY is required for --remote-token-count.');
  }
  const openAIClient = remoteTokenCount
    ? new OpenAI({ apiKey, maxRetries: 0 })
    : undefined;
  const result = await auditPromptBundles({
    loader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    replyModel: process.env.OPENAI_MODEL ?? 'gpt-5.4-mini',
    extractorModel: process.env.OPENAI_EXTRACTOR_MODEL ?? 'gpt-5.4-nano',
    openAIClient,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.violations.length > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Prompt audit failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
