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

const optimizedBaselineSchema = z.object({
  version: z.string(),
  model: z.string(),
  quality: z.object({
    totalCases: z.number().int().positive(),
    passedCases: z.number().int().nonnegative(),
    failedCases: z.number().int().nonnegative(),
    erroredCases: z.number().int().nonnegative(),
    averageScore: z.number().min(0).max(1),
  }),
  averages: z.object({
    inputTokens: z.number().positive(),
    openAiUsdPerFullTurn: z.number().positive(),
  }),
  acceptance: z.object({
    inputReductionRateVersusLegacy: z.number().min(0).max(1),
    costSavingsRateVersusLegacy: z.number().min(0).max(1),
    costSavingsRateVersusLunaModelOnly: z.number().min(0).max(1),
  }),
});

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const baseline = legacyBaselineSchema.parse(JSON.parse(await fs.readFile(
    path.resolve(rootDir, 'evals/baselines/openai-legacy-2026-08-04.json'),
    'utf8',
  )) as unknown);
  const optimized = optimizedBaselineSchema.parse(JSON.parse(await fs.readFile(
    path.resolve(rootDir, 'evals/baselines/openai-luna-optimized-2026-08-05.json'),
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
    optimizedLunaBaseline: {
      version: optimized.version,
      model: optimized.model,
      passedCases: optimized.quality.passedCases,
      totalCases: optimized.quality.totalCases,
      averageScore: optimized.quality.averageScore,
      inputTokensPerFullTurn: optimized.averages.inputTokens,
      openAiUsdPerFullTurn: optimized.averages.openAiUsdPerFullTurn,
      inputReductionRateVersusLegacy:
        optimized.acceptance.inputReductionRateVersusLegacy,
      costSavingsRateVersusLegacy:
        optimized.acceptance.costSavingsRateVersusLegacy,
      costSavingsRateVersusLunaModelOnly:
        optimized.acceptance.costSavingsRateVersusLunaModelOnly,
    },
    livePromotionRequired: false,
  }, null, 2)}\n`);

  const optimizedQualityFailed = optimized.quality.passedCases !==
    optimized.quality.totalCases || optimized.quality.failedCases > 0 ||
    optimized.quality.erroredCases > 0;
  const optimizedPerformanceFailed =
    optimized.averages.inputTokens >= baseline.acceptance.legacyInputTokens ||
    optimized.averages.openAiUsdPerFullTurn >=
      baseline.acceptance.lunaModelOnlyUsdPerFullTurn;
  if (failedQualityCases > 0 || promptAudit.violations.length > 0 ||
    optimizedQualityFailed || optimizedPerformanceFailed) {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Model comparison failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
