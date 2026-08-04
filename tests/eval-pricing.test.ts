import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { estimateTurnCost, pricingConfigSchema } from '../src/evals/pricing';

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
});
