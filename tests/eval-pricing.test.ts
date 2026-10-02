import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  estimateTurnCost,
  priceJudgeUsage,
  priceTurnFromTrace,
  pricingConfigSchema,
  roundUsd,
} from '../src/evals/pricing';

describe('evaluation pricing', () => {
  it('prices cached, cache-write, and uncached input separately', () => {
    const pricing = pricingConfigSchema.parse({
      version: 'test',
      effectiveDate: '2026-07-01',
      sources: ['https://example.com'],
      models: {
        extractor: {
          inputPerMillionUsd: 1,
          cachedInputPerMillionUsd: 0.1,
          cacheWriteInputPerMillionUsd: 1.25,
          outputPerMillionUsd: 2,
        },
        reply: {
          inputPerMillionUsd: 1,
          cachedInputPerMillionUsd: 0.1,
          outputPerMillionUsd: 2,
        },
      },
      lambda: { requestUsd: 0.0000002, gbSecondUsd: 0.000016, memoryGb: 1 },
    });
    const turn = {
      latencyMs: 1_000,
      trace: {
        token_usage: {
          extraction: {
            input_tokens: 1_000,
            output_tokens: 100,
            total_tokens: 1_100,
            cached_input_tokens: 300,
            cache_write_input_tokens: 200,
          },
          reply: null,
        },
        tools_called: ['search'],
      },
    };
    const cost = estimateTurnCost(
      turn as Parameters<typeof estimateTurnCost>[0],
      pricing,
      { extractor: 'extractor', reply: 'reply' },
    );
    expect(cost.openaiUsd).toBeCloseTo(0.00098);
    expect(cost.lambdaUsd).toBeCloseTo(0.0000162);
    expect(cost.unpricedExternalCalls).toBe(1);
  });

  it('locks the legacy and Luna model-only full-turn cost baselines', () => {
    const baseline = JSON.parse(fs.readFileSync(path.resolve(
      process.cwd(),
      'evals/baselines/openai-legacy-2026-08-04.json',
    ), 'utf8')) as {
      usage: Record<string, {
        inputTokens: number;
        cachedInputTokens: number;
        outputTokens: number;
      }>;
      acceptance: {
        legacyOpenAiUsdPerFullTurn: number;
        lunaModelOnlyUsdPerFullTurn: number;
        lunaModelOnlySavingsRate: number;
      };
    };
    const pricing = pricingConfigSchema.parse(JSON.parse(fs.readFileSync(path.resolve(
      process.cwd(),
      'evals/studies/pricing-2026-08-04.json',
    ), 'utf8')) as unknown);

    const usage = (name: string) => {
      const entry = baseline.usage[name];
      if (!entry) {
        throw new Error(`Missing baseline usage for ${name}.`);
      }
      return {
        input_tokens: entry.inputTokens,
        cached_input_tokens: entry.cachedInputTokens,
        output_tokens: entry.outputTokens,
        total_tokens: entry.inputTokens + entry.outputTokens,
      };
    };
    const turn = {
      latencyMs: 0,
      trace: {
        token_usage: {
          classifier: usage('classifier'),
          extraction: usage('extraction'),
          reply: usage('reply'),
        },
        tools_called: [],
      },
    } as unknown as Parameters<typeof estimateTurnCost>[0];
    const legacy = estimateTurnCost(turn, pricing, {
      classifier: 'gpt-5.4-nano',
      extractor: 'gpt-5.4-nano',
      reply: 'gpt-5.4-mini',
    }).openaiUsd;
    const luna = estimateTurnCost(turn, pricing, {
      classifier: 'gpt-5.6-luna',
      extractor: 'gpt-5.6-luna',
      reply: 'gpt-5.6-luna',
    }).openaiUsd;

    expect(legacy).toBeCloseTo(
      baseline.acceptance.legacyOpenAiUsdPerFullTurn,
      8,
    );
    expect(luna).toBeCloseTo(
      baseline.acceptance.lunaModelOnlyUsdPerFullTurn,
      8,
    );
    expect(1 - luna / legacy).toBeCloseTo(
      baseline.acceptance.lunaModelOnlySavingsRate,
      8,
    );
  });

  it('locks the optimized Luna live baseline as the monotonic promotion gate', () => {
    const optimized = JSON.parse(fs.readFileSync(path.resolve(
      process.cwd(),
      'evals/baselines/openai-luna-optimized-2026-08-05.json',
    ), 'utf8')) as {
      quality: {
        totalCases: number;
        passedCases: number;
        failedCases: number;
        erroredCases: number;
      };
      turns: Array<{
        latencyMs: number;
        usage: Parameters<typeof estimateTurnCost>[0]['trace']['token_usage'];
        openAiUsd: number;
      }>;
      averages: {
        inputTokens: number;
        openAiUsdPerFullTurn: number;
      };
      acceptance: {
        legacyInputTokens: number;
        legacyOpenAiUsdPerFullTurn: number;
        lunaModelOnlyUsdPerFullTurn: number;
        inputReductionRateVersusLegacy: number;
        costSavingsRateVersusLegacy: number;
        costSavingsRateVersusLunaModelOnly: number;
      };
      monotonicGates: {
        maximumAverageInputTokens: number;
        maximumAverageOpenAiUsdPerFullTurn: number;
        minimumQualityPassRate: number;
      };
    };
    const pricing = pricingConfigSchema.parse(JSON.parse(fs.readFileSync(path.resolve(
      process.cwd(),
      'evals/studies/pricing-2026-08-04.json',
    ), 'utf8')) as unknown);
    const calculatedCosts = optimized.turns.map((turn) => estimateTurnCost(
      {
        latencyMs: turn.latencyMs,
        trace: { token_usage: turn.usage, tools_called: [] },
      } as unknown as Parameters<typeof estimateTurnCost>[0],
      pricing,
      {
        classifier: 'gpt-5.6-luna',
        extractor: 'gpt-5.6-luna',
        reply: 'gpt-5.6-luna',
      },
    ).openaiUsd);
    const averageCost = calculatedCosts.reduce((sum, cost) => sum + cost, 0) /
      calculatedCosts.length;
    const averageInputTokens = optimized.turns.reduce(
      (sum, turn) => sum + (turn.usage.total?.input_tokens ?? 0),
      0,
    ) / optimized.turns.length;
    const passRate = optimized.quality.passedCases / optimized.quality.totalCases;

    calculatedCosts.forEach((cost, index) => {
      expect(cost).toBeCloseTo(optimized.turns[index]?.openAiUsd ?? 0, 8);
    });
    expect(optimized.quality.failedCases).toBe(0);
    expect(optimized.quality.erroredCases).toBe(0);
    expect(passRate).toBe(optimized.monotonicGates.minimumQualityPassRate);
    expect(averageInputTokens).toBeCloseTo(optimized.averages.inputTokens, 8);
    expect(averageCost).toBeCloseTo(optimized.averages.openAiUsdPerFullTurn, 8);
    expect(averageInputTokens).toBeLessThan(optimized.acceptance.legacyInputTokens);
    expect(averageCost).toBeLessThan(
      optimized.acceptance.lunaModelOnlyUsdPerFullTurn,
    );
    expect(averageInputTokens).toBeLessThanOrEqual(
      optimized.monotonicGates.maximumAverageInputTokens,
    );
    expect(averageCost).toBeLessThanOrEqual(
      optimized.monotonicGates.maximumAverageOpenAiUsdPerFullTurn,
    );
    expect(1 - averageInputTokens / optimized.acceptance.legacyInputTokens)
      .toBeCloseTo(optimized.acceptance.inputReductionRateVersusLegacy, 8);
    expect(1 - averageCost / optimized.acceptance.legacyOpenAiUsdPerFullTurn)
      .toBeCloseTo(optimized.acceptance.costSavingsRateVersusLegacy, 8);
    expect(1 - averageCost / optimized.acceptance.lunaModelOnlyUsdPerFullTurn)
      .toBeCloseTo(optimized.acceptance.costSavingsRateVersusLunaModelOnly, 8);
  });
});

