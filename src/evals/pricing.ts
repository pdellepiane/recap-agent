import { z } from 'zod';

import type { EvalTurnResult } from './case-schema';

const modelPriceSchema = z.object({
  inputPerMillionUsd: z.number().nonnegative(),
  cachedInputPerMillionUsd: z.number().nonnegative(),
  outputPerMillionUsd: z.number().nonnegative(),
});

export const pricingConfigSchema = z.object({
  version: z.string(),
  effectiveDate: z.string(),
  sources: z.array(z.string().url()).min(1),
  models: z.record(z.string(), modelPriceSchema),
  lambda: z.object({
    requestUsd: z.number().nonnegative(),
    gbSecondUsd: z.number().nonnegative(),
    memoryGb: z.number().positive(),
  }),
});

export type PricingConfig = z.infer<typeof pricingConfigSchema>;

export type CostEstimate = {
  openaiUsd: number;
  lambdaUsd: number;
  totalPricedUsd: number;
  unpricedExternalCalls: number;
};

export function estimateTurnCost(
  turn: EvalTurnResult,
  pricing: PricingConfig,
  models: { classifier?: string; extractor: string; reply: string },
): CostEstimate {
  const classifier = estimateModelUsage(
    turn.trace.token_usage.classifier ?? null,
    models.classifier ? pricing.models[models.classifier] : undefined,
  );
  const extraction = estimateModelUsage(
    turn.trace.token_usage.extraction,
    pricing.models[models.extractor],
  );
  const reply = estimateModelUsage(turn.trace.token_usage.reply, pricing.models[models.reply]);
  const lambdaSeconds = turn.latencyMs / 1000;
  const lambdaUsd =
    pricing.lambda.requestUsd +
    lambdaSeconds * pricing.lambda.memoryGb * pricing.lambda.gbSecondUsd;
  const openaiUsd = classifier + extraction + reply;
  return {
    openaiUsd,
    lambdaUsd,
    totalPricedUsd: openaiUsd + lambdaUsd,
    unpricedExternalCalls: turn.trace.tools_called.length,
  };
}

function estimateModelUsage(
  usage: EvalTurnResult['trace']['token_usage']['extraction'],
  price: z.infer<typeof modelPriceSchema> | undefined,
): number {
  if (!usage || !price) {
    return 0;
  }
  const cached = Math.min(usage.input_tokens, usage.cached_input_tokens ?? 0);
  const uncached = usage.input_tokens - cached;
  return (
    (uncached * price.inputPerMillionUsd +
      cached * price.cachedInputPerMillionUsd +
      usage.output_tokens * price.outputPerMillionUsd) /
    1_000_000
  );
}
