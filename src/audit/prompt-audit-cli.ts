import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';

import OpenAI from 'openai';

import { PromptLoader } from '../runtime/prompt-loader';
import { DEFAULT_GPT_TEXT_MODEL } from '../runtime/openai-model-defaults';
import { auditPromptBundles } from './prompt-audit';
import { buildPromptInventory } from './prompt-inventory';
import { measureCurrentBranches } from './prompt-branch-measurement';

type CliOptions = {
  remoteTokenCount: boolean;
  inventoryPath: string | null;
  branchesPath: string | null;
};

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const apiKey = process.env.OPENAI_API_KEY;
  if (options.remoteTokenCount && !apiKey) {
    throw new Error('OPENAI_API_KEY is required for --remote-token-count.');
  }
  const openAIClient = options.remoteTokenCount
    ? new OpenAI({ apiKey, maxRetries: 0 })
    : undefined;
  const loader = new PromptLoader(path.resolve(process.cwd(), 'prompts'));
  const result = await auditPromptBundles({
    loader,
    replyModel: process.env.OPENAI_MODEL ?? DEFAULT_GPT_TEXT_MODEL,
    extractorModel: process.env.OPENAI_EXTRACTOR_MODEL ?? DEFAULT_GPT_TEXT_MODEL,
    openAIClient,
  });

  if (options.inventoryPath) {
    const inventory = await buildPromptInventory({
      promptsDir: path.resolve(process.cwd(), 'prompts'),
    });
    await fs.mkdir(path.dirname(path.resolve(options.inventoryPath)), { recursive: true });
    await fs.writeFile(path.resolve(options.inventoryPath), `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  }

  if (options.branchesPath) {
    const branches = await measureCurrentBranches({
      loader,
      counterModel: process.env.OPENAI_MODEL ?? DEFAULT_GPT_TEXT_MODEL,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      counterModel: process.env.OPENAI_MODEL ?? DEFAULT_GPT_TEXT_MODEL,
      branches,
    };
    await fs.mkdir(path.dirname(path.resolve(options.branchesPath)), { recursive: true });
    await fs.writeFile(path.resolve(options.branchesPath), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.violations.length > 0) {
    process.exitCode = 1;
  }
}

function parseOptions(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    remoteTokenCount: false,
    inventoryPath: null,
    branchesPath: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--remote-token-count') {
      options.remoteTokenCount = true;
      continue;
    }
    if (argument === '--inventory' || argument === '--per-branch' || argument === '--branches') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value.`);
      }
      if (argument === '--inventory') {
        options.inventoryPath = value;
      } else {
        options.branchesPath = value;
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}.`);
  }
  return options;
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Prompt audit failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