describe('trace-based exact turn pricing', () => {
  const pricing = pricingConfigSchema.parse({
    version: 'test-trace',
    effectiveDate: '2026-09-25',
    sources: ['https://example.com'],
    models: {
      'model-a': {
        inputPerMillionUsd: 1,
        cachedInputPerMillionUsd: 0.1,
        outputPerMillionUsd: 2,
      },
      'model-b': {
        inputPerMillionUsd: 0.5,
        cachedInputPerMillionUsd: 0.05,
        outputPerMillionUsd: 1,
      },
    },
    lambda: { requestUsd: 0.0000002, gbSecondUsd: 0.000016, memoryGb: 1 },
  });

  it('prices each stage at its recorded model with cached input split out', () => {
    const cost = priceTurnFromTrace({
      latencyMs: 2_000,
      trace: {
        token_usage: {
          classifier: null,
          extraction: { input_tokens: 1_000, output_tokens: 100, cached_input_tokens: 200 },
          reply: { input_tokens: 500, output_tokens: 50 },
        },
        openai_calls: {
          classifier: null,
          extraction: { model: 'model-a' },
          reply: { model: 'model-b' },
        },
      },
    }, pricing);
    // extraction: (800x1 + 200x0.1 + 100x2)/1e6 = 0.00102
    // reply: (500x0.5 + 50x1)/1e6 = 0.0003
    expect(cost.openaiUsd).toBeCloseTo(0.00132, 12);
    // lambda: 0.0000002 + 2x0.000016 = 0.0000322
    expect(cost.lambdaUsd).toBeCloseTo(0.0000322, 12);
    expect(cost.totalUsd).toBeCloseTo(0.0013522, 12);
    expect(cost.unpricedStages).toEqual([]);
    expect(cost.unpricedModels).toEqual([]);
  });

  it('inventories unpriced models and stages instead of zeroing silently', () => {
    const missingModel = priceTurnFromTrace({
      latencyMs: 1_000,
      trace: {
        token_usage: {
          extraction: { input_tokens: 100, output_tokens: 10 },
          reply: null,
        },
        openai_calls: { extraction: { model: 'ghost-model' }, reply: null },
      },
    }, pricing);
    expect(missingModel.openaiUsd).toBe(0);
    expect(missingModel.lambdaUsd).toBeGreaterThan(0);
    expect(missingModel.unpricedModels).toEqual(['ghost-model']);
    expect(missingModel.unpricedStages).toEqual([]);
    const missingStage = priceTurnFromTrace({
      latencyMs: 1_000,
      trace: {
        token_usage: {
          extraction: { input_tokens: 100, output_tokens: 10 },
          reply: null,
        },
      },
    }, pricing);
    expect(missingStage.openaiUsd).toBe(0);
    expect(missingStage.unpricedStages).toEqual(['extraction']);
    expect(missingStage.unpricedModels).toEqual([]);
  });
});

