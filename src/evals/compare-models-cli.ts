#!/usr/bin/env node

import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';

import OpenAI from 'openai';
import { z } from 'zod';

import { auditPromptBundles } from '../audit/prompt-audit';
import { DEFAULT_GPT_TEXT_MODEL } from '../runtime/openai-model-defaults';
import { PromptLoader } from '../runtime/prompt-loader';
import { runEvaluation } from './runner';

const legacyBaselineSchema = z.object({
  models: z.object({
    classifier: z.string(),
    extractor: z.string(),
    reply: z.string(),
  }),
  acceptance: z.object({
    legacyInputTokens: z.number().positive(),
    legacyOpenAiUsdPerFullTurn: z.number().positive(),
    lunaModelOnlyUsdPerFullTurn: z.number().positive(),
    lunaModelOnlySavingsRate: z.number().min(0).max(1),
  }),
});

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const baseline = legacyBaselineSchema.parse(JSON.parse(await fs.readFile(
    path.resolve(rootDir, 'evals/baselines/openai-legacy-2026-08-04.json'),
    'utf8',
  )) as unknown);
  const regression = await runEvaluation({
    evalsDir: path.resolve(rootDir, 'evals'),
    outputDir: path.resolve(rootDir, '.eval-runs'),
    suite: 'dev_regression',
    target: 'offline',
  });
  const apiKey = process.env.OPENAI_API_KEY;
  const promptAudit = await auditPromptBundles({
    loader: new PromptLoader(path.resolve(rootDir, 'prompts')),
    replyModel: DEFAULT_GPT_TEXT_MODEL,
    extractorModel: DEFAULT_GPT_TEXT_MODEL,
    openAIClient: apiKey ? new OpenAI({ apiKey, maxRetries: 0 }) : undefined,
  });
  const failedQualityCases = regression.report.failedCases + regression.report.erroredCases;
  const remoteTokenEntries = promptAudit.entries.filter(
    (entry) => entry.remoteInputTokens !== null,
  );

  process.stdout.write(`${JSON.stringify({
    legacy: {
      models: baseline.models,
      inputTokensPerFullTurn: baseline.acceptance.legacyInputTokens,
      openAiUsdPerFullTurn: baseline.acceptance.legacyOpenAiUsdPerFullTurn,
    },
    lunaModelOnlyCeiling: {
      model: DEFAULT_GPT_TEXT_MODEL,
      openAiUsdPerFullTurn: baseline.acceptance.lunaModelOnlyUsdPerFullTurn,
      savingsRateVersusLegacy: baseline.acceptance.lunaModelOnlySavingsRate,
    },
    deterministicQualityGate: {
      suite: 'dev_regression',
      passedCases: regression.report.passedCases,
      failedCases: regression.report.failedCases,
      erroredCases: regression.report.erroredCases,
      runDir: regression.runDir,
    },
    requestShapeGate: {
      violations: promptAudit.violations,
      remoteTokenCountUsed: Boolean(apiKey),
      remoteCountedEntries: remoteTokenEntries.length,
      aggregateRemoteInputTokens: remoteTokenEntries.reduce(
        (sum, entry) => sum + (entry.remoteInputTokens ?? 0),
        0,
      ),
    },
    livePromotionRequired: true,
  }, null, 2)}\n`);

  if (failedQualityCases > 0 || promptAudit.violations.length > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Model comparison failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
