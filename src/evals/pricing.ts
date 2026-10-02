import { z } from 'zod';

import type { EvalArtifactTurnResult } from './case-schema';

const modelPriceSchema = z.object({
  inputPerMillionUsd: z.number().nonnegative(),
  cachedInputPerMillionUsd: z.number().nonnegative(),
  cacheWriteInputPerMillionUsd: z.number().nonnegative().optional(),
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

/** Measured judge token usage, summed across runner-owned retries. */
export type JudgeUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export type TurnTraceCost = {
  openaiUsd: number;
  lambdaUsd: number;
  totalUsd: number;
  unpricedStages: string[];
  unpricedModels: string[];
};

type PricedUsage = {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
};

/** Minimal turn surface for trace pricing; both live and artifact turns satisfy it. */
type PricedTurn = {
  latencyMs: number;
  trace: {
    token_usage: {
      classifier?: PricedUsage | null;
      extraction: PricedUsage | null;
      reply: PricedUsage | null;
    };
    openai_calls?: {
      classifier?: { model: string } | null;
      extraction?: { model: string } | null;
      reply?: { model: string } | null;
    } | null;
  };
};

/** Presentation rounding: exact to a tenth of a microdollar. */
export function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

const PRICED_TRACE_STAGES = ['classifier', 'extraction', 'reply'] as const;

/**
 * Exact turn cost from measured trace usage and the per-stage models the
 * trace recorded. Stages with usage but no recorded model, and models
 * missing from the pricing file, are inventoried as unpriced — never
 * silently zeroed.
 */
export function priceTurnFromTrace(
  turn: PricedTurn,
  pricing: PricingConfig,
): TurnTraceCost {
  let openaiUsd = 0;
  const unpricedStages: string[] = [];
  const unpricedModels: string[] = [];
  for (const stage of PRICED_TRACE_STAGES) {
    const usage = turn.trace.token_usage[stage] ?? null;
    if (!usage) {
      continue;
    }
    const model = turn.trace.openai_calls?.[stage]?.model ?? null;
    if (!model) {
      unpricedStages.push(stage);
      continue;
    }
    const price = pricing.models[model];
    if (!price) {
      if (!unpricedModels.includes(model)) {
        unpricedModels.push(model);
      }
      continue;
    }
    openaiUsd += estimateModelUsage(usage, price);
  }
  const lambdaUsd =
    pricing.lambda.requestUsd +
    (turn.latencyMs / 1000) * pricing.lambda.memoryGb * pricing.lambda.gbSecondUsd;
  return {
    openaiUsd,
    lambdaUsd,
    totalUsd: openaiUsd + lambdaUsd,
    unpricedStages,
    unpricedModels,
  };
}

/** Exact judge cost from measured usage; unknown models price to zero as unpriced. */
export function priceJudgeUsage(
  model: string,
  usage: JudgeUsage,
  pricing: PricingConfig,
): { usd: number; unpriced: boolean } {
  const price = pricing.models[model];
  if (!price) {
    return { usd: 0, unpriced: true };
  }
  return {
    usd: estimateModelUsage(
      {
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cached_input_tokens: usage.cachedInputTokens,
      },
      price,
    ),
    unpriced: false,
  };
}

export function estimateTurnCost(
  turn: EvalArtifactTurnResult,
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
  usage: PricedUsage | null | undefined,
  price: z.infer<typeof modelPriceSchema> | undefined,
): number {
  if (!usage || !price) {
    return 0;
  }
  const cached = Math.min(usage.input_tokens, usage.cached_input_tokens ?? 0);
  const cacheWrite = Math.min(
    usage.input_tokens - cached,
    usage.cache_write_input_tokens ?? 0,
  );
  const uncached = usage.input_tokens - cached - cacheWrite;
  return (
    (uncached * price.inputPerMillionUsd +
      cached * price.cachedInputPerMillionUsd +
      cacheWrite * (price.cacheWriteInputPerMillionUsd ?? price.inputPerMillionUsd) +
      usage.output_tokens * price.outputPerMillionUsd) /
    1_000_000
  );
}
