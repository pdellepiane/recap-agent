import { describe, expect, it } from 'vitest';

import { estimateTurnCost, pricingConfigSchema } from '../src/evals/pricing';

describe('evaluation pricing', () => {
  it('prices cached and uncached input separately', () => {
    const pricing = pricingConfigSchema.parse({
      version: 'test',
      effectiveDate: '2026-07-01',
      sources: ['https://example.com'],
      models: {
        extractor: {
          inputPerMillionUsd: 1,
          cachedInputPerMillionUsd: 0.1,
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
            cached_input_tokens: 500,
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
    expect(cost.openaiUsd).toBeCloseTo(0.00075);
    expect(cost.lambdaUsd).toBeCloseTo(0.0000162);
    expect(cost.unpricedExternalCalls).toBe(1);
  });
});
