import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { EvalResult } from '../src/evals/case-schema';
import {
  formatCaseProgressLine,
  resolveLatestPricingPath,
} from '../src/evals/live-behavior-cli';
import { pricingConfigSchema } from '../src/evals/pricing';
import { newJudgeRunStats, priceSettledCase } from '../src/evals/runner';

const pricing = pricingConfigSchema.parse({
  version: 'test-cost',
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

function settledResult(turns: Array<{
  latencyMs: number;
  trace: {
    token_usage: Record<string, unknown>;
    openai_calls?: Record<string, unknown>;
  };
}>): EvalResult {
  return { turns } as EvalResult;
}

describe('settled case exact cost', () => {
  it('sums candidate turns and judge usage with no unpriced inventory', () => {
    const stats = newJudgeRunStats();
    stats.judgeUsageByModel['model-a'] = { inputTokens: 1_000, outputTokens: 50, cachedInputTokens: 100 };
    const cost = priceSettledCase({
      caseId: 'case-1',
      executed: true,
      result: settledResult([{
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
      }]),
      judgeStats: stats,
      pricing,
    });
    expect(cost.openaiUsd).toBeCloseTo(0.00132, 12);
    expect(cost.lambdaUsd).toBeCloseTo(0.0000322, 12);
    expect(cost.judgeUsd).toBeCloseTo(0.00101, 12);
    expect(cost.totalUsd).toBeCloseTo(0.0023622, 12);
    expect(cost.unpricedCases).toEqual([]);
    expect(cost.unpricedModels).toEqual([]);
  });

  it('prices nothing without a pricing config', () => {
    const stats = newJudgeRunStats();
    stats.judgeUsageByModel['model-a'] = { inputTokens: 1_000, outputTokens: 50, cachedInputTokens: 0 };
    const cost = priceSettledCase({
      caseId: 'case-1',
      executed: true,
      result: settledResult([{
        latencyMs: 2_000,
        trace: {
          token_usage: { extraction: { input_tokens: 10, output_tokens: 1 }, reply: null },
          openai_calls: { extraction: { model: 'model-a' } },
        },
      }]),
      judgeStats: stats,
      pricing: null,
    });
    expect(cost).toEqual({
      openaiUsd: 0,
      judgeUsd: 0,
      lambdaUsd: 0,
      totalUsd: 0,
      unpricedCases: [],
      unpricedModels: [],
    });
  });

  it('handles errored and unexecuted cases without candidate pricing', () => {
    const stats = newJudgeRunStats();
    stats.judgeUsageByModel['model-b'] = { inputTokens: 500, outputTokens: 25, cachedInputTokens: 0 };
    const errored = priceSettledCase({
      caseId: 'case-x',
      executed: true,
      result: null,
      judgeStats: stats,
      pricing,
    });
    expect(errored.judgeUsd).toBeCloseTo(0.000275, 12);
    expect(errored.totalUsd).toBeCloseTo(0.000275, 12);
    expect(errored.unpricedCases).toEqual(['case-x']);
    expect(errored.unpricedModels).toEqual([]);
    const unexecuted = priceSettledCase({
      caseId: 'case-u',
      executed: false,
      result: null,
      judgeStats: newJudgeRunStats(),
      pricing,
    });
    expect(unexecuted.totalUsd).toBe(0);
    expect(unexecuted.unpricedCases).toEqual([]);
  });

  it('inventories judge models missing from the pricing file', () => {
    const stats = newJudgeRunStats();
    stats.judgeUsageByModel.ghost = { inputTokens: 10, outputTokens: 1, cachedInputTokens: 0 };
    const cost = priceSettledCase({
      caseId: 'case-g',
      executed: false,
      result: null,
      judgeStats: stats,
      pricing,
    });
    expect(cost.judgeUsd).toBe(0);
    expect(cost.unpricedModels).toEqual(['ghost']);
  });
});

describe('live behavior progress line', () => {
  it('formats the priced line and omits cost when unpriced', () => {
    expect(formatCaseProgressLine({
      caseId: 'live_behavior.x',
      status: 'ok',
      executed: true,
      settledCases: 3,
      totalCases: 143,
      caseCostUsd: 0.001234,
      runningCostUsd: 0.045678,
      priced: true,
    })).toBe('[3/143] live_behavior.x ok case=$0.001234 running=$0.045678');
    expect(formatCaseProgressLine({
      caseId: 'a',
      status: 'error',
      executed: false,
      settledCases: 1,
      totalCases: 2,
      caseCostUsd: 0,
      runningCostUsd: 0,
      priced: false,
    })).toBe('[1/2] a error');
  });
});

describe('latest pricing resolution', () => {
  it('picks the newest dated pricing file and fails closed with none', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-pricing-'));
    const studies = path.join(dir, 'studies');
    fs.mkdirSync(studies);
    fs.writeFileSync(path.join(studies, 'pricing-2026-01-01.json'), '{}');
    fs.writeFileSync(path.join(studies, 'pricing-2026-02-01.json'), '{}');
    fs.writeFileSync(path.join(studies, 'notes.txt'), 'not pricing');
    try {
      expect(resolveLatestPricingPath(dir)).toBe(path.join(studies, 'pricing-2026-02-01.json'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-nopricing-'));
    try {
      expect(() => resolveLatestPricingPath(empty)).toThrow(/No pricing files found/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