describe('judge usage pricing', () => {
  const pricing = pricingConfigSchema.parse({
    version: 'test-judge',
    effectiveDate: '2026-09-25',
    sources: ['https://example.com'],
    models: {
      'model-a': {
        inputPerMillionUsd: 1,
        cachedInputPerMillionUsd: 0.1,
        outputPerMillionUsd: 2,
      },
    },
    lambda: { requestUsd: 0.0000002, gbSecondUsd: 0.000016, memoryGb: 1 },
  });

  it('prices measured judge usage and marks unknown judge models unpriced', () => {
    const priced = priceJudgeUsage(
      'model-a',
      { inputTokens: 1_000, outputTokens: 50, cachedInputTokens: 100 },
      pricing,
    );
    // (900x1 + 100x0.1 + 50x2)/1e6 = 0.00101
    expect(priced.unpriced).toBe(false);
    expect(priced.usd).toBeCloseTo(0.00101, 12);
    expect(priceJudgeUsage(
      'ghost',
      { inputTokens: 10, outputTokens: 1, cachedInputTokens: 0 },
      pricing,
    )).toEqual({ usd: 0, unpriced: true });
  });

  it('rounds presentation dollars to six decimals', () => {
    expect(roundUsd(0.00123456789)).toBeCloseTo(0.001235, 9);
    expect(roundUsd(0)).toBe(0);
  });
});
