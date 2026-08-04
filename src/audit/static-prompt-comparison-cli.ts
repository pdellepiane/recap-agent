import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';

import OpenAI from 'openai';

import { PromptLoader } from '../runtime/prompt-loader';
import { DEFAULT_GPT_TEXT_MODEL } from '../runtime/openai-model-defaults';
import {
  compareStaticPromptShapes,
  legacyPromptBaselineRef,
  type StaticPromptComparisonResult,
} from './static-prompt-comparison';

type Options = {
  baselineRef: string;
  outputDir: string | null;
  remoteTokenCount: boolean;
};

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const apiKey = process.env.OPENAI_API_KEY;
  if (options.remoteTokenCount && !apiKey) {
    throw new Error('OPENAI_API_KEY is required for --remote-token-count.');
  }
  const result = await compareStaticPromptShapes({
    loader: new PromptLoader(path.resolve(process.cwd(), 'prompts')),
    baselineRef: options.baselineRef,
    counterModel: process.env.OPENAI_MODEL ?? DEFAULT_GPT_TEXT_MODEL,
    openAIClient: options.remoteTokenCount
      ? new OpenAI({ apiKey, maxRetries: 0 })
      : undefined,
  });

  if (options.outputDir) {
    const outputDir = path.resolve(process.cwd(), options.outputDir);
    await fs.mkdir(outputDir, { recursive: true });
    await Promise.all([
      fs.writeFile(
        path.join(outputDir, 'comparison.json'),
        `${JSON.stringify(result, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o644 },
      ),
      fs.writeFile(
        path.join(outputDir, 'findings.md'),
        renderFindings(result),
        { encoding: 'utf8', mode: 0o644 },
      ),
    ]);
  }

  process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
  if (result.violations.length > 0) {
    process.stderr.write(`${result.violations.join('\n')}\n`);
    process.exitCode = 1;
  }
}

function parseOptions(args: readonly string[]): Options {
  const options: Options = {
    baselineRef: legacyPromptBaselineRef,
    outputDir: null,
    remoteTokenCount: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--remote-token-count') {
      options.remoteTokenCount = true;
      continue;
    }
    if (argument === '--baseline-ref' || argument === '--output-dir') {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`${argument} requires a value.`);
      }
      if (argument === '--baseline-ref') {
        options.baselineRef = value;
      } else {
        options.outputDir = value;
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}.`);
  }
  return options;
}

export function renderFindings(result: StaticPromptComparisonResult): string {
  const rows = result.comparisons.map((comparison) => [
    comparison.component,
    comparison.route,
    String(comparison.baseline.fileCount),
    String(comparison.current.fileCount),
    String(comparison.baseline.serializedRequestBytes),
    String(comparison.current.serializedRequestBytes),
    `${comparison.serializedRequestByteReductionPercent.toFixed(2)}%`,
    comparison.baseline.remoteInputTokens === null
      ? 'not measured'
      : String(comparison.baseline.remoteInputTokens),
    comparison.current.remoteInputTokens === null
      ? 'not measured'
      : String(comparison.current.remoteInputTokens),
  ]);
  return `# Static prompt comparison\n\n` +
    `Generated: ${result.generatedAt}\n\n` +
    `Historical source: \`${result.baselineRef}\`\n\n` +
    `Both sides were serialized with \`${result.counterModel}\` so the comparison isolates prompt shape rather than tokenizer/model changes.\n\n` +
    `Aggregate serialized request bytes fell from ${result.summary.baselineSerializedRequestBytes.toLocaleString('en-US')} to ${result.summary.currentSerializedRequestBytes.toLocaleString('en-US')} (${result.summary.serializedRequestByteReductionPercent.toFixed(2)}% reduction).\n\n` +
    (result.summary.remoteInputTokenReductionPercent === null
      ? 'Remote input tokens were not measured in this run.\n\n'
      : `Aggregate non-generative input tokens fell from ${result.summary.baselineRemoteInputTokens?.toLocaleString('en-US')} to ${result.summary.currentRemoteInputTokens?.toLocaleString('en-US')} (${result.summary.remoteInputTokenReductionPercent.toFixed(2)}% reduction).\n\n`) +
    `| Component | Route | Files before | Files now | Bytes before | Bytes now | Byte reduction | Tokens before | Tokens now |\n` +
    `|---|---|---:|---:|---:|---:|---:|---:|---:|\n` +
    rows.map((row) => `| ${row.join(' | ')} |`).join('\n') +
    `\n\n## Gate result\n\n` +
    (result.violations.length === 0
      ? 'Passed: every non-classifier route shrank and current prompts contain no repeated normalized paragraphs.\n'
      : result.violations.map((violation) => `- ${violation}`).join('\n') + '\n');
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Static prompt comparison failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
